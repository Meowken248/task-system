package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type ReadinessChecker interface {
	PingContext(context.Context) error
}

type Dependencies struct {
	Readiness       ReadinessChecker
	Legacy          http.Handler
	Instance        http.Handler
	CSRF            http.Handler
	SignOut         http.Handler
	SignIn          http.Handler
	SignUp          http.Handler
	EmailCheck      http.Handler
	ForgotPassword  http.Handler
	ResetPassword   http.Handler
	ChangePassword  http.Handler
	SetPassword     http.Handler
	Tracking        http.Handler
	Workspaces      http.Handler
	CurrentUser     http.Handler
	UserProfile     http.Handler
	UserSettings    http.Handler
	ProjectsLite    http.Handler
	Projects        http.Handler
	Project         http.Handler
	States          http.Handler
	ProjectMembers  http.Handler
	ProjectMemberMe http.Handler
	Labels          http.Handler
	Issues          http.Handler
	Version         string
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
		if deps.CSRF != nil {
			portedGroups = append(portedGroups, "csrf")
		}
		if deps.SignOut != nil {
			portedGroups = append(portedGroups, "sign-out")
		}
		if deps.SignIn != nil {
			portedGroups = append(portedGroups, "email-sign-in")
		}
		if deps.SignUp != nil {
			portedGroups = append(portedGroups, "email-sign-up")
		}
		if deps.EmailCheck != nil {
			portedGroups = append(portedGroups, "email-check")
		}
		if deps.ForgotPassword != nil {
			portedGroups = append(portedGroups, "forgot-password")
		}
		if deps.ResetPassword != nil {
			portedGroups = append(portedGroups, "reset-password")
		}
		if deps.ChangePassword != nil && deps.SetPassword != nil {
			portedGroups = append(portedGroups, "password-management")
		}
		if deps.Tracking != nil {
			portedGroups = append(portedGroups, "blockchain-receipt-verification", "blockchain-tracking", "blockchain-json-import")
		}
		if deps.Workspaces != nil {
			portedGroups = append(portedGroups, "user-workspaces")
		}
		if deps.CurrentUser != nil {
			portedGroups = append(portedGroups, "current-user")
		}
		if deps.UserProfile != nil && deps.UserSettings != nil {
			portedGroups = append(portedGroups, "user-profile-settings")
		}
		if deps.ProjectsLite != nil && deps.Projects != nil && deps.Project != nil {
			portedGroups = append(portedGroups, "project-reads")
		}
		if deps.States != nil {
			portedGroups = append(portedGroups, "project-state-reads")
		}
		if deps.ProjectMembers != nil || deps.ProjectMemberMe != nil {
			portedGroups = append(portedGroups, "project-member-reads")
		}
		if deps.Labels != nil {
			portedGroups = append(portedGroups, "project-label-reads")
		}
		if deps.Issues != nil {
			portedGroups = append(portedGroups, "basic-work-item-reads", "basic-work-item-writes")
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"service": "plane-go-api", "phase": "incremental-migration",
			"legacy_fallback": deps.Legacy != nil, "ported_groups": portedGroups,
		})
	})
	if deps.Instance != nil {
		mux.Handle("GET /api/instances/", deps.Instance)
	}
	if deps.CSRF != nil {
		mux.Handle("GET /auth/get-csrf-token/", deps.CSRF)
	}
	if deps.SignOut != nil {
		mux.Handle("POST /auth/sign-out/", deps.SignOut)
	}
	if deps.SignIn != nil {
		mux.Handle("POST /auth/sign-in/", deps.SignIn)
	}
	if deps.SignUp != nil {
		mux.Handle("POST /auth/sign-up/", deps.SignUp)
	}
	if deps.EmailCheck != nil {
		mux.Handle("POST /auth/email-check/", deps.EmailCheck)
	}
	if deps.ForgotPassword != nil {
		mux.Handle("POST /auth/forgot-password/", deps.ForgotPassword)
	}
	if deps.ResetPassword != nil {
		mux.Handle("POST /auth/reset-password/{uidb64}/{token}/", deps.ResetPassword)
	}
	if deps.ChangePassword != nil {
		mux.Handle("POST /auth/change-password/", deps.ChangePassword)
	}
	if deps.SetPassword != nil {
		mux.Handle("POST /auth/set-password/", deps.SetPassword)
	}
	if deps.Workspaces != nil {
		mux.Handle("GET /api/users/me/workspaces/", deps.Workspaces)
	}
	if deps.CurrentUser != nil {
		mux.Handle("GET /api/users/me/", deps.CurrentUser)
	}
	if deps.UserProfile != nil {
		mux.Handle("GET /api/users/me/profile/", deps.UserProfile)
	}
	if deps.UserSettings != nil {
		mux.Handle("GET /api/users/me/settings/", deps.UserSettings)
	}
	if deps.ProjectsLite != nil {
		mux.Handle("GET /api/workspaces/{slug}/projects/{$}", deps.ProjectsLite)
	}
	if deps.Projects != nil || deps.Project != nil || deps.States != nil || deps.ProjectMembers != nil || deps.ProjectMemberMe != nil || deps.Labels != nil || deps.Issues != nil || deps.Tracking != nil {
		mux.Handle("/api/workspaces/{slug}/projects/{tail...}", projectRoutes{deps: deps})
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

type projectRoutes struct {
	deps Dependencies
}

func (h projectRoutes) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	tail := strings.Trim(r.PathValue("tail"), "/")
	parts := strings.Split(tail, "/")
	if r.Method == http.MethodGet && tail == "details" && h.deps.Projects != nil {
		h.deps.Projects.ServeHTTP(w, r)
		return
	}
	if len(parts) == 1 && parts[0] != "" && r.Method == http.MethodGet && h.deps.Project != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.Project.ServeHTTP(w, r)
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "states" &&
		r.Method == http.MethodGet && h.deps.States != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.States.ServeHTTP(w, r)
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "members" &&
		r.Method == http.MethodGet && h.deps.ProjectMembers != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.ProjectMembers.ServeHTTP(w, r)
		return
	}
	if len(parts) == 3 && parts[0] != "" && parts[1] == "project-members" && parts[2] == "me" &&
		r.Method == http.MethodGet && h.deps.ProjectMemberMe != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.ProjectMemberMe.ServeHTTP(w, r)
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "issue-labels" &&
		r.Method == http.MethodGet && h.deps.Labels != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.Labels.ServeHTTP(w, r)
		return
	}
	if len(parts) == 3 && parts[0] != "" && parts[1] == "issue-labels" && parts[2] != "" &&
		r.Method == http.MethodGet && h.deps.Labels != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("label_id", parts[2])
		h.deps.Labels.ServeHTTP(w, r)
		return
	}
	if len(parts) == 3 && parts[0] != "" && parts[1] == "states" && parts[2] != "" &&
		r.Method == http.MethodGet && h.deps.States != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("state_id", parts[2])
		h.deps.States.ServeHTTP(w, r)
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "issues" && h.deps.Issues != nil &&
		((r.Method == http.MethodGet && canServeBasicIssueRead(r)) || r.Method == http.MethodPost) {
		r.SetPathValue("project_id", parts[0])
		h.deps.Issues.ServeHTTP(w, r)
		return
	}
	if len(parts) == 3 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && h.deps.Issues != nil &&
		((r.Method == http.MethodGet && canServeBasicIssueRead(r)) || r.Method == http.MethodPatch || r.Method == http.MethodDelete) {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		h.deps.Issues.ServeHTTP(w, r)
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "blockchain-transactions" &&
		(r.Method == http.MethodGet || r.Method == http.MethodPost) && h.deps.Tracking != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.Tracking.ServeHTTP(w, r)
		return
	}
	if h.deps.Legacy != nil {
		h.deps.Legacy.ServeHTTP(w, r)
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "route not migrated"})
}

// The legacy API still owns grouped, filtered and expanded work-item reads. Keeping
// this gate explicit prevents a partial Go response from silently breaking clients.
func canServeBasicIssueRead(r *http.Request) bool {
	for key, values := range r.URL.Query() {
		switch key {
		case "cursor", "per_page":
		case "order_by":
			if len(values) != 1 || (values[0] != "-created_at" && values[0] != "created_at") {
				return false
			}
		default:
			return false
		}
	}
	return true
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
