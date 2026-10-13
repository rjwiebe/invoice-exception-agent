export const DEMO_SESSION_COOKIE = "invoice_demo_session";
export const DEMO_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidDemoSessionId(value: string | undefined): value is string {
  return !!value && SESSION_ID_PATTERN.test(value);
}

export function createDemoSessionId(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function sessionIdFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const item of header.split(";")) {
    const [name, ...parts] = item.trim().split("=");
    if (name !== DEMO_SESSION_COOKIE) continue;
    const value = parts.join("=");
    return isValidDemoSessionId(value) ? value : null;
  }
  return null;
}
