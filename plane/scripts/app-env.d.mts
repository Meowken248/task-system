export const APP_ENV_PREFIXES: string[];
export function resolveAppMode(argv?: string[], lifecycle?: string): string;
export function readAppEnv(
  appDir: string,
  mode: string,
  loadEnv: (mode: string, envDir: string, prefixes?: string | string[]) => Record<string, string>
): Record<string, string>;
export function appBasePath(value: string | undefined, fallback: string): string;
export const PUBLIC_SIGNING_SECRETS: { key: string; reason: string }[];
export function publicSecretKeys(env: Record<string, string | undefined>): { key: string; reason: string }[];
export function assertPublicBuildEnv(
  env: Record<string, string | undefined>,
  allowPublicSecrets?: boolean
): { key: string; reason: string }[];
