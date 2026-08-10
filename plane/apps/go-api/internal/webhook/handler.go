package webhook

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
)

type Store interface {
	List(context.Context, string, string) ([]Webhook, error)
	Get(context.Context, string, string, string, bool) (Webhook, error)
	Create(context.Context, string, string, Input) (Webhook, error)
	Update(context.Context, string, string, string, Input) (Webhook, error)
	Delete(context.Context, string, string, string) error
	Regenerate(context.Context, string, string, string) (Webhook, error)
	Logs(context.Context, string, string, string) ([]Log, error)
}

type Handler struct {
	Store             Store
	SessionCookieName string
	AllowedHosts      []string
	AllowedCIDRs      []*net.IPNet
	DisallowedDomains []string
}
type payload struct {
	URL          *string `json:"url"`
	IsActive     *bool   `json:"is_active"`
	Project      *bool   `json:"project"`
	Issue        *bool   `json:"issue"`
	Module       *bool   `json:"module"`
	Cycle        *bool   `json:"cycle"`
	IssueComment *bool   `json:"issue_comment"`
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		out(w, 503, map[string]string{"error": "Webhook storage is unavailable"})
		return
	}
	session := ""
	name := h.SessionCookieName
	if name == "" {
		name = "session-id"
	}
	if c, e := r.Cookie(name); e == nil {
		session = c.Value
	}
	slug, id := r.PathValue("slug"), r.PathValue("webhook_id")
	if id == "" {
		id = r.PathValue("pk")
	}
	if r.PathValue("webhook_id") != "" {
		if r.Method != http.MethodGet {
			method(w, "GET")
			return
		}
		v, e := h.Store.Logs(r.Context(), session, slug, id)
		h.respond(w, 200, v, e)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/regenerate/") {
		if r.Method != http.MethodPost {
			method(w, "POST")
			return
		}
		v, e := h.Store.Regenerate(r.Context(), session, slug, id)
		h.respond(w, 200, v, e)
		return
	}
	switch r.Method {
	case http.MethodGet:
		if id == "" {
			v, e := h.Store.List(r.Context(), session, slug)
			h.respond(w, 200, v, e)
		} else {
			v, e := h.Store.Get(r.Context(), session, slug, id, false)
			h.respond(w, 200, v, e)
		}
	case http.MethodPost, http.MethodPatch:
		var p payload
		if e := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&p); e != nil {
			out(w, 400, map[string]string{"error": "Invalid request payload"})
			return
		}
		if r.Method == http.MethodPost && (p.URL == nil || strings.TrimSpace(*p.URL) == "") {
			out(w, 400, map[string][]string{"url": {"This field is required."}})
			return
		}
		if p.URL != nil {
			if msg := h.validateURL(r, *p.URL); msg != "" {
				out(w, 400, map[string][]string{"url": {msg}})
				return
			}
		}
		in := Input{p.URL, p.IsActive, p.Project, p.Issue, p.Module, p.Cycle, p.IssueComment}
		if r.Method == http.MethodPost {
			v, e := h.Store.Create(r.Context(), session, slug, in)
			h.respond(w, 201, v, e)
		} else if id == "" {
			method(w, "GET, POST")
		} else {
			v, e := h.Store.Update(r.Context(), session, slug, id, in)
			h.respond(w, 200, v, e)
		}
	case http.MethodDelete:
		if id == "" {
			method(w, "GET, POST")
			return
		}
		e := h.Store.Delete(r.Context(), session, slug, id)
		if e != nil {
			h.respond(w, 0, nil, e)
			return
		}
		w.WriteHeader(204)
	default:
		method(w, "GET, POST, PATCH, DELETE")
	}
}

func (h Handler) validateURL(r *http.Request, raw string) string {
	if len(raw) > 1024 {
		return "Ensure this field has no more than 1024 characters."
	}
	u, e := url.ParseRequestURI(raw)
	if e != nil || u.Hostname() == "" {
		return "Enter a valid URL."
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "Invalid schema. Only HTTP and HTTPS are allowed."
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	for _, v := range h.AllowedHosts {
		if host == v {
			return ""
		}
	}
	blocked := append([]string{}, h.DisallowedDomains...)
	requestHost := strings.ToLower(strings.Split(r.Host, ":")[0])
	blocked = append(blocked, requestHost, "localhost")
	for _, v := range blocked {
		v = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(v), "."))
		if v != "" && (host == v || strings.HasSuffix(host, "."+v)) {
			return "URL domain or its subdomain is not allowed."
		}
	}
	ips, e := net.LookupIP(host)
	if e != nil {
		return "Invalid or disallowed webhook URL."
	}
	for _, ip := range ips {
		allowed := false
		for _, n := range h.AllowedCIDRs {
			if n.Contains(ip) {
				allowed = true
				break
			}
		}
		if !allowed && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()) {
			return "Invalid or disallowed webhook URL."
		}
	}
	return ""
}
func (h Handler) respond(w http.ResponseWriter, status int, v any, e error) {
	if e == nil {
		out(w, status, v)
		return
	}
	switch {
	case errors.Is(e, ErrUnauthorized):
		out(w, 401, map[string]string{"detail": "Authentication credentials were not provided."})
	case errors.Is(e, ErrForbidden):
		out(w, 403, map[string]string{"detail": "You do not have permission to perform this action."})
	case errors.Is(e, ErrNotFound):
		out(w, 404, map[string]string{"error": "The required object does not exist."})
	case errors.Is(e, ErrConflict):
		out(w, 409, map[string]string{"error": "URL already exists for the workspace"})
	default:
		out(w, 503, map[string]string{"error": "Webhook storage is unavailable"})
	}
}
func method(w http.ResponseWriter, a string) {
	w.Header().Set("Allow", a)
	out(w, 405, map[string]string{"error": "method not allowed"})
}
func out(w http.ResponseWriter, s int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(s)
	_ = json.NewEncoder(w).Encode(v)
}
