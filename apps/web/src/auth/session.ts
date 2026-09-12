const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID
const userPoolClientId = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID
const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN
const localAuthToken = import.meta.env.VITE_LOCAL_AUTH_TOKEN

export const LOCAL_SIMULATED_ROLE_KEY = 'openmic-simulated-auth-token'
const SIGN_IN_ERROR_KEY = 'openmic-sign-in-error'
export type SimulatedAuthRole = {
  id: string
  label: string
  kind: 'organizer' | 'performer'
  accountId: string
  profileId: string
  profileName: string
  accountDisplayName: string
  token: string
}

export const isAuthConfigured = Boolean(userPoolId && userPoolClientId)
let configured = false

export function getStoredSimulatedAuthToken(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const storedValue = window.localStorage.getItem(LOCAL_SIMULATED_ROLE_KEY)
  return storedValue || undefined
}

/** Reads and clears the last hosted-UI sign-in failure reason (set by the Hub listener in `initAuth`). */
export function consumeSignInError(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const message = window.sessionStorage.getItem(SIGN_IN_ERROR_KEY)
  if (message) window.sessionStorage.removeItem(SIGN_IN_ERROR_KEY)
  return message ?? undefined
}

export async function fetchSimulatedAuthConfig(): Promise<{ enabled: boolean; roles: SimulatedAuthRole[] }> {
  try {
    const response = await fetch('/api/dev/simulated-auth/config')
    if (!response.ok) return { enabled: false, roles: [] }
    return (await response.json()) as { enabled: boolean; roles: SimulatedAuthRole[] }
  } catch {
    return { enabled: false, roles: [] }
  }
}

async function authModules() {
  const [{ Amplify }, auth] = await Promise.all([
    import('aws-amplify'),
    import('aws-amplify/auth'),
  ])
  if (!configured && isAuthConfigured) {
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId,
          userPoolClientId,
          loginWith: cognitoDomain ? {
            oauth: {
              domain: cognitoDomain,
              scopes: ['openid', 'email', 'profile'],
              redirectSignIn: [window.location.origin],
              redirectSignOut: [window.location.origin],
              responseType: 'code',
            },
          } : undefined,
        },
      },
    })
    configured = true
  }
  return auth
}

export type AuthEventHandlers = {
  /** Fired after a successful hosted-UI sign-in (or session restore); typically re-fetch account data. */
  onSignedIn?: () => void
  /** Fired after sign-out (manual, or an unrecoverable sign-in failure); typically clear cached account data. */
  onSignedOut?: () => void
}

/**
 * Configures Amplify eagerly (rather than waiting for the first `getAccessToken` call) so the
 * hosted-UI OAuth redirect callback is parsed and exchanged for tokens as soon as the app loads,
 * and wires Hub listeners so callers (see main.tsx) can react to sign-in/out by invalidating or
 * clearing cached account data. A `signInWithRedirect_failure` is treated as a sign-out: its
 * message is stashed for `consumeSignInError` to surface near the sign-in control, and any stale
 * cached account data is cleared rather than left showing a previous session's state. No-ops
 * entirely when Cognito isn't configured (local simulated-auth dev).
 */
export async function initAuth(handlers: AuthEventHandlers = {}): Promise<void> {
  if (!isAuthConfigured) return
  await authModules()
  const { Hub } = await import('aws-amplify/utils')
  Hub.listen('auth', ({ payload }) => {
    switch (payload.event) {
      case 'signedIn':
        handlers.onSignedIn?.()
        break
      case 'signedOut':
        handlers.onSignedOut?.()
        break
      case 'signInWithRedirect_failure': {
        const message = payload.data instanceof Error ? payload.data.message : 'Sign-in failed. Please try again.'
        if (typeof window !== 'undefined') window.sessionStorage.setItem(SIGN_IN_ERROR_KEY, message)
        handlers.onSignedOut?.()
        break
      }
    }
  })
}

export async function getAccessToken(): Promise<string | undefined> {
  const simulatedAuthToken = getStoredSimulatedAuthToken()
  if (simulatedAuthToken) return simulatedAuthToken
  if (localAuthToken) return localAuthToken
  if (!isAuthConfigured) return undefined
  const { fetchAuthSession } = await authModules()
  const session = await fetchAuthSession()
  // The API verifies the Cognito ID token, not the access token: only the ID token carries the
  // verified `email` claim account provisioning relies on (see apps/api/src/auth/cognito-verifier.ts
  // and docs/5-open-mic-frontend-architecture.md). `fetchAuthSession` transparently refreshes
  // expired tokens using the stored refresh token before returning them.
  return session.tokens?.idToken?.toString()
}

/**
 * Forces a fresh ID token, for the API client's single 401-retry (see api/client.ts). Simulated
 * and local-dev tokens are static: there is nothing to refresh, so this returns `undefined` and
 * the client correctly treats that as "refresh unavailable" rather than replaying the request
 * with the same still-invalid token.
 */
export async function refreshAccessToken(): Promise<string | undefined> {
  if (getStoredSimulatedAuthToken() || localAuthToken || !isAuthConfigured) return undefined
  const { fetchAuthSession } = await authModules()
  try {
    const session = await fetchAuthSession({ forceRefresh: true })
    return session.tokens?.idToken?.toString()
  } catch {
    return undefined
  }
}

export async function getAuthenticatedUser() {
  if (!isAuthConfigured) return null
  try {
    const { getCurrentUser } = await authModules()
    return await getCurrentUser()
  } catch {
    return null
  }
}

export async function beginSignIn(): Promise<void> {
  if (!isAuthConfigured) throw new Error('Sign-in is not configured in this local environment yet.')
  const { signInWithRedirect } = await authModules()
  await signInWithRedirect()
}

export async function signInWithPassword(username: string, password: string) {
  if (!isAuthConfigured) throw new Error('Sign-in is not configured in this local environment yet.')
  const { signIn } = await authModules()
  return signIn({ username, password })
}

export async function signUpWithPassword(username: string, password: string) {
  if (!isAuthConfigured) throw new Error('Sign-up is not configured in this local environment yet.')
  const { signUp } = await authModules()
  return signUp({ username, password, options: { userAttributes: { email: username } } })
}

export async function confirmSignUpCode(username: string, confirmationCode: string) {
  const { confirmSignUp } = await authModules()
  return confirmSignUp({ username, confirmationCode })
}

export async function requestPasswordReset(username: string) {
  const { resetPassword } = await authModules()
  return resetPassword({ username })
}

export async function confirmPasswordReset(username: string, confirmationCode: string, newPassword: string) {
  const { confirmResetPassword } = await authModules()
  return confirmResetPassword({ username, confirmationCode, newPassword })
}

export async function changePassword(oldPassword: string, newPassword: string) {
  const { updatePassword } = await authModules()
  return updatePassword({ oldPassword, newPassword })
}

export async function endSession(): Promise<void> {
  if (typeof window !== 'undefined') window.localStorage.removeItem(LOCAL_SIMULATED_ROLE_KEY)
  if (isAuthConfigured) {
    const { signOut } = await authModules()
    await signOut()
  }
}

