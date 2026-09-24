import { useEffect, useState } from 'react'

export type GeolocationPermissionState = 'unknown' | 'granted' | 'denied' | 'prompt' | 'unsupported'
export type GeolocationCoords = { lat: number; lng: number }

// Shared by AccountPage (opt-in toggle) and HomePage ("near me" results): tracks the browser's
// geolocation permission state and exposes an explicit `requestLocation` action so callers never
// trigger the native permission prompt without a user gesture.
export function useBrowserLocation() {
  const [permissionState, setPermissionState] = useState<GeolocationPermissionState>('unknown')
  const [coords, setCoords] = useState<GeolocationCoords | undefined>(undefined)

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setPermissionState('unsupported')
      return
    }

    const permissionApi = navigator.permissions as { query?: (descriptor: { name: 'geolocation' }) => Promise<{ state: PermissionState; addEventListener?: (type: 'change', callback: () => void) => void }> }
    if (!permissionApi?.query) {
      setPermissionState('prompt')
      return
    }

    let isMounted = true
    void permissionApi.query({ name: 'geolocation' }).then((permission) => {
      if (!isMounted) return
      setPermissionState(permission.state)
      permission.addEventListener?.('change', () => setPermissionState(permission.state))
    }).catch(() => {
      if (isMounted) setPermissionState('prompt')
    })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (permissionState === 'denied') {
      setCoords(undefined)
      return
    }
    // Permission was already granted before this page mounted (e.g. granted on a previous
    // visit): fetch coordinates silently since the browser won't show a prompt for it.
    if (permissionState !== 'granted' || coords) return
    navigator.geolocation.getCurrentPosition(
      (position) => setCoords({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => setPermissionState('denied'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [permissionState, coords])

  function requestLocation() {
    if (!('geolocation' in navigator)) {
      setPermissionState('unsupported')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude })
        setPermissionState('granted')
      },
      () => setPermissionState('denied'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return { permissionState, coords, requestLocation }
}
