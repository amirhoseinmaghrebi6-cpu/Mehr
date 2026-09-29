import type { Locale } from "@/lib/i18n";
import type { GatewayErrorCode } from "@/services/home-gateway";

const messages: Record<GatewayErrorCode, { en: string; fa: string }> = {
  network: { en: "Your connection seems to be down. Check it and try again.", fa: "به نظر می‌رسد اتصال اینترنت قطع است؛ آن را بررسی و دوباره تلاش کنید." },
  timeout: { en: "The server took too long to answer. Please try again.", fa: "پاسخ سرور بیش از حد طول کشید؛ دوباره تلاش کنید." },
  unavailable: { en: "The service isn't available right now. Please try again shortly.", fa: "سرویس الان در دسترس نیست؛ کمی بعد دوباره تلاش کنید." },
  unauthenticated: { en: "Your session has ended. Please sign in again.", fa: "نشست شما تمام شده است؛ دوباره وارد شوید." },
  forbidden: { en: "Your role in this home doesn't allow that.", fa: "نقش شما در این خانه اجازه‌ی این کار را نمی‌دهد." },
  not_found: { en: "That no longer exists. The page will refresh.", fa: "این مورد دیگر وجود ندارد؛ صفحه به‌روز می‌شود." },
  invalid_request: { en: "Some details aren't valid. Check them and try again.", fa: "برخی اطلاعات معتبر نیست؛ بررسی و دوباره تلاش کنید." },
  conflict: { en: "That already exists or a limit was reached.", fa: "این مورد از قبل وجود دارد یا به سقف مجاز رسیده‌اید." },
};

export function gatewayMessage(code: GatewayErrorCode, locale: Locale): string {
  return messages[code][locale];
}
