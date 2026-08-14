# Route Parity Matrix
Đây là danh sách đối chiếu route giữa Django và Go. Các API đã hoàn tất (ported), đang làm dở (partial) và chưa làm (legacy).

## /assets
| Django Route | Methods | Status | Notes |
|---|---|---|---|
| `/api/assets/v2/workspaces/<str:slug>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/assets/v2/workspaces/<str:slug>/<uuid:asset_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/assets/v2/user-assets/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/assets/v2/user-assets/<uuid:asset_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/assets/v2/workspaces/<str:slug>/restore/<uuid:asset_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/assets/v2/static/<uuid:asset_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/<uuid:entity_id>/bulk/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/assets/v2/workspaces/<str:slug>/check/<uuid:asset_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/assets/v2/workspaces/<str:slug>/duplicate-assets/<uuid:asset_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/assets/v2/workspaces/<str:slug>/download/<uuid:asset_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/download/<uuid:asset_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/attachments/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/assets/v2/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/attachments/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |

## /instances
| Django Route | Methods | Status | Notes |
|---|---|---|---|
| `/api/instances/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/instances/admins/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/instances/admins/me/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/instances/admins/session/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/instances/admins/sign-out/` |  | ✅ ported | |
| `/api/instances/admins/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/instances/configurations/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/instances/configurations/disable-email-feature/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/instances/admins/sign-in/` |  | ✅ ported | |
| `/api/instances/admins/sign-up/` |  | ✅ ported | |
| `/api/instances/admins/sign-up-screen-visited/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/instances/email-credentials-check/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/instances/workspace-slug-check/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/instances/workspaces/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |

## /public
| Django Route | Methods | Status | Notes |
|---|---|---|---|
| `/api/public/anchor/<str:anchor>/intakes/<uuid:intake_id>/intake-issues/` | GET, POST | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/intakes/<uuid:intake_id>/inbox-issues/` | GET, POST | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/intakes/<uuid:intake_id>/intake-issues/<uuid:pk>/` | GET, PATCH, DELETE | ⏳ legacy | |
| `/api/public/workspaces/<str:slug>/project-boards/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/comments/` | GET, POST | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/comments/<uuid:pk>/` | GET, PATCH, DELETE | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/reactions/` | GET, POST | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/reactions/<str:reaction_code>/` | DELETE | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/comments/<uuid:comment_id>/reactions/` | GET, POST | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/comments/<uuid:comment_id>/reactions/<str:reaction_code>/` | DELETE | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/issues/<uuid:issue_id>/votes/` | GET, POST, DELETE | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/meta/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/settings/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/issues/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/public/workspaces/<str:slug>/projects/<uuid:project_id>/anchor/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/cycles/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/modules/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/states/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/labels/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/public/anchor/<str:anchor>/members/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/public/assets/v2/anchor/<str:anchor>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/public/assets/v2/anchor/<str:anchor>/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/public/assets/v2/anchor/<str:anchor>/restore/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/public/assets/v2/anchor/<str:anchor>/<uuid:entity_id>/bulk/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |

## /timezones
| Django Route | Methods | Status | Notes |
|---|---|---|---|
| `/api/timezones/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |

## /unsplash
| Django Route | Methods | Status | Notes |
|---|---|---|---|
| `/api/unsplash/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |

