//go:build demo

package contentanalysis

import (
	"context"
	"database/sql"
	"kutezh/backend/internal/contentpolicy"
)

// Только локальная сборка: модели не нужны, остаются правила для явного текста.
// Это не результат нейросетевой проверки и не путь для публичного сервера.
func EnqueuePost(ctx context.Context, tx *sql.Tx, postID int64) error {
	var caption string
	if err := tx.QueryRowContext(ctx, "SELECT caption FROM posts WHERE id = $1", postID).Scan(&caption); err != nil {
		return err
	}
	if err := contentpolicy.CheckObviousText(caption); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "UPDATE posts SET adult_only = $2, age_classified = true WHERE id = $1", postID, contentpolicy.SensitiveLanguage(caption))
	return err
}
