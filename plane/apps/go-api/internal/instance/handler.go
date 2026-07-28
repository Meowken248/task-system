package instance

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

type cachedResponse struct {
	body        []byte
	contentType string
	storedAt    time.Time
}

type Handler struct {
	client   *http.Client
	endpoint string
	ttl      time.Duration
	mu       sync.RWMutex
	cache    cachedResponse
}

func NewHandler(rawLegacyURL string, ttl time.Duration) (*Handler, error) {
	target, err := url.Parse(rawLegacyURL)
	if err != nil {
		return nil, err
	}
	target.Path = "/api/instances/"
	target.RawQuery = ""
	target.Fragment = ""
	return &Handler{
		client:   &http.Client{Timeout: 8 * time.Second},
		endpoint: target.String(),
		ttl:      ttl,
	}, nil
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if fresh, ok := h.fresh(); ok {
		writeCached(w, fresh, false)
		return
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, h.endpoint, nil)
	if err == nil {
		request.Header.Set("Accept", "application/json")
		request.Header.Set("X-Request-ID", r.Header.Get("X-Request-ID"))
		var response *http.Response
		response, err = h.client.Do(request)
		if err == nil {
			defer response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				var body []byte
				body, err = io.ReadAll(io.LimitReader(response.Body, 2<<20))
				if err == nil && json.Valid(body) {
					value := cachedResponse{
						body: body, contentType: response.Header.Get("Content-Type"), storedAt: time.Now(),
					}
					h.store(value)
					writeCached(w, value, false)
					return
				}
			}
		}
	}
	if stale, ok := h.stale(); ok {
		writeCached(w, stale, true)
		return
	}
	writeJSONError(w, http.StatusBadGateway, "instance information unavailable")
}

func (h *Handler) fresh() (cachedResponse, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.cache, len(h.cache.body) != 0 && time.Since(h.cache.storedAt) < h.ttl
}

func (h *Handler) stale() (cachedResponse, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.cache, len(h.cache.body) != 0
}

func (h *Handler) store(value cachedResponse) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.cache = value
}

func writeCached(w http.ResponseWriter, value cachedResponse, stale bool) {
	contentType := value.contentType
	if contentType == "" {
		contentType = "application/json"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=12")
	w.Header().Set("X-Plane-Instance-Source", "go-cache")
	if stale {
		w.Header().Set("Warning", "110 - Response is stale")
		w.Header().Set("X-Plane-Instance-Stale", "true")
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(value.body)
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
