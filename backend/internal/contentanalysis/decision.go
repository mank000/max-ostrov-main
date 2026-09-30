package contentanalysis

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// Selected on V7 validation; checked again on V9 INT16 test predictions.
// Image-driven automatic hiding is limited to explicit sexual content.
const ExplicitBlockThreshold = 0.90

const TextVersion = "c624cd851211716364b0462d9fdae3c12db295ea0db4f5f20f9ea364af177afa"

func blockReason(labels []string) string {
	for _, label := range labels {
		switch label {
		case "profanity_underage":
			return "мат разрешён только авторам и читателям от 18 лет; совершеннолетие автора не установлено."
		case "sexual_explicit", "anatomical_nudity":
			return "откровенные сексуальные изображения запрещены правилами сообщества."
		case "politics":
			return "политические публикации не допускаются правилами сообщества."
		case "threat":
			return "угрозы и призывы к насилию запрещены правилами сообщества."
		case "hate":
			return "травля и унижение людей по происхождению или вере запрещены правилами сообщества."
		case "extremism":
			return "пропаганда нацизма и терроризма запрещена правилами сообщества."
		case "prohibited":
			return "предложения запрещённых товаров и мошеннических услуг не допускаются."
		case "sexual":
			return "откровенный сексуальный контент запрещён правилами сообщества."
		}
	}
	return "прямые оскорбления запрещены правилами сообщества."
}

func (w *Worker) hide(ctx context.Context, tx *sql.Tx, j job, out result) error {
	var author int64
	err := tx.QueryRowContext(ctx, `UPDATE posts SET moderation_hidden_at=now()
 WHERE id=$1 AND moderation_hidden_at IS NULL RETURNING author_user_id`, j.PostID).Scan(&author)
	if err == sql.ErrNoRows {
		return nil
	} // Already hidden by a human: do not duplicate notices.
	if err != nil {
		return err
	}
	body := fmt.Sprintf("Публикация №%d снята: %s Если это ошибка, обратитесь к модератору.", j.PostID, blockReason(out.Block))
	data, _ := json.Marshal(out)
	if _, err = tx.ExecContext(ctx, `INSERT INTO post_analysis_decisions(post_id,revision,reason,result)
 VALUES($1,$2,$3,$4) ON CONFLICT(post_id,revision) DO NOTHING`, j.PostID, j.Revision, body, data); err != nil {
		return err
	}
	// No post_id link: ordinary notifications referencing hidden posts are filtered
	// out. This private notice must remain readable after hiding or deleting a post.
	if _, err = tx.ExecContext(ctx, `INSERT INTO notifications(user_id,kind,title,body,dedupe_key)
 VALUES($1,'post_moderated','Публикация снята',$2,$3) ON CONFLICT(user_id,dedupe_key) DO NOTHING`, author, body, fmt.Sprintf("ai-post:%d:%d", j.PostID, j.Revision)); err != nil {
		return err
	}
	for _, message := range []map[string]any{
		{"source": "contentanalysis", "broadcast": true, "event": map[string]any{"type": "sync.required", "payload": map[string]any{}, "occurred_at": time.Now().UTC()}},
		{"source": "contentanalysis", "users": []int64{author}, "event": map[string]any{"type": "notification.created", "payload": map[string]any{}, "occurred_at": time.Now().UTC()}},
	} {
		payload, _ := json.Marshal(message)
		if _, err = tx.ExecContext(ctx, `SELECT pg_notify('kutezh_updates',$1)`, string(payload)); err != nil {
			return err
		}
	}
	return nil
}
