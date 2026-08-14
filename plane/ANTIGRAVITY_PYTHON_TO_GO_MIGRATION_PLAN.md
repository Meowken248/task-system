# Kế hoạch chuyển backend Plane từ Python/Django sang Go

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
