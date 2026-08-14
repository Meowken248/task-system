# Kế hoạch chuyển backend Plane từ Python/Django sang Go

> **Cập nhật kiểm chứng ngày 2026-08-14:** Mục 13 ở cuối tài liệu là prompt
> tiếp tục mới nhất và có độ ưu tiên cao hơn các mô tả hiện trạng cũ trong tài
> liệu này hoặc trong `ANTIGRAVITY_HANDOFF.md`. Antigravity phải kiểm tra lại
> mọi kết luận bằng source, git diff và test thực tế trước khi sửa.

## 1. Mục tiêu

Chuyển toàn bộ chức năng backend hiện có của Plane từ Python/Django sang Go nhưng giữ nguyên tuyệt đối hợp đồng API và luồng nghiệp vụ.

Mục tiêu cuối cùng:

- Frontend chỉ gọi Go API.
- Go xử lý đầy đủ API đồng bộ và background jobs.
- Không còn request nào cần proxy sang Django.
- Có thể tắt Django API, Celery worker và Celery beat bằng cấu hình runtime.
- Toàn bộ mã Python vẫn được giữ nguyên trong repository để chủ dự án tự xóa sau khi nghiệm thu.

## 2. Quy tắc bắt buộc

Antigravity phải tuân thủ tất cả các quy tắc sau:

1. Không xóa, đổi tên, di chuyển hoặc tự động format bất kỳ file Python nào.
2. Không xóa Django, Celery hoặc cấu hình fallback trong khi chưa hoàn tất kiểm thử tương thích.
3. Không thay đổi URL, HTTP method, request body, response JSON, status code, header hoặc cookie đang được frontend sử dụng.
4. Không thay đổi permission, role, transaction boundary hoặc side effect của nghiệp vụ.
5. Không thay đổi database schema chỉ để Go dễ triển khai hơn. Go phải tương thích với schema hiện hữu.
6. Không sửa frontend để che lỗi hoặc thay đổi hợp đồng backend.
7. Không đánh dấu email, webhook hoặc job là thành công nếu hành động thật chưa được thực hiện.
8. Không để Go worker và Celery cùng xử lý một job.
9. Mỗi route được chuyển phải có unit test và contract/parity test.
10. Mỗi thay đổi phải nhỏ, có thể review và rollback độc lập.
11. Không chạy lệnh xóa/reset/drop/truncate dữ liệu.
12. Tuân thủ `AGENTS.md`, style và cấu trúc hiện có của `apps/go-api`.

## 3. Kiến trúc hiện tại

```text
Frontend
   |
   v
Go API :8080
   |-- Route đã chuyển ------> Go handler/store
   |
   `-- Route chưa chuyển ----> Reverse proxy ------> Django API :8000
                                                        |
                                                        +--> Celery worker
                                                        `--> Celery beat
```

Trạng thái hiện tại là `incremental-migration`, không phải Go standalone.

Các điểm vào quan trọng:

- `apps/go-api/cmd/api/main.go`: khởi tạo database, migration, workers, handlers và router.
- `apps/go-api/internal/httpapi/router.go`: khai báo route Go và fallback Django.
- `apps/go-api/internal/database/migrate.go`: quản lý Go migrations.
- `apps/go-api/internal/worker/manager.go`: background worker Go hiện tại.
- `apps/go-api/internal/tracking/handler.go`: blockchain tracking và offline mode.
- `docker-compose-local.yml`: cấu hình `LEGACY_API_URL` và các container Django/Celery.
- `apps/web/vite.config.ts`: frontend proxy vào Go API.

## 4. Hiện trạng đã xác minh

### 4.1 Go API

- Khoảng 53 package nghiệp vụ trong `apps/go-api/internal`.
- Khoảng 46 file handler.
- Khoảng 103 đăng ký route trực tiếp; router động đại diện cho nhiều endpoint hơn con số này.
- `go test ./...` đang pass.
- `go vet ./...` đang pass.
- `go build ./cmd/api` đang pass.
- Khoảng 226 test Go đang pass.
- Go API `/health/ready` trả trạng thái ready.
- `/api/go/migration-status` vẫn báo `incremental-migration` và legacy fallback.

### 4.2 Nhóm chức năng đã có Go handler

- Email sign-in/sign-up và kiểm tra email.
- Session, CSRF và sign-out.
- Forgot/reset/change/set password.
- User profile và user properties.
- Workspace, member, invite, theme và preferences.
- Project CRUD, member và identifier.
- Issue/work item cơ bản.
- State, label, estimate, cycle, module và view.
- Comment, reaction, relation, link và subscriber.
- Sub-issue, archive, sticky và favorite.
- Dashboard, analytics và recent visits.
- Notification và timezone.
- API token và webhook configuration.
- Blockchain tracking, verification và import.
- Page, intake, search và một số instance API.

### 4.3 Thành phần vẫn phụ thuộc Python

- Legacy reverse proxy vẫn hoạt động.
- Django API container vẫn chạy.
- Celery worker và Celery beat vẫn chạy.
- Magic-link authentication.
- OAuth Google, GitHub, GitLab và Gitea.
- Các biến thể authentication của Spaces.
- Một số export/import flow.
- Một số public, space và license API.
- Advanced issue filtering, grouping, expansion và pagination chưa được chứng minh parity đầy đủ.
- Phần lớn background tasks còn thuộc Python/Celery.

### 4.4 Ước lượng tiến độ

Đây là ước lượng kỹ thuật, không phải số lượng endpoint có trọng số chính xác:

- Độ phủ module/handler: khoảng 65-75% API tương tác chính.
- Tương thích đã được kiểm chứng với Django: khoảng 45-55%.
- Tiến độ tổng thể có thể xem là khoảng 55-60%.

Không được dùng các tỷ lệ này làm điều kiện tắt Django. Điều kiện tắt Django phải dựa trên route matrix, parity tests và fallback rate bằng 0.

## 5. Lỗi và sai luồng cần xử lý

## 5.1 P0 - Go worker đang mô phỏng thành công

Trong `internal/worker/manager.go`:

