# Plane Go API

This service is the incremental replacement for the Plane Python backend.

Current phase:
- Go owns liveness, readiness, and migration status endpoints.
- PostgreSQL network connectivity is verified by the readiness endpoint.
- Go owns CSRF token issuance, email availability checks, Django-compatible email sign-in/sign-up sessions, password change/set, forgot-password email delivery, password-reset tokens, and session sign-out.
- Go owns the blockchain tracking endpoint for both offline and verified
  on-chain events. It verifies the configured chain, contract, receipt status,
  event topics, task identity, sender, assignee, progress, and content hashes.
- Verified blockchain metadata and the corresponding Plane issue mutation are
  committed in one PostgreSQL transaction.
- Existing legacy JSON tracking records are merged into GET responses while the
  migration is in progress.
- Unported routes temporarily fall back to Django.
- GET /api/instances/ is owned by Go with a short read-through cache and
  stale-response fallback to prevent startup reload loops during legacy outages.
- The authenticated application bootstrap reads are owned by Go:
  `GET /api/users/me/`, `GET /api/users/me/profile/`,
  `GET /api/users/me/settings/`, and `GET /api/users/me/workspaces/`.
- The authenticated project read path is owned by Go for project list,
  detailed list, single-project, state list/detail, and project-member list:
  `GET /api/workspaces/{slug}/projects/`,
  `GET /api/workspaces/{slug}/projects/details/`,
  `GET /api/workspaces/{slug}/projects/{project_id}/`,
  `GET /api/workspaces/{slug}/projects/{project_id}/states/`, and
  `GET /api/workspaces/{slug}/projects/{project_id}/members/`.
- Go owns project label list/detail reads and basic unfiltered work-item
  list/detail reads plus transactional create, patch, and soft-delete writes.
  Filtered, grouped, and expanded queries continue through Django until
  compatibility is complete.
- Write methods on partially migrated project resources deliberately continue
  to Django until their transaction and permission behavior is ported.
- The fallback must be removed before Python is retired.

Run locally:

    $env:DATABASE_URL="postgresql://plane:plane@localhost:5432/plane"
    $env:LEGACY_API_URL="http://localhost:8000"
    $env:BLOCKCHAIN_RPC_URL="https://your-rpc.example"
    $env:BLOCKCHAIN_CHAIN_ID="991"
    $env:BLOCKCHAIN_CONTRACT_ADDRESS="0x..."
    go run ./cmd/api

For the web development server, point its proxy at Go only after this process
is healthy:

    # apps/web/.env
    VITE_API_BASE_URL="http://localhost:8080"
    VITE_API_PROXY_TARGET="http://127.0.0.1:8080"

Docker Compose already starts `go-api` and Caddy uses it as the primary API.
If Go is unavailable, Caddy retries Django automatically; this avoids a
frontend reload loop while migration work is in progress.

Migration inventory is available at `GET /api/go/migration-status`.

A route group can leave Django only after its Go implementation has API
compatibility tests and the frontend has been exercised against it.

Remaining Python areas include OAuth/magic-code/social auth flows,
workspace/project mutations, advanced issue queries, comments/attachments, file
storage, background workers, email, and integrations.
Until each area has been ported and tested, `LEGACY_API_URL` remains required.
