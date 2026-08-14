package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/makeplane/plane/apps/go-api/internal/legacy"
)

type ReadinessChecker interface {
	PingContext(context.Context) error
}

type Dependencies struct {
	Readiness                ReadinessChecker
	CSRF                     http.Handler
	SignOut                  http.Handler
	SignIn                   http.Handler
	SignUp                   http.Handler
	EmailCheck               http.Handler
	ForgotPassword           http.Handler
	ResetPassword            http.Handler
	ChangePassword           http.Handler
	SetPassword              http.Handler
	Tracking                 http.Handler
	Workspaces               http.Handler
	WorkspaceMemberMe        http.Handler
	WorkspaceMembers         http.Handler
	WorkspaceViews           http.Handler
	WorkspaceLeave           http.Handler
	WorkspaceInvitations     http.Handler
	WorkspaceInvitationJoin  http.Handler
	UserWorkspaceInvitations http.Handler
	APITokens                http.Handler
	Webhooks                 http.Handler
	RecentVisits             http.Handler
	SidebarPreferences       http.Handler
	WorkspaceThemes          http.Handler
	WorkspaceHomePreferences http.Handler
	WorkspaceUserLinks       http.Handler
	ProjectIdentifiers       http.Handler
	UserProperties           http.Handler
	ProjectUserProperties    http.Handler
	CycleUserProperties      http.Handler
	ModuleUserProperties     http.Handler
	CurrentUser              http.Handler
	UserProfile              http.Handler
	UserSettings             http.Handler
	ProjectsLite             http.Handler
	Projects                 http.Handler
	Project                  http.Handler
	States                   http.Handler
	ProjectMembers           http.Handler
	ProjectMembersLeave      http.Handler
	ProjectMemberMe          http.Handler
	WorkspaceProjectMembers  http.Handler
	ProjectUserViews         http.Handler
	ProjectDeployBoards      http.Handler
	Labels                   http.Handler
	Issues                   http.Handler
	Comments                 http.Handler
	Activities               http.Handler
	Relations                http.Handler
	Links                    http.Handler
	Reactions                http.Handler
	Subscribers              http.Handler
	Archives                 http.Handler
	Subissues                http.Handler
	Favorites                http.Handler
	ProjectFavoriteCycles    http.Handler
	ProjectFavoriteModules   http.Handler
	ProjectFavoriteViews     http.Handler
	Stickies                 http.Handler
	Cycles                   http.Handler
	CycleIssues              http.Handler
	Modules                  http.Handler
	ModuleIssues             http.Handler
	Dashboard                http.Handler
	RecentVisit              http.Handler
	Views                    http.Handler
	CommentReactions         http.Handler
	Assets                   http.Handler
	Notification             http.Handler
	Estimate                 http.Handler
	Search                   http.Handler
	Analytic                 http.Handler
	ProjectStats             http.Handler
	Instances                http.Handler
	Intake                   http.Handler
	Timezones                http.Handler
	Unsplash                 http.Handler
	WorkspaceSlugCheck       http.Handler
	Pages                    http.Handler
	DraftIssues              http.Handler
	Version                  string
	LegacyAPIURL             string
	GoWorkersEnabled         bool
	BlockchainMode           string
	BlockchainVerifier       interface{} // typically *blockchain.Verifier or similar
}