- Webhook worker chưa gửi webhook thật nhưng cập nhật bản ghi như thành công.
- Email worker chưa gửi email thật nhưng đánh dấu `sent_at` và `processed_at`.

Rủi ro:

- Mất email hoặc webhook.
- Dữ liệu hiển thị thành công sai sự thật.
- Celery và Go có thể xử lý trùng cùng một job.

Yêu cầu sửa:

- Thêm `GO_WORKERS_ENABLED=false` làm mặc định khi Celery còn hoạt động.
- Khi false, Go tuyệt đối không claim hoặc update job.
- Không giữ logic mock-success.
- Chỉ bật từng Go worker sau khi gửi thật, có retry, idempotency và integration test.

## 5.2 P0 - Race condition giữa Go startup và Django migrations

Go API có thể bắt đầu worker trước khi Django hoàn tất schema migration.

Rủi ro:

- Query vào bảng/cột chưa tồn tại.
- Container restart nhiều lần rồi mới chạy được.
- Readiness báo xanh nhưng schema chưa đủ cho nghiệp vụ.

Yêu cầu sửa:

- Thêm schema compatibility validator.
- Readiness fail nếu thiếu bảng, cột, index hoặc constraint bắt buộc.
- Worker chỉ khởi động sau khi schema validator pass.
- Thêm startup/migration barrier trong Compose.
- Kiểm tra bookkeeping `000_initial_schema.sql` mà không thay đổi dữ liệu.
- Expose build commit/version để phát hiện image cũ chạy khác source.

## 5.3 P0 - Issue router có thể nhận query chưa được hỗ trợ

`canServeBasicIssueRead` hiện không chặn rõ các query parameter lạ. Request nâng cao có thể vào Go và nhận response thiếu trường thay vì fallback Django.

Yêu cầu sửa:

- Dùng allowlist query parameter.
- Query chưa được chứng minh hỗ trợ phải fallback Django.
- Test ít nhất: `expand`, `fields`, filter, `cursor`, `per_page`, `group_by`, `sub_group_by`, `order_by` và query lạ.
- Không thay đổi response của route cơ bản đang hoạt động.

## 5.4 P0 - Blockchain readiness chưa phản ánh khả năng hoạt động thật

Tracking online có thể trả `501` khi verifier chưa được cấu hình dù health endpoint vẫn ready.

Yêu cầu sửa:

- Readiness phải kiểm tra RPC, chain ID, contract address và verifier.
- Phân biệt rõ `online`, `offline` và `disabled`.
- Không được ghi `verified=true` nếu chưa xác minh receipt và event.
- Nếu online là bắt buộc mà verifier không sẵn sàng, readiness phải degraded hoặc not-ready.
- Offline mode phải tiếp tục cho phép nghiệp vụ Plane hoạt động theo hợp đồng hiện tại.

## 5.5 P0 - Migration bookkeeping chưa rõ ràng

Database hiện có dấu hiệu chỉ ghi nhận migration `001` trong `go_schema_migrations`, trong khi code có logic xử lý `000_initial_schema.sql`.

Antigravity phải xác minh:

- Container đang chạy đúng source hiện tại hay image cũ.
- Logic skip migration có ghi lịch sử chính xác hay không.
- Có trường hợp concurrent startup làm mất bookkeeping hay không.

Không được chạy lại initial schema một cách mù quáng trên database đang có dữ liệu.

## 5.6 P1 - Thiếu contract route matrix

Hiện chưa có nguồn sự thật duy nhất cho biết:

- Route nào thuộc Go.
- Route nào proxy Django.
- Route nào mới chỉ partial.
- Route nào có khác biệt response hoặc side effect.

Cần sinh matrix tự động từ Python URL configuration và Go router.

## 5.7 P1 - Package Go chưa có test riêng

Các package cần ưu tiên bổ sung test:

- `worker`
- `storage`
- `asset`
- `comment`
- `commentreaction`
- `subissue`
- `subscriber`
- `relation`
- `reaction`
- `link`
- `search`
- `view`
- `activity`
- `archive`
- `intake`
- `legacy`
- `cmd/api`

## 5.8 P1 - Reverse proxy và migration-status

- Reverse proxy đang được tạo trong luồng request fallback; nên khởi tạo một lần khi build router.
- `migration-status` không được hardcode legacy fallback.
- Response migration status phải phản ánh config runtime và route ownership thật.

## 5.9 P1 - Tài liệu migration đã cũ

README không còn phản ánh chính xác toàn bộ module đã chuyển. Chỉ cập nhật tài liệu sau khi có route matrix tự động để tránh sai lệch tiếp tục.

## 6. Definition of parity

Một endpoint chỉ được xem là chuyển xong khi thỏa mãn toàn bộ:

- Cùng URL và HTTP method.
- Cùng authentication và permission.
- Cùng status code.
- Cùng JSON schema và kiểu dữ liệu.
- Cùng header, cookie và redirect.
- Cùng validation error.
- Cùng pagination và ordering.
- Cùng database side effect.
- Cùng background side effect.
- Cùng transaction/rollback behavior.
- Unit test pass.
- Contract test Django-Go pass.
- Integration test với PostgreSQL thật pass.
- Route không fallback trong staging.

Chỉ có handler Go chưa đủ để đánh dấu `DONE`.

## 7. Kế hoạch triển khai chi tiết

## Giai đoạn 0 - Lập route parity matrix

### Công việc

1. Viết công cụ quét toàn bộ Python URL configuration.
2. Quét route Go từ router hoặc một registry có cấu trúc.
3. Xuất `migration-route-matrix.json` và tài liệu Markdown tương ứng.
4. Mỗi record gồm:

```text
method
path
python_view
go_handler
owner: GO | PYTHON | PROXY | PARTIAL
authentication
permission
request_schema
response_schema
status_codes
database_side_effects
background_side_effects
tests
notes
```

5. Thêm CI check để route Python mới không bị bỏ sót khỏi matrix.

### Điều kiện hoàn thành

- Mọi Python route đều xuất hiện trong matrix.
- Mọi Go route đều ánh xạ được tới legacy contract hoặc được đánh dấu Go-only.
- Không còn route không rõ owner.

