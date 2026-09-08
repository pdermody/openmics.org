import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import 'leaflet/dist/leaflet.css'
import { CircleAlert, X } from 'lucide-react'
import { useGeocoding, type GeocodeCandidate } from '../../features/location'
import './LocationPicker.css'

// react-leaflet ships without the default marker image URLs wired up for bundlers; point them
// at the bundled assets once for the whole app.
const markerIconDefault = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const DEFAULT_CENTER: [number, number] = [53.349805, -6.26031] // Dublin, used only when no coordinates are set yet
const DEFAULT_ZOOM = 6
const PIN_ZOOM = 15

export type LocationPickerProps = {
  /** Current latitude, if set. */
  lat: number | undefined
  /** Current longitude, if set. */
  lng: number | undefined
  /** Called whenever the marker is dragged, a search candidate is chosen, or a coordinate input changes. */
  onChange: (coords: { lat: number | undefined; lng: number | undefined }) => void
  /** Free-text address used to drive the "find on map" lookup (e.g. combined address line/city/country). */
  addressQuery: string
  /** Disables all interaction, e.g. while the parent form is submitting. */
  disabled?: boolean
  /** Ids for the always-present, keyboard-accessible numeric lat/lng inputs (for label association). */
  latInputId?: string
  lngInputId?: string
}

function MapClickAndDrag({ onSelect }: { onSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event) {
      onSelect(event.latlng.lat, event.latlng.lng)
    },
  })
  return null
}

/**
 * Reusable venue-location picker: a Leaflet/OpenStreetMap map with a draggable marker, an
 * address search box backed by the server-side geocoding proxy, and always-present numeric
 * lat/lng inputs so the picker remains fully usable via keyboard or when geocoding assist is
 * unavailable. Intended to be embedded in any form (via React Hook Form's `Controller`) that
 * collects a venue location — OpenMic and Event forms today, future forms later.
 */
export function LocationPicker({ lat, lng, onChange, addressQuery, disabled, latInputId, lngInputId }: LocationPickerProps) {
  const geocoding = useGeocoding()
  const [query, setQuery] = useState(addressQuery)
  const [showCandidates, setShowCandidates] = useState(false)
  const mapRef = useRef<L.Map | null>(null)
  const searchContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setQuery(addressQuery)
    if (addressQuery.trim().length >= 3) {
      setShowCandidates(true)
      geocoding.search(addressQuery)
    }
    // geocoding.search is stable in behavior but not identity across renders; only
    // addressQuery changing should re-trigger a (debounced) lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressQuery])

  // Close the suggestions dropdown on an outside click, so it never has to be dismissed by
  // picking an address — clicking the map, another field, or anywhere else closes it too.
  useEffect(() => {
    if (!showCandidates) return
    function handlePointerDown(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowCandidates(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [showCandidates])

  const position = useMemo<[number, number] | null>(() => (
    typeof lat === 'number' && typeof lng === 'number' && !Number.isNaN(lat) && !Number.isNaN(lng) ? [lat, lng] : null
  ), [lat, lng])

  useEffect(() => {
    if (position && mapRef.current) mapRef.current.setView(position, Math.max(mapRef.current.getZoom(), PIN_ZOOM))
  }, [position])

  function selectCandidate(candidate: GeocodeCandidate) {
    onChange({ lat: candidate.lat, lng: candidate.lng })
    setShowCandidates(false)
    geocoding.clearCandidates()
  }

  function handleSearch() {
    setShowCandidates(true)
    geocoding.search(query)
  }

  function dismissCandidates() {
    setShowCandidates(false)
    geocoding.clearCandidates()
  }

  return <div className="location-picker">
    {!geocoding.assistDisabled && <div className="location-picker-search" ref={searchContainerRef}>
      <label className="sr-only" htmlFor="location-picker-query">Search for the venue address</label>
      <input
        id="location-picker-query"
        type="text"
        value={query}
        placeholder="Search for an address to find it on the map"
        disabled={disabled}
        role="combobox"
        aria-expanded={showCandidates && geocoding.candidates.length > 0}
        aria-controls="location-picker-candidates"
        onChange={(event) => {
          const value = event.target.value
          setQuery(value)
          setShowCandidates(true)
          geocoding.search(value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); handleSearch() }
          if (event.key === 'Escape' && showCandidates) { event.preventDefault(); dismissCandidates() }
        }}
      />
      <button type="button" className="quiet-button" disabled={disabled || geocoding.searching} onClick={handleSearch}>
        {geocoding.searching ? 'Searching…' : 'Find on map'}
      </button>
      {showCandidates && geocoding.candidates.length > 0 && <div className="location-picker-candidates" id="location-picker-candidates">
        <div className="location-picker-candidates-header">
          <span className="field-hint">Suggestions</span>
          <button type="button" className="location-picker-dismiss" aria-label="Close suggestions" onClick={dismissCandidates}>
            <X aria-hidden="true" size={14} />
          </button>
        </div>
        <ul>
          {geocoding.candidates.map((candidate, index) => (
            <li key={`${candidate.lat}-${candidate.lng}-${index}`}>
              <button type="button" onClick={() => selectCandidate(candidate)}>{candidate.label}</button>
            </li>
          ))}
        </ul>
      </div>}
      {showCandidates && !geocoding.searching && geocoding.candidates.length === 0 && (
        <p className="field-hint">No matches found. Try a more specific address, or set the pin manually below.</p>
      )}
    </div>}

    {geocoding.assistDisabled && <p className="location-picker-notice" role="status">
      <CircleAlert aria-hidden="true" size={16} />
      Automatic address lookup is temporarily unavailable. Drag the pin or enter coordinates manually below.
    </p>}

    <div className="location-picker-map" aria-hidden={disabled ? true : undefined}>
      <MapContainer
        center={position ?? DEFAULT_CENTER}
        zoom={position ? PIN_ZOOM : DEFAULT_ZOOM}
        scrollWheelZoom={false}
        ref={mapRef}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {!disabled && <MapClickAndDrag onSelect={(nextLat, nextLng) => onChange({ lat: nextLat, lng: nextLng })} />}
        {position && <Marker
          position={position}
          icon={markerIconDefault}
          draggable={!disabled}
          eventHandlers={{
            dragend: (event) => {
              const marker = event.target as L.Marker
              const { lat: draggedLat, lng: draggedLng } = marker.getLatLng()
              onChange({ lat: draggedLat, lng: draggedLng })
            },
          }}
        />}
      </MapContainer>
    </div>

    <div className="location-picker-coords">
      <label htmlFor={latInputId}>Latitude <span className="field-hint">Click the map, or drag the pin</span>
        <input
          id={latInputId}
          type="number"
          step="any"
          min={-90}
          max={90}
          disabled={disabled}
          value={lat ?? ''}
          onChange={(event) => onChange({ lat: event.target.value === '' ? undefined : Number(event.target.value), lng })}
        />
      </label>
      <label htmlFor={lngInputId}>Longitude
        <input
          id={lngInputId}
          type="number"
          step="any"
          min={-180}
          max={180}
          disabled={disabled}
          value={lng ?? ''}
          onChange={(event) => onChange({ lat, lng: event.target.value === '' ? undefined : Number(event.target.value) })}
        />
      </label>
    </div>
  </div>
}
