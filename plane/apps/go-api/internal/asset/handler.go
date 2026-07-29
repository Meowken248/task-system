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
		// Requires multipart/form-data parsing
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
		
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
