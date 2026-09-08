import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { isValidHandleFormat } from './slugify'

export type HandleCheckState = 'idle' | 'checking' | 'available' | 'unavailable' | 'invalid'

const REASON_MESSAGES: Record<string, string> = {
  in_use: 'That handle is already in use.',
  reserved: 'That handle is reserved.',
  redirect: 'That handle currently redirects to something else.',
  quarantined: 'That handle was recently released and is temporarily on hold.',
  tombstoned: 'That handle is no longer available.',
}

const INVALID_FORMAT_MESSAGE = 'Handles must be 3-50 characters, start and end with a letter or number, and can only contain letters, numbers, and hyphens.'

/** Debounced GET /handles/check/:candidate, so the form can show live feedback as the handle is edited. */
export function useHandleAvailability(candidate: string, enabled: boolean) {
  const [state, setState] = useState<HandleCheckState>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!enabled || !candidate) {
      setState('idle')
      setMessage('')
      return
    }
    if (!isValidHandleFormat(candidate)) {
      setState('invalid')
      setMessage(INVALID_FORMAT_MESSAGE)
      return
    }
    setState('checking')
    setMessage('')
    const timeout = setTimeout(() => {
      void api<{ available: boolean; reason?: string }>(`/handles/check/${encodeURIComponent(candidate)}`)
        .then((result) => {
          if (result.available) {
            setState('available')
            setMessage('This handle is available.')
          } else {
            setState('unavailable')
            setMessage(REASON_MESSAGES[result.reason ?? ''] ?? 'That handle is not available.')
          }
        })
        .catch(() => {
          setState('idle')
          setMessage('')
        })
    }, 400)
    return () => clearTimeout(timeout)
  }, [candidate, enabled])

  return { state, message }
}
