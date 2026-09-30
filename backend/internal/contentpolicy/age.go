package contentpolicy

import (
	"context"
	"database/sql"
)

// No birth date is not evidence of adulthood. Date comparisons stay in the DB.
func CheckAuthorAge(ctx context.Context, tx *sql.Tx, userID int64, restricted bool) error {
	if !restricted {
		return nil
	}
	var adult bool
	if err := tx.QueryRowContext(ctx, `SELECT content_age_visible(true,$1)`, userID).Scan(&adult); err != nil {
		return err
	}
	if !adult {
		return &Violation{Category: "profanity_underage"}
	}
	return nil
}

// Age classification remains separate from whether this vocabulary is permitted.
func AdultText(ctx context.Context, text string) (bool, error) {
	if analysis, ok := DiscussionAnalysisFromContext(ctx, text); ok {
		return analysis.AdultOnly, nil
	}
	if SensitiveLanguage(text) {
		return true, nil
	}
	aiState.RLock()
	active := aiState.checker
	aiState.RUnlock()
	if active == nil {
		return false, nil
	}
	result, err := active.analyze(ctx, normalizeForModel(text))
	if err != nil {
		return false, err
	}
	return result.Scores["profanity"] >= 0.9 || result.Scores["obscenity"] >= 0.9, nil
}
