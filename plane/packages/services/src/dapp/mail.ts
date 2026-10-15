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

  const isInviterCustom =
    inviterName &&
    inviterName.trim() !== "" &&
    inviterName.trim().toLowerCase() !== "plane workspace" &&
    inviterName.trim().toLowerCase() !== workspaceName.trim().toLowerCase();

  const inviteMessage = isInviterCustom
    ? `<strong>${inviterName}</strong> đã mời bạn tham gia cộng tác trong không gian làm việc <strong>${workspaceName}</strong> trên Plane.`
    : `Bạn đã nhận được lời mời tham gia không gian làm việc <strong>${workspaceName}</strong> trên Plane.`;

  const workspaceInitial = (workspaceName || "P").trim().charAt(0).toUpperCase();

  const htmlContent = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${subject}</title>
  <style>
    :root {
      color-scheme: dark;
      supported-color-schemes: dark;
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #08090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #f4f4f5; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #08090b; background: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(62, 99, 221, 0.16) 0%, rgba(8, 9, 11, 0) 80%); padding: 48px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 500px; background-color: #121317; background: linear-gradient(180deg, rgba(20, 22, 28, 0.92) 0%, rgba(13, 14, 18, 0.96) 100%); border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 255, 255, 0.1); overflow: hidden;">
          <!-- Card Header & Brand -->
          <tr>
            <td style="padding: 32px 32px 0 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align: middle; padding-right: 10px;">
                    <svg width="28" height="17" viewBox="0 0 85 52" fill="#3e63dd" xmlns="http://www.w3.org/2000/svg" style="display: block;">
                      <path d="M44.3223 2.9264C44.3223 0.754665 46.6083 -0.65811 48.5508 0.313121L80.4551 16.2653C82.9294 17.5024 84.4922 20.0321 84.4922 22.7985V48.2487C84.4922 50.4204 82.2071 51.833 80.2646 50.8619L62.3281 41.8932V22.7975C62.3281 20.0311 60.7653 17.5015 58.291 16.2643L44.3223 9.27992V2.9264ZM0 2.92543C8.01645e-05 0.753753 2.28609 -0.659069 4.22852 0.312144L22.1582 9.27699V28.3766C22.1582 31.1428 23.7213 33.6716 26.1953 34.9088L40.1699 41.8952V48.2487C40.1697 50.4202 37.8847 51.832 35.9424 50.861L4.03711 34.9088C1.56305 33.6716 0 31.1428 0 28.3766V2.92543ZM22.1582 2.92543C22.1583 0.753753 24.4443 -0.659069 26.3867 0.312144L44.3223 9.27992V28.3776C44.3223 31.1439 45.8861 33.6727 48.3604 34.9098L62.3281 41.8932V48.2487C62.3279 50.4202 60.0429 51.832 58.1006 50.861L40.1699 41.8952V22.7975C40.1699 20.0311 38.6071 17.5015 36.1328 16.2643L22.1582 9.27699V2.92543Z" fill="#3e63dd"/>
                    </svg>
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 16px; font-weight: 600; letter-spacing: -0.02em; color: #ffffff;">Plane</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Title & Intro -->
          <tr>
            <td style="padding: 24px 32px 0 32px;">
              <h1 style="margin: 0 0 10px 0; font-size: 20px; font-weight: 600; color: #ffffff; letter-spacing: -0.02em; line-height: 1.35;">
                Lời mời tham gia không gian làm việc
              </h1>
              <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #a1a1aa;">
                ${inviteMessage}
              </p>
            </td>
          </tr>

          <!-- Workspace Info (Glass panel) -->
          <tr>
            <td style="padding: 20px 32px 0 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #17181f; background: rgba(23, 24, 31, 0.75); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px;">
                <tr>
                  <td style="padding: 16px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="42" style="vertical-align: middle;">
                          <div style="width: 40px; height: 40px; border-radius: 8px; background: rgba(62, 99, 221, 0.15); border: 1px solid rgba(62, 99, 221, 0.3); text-align: center; line-height: 40px; font-size: 16px; font-weight: 600; color: #ffffff;">
                            ${workspaceInitial}
                          </div>
                        </td>
                        <td style="vertical-align: middle; padding-left: 14px;">
                          <div style="font-size: 15px; font-weight: 600; color: #ffffff; line-height: 1.3;">
                            ${workspaceName}
                          </div>
                          <div style="font-size: 12px; color: #71717a; margin-top: 4px;">
                            Vai trò: <span style="display: inline-block; padding: 1px 7px; background: rgba(62, 99, 221, 0.12); border: 1px solid rgba(62, 99, 221, 0.25); border-radius: 4px; color: #8da4ef; font-size: 11px; font-weight: 500;">${roleLabel}</span>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Action Button -->
          <tr>
            <td style="padding: 24px 32px 0 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <a href="${fullInviteUrl}" target="_blank" rel="noopener noreferrer" style="display: block; box-sizing: border-box; width: 100%; padding: 12px 24px; background-color: #3e63dd; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 500; letter-spacing: -0.01em; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.15); text-align: center; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.18);">
                      Chấp nhận lời mời
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Fallback Link -->
          <tr>
            <td style="padding: 24px 32px 32px 32px;">
              <div style="border-top: 1px solid rgba(255, 255, 255, 0.06); margin-bottom: 20px;"></div>
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #71717a; line-height: 1.5;">
                Nếu nút trên không phản hồi, mở liên kết sau trong trình duyệt:
              </p>
              <div style="background-color: #0c0d10; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 6px; padding: 10px 12px; word-break: break-all;">
                <a href="${fullInviteUrl}" target="_blank" rel="noopener noreferrer" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; color: #4f75f2; text-decoration: none; word-break: break-all;">
                  ${fullInviteUrl}
                </a>
              </div>
            </td>
          </tr>
        </table>

        <!-- Minimal Footer -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 500px;">
          <tr>
            <td style="padding: 24px 16px 0 16px; text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 12px; color: #52525b; line-height: 1.5;">
                Email này được gửi tự động từ <strong>Plane</strong>. Nếu bạn không mong muốn tham gia, hãy bỏ qua email này.
                Lưu ý: Nếu chưa đăng nhập/đăng ký, hệ thống sẽ chuyển đến trang tương ứng. Vui lòng hoàn tất và nhấn lại link mời tham gia.
              </p>
              <p style="margin: 0; font-size: 11px; color: #3f3f46;">
                © Plane • Open-source project management tool
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
