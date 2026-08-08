package instance

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/makeplane/plane/apps/go-api/internal/auth"
)

type Handler struct {
	Store             Store
	SessionCookieName string
	SessionSecret     string
	SessionAge        time.Duration
	CookieDomain      string
	mux               *http.ServeMux
}

func NewHandler(store Store, cookieName string) *Handler {
	if cookieName == "" {
		cookieName = "sessionid"
	}
	h := &Handler{
		Store:             store,
		SessionCookieName: cookieName,
		mux:               http.NewServeMux(),
	}

	h.mux.HandleFunc("GET /api/instances/", h.GetInstance)
	h.mux.HandleFunc("PATCH /api/instances/", h.UpdateInstance)
	h.mux.HandleFunc("GET /api/instances/admins/", h.ListAdmins)
	h.mux.HandleFunc("POST /api/instances/admins/", h.CreateAdmin)
	h.mux.HandleFunc("DELETE /api/instances/admins/{id}/", h.DeleteAdmin)
	h.mux.HandleFunc("GET /api/instances/admins/me/", h.GetAdminMe)
	h.mux.HandleFunc("POST /api/instances/admins/sign-in/", h.AdminSignIn)
	h.mux.HandleFunc("POST /api/instances/admins/sign-up/", h.AdminSignUp)
	h.mux.HandleFunc("POST /api/instances/admins/sign-out/", h.AdminSignOut)
	h.mux.HandleFunc("GET /api/instances/configurations/", h.GetConfigurations)
	h.mux.HandleFunc("PATCH /api/instances/configurations/", h.UpdateConfigurations)

	return h
}

func (h *Handler) ConfigureSession(secret, cookieDomain string, age time.Duration) *Handler {
	h.SessionSecret = secret
	h.CookieDomain = cookieDomain
	h.SessionAge = age
	return h
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	h.mux.ServeHTTP(w, r)
}

func getAdminFrontendBase(r *http.Request) string {
	origin := r.Header.Get("Origin")
	if origin == "" {
		referer := r.Header.Get("Referer")
		if referer != "" {
			if u, err := url.Parse(referer); err == nil {
				return u.Scheme + "://" + u.Host + "/god-mode"
			}
		}
		return "http://localhost:3001/god-mode"
	}
	return origin + "/god-mode"
}

func (h *Handler) requireAdmin(w http.ResponseWriter, r *http.Request) error {
	cookie, err := r.Cookie(h.SessionCookieName)
	if err != nil || cookie.Value == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return errors.New("unauthorized")
	}
	userID, err := h.Store.GetUserIDBySessionKey(r.Context(), cookie.Value)
	if err != nil || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return errors.New("unauthorized")
	}
	_, err = h.Store.GetInstanceAdminByUserID(r.Context(), userID)
	if err != nil {
		w.WriteHeader(http.StatusForbidden)
		return errors.New("forbidden")
	}
	return nil
}

func (h *Handler) GetInstance(w http.ResponseWriter, r *http.Request) {
	instance, err := h.Store.GetInstance(r.Context())

	configs, _ := h.Store.GetConfigurations(r.Context())
	configMap := make(map[string]interface{})
	for _, c := range configs {
		if c.Value != nil {
			configMap[c.Key] = *c.Value
		} else {
			configMap[c.Key] = ""
		}
	}
	// Hardcode some config defaults if missing
	if _, ok := configMap["is_email_password_enabled"]; !ok {
		configMap["is_email_password_enabled"] = true
	}

	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"config": configMap,
			"instance": map[string]interface{}{
				"is_setup_done":    false,
				"is_activated":     false,
				"workspaces_exist": false,
			},
		})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"config":   configMap,
		"instance": instance,
	})
}

func (h *Handler) UpdateInstance(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAdmin(w, r); err != nil {
		return
	}
	instance, err := h.Store.GetInstance(r.Context())
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	json.NewDecoder(r.Body).Decode(instance)
	h.Store.UpdateInstance(r.Context(), instance)
	json.NewEncoder(w).Encode(instance)
}

