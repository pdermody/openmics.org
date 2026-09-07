import { Amplify } from 'aws-amplify'
import { fetchAuthSession, getCurrentUser, signInWithRedirect, signOut } from 'aws-amplify/auth'

const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID
const userPoolClientId = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID
const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN

export const isAuthConfigured = Boolean(userPoolId && userPoolClientId)

if (isAuthConfigured) {
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
}

export async function getAccessToken(): Promise<string | undefined> {
  if (!isAuthConfigured) return undefined
  const session = await fetchAuthSession()
  return session.tokens?.accessToken?.toString()
}

export async function getAuthenticatedUser() {
  if (!isAuthConfigured) return null
  try {
    return await getCurrentUser()
  } catch {
    return null
  }
}

export async function beginSignIn(): Promise<void> {
  if (!isAuthConfigured) throw new Error('Sign-in is not configured in this local environment yet.')
  await signInWithRedirect()
}

export async function endSession(): Promise<void> {
  if (isAuthConfigured) await signOut()
}
