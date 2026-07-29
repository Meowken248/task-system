package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/makeplane/plane/apps/go-api/internal/activity"
	"github.com/makeplane/plane/apps/go-api/internal/archive"
	"github.com/makeplane/plane/apps/go-api/internal/auth"
	"github.com/makeplane/plane/apps/go-api/internal/blockchain"
	"github.com/makeplane/plane/apps/go-api/internal/comment"
	"github.com/makeplane/plane/apps/go-api/internal/config"
	"github.com/makeplane/plane/apps/go-api/internal/database"
	"github.com/makeplane/plane/apps/go-api/internal/favorite"
	"github.com/makeplane/plane/apps/go-api/internal/httpapi"
	"github.com/makeplane/plane/apps/go-api/internal/instance"
	"github.com/makeplane/plane/apps/go-api/internal/issue"
	"github.com/makeplane/plane/apps/go-api/internal/label"
	"github.com/makeplane/plane/apps/go-api/internal/legacy"
	"github.com/makeplane/plane/apps/go-api/internal/link"
	"github.com/makeplane/plane/apps/go-api/internal/project"
	"github.com/makeplane/plane/apps/go-api/internal/projectmember"
	"github.com/makeplane/plane/apps/go-api/internal/reaction"
	"github.com/makeplane/plane/apps/go-api/internal/relation"
	"github.com/makeplane/plane/apps/go-api/internal/state"
	"github.com/makeplane/plane/apps/go-api/internal/subissue"
	"github.com/makeplane/plane/apps/go-api/internal/subscriber"
	"github.com/makeplane/plane/apps/go-api/internal/tracking"
	"github.com/makeplane/plane/apps/go-api/internal/user"
	"github.com/makeplane/plane/apps/go-api/internal/workspace"
)

