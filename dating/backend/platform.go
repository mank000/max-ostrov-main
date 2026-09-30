// Package dating exposes the domain and API for the shared platform.
package dating

import (
	domain "kutezh/dating/internal/dating"
	"kutezh/dating/internal/httpapi"
	"log/slog"
	"net/http"
)

type Profile = domain.Profile
type Settings = domain.Settings
type User = domain.User
type Match = domain.Match
type WeeklyStats = domain.WeeklyStats
type SwipeInput = domain.SwipeInput
type ReportInput = domain.ReportInput
type ChatTarget = domain.ChatTarget
type Repository = domain.Repository
type Config = domain.Config
type Service = domain.Service
type ServiceError = domain.ServiceError

var ErrNotFound = domain.ErrNotFound
var ErrForbidden = domain.ErrForbidden
var ErrInvalid = domain.ErrInvalid
var ErrConflict = domain.ErrConflict
var ErrProfileNeeded = domain.ErrProfileNeeded
var NewService = domain.NewService

func NewHandler(logger *slog.Logger, service *Service, resolve func(http.ResponseWriter, *http.Request) (int64, bool)) http.Handler {
	return httpapi.NewAuthenticatedHandler(logger, service, resolve)
}
