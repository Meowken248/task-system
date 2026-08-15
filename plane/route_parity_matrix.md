# Route Parity Matrix
Generated matrix containing all required parity fields.

## /__debug__
| Django Route | Methods | Python View | Go Handler | Auth/Perms | Status | Notes |
|---|---|---|---|---|---|---|
| `/__debug__/history_refresh/` | DELETE, GET, PATCH, POST, PUT | `debug_toolbar.panels.history.views.history_refresh` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/__debug__/history_sidebar/` | DELETE, GET, PATCH, POST, PUT | `debug_toolbar.panels.history.views.history_sidebar` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/__debug__/render_panel/` | DELETE, GET, PATCH, POST, PUT | `debug_toolbar.views.render_panel` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/__debug__/sql_explain/` | DELETE, GET, PATCH, POST, PUT | `debug_toolbar.panels.sql.views.sql_explain` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/__debug__/sql_profile/` | DELETE, GET, PATCH, POST, PUT | `debug_toolbar.panels.sql.views.sql_profile` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/__debug__/sql_select/` | DELETE, GET, PATCH, POST, PUT | `debug_toolbar.panels.sql.views.sql_select` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/__debug__/template_source/` | DELETE, GET, PATCH, POST, PUT | `debug_toolbar.panels.templates.views.template_source` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |

## /assets
| Django Route | Methods | Python View | Go Handler | Auth/Perms | Status | Notes |
|---|---|---|---|---|---|---|
| `/api/assets/v2/static/<uuid:asset_id>/` | GET | `plane.app.views.asset.v2.StaticFileAssetEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/assets/v2/user-assets/` | DELETE, PATCH, POST | `plane.app.views.asset.v2.UserAssetsV2Endpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/assets/v2/user-assets/<uuid:asset_id>/` | DELETE, PATCH, POST | `plane.app.views.asset.v2.UserAssetsV2Endpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/assets/v2/workspaces/<str:slug>/` | DELETE, GET, PATCH, POST | `plane.app.views.asset.v2.WorkspaceFileAssetEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/assets/v2/workspaces/<str:slug>/<uuid:asset_id>/` | DELETE, GET, PATCH, POST | `plane.app.views.asset.v2.WorkspaceFileAssetEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/assets/v2/workspaces/<str:slug>/check/<uuid:asset_id>/` | GET | `plane.app.views.asset.v2.AssetCheckEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/assets/v2/workspaces/<str:slug>/download/<uuid:asset_id>/` | GET | `plane.app.views.asset.v2.WorkspaceAssetDownloadEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/assets/v2/workspaces/<str:slug>/duplicate-assets/<uuid:asset_id>/` | POST | `plane.app.views.asset.v2.DuplicateAssetEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/` | DELETE, GET, PATCH, POST | `plane.app.views.asset.v2.ProjectAssetEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/<uuid:entity_id>/bulk/` | POST | `plane.app.views.asset.v2.ProjectBulkAssetEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/<uuid:pk>/` | DELETE, GET, PATCH, POST | `plane.app.views.asset.v2.ProjectAssetEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/download/<uuid:asset_id>/` | GET | `plane.app.views.asset.v2.ProjectAssetDownloadEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/attachments/` | DELETE, GET, PATCH, POST | `plane.app.views.issue.attachment.IssueAttachmentV2Endpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/attachments/<uuid:pk>/` | DELETE, GET, PATCH, POST | `plane.app.views.issue.attachment.IssueAttachmentV2Endpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/assets/v2/workspaces/<str:slug>/restore/<uuid:asset_id>/` | POST | `plane.app.views.asset.v2.AssetRestoreEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |

## /auth
| Django Route | Methods | Python View | Go Handler | Auth/Perms | Status | Notes |
|---|---|---|---|---|---|---|
| `/auth/change-password/` | POST | `plane.authentication.views.common.ChangePasswordEndpoint` | `TBD` | Auth: SessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/auth/email-check/` | POST | `plane.authentication.views.app.check.EmailCheckEndpoint` | `TBD` | Auth: SessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/auth/forgot-password/` | POST | `plane.authentication.views.app.password_management.ForgotPasswordEndpoint` | `TBD` | Auth: SessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/auth/get-csrf-token/` | GET | `plane.authentication.views.common.CSRFTokenEndpoint` | `TBD` | Auth: SessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/auth/gitea/` | GET | `plane.authentication.views.app.gitea.GiteaOauthInitiateEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/gitea/callback/` | GET | `plane.authentication.views.app.gitea.GiteaCallbackEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/github/` | GET | `plane.authentication.views.app.github.GitHubOauthInitiateEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/github/callback/` | GET | `plane.authentication.views.app.github.GitHubCallbackEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/gitlab/` | GET | `plane.authentication.views.app.gitlab.GitLabOauthInitiateEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/gitlab/callback/` | GET | `plane.authentication.views.app.gitlab.GitLabCallbackEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/google/` | GET | `plane.authentication.views.app.google.GoogleOauthInitiateEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/google/callback/` | GET | `plane.authentication.views.app.google.GoogleCallbackEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/magic-generate/` | POST | `plane.authentication.views.app.magic.MagicGenerateEndpoint` | `TBD` | Auth: SessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/auth/magic-sign-in/` | POST | `plane.authentication.views.app.magic.MagicSignInEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/magic-sign-up/` | POST | `plane.authentication.views.app.magic.MagicSignUpEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/reset-password/<uidb64>/<token>/` | POST | `plane.authentication.views.app.password_management.ResetPasswordEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/set-password/` | POST | `plane.authentication.views.common.SetUserPasswordEndpoint` | `TBD` | Auth: SessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/auth/sign-in/` | POST | `plane.authentication.views.app.email.SignInAuthEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/sign-out/` | POST | `plane.authentication.views.app.signout.SignOutAuthEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/sign-up/` | POST | `plane.authentication.views.app.email.SignUpAuthEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/spaces/email-check/` | POST | `plane.authentication.views.space.check.EmailCheckSpaceEndpoint` | `TBD` | Auth: SessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/auth/spaces/forgot-password/` | POST | `plane.authentication.views.space.password_management.ForgotPasswordSpaceEndpoint` | `TBD` | Auth: SessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/auth/spaces/gitea/` | GET | `plane.authentication.views.space.gitea.GiteaOauthInitiateSpaceEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/spaces/gitea/callback/` | GET | `plane.authentication.views.space.gitea.GiteaCallbackSpaceEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/spaces/github/` | GET | `plane.authentication.views.space.github.GitHubOauthInitiateSpaceEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/spaces/github/callback/` | GET | `plane.authentication.views.space.github.GitHubCallbackSpaceEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/spaces/gitlab/` | GET | `plane.authentication.views.space.gitlab.GitLabOauthInitiateSpaceEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/spaces/gitlab/callback/` | GET | `plane.authentication.views.space.gitlab.GitLabCallbackSpaceEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/spaces/google/` | GET | `plane.authentication.views.space.google.GoogleOauthInitiateSpaceEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/spaces/google/callback/` | GET | `plane.authentication.views.space.google.GoogleCallbackSpaceEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/spaces/magic-generate/` | POST | `plane.authentication.views.space.magic.MagicGenerateSpaceEndpoint` | `TBD` | Auth: SessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/auth/spaces/magic-sign-in/` | POST | `plane.authentication.views.space.magic.MagicSignInSpaceEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/spaces/magic-sign-up/` | POST | `plane.authentication.views.space.magic.MagicSignUpSpaceEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/spaces/reset-password/<uidb64>/<token>/` | POST | `plane.authentication.views.space.password_management.ResetPasswordSpaceEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/spaces/sign-in/` | POST | `plane.authentication.views.space.email.SignInAuthSpaceEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/spaces/sign-out/` | POST | `plane.authentication.views.space.signout.SignOutAuthSpaceEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/auth/spaces/sign-up/` | POST | `plane.authentication.views.space.email.SignUpAuthSpaceEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |

## /instances
| Django Route | Methods | Python View | Go Handler | Auth/Perms | Status | Notes |
|---|---|---|---|---|---|---|
| `/api/instances/` | GET, PATCH | `plane.license.api.views.instance.InstanceEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/instances/admins/` | DELETE, GET, POST | `plane.license.api.views.admin.InstanceAdminEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: InstanceAdminPermission | ⏳ legacy |  |
| `/api/instances/admins/<uuid:pk>/` | DELETE, GET, POST | `plane.license.api.views.admin.InstanceAdminEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: InstanceAdminPermission | ⏳ legacy |  |
| `/api/instances/admins/me/` | GET | `plane.license.api.views.admin.InstanceAdminUserMeEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: InstanceAdminPermission | ⏳ legacy |  |
| `/api/instances/admins/session/` | GET | `plane.license.api.views.admin.InstanceAdminUserSessionEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/instances/admins/sign-in/` | POST | `plane.license.api.views.admin.InstanceAdminSignInEndpoint` | `TBD` | Auth: <br>Perms: AllowAny | ⏳ legacy |  |
| `/api/instances/admins/sign-out/` | POST | `plane.license.api.views.admin.InstanceAdminSignOutEndpoint` | `TBD` | Auth: <br>Perms: InstanceAdminPermission | ⏳ legacy |  |
| `/api/instances/admins/sign-up-screen-visited/` | POST | `plane.license.api.views.instance.SignUpScreenVisitedEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/instances/admins/sign-up/` | POST | `plane.license.api.views.admin.InstanceAdminSignUpEndpoint` | `TBD` | Auth: <br>Perms: AllowAny | ⏳ legacy |  |
| `/api/instances/configurations/` | GET, PATCH | `plane.license.api.views.configuration.InstanceConfigurationEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: InstanceAdminPermission | ⏳ legacy |  |
| `/api/instances/configurations/disable-email-feature/` | DELETE | `plane.license.api.views.configuration.DisableEmailFeatureEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: InstanceAdminPermission | ⏳ legacy |  |
| `/api/instances/email-credentials-check/` | POST | `plane.license.api.views.configuration.EmailCredentialCheckEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: InstanceAdminPermission | ⏳ legacy |  |
| `/api/instances/workspace-slug-check/` | GET | `plane.license.api.views.workspace.InstanceWorkSpaceAvailabilityCheckEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: InstanceAdminPermission | ⏳ legacy |  |
| `/api/instances/workspaces/` | GET, POST | `plane.license.api.views.workspace.InstanceWorkSpaceEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: InstanceAdminPermission | ⏳ legacy |  |

## /other
| Django Route | Methods | Python View | Go Handler | Auth/Perms | Status | Notes |
|---|---|---|---|---|---|---|
| `/` | DELETE, GET, PATCH, POST, PUT | `plane.web.views.health_check` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |

## /public
| Django Route | Methods | Python View | Go Handler | Auth/Perms | Status | Notes |
|---|---|---|---|---|---|---|
| `/api/public/anchor/<str:anchor>/comments/<uuid:comment_id>/reactions/` | GET, POST | `plane.space.views.issue.CommentReactionPublicViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/comments/<uuid:comment_id>/reactions/<str:reaction_code>/` | DELETE | `plane.space.views.issue.CommentReactionPublicViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/cycles/` | GET | `plane.space.views.cycle.ProjectCyclesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/intakes/<uuid:intake_id>/inbox-issues/` | GET, POST | `plane.space.views.intake.IntakeIssuePublicViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/intakes/<uuid:intake_id>/intake-issues/` | GET, POST | `plane.space.views.intake.IntakeIssuePublicViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/intakes/<uuid:intake_id>/intake-issues/<uuid:pk>/` | DELETE, GET, PATCH | `plane.space.views.intake.IntakeIssuePublicViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/issues/` | GET | `plane.space.views.issue.ProjectIssuesPublicEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/` | GET | `plane.space.views.issue.IssueRetrievePublicEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/comments/` | GET, POST | `plane.space.views.issue.IssueCommentPublicViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/comments/<uuid:pk>/` | DELETE, GET, PATCH | `plane.space.views.issue.IssueCommentPublicViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/reactions/` | GET, POST | `plane.space.views.issue.IssueReactionPublicViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/reactions/<str:reaction_code>/` | DELETE | `plane.space.views.issue.IssueReactionPublicViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/votes/` | DELETE, GET, POST | `plane.space.views.issue.IssueVotePublicViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/labels/` | GET | `plane.space.views.label.ProjectLabelsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/members/` | GET | `plane.space.views.project.ProjectMembersEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/meta/` | GET | `plane.space.views.meta.ProjectMetaDataEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/modules/` | GET | `plane.space.views.module.ProjectModulesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/settings/` | GET | `plane.space.views.project.ProjectDeployBoardPublicSettingsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/public/anchor/<str:anchor>/states/` | GET | `plane.space.views.state.ProjectStatesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/public/assets/v2/anchor/<str:anchor>/` | DELETE, GET, PATCH, POST | `plane.space.views.asset.EntityAssetEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/public/assets/v2/anchor/<str:anchor>/<uuid:entity_id>/bulk/` | POST | `plane.space.views.asset.EntityBulkAssetEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/public/assets/v2/anchor/<str:anchor>/<uuid:pk>/` | DELETE, GET, PATCH, POST | `plane.space.views.asset.EntityAssetEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/public/assets/v2/anchor/<str:anchor>/restore/<uuid:pk>/` | POST | `plane.space.views.asset.AssetRestoreEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/public/workspaces/<str:slug>/project-boards/` | GET | `plane.space.views.project.WorkspaceProjectDeployBoardEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/public/workspaces/<str:slug>/projects/<uuid:project_id>/anchor/` | GET | `plane.space.views.project.WorkspaceProjectAnchorEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |

