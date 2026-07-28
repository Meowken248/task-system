# Plane Go API

This service is the incremental replacement for the Plane Python backend.

Current phase:
- Go owns liveness, readiness, and migration status endpoints.
- PostgreSQL network connectivity is verified by the readiness endpoint.
- Unported routes temporarily fall back to Django.
- GET /api/instances/ is owned by Go with a short read-through cache and
  stale-response fallback to prevent startup reload loops during legacy outages.
- The fallback must be removed before Python is retired.

Run locally:

    $env:DATABASE_URL="postgresql://plane:plane@localhost:5432/plane"
    $env:LEGACY_API_URL="http://localhost:8000"
    go run ./cmd/api

Endpoints: GET /health/live, GET /health/ready, GET /api/go/migration-status.

A route group can leave Django only after its Go implementation has API
compatibility tests and the frontend has been exercised against it.
