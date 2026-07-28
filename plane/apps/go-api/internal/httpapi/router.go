package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

type ReadinessChecker interface {
	PingContext(context.Context) error
}

type Dependencies struct {
	Readiness ReadinessChecker
	Legacy    http.Handler
	Instance  http.Handler
	Version   string
}

func NewRouter(deps Dependencies) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "plane-go-api", "version": deps.Version})
	})
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		if deps.Readiness == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := deps.Readiness.PingContext(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready", "error": "postgres unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})
	mux.HandleFunc("GET /api/go/migration-status", func(w http.ResponseWriter, _ *http.Request) {
		portedGroups := []string{"health"}
		if deps.Instance != nil {
			portedGroups = append(portedGroups, "instance-info-cache")
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"service": "plane-go-api", "phase": "foundation",
			"legacy_fallback": deps.Legacy != nil, "ported_groups": portedGroups,
		})
	})
	if deps.Instance != nil {
		mux.Handle("GET /api/instances/", deps.Instance)
	}
	if deps.Legacy != nil {
		mux.Handle("/", deps.Legacy)
	} else {
		mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "route not migrated"})
		})
	}
	return requestID(mux)
}

func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Request-ID") == "" {
			r.Header.Set("X-Request-ID", time.Now().UTC().Format("20060102T150405.000000000"))
		}
		w.Header().Set("X-Plane-Backend", "go")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
