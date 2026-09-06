export type AuthenticatedAccount = {
  accountId: string;
  isPlatformAdmin: boolean;
};

// Resolves a bearer token to an authenticated account. Production and test
// implementations are injected; automated tests never call AWS.
export type AuthVerifier = (token: string) => Promise<AuthenticatedAccount | null>;
