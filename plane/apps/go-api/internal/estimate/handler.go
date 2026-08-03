package estimate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

var (
	ErrUnauthorized  = errors.New("authentication required")
	ErrForbidden     = errors.New("project access denied")
	ErrNotFound      = errors.New("estimate not found")
	ErrPointNotFound = errors.New("estimate point not found")
	ErrInvalid       = errors.New("invalid estimate payload")
)

type Store interface {
	ListWorkspaceForSession(context.Context, string, string) ([]Estimate, error)
	ListForSession(context.Context, string, string, string) ([]Estimate, error)
	GetForSession(context.Context, string, string, string, string) (Estimate, error)
	CreateForSession(context.Context, string, string, string, WritePayload) (Estimate, error)
	UpdateForSession(context.Context, string, string, string, string, WritePayload) (Estimate, error)
	DeleteForSession(context.Context, string, string, string, string) error
	ListPointsForSession(context.Context, string, string, string, string) ([]EstimatePoint, error)
	CreatePointsForSession(context.Context, string, string, string, string, []EstimatePointInput) ([]EstimatePoint, error)
	UpdatePointForSession(context.Context, string, string, string, string, string, EstimatePointInput) (EstimatePoint, error)
	DeletePointForSession(context.Context, string, string, string, string, string) error
}

type Handler struct {
	Store             Store
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "estimate storage is unavailable"})
		return
	}
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "sessionid"
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil || cookie.Value == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		return
	}

	sessionKey := cookie.Value
	slug := r.PathValue("slug")
	projectID := r.PathValue("project_id")
	estimateID := r.PathValue("estimate_id")
	pointID := r.PathValue("estimate_point_id")

	if projectID == "" {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		items, err := h.Store.ListWorkspaceForSession(r.Context(), sessionKey, slug)
		h.writeResult(w, http.StatusOK, items, err)
		return
	}

	if r.PathValue("estimate_points") == "true" {
		h.servePoints(w, r, sessionKey, slug, projectID, estimateID, pointID)
		return
	}

	switch {
	case estimateID == "" && r.Method == http.MethodGet:
		items, err := h.Store.ListForSession(r.Context(), sessionKey, slug, projectID)
		h.writeResult(w, http.StatusOK, items, err)
	case estimateID == "" && r.Method == http.MethodPost:
		var payload WritePayload
		if err := decodeJSON(r, &payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		item, err := h.Store.CreateForSession(r.Context(), sessionKey, slug, projectID, payload)
		h.writeResult(w, http.StatusCreated, item, err)
	case estimateID != "" && r.Method == http.MethodGet:
		item, err := h.Store.GetForSession(r.Context(), sessionKey, slug, projectID, estimateID)
		h.writeResult(w, http.StatusOK, item, err)
	case estimateID != "" && r.Method == http.MethodPatch:
		var payload WritePayload
		if err := decodeJSON(r, &payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		item, err := h.Store.UpdateForSession(r.Context(), sessionKey, slug, projectID, estimateID, payload)
		h.writeResult(w, http.StatusOK, item, err)
	case estimateID != "" && r.Method == http.MethodDelete:
		if err := h.Store.DeleteForSession(r.Context(), sessionKey, slug, projectID, estimateID); err != nil {
			h.writeError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		methodNotAllowed(w, http.MethodGet, http.MethodPost, http.MethodPatch, http.MethodDelete)
	}
}

func (h Handler) servePoints(w http.ResponseWriter, r *http.Request, sessionKey, slug, projectID, estimateID, pointID string) {
	switch {
	case pointID == "" && r.Method == http.MethodGet:
		items, err := h.Store.ListPointsForSession(r.Context(), sessionKey, slug, projectID, estimateID)
		h.writeResult(w, http.StatusOK, items, err)
	case pointID == "" && r.Method == http.MethodPost:
		inputs, single, err := decodePointInputs(r)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		items, err := h.Store.CreatePointsForSession(r.Context(), sessionKey, slug, projectID, estimateID, inputs)
		if err != nil {
			h.writeError(w, err)
			return
		}
		if single {
			for i := len(items) - 1; i >= 0; i-- {
				if inputs[0].Key != nil && items[i].Key == *inputs[0].Key {
					writeJSON(w, http.StatusOK, items[i])
					return
				}
			}
			if len(items) > 0 {
				writeJSON(w, http.StatusOK, items[len(items)-1])
				return
			}
		}
		writeJSON(w, http.StatusCreated, items)
	case pointID != "" && r.Method == http.MethodPatch:
		var input EstimatePointInput
		if err := decodeJSON(r, &input); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		item, err := h.Store.UpdatePointForSession(r.Context(), sessionKey, slug, projectID, estimateID, pointID, input)
		h.writeResult(w, http.StatusOK, item, err)
	case pointID != "" && r.Method == http.MethodDelete:
		if err := h.Store.DeletePointForSession(r.Context(), sessionKey, slug, projectID, estimateID, pointID); err != nil {
			h.writeError(w, err)
			return
		}
		items, err := h.Store.ListPointsForSession(r.Context(), sessionKey, slug, projectID, estimateID)
		h.writeResult(w, http.StatusOK, items, err)
	default:
		methodNotAllowed(w, http.MethodGet, http.MethodPost, http.MethodPatch, http.MethodDelete)
	}
}

func decodePointInputs(r *http.Request) ([]EstimatePointInput, bool, error) {
	raw, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, 1<<20))
	if err != nil {
		return nil, false, fmt.Errorf("invalid request body")
	}
	if len(raw) == 0 {
		return nil, false, fmt.Errorf("estimate points are required")
	}
	var array []EstimatePointInput
	if raw[0] == '[' {
		if err := json.Unmarshal(raw, &array); err != nil {
			return nil, false, fmt.Errorf("invalid request body")
		}
		return array, false, nil
	}
	var envelope struct {
		EstimatePoints []EstimatePointInput `json:"estimate_points"`
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, false, fmt.Errorf("invalid request body")
	}
	if _, ok := fields["estimate_points"]; ok {
		if err := json.Unmarshal(raw, &envelope); err != nil {
			return nil, false, fmt.Errorf("invalid request body")
		}
		return envelope.EstimatePoints, false, nil
	}
	var single EstimatePointInput
	if err := json.Unmarshal(raw, &single); err != nil {
		return nil, false, fmt.Errorf("invalid request body")
	}
	return []EstimatePointInput{single}, true, nil
}

func decodeJSON(r *http.Request, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("invalid request body")
	}
	return nil
}

func (h Handler) writeResult(w http.ResponseWriter, status int, payload any, err error) {
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, status, payload)
}

func (h Handler) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnauthorized):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
	case errors.Is(err, ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrPointNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, ErrInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "estimate storage is unavailable"})
	}
}

func methodNotAllowed(w http.ResponseWriter, methods ...string) {
	for i, method := range methods {
		if i == 0 {
			w.Header().Set("Allow", method)
		} else {
			w.Header().Add("Allow", method)
		}
	}
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
