/**
 * Where to go after signing in: a path on this site only. Browsers read "/\evil.com" as
 * "//evil.com", another site, and drop tabs and newlines inside a URL; so anything but a plain
 * same-origin path goes to the dashboard instead.
 */
export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/dashboard";
  const base = "http://m2smart.invalid";
  return new URL(value, base).origin === base ? value : "/dashboard";
}
