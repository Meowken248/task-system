package instance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/smtp"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/makeplane/plane/apps/go-api/internal/auth"
	"github.com/makeplane/plane/apps/go-api/internal/blockchain"
)

type Handler struct {
	Store             Store
	SessionCookieName string
	SessionSecret     string
	SessionAge        time.Duration
	CookieDomain      string
	mux               *http.ServeMux
	BlockchainMode    string
	Verifier          *blockchain.Verifier
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

	h.mux.HandleFunc("GET /api/instances/{$}", h.GetInstance)
	h.mux.HandleFunc("PATCH /api/instances/{$}", h.UpdateInstance)
	h.mux.HandleFunc("GET /api/instances/admins/", h.ListAdmins)
	h.mux.HandleFunc("POST /api/instances/admins/", h.CreateAdmin)
	h.mux.HandleFunc("DELETE /api/instances/admins/{id}/", h.DeleteAdmin)
	h.mux.HandleFunc("GET /api/instances/admins/me/", h.GetAdminMe)
	h.mux.HandleFunc("POST /api/instances/admins/sign-in/", h.AdminSignIn)
	h.mux.HandleFunc("POST /api/instances/admins/sign-up/", h.AdminSignUp)
	h.mux.HandleFunc("POST /api/instances/admins/sign-out/", h.AdminSignOut)
	h.mux.HandleFunc("GET /api/instances/configurations/", h.GetConfigurations)
	h.mux.HandleFunc("PATCH /api/instances/configurations/", h.UpdateConfigurations)
	h.mux.HandleFunc("DELETE /api/instances/configurations/disable-email-feature/", h.DisableEmailFeature)
	h.mux.HandleFunc("POST /api/instances/admins/sign-up-screen-visited/", h.SignUpScreenVisited)
	h.mux.HandleFunc("POST /api/instances/email-credentials-check/", h.EmailCredentialsCheck)
	h.mux.HandleFunc("GET /api/instances/workspace-slug-check/", h.WorkspaceSlugCheck)
	h.mux.HandleFunc("GET /api/instances/workspaces/", h.ListWorkspaces)
	h.mux.HandleFunc("POST /api/instances/workspaces/", h.CreateWorkspace)
	h.mux.HandleFunc("GET /api/instances/admins/{pk}/", h.GetAdmin)
	h.mux.HandleFunc("PATCH /api/instances/admins/{pk}/", h.UpdateAdmin)

	return h
}

func (h *Handler) ConfigureSession(secret, cookieDomain string, age time.Duration) *Handler {
	h.SessionSecret = secret
	h.CookieDomain = cookieDomain
	h.SessionAge = age
	return h
}

func (h *Handler) ConfigureBlockchain(mode string, verifier *blockchain.Verifier) *Handler {
	h.BlockchainMode = mode
	h.Verifier = verifier
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

func (h *Handler) requireAdmin(w http.ResponseWriter, r *http.Request) (*InstanceAdmin, error) {
	cookie, err := r.Cookie(h.SessionCookieName)
	if err != nil || cookie.Value == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return nil, errors.New("unauthorized")
	}
	userID, err := h.Store.GetUserIDBySessionKey(r.Context(), cookie.Value)
	if err != nil || userID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return nil, errors.New("unauthorized")
	}
	admin, err := h.Store.GetInstanceAdminByUserID(r.Context(), userID)
	if err != nil {
		w.WriteHeader(http.StatusForbidden)
		return nil, errors.New("forbidden")
	}
	if admin.Role < 15 {
		w.WriteHeader(http.StatusForbidden)
		return nil, errors.New("forbidden")
	}
	return admin, nil
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

	blockchainStatus := map[string]any{
		"status": "disabled",
	}

	if h.BlockchainMode == "online" {
		blockchainStatus["status"] = "offline"
		blockchainStatus["chain_id"] = ""
		blockchainStatus["contract_address"] = ""

		if h.Verifier != nil {
			blockchainStatus["chain_id"] = h.Verifier.Config.ChainID
			blockchainStatus["contract_address"] = h.Verifier.Config.ContractAddress

			pingCtx, cancel := context.WithTimeout(r.Context(), 1*time.Second)
			defer cancel()
			if err := h.Verifier.PingContext(pingCtx); err == nil {
				blockchainStatus["status"] = "online"
			} else {
				blockchainStatus["error"] = err.Error()
			}
		}
	} else if h.BlockchainMode == "offline" {
		blockchainStatus["status"] = "offline"
		if h.Verifier != nil {
			blockchainStatus["chain_id"] = h.Verifier.Config.ChainID
			blockchainStatus["contract_address"] = h.Verifier.Config.ContractAddress
		}
	}

	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"config": configMap,
			"instance": map[string]interface{}{
				"is_setup_done":    false,
				"is_activated":     false,
				"workspaces_exist": false,
			},
			"blockchain": blockchainStatus,
		})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"config":     configMap,
		"instance":   instance,
		"blockchain": blockchainStatus,
	})
}

