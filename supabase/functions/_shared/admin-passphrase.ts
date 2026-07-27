export const ADMIN_PASSPHRASE_MIN_BYTES = 12;
export const ADMIN_PASSPHRASE_MAX_BYTES = 72;
// The pre-containment login endpoint truncated submitted strings to this
// JavaScript code-unit boundary. Preserve existing environment/bcrypt secrets
// through rotation, but never mint a new secret outside the stricter byte cap.
export const ADMIN_LOGIN_PASSPHRASE_MAX_CODE_UNITS = 1024;

export function isValidAdminLoginPassphrase(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= ADMIN_LOGIN_PASSPHRASE_MAX_CODE_UNITS;
}

export function isValidAdminPassphrase(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const byteLength = new TextEncoder().encode(value).byteLength;
  return (
    byteLength >= ADMIN_PASSPHRASE_MIN_BYTES &&
    byteLength <= ADMIN_PASSPHRASE_MAX_BYTES
  );
}