## /robots.txt
| Django Route | Methods | Python View | Go Handler | Auth/Perms | Status | Notes |
|---|---|---|---|---|---|---|
| `/robots.txt` | DELETE, GET, PATCH, POST, PUT | `plane.web.views.robots_txt` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |

## /timezones
| Django Route | Methods | Python View | Go Handler | Auth/Perms | Status | Notes |
|---|---|---|---|---|---|---|
| `/api/timezones/` | GET | `plane.app.views.timezone.base.TimezoneEndpoint` | `TBD` | Auth: SessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |

## /unsplash
| Django Route | Methods | Python View | Go Handler | Auth/Perms | Status | Notes |
|---|---|---|---|---|---|---|
| `/api/unsplash/` | GET | `plane.app.views.external.base.UnsplashEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |

## /users
| Django Route | Methods | Python View | Go Handler | Auth/Perms | Status | Notes |
|---|---|---|---|---|---|---|
| `/api/users/api-tokens/` | DELETE, GET, PATCH, POST | `plane.app.views.api.ApiTokenEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/api-tokens/<uuid:pk>/` | DELETE, GET, PATCH, POST | `plane.app.views.api.ApiTokenEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/file-assets/` | DELETE, GET, POST | `plane.app.views.asset.base.UserAssetsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/file-assets/<str:asset_key>/` | DELETE, GET, POST | `plane.app.views.asset.base.UserAssetsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/last-visited-workspace/` | GET | `plane.app.views.workspace.user.UserLastProjectWithWorkspaceEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/me/` | DELETE, GET, PATCH | `plane.app.views.user.base.UserEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/users/me/accounts/` | DELETE, GET | `plane.app.views.user.base.AccountEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/me/accounts/<uuid:pk>/` | DELETE, GET | `plane.app.views.user.base.AccountEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/me/activities/` | GET | `plane.app.views.user.base.UserActivityEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/me/email/` | PATCH | `plane.app.views.user.base.UserEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/users/me/email/generate-code/` | POST | `plane.app.views.user.base.UserEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/users/me/instance-admin/` | GET | `plane.app.views.user.base.UserEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/users/me/notification-preferences/` | GET, PATCH | `plane.app.views.notification.base.UserNotificationPreferenceEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/me/onboard/` | PATCH | `plane.app.views.user.base.UpdateUserOnBoardedEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/me/profile/` | GET, PATCH | `plane.app.views.user.base.ProfileEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/me/settings/` | GET | `plane.app.views.user.base.UserEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/users/me/tour-completed/` | PATCH | `plane.app.views.user.base.UpdateUserTourCompletedEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/me/workspaces/` | GET | `plane.app.views.workspace.base.UserWorkSpacesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/me/workspaces/<str:slug>/activity-graph/` | GET | `plane.app.views.workspace.user.UserActivityGraphEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/me/workspaces/<str:slug>/dashboard/` | GET | `plane.app.views.workspace.base.UserWorkspaceDashboardEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/me/workspaces/<str:slug>/issues-completed-graph/` | GET | `plane.app.views.workspace.user.UserIssueCompletedGraphEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/users/me/workspaces/<str:slug>/project-roles/` | GET | `plane.app.views.project.member.UserProjectRolesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: WorkspaceUserPermission | ⏳ legacy |  |
| `/api/users/me/workspaces/<str:slug>/projects/invitations/` | GET, POST | `plane.app.views.project.invite.UserProjectInvitationsViewset` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/users/me/workspaces/invitations/` | GET, POST | `plane.app.views.workspace.invite.UserWorkspaceInvitationsViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/users/session/` | GET | `plane.app.views.user.base.UserSessionEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |

## /v1
| Django Route | Methods | Python View | Go Handler | Auth/Perms | Status | Notes |
|---|---|---|---|---|---|---|
| `/api/v1/assets/user-assets/` | DELETE, PATCH, POST | `plane.api.views.asset.UserAssetEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/v1/assets/user-assets/<uuid:asset_id>/` | DELETE, PATCH, POST | `plane.api.views.asset.UserAssetEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/v1/assets/user-assets/<uuid:asset_id>/server/` | DELETE, PATCH, POST | `plane.api.views.asset.UserServerAssetEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/v1/assets/user-assets/server/` | DELETE, PATCH, POST | `plane.api.views.asset.UserServerAssetEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/v1/users/me/` | GET | `plane.api.views.user.UserEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/` | GET | `rest_framework.routers.APIRootView` | `TBD` | Auth: SessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/<drf_format_suffix:format>` | GET | `rest_framework.routers.APIRootView` | `TBD` | Auth: SessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/assets/` | GET, PATCH, POST | `plane.api.views.asset.GenericAssetEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/assets/<uuid:asset_id>/` | GET, PATCH, POST | `plane.api.views.asset.GenericAssetEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/invitations/` | GET, POST | `plane.api.views.invite.WorkspaceInvitationsViewset` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/invitations/(?P<pk>[/.]+)/` | DELETE, GET, PATCH, PUT | `plane.api.views.invite.WorkspaceInvitationsViewset` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/invitations/(?P<pk>[/.]+)\.(?P<format>[a-z0-9]+)/?` | DELETE, GET, PATCH, PUT | `plane.api.views.invite.WorkspaceInvitationsViewset` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/invitations\.(?P<format>[a-z0-9]+)/?` | GET, POST | `plane.api.views.invite.WorkspaceInvitationsViewset` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/issues/<str:project_identifier>-<str:issue_identifier>/` | GET | `plane.api.views.issue.WorkspaceIssueAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/issues/search/` | GET | `plane.api.views.issue.IssueSearchEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/members/` | GET | `plane.api.views.member.WorkspaceMemberAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: WorkSpaceAdminPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/` | GET, POST | `plane.api.views.project.ProjectListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectBasePermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:pk>/` | DELETE, GET, PATCH | `plane.api.views.project.ProjectDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectBasePermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/archive/` | DELETE, POST | `plane.api.views.project.ProjectArchiveUnarchiveAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectBasePermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/archived-cycles/` | DELETE, GET, POST | `plane.api.views.cycle.CycleArchiveUnarchiveAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/archived-cycles/<uuid:cycle_id>/unarchive/` | DELETE, GET, POST | `plane.api.views.cycle.CycleArchiveUnarchiveAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/archived-modules/` | DELETE, GET, POST | `plane.api.views.module.ModuleArchiveUnarchiveAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/archived-modules/<uuid:pk>/unarchive/` | DELETE, GET, POST | `plane.api.views.module.ModuleArchiveUnarchiveAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/` | GET, POST | `plane.api.views.cycle.CycleListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/archive/` | DELETE, GET, POST | `plane.api.views.cycle.CycleArchiveUnarchiveAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/cycle-issues/` | GET, POST | `plane.api.views.cycle.CycleIssueListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/cycle-issues/<uuid:issue_id>/` | DELETE, GET | `plane.api.views.cycle.CycleIssueDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/transfer-issues/` | POST | `plane.api.views.cycle.TransferCycleIssueAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:pk>/` | DELETE, GET, PATCH | `plane.api.views.cycle.CycleDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/intake-issues/` | GET, POST | `plane.api.views.intake.IntakeIssueListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectLitePermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/intake-issues/<uuid:issue_id>/` | DELETE, GET, PATCH | `plane.api.views.intake.IntakeIssueDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectLitePermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/` | GET, POST | `plane.api.views.issue.IssueListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: FiaiTaskPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/activities/` | GET | `plane.api.views.issue.IssueActivityListAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/activities/<uuid:pk>/` | GET | `plane.api.views.issue.IssueActivityDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/comments/` | GET, POST | `plane.api.views.issue.IssueCommentListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectLitePermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/comments/<uuid:pk>/` | DELETE, GET, PATCH | `plane.api.views.issue.IssueCommentDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectLitePermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-attachments/` | GET, POST | `plane.api.views.issue.IssueAttachmentListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-attachments/<uuid:pk>/` | DELETE, GET, PATCH | `plane.api.views.issue.IssueAttachmentDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/links/` | GET, POST | `plane.api.views.issue.IssueLinkListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/links/<uuid:pk>/` | DELETE, GET, PATCH | `plane.api.views.issue.IssueLinkDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:pk>/` | DELETE, GET, PATCH, PUT | `plane.api.views.issue.IssueDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: FiaiTaskPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/labels/` | GET, POST | `plane.api.views.issue.LabelListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectMemberPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/labels/<uuid:pk>/` | DELETE, GET, PATCH, POST | `plane.api.views.issue.LabelDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectMemberPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/members/` | GET, POST | `plane.api.views.member.ProjectMemberListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectMemberPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/members/<uuid:pk>/` | DELETE, GET, PATCH, POST | `plane.api.views.member.ProjectMemberDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectMemberPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/modules/` | GET, POST | `plane.api.views.module.ModuleListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-issues/` | GET, POST | `plane.api.views.module.ModuleIssueListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-issues/<uuid:issue_id>/` | DELETE, GET | `plane.api.views.module.ModuleIssueDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:pk>/` | DELETE, GET, PATCH | `plane.api.views.module.ModuleDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:pk>/archive/` | DELETE, GET, POST | `plane.api.views.module.ModuleArchiveUnarchiveAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/project-members/` | GET, POST | `plane.api.views.member.ProjectMemberListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectMemberPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/project-members/<uuid:pk>/` | DELETE, GET, PATCH, POST | `plane.api.views.member.ProjectMemberDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectMemberPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/states/` | GET, POST | `plane.api.views.state.StateListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/states/<uuid:state_id>/` | DELETE, GET, PATCH | `plane.api.views.state.StateDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/summary/` | GET | `plane.api.views.project.ProjectSummaryAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: WorkSpaceAdminPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/` | GET, POST | `plane.api.views.issue.IssueListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: FiaiTaskPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/activities/` | GET | `plane.api.views.issue.IssueActivityListAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/activities/<uuid:pk>/` | GET | `plane.api.views.issue.IssueActivityDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/attachments/` | GET, POST | `plane.api.views.issue.IssueAttachmentListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/attachments/<uuid:pk>/` | DELETE, GET, PATCH | `plane.api.views.issue.IssueAttachmentDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/comments/` | GET, POST | `plane.api.views.issue.IssueCommentListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectLitePermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/comments/<uuid:pk>/` | DELETE, GET, PATCH | `plane.api.views.issue.IssueCommentDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectLitePermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/links/` | GET, POST | `plane.api.views.issue.IssueLinkListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/links/<uuid:pk>/` | DELETE, GET, PATCH | `plane.api.views.issue.IssueLinkDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/relations/` | GET, POST | `plane.api.views.issue.IssueRelationListCreateAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:pk>/` | DELETE, GET, PATCH, PUT | `plane.api.views.issue.IssueDetailAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: FiaiTaskPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/stickies/` | GET, POST | `plane.api.views.sticky.StickyViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/stickies/(?P<pk>[/.]+)/` | DELETE, GET, PATCH, PUT | `plane.api.views.sticky.StickyViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/stickies/(?P<pk>[/.]+)\.(?P<format>[a-z0-9]+)/?` | DELETE, GET, PATCH, PUT | `plane.api.views.sticky.StickyViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/stickies\.(?P<format>[a-z0-9]+)/?` | GET, POST | `plane.api.views.sticky.StickyViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/work-items/<str:project_identifier>-<str:issue_identifier>/` | GET | `plane.api.views.issue.WorkspaceIssueAPIEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/v1/workspaces/<str:slug>/work-items/search/` | GET | `plane.api.views.issue.IssueSearchEndpoint` | `TBD` | Auth: APIKeyAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |

