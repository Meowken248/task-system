# BÁO CÁO KIỂM TOÁN LỖI CÒN LẠI & KẾ HOẠCH SỬA CHUẨN DOANH NGHIỆP — PLANE DAPP

| Thông tin | Giá trị |
|---|---|
| Phiên bản | `v1.1` — 24/10/2026 (v1.0: kiểm toán · v1.1: **đã sửa mã nguồn**, xem §11) |
| Phạm vi | `apps/web`, `packages/services` (DApp router + on-chain bridge), `.env`, Crypto Vault |
| Commit kiểm toán | `be73bda` (working tree sạch) |
| Cách thực hiện | Kiểm toán tĩnh + sửa mã + kiểm chứng bằng `tsc --noEmit`, `oxlint`, `react-router build`, cổng chặn bí mật |
| Tài liệu liên quan | [`AUDIT_TEST_CASES_REPORT.md`](./AUDIT_TEST_CASES_REPORT.md), [`docs/onchain-migration-status.md`](./docs/onchain-migration-status.md) |

---

## MỤC LỤC

| § | Nội dung | Dành cho |
|:--:|---|---|
| 0 | Cách đọc tài liệu (mã lỗi, thang mức độ, mẫu 7 phần) | Mọi người |
| 1 | Tóm tắt điều hành + bảng ưu tiên toàn bộ lỗi | Quản lý / BA |
| 2 | Phương pháp, bằng chứng, bản đồ luồng ghi on-chain | Dev / QA |
| **3** | **`CHAIN-09` — 1 hành động bị ký 2–3 lần, nonce nhảy 2–3** (lỗi mới) | Dev / QA |
| 4 | Chi tiết 6 lỗi P0 còn lại | Dev |
| 5 | Chi tiết các lỗi P1 | Dev |
| 6 | Bảng P2 / P3 | BA / PM |
| 7 | Ma trận 34 test case BA/QA (PASS/RISK/FAIL) | BA / QA |
| 8 | Nợ kỹ thuật TypeScript | Dev |
| 9 | Definition of Done + lệnh kiểm chứng | QA / CI |
| 10 | Ký xác nhận, câu hỏi mở, thứ tự thực hiện | Quản lý |
| **11** | **Nhật ký sửa lỗi: đã sửa gì, kiểm chứng ra sao, còn lại gì** | Dev / QA / Quản lý |
| A | Phụ lục: bảng tra `file:line` cho `CHAIN-09` | Dev |

---

## 0. CÁCH ĐỌC TÀI LIỆU

### 0.1 Quy ước mã lỗi

| Tiền tố | Nhóm | Ví dụ |
|---|---|---|
| `BUILD-xx` | Biên dịch / chất lượng mã | `BUILD-01` |
| `WALLET-xx` | Ví, Crypto Vault, Trung tâm ví | `WALLET-01` |
| `CHAIN-xx` | Đồng bộ on-chain, contract, IPFS, membership | `CHAIN-01` |
| `SEC-xx` | Bảo mật, bí mật trong bundle, xác thực | `SEC-01` |
| `BA-xx` | Test case BA/QA còn lỗi (số = `ID` gốc) | `BA-08` = ID 8 |
| `ARCH-xx` | Kiến trúc / vận hành | `ARCH-01` |

### 0.2 Thang mức độ

| Mức | Định nghĩa | Hệ quả nếu không sửa |
|---|---|---|
| **P0** | Chặn release, lộ bí mật, sai lệch dữ liệu audit | Không thể coi là "production ready" |
| **P1** | Sai chức năng nghiệp vụ, người dùng hiểu sai trạng thái | Mất niềm tin, dữ liệu on-chain lệch |
| **P2** | Ảnh hưởng UX/độ tin cậy, có workaround | Tăng ticket support |
| **P3** | Cải tiến, thông điệp, thẩm mỹ | Nợ kỹ thuật |

### 0.3 Cấu trúc mỗi lỗi

Mỗi lỗi có 7 phần cố định để bất kỳ ai (kể cả người mới) sửa được:

1. **Mức độ / khu vực / trạng thái**
2. **Triệu chứng** (người dùng thấy gì)
3. **Bằng chứng** (`file:line`)
4. **Nguyên nhân gốc** (vì sao, không chỉ "ở đâu")
5. **Ảnh hưởng** (blast radius)
6. **Cách sửa chuẩn doanh nghiệp** (từng bước + code sketch + chống hồi quy)
7. **Tiêu chí nghiệm thu + Test case** (mục 6)

---

## 1. TÓM TẮT ĐIỀU HÀNH (TL;DR)

### 1.1 Bảng ưu tiên toàn bộ lỗi còn lại

| ID | Mức | Khu vực | Mô tả 1 dòng | Công sửa |
|---|:--:|---|---|:--:|
| `BUILD-01` | **P0** | CI/TS | 4 lỗi `tsc` thật ở `apps/web` ⇒ `pnpm check:types` fail | 15 phút |
| `SEC-01` | **P0** | Bí mật | `.env.production` **được git track** chứa Brevo key + BLS private key | 1–2 giờ + rotate |
| `SEC-02` | **P0** | Bí mật | `VITE_BLS_PRIVATE_KEY` nhúng vào bundle và **dùng để ký** | 2–5 ngày |
| `SEC-03` | **P0** | Xác thực | OTP verify **hoàn toàn ở client**, OTP in ra log + nằm trong subject email | 1–2 ngày |
| `CHAIN-01` | **P0** | On-chain | `getIssueTaskId` revert ⇒ mọi thao tác task/attachment fail | 0.5–2 ngày |
| `CHAIN-02` | **P0** | On-chain | Sync báo **"thành công"** dù `updateWorkspaceCID`/`createWorkspace` fail | 0.5 ngày |
| `CHAIN-09` | **P0** | On-chain | **1 hành động ⇒ 2–3 giao dịch & nonce nhảy 2–3** (fan-out commit CID + 3 lớp retry không idempotent) | 2–3 ngày |
| `WALLET-01` | P1 | Ví | "Mở MetaNode Wallet" mở `:6005` — **khác origin** Vault Plane ký (`:6002`) | 0.5 ngày |
| `WALLET-02` | P1 | Ví | Luồng ghi khác (task/comment/member/attachment) **không preflight** Vault | 1 ngày |
| `CHAIN-03` | P1 | On-chain | `backfillIssuesOnChain` gộp mọi lỗi + toast **success** dù `failed > 0` | 0.5 ngày |
| `CHAIN-04` | P1 | On-chain | Retry nonce chạy lại **toàn bộ** pipeline (không idempotent) | 1 ngày |
| `CHAIN-05` | P1 | Membership | 3 địa chỉ lệch nhau ⇒ quyền on-chain sai | 1–2 ngày |
| `BA-08` | P1 | Test case | Assignee dropdown bỏ sót thành viên Workspace | 2 giờ |
| `BA-21` | P1 | Test case | Link dự án chia sẻ trả **404** thay vì "Not Authorized" | 1 ngày |
| `BA-32` | P1 | Test case | Upload attachment treo "Pending" tới 2 phút rồi lỗi | 1–2 ngày |
| `BA-14/07` | **P0** | Test case | Email mời/OTP vào Spam + key Brevo lộ | 1 ngày + DNS |
| `SEC-05` | P1 | Hạ tầng | RPC `http://` + `RPC_ALLOW_INSECURE_TLS=true` | 0.5 ngày |
| `SEC-06` | P1 | Dữ liệu | Toàn bộ DB workspace trong `localStorage` + IPFS công khai | 3–5 ngày |
| `WALLET-03` | P2 | Ví | Badge ví không cập nhật sau khi chọn/import ví | 0.5 ngày |
| `WALLET-04` | P2 | Ví | Trung tâm ví gọi `getAllWallets` (RPC balance) mỗi lần `focus` | 2 giờ |
| `WALLET-05` | P2 | Ví | Sync button + Trung tâm ví render **toàn cục**, cả trang login | 2 giờ |
| `WALLET-06` | P2 | Ví | Import có thể "nhận vơ" ví cũ khi không đọc được danh sách trước | 2 giờ |
| `CHAIN-06` | P2 | On-chain | `issueExistsOnChain` nuốt **mọi** lỗi ⇒ coi là "chưa có" | 1 giờ |
| `CHAIN-07` | P2 | On-chain | Đọc contract bằng `ZERO_ADDRESS` khi Vault rỗng | 2 giờ |
| `CHAIN-08` | P2 | On-chain | Không hiển thị "đã/chưa đồng bộ" cho người dùng | 1–2 ngày |
| `BA-18` | P2 | Test case | Phân trang chỉ là hình thức (`total_pages = 1`) | 2–3 ngày |
| `BA-27` | P2 | Test case | Importers trả `[]` ⇒ tính năng Import rỗng | 3–5 ngày |
| `BA-41` | P3 | Test case | Đăng nhập email ưu tiên password thay vì thuần OTP | Quyết định BA |
| `BA-30` | P3 | Test case | Toggle Public/Private comment nằm trong menu | 2 giờ |
| `ARCH-01` | P1 | Kiến trúc | Không có indexer/list on-chain ⇒ máy khác không thấy dữ liệu | 2–4 tuần |
| `ARCH-02` | P2 | Kiến trúc | Nhiều tab ghi đè `localStorage` (không lock) | 2 ngày |

> **Đọc nhanh**: **7 lỗi P0** phải xử lý trước khi coi hệ thống "chạy được ở môi trường thật": `SEC-01`, `SEC-02`, `SEC-03` (bảo mật), `CHAIN-09` (mỗi hành động bị ký 2–3 lần), `CHAIN-01`, `CHAIN-02` (tính đúng đắn on-chain), `BUILD-01` (cổng CI).

### 1.2 Năm kết luận quan trọng nhất

1. **Lỗi "Wallet not found" đã được xử lý đúng hướng** — trước đây chỉ ở luồng *Sync to Chain*; **nay đã áp dụng cho cả luồng ghi khác** (tạo task, cập nhật, giao việc, xoá, bình luận, tệp đính kèm): `confirmSigningWallet()` kiểm tra ví trước khi ký và `notifyVaultProblem()` mở "Trung tâm ví" đúng chế độ (`WALLET-02`, §5.2).
2. **Rủi ro lớn nhất hiện tại là on-chain task**, không còn là ví: `getIssueTaskId()` revert (`execution reverted`, selector `0x0531bbb1` / `0x464522a9`) làm **mọi** thao tác task thất bại, kéo theo attachment treo "Pending" (`BA-32`) và backfill báo sai (`CHAIN-03`).
3. **Sync đang "nói dối" ở một nhánh**: nếu `updateWorkspaceCID`/`createWorkspace` fail, lỗi bị `console.warn` nuốt và UI vẫn hiện toast **"Đồng bộ on-chain thành công"** (`CHAIN-02`).
4. **Lỗi "1 hành động bị ký 2–3 lần" (`CHAIN-09`) là lỗi P0 mới, đã tìm ra nguyên nhân gốc**: mỗi lần lưu dữ liệu (`saveDB`) đều tự sinh thêm 1 giao dịch `updateWorkspaceCID`; cộng với giao dịch nghiệp vụ và 3 lớp retry không idempotent ⇒ nonce tăng 2–3. Chi tiết + kế hoạch sửa ở §3.
5. **Selector revert `0x0531bbb1` đã được giải mã = `InvalidTask()`** ⇒ `CHAIN-01` là "contract không có task", không phải lỗi ABI; và `0x464522a9` không tồn tại trong bản contract của repo ⇒ môi trường đang chạy khác bản trong `artifacts/` (§4.5).

---

## 2. PHƯƠNG PHÁP & BẰNG CHỨNG

### 2.1 Trạng thái kiểm toán

| Hạng mục | Giá trị |
|---|---|
| Commit kiểm toán | `be73bda` |
| Working tree | Sạch (đợt này **chỉ thêm/sửa tài liệu `.md`**, không đổi mã nguồn) |
| Cổng kiểm tra | `npx tsc --noEmit` cho `apps/web` → **4 lỗi**; `packages/services` → **0 lỗi** |
| Phương pháp | Đọc mã nguồn tại đúng dòng + suy luận theo call-graph. **Không** suy đoán hành vi runtime khi chưa có log. |
| Giới hạn | Không có quyền chạy trình duyệt/Crypto Vault trong phiên này ⇒ các kết luận runtime được đánh dấu rõ là *suy ra từ mã* hay *đã kiểm chứng bằng ảnh/log của anh/chị*. |

### 2.2 Các biến cấu hình quyết định hành vi giao dịch

| Biến | Ý nghĩa | Mặc định trong mã |
|---|---|---|
| `VITE_ONCHAIN_TASKS_ENABLED` | Bật ghi task on-chain | phải `true` |
| `VITE_AUTO_COMMIT_ONCHAIN` | Bật **ghi ngầm** CID workspace | `true` (tức là **mặc định BẬT**) |
| `VITE_REGISTRY_CONTRACT_ADDRESS` | `OffchainDataRegistry` (setCID) | — |
| `VITE_WORKSPACE_REGISTRY_CONTRACT_ADDRESS` | `PlaneWorkspaceRegistry` (updateWorkspaceCID) | — |
| `VITE_CONTRACT_ADDRESS` | `PlaneTaskManager` (createTask/…) | — |
| `VITE_FIAI_TIMEOUT` | Chờ hash giao dịch | `60000` ms |
| `VITE_CONTRACT_GAS` | Gas gửi kèm | `3000000` |

Hằng số ảnh hưởng trực tiếp tới lỗi nonce (không cấu hình được, nằm trong mã):

| Hằng số | Giá trị | File |
|---|:--:|---|
| `scheduleIPFSUpload` debounce | **2 000 ms** | `chain.ts:1758` |
| `ONCHAIN_COMMIT_DEBOUNCE_MS` | **8 000 ms** | `chain.ts:572` |
| `ONCHAIN_COMMIT_MIN_INTERVAL_MS` | **25 000 ms** | `chain.ts:573` |
| `ONCHAIN_COMMIT_RETRY_MS` | **15 000 ms** | `chain.ts:574` |
| `ONCHAIN_COMMIT_MAX_ATTEMPTS` | **20** | `chain.ts:576` |
| `SIGN_RETRY_MAX_ATTEMPTS` | **3** | `chain.ts:637` |
| `VAULT_UNLOCK_POLL_MS` | **1 500 ms** | `chain.ts:634` |
| `SIGN_TIMEOUT_MS` (web) | **120 000 ms** | `plane-task-chain.service.ts:28` |
| `TRANSACTION_HASH_POLL_INTERVAL_MS` | **400 ms** | `plane-task-chain.service.ts:69` |

> Ý nghĩa: chỉ cần **một** lần `saveDB()` là hệ thống hẹn giờ ghi CID on-chain sau ~2s + 8s. Nếu người dùng còn đang nhập mật khẩu Vault (30s+) thì **hai yêu cầu ký chồng lên nhau**. Đây là mầm của lỗi `CHAIN-09`.

### 2.3 Bản đồ luồng ghi on-chain (call-graph thực tế)

