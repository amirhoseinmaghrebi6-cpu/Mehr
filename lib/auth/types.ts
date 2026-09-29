/** How the current session was established. `sms_code` arrives with the Kratos adapter (Phase 2D/2E). */
export type AuthMethod = "password" | "demo";

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
  | "credentials"
  | "demo-credentials"
  | "required"
  | "weak-password"
  | "password-mismatch"
  | "signup-failed"
  | "verification"
  | "reset-session"
  | "update-failed";

export type Failure = { ok: false; error: AuthErrorCode };

export type LoginFlow = { available: boolean; demoCredentials: DemoCredentials | null };
export type LoginInput = { identifier: string; password: string };
export type LoginResult = { ok: true } | Failure;

export type RegistrationFlow = { available: boolean };
export type RegistrationInput = { fullName: string; email: string; password: string };
export type RegistrationResult = { ok: true; status: "signed_in" } | { ok: true; status: "verification_sent" } | Failure;

export type RecoveryFlow = { available: boolean };
export type RecoveryInput = { step: "request"; email: string } | { step: "set_password"; password: string };
export type RecoveryResult = { ok: true } | Failure;

export type EmailLinkResult = { ok: true } | Failure;
