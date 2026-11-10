import { createOtpCode, storeOtpCode } from "./auth";
import { sendOtpEmail } from "./mail";
import type { RouteResult } from "./types";

const inFlight = new Map<string, Promise<RouteResult>>();

/** Coalesce double submissions in this runtime without storing anything on a mail service. */
export function requestOtpDelivery(email: string): Promise<RouteResult> {
  const existing = inFlight.get(email);
  if (existing) return existing;
  const operation = deliver(email).finally(() => inFlight.delete(email));
  inFlight.set(email, operation);
  return operation;
}

async function deliver(email: string): Promise<RouteResult> {
  const code = createOtpCode();
  const accepted = await sendOtpEmail(email, code);
  if (!accepted) return {
    status: 503,
    data: { code: "OTP_DELIVERY_FAILED", error: "Chưa gửi được mã xác nhận. Vui lòng thử lại sau." },
  };
  try {
    await storeOtpCode(email, code);
  } catch {
    return { status: 503, data: { code: "OTP_STORAGE_FAILED", error: "Không lưu được mã xác nhận trên thiết bị. Hãy kiểm tra quyền lưu trữ rồi gửi lại mã." } };
  }
  return { status: 200, data: { message: "Yêu cầu gửi mã đã được tiếp nhận. Hãy kiểm tra hộp thư và thư rác." } };
}