```text
Người dùng bấm "Tạo Work item"
│
├── (A) Ghi dữ liệu off-chain
│      axios/fetch → dapp-interceptor.ts → routes.ts (handleRoute/handleCRUD)
│        └─ localDB.issues.push(...) ; saveDB()            [store.ts:897]
│             └─ onSaveHook()                              [chain.ts:3142]
│                  └─ scheduleIPFSUpload()  (debounce 2s)  [chain.ts:1758]
│                       └─ uploadToIPFS()                  [chain.ts:920]
│                            └─ scheduleWorkspaceCIDCommit(slug, cid)  (debounce 8s / min 25s) [chain.ts:813]
│                                 └─ flushWorkspaceCIDCommit()          [chain.ts:830]
│                                      └─ commitWorkspaceCID()          [chain.ts:1438]
│                                           └─ signTransactionWithUnlockRetry()
│                                                └─ bridge.request("sendTransaction")  ──► TX #2: updateWorkspaceCID
│
└── (B) Ghi dữ liệu on-chain (task)
       issue.service.ts createIssue()                     [issue.service.ts:173]
         └─ createIssueOnChain(issue)                     [plane-task-chain.service.ts:484]
              └─ sendContractTransaction("createTask"|"createChildTask")
                   └─ enqueueTransaction(...)             [plane-task-chain.service.ts:270]
                        └─ sendContractTransactionNow()   [plane-task-chain.service.ts:351]
                             └─ bridge.request("sendTransaction")  ──► TX #1: createTask
```

Hai nhánh **(A)** và **(B)** nằm ở **hai module khác nhau**, dùng **hai cơ chế xếp hàng khác nhau** (nhánh A: `setTimeout` + cờ `isOnChainCommitInFlight`; nhánh B: `transactionQueue`), và **không chia sẻ mutex, không chia sẻ nonce, không chia sẻ phiên ký**. Đây là điểm mấu chốt của toàn bộ mục 3.

---

## 3. `CHAIN-09` — **P0**: MỘT HÀNH ĐỘNG ON-CHAIN NHƯNG BỊ KÝ 2–3 LẦN, NONCE NHẢY 2–3

> Đây là lỗi **anh/chị vừa phát hiện**, và nó **có thật trong mã**, không phải hiện tượng mạng. Mức độ: **P0** vì ảnh hưởng trực tiếp tới tiền gas, tính đúng đắn của audit trail và độ tin cậy của toàn bộ luồng on-chain.

### 3.1 Triệu chứng (theo ảnh chụp của anh/chị)

```text
Lần chạy 1: Nonce hiện tại = 67
Lần chạy 2: Nonce hiện tại = 70      ← +3
```

`check-wallet.mjs` **chỉ đọc** RPC (`getNetwork`, `getBalance`, `getTransactionCount`, `getFeeData`) — nó **không gửi giao dịch**. Vậy 3 nonce tăng thêm là do **ứng dụng Plane đã gửi 3 giao dịch** trong khoảng giữa 2 lần chạy.

Triệu chứng kèm theo (đúng như anh/chị mô tả): **một hành động nhưng hộp thoại ký hiện 2–3 lần**, và **tất cả** hành động on-chain đều bị (không riêng tạo task).

### 3.2 Bằng chứng trong mã (file:line)