func NewRouter(deps Dependencies) http.Handler {
	var proxy http.Handler
	if deps.LegacyAPIURL != "" {
		var err error
		proxy, err = legacy.NewProxy(deps.LegacyAPIURL)
		if err != nil {
			// If proxy fails to parse/build, we crash on startup rather than fail on every request
			panic("invalid LEGACY_API_URL: " + err.Error())
		}
	}

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

		response := map[string]string{"status": "ready"}
		if deps.BlockchainMode == "online" {
			response["blockchain_mode"] = "online"
			if deps.BlockchainVerifier == nil {
				response["status"] = "not_ready"
				response["blockchain"] = "degraded"
				response["blockchain_error"] = "verifier not initialized (missing RPC URL or contract address?)"
				writeJSON(w, http.StatusServiceUnavailable, response)
				return
			}

			// Use a shorter timeout just for the RPC ping
			pingCtx, pingCancel := context.WithTimeout(r.Context(), 1*time.Second)
			defer pingCancel()
			if pinger, ok := deps.BlockchainVerifier.(interface{ PingContext(context.Context) error }); ok {
				if err := pinger.PingContext(pingCtx); err != nil {
					response["status"] = "not_ready"
					response["blockchain"] = "degraded"
					response["blockchain_error"] = "verifier ping failed: " + err.Error()
					writeJSON(w, http.StatusServiceUnavailable, response)
					return
				}
			}
		} else if deps.BlockchainMode != "" {
			response["blockchain_mode"] = deps.BlockchainMode
		}

		writeJSON(w, http.StatusOK, response)
	})
	mux.HandleFunc("GET /api/go/migration-status", func(w http.ResponseWriter, _ *http.Request) {
		portedGroups := []string{"health"}
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
		if deps.WorkspaceMemberMe != nil && deps.RecentVisits != nil && deps.SidebarPreferences != nil && deps.UserProperties != nil {
			portedGroups = append(portedGroups, "workspace-bootstrap-preferences")
		}
		if deps.WorkspaceUserLinks != nil {
			portedGroups = append(portedGroups, "workspace-user-links")
		}
		if deps.ProjectIdentifiers != nil {
			portedGroups = append(portedGroups, "project-identifiers")
		}
		if deps.ProjectUserProperties != nil && deps.CycleUserProperties != nil && deps.ModuleUserProperties != nil {
			portedGroups = append(portedGroups, "project-cycle-module-user-properties")
		}
		if deps.WorkspaceMembers != nil && deps.WorkspaceLeave != nil {
			portedGroups = append(portedGroups, "workspace-member-management")
		}
		if deps.WorkspaceInvitations != nil && deps.WorkspaceInvitationJoin != nil && deps.UserWorkspaceInvitations != nil {
			portedGroups = append(portedGroups, "workspace-invitations")
		}
		if deps.APITokens != nil {
			portedGroups = append(portedGroups, "api-tokens")
		}
		if deps.Webhooks != nil {
			portedGroups = append(portedGroups, "workspace-webhooks")
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
		if deps.Comments != nil {
			portedGroups = append(portedGroups, "issue-comments")
		}
		if deps.Activities != nil {
			portedGroups = append(portedGroups, "issue-activity-history")
		}
		if deps.Relations != nil {
			portedGroups = append(portedGroups, "issue-relations")
		}
		if deps.Links != nil {
			portedGroups = append(portedGroups, "issue-links")
		}
		if deps.Reactions != nil {
			portedGroups = append(portedGroups, "issue-reactions")
		}
		if deps.Subscribers != nil {
			portedGroups = append(portedGroups, "issue-subscribers")
		}
		if deps.Archives != nil {
			portedGroups = append(portedGroups, "issue-archives")
		}
		if deps.Subissues != nil {
			portedGroups = append(portedGroups, "sub-issues")
		}
		if deps.Projects != nil {
			portedGroups = append(portedGroups, "project-mutations")
		}
		if deps.Favorites != nil {
			portedGroups = append(portedGroups, "user-favorites")
		}
		if deps.ProjectFavoriteCycles != nil {
			portedGroups = append(portedGroups, "user-favorite-cycle")
		}
		if deps.ProjectFavoriteModules != nil {
			portedGroups = append(portedGroups, "user-favorite-module")
		}
		if deps.ProjectFavoriteViews != nil {
			portedGroups = append(portedGroups, "user-favorite-view")
		}
		if deps.Stickies != nil {
			portedGroups = append(portedGroups, "workspace-stickies")
		}
		if deps.Workspaces != nil {
			portedGroups = append(portedGroups, "workspace-mutations")
		}
		if deps.Search != nil {
			portedGroups = append(portedGroups, "workspace-search")
		}
		if deps.Analytic != nil {
			portedGroups = append(portedGroups, "workspace-analytics")
		}
		if deps.Estimate != nil {
			portedGroups = append(portedGroups, "workspace-estimates", "project-estimates")
		}
		if deps.Intake != nil {
			portedGroups = append(portedGroups, "project-intake-reads")
		}
		if deps.Notification != nil {
			portedGroups = append(portedGroups, "workspace-notifications")
		}
		if deps.Timezones != nil {
			portedGroups = append(portedGroups, "timezones")
		}
		if deps.Unsplash != nil {
			portedGroups = append(portedGroups, "unsplash")
		}
		if deps.Pages != nil {
			portedGroups = append(portedGroups, "project-pages")
		}
		if deps.Instances != nil {
			portedGroups = append(portedGroups, "instances")
		}
		if deps.WorkspaceSlugCheck != nil {
			portedGroups = append(portedGroups, "workspace-slug-check")
		}
		if deps.DraftIssues != nil {
			portedGroups = append(portedGroups, "draft-issues")
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"service":            "plane-go-api",
			"phase":              "incremental-migration",
			"legacy_fallback":    deps.LegacyAPIURL != "",
			"go_workers_enabled": deps.GoWorkersEnabled,
			"ported_groups":      portedGroups,
		})
	})

	if deps.CSRF != nil {
		mux.Handle("GET /auth/get-csrf-token/", deps.CSRF)
	}
	if deps.Timezones != nil {
		mux.Handle("GET /api/timezones/", deps.Timezones)
	}
	if deps.Unsplash != nil {
		mux.Handle("GET /api/unsplash/", deps.Unsplash)
	}
	if deps.Instances != nil {
		mux.Handle("/api/instances/", deps.Instances)
	}
	if deps.WorkspaceSlugCheck != nil {
		mux.Handle("GET /api/workspace-slug-check/", deps.WorkspaceSlugCheck)
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
		mux.Handle("/api/workspaces/{$}", deps.Workspaces)
		mux.Handle("/api/workspaces/{slug}/{$}", deps.Workspaces)
		mux.Handle("GET /api/users/me/workspaces/", deps.Workspaces)
	}
	if deps.WorkspaceMemberMe != nil {
		mux.Handle("GET /api/workspaces/{slug}/workspace-members/me/", deps.WorkspaceMemberMe)
	}

	if deps.WorkspaceThemes != nil {
		mux.Handle("GET /api/workspaces/{slug}/workspace-themes/{theme_id}/", deps.WorkspaceThemes)
		mux.Handle("PATCH /api/workspaces/{slug}/workspace-themes/{theme_id}/", deps.WorkspaceThemes)
		mux.Handle("DELETE /api/workspaces/{slug}/workspace-themes/{theme_id}/", deps.WorkspaceThemes)
	}
	if deps.ProjectStats != nil {
		mux.Handle("GET /api/workspaces/{slug}/project-stats/", deps.ProjectStats)
	}
	if deps.ProjectIdentifiers != nil {
		mux.Handle("GET /api/workspaces/{slug}/project-identifiers/", deps.ProjectIdentifiers)
		mux.Handle("DELETE /api/workspaces/{slug}/project-identifiers/", deps.ProjectIdentifiers)
	}
	if deps.WorkspaceHomePreferences != nil {
		mux.Handle("GET /api/workspaces/{slug}/home-preferences/", deps.WorkspaceHomePreferences)
		mux.Handle("PATCH /api/workspaces/{slug}/home-preferences/{key}/", deps.WorkspaceHomePreferences)
	}
	if deps.WorkspaceUserLinks != nil {
		mux.Handle("GET /api/workspaces/{slug}/workspace-user-links/", deps.WorkspaceUserLinks)
		mux.Handle("POST /api/workspaces/{slug}/workspace-user-links/", deps.WorkspaceUserLinks)
		mux.Handle("PATCH /api/workspaces/{slug}/workspace-user-links/{id}/", deps.WorkspaceUserLinks)
		mux.Handle("DELETE /api/workspaces/{slug}/workspace-user-links/{id}/", deps.WorkspaceUserLinks)
	}

	if deps.WorkspaceMembers != nil {
		mux.Handle("GET /api/workspaces/{slug}/members/", deps.WorkspaceMembers)
		mux.Handle("GET /api/workspaces/{slug}/members/{member_id}/", deps.WorkspaceMembers)
		mux.Handle("PATCH /api/workspaces/{slug}/members/{member_id}/", deps.WorkspaceMembers)
		mux.Handle("DELETE /api/workspaces/{slug}/members/{member_id}/", deps.WorkspaceMembers)
	}
	if deps.WorkspaceViews != nil {
		mux.Handle("POST /api/workspaces/{slug}/workspace-views/{$}", deps.WorkspaceViews)
	}
	if deps.WorkspaceProjectMembers != nil {
		mux.Handle("GET /api/workspaces/{slug}/project-members/", deps.WorkspaceProjectMembers)
	}
	if deps.WorkspaceLeave != nil {
		mux.Handle("POST /api/workspaces/{slug}/members/leave/", deps.WorkspaceLeave)
	}
	if deps.WorkspaceInvitations != nil {
		mux.Handle("GET /api/workspaces/{slug}/invitations/", deps.WorkspaceInvitations)
		mux.Handle("POST /api/workspaces/{slug}/invitations/", deps.WorkspaceInvitations)
		mux.Handle("GET /api/workspaces/{slug}/invitations/{invitation_id}/", deps.WorkspaceInvitations)
		mux.Handle("PATCH /api/workspaces/{slug}/invitations/{invitation_id}/", deps.WorkspaceInvitations)
		mux.Handle("DELETE /api/workspaces/{slug}/invitations/{invitation_id}/", deps.WorkspaceInvitations)
	}
	if deps.WorkspaceInvitationJoin != nil {
		mux.Handle("GET /api/workspaces/{slug}/invitations/{invitation_id}/join/", deps.WorkspaceInvitationJoin)
		mux.Handle("POST /api/workspaces/{slug}/invitations/{invitation_id}/join/", deps.WorkspaceInvitationJoin)
	}
	if deps.UserWorkspaceInvitations != nil {
		mux.Handle("GET /api/users/me/workspaces/invitations/{$}", deps.UserWorkspaceInvitations)
		mux.Handle("POST /api/users/me/workspaces/invitations/{$}", deps.UserWorkspaceInvitations)
	}
	if deps.APITokens != nil {
		mux.Handle("GET /api/users/api-tokens/", deps.APITokens)
		mux.Handle("POST /api/users/api-tokens/", deps.APITokens)
		mux.Handle("GET /api/users/api-tokens/{token_id}/", deps.APITokens)
		mux.Handle("PATCH /api/users/api-tokens/{token_id}/", deps.APITokens)
		mux.Handle("DELETE /api/users/api-tokens/{token_id}/", deps.APITokens)
	}
	if deps.Webhooks != nil {
		mux.Handle("GET /api/workspaces/{slug}/webhooks/", deps.Webhooks)
		mux.Handle("POST /api/workspaces/{slug}/webhooks/", deps.Webhooks)
		mux.Handle("GET /api/workspaces/{slug}/webhooks/{pk}/", deps.Webhooks)
		mux.Handle("PATCH /api/workspaces/{slug}/webhooks/{pk}/", deps.Webhooks)
		mux.Handle("DELETE /api/workspaces/{slug}/webhooks/{pk}/", deps.Webhooks)
		mux.Handle("POST /api/workspaces/{slug}/webhooks/{pk}/regenerate/", deps.Webhooks)
		mux.Handle("GET /api/workspaces/{slug}/webhook-logs/{webhook_id}/", deps.Webhooks)
	}
	if deps.RecentVisits != nil {
		mux.Handle("GET /api/workspaces/{slug}/recent-visits/", deps.RecentVisits)
	}
	if deps.SidebarPreferences != nil {
		mux.Handle("GET /api/workspaces/{slug}/sidebar-preferences/", deps.SidebarPreferences)
		mux.Handle("PATCH /api/workspaces/{slug}/sidebar-preferences/", deps.SidebarPreferences)
		mux.Handle("PATCH /api/workspaces/{slug}/sidebar-preferences/{preference_key}/", deps.SidebarPreferences)
	}
	if deps.UserProperties != nil {
		mux.Handle("GET /api/workspaces/{slug}/user-properties/", deps.UserProperties)
		mux.Handle("PATCH /api/workspaces/{slug}/user-properties/", deps.UserProperties)
	}
	if deps.CurrentUser != nil {
		mux.Handle("GET /api/users/me/", deps.CurrentUser)
		mux.Handle("PATCH /api/users/me/", deps.CurrentUser)
	}
	if deps.UserProfile != nil {
		mux.Handle("GET /api/users/me/profile/", deps.UserProfile)
		mux.Handle("PATCH /api/users/me/profile/", deps.UserProfile)
	}
	if deps.UserSettings != nil {
		mux.Handle("GET /api/users/me/settings/", deps.UserSettings)
	}
	if deps.Search != nil {
		mux.Handle("GET /api/workspaces/{slug}/search/", deps.Search)
	}
	if deps.DraftIssues != nil {
		mux.Handle("/api/workspaces/{slug}/draft-issues/", deps.DraftIssues)
		mux.Handle("/api/workspaces/{slug}/draft-issues/{tail...}", deps.DraftIssues)
		mux.Handle("/api/workspaces/{slug}/draft-to-issue/", deps.DraftIssues)
		mux.Handle("/api/workspaces/{slug}/draft-to-issue/{tail...}", deps.DraftIssues)
	}
	if deps.Analytic != nil {
		mux.Handle("GET /api/workspaces/{slug}/analytics/", deps.Analytic)
	}
	if deps.Estimate != nil {
		mux.Handle("GET /api/workspaces/{slug}/estimates/", deps.Estimate)
	}
	if deps.Notification != nil {
		mux.Handle("/api/workspaces/{slug}/users/notifications", deps.Notification)
		mux.Handle("/api/workspaces/{slug}/users/notifications/{tail...}", deps.Notification)
	}
	if deps.ProjectsLite != nil {
		mux.Handle("GET /api/workspaces/{slug}/projects/{$}", deps.ProjectsLite)
	}
	if deps.Projects != nil {
		mux.Handle("POST /api/workspaces/{slug}/projects/{$}", deps.Projects)
	}
	if deps.Projects != nil || deps.Project != nil || deps.States != nil || deps.ProjectMembers != nil || deps.ProjectMembersLeave != nil || deps.ProjectMemberMe != nil || deps.ProjectUserViews != nil || deps.ProjectDeployBoards != nil || deps.Labels != nil || deps.Issues != nil || deps.Tracking != nil || deps.Comments != nil || deps.Activities != nil || deps.Relations != nil || deps.Links != nil || deps.Reactions != nil || deps.Subscribers != nil || deps.Archives != nil || deps.Subissues != nil || deps.Cycles != nil || deps.Modules != nil || deps.Views != nil || deps.CommentReactions != nil || deps.Estimate != nil || deps.Intake != nil || deps.ProjectUserProperties != nil || deps.CycleUserProperties != nil || deps.ModuleUserProperties != nil || deps.Pages != nil {
		mux.Handle("/api/workspaces/{slug}/projects/{tail...}", projectRoutes{deps: deps, proxy: proxy})
	}
	if deps.Dashboard != nil {
		mux.Handle("GET /api/users/me/workspaces/{slug}/dashboard/", deps.Dashboard)
	}
	if deps.RecentVisit != nil {
		mux.Handle("/api/workspaces/{slug}/workspace-views/recent-visits/", deps.RecentVisit)
	}
	if deps.Favorites != nil {
		mux.Handle("/api/workspaces/{slug}/user-favorites/{$}", deps.Favorites)
		mux.Handle("/api/workspaces/{slug}/user-favorites/{favorite_id}/{$}", deps.Favorites)
		mux.Handle("/api/workspaces/{slug}/user-favorites/{favorite_id}/group/{$}", deps.Favorites)
	}
	if deps.ProjectFavoriteCycles != nil {
		mux.Handle("/api/workspaces/{slug}/projects/{project_id}/user-favorite-cycles/{$}", deps.ProjectFavoriteCycles)
		mux.Handle("/api/workspaces/{slug}/projects/{project_id}/user-favorite-cycles/{cycle_id}/{$}", deps.ProjectFavoriteCycles)
	}
	if deps.ProjectFavoriteModules != nil {
		mux.Handle("/api/workspaces/{slug}/projects/{project_id}/user-favorite-modules/{$}", deps.ProjectFavoriteModules)
		mux.Handle("/api/workspaces/{slug}/projects/{project_id}/user-favorite-modules/{module_id}/{$}", deps.ProjectFavoriteModules)
	}
	if deps.ProjectFavoriteViews != nil {
		mux.Handle("/api/workspaces/{slug}/projects/{project_id}/user-favorite-views/{$}", deps.ProjectFavoriteViews)
		mux.Handle("/api/workspaces/{slug}/projects/{project_id}/user-favorite-views/{view_id}/{$}", deps.ProjectFavoriteViews)
	}
	if deps.Stickies != nil {
		mux.Handle("/api/workspaces/{slug}/stickies/{$}", deps.Stickies)
		mux.Handle("/api/workspaces/{slug}/stickies/{sticky_id}", deps.Stickies)
		mux.Handle("/api/workspaces/{slug}/stickies/{sticky_id}/{$}", deps.Stickies)
	}
	if deps.Assets != nil {
		mux.Handle("/api/assets/v2/static/{asset_id}/", deps.Assets)
		mux.Handle("/api/assets/v2/workspaces/{slug}/projects/{project_id}/issues/{issue_id}/attachments/", deps.Assets)
		mux.Handle("/api/assets/v2/workspaces/{slug}/projects/{project_id}/issues/{issue_id}/attachments/{asset_id}/", deps.Assets)
		mux.Handle("/api/assets/v2/workspaces/{slug}/{asset_id}/", deps.Assets) // For workspace logos, page descriptions, etc.
		mux.Handle("/api/assets/v2/workspaces/{slug}/", deps.Assets)
		mux.Handle("/api/assets/v2/workspaces/{slug}/projects/{project_id}/", deps.Assets)
		mux.Handle("/api/assets/v2/workspaces/{slug}/projects/{project_id}/{asset_id}/", deps.Assets)
		mux.Handle("/api/assets/v2/user-assets/", deps.Assets)
		mux.Handle("/api/assets/v2/user-assets/{asset_id}/", deps.Assets)
	}
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if proxy != nil {
			proxy.ServeHTTP(w, r)
			return
		}
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "route not migrated or does not exist"})
	})
	return corsMiddleware(requestID(mux))
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		} else {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		}
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID, X-Workspace-Id, Sentry-Trace, Baggage")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type projectRoutes struct {
	deps  Dependencies
	proxy http.Handler
}

