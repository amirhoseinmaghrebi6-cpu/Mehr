/** How the current session was established. */
export type AuthMethod = "sms_code" | "password" | "demo";

/** The signed-in user, as the rest of the app sees them, independent of the auth provider. */
export type Principal = {
  userId: string;
  /** Provider session id when the provider exposes one to the app; otherwise null. */
  sessionId: string | null;
  displayName: string;
  authMethod: AuthMethod;
  /** Who vouches for this session. A LAN hub-issued session will be "hub" later. */
  issuer: "cloud";
};

/** Public credentials of the isolated sample-data demo account. */
export type DemoCredentials = {
  username: string;
  password: string;
};

/** Error codes shown by the auth screens (see errorText in components/auth/auth-screen.tsx). */
export type AuthErrorCode =
  | "setup"
  | "unavailable"
  | "credentials"
  | "demo-credentials"
  | "required"
  | "weak-password"
  | "password-mismatch"
  | "signup-failed"
  | "verification"
  | "reset-session"
  | "update-failed"
  | "phone-invalid"
  | "no-account"
  | "phone-taken"
  | "code-invalid"
  | "code-attempts"
  | "flow-expired"
  | "reauth-required";

export type Failure = { ok: false; error: AuthErrorCode };

/**
 * What a sign-in screen can offer:
 * - "sms_code": phone number, then a one-time code by SMS (Kratos).
 * - "password": phone number + password, for users who added one (Kratos).
 * - "email_password": email + password (Supabase, development only).
 */
export type LoginMethod = "sms_code" | "password" | "email_password";

export type LoginFlow = { available: boolean; methods: LoginMethod[]; demoCredentials: DemoCredentials | null };
export type LoginInput =
  | { method: "password" | "email_password"; identifier: string; password: string }
  | { method: "sms_code"; step: "send"; phone: string }
  | { method: "sms_code"; step: "verify"; flowId: string; code: string };
export type LoginResult = { ok: true; status: "signed_in" } | { ok: true; status: "code_sent"; flowId: string; phone: string } | Failure;

export type RegistrationMethod = "sms_code" | "email_password";
export type RegistrationFlow = { available: boolean; method: RegistrationMethod };
export type RegistrationInput =
  | { method: "email_password"; fullName: string; email: string; password: string }
  | { method: "sms_code"; step: "send"; fullName: string; phone: string }
  | { method: "sms_code"; step: "verify"; flowId: string; code: string };
export type RegistrationResult =
  | { ok: true; status: "signed_in" }
  | { ok: true; status: "verification_sent" }
  | { ok: true; status: "code_sent"; flowId: string; phone: string }
  | Failure;

/**
 * - "email_link": a reset link by email, then a new password (Supabase).
 * - "sms_code_login": sign in with an SMS code, then set a new password (Kratos; decision D1).
 */
export type RecoveryMethod = "email_link" | "sms_code_login";
export type RecoveryFlow = { available: boolean; method: RecoveryMethod };
export type RecoveryInput = { step: "request"; email: string } | { step: "set_password"; password: string };
export type RecoveryResult = { ok: true } | Failure;

export type EmailLinkResult = { ok: true } | Failure;