func (h *Handler) ListAdmins(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAdmin(w, r); err != nil {
		return
	}
	admins, _ := h.Store.GetInstanceAdmins(r.Context())
	var result []map[string]interface{}
	for _, a := range admins {
		user, _ := h.Store.GetUserByID(r.Context(), a.UserID)
		if user == nil {
			continue
		}
		result = append(result, map[string]interface{}{
			"id":       a.ID,
			"instance": a.InstanceID,
			"user":     user.ID,
			"role":     a.Role,
			"user_detail": map[string]interface{}{
				"id":           user.ID,
				"email":        user.Email,
				"first_name":   user.FirstName,
				"last_name":    user.LastName,
				"display_name": user.FirstName + " " + user.LastName,
				"is_active":    user.IsActive,
				"is_bot":       user.IsBot,
			},
		})
	}
	if result == nil {
		result = []map[string]interface{}{}
	}
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) CreateAdmin(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAdmin(w, r); err != nil {
		return
	}
	// Need body parsing: email, role
	var req map[string]interface{}
	json.NewDecoder(r.Body).Decode(&req)
	email, ok := req["email"].(string)
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	user, err := h.Store.GetUserByEmail(r.Context(), email)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	instance, _ := h.Store.GetInstance(r.Context())
	admin := &InstanceAdmin{
		UserID:     user.ID,
		InstanceID: instance.ID,
		Role:       20,
	}
	h.Store.CreateInstanceAdmin(r.Context(), admin)
	json.NewEncoder(w).Encode(admin)
}

func (h *Handler) DeleteAdmin(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAdmin(w, r); err != nil {
		return
	}
	id := r.PathValue("id")
	h.Store.DeleteInstanceAdmin(r.Context(), id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) GetAdminMe(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(h.SessionCookieName)
	if err != nil || cookie.Value == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	userID, err := h.Store.GetUserIDBySessionKey(r.Context(), cookie.Value)
	if err != nil || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if _, err = h.Store.GetInstanceAdminByUserID(r.Context(), userID); err != nil {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	user, err := h.Store.GetUserByID(r.Context(), userID)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":           user.ID,
		"email":        user.Email,
		"first_name":   user.FirstName,
		"last_name":    user.LastName,
		"display_name": user.FirstName + " " + user.LastName,
		"is_active":    user.IsActive,
		"is_bot":       user.IsBot,
	})
}

func (h *Handler) AdminSignIn(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, getAdminFrontendBase(r)+"/?error_message=INVALID_CREDENTIALS", http.StatusFound)
		return
	}
	email := strings.ToLower(strings.TrimSpace(r.FormValue("email")))
	password := r.FormValue("password")

	user, err := h.Store.GetUserByEmail(r.Context(), email)
	if err != nil || user == nil || !user.IsActive || !auth.VerifyDjangoPassword(password, user.Password) {
		http.Redirect(w, r, getAdminFrontendBase(r)+"/?error_message=INVALID_CREDENTIALS", http.StatusFound)
		return
	}
	if _, err = h.Store.GetInstanceAdminByUserID(r.Context(), user.ID); err != nil {
		http.Redirect(w, r, getAdminFrontendBase(r)+"/?error_message=NOT_AN_ADMIN", http.StatusFound)
		return
	}
	if h.SessionSecret == "" {
		http.Error(w, "admin sign-in is not configured", http.StatusServiceUnavailable)
		return
	}
	session, err := auth.NewLoginSession(r, auth.LoginUser{ID: user.ID, Email: user.Email, PasswordHash: user.Password, IsActive: user.IsActive}, h.SessionSecret, h.SessionAge, nil)
	if err != nil || h.Store.CreateLoginSession(r.Context(), session) != nil {
		http.Error(w, "could not create admin session", http.StatusServiceUnavailable)
		return
	}
	auth.SetLoginCookie(w, r, h.SessionCookieName, h.CookieDomain, session)
	http.Redirect(w, r, getAdminFrontendBase(r)+"/general/", http.StatusFound)
}

