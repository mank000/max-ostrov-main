package games

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"kutezh/backend/internal/rewards"
)

type DinoEvent struct {
	Meter int    `json:"meter"`
	Kind  string `json:"kind"`
}

type dinoState struct {
	Status    string      `json:"status"`
	Coins     []int       `json:"coins"`
	Events    []DinoEvent `json:"events"`
	Collected []int       `json:"collected"`
	Bonuses   []int       `json:"bonuses"`
	StartedAt time.Time   `json:"started_at"`
	ExpiresAt time.Time   `json:"expires_at"`
}

type DinoRun struct {
	ID        string      `json:"id"`
	Status    string      `json:"status"`
	Coins     []int       `json:"coins"`
	Events    []DinoEvent `json:"events"`
	Collected []int       `json:"collected"`
	Bonuses   []int       `json:"bonuses"`
	Reward    int         `json:"reward"`
	Balance   int64       `json:"balance"`
}

func makeDinoCoins() []int {
	items := make([]int, 0, 72)
	meter := 180 + random(120)
	for len(items) < 72 && meter < 12000 {
		cluster := 2 + random(3)
		for i := 0; i < cluster && len(items) < 72; i++ {
			items = append(items, meter+i*11)
		}
		meter += 270 + random(300)
	}
	return items
}

func makeDinoEvents() []DinoEvent {
	items := make([]DinoEvent, 0, 8)
	meter := 1500 + random(501)
	regular := []string{"meteor", "birds", "collapse"}
	for i := 0; i < 8; i++ {
		kind := regular[random(len(regular))]
		if (i+1)%4 == 0 || random(6) == 0 {
			kind = "boss"
		}
		items = append(items, DinoEvent{Meter: meter, Kind: kind})
		meter += 1500 + random(501)
	}
	return items
}

func (s *Service) dinoView(ctx context.Context, id string, userID int64, st dinoState, reward int) (DinoRun, error) {
	var balance int64
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE((SELECT balance FROM coin_wallets WHERE user_id=$1),0)`, userID).Scan(&balance)
	return DinoRun{
		ID: id, Status: st.Status, Coins: st.Coins, Events: st.Events,
		Collected: st.Collected, Bonuses: st.Bonuses, Reward: reward, Balance: balance,
	}, err
}

func (s *Service) StartDino(ctx context.Context, userID int64, key string) (DinoRun, error) {
	if len(key) < 8 || len(key) > 100 {
		return DinoRun{}, ErrInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return DinoRun{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('game-start:' || $1::bigint::text,0))`, userID); err != nil {
		return DinoRun{}, err
	}
	var id, kind string
	var data []byte
	err = tx.QueryRowContext(ctx, `SELECT id,kind,state FROM game_runs WHERE user_id=$1 AND request_key=$2`, userID, key).Scan(&id, &kind, &data)
	if err == nil {
		if kind != "dino" {
			return DinoRun{}, ErrInput
		}
		var st dinoState
		if err = json.Unmarshal(data, &st); err != nil {
			return DinoRun{}, err
		}
		if err = tx.Commit(); err != nil {
			return DinoRun{}, err
		}
		return s.dinoView(ctx, id, userID, st, 0)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DinoRun{}, err
	}
	now := s.now()
	var count int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM game_runs WHERE user_id=$1 AND created_at>$2`, userID, now.Add(-time.Minute)).Scan(&count); err != nil {
		return DinoRun{}, err
	}
	if count >= 10 {
		return DinoRun{}, ErrLimit
	}
	if _, err = tx.ExecContext(ctx, `UPDATE game_runs SET state=jsonb_set(state,'{status}','"abandoned"') WHERE user_id=$1 AND state->>'status'='playing'`, userID); err != nil {
		return DinoRun{}, err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM game_runs WHERE user_id=$1 AND created_at<$2`, userID, now.Add(-7*24*time.Hour)); err != nil {
		return DinoRun{}, err
	}
	token := make([]byte, 16)
	if _, err = rand.Read(token); err != nil {
		return DinoRun{}, err
	}
	id = hex.EncodeToString(token)
	st := dinoState{
		Status: "playing", Coins: makeDinoCoins(), Events: makeDinoEvents(),
		Collected: []int{}, Bonuses: []int{}, StartedAt: now, ExpiresAt: now.Add(45 * time.Minute),
	}
	data, err = json.Marshal(st)
	if err != nil {
		return DinoRun{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO game_runs(id,user_id,request_key,kind,state,created_at) VALUES($1,$2,$3,'dino',$4,$5)`, id, userID, key, data, now); err != nil {
		return DinoRun{}, err
	}
	if err = tx.Commit(); err != nil {
		return DinoRun{}, err
	}
	return s.dinoView(ctx, id, userID, st, 0)
}

func dinoReached(startedAt, now time.Time, meter int) bool {
	return !now.Before(startedAt.Add(time.Duration(meter) * time.Second / 34))
}

func (s *Service) ClaimDinoCoin(ctx context.Context, userID int64, id string, coin int) (DinoRun, error) {
	if len(id) != 32 || coin < 0 {
		return DinoRun{}, ErrInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return DinoRun{}, err
	}
	defer tx.Rollback()
	var kind string
	var data []byte
	if err = tx.QueryRowContext(ctx, `SELECT kind,state FROM game_runs WHERE id=$1 AND user_id=$2 FOR UPDATE`, id, userID).Scan(&kind, &data); errors.Is(err, sql.ErrNoRows) {
		return DinoRun{}, ErrMissing
	} else if err != nil {
		return DinoRun{}, err
	}
	if kind != "dino" {
		return DinoRun{}, ErrMissing
	}
	var st dinoState
	if err = json.Unmarshal(data, &st); err != nil {
		return DinoRun{}, err
	}
	if coin >= len(st.Coins) {
		return DinoRun{}, ErrInput
	}
	now := s.now()
	if st.Status != "playing" || now.After(st.ExpiresAt) {
		return DinoRun{}, ErrMissing
	}
	if slices.Contains(st.Collected, coin) {
		if err = tx.Commit(); err != nil {
			return DinoRun{}, err
		}
		return s.dinoView(ctx, id, userID, st, 0)
	}
	if !dinoReached(st.StartedAt, now, st.Coins[coin]) {
		return DinoRun{}, ErrEarly
	}
	st.Collected = append(st.Collected, coin)
	reward, err := rewards.CreditDinoCoin(ctx, tx, userID, id, coin, now)
	if err != nil {
		return DinoRun{}, err
	}
	data, err = json.Marshal(st)
	if err != nil {
		return DinoRun{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE game_runs SET state=$1 WHERE id=$2`, data, id); err != nil {
		return DinoRun{}, err
	}
	if err = tx.Commit(); err != nil {
		return DinoRun{}, err
	}
	if reward > 0 && s.publisher != nil {
		s.publisher.Publish(userID, "wallet.updated", map[string]int{"reward": reward})
	}
	return s.dinoView(ctx, id, userID, st, reward)
}

