import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as Dialog from '@radix-ui/react-dialog'
import { MapPin, X } from 'lucide-react'
import { navigationDestination } from '../../features/publicDetails'
import type { Event, OpenMic } from '../../features/publicReads'

class VenueMapLoadError extends Error {}

function loadMap() {
  return lazy(() => import('./PublicVenueMap')
    .then((module) => ({ default: module.PublicVenueMap }))
    .catch((cause: unknown) => { throw new VenueMapLoadError('Venue map assets could not load', { cause }) }))
}

class MapBoundary extends Component<{ children: ReactNode; fallback: (error: Error) => ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error('Venue map could not load', error) }
  render() { return this.state.error ? this.props.fallback(this.state.error) : this.props.children }
}

export function PublicLocation({ location }: { location: Event | OpenMic }) {
  const { t } = useTranslation()
  const [MapView, setMapView] = useState<ReturnType<typeof loadMap> | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(false)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const { precise, address, destination } = navigationDestination(location)
  const google = destination ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving` : null
  const apple = destination ? `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=d` : null
  return <section className="public-location" aria-labelledby="location">
    <h3 id="location" tabIndex={-1}><MapPin size={18} aria-hidden="true" />{t('venueLocation')}</h3>
    <strong>{location.venue_name}</strong>
    <address>{address}</address>
    {precise ? <>
      <p className="field-hint public-location-map-hint">{t('venueMapPrivacy')}</p>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild><button className="quiet-button" type="button" onClick={(event) => {
          setPortalTarget(event.currentTarget.closest<HTMLElement>('.app') ?? document.body)
          if (!MapView) setMapView(() => loadMap())
        }}>{t('showVenueMap')}</button></Dialog.Trigger>
        <Dialog.Portal container={portalTarget}>
          <Dialog.Overlay className="public-map-backdrop" />
          <Dialog.Content className="public-map-dialog">
            <div className="public-map-header">
              <Dialog.Title>{location.venue_name}</Dialog.Title>
              <Dialog.Close asChild><button className="quiet-button icon-button" type="button" aria-label={t('close')}><X size={20} aria-hidden="true" /></button></Dialog.Close>
            </div>
            <Dialog.Description className="public-map-address">{address}</Dialog.Description>
            <p className="field-hint">{t('venueMapZoomHint')}</p>
            <div className="public-map-body">
              {MapView && <MapBoundary key={attempt} fallback={(error) => <p role="alert">{t('venueMapError')} {error instanceof VenueMapLoadError ? <>
                {t('venueMapReloadHint')} <button type="button" onClick={() => window.location.reload()}>{t('venueMapReload')}</button>
              </> : <button type="button" onClick={() => { setMapView(() => loadMap()); setAttempt((value) => value + 1) }}>{t('discoveryRetry')}</button>}</p>}>
                <Suspense fallback={<p role="status">{t('loading')}</p>}><MapView lat={location.lat!} lng={location.lng!} name={location.venue_name} address={address} /></Suspense>
              </MapBoundary>}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </> : <p className="field-hint">{t('venueMapUnavailable')}</p>}
    {destination ? <>
      <p className="field-hint public-location-directions-hint">{t('directionsPrivacy')}{!precise && <> {t('directionsAddressBased')}</>}</p>
      <div className="detail-actions">
        <a className="quiet-button" href={google!} target="_blank" rel="noopener noreferrer">{t('driveGoogleMaps')}</a>
        <a className="quiet-button" href={apple!} target="_blank" rel="noopener noreferrer">{t('driveAppleMaps')}</a>
      </div>
    </> : <p>{t('directionsUnavailable')}</p>}
  </section>
}
