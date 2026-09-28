const localOrigin = "https://m2smart.invalid";

export function safeRedirectPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;

  try {
    const destination = new URL(value, localOrigin);
    if (destination.origin !== localOrigin) return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}