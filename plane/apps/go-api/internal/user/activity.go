package user

import (
	"context"
	"net/http"
	"time"
)

type UserActivity struct {
	ID             string    `json:"id"`
	Actor          string    `json:"actor"`
	Workspace      string    `json:"workspace"`
	Project        string    `json:"project"`
	Issue          string    `json:"issue"`
	Verb           string    `json:"verb"`
	Field          *string   `json:"field"`
	OldValue       *string   `json:"old_value"`
	NewValue       *string   `json:"new_value"`
	Comment        string    `json:"comment"`
	IssueCommentID *string   `json:"issue_comment"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type UserActivityStore interface {
	UserActivitiesForSession(ctx context.Context, sessionKey string, limit int, offset int) ([]UserActivity, error)
}

type UserActivityHandler struct {
	Store             UserActivityStore
	SessionCookieName string
}

func (h UserActivityHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sessionKey := sessionFromRequest(r, h.SessionCookieName)
	if sessionKey == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		return
	}

	if r.Method == http.MethodGet {
		limit := 100
		offset := 0
		if h.Store != nil {
			activities, err := h.Store.UserActivitiesForSession(r.Context(), sessionKey, limit, offset)
			if err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user activity storage is unavailable"})
				return
			}
			if activities == nil {
				activities = []UserActivity{}
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"results":       activities,
				"next_cursor":   "",
				"prev_cursor":   "",
				"total_results": len(activities),
			})
			return
		}
		
		// Fallback mock if store is nil
		activities := []UserActivity{}
		writeJSON(w, http.StatusOK, map[string]any{
			"results":       activities,
			"next_cursor":   "",
			"prev_cursor":   "",
			"total_results": 0,
		})
		return
	}
	w.WriteHeader(http.StatusMethodNotAllowed)
}