## Giai đoạn 1 - Ổn định P0

### Sprint 1A - Worker ownership

- Thêm config `GO_WORKERS_ENABLED`.
- Default false trong local/compose khi Celery còn chạy.
- Không start goroutine worker khi false.
- Không update job khi worker bị disable.
- Thêm unit test config và worker startup.
- Thêm integration test bảo đảm Celery/Go không claim trùng.

### Sprint 1B - Database readiness

- Tạo danh sách bảng/cột bắt buộc cho từng module Go.
- Thêm schema validator.
- Tách liveness và readiness.
- Chỉ start worker sau readiness schema.
- Thêm retry có giới hạn khi DB chưa sẵn sàng.
- Kiểm tra migration history `000`/`001`.
- Không tự chạy destructive repair.

### Sprint 1C - Router correctness

- Sửa `canServeBasicIssueRead` bằng allowlist.
- Tạo reverse proxy một lần lúc router khởi tạo.
- Thêm response/debug header nội bộ để biết request do Go hay Django xử lý.
- Sửa migration-status phản ánh config thật.

### Sprint 1D - Blockchain readiness

- Validate RPC URL và chain ID.
- Validate deployed contract code.
- Validate verifier config.
- Thêm readiness detail nhưng không đưa secret vào response/log.
- Test online success, online unavailable, offline success và disabled.

### Điều kiện hoàn thành Giai đoạn 1

- Không còn mock worker đánh dấu thành công.
- Không có schema error trong 10 phút sau cold start.
- Unsupported issue query chắc chắn fallback.
- Blockchain health phản ánh đúng trạng thái thật.
- `go test`, `go vet`, `go build` pass.

## Giai đoạn 2 - Authentication parity

Thứ tự thực hiện:

1. Magic-link generation.
2. Magic-link sign-in/sign-up.
3. Google OAuth.
4. GitHub OAuth.
5. GitLab OAuth.
6. Gitea OAuth.
7. Spaces authentication variants.

Phải giữ nguyên:

- Cookie name/domain/path/SameSite/Secure.
- CSRF behavior.
- Redirect URL.
- Session expiration.
- Error response.
- Existing account linking behavior.

Không lưu token hoặc secret mới vào log.

## Giai đoạn 3 - API nghiệp vụ còn lại

### Thứ tự ưu tiên

1. Advanced issue/work-item reads.
2. Filter, expand, group, subgroup và pagination.
3. Import/export.
4. Public endpoints.
5. Space endpoints.
6. License endpoints.
7. Các route còn `PROXY`.
8. Các route `PARTIAL`.

### Quy trình mỗi module

1. Đọc Python view, serializer, permission, model và task liên quan.
2. Ghi legacy contract vào matrix.
3. Viết golden test cho Django trước.
4. Implement Go handler/store.
5. Chạy cùng fixture trên Go.
6. So sánh response và DB side effects.
7. Bật Go route qua feature flag.
8. Theo dõi fallback/parity metric.
9. Chỉ đánh dấu `GO` khi mọi acceptance test pass.

## Giai đoạn 4 - Background jobs

Lập inventory toàn bộ Python background tasks và chuyển theo thứ tự:

1. Webhook delivery.
2. Transactional email.
3. Notification.
4. Issue activity/version.
5. Issue automation.
6. Import/export jobs.
7. Cleanup jobs.
8. Storage jobs.
9. Invitation email.
10. Workspace seed và các jobs còn lại.

Mỗi job Go phải có:

- Idempotency key.
- Atomic claim.
- Retry count.
- Exponential backoff.
- Dead-letter behavior.
- Timeout.
- Structured logging.
- Metric success/failure/retry.
- Test duplicate delivery.
- Test crash giữa chừng.
- Test rollback hoặc resume.

Chỉ tắt Celery task tương ứng sau khi Go job qua shadow/canary test. Không xóa Python task.

## Giai đoạn 5 - Tăng độ phủ test

### Unit test

- Bổ sung cho toàn bộ package chưa có test.
- Test validation, authorization, not-found, conflict và database error.

### Contract test

- Chạy cùng request vào Django và Go.
- Chuẩn hóa field thời gian/ID động trước khi compare.
- Compare status, response schema, cookie, header và DB state.

### Integration test

Dùng dịch vụ thật trong test environment:

- PostgreSQL.
- Redis.
- RabbitMQ.
- MinIO/S3-compatible storage.

### E2E bắt buộc

1. Đăng ký, đăng nhập và đăng xuất.
2. Tạo workspace và project.
3. Mời member và đổi role.
4. Tạo, sửa, giao và xóa work item.
5. Tạo nhiều cấp sub-issue.
6. Comment, reaction, attachment và link.
7. Online blockchain success.
8. Blockchain unavailable nhưng offline Plane flow vẫn chạy đúng.
9. Daily report và KPI.
10. Import/export.
11. Email/webhook retry.

## Giai đoạn 6 - Observability

Thêm các thông tin sau:

- Request owner: Go hoặc Django proxy.
- Route template.
- Fallback reason.
- Request ID xuyên suốt Go và Django.
- Số request Go.
- Số request fallback.
- Fallback rate theo route.
- Parity mismatch count.
- Job pending/success/failure/retry.
- Database readiness status.
- Blockchain readiness status.

Không log password, private key, token, cookie hoặc payload nhạy cảm.

## Giai đoạn 7 - Shadow, canary và cutover

1. Shadow read request sang cả Go và Django trên staging.
2. Compare response nhưng chỉ trả một response cho frontend.
3. Khắc phục toàn bộ mismatch.
4. Đưa fallback rate về 0.
5. Tắt fallback trên staging bằng config.
6. Chạy E2E đầy đủ.
7. Soak test 24-48 giờ.
8. Canary production theo workspace hoặc tỷ lệ request.
9. Tắt Django API/Celery bằng config sau khi canary ổn định.
10. Giữ nguyên toàn bộ file Python trong repository.

## 8. Checklist bắt buộc cho mỗi pull request