## /users
| Django Route | Methods | Status | Notes |
|---|---|---|---|
| `/api/users/file-assets/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/file-assets/<str:asset_key>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/me/notification-preferences/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/me/workspaces/<str:slug>/projects/invitations/` | GET, POST | ⏳ legacy | |
| `/api/users/me/workspaces/<str:slug>/project-roles/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/me/` | GET, PATCH, DELETE | ⏳ legacy | |
| `/api/users/session/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/me/settings/` | GET | ⏳ legacy | |
| `/api/users/me/email/generate-code/` | POST | ⏳ legacy | |
| `/api/users/me/email/` | PATCH | ⏳ legacy | |
| `/api/users/me/profile/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/me/accounts/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/me/accounts/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/me/instance-admin/` | GET | ⏳ legacy | |
| `/api/users/me/onboard/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/me/tour-completed/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/me/activities/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/me/workspaces/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/me/workspaces/<str:slug>/activity-graph/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/me/workspaces/<str:slug>/issues-completed-graph/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/me/workspaces/<str:slug>/dashboard/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/me/workspaces/invitations/` | GET, POST | ✅ ported | |
| `/api/users/last-visited-workspace/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/users/api-tokens/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/users/api-tokens/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |

## /v1
| Django Route | Methods | Status | Notes |
|---|---|---|---|
| `/api/v1/assets/user-assets/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/assets/user-assets/<uuid:asset_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/assets/user-assets/server/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/assets/user-assets/<uuid:asset_id>/server/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/assets/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/assets/<uuid:asset_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/cycle-issues/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/cycle-issues/<uuid:issue_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/transfer-issues/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/archive/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/archived-cycles/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/archived-cycles/<uuid:cycle_id>/unarchive/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/intake-issues/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/intake-issues/<uuid:issue_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/labels/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/labels/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/members/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/members/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/project-members/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/project-members/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/members/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/modules/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-issues/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-issues/<uuid:issue_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:pk>/archive/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/archived-modules/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/archived-modules/<uuid:pk>/unarchive/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/archive/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/summary/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/states/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/states/<uuid:state_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/users/me/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/issues/search/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/issues/<str:project_identifier>-<str:issue_identifier>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/links/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/links/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/comments/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/comments/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/activities/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/activities/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-attachments/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-attachments/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/work-items/search/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/work-items/<str:project_identifier>-<str:issue_identifier>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/links/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/links/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/comments/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/comments/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/activities/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/activities/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/attachments/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/attachments/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/relations/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/invitations/` | GET, POST | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/invitations\.(?P<format>[a-z0-9]+)/?` | GET, POST | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/invitations/(?P<pk>[/.]+)/` | GET, PUT, PATCH, DELETE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/invitations/(?P<pk>[/.]+)\.(?P<format>[a-z0-9]+)/?` | GET, PUT, PATCH, DELETE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/<drf_format_suffix:format>` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/stickies/` | GET, POST | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/stickies\.(?P<format>[a-z0-9]+)/?` | GET, POST | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/stickies/(?P<pk>[/.]+)/` | GET, PUT, PATCH, DELETE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/stickies/(?P<pk>[/.]+)\.(?P<format>[a-z0-9]+)/?` | GET, PUT, PATCH, DELETE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |
| `/api/v1/workspaces/<str:slug>/<drf_format_suffix:format>` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ⏳ legacy | |

## /workspace-slug-check
| Django Route | Methods | Status | Notes |
|---|---|---|---|
| `/api/workspace-slug-check/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |

