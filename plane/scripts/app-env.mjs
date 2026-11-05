/** Shared build-time environment policy. Never writes values into process.env. */
export const APP_ENV_PREFIXES = ["VITE_", "FIAI_", "RPC_ALLOW_INSECURE_TLS"];

export function resolveAppMode(argv = process.argv, lifecycle = process.env.npm_lifecycle_event || "") {
  const index = argv.indexOf("--mode");
  const explicit = index >= 0 ? argv[index + 1] : argv.find((arg) => arg.startsWith("--mode="))?.slice(7);
  if (index >= 0 && (!explicit || explicit.startsWith("--"))) throw new Error("Missing --mode value");
  if (explicit) return explicit;
  return argv.includes("build") || ["build", "prebuild"].includes(lifecycle) ? "production" : "development";
}

export function readAppEnv(appDir, mode, loadEnv) {
  return loadEnv(mode, appDir, APP_ENV_PREFIXES);
}

/** Both Vite and React Router use the same normalized mount path. */
export function appBasePath(value, fallback) {
  const raw = (value ?? fallback).trim();
  if (/[?#:]|\\/.test(raw)) throw new Error("App base path must be a pathname, not a URL");
  const clean = raw.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
  if (clean.split("/").some((part) => part === "." || part === "..")) throw new Error("Invalid app base path");
  return clean ? `/${clean}/` : "/";
}

export const PUBLIC_SIGNING_SECRETS = [
  { key: "VITE_BLS_PRIVATE_KEY", reason: "Khóa ký BLS sẽ nằm trong bundle trình duyệt." },
  { key: "VITE_BREVO_API_KEY", reason: "API key gửi mail sẽ nằm trong bundle trình duyệt." },
];

export function publicSecretKeys(env) {
  return PUBLIC_SIGNING_SECRETS.filter(({ key }) => typeof env[key] === "string" && env[key].trim());
}

export function assertPublicBuildEnv(env, allowPublicSecrets = process.env.ALLOW_PUBLIC_SIGNING_SECRETS === "true") {
  const violations = publicSecretKeys(env);
  if (violations.length && !allowPublicSecrets) {
    throw new Error(
      `Public secret guard blocked: ${violations.map(({ key }) => key).join(", ")}. ` +
        "No values are logged. Use an explicitly approved ALLOW_PUBLIC_SIGNING_SECRETS=true only for an internal build."
    );
  }
  return violations;
}
