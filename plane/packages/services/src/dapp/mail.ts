import { getEnvVar } from "./store";

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_BREVO_API_KEY =
  "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";
const DEFAULT_SENDER_NAME = "Plane Workspace";
const DEFAULT_SENDER_EMAIL = "anh2482006@gmail.com";

export function getBrevoApiKey(): string {
  return (getEnvVar("VITE_BREVO_API_KEY") || DEFAULT_BREVO_API_KEY).trim();
}

export function getEmailSender(): { name: string; email: string } {
  const name = (getEnvVar("VITE_EMAIL_SENDER_NAME") || DEFAULT_SENDER_NAME).trim();
  const email = (getEnvVar("VITE_EMAIL_SENDER_ADDRESS") || DEFAULT_SENDER_EMAIL).trim();
  return { name, email };
}

export function getRoleLabel(role: number | string): string {
  const roleNum = Number(role);
  switch (roleNum) {
    case 20:
      return "Quản trị viên (Admin)";
    case 15:
      return "Thành viên (Member)";
    case 10:
      return "Người xem (Viewer)";
    case 5:
      return "Khách (Guest)";
    default:
      return "Thành viên (Member)";
  }
}

export function buildFullInviteUrl(invitePath: string): string {
  let origin = "";
  if (typeof window !== "undefined" && window.location?.origin) {
    origin = window.location.origin;
  }
  if (!origin) {
    origin = getEnvVar("VITE_WEB_BASE_URL") || "http://localhost:3000";
  }
  origin = origin.replace(/\/+$/, "");

  const routerBase = (getEnvVar("VITE_ROUTER_BASENAME") || "/plane").trim();
  const cleanBase = routerBase === "/" ? "" : routerBase.replace(/^\/+|\/+$/g, "");
  const basePrefix = cleanBase ? `/${cleanBase}` : "";

  let path = invitePath.trim();
  if (!path.startsWith("/")) path = `/${path}`;

  // If path does not already begin with basePrefix, prepend it
  if (basePrefix && !path.startsWith(`${basePrefix}/`) && path !== basePrefix) {
    path = `${basePrefix}${path}`;
  }

  return `${origin}${path}`;
}

export interface ISendWorkspaceInviteEmailOptions {
  recipientEmail: string;
  workspaceName: string;
  workspaceSlug: string;
  inviteLink: string;
  role?: number | string;
  inviterName?: string;
}

export async function sendWorkspaceInviteEmail(options: ISendWorkspaceInviteEmailOptions): Promise<boolean> {
  const {
    recipientEmail,
    workspaceName,
    inviteLink,
    role = 15,
    inviterName = "Plane Workspace",
  } = options;

  const apiKey = getBrevoApiKey();
  if (!apiKey) {
    console.warn("[Brevo Mail] ⚠️ Brevo API key is not configured; skipping email dispatch.");
    return false;
  }

  const sender = getEmailSender();
  const fullInviteUrl = buildFullInviteUrl(inviteLink);
  const roleLabel = getRoleLabel(role);
  const subject = `Lời mời tham gia không gian làm việc "${workspaceName}" trên Plane`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0f172a; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 560px; background-color: #1e293b; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.1); overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
          <!-- Header with logo badge -->
          <tr>
            <td style="padding: 32px 32px 20px 32px; text-align: center; background: linear-gradient(180deg, rgba(59, 130, 246, 0.15) 0%, rgba(30, 41, 59, 0) 100%);">
              <div style="display: inline-block; padding: 8px 18px; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 9999px;">
                <span style="font-size: 13px; font-weight: 700; color: #60a5fa; letter-spacing: 0.05em; text-transform: uppercase;">
                  ✦ PLANE WORKSPACE ✦
                </span>
              </div>
              <h1 style="margin: 20px 0 0 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em;">
                Lời mời tham gia không gian làm việc
              </h1>
            </td>
          </tr>

          <!-- Main content -->
          <tr>
            <td style="padding: 12px 32px 24px 32px;">
              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #cbd5e1;">
                Xin chào,
              </p>
              <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #cbd5e1;">
                <strong>${inviterName}</strong> đã mời bạn gia nhập không gian làm việc <strong>${workspaceName}</strong> trên nền tảng quản lý dự án <strong>Plane</strong>.
              </p>

              <!-- Workspace Info Card -->
              <table role="presentation" width="100%" style="background-color: #0f172a; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; margin: 0 0 24px 0;">
                <tr>
                  <td style="padding: 14px 18px;">
                    <span style="font-size: 13px; color: #94a3b8; display: block; margin-bottom: 4px;">Không gian làm việc:</span>
                    <strong style="font-size: 16px; color: #f8fafc;">${workspaceName}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 14px 18px; border-top: 1px solid rgba(255, 255, 255, 0.05);">
                    <span style="font-size: 13px; color: #94a3b8; display: block; margin-bottom: 4px;">Vai trò được gán:</span>
                    <strong style="font-size: 14px; color: #38bdf8;">${roleLabel}</strong>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
                <tr>
                  <td align="center">
                    <a href="${fullInviteUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; border-radius: 10px; box-shadow: 0 4px 14px 0 rgba(37, 99, 235, 0.4); text-align: center;">
                      Tham gia không gian làm việc →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Alternative Link -->
              <p style="margin: 20px 0 8px 0; font-size: 13px; color: #94a3b8; line-height: 1.5;">
                Nếu nút phía trên không hoạt động, bạn vui lòng nhấp vào hoặc sao chép liên kết dưới đây vào trình duyệt:
              </p>
              <p style="margin: 0; font-size: 12px; word-break: break-all; background-color: #0f172a; padding: 10px 14px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05);">
                <a href="${fullInviteUrl}" target="_blank" rel="noopener noreferrer" style="color: #60a5fa; text-decoration: underline;">
                  ${fullInviteUrl}
                </a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px 28px 32px; background-color: #111827; border-top: 1px solid rgba(255, 255, 255, 0.05); text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748b;">
                Nếu bạn không mong muốn nhận lời mời này, bạn có thể an tâm bỏ qua email này.
              </p>
              <p style="margin: 0; font-size: 12px; color: #475569;">
                Plane Workspace • Quản lý công việc thông minh, hiện đại & phi tập trung
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  try {
    const payload = {
      sender: {
        name: sender.name,
        email: sender.email,
      },
      to: [
        {
          email: recipientEmail,
        },
      ],
      subject: subject,
      htmlContent: htmlContent,
    };

    console.log(`[Brevo Mail] 📤 Sending invitation email to ${recipientEmail} for workspace "${workspaceName}"...`);

    const response = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      console.log(`[Brevo Mail] ✅ Email sent successfully to ${recipientEmail}:`, data);
      return true;
    } else {
      const errorText = await response.text();
      console.warn(`[Brevo Mail] ⚠️ Failed to send email to ${recipientEmail} (${response.status}):`, errorText);
      return false;
    }
  } catch (err: any) {
    console.error(`[Brevo Mail] ❌ Network/Fetch error sending email to ${recipientEmail}:`, err);
    return false;
  }
}
