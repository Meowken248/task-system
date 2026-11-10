# Kế hoạch sửa và kiểm thử Plane — 31/10/2026

Nhánh bắt đầu: `Fix_bug_ver1.0`, HEAD `433edba`, working tree sạch.
Người dùng cho phép commit từng phần; không push. Không đổi SDK, dependency,
lockfile, env thật, hạ tầng hoặc deploy contract trong đợt này.

## Các chặng và tiêu chí nghiệm thu

1. **Quyền xóa workspace/project**: yêu cầu phiên đăng nhập, đúng workspace và
   quyền quản trị; môi trường có registry dùng quyền ví thật trên chain. RPC lỗi
   hoặc ví đổi phải từ chối trước khi thay đổi dữ liệu/tombstone. Kiểm tra cả
   trường hợp hợp lệ và bị từ chối, rồi commit riêng.
2. **Quyền tệp và upload**: ghi phạm vi workspace/project/người tạo vào metadata;
   chặn đường dẫn giả, thao tác hàng loạt và upload trực tiếp vượt phạm vi.
   Hỗ trợ dữ liệu cũ khi xác định được phạm vi; không tự đoán quyền cho bản ghi
   mơ hồ. Kiểm thử vòng đời upload và đường dịch vụ attachment trực tiếp, commit.
3. **Link UUID work item**: bổ sung metadata cho redirect; xác minh quan hệ
   workspace/project/issue, bản ghi đã xóa và dự án riêng tư. Test rồi commit.
4. **OTP**: chỉ báo đã gửi sau khi nhà cung cấp nhận yêu cầu; lỗi gửi không
   được trả thành công. Không biến OTP local thành bằng chứng email on-chain.
   Test thiếu cấu hình, mạng lỗi, HTTP lỗi, gửi thành công và gửi đồng thời; commit.
5. **Analytics**: dùng cùng tập thành viên chuẩn với màn Members; loại trùng,
   lời mời pending, thành viên đã rời và hồ sơ workspace khác. Test rồi commit.
6. **Tích hợp**: chạy toàn bộ DApp regression, TypeScript services/web, build
   trên bản sao env đã bỏ bí mật và browser fixture cho member/upload. Báo cáo
   số liệu mới, phân biệt fixture với RPC/giao dịch thật; commit báo cáo và test.

## Giới hạn phải báo cáo

- Chặn ở adapter không mã hóa/xóa dữ liệu đã cache trên thiết bị người dùng.
- Không hứa tuyệt đối không còn lỗi; mỗi kết luận phải có phạm vi và bằng chứng.
- Registry đang deploy v2 không hỗ trợ self-leave v3; nâng contract là đợt riêng.
- Tệp đính kèm local không tự trở thành tệp có thể tải trên máy khác.
- Build trực tiếp với env hiện hữu bị guard bí mật chặn; không bỏ qua guard.
- Giao dịch thực, email thật và cộng tác hai ví thật chỉ được ghi là đạt khi
  đã có bằng chứng tương ứng; fixture không thay thế các bằng chứng đó.

## Tiến độ đã xác minh

- Quyền xóa: `4e9cef7`.
- Phạm vi asset và dịch vụ attachment trực tiếp: `f7c6ce6`.
- Metadata link UUID: `1dc7b88`.
- OTP chờ kết quả gửi, xử lý lỗi và giữ mã cũ khi gửi lại lỗi: `804177c`.
- Analytics dùng danh sách thành viên chuẩn: `fd12a56`.
- Bổ sung sau kiểm thử biên: chuẩn hóa URL (`88df5c7`), khóa alias CRUD và
  thống nhất xóa attachment (`6792353`). Các ca tái hiện thất bại trước sửa,
  đạt sau sửa.
- Bổ sung ma trận quyền hợp lệ (`18b7568`): Workspace Admin ưu tiên hơn cache
  project; Project Admin/creator được dùng tài nguyên project; Guest chỉ đọc.
  Quyền quản trị project không cấp quyền sửa workspace logo.
- Regression hiện tại: 279/279 đạt; TypeScript services/web đạt; services build
  và web build trên bản sao đã loại bí mật đạt. Báo cáo nghiệm thu và giới hạn
  nằm trong [báo cáo đợt sửa](/C:/task-system/plane/BAO_CAO_SUA_VA_KIEM_THU_2026-10-31.md).
