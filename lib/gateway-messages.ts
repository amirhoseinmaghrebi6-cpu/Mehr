import { messages, type Locale } from "@/lib/i18n";
import type { GatewayErrorCode } from "@/services/home-gateway";

export function gatewayMessage(code: GatewayErrorCode, locale: Locale): string {
  return messages[locale].errors[code];
}
