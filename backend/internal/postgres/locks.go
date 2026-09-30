package postgres

import (
	"context"
	"database/sql"
)

type LockScope int32

const (
	ReportLock         LockScope = 68132811
	ModeratorLoginLock LockScope = 68132812
	IdentityLock       LockScope = 68132813
	RoleChangeLock     int64     = 68132810
	migrationLock      int64     = 70618231
)

func LockRow(ctx context.Context, tx *sql.Tx, scope LockScope, id int64) error {
	_, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1::int, ($2::bigint % 2147483647::bigint)::int)`, scope, id)
	return err
}

func LockGlobal(ctx context.Context, tx *sql.Tx, key int64) error {
	_, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1::bigint)`, key)
	return err
}