func (h *Handler) AdminSignUp(w http.ResponseWriter, r *http.Request) {
	instance, err := h.Store.GetInstance(r.Context())
	if err == nil && instance != nil && instance.IsSetupDone {
		http.Redirect(w, r, getAdminFrontendBase(r)+"/?error_message=INSTANCE_ALREADY_CONFIGURED", http.StatusFound)
		return
	}

	r.ParseForm()
	email := r.FormValue("email")
	password := r.FormValue("password")
	firstName := r.FormValue("first_name")
	lastName := r.FormValue("last_name")
	companyName := r.FormValue("company_name")
	if companyName == "" {
		companyName = "Plane"
	}

	hashed, err := auth.EncodeDjangoPassword(password)
	if err != nil {
		http.Error(w, "could not encode admin password", http.StatusInternalServerError)
		return
	}
	user := &User{
		Username:  email,
		Email:     email,
		Password:  hashed,
		FirstName: firstName,
		LastName:  lastName,
		IsActive:  true,
	}
	err = h.Store.CreateUser(r.Context(), user)
	if err != nil {
		http.Error(w, "could not create admin user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if instance == nil || err != nil {
		instance = &Instance{
			InstanceName:          companyName,
			InstanceID:            uuid.New().String(),
			CurrentVersion:        "v1.0.0",
			Edition:               "PLANE_COMMUNITY",
			IsSetupDone:           true,
			IsSignupScreenVisited: true,
		}
		h.Store.CreateInstance(r.Context(), instance)
	} else {
		instance.InstanceName = companyName
		instance.IsSetupDone = true
		instance.IsSignupScreenVisited = true
		h.Store.UpdateInstance(r.Context(), instance)
	}

	err = h.Store.CreateInstanceAdmin(r.Context(), &InstanceAdmin{
		UserID:     user.ID,
		InstanceID: instance.ID,
		Role:       20,
	})
	if err != nil {
		http.Error(w, "could not create instance admin: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if h.SessionSecret == "" {
		http.Error(w, "admin sign-up session is not configured", http.StatusServiceUnavailable)
		return
	}
	session, err := auth.NewLoginSession(r, auth.LoginUser{ID: user.ID, Email: user.Email, PasswordHash: user.Password, IsActive: user.IsActive}, h.SessionSecret, h.SessionAge, nil)
	if err != nil || h.Store.CreateLoginSession(r.Context(), session) != nil {
		http.Error(w, "could not create admin session", http.StatusServiceUnavailable)
		return
	}
	auth.SetLoginCookie(w, r, h.SessionCookieName, h.CookieDomain, session)
	http.Redirect(w, r, getAdminFrontendBase(r)+"/general/", http.StatusFound)
}

func (h *Handler) AdminSignOut(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     h.SessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
	http.Redirect(w, r, getAdminFrontendBase(r)+"/", http.StatusFound)
}

func (h *Handler) GetConfigurations(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAdmin(w, r); err != nil {
		return
	}
	configs, _ := h.Store.GetConfigurations(r.Context())
	if configs == nil {
		configs = []InstanceConfiguration{}
	}
	json.NewEncoder(w).Encode(configs)
}

func (h *Handler) UpdateConfigurations(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAdmin(w, r); err != nil {
		return
	}
	var req map[string]interface{}
	json.NewDecoder(r.Body).Decode(&req)

	for key, val := range req {
		valStr := ""
		if val != nil {
			valStr = val.(string)
		}
		config := &InstanceConfiguration{
			Key:   key,
			Value: &valStr,
		}
		h.Store.UpdateConfiguration(r.Context(), config)
	}
	h.GetConfigurations(w, r)
}
