import type {
  EmailLinkResult,
  LoginFlow,
  LoginInput,
  LoginResult,
  Principal,
  RecoveryFlow,
  RecoveryInput,
  RecoveryResult,
  RegistrationFlow,
  RegistrationInput,
  RegistrationResult,
} from "@/lib/auth/types";

/**
 * The app's only entry point to authentication. Pages, server actions and the layout talk to
 * this interface; provider SDKs live behind it in lib/auth/adapters.
 *
 * Flow-oriented: each journey is `start…` (what the screen may offer, and whether the journey
 * is available at all) followed by one or more `submit…` calls. Multi-step providers such as
 * Kratos (Phase 2D) keep their flow state behind the same calls.
 */
export interface AuthGateway {
  /** The signed-in user for this request, or null. */
  getCurrentPrincipal(): Promise<Principal | null>;

  startLogin(): Promise<LoginFlow>;
  submitLogin(input: LoginInput): Promise<LoginResult>;

  startRegistration(): Promise<RegistrationFlow>;
  submitRegistration(input: RegistrationInput): Promise<RegistrationResult>;

  startRecovery(): Promise<RecoveryFlow>;
  submitRecovery(input: RecoveryInput): Promise<RecoveryResult>;

  /** Completes a sign-in or recovery link sent by email (Supabase `?code=`). */
  completeEmailLink(code: string): Promise<EmailLinkResult>;

  signOut(): Promise<void>;
}
