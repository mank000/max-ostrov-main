package moderation

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"kutezh/backend/internal/contentpolicy"
)

func (s *Service) ListReports(ctx context.Context, status string, targetType TargetType, beforeID int64, limit int) ([]Report, *int64, error) {
	if (targetType != "" && !targetType.Valid()) || (status != "open" && status != "reviewed" && status != "dismissed") || beforeID < 0 || limit < 1 || limit > 100 {
		return nil, nil, ErrInvalid
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+reportColumns+` FROM moderation_reports
		WHERE status=$1 AND ($2::bigint=0 OR id<$2) AND ($4='' OR target_type=$4)
		ORDER BY id DESC LIMIT $3`, status, beforeID, limit+1, targetType)
	if err != nil {
		return nil, nil, fmt.Errorf("list moderation reports: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := make([]Report, 0, limit)
	for rows.Next() {
		item, err := scanReport(rows)
		if err != nil {
			return nil, nil, fmt.Errorf("scan moderation report: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate moderation reports: %w", err)
	}
	if err := s.loadReportMedia(ctx, items); err != nil {
		return nil, nil, err
	}
	if len(items) > limit {
		items = items[:limit]
		cursor := items[len(items)-1].ID
		return items, &cursor, nil
	}
	return items, nil, nil
}

func (s *Service) GetReport(ctx context.Context, id int64) (Report, error) {
	if id <= 0 {
		return Report{}, ErrNotFound
	}
	report, err := scanReport(s.db.QueryRowContext(ctx, `SELECT `+reportColumns+` FROM moderation_reports WHERE id=$1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Report{}, ErrNotFound
	}
	if err != nil {
		return Report{}, fmt.Errorf("get moderation report: %w", err)
	}
	reports := []Report{report}
	if err := s.loadReportMedia(ctx, reports); err != nil {
		return Report{}, err
	}
	return reports[0], nil
}

func (s *Service) Decide(ctx context.Context, actorID, reportID int64, input DecisionInput) (Report, error) {
	input.Reason = strings.TrimSpace(input.Reason)
	if actorID <= 0 || reportID <= 0 || input.Version <= 0 ||
		utf8.RuneCountInString(input.Reason) < 3 || utf8.RuneCountInString(input.Reason) > 500 {
		return Report{}, ErrInvalid
	}
	switch input.Action {
	case "dismiss", "hide", "restore", "suspend", "unsuspend":
	default:
		return Report{}, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Report{}, fmt.Errorf("begin moderation decision: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	role, err := staffRole(ctx, tx, actorID)
	if err != nil {
		return Report{}, err
	}
	if role == "" {
		return Report{}, ErrForbidden
	}
	report, err := scanReport(tx.QueryRowContext(ctx, `SELECT `+reportColumns+` FROM moderation_reports WHERE id=$1 FOR UPDATE`, reportID))
	if errors.Is(err, sql.ErrNoRows) {
		return Report{}, ErrNotFound
	}
	if err != nil {
		return Report{}, fmt.Errorf("lock moderation report: %w", err)
	}
	if report.Version != input.Version {
		return Report{}, ErrConflict
	}
	previous, next, err := applyAction(ctx, tx, actorID, role, report.TargetType, report.TargetID, input.Action, s.now())
	if err != nil {
		return Report{}, err
	}
	status := "reviewed"
	if input.Action == "dismiss" {
		status = "dismissed"
	}
	report, err = scanReport(tx.QueryRowContext(ctx, `
		UPDATE moderation_reports
		SET status=$2, version=version+1, reviewed_by_user_id=$3, reviewed_at=$4
		WHERE id=$1 RETURNING `+reportColumns,
		reportID, status, actorID, s.now()))
	if err != nil {
		return Report{}, fmt.Errorf("update moderation report: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO moderation_actions(report_id,actor_user_id,target_type,target_id,action,reason,previous_state,next_state)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, reportID, actorID, report.TargetType, report.TargetID,
		input.Action, input.Reason, previous, next); err != nil {
		return Report{}, fmt.Errorf("audit moderation decision: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Report{}, fmt.Errorf("commit moderation decision: %w", err)
	}
	if report.TargetType == TargetPost && (input.Action == "hide" || input.Action == "restore") {
		if publisher, ok := s.publisher.(interface{ Broadcast(string) }); ok {
			publisher.Broadcast("post.updated")
		}
	}
	return report, nil
}

type txQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func staffRole(ctx context.Context, tx txQueryer, actorID int64) (string, error) {
	var role string
	err := tx.QueryRowContext(ctx, `
		SELECT role.role FROM user_roles role JOIN users account ON account.id=role.user_id
		WHERE role.user_id=$1 AND account.moderation_suspended_at IS NULL
			AND EXISTS(SELECT 1 FROM user_identities identity WHERE identity.user_id=role.user_id
				AND identity.provider='max' AND identity.status='verified')
		ORDER BY (role.role='administrator') DESC LIMIT 1`, actorID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("check moderation staff role: %w", err)
	}
	return role, nil
}

func applyAction(ctx context.Context, tx txQueryer, actorID int64, role string, targetType TargetType, targetID int64, action string, now any) (string, string, error) {
	if action == "dismiss" {
		return "unchanged", "unchanged", nil
	}
	if targetType == TargetUser {
		if action != "suspend" && action != "unsuspend" {
			return "", "", ErrInvalid
		}
		if actorID == targetID {
			return "", "", ErrForbidden
		}
		var suspended, staff bool
		err := tx.QueryRowContext(ctx, `
			SELECT moderation_suspended_at IS NOT NULL,
				EXISTS(SELECT 1 FROM user_roles WHERE user_id=$1)
			FROM users WHERE id=$1 FOR UPDATE`, targetID).Scan(&suspended, &staff)
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", ErrNotFound
		}
		if err != nil {
			return "", "", fmt.Errorf("lock moderated user: %w", err)
		}
		if staff || role != "administrator" {
			return "", "", ErrForbidden
		}
		previous := "active"
		if suspended {
			previous = "suspended"
		}
		next := "active"
		if action == "suspend" {
			next = "suspended"
		}
		if next == previous {
			return "", "", ErrConflict
		}
		if action == "suspend" {
			if _, err := tx.ExecContext(ctx, `UPDATE users SET moderation_suspended_at=$2 WHERE id=$1`, targetID, now); err != nil {
				return "", "", fmt.Errorf("suspend moderated user: %w", err)
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM auth_sessions WHERE user_id=$1`, targetID); err != nil {
				return "", "", fmt.Errorf("revoke suspended user sessions: %w", err)
			}
		} else if _, err := tx.ExecContext(ctx, `UPDATE users SET moderation_suspended_at=NULL WHERE id=$1`, targetID); err != nil {
			return "", "", fmt.Errorf("unsuspend moderated user: %w", err)
		}
		return previous, next, nil
	}
	if action != "hide" && action != "restore" {
		return "", "", ErrInvalid
	}
	var table string
	switch targetType {
	case TargetPost:
		table = "posts"
	case TargetComment:
		table = "post_comments"
	case TargetEvent:
		table = "events"
	default:
		return "", "", ErrInvalid
	}
	var hidden bool
	err := tx.QueryRowContext(ctx, `SELECT moderation_hidden_at IS NOT NULL FROM `+table+` WHERE id=$1 FOR UPDATE`, targetID).Scan(&hidden)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", ErrNotFound
	}
	if err != nil {
		return "", "", fmt.Errorf("lock moderated content: %w", err)
	}
	previous := "visible"
	if hidden {
		previous = "hidden"
	}
	next := "visible"
	if action == "hide" {
		next = "hidden"
	}
	if next == previous {
		return "", "", ErrConflict
	}
	var value any
	if action == "hide" {
		value = now
	}
	if _, err := tx.ExecContext(ctx, `UPDATE `+table+` SET moderation_hidden_at=$2 WHERE id=$1`, targetID, value); err != nil {
		return "", "", fmt.Errorf("change moderated content: %w", err)
	}
	if targetType == TargetPost && action == "restore" {
		// A human restore overrides the current AI restriction for this exact
		// analysis result. EnqueuePost replaces result on the next edit/recheck,
		// so the override cannot silently survive new content.
		changed, err := tx.ExecContext(ctx, `
			UPDATE post_analysis_jobs
			SET result=jsonb_set(COALESCE(result,'{}'::jsonb),'{moderation_override}',to_jsonb('restore'::text),true),
				updated_at=now()
			WHERE post_id=$1
			  AND (
				state IN ('blocked','review')
				OR COALESCE(result->'block_labels','[]'::jsonb)<>'[]'::jsonb
				OR COALESCE(result->'review_labels','[]'::jsonb)<>'[]'::jsonb
			  )`, targetID)
		if err != nil {
			return "", "", fmt.Errorf("record restored post override: %w", err)
		}
		if affected, rowsErr := changed.RowsAffected(); rowsErr != nil {
			return "", "", fmt.Errorf("check restored post override: %w", rowsErr)
		} else if affected > 0 {
			// Rebuild the 18+ label from deterministic text only. This removes a
			// stale image-model age label after a moderator has explicitly restored
			// the post, while real profanity still keeps the author/reader 18+ rule.
			var caption string
			if err := tx.QueryRowContext(ctx, `SELECT caption FROM posts WHERE id=$1`, targetID).Scan(&caption); err != nil {
				return "", "", fmt.Errorf("read restored post caption: %w", err)
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE posts SET adult_only=$2,age_classified=true WHERE id=$1`,
				targetID, contentpolicy.SensitiveLanguage(caption)); err != nil {
				return "", "", fmt.Errorf("reclassify restored post age: %w", err)
			}
		}
	}
	if targetType == TargetComment && action == "hide" {

		key := fmt.Sprintf("post_comment:%d", targetID)
		if _, err := tx.ExecContext(ctx, `DELETE FROM background_jobs WHERE dedupe_key=$1`, key); err != nil {
			return "", "", fmt.Errorf("remove hidden comment notification job: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM notifications WHERE dedupe_key=$1`, key); err != nil {
			return "", "", fmt.Errorf("remove hidden comment notification: %w", err)
		}
	}
	return previous, next, nil
}

const actionColumns = `id,report_id,actor_user_id,target_type,target_id,action,reason,previous_state,next_state,created_at`

func (s *Service) ListActions(ctx context.Context, beforeID int64, limit int) ([]Action, *int64, error) {
	if beforeID < 0 || limit < 1 || limit > 100 {
		return nil, nil, ErrInvalid
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+actionColumns+` FROM moderation_actions
		WHERE ($1::bigint=0 OR id<$1) ORDER BY id DESC LIMIT $2`, beforeID, limit+1)
	if err != nil {
		return nil, nil, fmt.Errorf("list moderation actions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := make([]Action, 0, limit)
	for rows.Next() {
		var item Action
		var reportID sql.NullInt64
		if err := rows.Scan(&item.ID, &reportID, &item.ActorUserID, &item.TargetType, &item.TargetID,
			&item.Action, &item.Reason, &item.PreviousState, &item.NextState, &item.CreatedAt); err != nil {
			return nil, nil, fmt.Errorf("scan moderation action: %w", err)
		}
		if reportID.Valid {
			item.ReportID = &reportID.Int64
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate moderation actions: %w", err)
	}
	if len(items) > limit {
		items = items[:limit]
		cursor := items[len(items)-1].ID
		return items, &cursor, nil
	}
	return items, nil, nil
}