## /workspace-slug-check
| Django Route | Methods | Python View | Go Handler | Auth/Perms | Status | Notes |
|---|---|---|---|---|---|---|
| `/api/workspace-slug-check/` | GET | `plane.app.views.workspace.base.WorkSpaceAvailabilityCheckEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |

## /workspaces
| Django Route | Methods | Python View | Go Handler | Auth/Perms | Status | Notes |
|---|---|---|---|---|---|---|
| `/api/workspaces/` | GET, POST | `plane.app.views.workspace.base.WorkSpaceViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/` | DELETE, GET, PATCH, PUT | `plane.app.views.workspace.base.WorkSpaceViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/advance-analytics-charts/` | GET | `plane.app.views.analytic.advance.AdvanceAnalyticsChartEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/advance-analytics-stats/` | GET | `plane.app.views.analytic.advance.AdvanceAnalyticsStatsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/advance-analytics/` | GET | `plane.app.views.analytic.advance.AdvanceAnalyticsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/ai-assistant/` | POST | `plane.app.views.external.base.WorkspaceGPTIntegrationEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/analytic-view/` | GET, POST | `plane.app.views.analytic.base.AnalyticViewViewset` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/analytic-view/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.analytic.base.AnalyticViewViewset` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/analytics/` | GET | `plane.app.views.analytic.base.AnalyticsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/cycles/` | GET | `plane.app.views.workspace.cycle.WorkspaceCyclesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: WorkspaceViewerPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/default-analytics/` | GET | `plane.app.views.analytic.base.DefaultAnalyticsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/draft-issues/` | GET, POST | `plane.app.views.workspace.draft.WorkspaceDraftIssueViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/draft-issues/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.workspace.draft.WorkspaceDraftIssueViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/draft-to-issue/<uuid:draft_id>/` | POST | `plane.app.views.workspace.draft.WorkspaceDraftIssueViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/entity-search/` | GET | `plane.app.views.search.base.SearchEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/estimates/` | GET | `plane.app.views.workspace.estimate.WorkspaceEstimatesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: WorkspaceEntityPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/export-analytics/` | POST | `plane.app.views.analytic.base.ExportAnalyticsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/export-issues/` | GET, POST | `plane.app.views.exporter.base.ExportIssuesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/file-assets/` | DELETE, GET, POST | `plane.app.views.asset.base.FileAssetEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/home-preferences/` | GET, PATCH | `plane.app.views.workspace.home.WorkspaceHomePreferenceViewSet` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/home-preferences/<str:key>/` | GET, PATCH | `plane.app.views.workspace.home.WorkspaceHomePreferenceViewSet` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/invitations/` | GET, POST | `plane.app.views.workspace.invite.WorkspaceInvitationsViewset` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/invitations/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.workspace.invite.WorkspaceInvitationsViewset` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/invitations/<uuid:pk>/join/` | GET, POST | `plane.app.views.workspace.invite.WorkspaceJoinEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/issues/` | GET | `plane.app.views.view.base.WorkspaceViewIssuesViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/labels/` | GET | `plane.app.views.workspace.label.WorkspaceLabelsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: WorkspaceViewerPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/members/` | GET | `plane.app.views.workspace.member.WorkSpaceMemberViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/members/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.workspace.member.WorkSpaceMemberViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/members/leave/` | POST | `plane.app.views.workspace.member.WorkSpaceMemberViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/modules/` | GET | `plane.app.views.workspace.module.WorkspaceModulesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: WorkspaceViewerPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/project-identifiers/` | DELETE, GET | `plane.app.views.project.base.ProjectIdentifierEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/project-members/` | GET | `plane.app.views.workspace.member.WorkspaceProjectMemberEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: WorkspaceEntityPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/project-stats/` | GET | `plane.app.views.analytic.base.ProjectStatsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/` | GET, POST | `plane.app.views.project.base.ProjectViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:pk>/` | DELETE, GET, PATCH, PUT | `plane.app.views.project.base.ProjectViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/advance-analytics-charts/` | GET | `plane.app.views.analytic.project_analytics.ProjectAdvanceAnalyticsChartEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/advance-analytics-stats/` | GET | `plane.app.views.analytic.project_analytics.ProjectAdvanceAnalyticsStatsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/advance-analytics/` | GET | `plane.app.views.analytic.project_analytics.ProjectAdvanceAnalyticsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/ai-assistant/` | POST | `plane.app.views.external.base.GPTIntegrationEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/archive/` | DELETE, POST | `plane.app.views.project.base.ProjectArchiveUnarchiveEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/archived-cycles/` | DELETE, GET, POST | `plane.app.views.cycle.archive.CycleArchiveUnarchiveEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/archived-cycles/<uuid:pk>/` | DELETE, GET, POST | `plane.app.views.cycle.archive.CycleArchiveUnarchiveEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/archived-issues/` | GET | `plane.app.views.issue.archive.IssueArchiveViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/archived-modules/` | DELETE, GET, POST | `plane.app.views.module.archive.ModuleArchiveUnarchiveEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/archived-modules/<uuid:pk>/` | DELETE, GET, POST | `plane.app.views.module.archive.ModuleArchiveUnarchiveEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/blockchain-transactions/` | GET, POST | `plane.api.views.blockchain_tracking.BlockchainTrackingEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/bulk-archive-issues/` | POST | `plane.app.views.issue.archive.BulkArchiveIssuesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/bulk-create-labels/` | POST | `plane.app.views.issue.label.BulkCreateIssueLabelsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/bulk-delete-issues/` | DELETE | `plane.app.views.issue.base.BulkDeleteIssuesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/comments/<uuid:comment_id>/reactions/` | GET, POST | `plane.app.views.issue.comment.CommentReactionViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/comments/<uuid:comment_id>/reactions/<str:reaction_code>/` | DELETE | `plane.app.views.issue.comment.CommentReactionViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/` | GET, POST | `plane.app.views.cycle.base.CycleViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/analytics/` | GET | `plane.app.views.cycle.base.CycleAnalyticsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/archive/` | DELETE, GET, POST | `plane.app.views.cycle.archive.CycleArchiveUnarchiveEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/cycle-issues/` | GET, POST | `plane.app.views.cycle.issue.CycleIssueViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/cycle-issues/<uuid:issue_id>/` | DELETE, GET, PATCH, PUT | `plane.app.views.cycle.issue.CycleIssueViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/progress/` | GET | `plane.app.views.cycle.base.CycleProgressEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/transfer-issues/` | POST | `plane.app.views.cycle.base.TransferCycleIssueEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/user-properties/` | GET, PATCH | `plane.app.views.cycle.base.CycleUserPropertiesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:pk>/` | DELETE, GET, PATCH, PUT | `plane.app.views.cycle.base.CycleViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/date-check/` | POST | `plane.app.views.cycle.base.CycleDateCheckEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/deleted-issues/` | GET | `plane.app.views.issue.base.DeletedIssuesListViewSet` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/estimates/` | GET, POST | `plane.app.views.estimate.base.BulkEstimatePointEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/estimates/<uuid:estimate_id>/` | DELETE, GET, PATCH | `plane.app.views.estimate.base.BulkEstimatePointEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/estimates/<uuid:estimate_id>/estimate-points/` | POST | `plane.app.views.estimate.base.EstimatePointEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/estimates/<uuid:estimate_id>/estimate-points/<estimate_point_id>/` | DELETE, PATCH | `plane.app.views.estimate.base.EstimatePointEndpoint` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/favorite-pages/<uuid:page_id>/` | DELETE, POST | `plane.app.views.page.base.PageFavoriteViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/inbox-issues/` | GET, POST | `plane.app.views.intake.base.IntakeIssueViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/inbox-issues/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.intake.base.IntakeIssueViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/inboxes/` | GET, POST | `plane.app.views.intake.base.IntakeViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/inboxes/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.intake.base.IntakeViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/intake-issues/` | GET, POST | `plane.app.views.intake.base.IntakeIssueViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/intake-issues/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.intake.base.IntakeIssueViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/intake-state/` | GET | `plane.app.views.state.base.IntakeStateEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/intake-work-items/<uuid:work_item_id>/description-versions/` | GET | `plane.app.views.intake.base.IntakeWorkItemDescriptionVersionEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/intake-work-items/<uuid:work_item_id>/description-versions/<uuid:pk>/` | GET | `plane.app.views.intake.base.IntakeWorkItemDescriptionVersionEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/intakes/` | GET, POST | `plane.app.views.intake.base.IntakeViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/intakes/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.intake.base.IntakeViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/invitations/` | GET, POST | `plane.app.views.project.invite.ProjectInvitationsViewset` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/invitations/<uuid:pk>/` | DELETE, GET | `plane.app.views.project.invite.ProjectInvitationsViewset` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issue-dates/` | POST | `plane.app.views.issue.base.IssueBulkUpdateDateEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issue-labels/` | GET, POST | `plane.app.views.issue.label.LabelViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issue-labels/<uuid:pk>/` | DELETE, GET, PATCH, PUT | `plane.app.views.issue.label.LabelViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues-detail/` | GET | `plane.app.views.issue.base.IssueDetailEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/` | GET, POST | `plane.app.views.issue.base.IssueViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/comments/` | GET, POST | `plane.app.views.issue.comment.IssueCommentViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/comments/<uuid:pk>/` | DELETE, GET, PATCH, PUT | `plane.app.views.issue.comment.IssueCommentViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/history/` | GET | `plane.app.views.issue.activity.IssueActivityEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-attachments/` | DELETE, GET, POST | `plane.app.views.issue.attachment.IssueAttachmentEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-attachments/<uuid:pk>/` | DELETE, GET, POST | `plane.app.views.issue.attachment.IssueAttachmentEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-links/` | GET, POST | `plane.app.views.issue.link.IssueLinkViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-links/<uuid:pk>/` | DELETE, GET, PATCH, PUT | `plane.app.views.issue.link.IssueLinkViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-relation/` | GET, POST | `plane.app.views.issue.relation.IssueRelationViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-subscribers/` | GET, POST | `plane.app.views.issue.subscriber.IssueSubscriberViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-subscribers/<uuid:subscriber_id>/` | DELETE | `plane.app.views.issue.subscriber.IssueSubscriberViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/meta/` | GET | `plane.app.views.issue.base.IssueMetaEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/modules/` | POST | `plane.app.views.module.issue.ModuleIssueViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/reactions/` | GET, POST | `plane.app.views.issue.reaction.IssueReactionViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/reactions/<str:reaction_code>/` | DELETE | `plane.app.views.issue.reaction.IssueReactionViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/remove-relation/` | POST | `plane.app.views.issue.relation.IssueRelationViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/sub-issues/` | GET, POST | `plane.app.views.issue.sub_issue.SubIssuesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/subscribe/` | DELETE, GET, POST | `plane.app.views.issue.subscriber.IssueSubscriberViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/versions/` | GET | `plane.app.views.issue.version.IssueVersionEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/versions/<uuid:pk>/` | GET | `plane.app.views.issue.version.IssueVersionEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:pk>/` | DELETE, GET, PATCH, PUT | `plane.app.views.issue.base.IssueViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:pk>/archive/` | DELETE, GET, POST | `plane.app.views.issue.archive.IssueArchiveViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/list/` | GET | `plane.app.views.issue.base.IssueListEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/join/<uuid:pk>/` | GET, POST | `plane.app.views.project.invite.ProjectJoinEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: AllowAny | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/members/` | GET, POST | `plane.app.views.project.member.ProjectMemberViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/members/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.project.member.ProjectMemberViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/members/leave/` | POST | `plane.app.views.project.member.ProjectMemberViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/` | GET, POST | `plane.app.views.module.base.ModuleViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/archive/` | DELETE, GET, POST | `plane.app.views.module.archive.ModuleArchiveUnarchiveEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: ProjectEntityPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/issues/` | GET, POST | `plane.app.views.module.issue.ModuleIssueViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/issues/<uuid:issue_id>/` | DELETE, GET, PATCH, PUT | `plane.app.views.module.issue.ModuleIssueViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-links/` | GET, POST | `plane.app.views.module.base.ModuleLinkViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-links/<uuid:pk>/` | DELETE, GET, PATCH, PUT | `plane.app.views.module.base.ModuleLinkViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/user-properties/` | GET, PATCH | `plane.app.views.module.base.ModuleUserPropertiesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:pk>/` | DELETE, GET, PATCH, PUT | `plane.app.views.module.base.ModuleViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages-summary/` | GET | `plane.app.views.page.base.PageViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/` | GET, POST | `plane.app.views.page.base.PageViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/` | DELETE, GET, PATCH | `plane.app.views.page.base.PageViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/access/` | POST | `plane.app.views.page.base.PageViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/archive/` | DELETE, POST | `plane.app.views.page.base.PageViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/description/` | GET, PATCH | `plane.app.views.page.base.PagesDescriptionViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/duplicate/` | POST | `plane.app.views.page.base.PageDuplicateEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: ProjectPagePermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/lock/` | DELETE, POST | `plane.app.views.page.base.PageViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/versions/` | GET | `plane.app.views.page.version.PageVersionEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: ProjectPagePermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/versions/<uuid:pk>/` | GET | `plane.app.views.page.version.PageVersionEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: ProjectPagePermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/preferences/member/<uuid:member_id>/` | GET, PATCH | `plane.app.views.project.member.ProjectMemberPreferenceEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/project-deploy-boards/` | GET, POST | `plane.app.views.project.base.DeployBoardViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/project-deploy-boards/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.project.base.DeployBoardViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/project-estimates/` | GET | `plane.app.views.estimate.base.ProjectEstimatePointEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/project-members/me/` | GET | `plane.app.views.project.member.ProjectMemberUserEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/project-views/` | POST | `plane.app.views.project.base.ProjectUserViewsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/search-issues/` | GET | `plane.app.views.search.issue.IssueSearchEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/states/` | GET, POST | `plane.app.views.state.base.StateViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/states/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.state.base.StateViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/states/<uuid:pk>/mark-default/` | POST | `plane.app.views.state.base.StateViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/user-favorite-cycles/` | GET, POST | `plane.app.views.cycle.base.CycleFavoriteViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/user-favorite-cycles/<uuid:cycle_id>/` | DELETE | `plane.app.views.cycle.base.CycleFavoriteViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/user-favorite-modules/` | GET, POST | `plane.app.views.module.base.ModuleFavoriteViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/user-favorite-modules/<uuid:module_id>/` | DELETE | `plane.app.views.module.base.ModuleFavoriteViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/user-favorite-views/` | GET, POST | `plane.app.views.view.base.IssueViewFavoriteViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/user-favorite-views/<uuid:view_id>/` | DELETE | `plane.app.views.view.base.IssueViewFavoriteViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/user-properties/` | GET, PATCH | `plane.app.views.issue.base.ProjectUserDisplayPropertyEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/v2/issues/` | GET | `plane.app.views.issue.base.IssuePaginatedViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/views/` | GET, POST | `plane.app.views.view.base.IssueViewViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/views/<uuid:pk>/` | DELETE, GET, PATCH, PUT | `plane.app.views.view.base.IssueViewViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:work_item_id>/description-versions/` | GET | `plane.app.views.issue.version.WorkItemDescriptionVersionEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:work_item_id>/description-versions/<uuid:pk>/` | GET | `plane.app.views.issue.version.WorkItemDescriptionVersionEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/projects/details/` | GET | `plane.app.views.project.base.ProjectViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/quick-links/` | GET, POST | `plane.app.views.workspace.quick_link.QuickLinkViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/quick-links/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.workspace.quick_link.QuickLinkViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/recent-visits/` | GET | `plane.app.views.workspace.recent_visit.UserRecentVisitViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/saved-analytic-view/<uuid:analytic_id>/` | GET | `plane.app.views.analytic.base.SavedAnalyticEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/search/` | GET | `plane.app.views.search.base.GlobalSearchEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/sidebar-preferences/` | GET, PATCH | `plane.app.views.workspace.user_preference.WorkspaceUserPreferenceViewSet` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/states/` | GET | `plane.app.views.workspace.state.WorkspaceStatesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: WorkspaceEntityPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/stickies/` | GET, POST | `plane.app.views.workspace.sticky.WorkspaceStickyViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/stickies/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.workspace.sticky.WorkspaceStickyViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/user-activity/<uuid:user_id>/` | GET | `plane.app.views.workspace.user.WorkspaceUserActivityEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: WorkspaceEntityPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/user-activity/<uuid:user_id>/export/` | POST | `plane.app.views.workspace.base.ExportWorkspaceUserActivityEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: WorkspaceEntityPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/user-favorite-projects/` | GET, POST | `plane.app.views.project.base.ProjectFavoritesViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/user-favorite-projects/<uuid:project_id>/` | DELETE | `plane.app.views.project.base.ProjectFavoritesViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/user-favorites/` | DELETE, GET, PATCH, POST | `plane.app.views.workspace.favorite.WorkspaceFavoriteEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/user-favorites/<uuid:favorite_id>/` | DELETE, GET, PATCH, POST | `plane.app.views.workspace.favorite.WorkspaceFavoriteEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/user-favorites/<uuid:favorite_id>/group/` | GET | `plane.app.views.workspace.favorite.WorkspaceFavoriteGroupEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/user-issues/<uuid:user_id>/` | GET | `plane.app.views.workspace.user.WorkspaceUserProfileIssuesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: WorkspaceViewerPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/user-profile/<uuid:user_id>/` | GET | `plane.app.views.workspace.user.WorkspaceUserProfileEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/user-properties/` | GET, PATCH | `plane.app.views.workspace.user.WorkspaceUserPropertiesEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: WorkspaceViewerPermission | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/user-stats/<uuid:user_id>/` | GET | `plane.app.views.workspace.user.WorkspaceUserProfileStatsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/users/notifications/` | GET | `plane.app.views.notification.base.NotificationViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/users/notifications/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.notification.base.NotificationViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/users/notifications/<uuid:pk>/archive/` | DELETE, POST | `plane.app.views.notification.base.NotificationViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/users/notifications/<uuid:pk>/read/` | DELETE, POST | `plane.app.views.notification.base.NotificationViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/users/notifications/mark-all-read/` | POST | `plane.app.views.notification.base.MarkAllReadNotificationViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/users/notifications/unread/` | GET | `plane.app.views.notification.base.UnreadNotificationEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/views/` | GET, POST | `plane.app.views.view.base.WorkspaceViewViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/views/<uuid:pk>/` | DELETE, GET, PATCH, PUT | `plane.app.views.view.base.WorkspaceViewViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/webhook-logs/<uuid:webhook_id>/` | GET | `plane.app.views.webhook.base.WebhookLogsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/webhooks/` | DELETE, GET, PATCH, POST | `plane.app.views.webhook.base.WebhookEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/webhooks/<uuid:pk>/` | DELETE, GET, PATCH, POST | `plane.app.views.webhook.base.WebhookEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/webhooks/<uuid:pk>/regenerate/` | POST | `plane.app.views.webhook.base.WebhookSecretRegenerateEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/work-items/<str:project_identifier>-<str:issue_identifier>/` | GET | `plane.app.views.issue.base.IssueDetailIdentifierEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/workspace-members/me/` | GET | `plane.app.views.workspace.member.WorkspaceMemberUserEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/workspace-themes/` | GET, POST | `plane.app.views.workspace.base.WorkspaceThemeViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/workspace-themes/<uuid:pk>/` | DELETE, GET, PATCH | `plane.app.views.workspace.base.WorkspaceThemeViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |
| `/api/workspaces/<str:slug>/workspace-views/` | POST | `plane.app.views.workspace.member.WorkspaceMemberUserViewsEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/file-assets/<uuid:workspace_id>/<str:asset_key>/` | DELETE, GET, POST | `plane.app.views.asset.base.FileAssetEndpoint` | `TBD` | Auth: BaseSessionAuthentication<br>Perms: IsAuthenticated | ⏳ legacy |  |
| `/api/workspaces/file-assets/<uuid:workspace_id>/<str:asset_key>/restore/` | POST | `plane.app.views.asset.base.FileAssetViewSet` | `TBD` | Auth: <br>Perms:  | ⏳ legacy |  |

