package rewards

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

func CreditDinoCoin(ctx context.Context, tx *sql.Tx, userID int64, runID string, coin int, now time.Time) (int, error) {
	referenceID := fmt.Sprintf("%s:coin:%d", runID, coin)
	return creditGameCoins(ctx, tx, userID, 1, "Монета в Дино-рывке", referenceID, "game:dino:"+referenceID, now)
}

func CreditDinoBoss(ctx context.Context, tx *sql.Tx, userID int64, runID string, event int, now time.Time) (int, error) {
	referenceID := fmt.Sprintf("%s:boss:%d", runID, event)
	return creditGameCoins(ctx, tx, userID, 3, "Победа над боссом в Дино-рывке", referenceID, "game:dino:"+referenceID, now)
}
