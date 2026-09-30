package games

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"slices"
	"time"

	"kutezh/backend/internal/rewards"
)

var ErrInput = errors.New("invalid game request")
var ErrMissing = errors.New("game run not found")
var ErrEarly = errors.New("game challenge not ready")
var ErrLimit = errors.New("game start limit exceeded")

type Service struct {
	db        *sql.DB
	publisher rewards.Publisher
	now       func() time.Time
}

func NewService(db *sql.DB, p rewards.Publisher) *Service {
	return &Service{db: db, publisher: p, now: time.Now}
}

type Challenge struct {
	Prompt   string   `json:"prompt"`
	Color    string   `json:"color,omitempty"`
	Options  []string `json:"options"`
	Sequence []int    `json:"sequence,omitempty"`
}
type state struct {
	Step        int       `json:"step"`
	Score       int       `json:"score"`
	Status      string    `json:"status"`
	Reward      int       `json:"reward"`
	Challenge   Challenge `json:"challenge"`
	Answer      []int     `json:"answer"`
	ReadyAt     time.Time `json:"ready_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	LastCorrect *bool     `json:"last_correct,omitempty"`
}
type Run struct {
	ID          string    `json:"id"`
	Kind        string    `json:"kind"`
	Step        int       `json:"step"`
	Total       int       `json:"total"`
	Score       int       `json:"score"`
	Status      string    `json:"status"`
	Reward      int       `json:"reward"`
	Balance     int64     `json:"balance"`
	Challenge   Challenge `json:"challenge"`
	WaitMS      int64     `json:"wait_ms"`
	LastCorrect *bool     `json:"last_correct,omitempty"`
}

func random(n int) int {
	v, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		panic(err)
	}
	return int(v.Int64())
}
func challenge(kind string, step int) (Challenge, []int, time.Duration) {
	colors := []string{"Синий", "Красный", "Зелёный", "Золотой"}
	switch kind {
	case "rhythm":
		seq := make([]int, 3+step/2)
		for i := range seq {
			seq[i] = random(4)
		}
		return Challenge{Prompt: "Повтори последовательность", Options: []string{"●", "◆", "▲", "■"}, Sequence: seq}, seq, time.Duration(len(seq)*650+700) * time.Millisecond
	case "color":
		color := random(4)
		word := (color + 1 + random(3)) % 4
		return Challenge{Prompt: colors[word], Color: []string{"#418cff", "#ef6274", "#25a97b", "#c08b00"}[color], Options: colors}, []int{color}, 250 * time.Millisecond
	default:
		a, b := random(18)+2, random(12)+2
		answer := a + b
		symbol := "+"
		if step%3 == 1 {
			answer = a * b
			symbol = "×"
		}
		if step%3 == 2 {
			a += b
			answer = a - b
			symbol = "−"
		}
		pos := random(4)
		opts := make([]string, 4)
		for i := range opts {
			opts[i] = fmt.Sprint(answer + (i-pos)*2)
		}
		return Challenge{Prompt: fmt.Sprintf("%d %s %d", a, symbol, b), Options: opts}, []int{pos}, 250 * time.Millisecond
	}
}
func (s *Service) view(ctx context.Context, id, kind string, userID int64, st state) (Run, error) {
	var balance int64
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE((SELECT balance FROM coin_wallets WHERE user_id=$1),0)`, userID).Scan(&balance)
	return Run{ID: id, Kind: kind, Step: st.Step, Total: 8, Score: st.Score, Status: st.Status, Reward: st.Reward, Balance: balance, Challenge: st.Challenge, WaitMS: max(0, st.ReadyAt.Sub(s.now()).Milliseconds()), LastCorrect: st.LastCorrect}, err
}
func (s *Service) Start(ctx context.Context, userID int64, kind, key string) (Run, error) {
	if !slices.Contains([]string{"rhythm", "color", "math"}, kind) || len(key) < 8 || len(key) > 100 {
		return Run{}, ErrInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Run{}, err
	}
	defer tx.Rollback()
	// All run creation for this account is serialized, bounding start requests.
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('game-start:' || $1::bigint::text,0))`, userID); err != nil {
		return Run{}, err
	}
	var id, oldKind string
	var data []byte
	err = tx.QueryRowContext(ctx, `SELECT id,kind,state FROM game_runs WHERE user_id=$1 AND request_key=$2`, userID, key).Scan(&id, &oldKind, &data)
	if err == nil {
		if kind != oldKind {
			return Run{}, ErrInput
		}
		var st state
		if err = json.Unmarshal(data, &st); err != nil {
			return Run{}, err
		}
		if err = tx.Commit(); err != nil {
			return Run{}, err
		}
		return s.view(ctx, id, kind, userID, st)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Run{}, err
	}
	now := s.now()
	var count int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM game_runs WHERE user_id=$1 AND created_at>$2`, userID, now.Add(-time.Minute)).Scan(&count); err != nil {
		return Run{}, err
	}
	if count >= 10 {
		return Run{}, ErrLimit
	}
	// An abandoned run remains replayable but can no longer earn coins.
	if _, err = tx.ExecContext(ctx, `UPDATE game_runs SET state=jsonb_set(state,'{status}','"abandoned"') WHERE user_id=$1 AND state->>'status'='playing'`, userID); err != nil {
		return Run{}, err
	}
	// Retain a bounded history of transient challenges; rewards remain in ledger.
	if _, err = tx.ExecContext(ctx, `DELETE FROM game_runs WHERE user_id=$1 AND created_at<$2`, userID, now.Add(-7*24*time.Hour)); err != nil {
		return Run{}, err
	}
	token := make([]byte, 16)
	if _, err = rand.Read(token); err != nil {
		return Run{}, err
	}
	id = hex.EncodeToString(token)
	c, a, delay := challenge(kind, 0)
	st := state{Status: "playing", Challenge: c, Answer: a, ReadyAt: now.Add(delay), ExpiresAt: now.Add(10 * time.Minute)}
	data, err = json.Marshal(st)
	if err != nil {
		return Run{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO game_runs(id,user_id,request_key,kind,state,created_at) VALUES($1,$2,$3,$4,$5,$6)`, id, userID, key, kind, data, now); err != nil {
		return Run{}, err
	}
	if err = tx.Commit(); err != nil {
		return Run{}, err
	}
	return s.view(ctx, id, kind, userID, st)
}
func (s *Service) Answer(ctx context.Context, userID int64, id string, step int, answer []int) (Run, error) {
	if len(id) != 32 || step < 0 || step > 7 || len(answer) < 1 || len(answer) > 6 {
		return Run{}, ErrInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Run{}, err
	}
	defer tx.Rollback()
	var kind string
	var data []byte
	if err = tx.QueryRowContext(ctx, `SELECT kind,state FROM game_runs WHERE id=$1 AND user_id=$2 FOR UPDATE`, id, userID).Scan(&kind, &data); errors.Is(err, sql.ErrNoRows) {
		return Run{}, ErrMissing
	} else if err != nil {
		return Run{}, err
	}
	var st state
	if err = json.Unmarshal(data, &st); err != nil {
		return Run{}, err
	}
	now := s.now()
	// A retry returns the committed state, never advances or credits twice.
	if step < st.Step || st.Status != "playing" {
		if err = tx.Commit(); err != nil {
			return Run{}, err
		}
		return s.view(ctx, id, kind, userID, st)
	}
	if step != st.Step {
		return Run{}, ErrInput
	}
	if now.After(st.ExpiresAt) {
		st.Status = "expired"
	} else {
		if now.Before(st.ReadyAt) {
			return Run{}, ErrEarly
		}
		if len(answer) != len(st.Answer) {
			return Run{}, ErrInput
		}
		for _, a := range answer {
			if a < 0 || a > 3 {
				return Run{}, ErrInput
			}
		}
		correct := slices.Equal(answer, st.Answer)
		st.LastCorrect = &correct
		if correct {
			st.Score++
		}
		st.Step++
		if st.Step == 8 {
			st.Status = "finished"
			if st.Score >= 6 {
				st.Reward, err = rewards.CreditGameReward(ctx, tx, userID, id, now)
				if err != nil {
					return Run{}, err
				}
			}
			if err = upsertHighScore(ctx, tx, userID, kind, int64(st.Score), 8, now); err != nil {
				return Run{}, err
			}
			st.Challenge = Challenge{}
			st.Answer = nil
		} else {
			c, a, delay := challenge(kind, st.Step)
			st.Challenge = c
			st.Answer = a
			st.ReadyAt = now.Add(delay)
		}
	}
	data, err = json.Marshal(st)
	if err != nil {
		return Run{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE game_runs SET state=$1 WHERE id=$2`, data, id); err != nil {
		return Run{}, err
	}
	if err = tx.Commit(); err != nil {
		return Run{}, err
	}
	if st.Reward > 0 && s.publisher != nil {
		s.publisher.Publish(userID, "wallet.updated", map[string]int{"reward": st.Reward})
	}
	return s.view(ctx, id, kind, userID, st)
}