- [ ] Không xóa hoặc đổi tên file Python.
- [ ] Không thay đổi public API contract.
- [ ] Không thay đổi frontend để che lỗi backend.
- [ ] Có unit test.
- [ ] Có contract/parity test nếu port route.
- [ ] Có migration note nếu chạm database.
- [ ] Không chứa destructive SQL.
- [ ] Không log secret.
- [ ] `gofmt` đã chạy.
- [ ] `go test ./...` pass.
- [ ] `go vet ./...` pass.
- [ ] `go build ./cmd/api` pass.
- [ ] Route matrix đã cập nhật.
- [ ] Fallback behavior được mô tả.
- [ ] Rollback plan được mô tả.

## 9. Báo cáo Antigravity phải trả sau mỗi sprint

```markdown
## Sprint report

### Files changed
- ...

### Routes ported
- METHOD /path

### Routes still using Django
- METHOD /path — reason

### Behavior verified
- ...

### Tests added
- ...

### Commands executed
- gofmt ...
- go test ./...
- go vet ./...
- go build ./cmd/api

### Known differences from Django
- ...

### Runtime/config changes
- ...

### Risks and next task
- ...
```

Không được chỉ trả lời “đã port xong”. Phải có route, test và bằng chứng cụ thể.

## 10. Prompt khởi đầu dành cho Antigravity

```text
Tiếp tục chuyển backend Plane từ Python/Django sang Go trong apps/go-api.

Đọc toàn bộ ANTIGRAVITY_PYTHON_TO_GO_MIGRATION_PLAN.md trước khi sửa.

Quy tắc tuyệt đối:
- Không xóa, đổi tên, di chuyển hoặc format file Python.
- Không thay đổi API contract, DB schema, permission hoặc luồng nghiệp vụ.
- Không sửa frontend để che lỗi backend.
- Giữ Django fallback cho route chưa đạt parity.
- Không để Go và Celery cùng xử lý một job.
- Không mock thành công email/webhook/blockchain.
- Không chạy destructive SQL.

Hãy thực hiện Giai đoạn 1 theo thứ tự:
1. Thêm GO_WORKERS_ENABLED=false mặc định và vô hiệu mock workers an toàn.
2. Thêm schema compatibility/readiness check và worker startup barrier.
3. Kiểm tra an toàn bookkeeping 000_initial_schema.sql/001_blockchain_events.sql.
4. Sửa canServeBasicIssueRead thành allowlist và thêm fallback tests.
5. Khởi tạo legacy reverse proxy một lần và sửa migration-status theo runtime config.
6. Thêm blockchain readiness cho RPC, chain ID, contract và verifier.
7. Bắt đầu sinh route parity matrix tự động.

Sau mỗi phần chạy gofmt, go test ./..., go vet ./... và go build ./cmd/api.
Nếu phát hiện hành vi Django chưa rõ, dừng port endpoint đó, ghi PARTIAL/PROXY
vào matrix và giữ fallback; không tự suy đoán hoặc đổi nghiệp vụ.

Cuối sprint trả báo cáo đúng mẫu trong mục 9 của kế hoạch.
```

## 11. Điều kiện hoàn thành toàn bộ quá trình chuyển đổi

Chỉ xem là hoàn tất khi:

- 100% Python routes có Go equivalent hoặc được xác nhận không còn sử dụng.
- Route matrix không còn `PROXY` hoặc `PARTIAL`.
- Fallback rate bằng 0 trong staging và production canary.
- Tất cả authentication flows chạy bằng Go.
- Tất cả background jobs chạy bằng Go và không còn Celery owner.
- Contract tests không có mismatch.
- E2E tests pass.
- Cold-start không có schema race.
- Blockchain online/offline behavior đúng hợp đồng.
- Django API và Celery có thể tắt bằng config mà frontend vẫn hoạt động đầy đủ.
- Soak test 24-48 giờ không xuất hiện regression nghiêm trọng.
- Mã Python vẫn còn nguyên để chủ dự án tự quyết định thời điểm xóa.

## 12. Quy trình chuyển model và bàn giao công việc

Có thể bắt đầu bằng Claude Opus 4.6 (Thinking), sau đó chuyển sang Gemini 3.1 Pro High khi hết token. Việc đổi model chỉ được thực hiện tại một điểm dừng an toàn và phải có file bàn giao trong repository.

### 12.1 Nguyên tắc bàn giao

1. Không đổi model khi đang sửa dở một transaction, migration hoặc refactor nhiều file.
2. Model hiện tại phải hoàn thành hoặc rollback phần nhỏ đang làm trước khi bàn giao.
3. Không được commit code không build hoặc test đang fail mà không ghi rõ nguyên nhân.
4. Phải cập nhật `ANTIGRAVITY_HANDOFF.md` trước khi kết thúc phiên làm việc.
5. Model tiếp theo phải đọc kế hoạch, handoff và git diff trước khi sửa code.
6. Model tiếp theo không được tự làm lại phần đã hoàn thành.
7. Mọi model đều phải tuân thủ quy tắc không xóa Python và không đổi API contract.
8. `ANTIGRAVITY_HANDOFF.md` là trạng thái tạm thời của lần làm gần nhất; file kế hoạch này vẫn là nguồn yêu cầu chính.

### 12.2 Prompt yêu cầu model hiện tại dừng và bàn giao

Gửi prompt sau cho Claude Opus hoặc model đang làm trước khi hết token:

```text
Dừng tại điểm an toàn và không bắt đầu công việc mới.

Trước khi kết thúc:
1. Hoàn thành hoặc rollback phần thay đổi nhỏ đang làm dở.
2. Chạy các kiểm tra phù hợp với phần đã sửa:
   - gofmt
   - go test ./...
   - go vet ./...
   - go build ./cmd/api
3. Không xóa hoặc thay đổi file Python.
4. Tạo hoặc cập nhật ANTIGRAVITY_HANDOFF.md.

ANTIGRAVITY_HANDOFF.md phải ghi rõ:
- Ngày/giờ bàn giao.
- Model thực hiện.
- Mục tiêu sprint hiện tại.
- Công việc đã hoàn thành.
- File đã tạo hoặc sửa.
- Route đã chuyển sang Go.
- Route vẫn fallback Django và lý do.
- Database/migration đã tác động.
- Test đã thêm.
- Lệnh kiểm tra đã chạy và kết quả thực tế.
- Công việc đang dang dở.
- Lỗi hoặc test đang fail, kèm log ngắn và cách tái hiện.
- Rủi ro còn lại.
- Bước tiếp theo chính xác theo thứ tự.
- Các file model tiếp theo cần đọc trước.

Không chỉ ghi “đã hoàn thành” hoặc “làm tiếp”. Mọi kết luận phải có file,
route, test hoặc bằng chứng cụ thể. Không commit nếu người dùng chưa yêu cầu.
```

### 12.3 Mẫu file `ANTIGRAVITY_HANDOFF.md`

```markdown
# Antigravity handoff

## Thông tin phiên

- Thời gian:
- Model:
- Branch/commit hiện tại:
- Sprint/giai đoạn:

## Mục tiêu phiên này

- ...

## Đã hoàn thành

- ...

## File đã thay đổi

- `path/to/file`: nội dung và lý do thay đổi.

## Route ownership

### Đã chuyển sang Go

- `METHOD /api/path`

### Vẫn fallback Django

- `METHOD /api/path`: lý do.

### Partial hoặc chưa chắc chắn

- `METHOD /api/path`: phần còn thiếu.

## Database và migration

- Migration đã đọc/chạy/thay đổi:
- Schema assumption:
- Rủi ro dữ liệu:

## Test và kiểm tra

- `gofmt ...`: PASS/FAIL
- `go test ./...`: PASS/FAIL
- `go vet ./...`: PASS/FAIL
- `go build ./cmd/api`: PASS/FAIL
- Integration/E2E test:

## Công việc đang dang dở

- ...

## Lỗi và cách tái hiện

1. Lỗi:
2. Các bước tái hiện:
3. Log liên quan:
4. Phân tích hiện tại:

## Bước tiếp theo

1. ...
2. ...
3. ...

## File bắt buộc đọc tiếp

- `AGENTS.md`
- `ANTIGRAVITY_PYTHON_TO_GO_MIGRATION_PLAN.md`
- `ANTIGRAVITY_HANDOFF.md`
- ...
```

### 12.4 Prompt cho Gemini 3.1 Pro High tiếp tục

Sau khi đổi từ Claude Opus sang Gemini 3.1 Pro High, gửi prompt sau:

```text
Tiếp tục quá trình chuyển backend Plane từ Python/Django sang Go.

Trước khi sửa bất kỳ file nào, hãy đọc đầy đủ theo thứ tự:
1. AGENTS.md
2. ANTIGRAVITY_PYTHON_TO_GO_MIGRATION_PLAN.md
3. ANTIGRAVITY_HANDOFF.md
4. Git status và toàn bộ git diff hiện tại
5. Các file được liệt kê trong mục “File bắt buộc đọc tiếp” của handoff

Sau đó:
- Xác minh trạng thái handoff bằng mã nguồn thực tế, không tin mù quáng bản tóm tắt.
- Chạy test nhỏ liên quan trước khi tiếp tục để có baseline.
- Tiếp tục đúng bước đang dang dở trong handoff.
- Không làm lại phần đã hoàn thành nếu mã nguồn và test đã xác nhận.
- Không xóa, đổi tên, di chuyển hoặc format file Python.
- Không thay đổi URL, request/response, status code, permission, database schema
  hoặc luồng nghiệp vụ hiện tại.
- Giữ Django fallback cho route chưa đạt parity.
- Không sửa frontend để che lỗi backend.
- Không mock thành công worker, email, webhook hoặc blockchain.
- Không chạy destructive SQL và không reset dữ liệu.

Chỉ thực hiện một nhóm thay đổi nhỏ có thể review và rollback độc lập.
Sau mỗi phần chạy:
- gofmt
- go test ./...
- go vet ./...
- go build ./cmd/api

Trước khi hết phiên, cập nhật lại ANTIGRAVITY_HANDOFF.md theo trạng thái thực tế.
Không commit nếu người dùng chưa yêu cầu.
```

### 12.5 Lựa chọn model theo loại công việc

- Claude Opus 4.6 (Thinking): kiến trúc, transaction, migration, worker ownership, authentication và lỗi parity phức tạp.
- Gemini 3.1 Pro High: tiếp tục port module, viết handler/store/test và xử lý sprint theo handoff.
- Claude Sonnet 4.6 (Thinking): port module vừa, review và sửa integration test.
- Model Flash/Fast: chỉ dùng cho tác vụ cơ học nhỏ như format, bổ sung test đơn giản hoặc cập nhật tài liệu; không giao migration, authentication, worker hoặc database transaction.

### 12.6 Điều kiện của một điểm dừng an toàn

Một phiên chỉ được xem là dừng an toàn khi:

- Không có file đang ở trạng thái viết dở hoặc syntax error.
- Không có migration đã chạy một phần.
- Không có thay đổi database chưa được ghi nhận.
- Phần code vừa sửa build được hoặc đã rollback.
- Test fail đã được ghi rõ trong handoff.
- Route ownership và fallback không bị nhập nhằng.
- `ANTIGRAVITY_HANDOFF.md` phản ánh đúng git diff hiện tại.

## 13. Prompt tiếp tục migration dành cho Antigravity (bản có thẩm quyền cao nhất)

Sao chép nguyên khối prompt dưới đây và gửi cho Antigravity. Prompt này đã bao
gồm hiện trạng mới nhất, lỗi đã xác minh, thứ tự triển khai và điều kiện nghiệm
thu. Không được thay thế bằng câu ngắn như “làm tiếp”.

