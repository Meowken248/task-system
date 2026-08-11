package asset

import (
	"encoding/json"
	"io"
	"net/http"
)

type Handler struct {
	Store             PostgreSQLStore
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.SessionCookieName == "" {
		h.SessionCookieName = "sessionid"
	}
	sessionKey := ""
	if cookie, err := r.Cookie(h.SessionCookieName); err == nil {
		sessionKey = cookie.Value
	}

	slug := r.PathValue("slug")
	projectID := r.PathValue("project_id")
	assetID := r.PathValue("asset_id")

	switch r.Method {
	case http.MethodGet:
		if assetID == "" {
			http.Error(w, "Asset ID required", http.StatusBadRequest)
			return
		}
		asset, err := h.Store.Get(r.Context(), assetID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		// Download file from storage provider and stream
		reader, err := h.Store.Download(r.Context(), asset.Asset)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer reader.Close()
		io.Copy(w, reader)

	case http.MethodPost:
		// V2 API uses JSON to request a presigned URL
		if r.Header.Get("Content-Type") == "application/json" {
			var req struct {
				Name             string `json:"name"`
				Type             string `json:"type"`
				Size             int64  `json:"size"`
				EntityType       string `json:"entity_type"`
				EntityIdentifier string `json:"entity_identifier"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if req.Name == "" {
				req.Name = "unnamed"
			}
			if req.Type == "" {
				req.Type = "image/jpeg" // default
			}

			asset, uploadData, err := h.Store.CreatePresigned(r.Context(), sessionKey, slug, projectID, req.Name, req.Type, req.EntityType, req.Size, req.EntityIdentifier)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"upload_data": uploadData,
				"asset_id":    asset.ID,
				"asset_url":   asset.Asset,
			})
			return
		}

		// Fallback for V1 non-presigned multipart form
		err := r.ParseMultipartForm(5 << 20) // 5 MB
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		file, header, err := r.FormFile("asset")
		if err != nil {
			http.Error(w, "asset field missing", http.StatusBadRequest)
			return
		}
		defer file.Close()

		entityType := r.FormValue("entity_type")

		asset, err := h.Store.Create(r.Context(), sessionKey, slug, projectID, file, header.Filename, entityType, header.Size)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(asset)

	case http.MethodPatch:
		if assetID == "" {
			http.Error(w, "Asset ID required", http.StatusBadRequest)
			return
		}
		if err := h.Store.ConfirmUpload(r.Context(), sessionKey, slug, assetID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
