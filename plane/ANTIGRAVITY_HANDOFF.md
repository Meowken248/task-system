# Antigravity Handoff: Python to Go Migration

## Thông tin phiên
- Cập nhật sau: Sprint A - Ổn định Blocker P0.1 và P0.2
- Branch hiện tại: `chuyen_py_sang_go_2`

## Tình trạng các Blocker P0
- **P0.1 (Schema Validator)**: **DONE**. Đã sửa tên bảng `project_members` và đổi test sang kết nối DB thực tế `plane_test_migrate` để xác minh physical schema qua `information_schema`. 
- **P0.2 (Advisory Lock Connection)**: **DONE**. Đã sửa `migrate.go` để lấy một connection duy nhất từ pool (`p.pool.Acquire(ctx)`), khóa advisory, chạy transaction migration, và mở khóa trên cùng một connection. Có bài test `TestConcurrentMigrations` mô phỏng data race/deadlock bằng `sync.WaitGroup`.
- **P0.3 (Go workers)**: **DONE**. Triển khai mô hình Outbox Pattern để queue background job thông qua PostgreSQL (bảng `go_worker_jobs` sử dụng `SELECT ... FOR UPDATE SKIP LOCKED`). Viết cơ chế polling và Dispatcher gửi Webhook có hỗ trợ retry, backoff, dead letter, độc lập hoàn toàn với Celery/Redis.
- **P0.4 (Draft-to-Issue transaction)**: **DONE**. Đã tách logic tạo issue bằng transaction (`CreateForSessionTx`) bên `issue.PostgreSQLStore`. Đưa vào `draftissue.PostgreSQLStore` qua interface `IssueTxCreator`. Viết luồng `DraftToIssue` thực hiện tạo issue, cập nhật file asset, xóa draft đồng loạt trong một block `pgx.Tx`. Thêm test `TestDraftToIssue_AtomicRollback` mô phỏng issue create failed để verify atomic rollback.
- **P0.5 (Issue router query)**: **DONE**. Cập nhật `issueQueryAllowlist` loại bỏ `fields` và `sub_group_by`. Nâng cấp `canServeBasicIssueRead` để kiểm tra chặt chẽ giá trị của `order_by` và `group_by`. Các query không hợp lệ hoặc phức tạp chưa được Go hỗ trợ sẽ tự động fallback về Django.
- **P0.6 (Blockchain readiness/tracking)**: **DONE**. Đã thêm `PingContext(ctx)` gọi `eth_chainId` trong `Verifier` để kiểm tra RPC Node thật. Chỉnh sửa logic `/health/ready` trong `router.go`: Khi `BlockchainMode == "online"` nếu Verifier thiếu hoặc RPC Node chết thì sẽ trả về `HTTP 503 Service Unavailable` thay vì `200 OK` (chặn pod khỏi Load Balancer). Ngăn chặn issue verification ảo.

**Kết luận**: Đã xử lý xong toàn bộ Sprint A - P0 Blockers. Sẵn sàng báo cáo nghiệm thu và chuẩn bị Sprint B.

## File đã thay đổi
- `apps/go-api/internal/database/schema_validator.go`: Sửa `project_projectmember` -> `project_members`.
- `apps/go-api/internal/database/schema_validator_test.go`: Đổi static check sang DB connection check.
- `apps/go-api/internal/database/migrate.go`: Refactor locking dùng connection nguyên khối (`conn`).
- `apps/go-api/internal/database/migrate_test.go`: Thêm `TestConcurrentMigrations`.
- `apps/go-api/internal/issue/write.go`: Extract hàm `CreateForSessionTx(ctx, tx pgx.Tx, ...)` để tái sử dụng giao dịch.
- `apps/go-api/internal/draftissue/store.go`: Đưa 3 operations vào 1 unified transaction trong `DraftToIssue`.
- `apps/go-api/internal/draftissue/store_test.go`: Thêm bài test rollback `TestDraftToIssue_AtomicRollback`.
- `apps/go-api/internal/draftissue/handler.go`: Gỡ bỏ `IssueStore` khỏi HTTP handler, dời trách nhiệm xuống Store.
- `apps/go-api/cmd/api/main.go`: Khởi tạo `IssueTxCreator` cho `draftissue` và khởi tạo `worker.NewWebhookDispatcher`.
- `apps/go-api/internal/database/migrations/002_go_worker_jobs.sql`: Migration tạo bảng queue cho Go workers.
- `apps/go-api/internal/worker/store.go`: Triển khai hàm Enqueue, Dequeue `FOR UPDATE SKIP LOCKED`.
- `apps/go-api/internal/worker/webhook.go`: Cấu hình HTTP payload dispatcher cho webhook có kèm retry, dead_letter.
- `apps/go-api/internal/httpapi/router.go`: Cập nhật logic `canServeBasicIssueRead` để filter custom values an toàn và sửa `/health/ready` check RPC cho blockchain online mode trả về 503.
- `apps/go-api/internal/blockchain/verifier.go`: Thêm method `PingContext` để kiểm tra RPC node (gọi `eth_chainId`).
- `apps/go-api/internal/httpapi/router_test.go`: Cập nhật mock testing để fallback queries không hợp lệ và test `/health/ready` 503/200 theo cấu hình online.

## Test và kiểm tra
- `gofmt`: (đã tự động format)
- `go vet ./...`: PASS
- `go test ./internal/database/...`: PASS
- `go test ./...`: PASS
- `go build ./cmd/api`: PASS

## Công việc đang dang dở
- Đã hoàn tất Sprint A.

## Bước tiếp theo
- Xin ý kiến user để bước sang Sprint B hoặc đóng gói release.

## File bắt buộc đọc tiếp
- `AGENTS.md`
- `ANTIGRAVITY_PYTHON_TO_GO_MIGRATION_PLAN.md`
- `route_parity_matrix.md`