## /workspaces
| Django Route | Methods | Status | Notes |
|---|---|---|---|
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/blockchain-transactions/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/analytics/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/analytic-view/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/analytic-view/<uuid:pk>/` | GET, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/saved-analytic-view/<uuid:analytic_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/export-analytics/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/default-analytics/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/project-stats/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/advance-analytics/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/advance-analytics-stats/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/advance-analytics-charts/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/advance-analytics/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/advance-analytics-stats/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/advance-analytics-charts/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/file-assets/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/file-assets/<uuid:workspace_id>/<str:asset_key>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/file-assets/<uuid:workspace_id>/<str:asset_key>/restore/` | POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:pk>/` | GET, PUT, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/cycle-issues/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/cycle-issues/<uuid:issue_id>/` | GET, PUT, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/date-check/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/user-favorite-cycles/` | GET, POST | ✅ ported | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/user-favorite-cycles/<uuid:cycle_id>/` | DELETE | ✅ ported | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/transfer-issues/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/user-properties/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/archive/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/archived-cycles/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/archived-cycles/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/progress/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/cycles/<uuid:cycle_id>/analytics/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/project-estimates/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/estimates/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/estimates/<uuid:estimate_id>/` | GET, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/estimates/<uuid:estimate_id>/estimate-points/` | POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/estimates/<uuid:estimate_id>/estimate-points/<estimate_point_id>/` | PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/ai-assistant/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/ai-assistant/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/intakes/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/intakes/<uuid:pk>/` | GET, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/intake-issues/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/intake-issues/<uuid:pk>/` | GET, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/inboxes/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/inboxes/<uuid:pk>/` | GET, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/inbox-issues/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/inbox-issues/<uuid:pk>/` | GET, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/intake-work-items/<uuid:work_item_id>/description-versions/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/intake-work-items/<uuid:work_item_id>/description-versions/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/list/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues-detail/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/v2/issues/` | GET | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:pk>/` | GET, PUT, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issue-labels/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issue-labels/<uuid:pk>/` | GET, PUT, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/bulk-create-labels/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/bulk-delete-issues/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/bulk-archive-issues/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/sub-issues/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-links/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-links/<uuid:pk>/` | GET, PUT, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-attachments/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-attachments/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/history/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/comments/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/comments/<uuid:pk>/` | GET, PUT, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-subscribers/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-subscribers/<uuid:subscriber_id>/` | DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/subscribe/` | GET, POST, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/reactions/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/reactions/<str:reaction_code>/` | DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/comments/<uuid:comment_id>/reactions/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/comments/<uuid:comment_id>/reactions/<str:reaction_code>/` | DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/user-properties/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/archived-issues/` | GET | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:pk>/archive/` | GET, POST, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/issue-relation/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/remove-relation/` | POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/deleted-issues/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issue-dates/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/versions/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/versions/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:work_item_id>/description-versions/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:work_item_id>/description-versions/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/meta/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/work-items/<str:project_identifier>-<str:issue_identifier>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:pk>/` | GET, PUT, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/modules/` | POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/issues/` | POST, GET | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/issues/<uuid:issue_id>/` | GET, PUT, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-links/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/module-links/<uuid:pk>/` | GET, PUT, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/user-favorite-modules/` | GET, POST | ✅ ported | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/user-favorite-modules/<uuid:module_id>/` | DELETE | ✅ ported | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/user-properties/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/modules/<uuid:module_id>/archive/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/archived-modules/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/archived-modules/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/users/notifications/` | GET | 🔄 partial | |
| `/api/workspaces/<str:slug>/users/notifications/<uuid:pk>/` | GET, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/users/notifications/<uuid:pk>/read/` | POST, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/users/notifications/<uuid:pk>/archive/` | POST, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/users/notifications/unread/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/users/notifications/mark-all-read/` | POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages-summary/` | GET | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/` | GET, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/favorite-pages/<uuid:page_id>/` | POST, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/archive/` | POST, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/lock/` | POST, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/access/` | POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/description/` | GET, PATCH | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/versions/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/versions/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/duplicate/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/details/` | GET | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:pk>/` | GET, PUT, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/project-identifiers/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/invitations/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/invitations/<uuid:pk>/` | GET, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/join/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/members/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/members/<uuid:pk>/` | GET, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/members/leave/` | POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/project-views/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/project-members/me/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/user-favorite-projects/` | GET, POST | ✅ ported | |
| `/api/workspaces/<str:slug>/user-favorite-projects/<uuid:project_id>/` | DELETE | ✅ ported | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/project-deploy-boards/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/project-deploy-boards/<uuid:pk>/` | GET, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/archive/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/preferences/member/<uuid:member_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/search/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/search-issues/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/entity-search/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/states/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/states/<uuid:pk>/` | GET, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/intake-state/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/states/<uuid:pk>/mark-default/` | POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/views/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/views/<uuid:pk>/` | GET, PUT, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/views/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/views/<uuid:pk>/` | GET, PUT, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/issues/` | GET | 🔄 partial | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/user-favorite-views/` | GET, POST | ✅ ported | |
| `/api/workspaces/<str:slug>/projects/<uuid:project_id>/user-favorite-views/<uuid:view_id>/` | DELETE | ✅ ported | |
| `/api/workspaces/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/` | GET, PUT, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/invitations/` | GET, POST | ✅ ported | |
| `/api/workspaces/<str:slug>/invitations/<uuid:pk>/` | DELETE, GET, PATCH | ✅ ported | |
| `/api/workspaces/<str:slug>/invitations/<uuid:pk>/join/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/workspaces/<str:slug>/members/` | GET | 🔄 partial | |
| `/api/workspaces/<str:slug>/project-members/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/members/<uuid:pk>/` | PATCH, DELETE, GET | 🔄 partial | |
| `/api/workspaces/<str:slug>/members/leave/` | POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/workspace-members/me/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/workspace-views/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/workspace-themes/` | GET, POST | ✅ ported | |
| `/api/workspaces/<str:slug>/workspace-themes/<uuid:pk>/` | GET, PATCH, DELETE | ✅ ported | |
| `/api/workspaces/<str:slug>/user-stats/<uuid:user_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/user-activity/<uuid:user_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/user-activity/<uuid:user_id>/export/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/user-profile/<uuid:user_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/user-issues/<uuid:user_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/labels/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/user-properties/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/states/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/estimates/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/modules/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/cycles/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
| `/api/workspaces/<str:slug>/user-favorites/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/workspaces/<str:slug>/user-favorites/<uuid:favorite_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/workspaces/<str:slug>/user-favorites/<uuid:favorite_id>/group/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/workspaces/<str:slug>/draft-issues/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/draft-issues/<uuid:pk>/` | GET, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/draft-to-issue/<uuid:draft_id>/` | POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/quick-links/` | GET, POST | 🔄 partial | |
| `/api/workspaces/<str:slug>/quick-links/<uuid:pk>/` | GET, PATCH, DELETE | 🔄 partial | |
| `/api/workspaces/<str:slug>/home-preferences/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/workspaces/<str:slug>/home-preferences/<str:key>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/workspaces/<str:slug>/recent-visits/` | GET | ✅ ported | |
| `/api/workspaces/<str:slug>/stickies/` | GET, POST | ✅ ported | |
| `/api/workspaces/<str:slug>/stickies/<uuid:pk>/` | GET, PATCH, DELETE | ✅ ported | |
| `/api/workspaces/<str:slug>/sidebar-preferences/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/workspaces/<str:slug>/webhooks/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/workspaces/<str:slug>/webhooks/<uuid:pk>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/workspaces/<str:slug>/webhooks/<uuid:pk>/regenerate/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/workspaces/<str:slug>/webhook-logs/<uuid:webhook_id>/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | ✅ ported | |
| `/api/workspaces/<str:slug>/export-issues/` | GET, POST, PUT, PATCH, DELETE, HEAD, TRACE | 🔄 partial | |
