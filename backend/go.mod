module kutezh/backend

go 1.27.0

require (
	github.com/jackc/pgx/v5 v5.11.0
	github.com/max-messenger/max-bot-api-client-go/v2 v2.4.0
)

require (
	github.com/jackc/pgpassfile v1.0.0
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761
	github.com/jackc/puddle/v2 v2.2.2
	golang.org/x/sync v0.21.0
	golang.org/x/text v0.39.0
)

require kutezh/dating v0.0.0

replace kutezh/dating => ../dating/backend