func (h projectRoutes) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	tail := strings.Trim(r.PathValue("tail"), "/")
	parts := strings.Split(tail, "/")
	if len(parts) >= 2 && parts[0] != "" && h.deps.Pages != nil {
		projectID := parts[0]
		if len(parts) == 2 && parts[1] == "pages-summary" {
			r.SetPathValue("project_id", projectID)
			r.SetPathValue("page_action", "summary")
			h.deps.Pages.ServeHTTP(w, r)
			return
		}
		if len(parts) == 2 && parts[1] == "pages" {
			r.SetPathValue("project_id", projectID)
			h.deps.Pages.ServeHTTP(w, r)
			return
		}
		if len(parts) == 3 && parts[1] == "pages" && parts[2] != "" {
			r.SetPathValue("project_id", projectID)
			r.SetPathValue("page_id", parts[2])
			h.deps.Pages.ServeHTTP(w, r)
			return
		}
		if len(parts) == 3 && parts[1] == "favorite-pages" && parts[2] != "" {
			r.SetPathValue("project_id", projectID)
			r.SetPathValue("page_id", parts[2])
			r.SetPathValue("page_action", "favorite")
			h.deps.Pages.ServeHTTP(w, r)
			return
		}
		if len(parts) == 4 && parts[1] == "pages" && parts[2] != "" {
			action := parts[3]
			switch action {
			case "archive", "lock", "access", "description", "duplicate", "versions":
				r.SetPathValue("project_id", projectID)
				r.SetPathValue("page_id", parts[2])
				r.SetPathValue("page_action", action)
				h.deps.Pages.ServeHTTP(w, r)
				return
			}
		}
		if len(parts) == 5 && parts[1] == "pages" && parts[2] != "" && parts[3] == "versions" && parts[4] != "" {
			r.SetPathValue("project_id", projectID)
			r.SetPathValue("page_id", parts[2])
			r.SetPathValue("page_action", "version")
			r.SetPathValue("version_id", parts[4])
			h.deps.Pages.ServeHTTP(w, r)
			return
		}
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "user-properties" &&
		(r.Method == http.MethodGet || r.Method == http.MethodPatch) && h.deps.ProjectUserProperties != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.ProjectUserProperties.ServeHTTP(w, r)
		return
	}
	if len(parts) == 4 && parts[0] != "" && parts[1] == "cycles" && parts[2] != "" && parts[3] == "user-properties" &&
		(r.Method == http.MethodGet || r.Method == http.MethodPatch) && h.deps.CycleUserProperties != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("cycle_id", parts[2])
		h.deps.CycleUserProperties.ServeHTTP(w, r)
		return
	}
	if len(parts) == 4 && parts[0] != "" && parts[1] == "modules" && parts[2] != "" && parts[3] == "user-properties" &&
		(r.Method == http.MethodGet || r.Method == http.MethodPatch) && h.deps.ModuleUserProperties != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("module_id", parts[2])
		h.deps.ModuleUserProperties.ServeHTTP(w, r)
		return
	}
	if r.Method == http.MethodGet && tail == "details" && h.deps.Projects != nil {
		h.deps.Projects.ServeHTTP(w, r)
		return
	}
	if len(parts) == 1 && parts[0] != "" && h.deps.Project != nil &&
		(r.Method == http.MethodGet || r.Method == http.MethodPatch || r.Method == http.MethodDelete) {
		r.SetPathValue("project_id", parts[0])
		h.deps.Project.ServeHTTP(w, r)
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "states" && h.deps.States != nil &&
		(r.Method == http.MethodGet || r.Method == http.MethodPost) {
		r.SetPathValue("project_id", parts[0])
		h.deps.States.ServeHTTP(w, r)
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "members" &&
		(r.Method == http.MethodGet || r.Method == http.MethodPost) && h.deps.ProjectMembers != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.ProjectMembers.ServeHTTP(w, r)
		return
	}
	if len(parts) == 3 && parts[0] != "" && parts[1] == "members" && parts[2] != "" {
		if parts[2] == "leave" && r.Method == http.MethodPost && h.deps.ProjectMembersLeave != nil {
			r.SetPathValue("project_id", parts[0])
			h.deps.ProjectMembersLeave.ServeHTTP(w, r)
			return
		}
		if (r.Method == http.MethodGet || r.Method == http.MethodPatch || r.Method == http.MethodDelete) && h.deps.ProjectMembers != nil {
			r.SetPathValue("project_id", parts[0])
			r.SetPathValue("member_id", parts[2])
			h.deps.ProjectMembers.ServeHTTP(w, r)
			return
		}
	}
	if len(parts) == 3 && parts[0] != "" && parts[1] == "project-members" && parts[2] == "me" &&
		r.Method == http.MethodGet && h.deps.ProjectMemberMe != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.ProjectMemberMe.ServeHTTP(w, r)
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "project-views" &&
		r.Method == http.MethodPost && h.deps.ProjectUserViews != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.ProjectUserViews.ServeHTTP(w, r)
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "project-deploy-boards" &&
		(r.Method == http.MethodGet || r.Method == http.MethodPost) && h.deps.ProjectDeployBoards != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.ProjectDeployBoards.ServeHTTP(w, r)
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "issue-labels" && h.deps.Labels != nil &&
		(r.Method == http.MethodGet || r.Method == http.MethodPost) {
		r.SetPathValue("project_id", parts[0])
		h.deps.Labels.ServeHTTP(w, r)
		return
	}
	if len(parts) == 3 && parts[0] != "" && parts[1] == "issue-labels" && parts[2] != "" && h.deps.Labels != nil &&
		(r.Method == http.MethodGet || r.Method == http.MethodPatch || r.Method == http.MethodDelete) {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("label_id", parts[2])
		h.deps.Labels.ServeHTTP(w, r)
		return
	}
	if len(parts) == 3 && parts[0] != "" && parts[1] == "states" && parts[2] != "" && h.deps.States != nil &&
		(r.Method == http.MethodGet || r.Method == http.MethodPatch || r.Method == http.MethodDelete) {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("state_id", parts[2])
		h.deps.States.ServeHTTP(w, r)
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] == "project-estimates" && h.deps.Estimate != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("project_estimates", "true")
		h.deps.Estimate.ServeHTTP(w, r)
		return
	}
	if len(parts) >= 2 && len(parts) <= 5 && parts[0] != "" && parts[1] == "estimates" && h.deps.Estimate != nil {
		r.SetPathValue("project_id", parts[0])
		if len(parts) >= 3 && parts[2] != "" {
			r.SetPathValue("estimate_id", parts[2])
		}
		if len(parts) >= 4 && parts[3] == "estimate-points" {
			r.SetPathValue("estimate_points", "true")
		}
		if len(parts) == 5 && parts[4] != "" {
			r.SetPathValue("estimate_point_id", parts[4])
		}
		h.deps.Estimate.ServeHTTP(w, r)
		return
	}
	if len(parts) >= 2 && len(parts) <= 3 && parts[0] != "" && (parts[1] == "intakes" || parts[1] == "inboxes") && h.deps.Intake != nil {
		r.SetPathValue("project_id", parts[0])
		if len(parts) == 3 && parts[2] != "" {
			r.SetPathValue("intake_id", parts[2])
		}
		h.deps.Intake.ServeHTTP(w, r)
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
	// Issue comments: .../issues/{issue_id}/comments/ and .../issues/{issue_id}/comments/{comment_id}/
	if len(parts) == 4 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "comments" &&
		h.deps.Comments != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		h.deps.Comments.ServeHTTP(w, r)
		return
	}
	if len(parts) == 5 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "comments" && parts[4] != "" &&
		h.deps.Comments != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		r.SetPathValue("comment_id", parts[4])
		h.deps.Comments.ServeHTTP(w, r)
		return
	}
	// Issue activity history: .../issues/{issue_id}/history/
	if len(parts) == 4 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "history" &&
		r.Method == http.MethodGet && h.deps.Activities != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		h.deps.Activities.ServeHTTP(w, r)
		return
	}
	// Issue relations: .../issues/{issue_id}/issue-relation/
	if len(parts) == 4 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "issue-relation" &&
		h.deps.Relations != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		h.deps.Relations.ServeHTTP(w, r)
		return
	}
	// Issue remove relations: .../issues/{issue_id}/remove-relation/
	if len(parts) == 4 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "remove-relation" &&
		h.deps.Relations != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		h.deps.Relations.ServeHTTP(w, r)
		return
	}
	// Issue links: .../issues/{issue_id}/issue-links/ and .../issues/{issue_id}/issue-links/{link_id}/
	if len(parts) == 4 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "issue-links" &&
		h.deps.Links != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		h.deps.Links.ServeHTTP(w, r)
		return
	}
	if len(parts) == 5 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "issue-links" && parts[4] != "" &&
		h.deps.Links != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		r.SetPathValue("link_id", parts[4])
		h.deps.Links.ServeHTTP(w, r)
		return
	}
	// Issue reactions: .../issues/{issue_id}/reactions/ and .../issues/{issue_id}/reactions/{reaction_code}/
	if len(parts) == 4 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "reactions" &&
		h.deps.Reactions != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		h.deps.Reactions.ServeHTTP(w, r)
		return
	}
	if len(parts) == 5 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "reactions" && parts[4] != "" &&
		h.deps.Reactions != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		r.SetPathValue("reaction_code", parts[4])
		h.deps.Reactions.ServeHTTP(w, r)
		return
	}
	// Issue subscribers: .../issues/{issue_id}/issue-subscribers/
	if len(parts) == 4 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "issue-subscribers" &&
		h.deps.Subscribers != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		h.deps.Subscribers.ServeHTTP(w, r)
		return
	}
	if len(parts) == 5 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "issue-subscribers" && parts[4] != "" &&
		h.deps.Subscribers != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		r.SetPathValue("subscriber_id", parts[4])
		h.deps.Subscribers.ServeHTTP(w, r)
		return
	}
	// Issue subscribe: .../issues/{issue_id}/subscribe/ and .../issues/{issue_id}/unsubscribe/ and .../issues/{issue_id}/subscription_status/
	if len(parts) == 4 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" &&
		(parts[3] == "subscribe" || parts[3] == "unsubscribe" || parts[3] == "subscription_status") &&
		h.deps.Subscribers != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		h.deps.Subscribers.ServeHTTP(w, r)
		return
	}
	// Single archive: .../issues/{issue_id}/archive/
	if len(parts) == 4 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "archive" &&
		h.deps.Archives != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		h.deps.Archives.ServeHTTP(w, r)
		return
	}
	// Bulk archive: .../bulk-archive-issues/
	if len(parts) == 2 && parts[0] != "" && parts[1] == "bulk-archive-issues" &&
		r.Method == http.MethodPost && h.deps.Archives != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.Archives.ServeHTTP(w, r)
		return
	}
	// Sub-issues: .../issues/{issue_id}/sub-issues/
	if len(parts) == 4 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "sub-issues" &&
		r.Method == http.MethodGet && h.deps.Subissues != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		h.deps.Subissues.ServeHTTP(w, r)
		return
	}
	// Cycles: .../cycles/
	if len(parts) == 2 && parts[0] != "" && parts[1] == "cycles" && h.deps.Cycles != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.Cycles.ServeHTTP(w, r)
		return
	}
	// Cycles single: .../cycles/{cycle_id}/
	if len(parts) == 3 && parts[0] != "" && parts[1] == "cycles" && parts[2] != "" && h.deps.Cycles != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("cycle_id", parts[2])
		h.deps.Cycles.ServeHTTP(w, r)
		return
	}
	// Cycles actions: .../cycles/{cycle_id}/progress/ and .../cycles/{cycle_id}/analytics/
	if len(parts) == 4 && parts[0] != "" && parts[1] == "cycles" && parts[2] != "" &&
		(parts[3] == "progress" || parts[3] == "analytics") && h.deps.Cycles != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("cycle_id", parts[2])
		r.SetPathValue("cycle_action", parts[3])
		h.deps.Cycles.ServeHTTP(w, r)
		return
	}
	// Cycle issues: .../cycles/{cycle_id}/cycle-issues/
	if len(parts) == 4 && parts[0] != "" && parts[1] == "cycles" && parts[2] != "" && parts[3] == "cycle-issues" && h.deps.CycleIssues != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("cycle_id", parts[2])
		h.deps.CycleIssues.ServeHTTP(w, r)
		return
	}
	// Cycle issues detail: .../cycles/{cycle_id}/cycle-issues/{issue_id}/
	if len(parts) == 5 && parts[0] != "" && parts[1] == "cycles" && parts[2] != "" && parts[3] == "cycle-issues" && parts[4] != "" && h.deps.CycleIssues != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("cycle_id", parts[2])
		r.SetPathValue("issue_id", parts[4])
		h.deps.CycleIssues.ServeHTTP(w, r)
		return
	}
	// Modules: .../modules/
	if len(parts) == 2 && parts[0] != "" && parts[1] == "modules" && h.deps.Modules != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.Modules.ServeHTTP(w, r)
		return
	}
	// Modules single: .../modules/{module_id}/
	if len(parts) == 3 && parts[0] != "" && parts[1] == "modules" && parts[2] != "" && h.deps.Modules != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("module_id", parts[2])
		h.deps.Modules.ServeHTTP(w, r)
		return
	}
	// Module issues: .../modules/{module_id}/module-issues/
	if len(parts) == 4 && parts[0] != "" && parts[1] == "modules" && parts[2] != "" && parts[3] == "module-issues" && h.deps.ModuleIssues != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("module_id", parts[2])
		h.deps.ModuleIssues.ServeHTTP(w, r)
		return
	}
	// Module issues detail: .../modules/{module_id}/module-issues/{issue_id}/
	if len(parts) == 5 && parts[0] != "" && parts[1] == "modules" && parts[2] != "" && parts[3] == "module-issues" && parts[4] != "" && h.deps.ModuleIssues != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("module_id", parts[2])
		r.SetPathValue("issue_id", parts[4])
		h.deps.ModuleIssues.ServeHTTP(w, r)
		return
	}
	// Views: .../views/
	if len(parts) == 2 && parts[0] != "" && parts[1] == "views" && h.deps.Views != nil {
		r.SetPathValue("project_id", parts[0])
		h.deps.Views.ServeHTTP(w, r)
		return
	}
	// Views single: .../views/{view_id}/
	if len(parts) == 3 && parts[0] != "" && parts[1] == "views" && parts[2] != "" && h.deps.Views != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("view_id", parts[2])
		h.deps.Views.ServeHTTP(w, r)
		return
	}
	// Comment reactions list/create: .../issues/{issue_id}/comments/{comment_id}/reactions/
	if len(parts) == 6 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "comments" && parts[4] != "" && parts[5] == "reactions" && h.deps.CommentReactions != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		r.SetPathValue("comment_id", parts[4])
		h.deps.CommentReactions.ServeHTTP(w, r)
		return
	}
	// Comment reactions delete: .../issues/{issue_id}/comments/{comment_id}/reactions/{reaction_code}/
	if len(parts) == 7 && parts[0] != "" && parts[1] == "issues" && parts[2] != "" && parts[3] == "comments" && parts[4] != "" && parts[5] == "reactions" && parts[6] != "" && h.deps.CommentReactions != nil {
		r.SetPathValue("project_id", parts[0])
		r.SetPathValue("issue_id", parts[2])
		r.SetPathValue("comment_id", parts[4])
		r.SetPathValue("reaction_code", parts[6])
		h.deps.CommentReactions.ServeHTTP(w, r)
		return
	}
	if h.proxy != nil {
		h.proxy.ServeHTTP(w, r)
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "route not migrated"})
}

// issueQueryAllowlist defines query parameters that the Go issue store
// is known to handle correctly. Any parameter not in this list triggers
// a fallback to Django to prevent partial/incorrect responses.
var issueQueryAllowlist = map[string]bool{
	"cursor":       true,
	"per_page":     true,
	"order_by":     true,
	"group_by":     true,
	"expand":       true,
	"state":        true,
	"state_group":  true,
	"priority":     true,
	"labels":       true,
	"assignees":    true,
	"created_by":   true,
}

// canServeBasicIssueRead returns true only when ALL query parameters
// are in the allowlist AND their values are known to be perfectly handled by Go.
// Unknown parameters or unhandled values cause a fallback to Django.
func canServeBasicIssueRead(r *http.Request) bool {
	q := r.URL.Query()
	for key := range q {
		if !issueQueryAllowlist[key] {
			return false
		}
	}

	if orderBy := q.Get("order_by"); orderBy != "" && orderBy != "created_at" && orderBy != "-created_at" {
		return false
	}
	
	if groupBy := q.Get("group_by"); groupBy != "" && groupBy != "state" && groupBy != "state_id" && groupBy != "priority" {
		return false
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