func (h *Handler) UpdateInstance(w http.ResponseWriter, r *http.Request) {
	if _, err := h.requireAdmin(w, r); err != nil {
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
	if _, err := h.requireAdmin(w, r); err != nil {
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
	if _, err := h.requireAdmin(w, r); err != nil {
		return
	}
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
	_, err := h.requireAdmin(w, r)
	if err != nil {
		return
	}
	id := r.PathValue("id")
	h.Store.DeleteInstanceAdmin(r.Context(), id)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) GetAdminMe(w http.ResponseWriter, r *http.Request) {
	admin, err := h.requireAdmin(w, r)
	if err != nil {
		return
	}
	user, err := h.Store.GetUserByID(r.Context(), admin.UserID)
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

	if instance == nil {
		instance = &Instance{
			InstanceName:          companyName,
			InstanceID:            uuid.New().String(),
			CurrentVersion:        "v1.0.0",
			Edition:               "PLANE_COMMUNITY",
			IsSetupDone:           true,
			IsSignupScreenVisited: true,
		}
		if err := h.Store.CreateInstance(r.Context(), instance); err != nil {
			http.Error(w, "could not create instance: "+err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		instance.InstanceName = companyName
		instance.IsSetupDone = true
		instance.IsSignupScreenVisited = true
		if err := h.Store.UpdateInstance(r.Context(), instance); err != nil {
			http.Error(w, "could not update instance: "+err.Error(), http.StatusInternalServerError)
			return
		}
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
	if _, err := h.requireAdmin(w, r); err != nil {
		return
	}
	configs, _ := h.Store.GetConfigurations(r.Context())
	if configs == nil {
		configs = []InstanceConfiguration{}
	}
	json.NewEncoder(w).Encode(configs)
}

func (h *Handler) UpdateConfigurations(w http.ResponseWriter, r *http.Request) {
	if _, err := h.requireAdmin(w, r); err != nil {
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

func (h *Handler) DisableEmailFeature(w http.ResponseWriter, r *http.Request) {
	if _, err := h.requireAdmin(w, r); err != nil {
		return
	}
	if err := h.Store.UpdateEmailConfigurationDisabled(r.Context()); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Failed to disable email configuration"})
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (h *Handler) SignUpScreenVisited(w http.ResponseWriter, r *http.Request) {
	instance, err := h.Store.GetInstance(r.Context())
	if err != nil || instance == nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Instance is not configured"})
		return
	}
	instance.IsSignupScreenVisited = true
	if err := h.Store.UpdateInstance(r.Context(), instance); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) EmailCredentialsCheck(w http.ResponseWriter, r *http.Request) {
	var req map[string]string
	json.NewDecoder(r.Body).Decode(&req)
	receiverEmail := req["receiver_email"]
	if receiverEmail == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Receiver email is required"})
		return
	}

	configs, _ := h.Store.GetConfigurations(r.Context())
	var host, user, password, port, from string
	for _, c := range configs {
		if c.Value != nil {
			switch c.Key {
			case "EMAIL_HOST":
				host = *c.Value
			case "EMAIL_HOST_USER":
				user = *c.Value
			case "EMAIL_HOST_PASSWORD":
				password = *c.Value
			case "EMAIL_PORT":
				port = *c.Value
			case "EMAIL_FROM":
				from = *c.Value
			}
		}
	}

	authData := smtp.PlainAuth("", user, password, host)
	msg := []byte("To: " + receiverEmail + "\r\n" +
		"Subject: Email Notification from Plane\r\n" +
		"\r\n" +
		"This is a sample email notification sent from Plane application.\r\n")

	addr := host + ":" + port
	err := smtp.SendMail(addr, authData, from, []string{receiverEmail}, msg)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Could not send email. Please check your configuration"})
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"message": "Email successfully sent."})
}

func (h *Handler) WorkspaceSlugCheck(w http.ResponseWriter, r *http.Request) {
	if _, err := h.requireAdmin(w, r); err != nil {
		return
	}
	slug := r.URL.Query().Get("slug")
	if slug == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Workspace Slug is required"})
		return
	}
	exists, err := h.Store.CheckWorkspaceSlug(r.Context(), slug)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	// simplified RESTRICTED_WORKSPACE_SLUGS check
	if slug == "api" || slug == "admin" || slug == "god-mode" {
		exists = true
	}
	json.NewEncoder(w).Encode(map[string]bool{"status": !exists})
}

func (h *Handler) ListWorkspaces(w http.ResponseWriter, r *http.Request) {
	if _, err := h.requireAdmin(w, r); err != nil {
		return
	}
	search := r.URL.Query().Get("search")
	perPage := 10
	if pp := r.URL.Query().Get("per_page"); pp != "" {
		if p, err := strconv.Atoi(pp); err == nil && p > 0 {
			perPage = p
		}
	}
	if perPage > 1000 {
		perPage = 1000
	}

	offset := 0
	cursorStr := r.URL.Query().Get("cursor")
	if cursorStr != "" {
		parts := strings.Split(cursorStr, ":")
		if len(parts) == 3 {
			if o, err := strconv.Atoi(parts[1]); err == nil && o >= 0 {
				offset = o
			}
		}
	}

	workspaces, totalCount, err := h.Store.ListWorkspaces(r.Context(), search, perPage, offset)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	totalPages := 0
	if perPage > 0 {
		totalPages = (totalCount + perPage - 1) / perPage
	}

	nextOffset := offset + perPage
	nextCursor := fmt.Sprintf("%d:%d:0", perPage, nextOffset)
	nextPageResults := nextOffset < totalCount

	prevOffset := offset - perPage
	if prevOffset < 0 {
		prevOffset = 0
	}
	prevCursor := fmt.Sprintf("%d:%d:1", perPage, prevOffset)
	prevPageResults := offset > 0

	json.NewEncoder(w).Encode(map[string]any{
		"next_cursor":       nextCursor,
		"prev_cursor":       prevCursor,
		"next_page_results": nextPageResults,
		"prev_page_results": prevPageResults,
		"count":             len(workspaces),
		"total_pages":       totalPages,
		"total_results":     totalCount,
		"results":           workspaces,
	})
}

func (h *Handler) CreateWorkspace(w http.ResponseWriter, r *http.Request) {
	admin, err := h.requireAdmin(w, r)
	if err != nil {
		return
	}
	var req map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid JSON"})
		return
	}
	name, _ := req["name"].(string)
	slug, _ := req["slug"].(string)
	companyRole, _ := req["company_role"].(string)

	if name == "" || slug == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Both name and slug are required"})
		return
	}
	if len(name) > 80 || len(slug) > 48 {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "The maximum length for name is 80 and for slug is 48"})
		return
	}

	workspace, err := h.Store.CreateWorkspace(r.Context(), admin.UserID, name, slug, companyRole)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(workspace)
}

