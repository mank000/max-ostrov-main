package moderation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"kutezh/backend/internal/postgres"
	"strings"
	"unicode/utf8"
)

type StaffMember struct {
	UserID      int64    `json:"user_id"`
	MAXUserID   int64    `json:"max_user_id"`
	DisplayName string   `json:"display_name"`
	Roles       []string `json:"roles"`
}

func (s *Service) ListRoles(ctx context.Context) ([]StaffMember, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT account.id, identity.provider_user_id,
		account.display_name, jsonb_agg(role.role ORDER BY role.role)
		FROM user_roles role JOIN users account ON account.id=role.user_id
		JOIN user_identities identity ON identity.user_id=account.id
			AND identity.provider='max' AND identity.status='verified'
		WHERE account.moderation_suspended_at IS NULL
		GROUP BY account.id, identity.provider_user_id
		ORDER BY lower(account.display_name), account.id`)
	if err != nil {
		return nil, fmt.Errorf("list moderator roles: %w", err)
	}
	defer func() { _ = rows.Close() }()
	members := []StaffMember{}
	for rows.Next() {
		var member StaffMember
		var rolesJSON []byte
		if err := rows.Scan(&member.UserID, &member.MAXUserID, &member.DisplayName, &rolesJSON); err != nil {
			return nil, fmt.Errorf("scan moderator role: %w", err)
		}
		if err := json.Unmarshal(rolesJSON, &member.Roles); err != nil {
			return nil, fmt.Errorf("decode moderator roles: %w", err)
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate moderator roles: %w", err)
	}
	return members, nil
}

func (s *Service) ChangeRole(ctx context.Context, actorID, maxUserID int64, role, operation, reason string) (int64, error) {
	reason = strings.TrimSpace(reason)
	if maxUserID <= 0 || (role != "moderator" && role != "administrator") ||
		(operation != "grant" && operation != "revoke") ||
		utf8.RuneCountInString(reason) < 8 || utf8.RuneCountInString(reason) > 500 {
		return 0, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin moderator role change: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if actorID > 0 {
		actorRole, err := staffRole(ctx, tx, actorID)
		if err != nil {
			return 0, err
		}
		if actorRole != "administrator" {
			return 0, ErrForbidden
		}
	}
	var subjectID int64
	err = tx.QueryRowContext(ctx, `
		SELECT identity.user_id FROM user_identities identity
		JOIN users account ON account.id=identity.user_id
		WHERE identity.provider='max' AND identity.provider_user_id=$1
			AND identity.status='verified' AND account.moderation_suspended_at IS NULL
		FOR SHARE OF identity, account`, maxUserID).Scan(&subjectID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("resolve verified moderator identity: %w", err)
	}
	if operation == "grant" {
		result, err := tx.ExecContext(ctx, `INSERT INTO user_roles(user_id,role) VALUES($1,$2)
			ON CONFLICT DO NOTHING`, subjectID, role)
		if err != nil {
			return 0, fmt.Errorf("grant moderator role: %w", err)
		}
		count, _ := result.RowsAffected()
		if count == 0 {
			return 0, ErrConflict
		}
	} else {
		if role == "administrator" {

			if err := postgres.LockGlobal(ctx, tx, postgres.RoleChangeLock); err != nil {
				return 0, fmt.Errorf("lock administrator roster: %w", err)
			}
			var admins int
			if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM user_roles role
				JOIN users account ON account.id=role.user_id
				WHERE role.role='administrator' AND account.moderation_suspended_at IS NULL
					AND EXISTS(SELECT 1 FROM user_identities identity WHERE identity.user_id=role.user_id
						AND identity.provider='max' AND identity.status='verified')`).Scan(&admins); err != nil {
				return 0, fmt.Errorf("count administrators: %w", err)
			}
			if admins <= 1 {
				return 0, ErrConflict
			}
		}
		result, err := tx.ExecContext(ctx, `DELETE FROM user_roles WHERE user_id=$1 AND role=$2`, subjectID, role)
		if err != nil {
			return 0, fmt.Errorf("revoke moderator role: %w", err)
		}
		count, _ := result.RowsAffected()
		if count == 0 {
			return 0, ErrNotFound
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM moderation_sessions WHERE user_id=$1`, subjectID); err != nil {
			return 0, fmt.Errorf("revoke moderator sessions: %w", err)
		}
	}
	var actor any
	if actorID > 0 {
		actor = actorID
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO moderation_role_changes(actor_user_id,subject_user_id,role,operation,reason)
		VALUES($1,$2,$3,$4,$5)`, actor, subjectID, role, operation, reason); err != nil {
		return 0, fmt.Errorf("audit moderator role change: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit moderator role change: %w", err)
	}
	return subjectID, nil
}
