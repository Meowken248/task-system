// Authentication material is device-private. Public/shared snapshots are data
// transport, never a source of passwords or proof that an email was verified.
const privateAuthKeys = new Set([
  "auth",
  "credentials",
  "password",
  "passwordhash",
  "passwordsalt",
  "otp",
  "otpcode",
  "otphash",
  "otpsecret",
  "otpcache",
  "session",
  "sessions",
  "authsession",
  "authsessions",
  "sessiontoken",
  "sessionseed",
  "challengetoken",
  "maillinktoken",
  "linktoken",
  "invitationlinktoken",
  "accesstoken",
  "refreshtoken",
  "privatekey",
  "blsprivatekey",
  "apikey",
  "apisecret",
  "jwt",
  "isemailverified",
  "emailverified",
]);
const normalizedKey = (key: string) => key.replace(/[_-]/g, "").toLowerCase();
const normalizedEmail = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");

export function isPrivateAuthField(key: string): boolean {
  return privateAuthKeys.has(normalizedKey(key));
}

export function sanitizeSharedSnapshot(snapshot: Record<string, any>): Record<string, any> {
  const copy = (value: any): any => {
    if (Array.isArray(value)) return value.map(copy);
    if (value instanceof Date) return value.toISOString();
    if (!value || typeof value !== "object") return value;
    const result: Record<string, any> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isPrivateAuthField(key) || key === "__proto__" || key === "constructor" || key === "prototype") continue;
      result[key] = copy(entry);
    }
    return result;
  };
  return copy(snapshot);
}

export function preserveLocalUserAuth(local: Record<string, any>, shared: Record<string, any>): void {
  // A shared profile with a colliding ID must not attach a local password to a
  // different email on the next cache reload.
  if (!normalizedEmail(local.email) || normalizedEmail(local.email) !== normalizedEmail(shared.email)) return;
  for (const [key, value] of Object.entries(local)) {
    if (isPrivateAuthField(key)) shared[key] = value;
  }
}