func (h *Handler) GetAdmin(w http.ResponseWriter, r *http.Request) {
	if _, err := h.requireAdmin(w, r); err != nil {
		return
	}
	// Simplification: we don't have GetInstanceAdminByID yet, so just list and find.
	admins, _ := h.Store.GetInstanceAdmins(r.Context())
	pk := r.PathValue("pk")
	for _, a := range admins {
		if a.ID == pk {
			json.NewEncoder(w).Encode(a)
			return
		}
	}
	w.WriteHeader(http.StatusNotFound)
}

func (h *Handler) UpdateAdmin(w http.ResponseWriter, r *http.Request) {
	currentAdmin, err := h.requireAdmin(w, r)
	if err != nil {
		return
	}
	if currentAdmin.Role < 15 {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": "Only admins with role >= 15 can update other admins."})
		return
	}

	var req map[string]int
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	role, ok := req["role"]
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Role is required"})
		return
	}

	pk := r.PathValue("pk")
	if err := h.Store.UpdateInstanceAdmin(r.Context(), pk, role); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	// Fetch updated admin to return
	admins, _ := h.Store.GetInstanceAdmins(r.Context())
	for _, a := range admins {
		if a.ID == pk {
			json.NewEncoder(w).Encode(a)
			return
		}
	}
	w.WriteHeader(http.StatusOK)
}