var version = "dev"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("database readiness configuration failed", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	migrationCtx, cancelMigrations := context.WithTimeout(ctx, 30*time.Second)
	if err = db.Migrate(migrationCtx); err != nil {
		cancelMigrations()
		logger.Error("database migration failed", "error", err)
		os.Exit(1)
	}
	cancelMigrations()
	trackingStore := tracking.PostgreSQLStore{Pool: db.Native()}
	if cfg.LegacyTrackingDir != "" {
		importCtx, cancelImport := context.WithTimeout(ctx, 30*time.Second)
		importStats, importErr := trackingStore.ImportLegacyJSON(importCtx, cfg.LegacyTrackingDir)
		cancelImport()
		if importErr != nil {
			logger.Error("legacy blockchain tracking import failed", "error", importErr)
			os.Exit(1)
		}
		logger.Info("legacy blockchain tracking import completed",
			"files", importStats.Files, "records", importStats.Records,
			"added", importStats.Added, "skipped", importStats.Skipped)
	}
	var legacyHandler http.Handler
	var instanceHandler http.Handler
	if cfg.LegacyAPIURL != "" {
		legacyHandler, err = legacy.NewProxy(cfg.LegacyAPIURL)
		if err != nil {
			logger.Error("legacy proxy initialization failed", "error", err)
			os.Exit(1)
		}
		instanceHandler, err = instance.NewHandler(cfg.LegacyAPIURL, 2*time.Minute)
		if err != nil {
			logger.Error("instance handler initialization failed", "error", err)
			os.Exit(1)
		}
	}
	server := &http.Server{
		Addr: cfg.Address,
		Handler: httpapi.NewRouter(httpapi.Dependencies{
			Readiness: db, Legacy: legacyHandler, Instance: instanceHandler,
			CSRF: auth.CSRFHandler{CookieDomain: cfg.CookieDomain},
			SignOut: auth.SignOutHandler{
				Store: auth.PostgreSQLSessionStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
				CookieDomain: cfg.CookieDomain, RedirectURL: cfg.AppBaseURL,
			},
			SignIn: auth.SignInHandler{
				Store: auth.PostgreSQLSignInStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
				CookieDomain: cfg.CookieDomain, AppBaseURL: cfg.AppBaseURL, SecretKey: cfg.SessionSecret,
				SessionAge: cfg.SessionAge,
			},
			ChangePassword: auth.PasswordHandler{Store: auth.PostgreSQLPasswordStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie, SecretKey: cfg.SessionSecret},
			SetPassword:    auth.PasswordHandler{Store: auth.PostgreSQLPasswordStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie, SecretKey: cfg.SessionSecret, SetOnly: true},
			EmailCheck: auth.EmailCheckHandler{Store: auth.PostgreSQLEmailCheckStore{
				Pool: db.Native(), EmailHost: cfg.EmailHost, EnableMagicLogin: cfg.EnableMagicLogin,
			}},
			ForgotPassword: auth.ForgotPasswordHandler{
				Store: auth.PostgreSQLForgotPasswordStore{Pool: db.Native()},
				Sender: auth.SMTPResetSender{
					Host: cfg.EmailHost, Port: cfg.EmailPort, Username: cfg.EmailHostUser,
					Password: cfg.EmailHostPassword, From: cfg.EmailFrom,
					UseTLS: cfg.EmailUseTLS, UseSSL: cfg.EmailUseSSL,
				},
				AppBaseURL: cfg.AppBaseURL, SecretKey: cfg.SessionSecret,
			},
			ResetPassword: auth.ResetPasswordHandler{
				Store:      auth.PostgreSQLResetPasswordStore{Pool: db.Native()},
				AppBaseURL: cfg.AppBaseURL, SecretKey: cfg.SessionSecret,
				Timeout: cfg.PasswordResetTimeout,
			},
			SignUp: auth.SignUpHandler{
				Store: auth.PostgreSQLSignUpStore{
					Pool: db.Native(), EnableSignUp: cfg.EnableSignUp,
					EnableEmailPassword: cfg.EnableEmailPassword,
				},
				SessionCookieName: cfg.SessionCookie, CookieDomain: cfg.CookieDomain,
				AppBaseURL: cfg.AppBaseURL, SecretKey: cfg.SessionSecret, SessionAge: cfg.SessionAge,
			},
			Tracking: tracking.Handler{
				Store: trackingStore,
				Verifier: blockchain.Verifier{Config: blockchain.Config{
					RPCURL: cfg.BlockchainRPCURL, ContractAddress: cfg.BlockchainContractAddress,
					ChainID: cfg.BlockchainChainID, RPCTimeout: cfg.BlockchainRPCTimeout,
					ReceiptWait: cfg.BlockchainReceiptWait,
				}},
				SessionCookieName: cfg.SessionCookie,
			},
			Workspaces: workspace.Handler{
				Store: workspace.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			CurrentUser: user.Handler{
				Store: user.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			UserProfile: user.ProfileHandler{
				Store: user.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			UserSettings: user.SettingsHandler{
				Store: user.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			ProjectsLite: project.Handler{
				Store: project.PostgreSQLStore{Pool: db.Native()}, Legacy: legacyHandler,
				SessionCookieName: cfg.SessionCookie,
			},
			Projects: project.Handler{
				Store: project.PostgreSQLStore{Pool: db.Native()}, Legacy: legacyHandler,
				SessionCookieName: cfg.SessionCookie, Detailed: true,
			},
			Project: project.Handler{
				Store: project.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie, Single: true,
			},
			States: state.Handler{
				Store: state.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			ProjectMembers: projectmember.Handler{
				Store: projectmember.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			}, ProjectMemberMe: projectmember.Handler{
				Store: projectmember.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
				Current: true,
			},
			Labels: label.Handler{
				Store: label.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Issues: issue.Handler{
				Store: issue.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Comments: comment.Handler{
				Store: comment.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Activities: activity.Handler{
				Store: activity.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Relations: relation.Handler{
				Store: relation.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Links: link.Handler{
				Store: link.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Reactions: reaction.Handler{
				Store: reaction.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Subscribers: subscriber.Handler{
				Store: subscriber.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Archives: archive.Handler{
				Store: archive.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Subissues: subissue.Handler{
				Store: subissue.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Favorites: favorite.Handler{
				Store: favorite.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Version: version,
		}),
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second,
		WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
	}
	go func() {
		logger.Info("Go API listening", "address", cfg.Address, "legacy_fallback", cfg.LegacyAPIURL != "")
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP server failed", "error", err)
			stop()
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}