const flappyPipeCount = 80

type FlappyPipe struct {
	Gap  int  `json:"gap"`
	Coin bool `json:"coin"`
}

type flappyState struct {
	Status    string       `json:"status"`
	Pipes     []FlappyPipe `json:"pipes"`
	Collected []int        `json:"collected"`
	StartedAt time.Time    `json:"started_at"`
	ExpiresAt time.Time    `json:"expires_at"`
}

type FlappyRun struct {
	ID        string       `json:"id"`
	Status    string       `json:"status"`
	Pipes     []FlappyPipe `json:"pipes"`
	Collected []int        `json:"collected"`
	Reward    int          `json:"reward"`
	Balance   int64        `json:"balance"`
}

func makeFlappyPipes() []FlappyPipe {
	pipes := make([]FlappyPipe, flappyPipeCount)
	earlyCoin := false
	for i := range pipes {
		pipes[i] = FlappyPipe{Gap: 28 + random(45), Coin: i > 0 && random(100) < 35}
		if i > 0 && i < 6 && pipes[i].Coin {
			earlyCoin = true
		}
	}
	if !earlyCoin {
		pipes[2].Coin = true
	}
	return pipes
}

func (s *Service) flappyView(ctx context.Context, id string, userID int64, st flappyState, reward int) (FlappyRun, error) {
	var balance int64
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE((SELECT balance FROM coin_wallets WHERE user_id=$1),0)`, userID).Scan(&balance)
	return FlappyRun{ID: id, Status: st.Status, Pipes: st.Pipes, Collected: st.Collected, Reward: reward, Balance: balance}, err
}

func (s *Service) StartFlappy(ctx context.Context, userID int64, key string) (FlappyRun, error) {
	if len(key) < 8 || len(key) > 100 {
		return FlappyRun{}, ErrInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return FlappyRun{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('game-start:' || $1::bigint::text,0))`, userID); err != nil {
		return FlappyRun{}, err
	}
	var id, kind string
	var data []byte
	err = tx.QueryRowContext(ctx, `SELECT id,kind,state FROM game_runs WHERE user_id=$1 AND request_key=$2`, userID, key).Scan(&id, &kind, &data)
	if err == nil {
		if kind != "flappy" {
			return FlappyRun{}, ErrInput
		}
		var st flappyState
		if err = json.Unmarshal(data, &st); err != nil {
			return FlappyRun{}, err
		}
		if err = tx.Commit(); err != nil {
			return FlappyRun{}, err
		}
		return s.flappyView(ctx, id, userID, st, 0)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FlappyRun{}, err
	}
	now := s.now()
	var count int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM game_runs WHERE user_id=$1 AND created_at>$2`, userID, now.Add(-time.Minute)).Scan(&count); err != nil {
		return FlappyRun{}, err
	}
	if count >= 10 {
		return FlappyRun{}, ErrLimit
	}
	if _, err = tx.ExecContext(ctx, `UPDATE game_runs SET state=jsonb_set(state,'{status}','"abandoned"') WHERE user_id=$1 AND state->>'status'='playing'`, userID); err != nil {
		return FlappyRun{}, err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM game_runs WHERE user_id=$1 AND created_at<$2`, userID, now.Add(-7*24*time.Hour)); err != nil {
		return FlappyRun{}, err
	}
	token := make([]byte, 16)
	if _, err = rand.Read(token); err != nil {
		return FlappyRun{}, err
	}
	id = hex.EncodeToString(token)
	st := flappyState{Status: "playing", Pipes: makeFlappyPipes(), Collected: []int{}, StartedAt: now, ExpiresAt: now.Add(10 * time.Minute)}
	data, err = json.Marshal(st)
	if err != nil {
		return FlappyRun{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO game_runs(id,user_id,request_key,kind,state,created_at) VALUES($1,$2,$3,'flappy',$4,$5)`, id, userID, key, data, now); err != nil {
		return FlappyRun{}, err
	}
	if err = tx.Commit(); err != nil {
		return FlappyRun{}, err
	}
	return s.flappyView(ctx, id, userID, st, 0)
}

func (s *Service) CollectFlappy(ctx context.Context, userID int64, id string, pipe int) (FlappyRun, error) {
	if len(id) != 32 || pipe < 0 || pipe >= flappyPipeCount {
		return FlappyRun{}, ErrInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return FlappyRun{}, err
	}
	defer tx.Rollback()
	var kind string
	var data []byte
	if err = tx.QueryRowContext(ctx, `SELECT kind,state FROM game_runs WHERE id=$1 AND user_id=$2 FOR UPDATE`, id, userID).Scan(&kind, &data); errors.Is(err, sql.ErrNoRows) {
		return FlappyRun{}, ErrMissing
	} else if err != nil {
		return FlappyRun{}, err
	}
	if kind != "flappy" {
		return FlappyRun{}, ErrMissing
	}
	var st flappyState
	if err = json.Unmarshal(data, &st); err != nil {
		return FlappyRun{}, err
	}
	now := s.now()
	if st.Status != "playing" {
		if err = tx.Commit(); err != nil {
			return FlappyRun{}, err
		}
		return s.flappyView(ctx, id, userID, st, 0)
	}
	if now.After(st.ExpiresAt) {
		st.Status = "expired"
		data, err = json.Marshal(st)
		if err != nil {
			return FlappyRun{}, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE game_runs SET state=$1 WHERE id=$2`, data, id); err != nil {
			return FlappyRun{}, err
		}
		if err = tx.Commit(); err != nil {
			return FlappyRun{}, err
		}
		return s.flappyView(ctx, id, userID, st, 0)
	}
	if pipe >= len(st.Pipes) || !st.Pipes[pipe].Coin {
		return FlappyRun{}, ErrInput
	}
	if slices.Contains(st.Collected, pipe) {
		if err = tx.Commit(); err != nil {
			return FlappyRun{}, err
		}
		return s.flappyView(ctx, id, userID, st, 0)
	}
	if now.Before(st.StartedAt.Add(time.Duration(pipe+1) * 450 * time.Millisecond)) {
		return FlappyRun{}, ErrEarly
	}
	st.Collected = append(st.Collected, pipe)
	reward, err := rewards.CreditGameCoin(ctx, tx, userID, id, pipe, now)
	if err != nil {
		return FlappyRun{}, err
	}
	data, err = json.Marshal(st)
	if err != nil {
		return FlappyRun{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE game_runs SET state=$1 WHERE id=$2`, data, id); err != nil {
		return FlappyRun{}, err
	}
	if err = tx.Commit(); err != nil {
		return FlappyRun{}, err
	}
	if reward > 0 && s.publisher != nil {
		s.publisher.Publish(userID, "wallet.updated", map[string]int{"reward": reward})
	}
	return s.flappyView(ctx, id, userID, st, reward)
}
