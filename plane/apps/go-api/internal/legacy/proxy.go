package legacy

import (
	"encoding/json"
	"net/http"
	"net/http/httputil"
	"net/url"
)

func NewProxy(rawURL string) (http.Handler, error) {
	target, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "legacy API unavailable"})
	}
	proxy.ModifyResponse = func(response *http.Response) error {
		response.Header.Set("X-Plane-Migration-Fallback", "django")
		return nil
	}
	return proxy, nil
}
