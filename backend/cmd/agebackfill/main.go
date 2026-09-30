// One-time classifier for comments predating the age policy. Never trains on user data.
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	_ "github.com/jackc/pgx/v5/stdlib"
	"kutezh/backend/internal/contentpolicy"
	"log"
	"os"
)

func main() {
	ctx := context.Background()
	db, err := sql.Open("pgx", os.Getenv("KUTEZH_DATABASE_URL"))
	if err != nil {
		log.Fatal("database unavailable")
	}
	defer db.Close()
	contentpolicy.Configure("http://127.0.0.1:8092/analyze", "enforce")
	count := 0
	for {
		var id, author int64
		var body string
		err = db.QueryRowContext(ctx, `SELECT id,author_user_id,body FROM post_comments WHERE NOT age_classified ORDER BY id LIMIT 1`).Scan(&id, &author, &body)
		if err == sql.ErrNoRows {
			break
		}
		if err != nil {
			log.Fatal("comment scan failed")
		}
		restricted, err := contentpolicy.AdultText(ctx, body)
		if err != nil {
			log.Fatal("classifier unavailable; unfinished comments remain age-restricted")
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			log.Fatal("transaction failed")
		}
		var current string
		if err = tx.QueryRowContext(ctx, `SELECT body FROM post_comments WHERE id=$1 AND NOT age_classified FOR UPDATE`, id).Scan(&current); err == sql.ErrNoRows {
			tx.Rollback()
			continue
		}
		if err != nil {
			log.Fatal("lock failed")
		}
		if current != body {
			tx.Rollback()
			continue
		}
		ageErr := contentpolicy.CheckAuthorAge(ctx, tx, author, restricted)
		var violation *contentpolicy.Violation
		blocked := errors.As(ageErr, &violation)
		if ageErr != nil && !blocked {
			tx.Rollback()
			log.Fatal("age check failed")
		}
		if _, err = tx.ExecContext(ctx, `UPDATE post_comments SET adult_only=$2,age_classified=true,moderation_hidden_at=CASE WHEN $3 THEN COALESCE(moderation_hidden_at,now()) ELSE moderation_hidden_at END WHERE id=$1`, id, restricted, blocked); err != nil {
			log.Fatal("update failed")
		}
		if blocked {
			if _, err = tx.ExecContext(ctx, `INSERT INTO moderation_reports(target_type,target_id,reason,target_snapshot,source) VALUES('comment',$1,'Мат в комментарии автора без установленного совершеннолетия',jsonb_build_object('id',$1::bigint,'body',$2::text),'ai') ON CONFLICT(target_type,target_id) WHERE source='ai' AND status='open' DO NOTHING`, id, body); err != nil {
				log.Fatal("audit failed")
			}
			if _, err = tx.ExecContext(ctx, `INSERT INTO notifications(user_id,kind,title,body,dedupe_key) VALUES($1,'post_moderated','Комментарий снят','Мат разрешён только авторам и читателям от 18 лет. Обратитесь к модератору, если это ошибка.',$2) ON CONFLICT(user_id,dedupe_key) DO NOTHING`, author, fmt.Sprintf("age-comment:%d", id)); err != nil {
				log.Fatal("notice failed")
			}
		}
		if err = tx.Commit(); err != nil {
			log.Fatal("commit failed")
		}
		count++
	}
	fmt.Printf("Classified %d existing comments\n", count)
}
