import { useId, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client'
import { useCitySearch, type City } from '../../features/cities'
import './CityAutocomplete.css'

export type { CityAutocompleteValue } from '../../features/cities'
export type CityAutocompleteProps = {
  value: string
  selectedCity?: City | null
  onChange: (value: string, city: City | null) => void
  id?: string
  name?: string
  label?: string
  disabled?: boolean
  required?: boolean
  allowFreeText?: boolean
  onBlur?: () => void
}

export function CityAutocomplete({ value = '', selectedCity, onChange, id, name, label, disabled, required, allowFreeText = true, onBlur }: CityAutocompleteProps) {
  const { t } = useTranslation()
  const generatedId = useId()
  const inputId = id ?? `city-${generatedId}`
  const listId = `${inputId}-options`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const local = useCitySearch(value, open && !selectedCity && !disabled)
  const query = value.trim()
  const searching = local.isFetching
  const items = !selectedCity && query.length >= 2 ? local.data?.items ?? [] : []
  const expanded = open && !disabled && items.length > 0
  const activeIndex = active >= items.length ? -1 : active
  const error = local.error
  const errorKey = error instanceof ApiError && error.code === 'CITY_CATALOGUE_IMPORT_REQUIRED' ? 'cityPickerImportRequired'
    : error instanceof ApiError && error.status === 400 ? 'cityPickerInvalidQuery'
      : 'cityPickerUnavailable'

  function select(city: City) {
    onChange(city.city, city)
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      if (items.length) setActive(event.key === 'ArrowDown'
        ? (activeIndex + 1) % items.length
        : (activeIndex <= 0 ? items.length - 1 : activeIndex - 1))
    } else if (event.key === 'Enter' && expanded && activeIndex >= 0) {
      event.preventDefault()
      select(items[activeIndex])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      setActive(-1)
    }
  }

  return <div className="city-picker">
    <label htmlFor={inputId}><span>{label ?? t('city')}{required && <span className="required-mark" aria-hidden="true">{'\u00a0*'}</span>}</span></label>
    <div className="city-picker-input">
      <input id={inputId} name={name} role="combobox" autoComplete="off"
        aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId}
        aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-describedby={`${inputId}-hint`}
        aria-invalid={!allowFreeText && Boolean(query) && !selectedCity ? true : undefined}
        required={required} disabled={disabled} value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); onBlur?.() }}
        onChange={(event) => {
          onChange(event.target.value, null)
          setActive(-1)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />
      {value && <button type="button" className="quiet-button" disabled={disabled} aria-label={t('cityPickerClear')}
        onClick={() => { onChange('', null); setActive(-1); setOpen(false) }}>{t('cityPickerClear')}</button>}
    </div>
    {selectedCity && <p className="field-hint">{[selectedCity.admin_name, selectedCity.country].filter(Boolean).join(', ')}</p>}
    {selectedCity?.retired && <p role="status" className="field-hint">{t('cityPickerRetired')}</p>}
    {expanded && <ul id={listId} role="listbox" className="city-picker-options" aria-label={t('cityPickerSuggestions')}>
      {items.map((city, index) => <li key={city.id} id={`${listId}-${index}`} role="option" aria-selected={activeIndex === index}
        className={activeIndex === index ? 'city-picker-active' : undefined}
        onMouseDown={(event) => event.preventDefault()} onClick={() => select(city)}>
        <strong>{city.city}</strong><span>{[city.admin_name, city.country].filter(Boolean).join(', ')}</span>
      </li>)}
    </ul>}
    <p id={`${inputId}-hint`} className="field-hint">{!allowFreeText ? t('cityPickerSelectRequired') : t('cityPickerFreeText')}</p>
    {open && searching && <p role="status" className="field-hint">{t('cityPickerSearching')}</p>}
    {open && !searching && query.length >= 2 && !selectedCity && !items.length && !error && <p role="status" className="field-hint">{t('cityPickerNoMatches')}</p>}
    {open && error && <p role="alert" className="form-error">{t(errorKey)}</p>}
  </div>
}
