package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"
)

// Сначала снимаем фоновые задачи, затем ждём HTTP и освобождение их соединений.
func serve(ctx, workerCtx context.Context, stopWorkers context.CancelFunc, server *http.Server, background []func(context.Context), timeout time.Duration, logger *slog.Logger) error {
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}

	var workers sync.WaitGroup
	for _, work := range background {
		workers.Add(1)
		go func() {
			defer workers.Done()
			work(workerCtx)
		}()
	}
	workersDone := make(chan struct{})
	go func() {
		workers.Wait()
		close(workersDone)
	}()

	serverDone := make(chan error, 1)
	go func() {
		serverDone <- server.Serve(listener)
	}()
	logger.Info("HTTP server started", "address", listener.Addr().String())

	var serverErr error
	select {
	case serverErr = <-serverDone:
		if errors.Is(serverErr, http.ErrServerClosed) {
			serverErr = nil
		}
	case <-ctx.Done():
		logger.Info("shutdown signal received")
	}
	stopWorkers()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	shutdownErr := server.Shutdown(shutdownCtx)
	if shutdownErr != nil {
		shutdownErr = errors.Join(shutdownErr, server.Close())
	}
	var workerErr error
	select {
	case <-workersDone:
	case <-shutdownCtx.Done():
		workerErr = fmt.Errorf("stop workers: %w", shutdownCtx.Err())
	}
	if err := errors.Join(serverErr, shutdownErr, workerErr); err != nil {
		return err
	}
	logger.Info("HTTP server stopped")
	return nil
}
