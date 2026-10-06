import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { friendlyApiErrorMessage } from '../../api/client'
import type { City } from '../../features/cities'
import { useDiscovery } from '../../features/discovery'
import { CityAutocomplete } from './CityAutocomplete'
import './DiscoveryControls.css'

export function DiscoveryControls({ discovery }: { discovery: ReturnType<typeof useDiscovery> }) {
  const { t, i18n } = useTranslation()
  const [cityText, setCityText] = useState('')
  const [selectedCity, setSelectedCity] = useState<City | null>(null)
  const [choosingCity, setChoosingCity] = useState(false)
  const { near, label, suggestions, browser } = discovery
  const format = (value: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 }).format(value)
  const locationLabel = label || t('discoveryYourLocation')
  const canRequest = browser.permissionState === 'prompt' || browser.permissionState === 'unknown'
  const expansion = suggestions.data?.expansion

  return <section className="discovery-controls" aria-label={t('discoverySearchArea')}>
    <p className="discovery-area" role="status">
      {near ? t('discoveryArea', { place: locationLabel, distance: format(near.radiusKm) }) : t('discoveryGeneral')}
      {discovery.approximate && <span> {t('discoveryApproximate')}</span>}
    </p>
    <div className="discovery-actions">
      {expansion && <button type="button" className="quiet-button" onClick={() => discovery.expand(expansion.radius_km)}>
        {t(expansion.additional_count < 20 ? 'discoveryExpandFew' : 'discoveryExpand', {
          distance: format(expansion.radius_km), count: expansion.additional_count,
        })}
      </button>}
      <button type="button" className="quiet-button" onClick={() => setChoosingCity((open) => !open)} aria-expanded={choosingCity} aria-controls="discovery-city-picker">
        {t('discoveryChooseCity')}
      </button>
      {discovery.manual && <button type="button" className="quiet-button" onClick={discovery.nearMe}>{t('discoveryNearMe')}</button>}
      {canRequest && <button type="button" className="quiet-button" onClick={() => { discovery.nearMe(); browser.requestLocation() }}>{t('useMyLocation')}</button>}
    </div>
    {!near && browser.permissionState === 'denied' && <p className="field-hint">{t('discoveryLocationDenied')}</p>}
    {!near && browser.permissionState === 'unsupported' && <p className="field-hint">{t('discoveryLocationUnsupported')}</p>}
    {choosingCity && <div id="discovery-city-picker">
      <CityAutocomplete
        id="discovery-city"
        label={t('discoveryChooseCity')}
        value={cityText}
        selectedCity={selectedCity}
        allowFreeText={false}
        onChange={(value, city) => {
          setCityText(value)
          setSelectedCity(city)
          if (city) { discovery.chooseCity(city); setChoosingCity(false) }
        }}
      />
    </div>}
    {suggestions.isError && <div role="alert">
      <p>{friendlyApiErrorMessage(suggestions.error, t('discoverySuggestionsError'))}</p>
      <button type="button" className="quiet-button" onClick={() => void suggestions.refetch()}>{t('discoveryRetry')}</button>
    </div>}
    {suggestions.data && suggestions.data.cities.length > 0 && <div>
      <h2 className="discovery-cities-heading">{t('discoveryCities')}</h2>
      <ul className="discovery-cities">
        {suggestions.data.cities.map((city) => <li key={city.id}>
          <button type="button" className="quiet-button" onClick={() => discovery.chooseCity(city, city.approximate)}>
            <strong>{[city.city, city.admin_name, city.country].filter(Boolean).join(', ')}</strong>
            <span>{t('discoveryCitySummary', { distance: format(city.distance_km), count: city.open_mic_count })}{city.approximate && ` ${t('discoveryApproximate')}`}</span>
          </button>
        </li>)}
      </ul>
    </div>}
  </section>
}
