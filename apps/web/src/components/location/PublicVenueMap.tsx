import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import 'leaflet/dist/leaflet.css'

const icon = L.icon({ iconUrl: markerIcon, shadowUrl: markerShadow, iconSize: [25, 41], iconAnchor: [12, 41] })

function MapSizeSync() {
  const map = useMap()
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map])
  return null
}

export function PublicVenueMap({ lat, lng, name, address }: { lat: number; lng: number; name: string; address: string }) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  return <>
    {failed && <p role="alert">{t('venueMapError')} <button type="button" onClick={() => { setFailed(false); setAttempt((value) => value + 1) }}>{t('discoveryRetry')}</button></p>}
    <MapContainer key={attempt} className="public-venue-map" center={[lat, lng]} zoom={16} scrollWheelZoom>
      <MapSizeSync />
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution={`&copy; <a href="https://www.openstreetmap.org/copyright">${t('mapAttribution')}</a> ${t('mapContributors')}`}
        eventHandlers={{ tileerror: () => setFailed(true) }} />
      <Marker position={[lat, lng]} icon={icon}><Popup>{name}<br />{address}</Popup></Marker>
    </MapContainer>
  </>
}
