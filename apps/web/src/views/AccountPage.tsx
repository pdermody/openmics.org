import { useEffect, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { LocateFixed, MapPin } from 'lucide-react'
import { Select } from '../components/radix-select'
import { changeLanguage } from '../i18n'
import { useAccountContext } from '../features/account'
import { useBrowserLocation } from '../hooks/geolocation'
import type { ColorMode, ThemeId } from '../theme'
import { Modal, ReadState, SiteHeader } from './shared'

export function AccountPage({ theme, mode }: { theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const context = useAccountContext()
  const browserLocation = useBrowserLocation()
  const [form, setForm] = useState({
    display_name: '',
    city: '',
    preferred_language: 'en',
  })
  const [savedModalOpen, setSavedModalOpen] = useState(false)

  useEffect(() => {
    if (!context.account.data) return
    setForm({
      display_name: context.account.data.display_name ?? '',
      city: context.account.data.city ?? '',
      preferred_language: context.account.data.preferred_language === 'es' ? 'es' : 'en',
    })
  }, [context.account.data?.display_name, context.account.data?.city, context.account.data?.preferred_language, context.account.data?.id])

  if (!context.account.data) return <main className="app" data-theme={theme} data-mode={mode}><SiteHeader /><ReadState message={t('signInDashboard')} /></main>

  const hasChanges = form.display_name !== (context.account.data.display_name ?? '')
    || form.city !== (context.account.data.city ?? '')
    || form.preferred_language !== (context.account.data.preferred_language === 'es' ? 'es' : 'en')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = {
      display_name: form.display_name.trim() || null,
      city: form.city.trim() || null,
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

      <form className="account-page-form" onSubmit={handleSubmit}>
        <label className="account-field">
          <div className="field-header">
            <span>{t('email')}</span>
            <span className="read-only-badge">{t('readOnly')}</span>
          </div>
          <input value={context.account.data.email} disabled readOnly className="read-only-input" />
        </label>

        <label className="account-field">
          <span>{t('displayName')}</span>
          <input value={form.display_name} onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))} />
        </label>

        <div className="account-field">
          <label className="field-stack" htmlFor="account-city-input">
            <span>{t('city')}</span>
          </label>
          <input id="account-city-input" value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} />
          <p className="field-hint">{t('accountCityHint')}</p>
        </div>

        <div className="account-field">
          <div className="field-header">
            <span>{t('language')}</span>
          </div>
          <Select
            value={form.preferred_language}
            onValueChange={(value) => setForm((current) => ({ ...current, preferred_language: value }))}
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
