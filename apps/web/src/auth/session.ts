const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID
const userPoolClientId = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID
const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN

export const isAuthConfigured = Boolean(userPoolId && userPoolClientId)
let configured = false

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

export async function getAccessToken(): Promise<string | undefined> {
  if (!isAuthConfigured) return undefined
  const { fetchAuthSession } = await authModules()
  const session = await fetchAuthSession()
  return session.tokens?.accessToken?.toString()
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

export async function endSession(): Promise<void> {
  if (isAuthConfigured) {
    const { signOut } = await authModules()
    await signOut()
  }
}
