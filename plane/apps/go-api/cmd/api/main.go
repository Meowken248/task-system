package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/makeplane/plane/apps/go-api/internal/activity"
	"github.com/makeplane/plane/apps/go-api/internal/analytic"
	"github.com/makeplane/plane/apps/go-api/internal/apitoken"
	"github.com/makeplane/plane/apps/go-api/internal/archive"
	"github.com/makeplane/plane/apps/go-api/internal/asset"
	"github.com/makeplane/plane/apps/go-api/internal/auth"
	"github.com/makeplane/plane/apps/go-api/internal/blockchain"
	"github.com/makeplane/plane/apps/go-api/internal/comment"
	"github.com/makeplane/plane/apps/go-api/internal/commentreaction"
	"github.com/makeplane/plane/apps/go-api/internal/config"
	"github.com/makeplane/plane/apps/go-api/internal/cycle"
	"github.com/makeplane/plane/apps/go-api/internal/database"
	"github.com/makeplane/plane/apps/go-api/internal/estimate"
	"github.com/makeplane/plane/apps/go-api/internal/external"
	"github.com/makeplane/plane/apps/go-api/internal/favorite"
	"github.com/makeplane/plane/apps/go-api/internal/httpapi"
	"github.com/makeplane/plane/apps/go-api/internal/instance"
	"github.com/makeplane/plane/apps/go-api/internal/intake"
	"github.com/makeplane/plane/apps/go-api/internal/issue"
	"github.com/makeplane/plane/apps/go-api/internal/label"
	"github.com/makeplane/plane/apps/go-api/internal/link"
	"github.com/makeplane/plane/apps/go-api/internal/module"
	"github.com/makeplane/plane/apps/go-api/internal/notification"
	"github.com/makeplane/plane/apps/go-api/internal/page"
	"github.com/makeplane/plane/apps/go-api/internal/project"
	"github.com/makeplane/plane/apps/go-api/internal/projectmember"
	"github.com/makeplane/plane/apps/go-api/internal/reaction"
	"github.com/makeplane/plane/apps/go-api/internal/relation"
	"github.com/makeplane/plane/apps/go-api/internal/search"
	"github.com/makeplane/plane/apps/go-api/internal/state"
	"github.com/makeplane/plane/apps/go-api/internal/sticky"
	"github.com/makeplane/plane/apps/go-api/internal/storage"
	"github.com/makeplane/plane/apps/go-api/internal/subissue"
	"github.com/makeplane/plane/apps/go-api/internal/subscriber"
	goTimezone "github.com/makeplane/plane/apps/go-api/internal/timezone"
	"github.com/makeplane/plane/apps/go-api/internal/tracking"
	"github.com/makeplane/plane/apps/go-api/internal/user"
	"github.com/makeplane/plane/apps/go-api/internal/userproperty"
	"github.com/makeplane/plane/apps/go-api/internal/view"
	"github.com/makeplane/plane/apps/go-api/internal/webhook"
	"github.com/makeplane/plane/apps/go-api/internal/worker"
	"github.com/makeplane/plane/apps/go-api/internal/workspace"
	"github.com/makeplane/plane/apps/go-api/internal/workspacecontext"
	"github.com/makeplane/plane/apps/go-api/internal/workspaceinvite"
	"github.com/makeplane/plane/apps/go-api/internal/workspacemember"
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

	workerManager := worker.NewManager(db.Native(), logger)
	workerManager.Start()
	defer workerManager.Stop()

	var storageProvider storage.Provider
	if cfg.AWSS3BucketName != "" && cfg.AWSS3EndpointURL != "" {
		s3Provider, err := storage.NewS3(
			cfg.AWSS3EndpointURL,
			cfg.AWSAccessKeyID,
			cfg.AWSSecretAccessKey,
			cfg.AWSRegion,
			cfg.AWSS3BucketName,
			cfg.AWSS3PublicEndpointURL,
			cfg.MinioEndpointSSL,
			cfg.SignedURLExpiration,
		)
		if err != nil {
			logger.Error("Failed to initialize S3 storage provider", "error", err)
			os.Exit(1)
		}
		storageProvider = s3Provider
	} else {
		storageProvider = &storage.Local{BaseDir: "./media", BaseURL: cfg.AppBaseURL + "/api/assets/v2"}
	}

	server := &http.Server{
		Addr: cfg.Address,
		Handler: httpapi.NewRouter(httpapi.Dependencies{
			Readiness: db,
			CSRF:      auth.CSRFHandler{CookieDomain: cfg.CookieDomain},
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
			WorkspaceMemberMe: workspacecontext.Handler{
				Store: workspacecontext.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
				Mode: workspacecontext.ModeCurrentMember,
			},
			WorkspaceMembers: workspacemember.Handler{
				Store: workspacemember.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			WorkspaceLeave: workspacemember.Handler{
				Store: workspacemember.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
				Leave: true,
			},
			WorkspaceInvitations: workspaceinvite.Handler{
				Store:             workspaceinvite.PostgreSQLStore{Pool: db.Native(), SecretKey: cfg.SessionSecret},
				SessionCookieName: cfg.SessionCookie,
			},
			WorkspaceInvitationJoin: workspaceinvite.Handler{
				Store:             workspaceinvite.PostgreSQLStore{Pool: db.Native(), SecretKey: cfg.SessionSecret},
				SessionCookieName: cfg.SessionCookie, Mode: workspaceinvite.ModeJoin,
			},
			UserWorkspaceInvitations: workspaceinvite.Handler{
				Store:             workspaceinvite.PostgreSQLStore{Pool: db.Native(), SecretKey: cfg.SessionSecret},
				SessionCookieName: cfg.SessionCookie, Mode: workspaceinvite.ModeUser,
			},
			APITokens: apitoken.Handler{
				Store: apitoken.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Webhooks: webhook.Handler{
				Store: webhook.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
				AllowedHosts: cfg.WebhookAllowedHosts, AllowedCIDRs: parseCIDRs(cfg.WebhookAllowedIPs),
				DisallowedDomains: cfg.WebhookDisallowedDomains,
			},
			RecentVisits: workspacecontext.Handler{
				Store: workspacecontext.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
				Mode: workspacecontext.ModeRecentVisits,
			},
			SidebarPreferences: workspacecontext.Handler{
				Store: workspacecontext.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
				Mode: workspacecontext.ModeSidebarPreferences,
			},
			UserProperties: workspacecontext.Handler{
				Store: workspacecontext.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
				Mode: workspacecontext.ModeUserProperties,
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
				Store:             project.PostgreSQLStore{Pool: db.Native()},
				SessionCookieName: cfg.SessionCookie,
			},
			Projects: project.Handler{
				Store:             project.PostgreSQLStore{Pool: db.Native()},
				SessionCookieName: cfg.SessionCookie, Detailed: true,
			},
			Project: project.Handler{
				Store: project.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie, Single: true,
			},
			ProjectUserProperties: userproperty.Handler{
				Store: userproperty.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
				Scope: userproperty.ScopeProject,
			},
			CycleUserProperties: userproperty.Handler{
				Store: userproperty.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
				Scope: userproperty.ScopeCycle,
			},
			ModuleUserProperties: userproperty.Handler{
				Store: userproperty.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
				Scope: userproperty.ScopeModule,
			},
			States: state.Handler{
				Store: state.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			ProjectMembers: projectmember.Handler{
				Store: projectmember.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			ProjectMemberMe: projectmember.Handler{
				Store: projectmember.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
				Current: true,
			},
			Notification: notification.Handler{Store: notification.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie},
			Estimate:     estimate.Handler{Store: estimate.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie},
			Search:       search.Handler{Store: search.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie},
			Analytic:     analytic.Handler{Store: analytic.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie},
			Instances: instance.NewHandler(instance.PostgreSQLStore{Pool: db.Native()}, cfg.AdminSessionCookie).
				ConfigureSession(cfg.SessionSecret, cfg.CookieDomain, cfg.SessionAge),
			Intake: intake.Handler{Store: intake.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie},
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
			Stickies: sticky.Handler{
				Store: sticky.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Cycles: cycle.Handler{
				Store: cycle.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Modules: module.Handler{
				Store: module.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Views: view.Handler{
				Store: view.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			CommentReactions: commentreaction.Handler{
				Store: commentreaction.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Assets: asset.Handler{
				Store: asset.PostgreSQLStore{
					Pool:     db.Native(),
					Provider: storageProvider,
				},
				SessionCookieName: cfg.SessionCookie,
			},
			Timezones: goTimezone.Handler{},
			Unsplash: external.UnsplashHandler{
				Store: external.PostgreSQLUnsplashStore{
					Pool: db.Native(), FallbackKey: cfg.UnsplashAccessKey, UseDatabaseKey: cfg.SkipEnvVar,
				},
				SessionCookieName: cfg.SessionCookie,
			},
			Pages: page.Handler{
				Store: page.PostgreSQLStore{Pool: db.Native()}, SessionCookieName: cfg.SessionCookie,
			},
			Version:      version,
			LegacyAPIURL: cfg.LegacyAPIURL,
		}),
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second,
		WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
	}
	go func() {
		logger.Info("Go API listening", "address", cfg.Address, "legacy_fallback", cfg.LegacyAPIURL != "")
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server error", "error", err)
			os.Exit(1)
		}
	}()
	<-ctx.Done()
	logger.Info("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("server shutdown failed", "error", err)
	}
}

func parseCIDRs(values []string) []*net.IPNet {
	result := make([]*net.IPNet, 0, len(values))
	for _, value := range values {
		if ip := net.ParseIP(value); ip != nil {
			bits := 128
			if ip.To4() != nil {
				bits = 32
			}
			result = append(result, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
			continue
		}
		if _, network, err := net.ParseCIDR(value); err == nil {
			result = append(result, network)
		}
	}
	return result
}