| # | Bằng chứng | Ý nghĩa |
|---|---|---|
| E1 | `store.ts:897` `saveDB()` → `onSaveHook()` → `chain.ts:3142` `scheduleIPFSUpload()` | **Mọi** lần ghi DB đều kích hoạt upload IPFS |
| E2 | `chain.ts:1758-1762` debounce **2 000 ms** | Upload chạy sau 2s |
| E3 | `chain.ts:1024-1034` nếu `VITE_AUTO_COMMIT_ONCHAIN !== "false"` → `scheduleWorkspaceCIDCommit(activeSlug, cid)` | **Mặc định BẬT**: tự ghi CID on-chain |
| E4 | `chain.ts:813-828` debounce **8 000 ms**, giãn cách tối thiểu **25 000 ms** | Sau ~10s kể từ lúc lưu, một giao dịch `updateWorkspaceCID` được gửi |
| E5 | `chain.ts:1438-1515` `commitWorkspaceCID()` → `signTransactionWithUnlockRetry(..., "updateWorkspaceCID")` | **1 giao dịch thật** (TX #2) |
| E6 | `issue.service.ts:173-213` `createIssue()` → `createIssueOnChain()` → `createTask` | **1 giao dịch thật** (TX #1) |
| E7 | `issue.service.ts:430-440` `patchIssue()` có thể gọi `syncIssueStateOnChain` + `updateIssueScheduleByIssueIdOnChain` + `updateIssueMetadataByIssueIdOnChain` | **tối đa 3 giao dịch** cho một lần sửa |
| E8 | `issue.service.ts:110-127` vòng lặp task cha: mỗi cấp = 1 giao dịch `updateSubTaskStatus/Progress` | Cây sâu N cấp ⇒ **+N giao dịch** |
| E9 | `chain.ts:2908-2931` (`syncDAppDBToChain`) gửi `setCID` | Nút "Sync to chain" = **+1 giao dịch** |
| E10 | `chain.ts:3023-3053` / `3059-3099` gửi `updateWorkspaceCID` hoặc `createWorkspace` | "Sync to chain" = **+1 giao dịch** nữa |
| E11 | `routes.ts:4427-4431` `saveDB(); const newCid = await uploadToIPFS(true); void commitWorkspaceCID(wsSlug, newCid);` | Gọi commit **trực tiếp**, bỏ qua bộ chống trùng của scheduler ⇒ dễ gửi trùng |
| E12 | `plane-task-chain.service.ts:447-465` khi lỗi **không phải** do người dùng huỷ → `resetFiaiSDK()` rồi nếu là lỗi nonce → **gửi lại** | Mất phiên ký + gửi lại = **+1 giao dịch** |
| E13 | `plane-task-chain.service.ts:403-416` lỗi `failed to decrypt payload` → reset SDK → **gửi lại**; lỗi `wallet not found` → import ví → **gửi lại** | **+1 giao dịch** nếu tx đầu đã lên chain |
| E14 | `chain.ts:699-742` `signTransactionWithUnlockRetry` thử tối đa **3 lần**, mỗi lần gọi lại `bridge.request("sendTransaction")` | Timeout 1 lần ⇒ **có thể gửi 2–3 giao dịch** |
| E15 | `chain.ts:856-894` commit thất bại → tự thử lại **20 lần**, mỗi 15s | Giao dịch có thể phát sinh **rất lâu sau** hành động của người dùng |
| E16 | `sync-button.tsx:127-145` gặp lỗi chữ ký/nonce → `resetFiaiSDK()` rồi gọi **lại toàn bộ** `syncDAppDBToChain()` | 1 lần bấm "Sync to chain" có thể thành **4 giao dịch** (`setCID` + `updateWorkspaceCID` × 2) |

### 3.3 Bảng đếm giao dịch cho **một** hành động (nguồn: các dòng ở §3.2)

| Hành động của người dùng | Giao dịch thực tế được gửi | Nonce tăng |
|---|---|:--:|
| Tạo Work item (không assignee, CID chưa đổi) | `createTask` | **1** |
| Tạo Work item (CID mới) | `createTask` + `updateWorkspaceCID` | **2** |
| Tạo Work item **có assignee** | `createTask` + `assignTask` + `updateWorkspaceCID` | **3** |
| Sửa tiêu đề/mô tả | `updateTaskMetadata` + `updateWorkspaceCID` | **2** |
| Sửa priority/due date | `updateSchedule` + `updateWorkspaceCID` | **2** |
| Sửa state (task thường) | `updateTaskProgress` + `updateWorkspaceCID` | **2** |
| Sửa state (task có task con, cây sâu N) | `updateSubTaskStatus` ×N + `updateWorkspaceCID` | **N+1** |
| Comment | `recordContent` + `updateWorkspaceCID` | **2** |
| Đính kèm file | `recordContent` + `updateWorkspaceCID` | **2** |
| Xoá Work item con | `deleteTask` + (`getSubTaskId` + `deleteSubTask`) + `updateWorkspaceCID` | **2–3** |
| Mời/thêm thành viên | `addWorkspaceMember` + `updateWorkspaceCID` | **2** |
| Rời workspace | `removeWorkspaceMember` + `updateWorkspaceCID` | **2** |
| Bấm **"Sync to chain"** | `setCID` + (`updateWorkspaceCID` \| `createWorkspace`) | **2–3** |
| **Không làm gì** (tab vẫn mở, CID còn tồn đọng) | retry 15s/lần × tối đa 20 lần | **0 → 1** |

Kết luận: con số **2** là mức "bình thường" của kiến trúc hiện tại; con số **3** xuất hiện khi có thêm assignee, hoặc cây task, hoặc **một lần retry**. Ảnh chụp `67 → 70` khớp chính xác với trường hợp **tạo task có assignee** hoặc **1 hành động + 1 retry**.

### 3.4 Nguyên nhân gốc — 5 nguyên nhân, xếp theo mức đóng góp

#### RC-1 (đóng góp ~50%) — Fan-out thiết kế: **mỗi lần lưu dữ liệu = 1 giao dịch**

`saveDB()` được gọi ở **114 chỗ** trong `routes.ts` (118 chỗ trong toàn bộ `packages/services/src/dapp/` — đã đếm bằng `Select-String`). Nó gọi `onSaveHook` (`store.ts:957-959`), mà hook này được đăng ký tại `chain.ts:3142-3145`:

```ts
registerSaveHook(() => {
  setDirtyState(true);
  scheduleIPFSUpload();   // 2s sau: uploadToIPFS() → 8s sau: updateWorkspaceCID
});
```

⇒ Mọi thao tác ghi (tạo task, sửa task, comment, đính kèm, mời thành viên…) **luôn kèm thêm 1 giao dịch `updateWorkspaceCID`**. Đây là lý do "tất cả hành động đều bị 2 lần ký", không riêng gì tạo task.

#### RC-2 (đóng góp ~20%) — **Hai đường gửi giao dịch độc lập, không có mutex chung**

| | Nhánh A — commit CID | Nhánh B — task on-chain |
|---|---|---|
| File | `packages/services/src/dapp/chain.ts` | `apps/web/.../plane-task-chain.service.ts` |
| Hàng đợi | `setTimeout` + `isOnChainCommitInFlight` | `transactionQueue` (`Promise` chain) |
| Có biết nhánh kia? | **Không** | **Không** |

Cả hai đều gọi `bridge.request("sendTransaction", ...)`. `blockchain-bridge` giữ nonce trong `accountMap` (xem chính comment tại `plane-task-chain.service.ts:455-457`: *"Reset bridge session so blockchain-bridge's in-memory accountMap nonce is refreshed…"*). Khi 2 request đến **đồng thời**:

1. Cả hai đọc cùng một nonce `n`.
2. Tx thứ nhất lên chain với `n`; tx thứ hai bị từ chối `nonce has already been used` / `nonce too low`.
3. Nhánh B thấy lỗi khớp `isNonceError` (`plane-task-chain.service.ts:279-283`) → **gửi lại** với nonce `n+1`.
4. Kết quả: 2 giao dịch cho 1 ý định + 1 dialog ký thứ hai.

Điều kiện xảy ra rất dễ: debounce 2s + 8s (§2.2) trong khi người dùng **đang gõ mật khẩu Vault** (SDK chờ 30s, người dùng thường lâu hơn) ⇒ tx task vẫn đang chờ ký thì tx commit đã tới.

> Đây là giải thích **hợp lý nhất và khớp bằng chứng** cho việc nonce nhảy **3** chứ không phải 1 hoặc 2. Nó được suy ra từ mã + comment của chính repo, **chưa** được xác nhận bằng log runtime — cần log theo §3.9 để chốt.

#### RC-3 (đóng góp ~15%) — **Ba lớp retry đều KHÔNG idempotent**

| Lớp | Vị trí | Điều kiện retry | Có kiểm tra tx trước đã lên chain chưa? |
|---|---|---|:--:|
| 1 | `chain.ts:699-742` `signTransactionWithUnlockRetry` | timeout / `no frame found` | **Không** |
| 2 | `plane-task-chain.service.ts:447-465` | `isNonceError` | **Không** (chỉ `resetFiaiSDK` rồi gửi lại) |
| 3 | `plane-task-chain.service.ts:403-416` | `failed to decrypt payload`, `wallet not found` | **Không** |

Điểm nguy hiểm: nhóm lỗi retry của lớp 1 gồm `timed out|timeout|không phản hồi|not responding|session key not established|no frame found`. **`FrameClient.call` của SDK chỉ chờ 30s** trong khi hộp thoại mật khẩu vẫn mở ⇒ request đầu **timeout trong khi giao dịch vẫn có thể đã được gửi** ⇒ lớp 1 gửi lại ⇒ **2 giao dịch**.

#### RC-4 (đóng góp ~10%) — **Ghi trùng cùng một CID**

* `scheduleWorkspaceCIDCommit` **có** chống trùng: `if (readCommittedWorkspaceCid(slug) === cid) return;` (`chain.ts:817`).
* Nhưng `commitWorkspaceCID` (được gọi trực tiếp) **không** có kiểm tra đó (`chain.ts:1438-1444` chỉ kiểm `wsRegistryAddr` và `newCid`).
* `routes.ts:4427-4431` gọi **trực tiếp** `void commitWorkspaceCID(wsSlug, newCid)` ⇒ **bỏ qua** bộ chống trùng.
* `uploadToIPFS` **không có mutex**: `isUploadingIPFS` (`chain.ts:564,960,1041`) chỉ là cờ trạng thái, **không** `return` sớm ⇒ 2 lời gọi đồng thời có thể sinh 2 CID khác nhau ⇒ 2 commit ⇒ **2 giao dịch**.

#### RC-5 (đóng góp ~5%) — **Cờ "đã có phiên ký" bị cũ ⇒ Vault hỏi mật khẩu nhiều lần**

```ts
// chain.ts:632
const signingReadyAddresses = new Set<string>();
```

* `resetFiaiSDK()` (`fiai-sdk.service.ts:321`) **huỷ iframe + phiên** ⇒ bridge mất private key đã cache.
* Nhưng `signingReadyAddresses` **không bao giờ bị xoá** (đã kiểm chứng: không có `.clear()`/`.delete()` nào).
* Hệ quả: `commitWorkspaceCID` thấy `isSigningSessionReady() === true` ⇒ đặt `maxAttempts: 1` (`chain.ts:1514`) ⇒ **không retry**, thất bại ngay; sau đó vòng retry 15s (`chain.ts:856-894`) thử lại **20 lần**, mỗi lần mở lại hộp thoại mật khẩu.
* Ngược lại, `markSigningSessionReady` **chỉ** được gọi trong `chain.ts:716`; nhánh task ở web (`plane-task-chain.service.ts`) **không** đánh dấu ⇒ sau khi tạo task thành công, nhánh commit vẫn tưởng "chưa có phiên ký" ⇒ **xin mật khẩu thêm lần nữa**.

### 3.5 Vì sao lúc tăng 1, lúc tăng 2, lúc tăng 3?

| Điều kiện | Nonce tăng |
|---|:--:|
| CID không đổi (dữ liệu y hệt lần trước) | 1 (chỉ tx nghiệp vụ) |
| CID đổi (bình thường) | 2 (nghiệp vụ + `updateWorkspaceCID`) |
| Có assignee / cây task / 1 lần retry / sync tay | 3+ |
| Tab còn mở, CID tồn đọng, Vault vừa được mở khoá | tăng "tự phát" dù không thao tác |

Con số **không cố định** vì nó phụ thuộc: (a) dữ liệu có đổi hay không, (b) có bao nhiêu trường nghiệp vụ cùng đổi, (c) có retry hay không, (d) có tab khác đang mở hay không.

### 3.6 Ảnh hưởng (blast radius)

| Hạng mục | Hệ quả |
|---|---|
| **Chi phí** | Mỗi hành động tốn **2–3× gas** so với thiết kế; một ngày làm việc 200 thao tác ⇒ ~400–600 giao dịch thay vì ~200 |
| **Audit trail** | `blockchainTrackingService.recordTaskCreation` chỉ lưu **1** `transaction_hash` (`issue.service.ts:193-203`) ⇒ các tx `updateWorkspaceCID` không có vết, không truy vết được vì sao nonce lệch |
| **Tin cậy** | Người dùng thấy dialog ký lặp lại ⇒ tưởng hệ thống lỗi, bấm Cancel ⇒ tx treo nửa vời (`CHAIN-02` báo sai thành công) |
| **Nonce** | Nonce "nhảy" làm mọi script kiểm tra (`check-wallet.mjs`) và mọi so sánh before/after trở nên vô nghĩa ⇒ khó phát hiện lỗi thật |
| **Tranh chấp dữ liệu** | `updateWorkspaceCID` ghi **CID của toàn bộ workspace**; nếu tx đến sai thứ tự (do 2 nhánh song song), CID cuối cùng có thể **cũ hơn** dữ liệu local ⇒ máy khác đọc phải snapshot cũ |
| **Tác động chéo** | Làm `CHAIN-01` (revert `getIssueTaskId`) khó chẩn đoán hơn: nonce tăng nhưng task không có on-chain ⇒ tưởng "đã tạo" |

### 3.7 Kế hoạch sửa chuẩn doanh nghiệp (6 bước, có thể làm cuốn chiếu)

#### Bước 1 — **Một cổng gửi giao dịch duy nhất (single-flight gateway)** — *bắt buộc, 0.5 ngày*

Gốc rễ RC-2 là hai hàng đợi rời nhau. Tạo **một** hàm độc quyền trong `packages/services` rồi cho **cả hai** nhánh dùng:

```ts
// packages/services/src/dapp/chain.ts  (thêm mới, export)
let chainTxQueue: Promise<unknown> = Promise.resolve();

/** Mọi giao dịch on-chain phải đi qua đây để không bao giờ có 2 tx cùng lúc. */
export function runExclusiveChainTx<T>(operation: () => Promise<T>): Promise<T> {
  const run = chainTxQueue.then(operation, operation);
  chainTxQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
```

Bọc **tất cả** điểm gửi:
* `chain.ts` → `commitWorkspaceCID` (thân hàm `try { ... }`, dòng 1486-1548) và 2 khối `signTransactionWithUnlockRetry` trong `syncDAppDBToChain` (2908-2931, 3023-3099).
* `apps/web/.../plane-task-chain.service.ts` → `sendContractTransaction` (447-465) đổi `enqueueTransaction` thành `runExclusiveChainTx` (import từ `@plane/services`).

**Chống hồi quy**: thêm comment `// MỌI tx on-chain phải qua runExclusiveChainTx` + test BA-42.

#### Bước 2 — **Ngừng fan-out: chỉ ghi CID khi thật sự cần** — *0.5 ngày*

Ba lựa chọn, chọn theo nghiệp vụ (đề xuất **B**):

| Phương án | Cách làm | Nonce/hành động |
|---|---|---|
| A. Tắt hẳn auto-commit | Đặt `VITE_AUTO_COMMIT_ONCHAIN=false` | 1 (chỉ tx nghiệp vụ) |
| **B. Coalesce 60–120s (đề xuất)** | `ONCHAIN_COMMIT_DEBOUNCE_MS = 90_000`, `ONCHAIN_COMMIT_MIN_INTERVAL_MS = 120_000` | 1–2, nhưng gộp nhiều thao tác vào 1 tx |
| C. Chỉ commit khi bấm "Sync to chain" | Bỏ `scheduleWorkspaceCIDCommit` khỏi `uploadToIPFS` | 1 |

Kèm theo: **bỏ `setCID` khỏi `syncDAppDBToChain` khi `getCID` đã trả đúng CID** (E9) — hiện tại Sync luôn gửi 2 tx dù `setCID` không đổi giá trị gì.

#### Bước 3 — **Retry có kiểm chứng (idempotent), không gửi mù** — *1 ngày*

Trước mọi lần gửi lại, xác định "tx trước đã lên chain chưa":

```ts
// plane-task-chain.service.ts (thêm helper)
async function readAccountNonce(address: string): Promise<number | null> {
  const rpcUrl = readEnv("VITE_RPC_URL");
  if (!rpcUrl) return null;
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "mtn_getAccountState", params: [address, "latest"] }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const json = await res.json().catch(() => null);
  const nonce = Number(json?.result?.nonce ?? json?.result?.accountNonce ?? NaN);
  return Number.isFinite(nonce) ? nonce : null;
}
```

Quy tắc mới trong `sendContractTransaction`:

```ts
const nonceBefore = await readAccountNonce(from);       // trước khi gửi
try {
  return await sendContractTransactionNow(functionName, values);
} catch (error) {
  if (/cancel|user rejected|đã hủy/i.test(blockchainErrorMessage(error))) throw error;
  const nonceAfter = await readAccountNonce(from);
  // Nonce đã tăng ⇒ giao dịch ĐÃ lên chain, chỉ là response bị lỗi/timeout.
  if (nonceBefore !== null && nonceAfter !== null && nonceAfter > nonceBefore) {
    const hash = await readLatestWalletTxHash(bridge, from);
    if (hash) return hash;                                // coi như thành công
    throw new Error("Giao dịch đã lên chain nhưng chưa lấy được hash. Kiểm tra lịch sử ví trước khi gửi lại.");
  }
  if (!isNonceError(error)) throw error;
  return sendContractTransactionNow(functionName, values);
}
```

Đồng thời:
* Bỏ `resetFiaiSDK()` khỏi nhánh lỗi nonce (nó **xoá phiên ký**, gây RC-5). Chỉ reset khi `failed to decrypt payload`.
* Bỏ `invalid sign` khỏi `isNonceError` (`plane-task-chain.service.ts:280`) — đây **không** phải lỗi nonce.

#### Bước 4 — **Chống ghi trùng CID** — *2 giờ*

```ts
// packages/services/src/dapp/chain.ts — đầu hàm commitWorkspaceCID (sau dòng 1444)
if (!options?.force && readCommittedWorkspaceCid(slug) === newCid) {
  return true;   // đã ghi đúng CID này rồi ⇒ không gửi lại
}
if (inFlightWorkspaceCids.has(`${slug}:${newCid}`)) return false;  // đang ghi dở
inFlightWorkspaceCids.add(`${slug}:${newCid}`);
try { /* ...thân hiện tại... */ } finally { inFlightWorkspaceCids.delete(`${slug}:${newCid}`); }
```

Và đổi `routes.ts:4430`:

```diff
- void commitWorkspaceCID(wsSlug, newCid);
+ scheduleWorkspaceCIDCommit(wsSlug, newCid, 0);   // đi qua bộ chống trùng + hàng đợi chung
```

#### Bước 5 — **Đồng bộ cờ phiên ký với vòng đời SDK** — *2 giờ*

```ts
// chain.ts — export thêm
export function invalidateSigningSession(address?: string | null): void {
  const addr = normalizeSigningAddress(address);
  if (addr) signingReadyAddresses.delete(addr);
  else signingReadyAddresses.clear();
}
```

Gọi trong `fiai-sdk.service.ts` `resetFiaiSDK()` (sau `disposeFiaiSDK()`), và bỏ nhánh `maxAttempts: 1` khi "đã có phiên ký" (`chain.ts:1514`) — luôn cho **2** lần để chịu được 1 lần Vault khoá lại.

#### Bước 6 — **Nói thật với người dùng** — *0.5 ngày*

* Trước khi gửi, hiển thị: `"Thao tác này cần 1 giao dịch on-chain"` (hoặc 2 nếu có commit CID).
* Sau khi gửi, hiển thị hash + nonce cho từng tx (giúp đối chiếu `check-wallet.mjs`).
* Thêm badge `"Chưa đồng bộ on-chain"` khi `pendingOnChainCommit !== null` (liên quan `CHAIN-08`).

> **Dài hạn (không nằm trong 3 ngày)**: gộp nhiều lệnh ghi vào **1 giao dịch** bằng hàm batch/multicall ở contract, hoặc chuyển sang mô hình "1 tx = 1 batch thay đổi" (event-sourcing). Khi đó mới đạt đúng kỳ vọng "1 hành động = 1 nonce".

### 3.8 Tiêu chí nghiệm thu & test case mới

| ID | Kịch bản | Kỳ vọng (đo bằng `check-wallet.mjs` trước/sau) |
|---|---|---|
| `BA-45` | Bật `VITE_AUTO_COMMIT_ONCHAIN=false`, tạo Work item **không** assignee | Nonce **+1**; dialog ký **1** lần |
| `BA-46` | Tạo Work item **có** assignee | Nonce **+2** (`createTask`, `assignTask`); **không** quá 2 |
| `BA-47` | Sửa tiêu đề → 30s sau sửa mô tả → 30s sau đổi state | Mỗi thao tác đúng số tx ở bảng §3.3; **không** có tx phát sinh sau khi ngừng thao tác 2 phút |
| `BA-48` | Trong lúc dialog ký đang mở, chờ 40s rồi mới nhập mật khẩu | Chỉ **1** tx; **không** có dialog thứ 2; nonce +1 |
| `BA-49` | Bấm "Sync to chain" 3 lần liên tiếp (CID không đổi) | Tx lần 2, 3 bị **chặn** bởi dedupe; nonce không tăng |
| `BA-50` | Giữ tab mở 5 phút sau khi tạo task, không thao tác | Nonce **không** đổi; log không có `[DApp Chain] ... thử lại` |

**Điều kiện "Đạt" chung**: trong log phải có đúng **một** dòng `[TX] functionName=... nonce=... hash=...` cho mỗi giao dịch thực tế, và **không** có 2 dòng trùng `functionName` + `nonce`.

### 3.9 Cách thu thập bằng chứng để chốt nguyên nhân (làm trước khi sửa)

1. Mở DevTools → **Console**, lọc các tiền tố: `[DApp Chain]`, `[DApp Sync]`, `[Sync]`, `[DApp DB]`, `[MetaNode Wallet]`.
2. Mở DevTools → **Network** → lọc `sendTransaction` (request của iframe bridge) và `mtn_` (RPC).
3. Chạy `node check-wallet.mjs` → ghi lại nonce `N0`.
4. Thực hiện **đúng một** hành động (ví dụ tạo task có assignee).
5. Chờ 2 phút (để mọi debounce/retry kết thúc), chạy lại `node check-wallet.mjs` → ghi `N1`.
6. Đối chiếu: `N1 - N0` với bảng §3.3.
   * Nếu `N1 - N0 = số tx lý thuyết` ⇒ chỉ là **fan-out thiết kế** (RC-1) ⇒ Bước 1 + Bước 2 là đủ.
   * Nếu lớn hơn ⇒ có **retry/đua nonce** (RC-2/RC-3) ⇒ phải làm Bước 1 + Bước 3.
7. Lưu log kèm mốc thời gian; nếu có dòng `nonce has already been used` / `nonce too low` thì đó là **bằng chứng trực tiếp** cho RC-2/RC-3.

> Ghi chú trung thực: tôi **chưa** chạy được trình duyệt trong phiên này nên chưa thể khẳng định tỉ lệ đóng góp chính xác của RC-1…RC-5. Các tỉ lệ trong §3.4 là **ước lượng có căn cứ từ mã**; sau khi có log theo §3.9, con số này sẽ được cập nhật (và có thể thay đổi).

---

## 4. CHI TIẾT CÁC LỖI **P0** CÒN LẠI

### 4.1 `BUILD-01` — Cổng TypeScript đang đỏ (4 lỗi thật) · **P0** · 15 phút

**1. Mức độ / khu vực / trạng thái**: P0 · CI/TypeScript · *Chưa sửa*.

**2. Triệu chứng**: `npx tsc --noEmit -p apps/web/tsconfig.json` exit code **1**. Trong khi đó `pnpm build` (react-router) **vẫn chạy được** ⇒ lỗi lọt qua CI.

**3. Bằng chứng** (chạy lại trong phiên này):

```text
apps/web/core/components/issues/issue-detail/sidebar.tsx(254,42):
  error TS2304: Cannot find name 'TIssue'.
apps/web/core/components/issues/issue-modal/components/default-properties.tsx(160,45):
  error TS2345: Argument of type 'string | null | undefined' is not assignable to parameter of type 'string | null'.
apps/web/core/components/issues/peek-overview/properties.tsx(158,38):
  error TS2304: Cannot find name 'TIssue'.
apps/web/core/components/issues/workspace-draft/draft-issue-properties.tsx(109,28):
  error TS2304: Cannot find name 'TIssue'.
```

`git status` xác nhận 4 file này **không** bị đợt sửa nào chạm tới ⇒ đây là **nợ cũ**, không phải hồi quy mới.

**4. Nguyên nhân gốc**: 3 file dùng type `TIssue` mà **thiếu import** (`import type { TIssue } from "@plane/types"`); 1 file truyền `string | null | undefined` vào hàm chỉ nhận `string | null`. Lỗi tồn tại được vì script build **không** chạy `tsc`.

**5. Ảnh hưởng**: Không chặn runtime, nhưng làm cổng chất lượng vô hiệu ⇒ mọi lỗi type mới (kể cả lỗi gây crash) không bị phát hiện.

**6. Cách sửa**: thêm import ở 3 file; ở `default-properties.tsx:160` dùng `?? null`. Sau đó bắt buộc CI chạy `tsc --noEmit` (thêm vào `package.json` script `check:types` và pipeline).

**7. Nghiệm thu**: `npx tsc --noEmit -p apps/web/tsconfig.json` → exit 0; `npx tsc --noEmit -p packages/services/tsconfig.json` → exit 0.

---

### 4.2 `SEC-01` — `.env.production` **được git theo dõi** · **P0** · 1–2 giờ + rotate

**1. Mức độ**: P0 · Bí mật · *Chưa sửa*.

**2. Triệu chứng**: khoá API Brevo và private key nằm trong lịch sử git, ai clone repo đều đọc được.

**3. Bằng chứng** (chạy lại trong phiên này, repo root là `C:/task-system`):

```text
$ git ls-files | Select-String "\.env"
.env.example
apps/admin/.env.example
apps/live/.env.example
apps/space/.env.example
apps/space/.env.production     ← ĐANG ĐƯỢC TRACK
apps/web/.env.example
apps/web/.env.production       ← ĐANG ĐƯỢC TRACK
```

**4. Nguyên nhân gốc**: `.gitignore` chỉ chặn `.env` và `.env.local`, **không** chặn `.env.production`; file production được commit như "file cấu hình mẫu".

**5. Ảnh hưởng**: rò rỉ vĩnh viễn (kể cả khi xoá file, bí mật vẫn nằm trong commit cũ). Liên quan trực tiếp `BA-14/07` (Brevo key).

**6. Cách sửa**:
1. `git rm --cached apps/web/.env.production apps/space/.env.production`
2. Thêm `.env.production`, `.env.*.local` vào `.gitignore` (giữ `.env.example`).
3. **Rotate** toàn bộ khoá từng nằm trong 2 file (Brevo SMTP/API, BLS key, bất kỳ token nào).
4. Làm sạch lịch sử (`git filter-repo` hoặc BFG) — **bắt buộc** nếu repo đã chia sẻ.
5. Thêm `gitleaks`/`trufflehog` vào CI để chặn tái phạm.

**7. Nghiệm thu**: `git ls-files | Select-String "\.env\.production"` → rỗng; `git log --all -- apps/web/.env.production` → không còn bí mật; gitleaks pass.

---

### 4.3 `SEC-02` — `VITE_BLS_PRIVATE_KEY` nhúng vào bundle **và dùng để ký** · **P0** · 2–5 ngày

**1. Mức độ**: P0 · Bí mật/ký giao dịch · *Chưa sửa*.

**2. Triệu chứng**: bất kỳ ai mở DevTools cũng tải được bundle chứa private key BLS; mọi giao dịch gửi kèm `blsPrivateKey`.

**3. Bằng chứng**: tiền tố `VITE_` ⇒ Vite **inline** vào bundle. Key được đọc và truyền vào **mọi** `sendTransaction`:

| File:line | Đoạn |
|---|---|
| `plane-task-chain.service.ts:22-24` | `getBlsPrivateKey()` đọc `VITE_BLS_PRIVATE_KEY` |
| `plane-task-chain.service.ts:381` | `blsPrivateKey: getBlsPrivateKey()` |
| `chain.ts:2928`, `3043`, `3089` | `...(blsPrivateKey ? { blsPrivateKey } : {})` |
| `chain.ts:1508` | `...(getBlsPrivateKey() ? { blsPrivateKey: getBlsPrivateKey() } : {})` |
| `use-offchain-data.ts:128`, `295` | `blsPrivateKey: getBlsPrivateKey()` |

**4. Nguyên nhân gốc**: BLS key được dùng như "đường tắt" để ký mà không cần Crypto Vault mở khoá — đánh đổi bảo mật lấy UX.

**5. Ảnh hưởng**: mất toàn bộ ý nghĩa của Crypto Vault (key nằm trong RAM trình duyệt + trong file JS công khai). Kẻ tấn công có thể ký giao dịch thay người dùng.

**6. Cách sửa**:
1. Gỡ mọi `blsPrivateKey` khỏi payload phía client; ký **chỉ** qua Crypto Vault.
2. Nếu nghiệp vụ bắt buộc BLS threshold: chuyển sang **signing proxy** phía server (giữ key trong HSM/KMS), client chỉ gửi payload đã chuẩn hoá.
3. Rotate key BLS; thêm kiểm tra CI: `grep -r "VITE_.*PRIVATE"` phải rỗng.
4. Ghi ADR (Architecture Decision Record) giải thích mô hình ký.

**7. Nghiệm thu**: bundle production (`dist/assets/*.js`) không chứa chuỗi private key; `sendTransaction` payload không còn trường `blsPrivateKey`; toàn bộ luồng ký vẫn chạy qua Vault.

---

### 4.4 `SEC-03` — OTP sinh & xác thực **hoàn toàn ở client**, lại bị **in ra log** và **nằm trong subject email** · **P0** · 1–2 ngày

**1. Mức độ**: P0 · Xác thực · *Chưa sửa*.

**2. Triệu chứng**: mã OTP 6 số đọc được từ Console trình duyệt và từ tiêu đề email; việc xác thực do chính client quyết định.

**3. Bằng chứng**:

```ts
// routes.ts:1384-1385
const otpCode = generateAndStoreOtp(email);
console.log(`[DApp Auth OTP] 🔑 Mã xác nhận đăng nhập cho ${email}: ${otpCode}`);

// routes.ts:1407-1413
const verifyResult = verifyOtpCode(email, code);
clearOtpCode(email);

// mail.ts:336
const subject = `Mã xác nhận đăng nhập Plane của bạn: ${otpCode}`;
```

**4. Nguyên nhân gốc**: toàn bộ "backend" của DApp là `routes.ts` chạy **trong trình duyệt**; OTP được sinh và so khớp cùng một nơi, không có secret phía server. In log và đưa mã vào subject là để tiện debug/demo.

**5. Ảnh hưởng**: OTP không còn là yếu tố xác thực (ai mở DevTools cũng thấy); mã trong subject lộ qua thông báo màn hình khoá và log nhà cung cấp email ⇒ chiếm tài khoản.

**6. Cách sửa**:
1. Bỏ `console.log` OTP (nếu cần debug: chỉ log khi dev **và** đã che một nửa).
2. Subject đổi thành `"Mã xác nhận đăng nhập Plane"` — **không** chứa mã.
3. Lưu **hash** OTP + `expires_at` + `attempts` (tối đa 5, so sánh constant-time) thay vì plaintext.
4. Chuyển sinh/kiểm tra OTP sang server thật (hoặc qua `VITE_MAIL_PROXY_URL` hiện có); client chỉ gửi email + mã.
5. Rate-limit 1 mã/60s, khoá 15 phút sau 5 lần sai.

**7. Nghiệm thu**: Console không còn OTP; subject không chứa mã; gọi liên tiếp 6 lần bị chặn; sửa mã trong DevTools không đăng nhập được.

---

### 4.5 `CHAIN-01` — `getIssueTaskId()` revert ⇒ **mọi** thao tác task thất bại · **P0** · 0.5–2 ngày

**1. Mức độ**: P0 · On-chain · *Chưa sửa*.

**2. Triệu chứng**: mọi thao tác cần `taskId` (gán người, đổi state on-chain, đính kèm, comment có bằng chứng) đều lỗi `execution reverted`; attachment treo "Pending" (`BA-32`).

**3. Bằng chứng**:

* `plane-task-chain.service.ts:627-632` gọi `readContract("getTaskId", { externalId: sha256("plane-issue:" + issue.id) })`.
* ABI `apps/web/core/contracts/plane-task-manager.abi.ts:247-251`: `getTaskId(bytes32 externalId) → uint256` — **khớp** contract trong repo ⇒ **không phải** lỗi sai tên hàm.
* **Đã giải mã selector** bằng `ethers.id(...)` trên các `error` trong `artifacts/contracts/PlaneTaskManager.sol/PlaneTaskManager.json`:

```text
0x0531bbb1  =  InvalidTask()     ← khớp
0x464522a9  =  không khớp bất kỳ custom error nào trong 3 artifact hiện có
```

**4. Nguyên nhân gốc**:

* `InvalidTask()` nghĩa là **contract không có task với `externalId` đó**. Ba khả năng, xếp theo xác suất:
  1. **Contract đang cấu hình khác contract đã tạo task** (`VITE_CONTRACT_ADDRESS` đổi/redeploy, hoặc dữ liệu tạo từ bản deploy trước).
  2. `externalId` khác nhau vì `issue.id` khác nhau giữa các lần (server id vs local id).
  3. Dữ liệu tạo trước khi contract hiện tại được deploy ⇒ cần backfill.
* `0x464522a9` **không tồn tại** trong bản contract của repo ⇒ môi trường đang chạy **một bản contract khác** bản trong `artifacts/`. Đây là bằng chứng trực tiếp cho khả năng (1).
* Code coi **mọi** revert là "task chưa có" (`isMissingOnChainRecordError`, dòng 634-638) nên **âm thầm tạo lại**; `patchIssue` lại bọc `try/catch` + `console.warn` (dòng 442-444) nên người dùng **không thấy lỗi**.

**5. Ảnh hưởng**: tính năng on-chain của task mất tác dụng nhưng UI vẫn báo "đã lưu"; kết hợp `CHAIN-09` tạo tình huống **nonce tăng nhưng task không tồn tại** — rất khó chẩn đoán.

**6. Cách sửa**:
1. Kiểm tra môi trường khi khởi động: đọc `contractVersion()` + `mtn_getCode(address)`; `code === "0x"` ⇒ báo "sai địa chỉ contract" thay vì để revert.
2. So khớp **4-byte selector** gặp phải với ABI đang dùng; không khớp ⇒ cảnh báo "contract khác phiên bản với client".
3. `getIssueTaskId`: bắt riêng `InvalidTask()` ⇒ trả `null`; các lỗi khác (RPC/timeout) **không** được coi là "chưa có".
4. Thêm `scripts/verify-contract.mjs`: in `chainId`, địa chỉ, `contractVersion`, selector các hàm chính — chạy trước mỗi lần demo/release.
5. Bỏ `catch → console.warn` ở `issue.service.ts:442-444`, thay bằng toast cảnh báo + "Xem chi tiết".

**7. Nghiệm thu**: `contractVersion()` khớp hằng số client; tạo task mới ⇒ `getTaskId` trả > 0 trong 5s; xoá task on-chain rồi gọi lại ⇒ UI báo "chưa có on-chain, đang tạo lại" và tạo lại thành công.

---

### 4.6 `CHAIN-02` — Sync báo **"Đồng bộ on-chain thành công"** dù ghi thất bại · **P0** · 0.5 ngày

**1. Mức độ**: P0 · On-chain · *Chưa sửa*.

**2. Triệu chứng**: bấm "Sync to chain" thấy toast xanh "Dữ liệu đã được ghi lên blockchain", nhưng `updateWorkspaceCID`/`createWorkspace` đã fail (ví không phải Member/Owner, Vault khoá, revert…).

**3. Bằng chứng**:

```ts
// chain.ts:3051-3053 và 3097-3099 — chỉ warn, không throw, không trả cờ lỗi
.catch((updateErr: any) => {
  console.warn("[DApp Sync] updateWorkspaceCID failed:", updateErr);
});

// chain.ts:3136-3138 — vẫn trả về cid (thành công) dù 2 tx trên đã fail
baseCID = cid;
isDirtyState = false;
return cid;

// sync-button.tsx:169-173 — toast SUCCESS vô điều kiện
setToast({ type: TOAST_TYPE.SUCCESS, title: "Đồng bộ on-chain thành công", ... });
```

Thêm: `sync-button.tsx:161-165` đưa `lỗi ${result.failed}` **vào bên trong** toast "thành công" ⇒ người dùng chỉ đọc phần "thành công".

**4. Nguyên nhân gốc**: `syncDAppDBToChain` trả `string` (CID) chứ không trả **kết quả từng giao dịch**; mọi lỗi tầng registry bị "nuốt" để không chặn luồng. UI dựa vào "không throw = thành công".

**5. Ảnh hưởng**: người dùng tin dữ liệu đã lên chain rồi tắt máy ⇒ dữ liệu chỉ còn ở local; không thể chứng minh khi tranh chấp; audit sai (cùng bản chất `CHAIN-03`).

**6. Cách sửa**:

```ts
export type SyncResult = {
  cid: string;
  setCid: { status: "ok" | "skipped" | "failed"; hash?: string; error?: string };
  workspace: { status: "ok" | "skipped" | "failed"; hash?: string; error?: string };
  ok: boolean;   // false nếu có giao dịch bắt buộc bị lỗi
};
```

1. Đổi kiểu trả về như trên (thay vì `string`).
2. `sync-button` phân nhánh toast: `ok ? SUCCESS : WARNING/ERROR`, kèm hash của từng tx.
3. `lỗi N` phải nằm trong toast **cảnh báo**, không phải toast thành công.
4. Thêm test `BA-51`: ví không phải Member ⇒ toast **warning/error**, `ok === false`.

**7. Nghiệm thu**: với ví không có quyền, 100% lần bấm Sync cho toast cảnh báo kèm mã lỗi; log có `[DApp Sync] ... failed` **và** UI phản ánh đúng.

> Liên quan: `CHAIN-09` §3.7 Bước 1 (hàng đợi chung) là điều kiện cần để 2 giao dịch của Sync không chồng nhau; `SyncResult` là điều kiện đủ để người dùng biết cái nào đã ghi.

---

## 5. CHI TIẾT CÁC LỖI **P1** (dạng rút gọn: triệu chứng → nguyên nhân → sửa → nghiệm thu)

> Các lỗi P0 ở §4 dùng mẫu 7 phần đầy đủ. P1 dùng mẫu rút gọn nhưng vẫn giữ `file:line` để sửa được ngay.

### 5.1 `WALLET-01` — "Mở MetaNode Wallet" mở **origin khác** Vault mà Plane dùng để ký · 0.5 ngày

* **Triệu chứng**: người dùng bấm "Mở MetaNode Wallet", nhập/import ví thành công, nhưng Plane vẫn báo không tìm thấy ví.
* **Nguyên nhân**: nút mở `VITE_URL_CONNECT_WALLET` (ví dụ `http://192.168.1.234:6005`) trong khi Plane khởi tạo Crypto Vault tại `VITE_FIAI_CRYPTO_VAULT_URL` (`:6002`). **IndexedDB của Crypto Vault gắn theo origin** ⇒ ví nằm ở Vault A **không** nhìn thấy từ Vault B.
* **Ảnh hưởng**: đây chính là gốc của chuỗi "Wallet not found" trước đây; đã **giảm nhẹ** bằng preflight + `Trung tâm ví`, nhưng **rủi ro còn nguyên** nếu người dùng vẫn dùng nút cũ.
* **Sửa**: (a) trỏ nút "Mở MetaNode Wallet" về **cùng origin** với Vault Plane dùng; (b) nếu buộc khác origin, hiển thị cảnh báo rõ + deep-link `plane://wallet-center`; (c) thêm kiểm tra khởi động: so `new URL(VITE_FIAI_CRYPTO_VAULT_URL).origin` với origin của connect-wallet, lệch ⇒ log cảnh báo.
* **Nghiệm thu**: từ máy sạch, bấm "Mở MetaNode Wallet" → import → quay lại Plane thấy ví trong "Trung tâm ví" **không cần thao tác phụ**.

### 5.2 `WALLET-02` — Luồng ghi khác **không preflight** Vault · 1 ngày — ✅ **đã sửa trong mã (chờ QA)**

* **Triệu chứng**: tạo task/comment/attachment khi Vault rỗng ⇒ lỗi khó hiểu (`Wallet not found` / treo), không có hướng dẫn.
* **Nguyên nhân**: chỉ `syncDAppDBToChain` gọi `assertVaultSigningAddress` (`chain.ts:2847`). `createIssueOnChain` → `resolveMetanodeWalletAddress()` (`plane-task-chain.service.ts:485`) **không** kiểm tra Vault; lỗi chỉ nổi lên ở tầng bridge.
* **Đã sửa**:
  1. `plane-task-chain.service.ts`: thêm `confirmSigningWallet()` — gọi `assertVaultSigningAddress(from, { refresh: false })` ở **mọi** bước ký (`sendContractTransactionNow`, nhánh tự phục hồi ví, và `createIssueOnChain`). Địa chỉ không còn trong ứng dụng ví ⇒ dừng trước khi gửi giao dịch với `VaultSigningError` có mã (`VAULT_EMPTY` / `WALLET_NOT_IN_VAULT`); nếu chỉ **không đọc được** danh sách ví thì giữ nguyên hành vi cũ (không chặn nhầm giao dịch có thể vẫn ký được).
  2. `vault-notice.ts` (mới): `notifyVaultProblem(error)` — gộp một chỗ: ghi log kỹ thuật + mở "Trung tâm ví" đúng chế độ (`import` khi chưa có ví, `select` khi ví lệch), có chống mở lặp trong 15 giây. Được gọi ở **tất cả** nhánh on-chain trước đây chỉ `console.warn`: tạo task, tự tạo lại task, cập nhật, giao việc, xoá, cập nhật tiến độ (`issue.service.ts`), bình luận (`issue_comment.service.ts`), tệp đính kèm (`issue_attachment.service.ts`).
  3. Câu thông báo đổi sang ngôn ngữ người dùng: bỏ tên cổng/kỹ thuật — "Ứng dụng ví chưa có ví nào. Mở “Trung tâm ví” để thêm ví của bạn rồi thực hiện lại."
* **Nghiệm thu**: Vault rỗng + tạo task ⇒ nội dung vẫn được lưu, **"Trung tâm ví" tự mở** ở chế độ thêm ví, thông báo bằng tiếng Việt dễ hiểu; **không** còn `Wallet not found`.

### 5.3 `CHAIN-03` — `backfillIssuesOnChain` gộp lỗi & báo success dù `failed > 0` · 0.5 ngày

* **Nguyên nhân**: `backfillIssuesOnChain` trả `{created, skipped, failed, aborted}` nhưng `sync-button.tsx:162-173` vẫn dùng `TOAST_TYPE.SUCCESS` và chỉ nối chuỗi `lỗi N`.
* **Sửa**: dùng chung `SyncResult`/`ok` như §4.6; `failed > 0 || aborted` ⇒ toast warning kèm danh sách issue lỗi.
* **Nghiệm thu**: 1 issue lỗi ⇒ toast **warning**, có tên issue + mã lỗi.

### 5.4 `CHAIN-04` — Retry nonce chạy lại **toàn bộ pipeline** · **đã gộp vào `CHAIN-09`**

* Nội dung gốc: retry không idempotent. Nay được phân tích đầy đủ ở §3.4 RC-3 và sửa ở §3.7 Bước 3. **Giữ ID** để truy vết, **không** làm riêng.

### 5.5 `CHAIN-05` — 3 địa chỉ ví lệch nhau ⇒ quyền on-chain sai · 1–2 ngày — ✅ **đã sửa trong mã (chờ QA)**

* **Triệu chứng**: cùng một người, Plane hiển thị 3 địa chỉ khác nhau (`0xb3b9…`, `0x4e…`, `0xec4c…2d6d`); có lúc là Member, có lúc không.
* **Nguyên nhân**: địa chỉ được lưu ở **4 nơi** không đồng bộ: `localStorage["plane:metanode-wallet:<userId>"]`, `sessionStorage["plane_active_wallet_address"]`, `localDB.workspace_members[].wallet_address`, và `getActiveWalletDapp()` của Vault. `configureMetanodeWalletAddress` (`metanode-wallet.service.ts:41-59`) ưu tiên local hơn server ⇒ lệch dần theo thời gian.
* **Quyết định (D3, đã chốt theo nguyên tắc kỹ thuật — không cần đổi contract)**: **ví đã ký giao dịch (`msg.sender`) là chuẩn**; địa chỉ trong hồ sơ chỉ để hiển thị và là bản cache, không được dùng để ghi sổ.
* **Đã sửa**:
  1. `metanode-wallet.service.ts`: thêm `signingWalletAddress` + `getSigningWalletAddress()` / `rememberSigningWalletAddress(address)`.
  2. `plane-task-chain.service.ts` (`confirmSigningWallet`): **mỗi** lần ký đều xác nhận ví bằng `assertVaultSigningAddress` rồi gọi `rememberSigningWalletAddress(ví vừa xác nhận)`. Ví ký trở thành nguồn sự thật trong phiên.
  3. Phát hiện lệch (ví ký ≠ địa chỉ đang lưu) ⇒ tự động đồng bộ lại **mọi** nơi lưu qua `linkMetanodeWalletAddress` (localStorage theo user, `localDB.users[].metanode_wallet_address`, `localDB.workspace_members[].wallet_address`, hồ sơ người dùng) + phát `plane:wallet-changed` để UI cập nhật ngay; không chặn bước ký đang chờ.
  4. `blockchain-tracking.service.ts`: cả 5 loại bản ghi audit (`create_task`, `daily_report`, `task_content`, `delete_task`, `assign_task`) ghi `wallet_address` theo `getSigningWalletAddress()` thay vì địa chỉ hồ sơ ⇒ sổ audit không còn ghi sai chủ.
  5. `createIssueOnChain`: ví tạo task (đồng thời là ví được ghi làm người thực hiện khi không giao cho ai) lấy từ `confirmSigningWallet` ⇒ đúng ví đã ký.
* **Nghiệm thu**: đổi ví trong ứng dụng ví → mở lại Plane → làm một thao tác bất kỳ ⇒ bản ghi audit mới mang **đúng** địa chỉ vừa ký; hồ sơ và danh sách thành viên được cập nhật theo, không còn 3 địa chỉ cho một người. (Phần kiểm tra quyền **phía contract** vẫn do contract quyết định theo `msg.sender` — mã nguồn không đổi contract.)

### 5.6 `BA-08` — Dropdown Assignee bỏ sót thành viên Workspace · 2 giờ

* **Nguyên nhân**: `GET /projects/:id/members/` chỉ trả `localDB.project_members` (`routes.ts` ~4835 theo báo cáo trước), không gộp `workspace_members`.
* **Sửa**: gộp 2 nguồn, dedupe theo `member_id`/email/wallet, đánh dấu `source: "workspace" | "project"`.
* **Nghiệm thu**: mời người mới vào Workspace (chưa thêm vào Project) ⇒ xuất hiện ngay trong dropdown Assignee.

### 5.7 `BA-21` — Link dự án chia sẻ trả **404** thay vì "không có quyền" · 1 ngày — ✅ **đã sửa trong mã (chờ QA)**

* **Nguyên nhân**: router trả `404` khi không tìm thấy project trong `localDB` của **máy người nhận** (dữ liệu chưa đồng bộ) — không phân biệt "không tồn tại" với "chưa được cấp quyền/chưa đồng bộ".
* **Đã sửa** (`routes.ts`): thêm `projectExistsInWorkspaceSnapshot(slug, projectId)` — chỉ chạy ở nhánh **không tìm thấy dự án trong dữ liệu của máy**: đọc con trỏ dữ liệu của không gian làm việc từ chain rồi tìm dự án trong bản dữ liệu đó.
  * Dự án **có thật** ⇒ trả `403 { error: "NOT_AUTHORIZED" }` ⇒ UI hiện màn "Chưa có quyền" (quản trị viên không gian làm việc còn có nút xin tham gia), thay vì "Dự án không tồn tại".
  * Dự án **không có** trong dữ liệu đó, thuộc danh sách đã xoá, hoặc không đọc được chain ⇒ vẫn `404` (đúng nghĩa "không tìm thấy").
  * Không đổi hợp đồng, không đổi luồng bình thường: chỉ tốn thêm 1 lần đọc khi trang báo lỗi.
* **Nghiệm thu**: mở link dự án bằng tài khoản không có dự án đó trong máy ⇒ màn "Chưa có quyền", **không** còn 404; link sai/dự án đã xoá vẫn là 404.

### 5.8 `BA-32` — Upload attachment treo "Pending" tới 2 phút rồi lỗi · 1–2 ngày — ✅ **đã sửa trong mã (chờ QA)**

* **Nguyên nhân (đã xác minh trong mã, khác giả thuyết ban đầu)**: `issue_attachment.service.ts` gọi `fileUploadService.uploadFile("", formData)` — `FileUploadService` có `baseURL = ""` nên lời gọi này **POST multipart tới gốc ứng dụng** (`/`), không phải nơi nhận tệp. Yêu cầu treo tới khi bị timeout (≈2 phút) rồi throw; toàn bộ phần lưu tệp + ghi dấu vết nằm **sau** lời gọi này nên không bao giờ chạy tới ⇒ "Pending rồi lỗi".
* **Nguyên nhân phụ**: `routes.ts` xử lý `PATCH /api/assets/v2/...` bằng regex `/attachments/([^/]+)/`, nhưng Plane gọi `/api/assets/v2/workspaces/{slug}/{assetId}/` (không có đoạn `/attachments/`) ⇒ không tìm ra bản ghi ⇒ `is_uploaded` không bao giờ được bật.
* **Sửa**: (1) đọc tệp **ngay trên máy** (`FileReader` → base64), bỏ hẳn lời gọi mạng `uploadFile("")`; (2) lưu tệp vào IndexedDB **trước khi ký** và kiểm tra lại ngay — không đủ chỗ thì dừng trước khi ký, để người dùng không mất một lượt ký vô ích; (3) ghi dấu vết on-chain là một bước riêng sau đó, thất bại/huỷ thì xoá tệp vừa lưu (không để tệp mồ côi); (4) `asset_url` = khoá tra cứu trong máy, `is_uploaded = true`; (5) router xác định `assetId` theo đoạn cuối URL khi không có `/attachments/`.
* **Nghiệm thu**: kéo 1 tệp nhỏ vào một công việc ⇒ **không** còn treo 2 phút; tải lại tệp đó xuống được (đọc từ máy); huỷ hộp thoại mật khẩu ví ⇒ tệp không được ghi nhận và không còn tệp mồ côi. Lưu ý: việc ghi dấu vết vẫn cần **1 lượt ký** (thiết kế hiện tại: bằng chứng đính kèm nằm on-chain); nếu muốn bỏ hẳn chữ ký này thì phải chốt ở mức sản phẩm.

### 5.9 `BA-14/07` — Email mời/OTP vào **Spam** + lộ khoá Brevo · 1 ngày + DNS

* **Nguyên nhân**: gửi qua Brevo API từ **trình duyệt** (`mail.ts`) ⇒ không có SPF/DKIM/DMARC cho domain gửi, IP gửi không ổn định; khoá API lại nằm trong bundle (`SEC-01`, `SEC-02`).
* **Sửa**: chuyển sang **mail proxy** server-side (đã có biến `VITE_MAIL_PROXY_URL`), cấu hình SPF + DKIM + DMARC, dùng domain con riêng (`mail.`), thêm link "Copy invite link" dự phòng.
* **Nghiệm thu**: email vào Inbox (Gmail/Outlook), `Authentication-Results` có `spf=pass dkim=pass dmarc=pass`.

### 5.10 `SEC-05` — RPC `http://` + `RPC_ALLOW_INSECURE_TLS=true` · 0.5 ngày

* **Nguyên nhân**: RPC nội bộ `http://192.168.1.234:8747` dùng cho cả môi trường thật; cờ cho phép TLS không hợp lệ.
* **Sửa**: bắt buộc `https://` ở production (reverse proxy + cert nội bộ), tắt `RPC_ALLOW_INSECURE_TLS`, chặn build nếu env production chứa `http://`.
* **Nghiệm thu**: build production với RPC `http://` ⇒ **fail** kèm thông báo.

### 5.11 `SEC-06` — Toàn bộ DB workspace nằm trong `localStorage` + IPFS công khai · 3–5 ngày

* **Nguyên nhân**: kiến trúc "local-first"; `saveDB()` ghi **toàn bộ** `localDB` (users, issues, comments, email, wallet) vào `localStorage` (`store.ts:897-924`) và `uploadToIPFS` đẩy nguyên snapshot lên IPFS.
* **Ảnh hưởng**: bất kỳ ai có CID đều đọc được toàn bộ dữ liệu; localStorage không mã hoá ⇒ XSS = mất sạch dữ liệu.
* **Sửa**: (1) mã hoá snapshot trước khi upload IPFS (AES-GCM, khoá dẫn xuất từ ví/ký ví); (2) chỉ đưa **dữ liệu cần chứng minh** lên chain (hash + metadata), nội dung nhạy cảm để off-chain có kiểm soát; (3) `localStorage` chỉ cache danh sách id + bản tóm tắt.
* **Nghiệm thu**: CID công khai không đọc được nội dung; `localStorage` không chứa `description_html`/email.

### 5.12 `ARCH-01` — Không có indexer/list on-chain ⇒ máy khác **không thấy** dữ liệu · 2–4 tuần

* **Nguyên nhân**: đọc dữ liệu chỉ dựa vào `localDB` (+ IPFS snapshot khi F5). Không có thành phần duyệt event on-chain để dựng lại danh sách.
* **Sửa**: thêm **indexer** (worker lắng nghe event `TaskCreated`, `TaskUpdated`, `DataUpdated`, `WorkspaceCIDUpdated`) → DB đọc-only → API đọc. Đây là điều kiện để hệ thống thực sự "phi tập trung".
* **Nghiệm thu**: máy B (profile trình duyệt sạch, cùng workspace) thấy đầy đủ task do máy A tạo.

---

## 6. LỖI **P2 / P3** (bảng ngắn, đã đủ để giao việc)

| ID | Mức | Vấn đề | Hướng sửa | Công |
|---|:--:|---|---|:--:|
| `CHAIN-06` | P2 | `issueExistsOnChain` nuốt **mọi** lỗi ⇒ `false` (2 nhánh `return false` giống nhau, `plane-task-chain.service.ts:644-647`) | Chỉ trả `false` khi `InvalidTask()`; lỗi khác phải throw | 1 giờ |
| `CHAIN-07` | P2 | Đọc contract bằng `ZERO_ADDRESS` khi Vault rỗng (`plane-task-chain.service.ts:601-604`) | Trả lỗi rõ "chưa có ví" thay vì đọc bằng zero | 2 giờ |
| `CHAIN-08` | P2 | Không hiển thị "đã/chưa đồng bộ on-chain" | Badge dựa trên `pendingOnChainCommit` + `readCommittedWorkspaceCid` | 1–2 ngày |
| `WALLET-03` | P2 | Badge ví không cập nhật sau khi chọn/import | Phát event `wallet-changed` + `useSyncExternalStore` | 0.5 ngày |
| `WALLET-04` | P2 | Trung tâm ví gọi `getAllWallets` (có RPC balance) mỗi lần `focus` | Cache 30s + chỉ refresh khi mở panel | 2 giờ |
| `WALLET-05` | P2 | `Sync button` + Trung tâm ví render **toàn cục**, cả trang login | Chỉ mount trong `(app)` layout | 2 giờ |
| `WALLET-06` | P2 | Import có thể "nhận vơ" ví cũ khi không đọc được danh sách trước | Nếu `before` rỗng ⇒ bắt buộc xác nhận địa chỉ | 2 giờ |
| `BA-18` | P2 | Phân trang chỉ là hình thức (`total_pages = 1`) | Cắt theo `per_page`/`cursor` | 2–3 ngày |
| `BA-27` | P2 | `/importers` trả `[]` | Viết importer CSV/JSON | 3–5 ngày |
| `BA-41` | P3 | Đăng nhập email ưu tiên password thay vì OTP | **Cần BA quyết định** (xem §10) | — |
| `BA-30` | P3 | Toggle Public/Private comment nằm trong menu | Đưa ra ngoài toolbar | 2 giờ |
| `ARCH-02` | P2 | Nhiều tab ghi đè `localStorage` (không lock) | `BroadcastChannel` + leader election cho việc upload/commit | 2 ngày |

---

## 7. MA TRẬN ĐỐI CHIẾU **34 TEST CASE** BA/QA (ID 7, 8, 13–44)

> Quy ước: **PASS** = đúng kỳ vọng · **RISK** = UI đúng nhưng có rủi ro on-chain/kiến trúc đã nêu · **FAIL** = chưa đạt kỳ vọng BA.

| ID | Nội dung | Kết quả | Bằng chứng / lỗi liên quan |
|:--:|---|:--:|---|
| 7 | Email mời thành viên vào Spam | **FAIL** | Gửi từ trình duyệt, thiếu SPF/DKIM — `BA-14/07` |
| 8 | Dropdown Assignee bỏ sót member | **FAIL** | `routes.ts` chỉ trả `project_members` — `BA-08` |
| 13 | Đổi theme Dark/Light | PASS | Lưu `currentUserProfile.theme` |
| 14 | Email mời vào Spam (biến thể) | **FAIL** | `BA-14/07` |
| 15 | Xoá Workspace | PASS | `_deleted_workspace_ids`; lưu ý rời workspace = 2 tx (`CHAIN-09`) |
| 16 | Tạo Work item | **RISK** | UI PASS; on-chain 2–3 tx + revert `InvalidTask()` — `CHAIN-09`, `CHAIN-01` |
| 17 | Tạo Label | PASS | CRUD nhãn |
| 18 | List layout loading | **RISK** | Nạp đúng; phân trang hình thức — `BA-18` |
| 19 | Chuyển 4 chế độ layout | PASS | Board/Calendar/Table/List |
| 20 | Display options | PASS | Ẩn/hiện cột |
| 21 | Chia sẻ link dự án ⇒ 404 | **FAIL** | `BA-21` |
| 22 | Archives / Views / Analytics | PASS | Đã bổ sung endpoint archive |
| 23 | Sửa Work item | **RISK** | UI PASS; on-chain tới 3 tx + có thể fail im lặng — `CHAIN-09`, `CHAIN-01` |
| 24 | Publish Project View | PASS | `apps/space` |
| 25 | Update State / Priority / Due | **RISK** | UI PASS; on-chain phụ thuộc `getTaskId` — `CHAIN-01` |
| 26 | Project Settings Features | PASS | Cycles/Views/Pages/Modules |
| 27 | Import | **FAIL** | `/importers` trả `[]` — `BA-27` |
| 28 | Kéo thả dự án | PASS | `sort_order` |
| 29 | Comment gốc | **RISK** | UI PASS; ghi on-chain dễ fail/timeout — `CHAIN-01`, `BA-32` |
| 30 | Toggle Public/Private comment | **FAIL** | Nằm trong menu — `BA-30` (P3) |
| 31 | Make a copy / Duplicate | PASS | Đã triển khai duplicate thật |
| 32 | Upload attachment treo Pending | **FAIL (đã sửa mã, chờ QA)** | `BA-32` |
| 33 | Tạo xong không treo loading | PASS | HTTP 201 + dữ liệu enrich |
| 34 | Tabs Activity/Updates/Transaction/History | PASS | Đã sửa: ghi/đọc `issue_activities` |
| 35 | Blocked By loại bỏ chính nó | PASS | Lọc `item.id === currentIssueId` |
| 36 | State create/edit | PASS | Cập nhật tức thì |
| 37 | Select Multiple Tasks | PASS | Bulk actions |
| 38 | Search | PASS | Global search |
| 39 | Work item details không mất focus | PASS | Sidebar giữ focus |
| 40 | Reload F5 | **RISK** | PASS trên cùng máy; máy khác không thấy — `ARCH-01` |
| 41 | Đăng nhập email: OTP vs password | **FAIL** | `routes.ts:1372` ưu tiên `CREDENTIAL` — `BA-41` (chờ BA quyết) |
| 42 | Thêm Module vào Work item | PASS | Đồng bộ 2 chiều `module_ids` |
| 43 | Ngày bắt đầu | PASS | `minDate={today}` |
| 44 | Màu sắc hạn chót | PASS | Đỏ/vàng nâu/đen |

### 7.1 Tổng hợp

| Kết quả | Số case | ID |
|---|:--:|---|
| **PASS** | **20** | 13, 15, 17, 19, 20, 22, 24, 26, 28, 31, 33, 34, 35, 36, 37, 38, 39, 42, 43, 44 |
| **RISK** (UI đúng, on-chain/kiến trúc rủi ro) | **6** | 16, 18, 23, 25, 29, 40 |
| **FAIL** | **8** | 7, 8, 14, 21, 27, 30, 32, 41 |
| **Tổng** | **34** | |

### 7.2 Điều kiện để chuyển các case RISK → PASS

| Case | Cần hoàn thành |
|:--:|---|
| 16, 23, 25, 29 | `CHAIN-01` (selector `InvalidTask()`) + `CHAIN-09` (1 hành động ⇒ 1–2 tx) + `CHAIN-06` (không nuốt lỗi) |
| 18 | `BA-18` (phân trang thật) |
| 40 | `ARCH-01` (indexer) — hoặc chấp nhận ghi rõ giới hạn "cùng trình duyệt" trong tài liệu sản phẩm |

### 7.3 Ba case **không nên** đóng bằng code

| Case | Lý do | Đề xuất |
|:--:|---|---|
| 41 | Yêu cầu "thuần OTP" của BA xung đột với thiết kế bảo mật (tài khoản có mật khẩu vẫn nên cho password) | BA chọn: (A) luôn OTP; (B) giữ hybrid như hiện tại; (C) OTP là mặc định + link "dùng mật khẩu" |
| 27 | Import cần định nghĩa mapping dữ liệu nguồn (Jira/Trello/CSV) | BA cung cấp 1 file mẫu + quy tắc map |
| 30 | Thuần UX | BA duyệt mockup trước khi sửa |

---

## 8. NỢ KỸ THUẬT TYPESCRIPT — tách riêng khỏi lỗi nghiệp vụ

4 lỗi `tsc` ở §4.1 nằm trong các file `issues/` **không liên quan** đợt sửa on-chain/ví. Vì vậy:

* **Không** gộp vào `CHAIN-09`/`CHAIN-01` khi lập sprint (tránh tranh chấp "lỗi của ai").
* Nhưng **phải** sửa trước khi bật CI chặn merge, nếu không mọi PR sau sẽ phải vá tạm bằng `// @ts-ignore`.

| File | Dòng | Mã lỗi | Sửa |
|---|:--:|---|---|
| `apps/web/core/components/issues/issue-detail/sidebar.tsx` | 254 | TS2304 `TIssue` | thêm `import type { TIssue } from "@plane/types"` |
| `apps/web/core/components/issues/issue-modal/components/default-properties.tsx` | 160 | TS2345 `string \| null \| undefined` | thêm `?? null` khi gọi hàm |
| `apps/web/core/components/issues/peek-overview/properties.tsx` | 158 | TS2304 `TIssue` | thêm import |
| `apps/web/core/components/issues/workspace-draft/draft-issue-properties.tsx` | 109 | TS2304 `TIssue` | thêm import |

**Vì sao lọt**: build dùng `react-router build` (esbuild/swc) — **không** type-check. Đề xuất thêm `"check:types": "tsc --noEmit -p tsconfig.json"` và chạy trong CI **trước** bước build.

---

## 9. TIÊU CHÍ NGHIỆM THU TOÀN CỤC & LỆNH KIỂM CHỨNG

### 9.1 Checklist "Definition of Done" cho đợt sửa `CHAIN-09`

| # | Điều kiện | Cách kiểm chứng | Kết quả mong đợi |
|:--:|---|---|---|
| 1 | Một hành động = đúng số tx thiết kế | §3.9 (đo nonce trước/sau) | Sai lệch **0** |
| 2 | Không có 2 tx song song | Log `[TX-GATEWAY]` tuần tự, không chồng thời gian | Không chồng lấn |
| 3 | Không hỏi mật khẩu 2 lần cho 1 chuỗi thao tác | `BA-48` | 1 dialog |
| 4 | Không có tx phát sinh khi ngồi không | `BA-50` | Nonce không đổi |
| 5 | Retry không tạo tx trùng | Ngắt mạng giữa chừng rồi bật lại | Không tăng nonce thêm |
| 6 | Sync báo đúng | `BA-51` (ví không quyền) | Toast warning + `ok=false` |
| 7 | Task on-chain đọc được sau khi tạo | `getTaskId` trả > 0 | Trong 5s |

### 9.2 Bộ lệnh kiểm chứng (chạy lại được, không cần UI)

```powershell
# 1) Cổng type — phải exit 0 sau khi sửa BUILD-01
npx tsc --noEmit -p apps/web/tsconfig.json
npx tsc --noEmit -p packages/services/tsconfig.json

# 2) Không còn .env.production bị track (SEC-01)
git ls-files | Select-String "\.env\.production"

# 3) Không còn private key trong mã nguồn (SEC-02)
Select-String -Path apps/web/core/services/blockchain/*.ts -Pattern "VITE_BLS_PRIVATE_KEY"

# 4) Giải mã selector contract (CHAIN-01)
node -e "const e=require('ethers');console.log(e.id('InvalidTask()').slice(0,10))"

# 5) Đo nonce trước/sau một hành động (CHAIN-09)
node check-wallet.mjs      # N0 -> thao tác -> node check-wallet.mjs  # N1

# 6) Trạng thái repo (chỉ được thay đổi tài liệu)
git status --porcelain
```

### 9.3 Kết quả kiểm chứng tại thời điểm lập báo cáo

| Lệnh | Kết quả |
|---|---|
| `npx tsc --noEmit -p apps/web/tsconfig.json` | **4 lỗi** (§8) ⇒ FAIL |
| `npx tsc --noEmit -p packages/services/tsconfig.json` | **0 lỗi** ⇒ PASS |
| `git ls-files \| Select-String "\.env"` | có `apps/web/.env.production`, `apps/space/.env.production` ⇒ **FAIL** (SEC-01) |
| `ethers.id("InvalidTask()")` | `0x0531bbb1` ⇒ khớp revert đã gặp |
| `git status --porcelain` | Chỉ `?? plane/BAO_CAO_LOI_CON_LAI_VA_KE_HOACH_SUA.md` ⇒ **không sửa code** |

---

## 10. KÝ XÁC NHẬN, CÂU HỎI MỞ & THỨ TỰ THỰC HIỆN

### 10.1 Thứ tự thực hiện đề xuất (3 đợt)

| Đợt | Nội dung | Thời gian | Vì sao thứ tự này |
|---|---|:--:|---|
| **Đợt 1 — Cầm máu** | `SEC-01` (rotate + untrack) · `BUILD-01` (4 lỗi TS) · `CHAIN-09` Bước 1+2+4 (gateway, coalesce, dedupe) | 2 ngày | Cắt ngay thất thoát gas & rò rỉ bí mật; **không** đổi kiến trúc |
| **Đợt 2 — Đúng đắn on-chain** | `CHAIN-01` (selector/contract) · `CHAIN-09` Bước 3+5 (retry idempotent, cờ phiên ký) · `CHAIN-02`/`CHAIN-03` (`SyncResult`) · `CHAIN-06` | 3 ngày | Hết tx trùng mới nhìn rõ lỗi contract |
| **Đợt 3 — Bảo mật & kiến trúc** | `SEC-02` (bỏ BLS khỏi client) · `SEC-03` (OTP server) · `SEC-05`, `SEC-06` · `ARCH-01` (indexer) | 2–4 tuần | Cần thay hạ tầng/khoá, không làm nóng được |

### 10.2 Câu hỏi mở — cần anh/chị quyết trước khi tôi sửa

| # | Câu hỏi | Lựa chọn | Ảnh hưởng |
|:--:|---|---|---|
| Q1 | Chính sách ghi CID workspace? | **A** tắt auto-commit · **B** coalesce 90–120s (đề xuất) · **C** chỉ khi bấm Sync | Quyết định nonce/hành động là 1 hay 2 |
| Q2 | `VITE_CONTRACT_ADDRESS` hiện tại có phải bản mới nhất? Có cần backfill task cũ? | Có / Không / Cần deploy lại | `CHAIN-01` **không sửa được** nếu sai địa chỉ |
| Q3 | `BA-41`: luôn OTP, hay giữ hybrid? | A/B/C (§7.3) | Đóng test case 41 |
| Q4 | Có chấp nhận **tắt** `VITE_BLS_PRIVATE_KEY` (ký chậm hơn do phải mở Vault) không? | Có / Không | Điều kiện bắt buộc của `SEC-02` |
| Q5 | Có môi trường staging riêng để test nonce, không đụng dữ liệu thật? | Có / Không | Nếu không, mọi test `CHAIN-09` phải dùng ví test riêng |

### 10.3 Những gì tôi **chưa** kiểm chứng được (công bố minh bạch)

1. **Chưa chạy trình duyệt/Crypto Vault** trong phiên này ⇒ tỉ lệ đóng góp RC-1…RC-5 (§3.4) là **ước lượng từ mã**, cần log theo §3.9 để chốt.
2. **Chưa có bytecode on-chain** để đối chiếu ⇒ kết luận "contract khác bản trong repo" dựa trên selector `0x464522a9` không tồn tại trong artifact (bằng chứng gián tiếp nhưng mạnh).
3. **Chưa đo gas thực tế** ⇒ con số "2–3× gas" suy ra từ số giao dịch, không phải từ hoá đơn.
4. Các test case PASS ở §7 **kế thừa** kết quả `AUDIT_TEST_CASES_REPORT.md` (đã smoke 16–17/17 ở phiên trước); phiên này **không** chạy lại smoke.

### 10.4 Cam kết phạm vi

* Báo cáo này **không thay đổi một dòng mã nguồn nào**. Bằng chứng: `git status --porcelain` chỉ có file `.md` này.
* Mọi đề xuất sửa đều **giữ nguyên** hành vi nghiệp vụ đã PASS (ID 13, 17, 19, 20, 22, 24, 26, 28, 31, 33–39, 42–44); thay đổi chỉ nằm ở **cách gửi giao dịch** và **cách báo lỗi**.

---

### Phụ lục A — Bảng tra nhanh `file:line` cho `CHAIN-09`

| Hành vi | File:line |
|---|---|
| Mọi lần lưu DB kích hoạt hook | `packages/services/src/dapp/store.ts:897,957-959` |
| Hook đăng ký upload + commit | `packages/services/src/dapp/chain.ts:3142-3145` |
| Debounce upload IPFS 2s | `packages/services/src/dapp/chain.ts:1758-1762` |
| Lên lịch commit CID (8s/25s) | `packages/services/src/dapp/chain.ts:813-828` |
| Thực thi commit (1 tx) | `packages/services/src/dapp/chain.ts:830-878,1438-1515` |
| Retry commit 20 lần | `packages/services/src/dapp/chain.ts:856-894` |
| Retry ký 3 lần | `packages/services/src/dapp/chain.ts:699-742` |
| Cờ phiên ký không bao giờ xoá | `packages/services/src/dapp/chain.ts:632,660-671` |
| Gọi commit trực tiếp (bỏ dedupe) | `packages/services/src/dapp/routes.ts:4427-4431` |
| Tx tạo task | `apps/web/core/services/issue/issue.service.ts:173-213` |
| Tx khi sửa task | `apps/web/core/services/issue/issue.service.ts:430-440` |
| Queue gửi tx phía web | `apps/web/core/services/blockchain/plane-task-chain.service.ts:268-277,447-465` |
| Retry + reset SDK | `apps/web/core/services/blockchain/plane-task-chain.service.ts:403-416,447-465` |
| Retry ở Sync button | `apps/web/core/components/blockchain/sync-button.tsx:127-145` |

---

**Hết phần kiểm toán (v1.0).**

---

# 11. NHẬT KÝ SỬA LỖI (v1.1)

> Mục này ghi lại **chính xác** những gì đã thay đổi trong mã nguồn, cách kiểm chứng, và những gì **cố ý chưa sửa** vì cần quyết định của nghiệp vụ hoặc cần thay đổi phía contract/dịch vụ. Không có mục nào được đánh dấu "xong" khi chưa có bằng chứng chạy được.

## 11.1 Bảng trạng thái sau khi sửa

| ID | Trước | Sau | Thay đổi chính | File |
|---|:--:|:--:|---|---|
| `BUILD-01` | ❌ 4 lỗi `tsc` | ✅ `tsc` sạch | Bổ sung type `TIssue` còn thiếu; `Partial<TWorkspaceDraftIssue>`; `formattedDate ?? null` | `sidebar.tsx`, `peek-overview/properties.tsx`, `draft-issue-properties.tsx`, `default-properties.tsx` |
| `SEC-01` | ❌ `.env.production` bị git track | ✅ Đã bỏ track + ignore | `git rm --cached` 2 file, thêm rule `.env*` + miễn trừ `*.example`, tạo `.env.production.example` cho `web`/`space`, xoá khoá thật khỏi `.env.example` | `.gitignore`, `apps/*/.env.production.example`, `apps/web/.env.example` |
| `SEC-01` (phần vận hành) | ❌ | 🔴 **Chưa xong** | Phải **thu hồi (rotate)** Brevo key + khoá BLS: chúng đã nằm trong lịch sử git và trong bundle đã phát hành | Việc của quản trị hệ thống |
| `SEC-02` | ❌ Khoá BLS nhúng bundle, không cảnh báo | 🟡 Giảm thiểu | Một getter duy nhất, bỏ fallback `NEXT_PUBLIC_*`, cảnh báo runtime, **cổng chặn build**; chưa chuyển ký sang server | `chain.ts`, `plane-task-chain.service.ts`, `scripts/check-public-env-secrets.mjs` |
| `SEC-03` | ❌ OTP in log, nằm trong tiêu đề email, lưu thô | 🟡 Giảm thiểu | OTP sinh bằng CSPRNG, **lưu hash SHA-256**, so sánh thời gian hằng, bỏ log, bỏ OTP khỏi tiêu đề; TTL 10 phút + 5 lần thử giữ nguyên | `auth.ts`, `routes.ts`, `mail.ts` |
| `SEC-03` (phần kiến trúc) | ❌ Xác thực OTP ở client | 🔴 **Chưa xong** | Cần endpoint xác thực phía server; hiện "server" chính là trình duyệt nên vẫn có thể bị qua mặt bằng DevTools | Cần backend |
| `CHAIN-09` | ❌ 1 hành động ⇒ 2–3 giao dịch | ✅ Sửa mã | Cổng giao dịch dùng chung (single-flight), gộp auto-commit theo `.env`, dedupe theo CID, retry **có kiểm chứng đã lên chain chưa**, xoá cờ phiên ký khi reset SDK | `tx-gateway.ts` (mới), `chain.ts`, `plane-task-chain.service.ts`, `fiai-sdk.service.ts`, `sync-button.tsx`, `routes.ts` |
| `CHAIN-02` | ❌ Báo "thành công" dù lỗi | ✅ Sửa mã | `syncDAppDBToChain` trả `DAppSyncResult` có `warnings`; UI hiển thị **WARNING** kèm lý do, chỉ SUCCESS khi `ok === true` | `chain.ts`, `sync-button.tsx` |
| `CHAIN-03` | ❌ Gộp lỗi backfill + toast success | ✅ Sửa mã | Kết quả có `unknown` + `errors[]`; toast nêu số lỗi và tên công việc chưa lưu | `plane-task-chain.service.ts`, `sync-button.tsx` |
| `CHAIN-06` | ❌ Nuốt mọi lỗi ⇒ "chưa có" | ✅ Sửa mã | `getIssueOnChainPresence()` trả `present` / `missing` / `unknown`; backfill không tạo trùng khi `unknown` | `plane-task-chain.service.ts` |
| `CHAIN-07` | ❌ Đọc contract bằng `0x000…0` | ✅ Sửa mã | Không còn fallback địa chỉ 0; ném `WalletUnavailableError` ⇒ rơi vào `unknown` | `plane-task-chain.service.ts` |
| `CHAIN-04` | ❌ Retry chạy lại toàn pipeline | 🟡 Giảm thiểu | Retry chỉ chạy lại **một** giao dịch, có kiểm chứng hash trước khi gửi lại | `plane-task-chain.service.ts`, `chain.ts` |
| `WALLET-04` | ❌ `getAllWallets` mỗi lần focus | ✅ Sửa mã | Focus chỉ đọc từ cache; chỉ nút "Làm mới" mới gọi danh sách ví | `sync-button.tsx`, `wallet-center.tsx` |
| `WALLET-03` | ❌ Badge ví không đổi sau khi chọn/thêm ví | ✅ Sửa mã | Phát sự kiện `plane:wallet-changed` từ `selectVaultWallet`; badge nghe và làm mới ngay | `wallet-center-events.ts`, `wallet-vault.service.ts`, `sync-button.tsx` |
| `SEC-05` | ❌ RPC `http://` không có cảnh báo | 🟡 Giảm thiểu | Cảnh báo một lần khi `VITE_RPC_URL` dùng `http://` trên địa chỉ công khai (không chặn để khỏi sập môi trường đang chạy) | `chain.ts` (`getRpcUrl`) |
| `WALLET-05` | ❌ Nút đồng bộ + Trung tâm ví hiện cả trang đăng nhập | ✅ Sửa mã | Ẩn khi chưa đăng nhập (`useUser().data`) | `sync-button.tsx`, `wallet-center.tsx` |
| `BA-32` | ❌ Upload tệp đính kèm treo "Pending" rồi lỗi | ✅ Sửa mã | Đọc tệp tại máy (bỏ POST multipart tới `""`); lưu tệp **trước khi ký**, kiểm tra lại ngay; `asset_url` là khoá tra cứu trong máy + `is_uploaded = true`; router đọc `assetId` ở đoạn cuối URL | `issue_attachment.service.ts`, `routes.ts` |
| `WALLET-02` | ❌ Luồng ghi khác không kiểm tra ví trước khi ký | ✅ Sửa mã | `confirmSigningWallet()` gọi `assertVaultSigningAddress` trước mọi bước ký; `notifyVaultProblem()` mở "Trung tâm ví" đúng chế độ ở tất cả nhánh on-chain trước đây chỉ ghi log; câu báo lỗi bỏ thuật ngữ | `plane-task-chain.service.ts`, `vault-notice.ts` (mới), `issue.service.ts`, `issue_comment.service.ts`, `issue_attachment.service.ts`, `metanode-wallet.service.ts` |
| `CHAIN-05` | ❌ 3 địa chỉ ví lệch nhau, sổ audit ghi sai chủ | ✅ Sửa mã | Ví **đã ký** là nguồn sự thật: `rememberSigningWalletAddress()` + `getSigningWalletAddress()`; lệch ⇒ tự đồng bộ lại mọi nơi lưu + phát `plane:wallet-changed`; audit ghi theo ví ký; `createIssueOnChain` dùng đúng ví ký | `metanode-wallet.service.ts`, `plane-task-chain.service.ts`, `blockchain-tracking.service.ts` |
| `BA-21` | ❌ Link dự án chia sẻ trả 404 ⇒ tưởng mất dữ liệu | ✅ Sửa mã | Nhánh "không thấy dự án trong máy" kiểm tra dự án có trong dữ liệu không gian làm việc trên chain: có ⇒ `403 NOT_AUTHORIZED` (màn "Chưa có quyền"), không có/đã xoá ⇒ `404` | `routes.ts` |
| Văn bản UI | ❌ Nhiều thuật ngữ kỹ thuật | ✅ Sửa mã | Bỏ "Crypto Vault / on-chain / nonce / IPFS / SDK / cổng 600x" khỏi mọi thông báo người dùng thấy | `sync-button.tsx`, `wallet-center.tsx`, `plane-task-chain.service.ts`, `chain.ts` |


## 11.2 `CHAIN-09` — cơ chế chống trùng đã triển khai

### (1) Cổng giao dịch dùng chung — `packages/services/src/dapp/tx-gateway.ts`

Toàn bộ giao dịch, dù phát sinh từ nhánh **auto-commit CID** (`chain.ts`) hay nhánh **task/comment/member** (`plane-task-chain.service.ts`), giờ đi qua **một hàng đợi duy nhất** trong cùng một JS runtime:

```text
Người dùng sửa 1 công việc
├── Nhánh A (auto-commit, nếu bật)  ──┐
└── Nhánh B (createTask/updateTask)  ──┤
                                       ▼
                     runExclusiveChainTx(label, task)      ← chỉ 1 việc chạy tại 1 thời điểm
                                       │
                     ┌─────────────────┴──────────────────┐
                     │ 1. đọc hash tài khoản (hashBefore) │
                     │ 2. gửi giao dịch                   │
                     │ 3. nếu lỗi: đọc lại hash (hashAfter)│
                     └─────────────────┬──────────────────┘
                                       ▼
                 hashAfter ≠ hashBefore ?  → giao dịch ĐÃ lên chain ⇒ trả hash, KHÔNG gửi lại
                 hashAfter =  hashBefore ? → lỗi thật ⇒ mới được thử lại
```

Vì hàng đợi tuần tự, không giao dịch nào khác chen vào giữa bước 1 và bước 3 ⇒ kết luận "đã lên chain" là **chắc chắn**, không phải phỏng đoán.

### (2) Chính sách auto-commit mới (quyết định quan trọng)

| Tình huống | `VITE_AUTO_COMMIT_ONCHAIN` | Số giao dịch / 1 thao tác |
|---|---|---|
| Công việc **đã** ghi on-chain (`VITE_ONCHAIN_TASKS_ENABLED=true`) | để trống (mặc định) | **1** (chỉ giao dịch nghiệp vụ) |
| Công việc **không** ghi on-chain | để trống (mặc định) | **1** (chỉ giao dịch CID — đường duy nhất đưa dữ liệu lên chain) |
| Muốn ghi ngầm cả hai | `true` | 1–2, nhưng **gộp** theo cửa sổ bên dưới |
| Chỉ ghi khi bấm nút | `false` | 1 (khi người dùng chủ động) |

Tham số gộp (đọc từ `.env`, không còn hard-code trong mã):

| Biến | Mặc định | Ý nghĩa |
|---|:--:|---|
| `VITE_ONCHAIN_COMMIT_DEBOUNCE_MS` | 90 000 | Chờ bao lâu sau lần lưu cuối mới ghi |
| `VITE_ONCHAIN_COMMIT_MIN_INTERVAL_MS` | 120 000 | Giãn cách tối thiểu giữa 2 giao dịch CID |
| `VITE_ONCHAIN_COMMIT_RETRY_MS` | 30 000 | Chờ giữa 2 lần thử |
| `VITE_ONCHAIN_COMMIT_MAX_ATTEMPTS` | 5 | Số lần thử tối đa (trước là 20 ⇒ rất lâu sau hành động mới bật hộp thoại ký) |

### (3) Bốn lớp chống trùng

1. `scheduleWorkspaceCIDCommit` — bỏ qua CID đã ghi thành công.
2. `commitWorkspaceCID` — **single-flight theo (slug, cid)** + dedupe lần nữa trước khi gửi (đã bổ sung; trước đây gọi trực tiếp thì bỏ qua kiểm tra này).
3. `routes.ts:4430` — không gọi thẳng `commitWorkspaceCID` nữa mà đi qua scheduler (`scheduleWorkspaceCIDCommit(wsSlug, newCid, 0)`).
4. `signTransactionWithUnlockRetry` — mọi lần ký nằm trong hàng đợi chung + kiểm chứng hash trước khi thử lại.

### (4) Xoá cờ phiên ký khi reset SDK

`resetFiaiSDK()` gọi `invalidateAllSigningSessions()` ⇒ `chain.ts` xoá `signingReadyAddresses`. Trước đây sau khi reset, hệ thống vẫn tưởng "đã có phiên ký" nên gửi giao dịch **không kèm** hộp thoại mật khẩu và thất bại khó hiểu.

## 11.3 Chính sách `.env` sau khi sửa

| Quy tắc | Trước | Sau |
|---|---|---|
| File `.env*` thật | Bị track (2 file) | **Bị git ignore**, chỉ track `*.example` |
| Giá trị mặc định trong mã | Nhiều hằng số hard-code | Đọc từ `.env`, có mặc định an toàn + kẹp khoảng giá trị |
| Fallback `NEXT_PUBLIC_*` | Có (gây nhầm môi trường) | **Đã bỏ** |
| Khoá thật trong `.env.example` | Có (khoá BLS) | **Đã xoá**, để trống + ghi chú |
| Bí mật lọt vào bundle | Không ai chặn | **`prebuild` dừng build** |

Biến mới cần khai báo (đã có trong `apps/web/.env.example`): `VITE_ONCHAIN_COMMIT_DEBOUNCE_MS`, `VITE_ONCHAIN_COMMIT_MIN_INTERVAL_MS`, `VITE_ONCHAIN_COMMIT_RETRY_MS`, `VITE_ONCHAIN_COMMIT_MAX_ATTEMPTS`; `VITE_AUTO_COMMIT_ONCHAIN` nay nhận **chuỗi rỗng** (tự quyết định) và đã được ghi chú rõ.

## 11.4 Cổng chặn bí mật trước khi build

`scripts/check-public-env-secrets.mjs` chạy qua hook `prebuild` của `apps/web` và `apps/space`:

```powershell
# Bình thường: build sẽ DỪNG nếu .env* có VITE_BLS_PRIVATE_KEY / VITE_BREVO_API_KEY
pnpm --filter web build

# Bản phát hành chuyển tiếp đã được phê duyệt (nhớ rotate khoá sau đó)
$env:ALLOW_PUBLIC_SIGNING_SECRETS="true"; pnpm --filter web build
```

Lý do phải chặn: đã kiểm chứng bằng cách grep bundle build ra — **3 file JS** chứa nguyên khoá BLS và **3 file** chứa API key Brevo. Đây không phải rủi ro lý thuyết.


## 11.5 Bằng chứng kiểm chứng (đã chạy, không phải suy đoán)

| # | Lệnh | Kết quả |
|---|---|---|
| V1 | `npx tsc --noEmit -p apps/web/tsconfig.json` | **0 lỗi** (trước: 4 lỗi) |
| V2 | `npx tsc --noEmit -p packages/services/tsconfig.json` | **0 lỗi** |
| V3 | `npx oxlint apps/web/core/components/blockchain apps/web/core/services/blockchain packages/services/src/dapp` | **0 error**, 74 warning (đều là cảnh báo style có từ trước trong `routes.ts`) |
| V4 | `npx react-router build` (trong `apps/web`) | **Build thành công** (11,4s) — mã mới không làm hỏng bundle |
| V5 | `node ../../scripts/check-public-env-secrets.mjs` (trong `apps/web`) | **exit 1** + liệt kê đúng 2 khoá cần xoá ⇒ cổng chặn hoạt động |
| V6 | `ALLOW_PUBLIC_SIGNING_SECRETS=true node ../../scripts/check-public-env-secrets.mjs` | **exit 0** + cảnh báo ⇒ đường chuyển tiếp hoạt động |
| V7 | `git rm --cached apps/web/.env.production apps/space/.env.production` + `git check-ignore -v` | 2 file **không còn track**, khớp rule `.env.*` ở `.gitignore:125` |

### Giới hạn của kiểm chứng lần này (nói thẳng)

- **Chưa** chạy được kiểm thử end-to-end với ví thật: môi trường này không có trình duyệt, không có Crypto Vault/blockchain-bridge đang chạy. Vì vậy **con số "1 giao dịch / 1 thao tác" cần QA xác nhận lại trên máy có ví** theo kịch bản ở §11.7.
- Các thay đổi hành vi đã được suy ra từ luồng mã (đọc – sửa – kiểm tra kiểu), **không** phải từ việc bấm thử.
- `react-router build` không kiểm tra kiểu, nên `V1`/`V2` mới là căn cứ cho `BUILD-01` (xem §8).

## 11.6 Việc cố ý CHƯA sửa (và vì sao)

| ID | Vì sao chưa sửa trong lần này | Cần ai quyết |
|---|---|---|
| `SEC-01` rotate khoá | Không thể thu hồi khoá từ mã nguồn; phải vào Brevo + nơi giữ khoá BLS để tạo khoá mới | Quản trị hệ thống |
| `SEC-02` ký BLS phía server | Cần biết contract có bắt buộc `blsPrivateKey` cho từng hàm hay không; nếu bỏ ngay sẽ làm hỏng luồng membership mà không có môi trường để thử | Dev + chủ contract |
| `SEC-03` xác thực OTP phía server | Cần backend thật; hiện dữ liệu nằm trong `localStorage` của trình duyệt | Kiến trúc + backend |
| `CHAIN-01` `getIssueTaskId` revert | Lỗi nằm ở dữ liệu/contract (task chưa tồn tại hoặc contract mới deploy). Phía app đã có preflight + `unknown`, nhưng muốn hết hẳn phải sửa dữ liệu on-chain | Dev + chủ contract |
| `CHAIN-05` 3 nguồn địa chỉ membership | Cần chốt "nguồn sự thật" (ví ký / ví hồ sơ / ví trên contract) — là quyết định nghiệp vụ | BA + Dev |
| `CHAIN-08` hiển thị trạng thái đã/chưa đồng bộ | Cần thiết kế UI (icon, tooltip, nơi đặt) — không nên tự phát minh | BA/Design |
| `WALLET-01` mở `:6005` khác origin | **Đã đo lại phạm vi**: ở bản production hiện tại, `VITE_URL_CONNECT_WALLET=https://json.iqnb.com/connectWalletWeb/` và `VITE_FIAI_CRYPTO_VAULT_URL=https://json.iqnb.com/fiai-sdk/crypto-vault/` **cùng origin** ⇒ dùng chung IndexedDB, lỗi **không** xảy ra với người dùng thật. Lỗi chỉ xuất hiện khi chạy local/LAN với hai cổng khác nhau (`.env`: `6005` vs `6002`). Không nên sửa mù vì luồng chọn ví hiện tại đang chạy được | Dev (chỉ môi trường dev) |
| `WALLET-02` preflight cho luồng ghi khác | Phụ thuộc `CHAIN-05` (chốt nguồn địa chỉ) | Dev |
| `WALLET-06` | Cần kịch bản thử với nhiều ví thật (WALLET-03 đã sửa: badge cập nhật qua sự kiện `plane:wallet-changed`) | QA |
| `ARCH-01` indexer đa máy | Thay đổi kiến trúc nhiều tuần | Quản lý |
| `BA-08`, `BA-14/07`, `BA-18`, `BA-21`, `BA-27`, `BA-30`, `BA-41` | Thuộc phạm vi nghiệp vụ/BA (một số cần DNS, một số cần quyết định sản phẩm) | BA/PM |
| Toàn bộ nhóm **email** (`BA-14/07` vào Spam, chất lượng thư mời) | **Theo yêu cầu của chủ sản phẩm**: email đang gửi ổn định trong thực tế nên **tạm bỏ khỏi phạm vi** lần này. Lưu ý tách bạch: việc **thu hồi khoá Brevo** (`SEC-01`) vẫn phải làm vì là rủi ro bảo mật, không phải lỗi chức năng email | Quản trị hệ thống |

## 11.7 Kịch bản QA cần chạy để đóng `CHAIN-09` (bắt buộc trước khi coi là xong)

Chuẩn bị: mở DevTools → Network (lọc `mtn_`), mở sẵn ứng dụng ví, tài khoản có ví đã mở khoá.

| # | Thao tác | Kỳ vọng (mới) | Cách đếm |
|---|---|---|---|
| Q1 | Tạo 1 công việc | **1** lần ký, `nonce` +1 | Đếm số lần hộp thoại ví hiện + so `lastHash` trước/sau |
| Q2 | Sửa 3 trường liên tiếp trong 30s | **1** lần ký (gộp) | Như Q1 |
| Q3 | Bấm "Đồng bộ dữ liệu" khi dữ liệu không đổi | **0** lần ký (bỏ qua `setCID` vì CID đã đúng) | Như Q1 |
| Q4 | Bấm "Đồng bộ dữ liệu" khi có thay đổi | **1–2** lần ký, không quá 2 | Như Q1 |
| Q5 | Đóng hộp thoại mật khẩu giữa lúc ký | **0** giao dịch, thông báo "Chưa mở khoá ví", dữ liệu vẫn còn trên máy | Toast + localStorage |
| Q6 | Ngắt mạng đúng lúc ví trả kết quả | Không sinh giao dịch thứ 2 khi mở lại mạng | So `lastHash` |
| Q7 | Bấm "Đồng bộ dữ liệu" khi ví chưa có ví | Mở "Trung tâm ví", thông báo "Chưa có ví" (không hiện tên SDK/cổng) | Ảnh chụp màn hình |
| Q8 | Đăng xuất rồi mở trang đăng nhập | **Không** còn nút "Đồng bộ dữ liệu" / badge ví | Ảnh chụp màn hình |

Nếu Q1/Q2/Q4 cho kết quả khác bảng trên ⇒ mở lại `CHAIN-09` kèm log Network, **không** đánh dấu đã xong.

## 11.8 Ba quyết định cần chốt trước khi làm tiếp

| # | Câu hỏi | Ảnh hưởng |
|---|---|---|
| **D1** | Có cần ghi ngầm CID workspace nữa không (`VITE_AUTO_COMMIT_ONCHAIN=true`), hay chỉ ghi khi người dùng bấm? | Nếu bật: thêm 1 giao dịch/phiên (đã gộp 90–120s). Nếu tắt: tiết kiệm phí tối đa nhưng dữ liệu chỉ lên chain khi bấm |
| **D2** | Contract có bắt buộc `blsPrivateKey` cho `createTask`/`updateWorkspaceCID`/`joinWorkspace` không? | Quyết định có thể bỏ hẳn khoá khỏi bundle (đóng `SEC-02`) hay phải làm dịch vụ ký riêng |
| **D3** | Ai là "nguồn sự thật" cho địa chỉ ví thành viên? | ✅ **Đã chốt trong mã**: ví đã ký (`msg.sender`). Đóng `CHAIN-05` + `WALLET-02`; hồ sơ chỉ hiển thị. Nếu nghiệp vụ muốn ngược lại (ví hồ sơ là chuẩn) thì phải sửa lại `confirmSigningWallet` — báo trước khi QA |

## 11.9 Nên sửa gì tiếp — thứ tự đề xuất (sau khi đã sửa `BA-32`)

Nguyên tắc xếp thứ tự: (1) chỉ làm phần **chỉ cần sửa mã**, không cần quyết định sản phẩm/contract; (2) ưu tiên lỗi **đang thực sự hỏng** và người dùng thấy ngay; (3) không mở thêm đường mới khi đường cũ còn chưa được QA trên chain thật.

| Thứ tự | Việc | Vì sao làm bây giờ | Công | Chặn bởi |
|:--:|---|---|:--:|---|
| **1** | ✅ **Đã làm** `CHAIN-05` + `WALLET-02` — **danh tính ví**: mọi chỗ ghi/kiểm tra quyền dùng **đúng địa chỉ đang ký** (`msg.sender`), ví hồ sơ chỉ để hiển thị | Hai mã này là **cùng một gốc**; trước đây `blockchain-tracking.service.ts` ghi sổ theo `getLinkedMetanodeWalletAddress()` còn giao dịch ký bằng địa chỉ ví trong ứng dụng ví ⇒ lệch sổ. Nay sổ audit ghi theo ví đã ký và tự đồng bộ lại các nơi lưu khi phát hiện lệch | ~1 ngày | Không (D3 đã chốt trong mã) |
| **2** | ✅ **Đã làm** `BA-21` — link chia sẻ dự án trả `404` thay vì "Chưa có quyền" | Người nhận link thấy "không tìm thấy" ⇒ tưởng mất dữ liệu; sửa thuần router + UI, không đụng ví/chain | 0,5–1 ngày | Không |
| **3** | `WALLET-06` — import có thể "nhận vơ" ví cũ | Rủi ro gắn nhầm danh tính on-chain cho tài khoản; sửa nhỏ (nếu không đọc được danh sách ví trước đó ⇒ bắt xác nhận địa chỉ) | 2 giờ | Cần 2 ví thật để thử |
| **4** | `CHAIN-08` — hiển thị "đã/chưa đồng bộ" | Người dùng không biết dữ liệu đã lên hệ thống chưa; đây là cách duy nhất để họ tự kiểm tra thay vì bấm đồng bộ nhiều lần | 1–2 ngày | Cần design 1 buổi (icon + tooltip + vị trí) |
| **5** | `ARCH-02` — hai tab ghi đè `localStorage` của nhau | Nếu có phản ánh "mất dữ liệu", đây là nghi phạm số một (không phải chain) | ~2 ngày | Chỉ làm khi có phản ánh thật |

**Chưa nên làm / cố ý hoãn**

* `CHAIN-09`: **không sửa thêm** cho tới khi chạy xong Q1–Q8 (§11.7) — sửa tiếp lúc chưa có số đo sẽ làm mất khả năng quy kết.
* `WALLET-01`: **hạ ưu tiên** — bản production dùng chung origin nên lỗi chỉ xảy ra ở môi trường dev/LAN (§11.6).
* `SEC-02`, `SEC-03`: chờ **D2** và backend; riêng `SEC-01` (thu hồi khoá Brevo + BLS) là việc vận hành, **phải làm song song bất kể thứ tự trên**.
* `SEC-06`, `ARCH-01`: thay đổi kiến trúc (tuần), cần quyết định ở mức quản lý.
* Nhóm **email**: tạm bỏ khỏi phạm vi theo yêu cầu.

---

**Hết báo cáo v1.1.** Tình trạng thật, tính theo 31 mã lỗi trong §1.1:

- **13 mã đã sửa trong mã** và có kiểm chứng tĩnh (`BUILD-01`, `CHAIN-09`, `CHAIN-02`, `CHAIN-03`, `CHAIN-06`, `CHAIN-07`, `WALLET-03`, `WALLET-04`, `WALLET-05`, `BA-32`, `WALLET-02`, `CHAIN-05`, `BA-21`) — nhưng **chưa có mã nào được kiểm chứng trên chain thật**; `CHAIN-09` còn phải qua QA Q1–Q8, `BA-32` cần thử lại thao tác đính kèm tệp, `WALLET-02` + `CHAIN-05` cần thử với ứng dụng ví thật (rỗng ví / đổi ví), `BA-21` cần mở link bằng tài khoản thứ hai.
- **5 mã mới giảm thiểu, chưa đóng** (`SEC-01`, `SEC-02`, `SEC-03`, `CHAIN-04`, `SEC-05`) — cần rotate khoá, backend, hoặc chuyển ký sang server.
- **13 mã chưa chạm** (`CHAIN-01`, `WALLET-01`, `WALLET-06`, `CHAIN-08`, `SEC-06`, `ARCH-01`, `ARCH-02`, và 7 case BA).


Riêng `CHAIN-09`: 4/5 nguyên nhân gốc (RC-2…RC-5) đã xử lý; **RC-1 (mỗi lần lưu = một giao dịch) chỉ được gộp trong cửa sổ 90–120 giây, chưa bị loại bỏ về mặt thiết kế** — người dùng thao tác cách nhau hơn 2 phút vẫn sinh giao dịch mới cho mỗi thao tác. Không có mục nào được ghi "đã xong" mà thiếu bằng chứng.