func (s *Service) ClaimDinoBoss(ctx context.Context, userID int64, id string, event int) (DinoRun, error) {
	if len(id) != 32 || event < 0 {
		return DinoRun{}, ErrInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return DinoRun{}, err
	}
	defer tx.Rollback()
	var kind string
	var data []byte
	if err = tx.QueryRowContext(ctx, `SELECT kind,state FROM game_runs WHERE id=$1 AND user_id=$2 FOR UPDATE`, id, userID).Scan(&kind, &data); errors.Is(err, sql.ErrNoRows) {
		return DinoRun{}, ErrMissing
	} else if err != nil {
		return DinoRun{}, err
	}
	if kind != "dino" {
		return DinoRun{}, ErrMissing
	}
	var st dinoState
	if err = json.Unmarshal(data, &st); err != nil {
		return DinoRun{}, err
	}
	if event >= len(st.Events) || st.Events[event].Kind != "boss" {
		return DinoRun{}, ErrInput
	}
	now := s.now()
	if st.Status != "playing" || now.After(st.ExpiresAt) {
		return DinoRun{}, ErrMissing
	}
	if slices.Contains(st.Bonuses, event) {
		if err = tx.Commit(); err != nil {
			return DinoRun{}, err
		}
		return s.dinoView(ctx, id, userID, st, 0)
	}
	if !dinoReached(st.StartedAt, now, st.Events[event].Meter+280) {
		return DinoRun{}, ErrEarly
	}
	st.Bonuses = append(st.Bonuses, event)
	reward, err := rewards.CreditDinoBoss(ctx, tx, userID, id, event, now)
	if err != nil {
		return DinoRun{}, err
	}
	data, err = json.Marshal(st)
	if err != nil {
		return DinoRun{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE game_runs SET state=$1 WHERE id=$2`, data, id); err != nil {
		return DinoRun{}, err
	}
	if err = tx.Commit(); err != nil {
		return DinoRun{}, err
	}
	if reward > 0 && s.publisher != nil {
		s.publisher.Publish(userID, "wallet.updated", map[string]int{"reward": reward})
	}
	return s.dinoView(ctx, id, userID, st, reward)
}