```text
Bạn đang tiếp tục chuyển toàn bộ backend Plane từ Python/Django sang Go tại:

  C:\task-system\plane

MỤC TIÊU CUỐI CÙNG

1. Toàn bộ API, authentication, permissions, database side effects,
   background jobs và integration hiện do Python/Django/Celery xử lý phải có
   implementation Go tương thích đầy đủ.
2. Frontend giữ nguyên contract và cuối cùng chỉ cần gọi Go API.
3. Django API, Celery worker và Celery beat có thể tắt bằng cấu hình mà hệ
   thống vẫn hoạt động đầy đủ.
4. KHÔNG xóa bất kỳ mã Python nào. Chủ dự án sẽ tự xóa sau khi nghiệm thu.
5. Không thay đổi luồng hoạt động, API contract hoặc giao diện để làm migration
   dễ hơn. Đây là chuyển ngôn ngữ, không phải thiết kế lại sản phẩm.

NGUYÊN TẮC TUYỆT ĐỐI

- Không xóa, đổi tên, di chuyển, format hoặc sửa không cần thiết bất kỳ file
  Python nào trong apps/api.
- Không xóa Django/Celery/legacy fallback trước khi toàn bộ điều kiện cutover
  được đáp ứng.
- Không đổi URL, HTTP method, query parameter, request body, response JSON,
  status code, header, cookie, redirect, permission, role hoặc side effect.
- Không thay đổi database schema hiện hữu chỉ để Go dễ triển khai hơn.
- Không sửa frontend để che lỗi hoặc bù cho response Go sai contract.
- Không mock thành công email, webhook, blockchain hoặc background job.
- Không để Go worker và Celery cùng claim/xử lý một job.
- Không chạy DROP, TRUNCATE, reset database, xóa volume hoặc destructive SQL.
- Không log password, token, cookie, private key hoặc payload nhạy cảm.
- Không tin mù quáng ANTIGRAVITY_HANDOFF.md, route_parity_matrix.md hoặc báo
  cáo cũ. Luôn đối chiếu source và test.
- Không commit nếu người dùng chưa yêu cầu. Giữ nguyên thay đổi không liên
  quan đang có trong working tree.
- Mỗi nhóm thay đổi phải nhỏ, review được và rollback độc lập.

THỨ TỰ ĐỌC BẮT BUỘC TRƯỚC KHI SỬA

1. AGENTS.md.
2. ANTIGRAVITY_PYTHON_TO_GO_MIGRATION_PLAN.md, đặc biệt mục 13 này.
3. ANTIGRAVITY_HANDOFF.md, nhưng xem đó chỉ là ghi chú tham khảo.
4. git status --short, git diff --stat và toàn bộ git diff liên quan.
5. route_parity_matrix.md và migration-route-matrix.json.
6. apps/go-api/cmd/api/main.go.
7. apps/go-api/internal/httpapi/router.go và router tests.
8. apps/go-api/internal/database/migrate.go, schema_validator.go và tests.
9. apps/go-api/internal/worker/manager.go.
10. apps/go-api/internal/tracking/handler.go.
11. Module Python tương ứng trước mỗi route được port: URL, view, serializer,
    permission, model, signal và Celery task liên quan.

BASELINE ĐÃ ĐƯỢC KIỂM CHỨNG

- Branch hiện tại khi lập prompt: chuyen_py_sang_go_2.
- Working tree có nhiều thay đổi chưa commit: ít nhất 20 file tracked đã sửa,
  khoảng 1.049 dòng thêm/185 dòng xóa, cùng nhiều file untracked.
- Không có file Python bị xóa trong đợt thay đổi hiện tại.
- go test ./...: PASS.
- go vet ./...: PASS.
- go build ./cmd/api: PASS.
- Kết quả xanh mới chỉ chứng minh compile/unit baseline, chưa chứng minh parity
  với Django hoặc production readiness.
- Thống kê tạm trong route_parity_matrix.md: khoảng 46/347 route ported,
  165/347 partial và 136/347 legacy. Cách suy luận method của matrix còn sai
  ở nhiều Django APIView nên không dùng số này để tuyên bố % hoàn thành.
- Reverse proxy đã được khởi tạo một lần trong NewRouter và migration-status
  đã phản ánh runtime config tốt hơn trước.
- GO_WORKERS_ENABLED mặc định false. Trạng thái này phải giữ nguyên cho đến
  khi worker Go thực sự gửi/xử lý job và vượt qua integration test.
- Draft Issues, project favorites, instances, cycle progress/analytics,
  estimates và intake đã có thêm code Go, nhưng chưa phải tất cả đều đạt parity.

KHÔNG ĐƯỢC TUYÊN BỐ “P0 COMPLETED” Ở TRẠNG THÁI HIỆN TẠI.

BLOCKER P0 PHẢI SỬA TRƯỚC KHI PORT THÊM MODULE

P0.1 - Schema validator kiểm tra sai tên bảng

- apps/go-api/internal/database/schema_validator.go đang yêu cầu bảng
  project_projectmember.
- Schema/migration thật tạo bảng project_members và Go stores cũng query bảng
  project_members.
- Sửa validator dùng đúng physical table name.
- Viết test đối chiếu TOÀN BỘ requiredTables/requiredColumns với schema SQL
  hoặc PostgreSQL test database; không chỉ kiểm tra vài tên tĩnh.
- Chứng minh Go API startup được trên database Plane hợp lệ sau khi sửa.

P0.2 - PostgreSQL advisory migration lock không giữ cùng connection

- migrate.go đang lock/unlock qua pgxpool.Exec. Session-scoped advisory lock
  có thể được lấy và nhả trên hai physical connection khác nhau.
- Acquire đúng một connection từ pool.
- Lock, đọc migration history, chạy migration transaction và unlock trên cùng
  connection. Luôn defer unlock/release và xử lý context cancellation.
- Thêm test cho concurrent migration/startup. Không dùng sleep mong manh nếu
  có thể đồng bộ bằng channel/barrier.
- Không tự chạy lại initial schema trên database đã có dữ liệu.

P0.3 - Go workers chưa được implement thật

- worker.Manager.Start khi Enabled=true hiện chỉ log “started”; webhook/email
  vẫn là TODO và không có processing loop thật.
- Trước mắt giữ GO_WORKERS_ENABLED=false, log rõ Celery là owner và
  migration-status/readiness không được mô tả worker là hoạt động.
- Không bật cờ true ở compose/production.
- Khi port worker sau này phải có atomic claim, SKIP LOCKED, idempotency,
  timeout, retry/backoff, dead-letter, structured logging và integration test.

P0.4 - Draft-to-Issue không nguyên tử

- Luồng hiện tạo issue, chuyển file asset rồi xóa draft bằng các operation rời.
- Lỗi TransferFileAssets và DeleteForSession đang bị nuốt nhưng API vẫn 201.
- Chuyển toàn bộ create issue + transfer assets + delete draft vào một DB
  transaction trên cùng connection, hoặc thiết kế idempotency/compensation có
  test rõ ràng nếu transaction chung thực sự không thể dùng.
- Không trả 201 khi trạng thái dữ liệu bị dang dở.
- Test rollback ở từng điểm lỗi và test retry không tạo issue trùng.

P0.5 - Issue router nhận query mà Go chưa hỗ trợ đầy đủ

- Router đang allow cursor, per_page, order_by, group_by, sub_group_by, expand,
  state, state_group, priority, labels, assignees, created_by và fields.
- Issue store chưa chứng minh parity cho sub_group_by; fields chưa được truyền
  đầy đủ; order_by chỉ hỗ trợ rất ít giá trị; grouped pagination/response còn
  khác Django.
- Mặc định fallback Django đối với MỌI query/combination chưa có parity test.
- Chỉ mở từng query sang Go sau khi contract test với Django pass.
- Query lạ phải fallback, không được silently ignore.

P0.6 - Blockchain readiness/tracking chưa đầy đủ

- /health/ready hiện chủ yếu ping PostgreSQL và vẫn trả HTTP 200 khi blockchain
  online nhưng verifier không được khởi tạo.
- tracking handler vẫn có nhánh 501 “on-chain verification has not been
  migrated”.
- Phân biệt rõ disabled/offline/online.
- Online bắt buộc phải kiểm tra RPC reachability, chain ID, contract address,
  deployed bytecode và verifier readiness.
- Không ghi verified=true nếu receipt/event không thuộc đúng contract/function.
- Offline mode phải cho nghiệp vụ Plane tiếp tục theo contract hiện tại.
- Không đưa RPC credential hoặc secret vào health response/log.

SPRINT A - ỔN ĐỊNH BLOCKER

Thực hiện P0.1 đến P0.6 theo đúng thứ tự. Sau mỗi mục:

1. gofmt các file Go đã chạm.
2. go test package liên quan.
3. go test ./...
4. go vet ./...
5. go build ./cmd/api
6. Cập nhật test và route matrix nếu ownership thay đổi.
7. Ghi bằng chứng thực tế vào ANTIGRAVITY_HANDOFF.md.

Không chuyển sang Sprint B nếu schema validator hoặc migration locking còn sai.

SPRINT B - XÂY PARITY HARNESS TIN CẬY

1. Sửa generator route matrix để đọc đúng method thực sự của Django APIView,
   ViewSet và nested route; không gán tự động toàn bộ HTTP methods.
2. Mỗi record phải có method, path, Python view, Go handler, owner,
   authentication, permission, request/response schema, DB side effects,
   background side effects, test và known differences.
3. Tạo contract-test harness gửi cùng fixture/request vào Django và Go rồi so:
   status, JSON shape/type, header, cookie, redirect và DB state.
4. Chuẩn hóa chỉ các giá trị động hợp lệ như timestamp, UUID, request ID; không
   bỏ qua field khác biệt để làm test xanh.
5. Thêm PostgreSQL integration tests thật cho authorization, transaction,
   migration và các store trọng yếu.
6. Test reverse proxy: cookie/header/body/status/streaming phải được bảo toàn.
7. Thêm metric/header nội bộ để xác định request do Go hay Django xử lý và lý
   do fallback, nhưng không thay đổi public contract.

SPRINT C - PORT API THEO TỪNG VERTICAL SLICE

Không port theo kiểu chỉ tạo handler cho đủ tên. Mỗi slice phải gồm route,
permission, serializer contract, store transaction, side effect và tests.

Thứ tự ưu tiên:

1. Authentication còn thiếu: magic link, OAuth Google/GitHub/GitLab/Gitea,
   Spaces auth variants, cookie/CSRF/session/redirect parity.
2. Core issue/work item reads và writes nâng cao: filters, expand, fields,
   grouping, subgrouping, cursor pagination, ordering, activity/version.
3. Draft issue sau khi transaction safety hoàn tất.
4. Attachments/file assets/storage, comments, reactions, relations, links,
   subscribers, sub-issues và archive.
5. Workspace/project/member/invite/role/settings còn PARTIAL hoặc PROXY.
6. Cycles, modules, views, pages, estimates, intake và analytics còn partial.
7. Import/export và long-running workflows.
8. Public, Space và license endpoints.
9. Instance/admin routes còn lại.
10. Mọi route legacy còn trong matrix.

Quy trình bắt buộc cho MỖI route/module:

1. Đọc Python URL/view/serializer/permission/model/signal/task.
2. Ghi contract và side effects vào route matrix trước khi implement.
3. Viết Django golden/contract test hoặc fixture mô tả hành vi hiện hữu.
4. Implement Go với transaction boundary tương đương.
5. Thêm unit và PostgreSQL integration tests.
6. So sánh Django-Go bằng cùng input/fixture.
7. Giữ fallback nếu còn bất kỳ mismatch nào.
8. Chỉ đổi owner sang GO khi tất cả test pass và không còn known difference.
9. Chạy full Go checks trước khi sang route kế tiếp.

SPRINT D - PORT BACKGROUND JOBS/CELERY

Lập inventory tự động và thủ công toàn bộ Celery tasks, signals, scheduled jobs
và nơi enqueue. Port theo thứ tự:

1. Transactional email/invitation.
2. Webhook delivery.
3. Notifications.
4. Issue activity/version/automation.
5. Import/export.
6. Storage/file processing/cleanup.
7. Workspace seed và scheduled maintenance.
8. Tất cả task còn lại.

Mỗi job Go phải có:

- Một owner duy nhất.
- Atomic claim với SELECT FOR UPDATE SKIP LOCKED hoặc cơ chế tương đương.
- Idempotency key và unique constraint phù hợp.
- Retry giới hạn, exponential backoff, timeout và dead-letter.
- Xử lý crash giữa chừng, restart và duplicate delivery.
- Structured log và metrics nhưng không log secret.
- Test success, transient failure, permanent failure, duplicate, crash và retry.
- Shadow/canary trước khi tắt Celery task tương ứng.

Chỉ bật GO_WORKERS_ENABLED khi toàn bộ worker được cấu hình thực sự hoạt động.
Không xóa Python task sau khi chuyển.

SPRINT E - CUTOVER KHÔNG XÓA PYTHON

1. Matrix không còn PARTIAL/PROXY/UNKNOWN.
2. Contract tests và E2E pass cho toàn bộ critical flows.
3. Fallback rate bằng 0 trên staging trong thời gian soak 24-48 giờ.
4. Tắt LEGACY_API_URL/fallback bằng config trên staging.
5. Tắt Django API/Celery bằng config trên staging, không xóa source/container
   definition trong repository.
6. Chạy lại đăng ký/đăng nhập/logout, workspace/project/member, issue/subissue,
   comment/attachment, import/export, email/webhook, blockchain online/offline,
   daily report/KPI và admin/instance flows.
7. Canary production có rollback rõ ràng.
8. Sau canary ổn định mới báo người dùng rằng Python có thể được tự xóa.

TEST COVERAGE TỐI THIỂU

- Mọi package có handler/store phải có test thực chất.
- Ưu tiên bổ sung test cho: draftissue, legacy, activity, archive, asset,
  comment, commentreaction, link, reaction, relation, search, storage,
  subissue, subscriber và view.
- Test không được chỉ kiểm tra slice tĩnh hoặc “package compile”.
- Không dùng mock DB để thay thế toàn bộ integration tests PostgreSQL.
- Test permission cho owner/admin/member/guest/unauthenticated.
- Test not-found, conflict, invalid input, database error và rollback.

READINESS/OBSERVABILITY BẮT BUỘC

- Liveness chỉ phản ánh process sống.
- Readiness phản ánh PostgreSQL/schema, worker ownership, legacy dependency khi
  còn fallback và blockchain khi mode online yêu cầu nó.
- Expose version/build commit an toàn.
- Có request ID xuyên Go và Django proxy.
- Có route owner, fallback reason, fallback rate và parity mismatch metrics.
- Không trả “ready” gây hiểu nhầm khi dependency bắt buộc degraded.

GIT VÀ AN TOÀN WORKING TREE

- Trước mỗi nhóm sửa, xem git status/diff để không ghi đè thay đổi người dùng.
- Không reset --hard, checkout --, clean hoặc xóa file untracked.
- Hiện có nhiều thay đổi Antigravity chưa commit; phải bảo toàn tất cả.
- Không tự commit. Nếu người dùng yêu cầu commit, chia thành commit nhỏ theo:
  database safety, router parity, module port, workers và docs/tests.

ĐIỀU KIỆN ĐƯỢC ĐÁNH DẤU MỘT ROUTE “DONE”

- Cùng URL/method/query/body.
- Cùng auth/permission/role.
- Cùng status/header/cookie/redirect.
- Cùng JSON schema/type/null/default/error.
- Cùng pagination/filter/order/group behavior.
- Cùng DB mutation, transaction và rollback.
- Cùng signals/background side effects.
- Unit + integration + Django-Go contract tests pass.
- Không fallback trong staging.
- Không có known difference chưa được người dùng chấp thuận.

ĐIỀU KIỆN ĐƯỢC TUYÊN BỐ “CHUYỂN XONG PYTHON SANG GO”

- 100% route Python đang sử dụng có Go equivalent đạt định nghĩa DONE.
- Không còn PROXY/PARTIAL/UNKNOWN trong route matrix.
- Không còn request fallback trong soak/canary.
- Tất cả authentication và background jobs chạy bằng Go.
- GO_WORKERS_ENABLED có processing thật và Celery có thể tắt.
- Django API/Celery có thể tắt mà toàn bộ E2E vẫn pass.
- Không còn nhánh 501/not migrated hoặc mock-success.
- Cold start/migration/schema concurrency test pass.
- Blockchain online/offline/disabled hoạt động đúng contract.
- Python vẫn còn nguyên trong repository để người dùng tự xóa.

CÁCH LÀM VIỆC LIÊN TỤC

- Bắt đầu ngay từ Sprint A và tiếp tục qua các sprint theo thứ tự.
- Không dừng chỉ vì một module đã build hoặc unit test pass.
- Khi gặp contract Django chưa rõ, giữ fallback, ghi PARTIAL và điều tra source;
  không tự suy đoán.
- Khi gần hết context/token, dừng ở điểm an toàn và cập nhật
  ANTIGRAVITY_HANDOFF.md bằng bằng chứng chính xác để model sau tiếp tục.
- Handoff cũ đang ghi “P0 completed” và “Draft Issues PASS - no test files”; hai
  kết luận này không còn hợp lệ. Hãy sửa handoff sau khi xác minh và hoàn thành
  các blocker thật.

SAU MỖI SPRINT PHẢI BÁO CÁO

1. Files changed và lý do.
2. Routes chuyển sang Go.
3. Routes còn Django fallback/partial và lý do.
4. Contract/side effects đã xác minh.
5. Tests thêm mới.
6. Lệnh thực tế đã chạy và PASS/FAIL.
7. Runtime/config/database changes.
8. Known differences và rủi ro.
9. Bước tiếp theo chính xác.
10. Cập nhật route matrix và ANTIGRAVITY_HANDOFF.md.

Bắt đầu bằng việc xác minh lại baseline, sau đó sửa P0.1 schema table name và
P0.2 advisory lock. Không port thêm route trước khi hai mục này có test thực
chất và toàn bộ go test/vet/build đều pass.
```
