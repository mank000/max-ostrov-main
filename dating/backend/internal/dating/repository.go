package dating

import "context"

type Repository interface {
	Session(context.Context, int64) (User, *Profile, *Profile, error)
	GetProfile(context.Context, int64) (*Profile, error)
	SaveSettings(context.Context, int64, Settings) (Profile, error)
	Discover(context.Context, int64) ([]Profile, error)
	Swipe(context.Context, int64, SwipeInput) (bool, int64, error)
	Matches(context.Context, int64) ([]Match, error)
	MatchOther(context.Context, int64, int64) (int64, error)
	MatchSourceIDs(context.Context, int64) (int64, int64, error)
	Block(context.Context, int64, int64) error
	Report(context.Context, int64, ReportInput) error
	DeleteUser(context.Context, int64) error
}
