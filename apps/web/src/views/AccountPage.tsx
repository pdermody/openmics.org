import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { LocateFixed, MapPin } from 'lucide-react'
import { Select } from '../components/radix-select'
import { changeLanguage } from '../i18n'
import { useAccountContext } from '../features/account'
import { useCity } from '../features/cities'
import { CityAutocomplete } from '../components/location/CityAutocomplete'
import { useBrowserLocation } from '../hooks/geolocation'
import type { ColorMode, ThemeId } from '../theme'
import { Modal, ReadState, SiteHeader } from './shared'

const accountFormSchema = z.object({
  display_name: z.string().trim(),
  city: z.string().trim(),
  city_id: z.string().nullable(),
  preferred_language: z.string(),
})

export function AccountPage({ theme, mode }: { theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const context = useAccountContext()
  const browserLocation = useBrowserLocation()
  const { watch, setValue, handleSubmit } = useForm<z.infer<typeof accountFormSchema>>({
    resolver: zodResolver(accountFormSchema),
    values: {
      display_name: context.account.data?.display_name ?? '',
      city: context.account.data?.city ?? '',
      city_id: context.account.data?.city_id ?? null,
      preferred_language: context.account.data?.preferred_language === 'es' ? 'es' : 'en',
    },
  })
  const form = watch()
  const selectedCity = useCity(form.city_id)
  const [savedModalOpen, setSavedModalOpen] = useState(false)

  if (!context.account.data) return <main className="app" data-theme={theme} data-mode={mode}><SiteHeader /><ReadState message={t('signInDashboard')} /></main>

  const hasChanges = form.display_name !== (context.account.data.display_name ?? '')
    || form.city !== (context.account.data.city ?? '')
    || form.city_id !== (context.account.data.city_id ?? null)
    || form.preferred_language !== (context.account.data.preferred_language === 'es' ? 'es' : 'en')

  async function submit() {
    const payload = {
      display_name: form.display_name.trim() || undefined,
      city: form.city.trim() || null,
      city_id: form.city_id,
      preferred_language: form.preferred_language,
    }

    await context.updateAccount.mutateAsync(payload)
    if (form.preferred_language === 'en' || form.preferred_language === 'es') {
      await changeLanguage(form.preferred_language)
    }
    setSavedModalOpen(true)
  }

  const isLocationEnabled = browserLocation.permissionState === 'granted'
  const isLocationBlocked = browserLocation.permissionState === 'denied'
  const isLocationUnsupported = browserLocation.permissionState === 'unsupported'
  const locationStatusLabel = isLocationEnabled ? t('browserLocationEnabled') : isLocationBlocked ? t('browserLocationBlocked') : isLocationUnsupported ? t('browserLocationUnsupported') : t('browserLocationDisabled')

  return <main className="app" data-theme={theme} data-mode={mode}>
    <SiteHeader />
    <section className="dashboard-page">
      <Link className="back-link" to="/">{t('backToDiscovery')}</Link>
      <div className="eyebrow">{t('account')}</div>
      <h1>{t('accountDetails')}</h1>
      <p className="detail-lede">{t('accountInfoIntro')}</p>

      <form className="account-page-form" onSubmit={handleSubmit(submit)}>
        <label className="account-field">
          <div className="field-header">
            <span>{t('email')}</span>
            <span className="read-only-badge">{t('readOnly')}</span>
          </div>
          <input value={context.account.data.email} disabled readOnly className="read-only-input" />
        </label>

        <label className="account-field">
          <span>{t('displayName')}</span>
          <input value={form.display_name} onChange={(event) => setValue('display_name', event.target.value, { shouldDirty: true })} />
        </label>

        <div className="account-field">
          <CityAutocomplete id="account-city-input" value={form.city} selectedCity={selectedCity.data} onChange={(value, city) => {
            setValue('city', value, { shouldDirty: true })
            setValue('city_id', city?.id ?? null, { shouldDirty: true })
          }} />
          <p className="field-hint">{t('accountCityHint')}</p>
        </div>

        <div className="account-field">
          <div className="field-header">
            <span>{t('language')}</span>
          </div>
          <Select
            value={form.preferred_language}
            onValueChange={(value) => setValue('preferred_language', value, { shouldDirty: true })}
            ariaLabel={t('language')}
            placeholder={t('language')}
            options={[
              { value: 'en', label: t('english') },
              { value: 'es', label: t('spanish') },
            ]}
          />
        </div>

        <div className="location-panel">
          <div className="location-panel-header">
            <span className="location-panel-title"><MapPin size={14} />{t('browserLocation')}</span>
            <span className={`location-status ${isLocationEnabled ? 'enabled' : 'disabled'}`}>
              {locationStatusLabel}
            </span>
          </div>
          <p className="field-hint">{t('accountLocationAccuracy')}</p>
          {(isLocationBlocked || isLocationUnsupported) && (
            <p className="form-error" role="alert">{isLocationBlocked ? t('browserLocationBlockedHint') : t('browserLocationUnsupportedHint')}</p>
          )}
          {!isLocationEnabled && !isLocationBlocked && !isLocationUnsupported && (
            <button type="button" className="quiet-button location-button" onClick={browserLocation.requestLocation}>
              <LocateFixed size={16} />
              {t('enableBrowserLocation')}
            </button>
          )}
        </div>

        <button className="primary-button" type="submit" disabled={context.updateAccount.isPending || !hasChanges}>
          {context.updateAccount.isPending ? t('saving') : t('saveChanges')}
        </button>
      </form>

      {context.updateAccount.isError && <p className="form-error" role="alert">{t('profileSaveError')}</p>}
    </section>

    {savedModalOpen && <Modal title={t('accountDetails')} onClose={() => setSavedModalOpen(false)}>
      <p>{t('profileSaved')}</p>
    </Modal>}
  </main>
}
