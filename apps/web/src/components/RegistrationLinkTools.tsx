import { useEffect, useState } from 'react'
import { Check, Copy, QrCode } from 'lucide-react'
import QRCode from 'qrcode'
import { useTranslation } from 'react-i18next'

type RegistrationLinkToolsProps = {
  url: string
  fileName: string
  title?: string
  showPreview?: boolean
}

export async function copyRegistrationLink(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  input.select()
  document.execCommand('copy')
  input.remove()
}

export async function downloadRegistrationQr(url: string, fileName: string): Promise<void> {
  const dataUrl = await QRCode.toDataURL(url, { width: 512, margin: 2 })
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = `${fileName}-registration-qr.png`
  link.click()
}

export function RegistrationLinkTools({ url, fileName, title, showPreview = false }: RegistrationLinkToolsProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [qrPending, setQrPending] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string>()

  useEffect(() => {
    if (!showPreview) return
    let active = true
    void QRCode.toDataURL(url, { width: 320, margin: 2 }).then((dataUrl) => {
      if (active) setQrDataUrl(dataUrl)
    })
    return () => { active = false }
  }, [showPreview, url])

  async function handleCopy() {
    try {
      await copyRegistrationLink(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  async function handleQrDownload() {
    setQrPending(true)
    try {
      await downloadRegistrationQr(url, fileName)
    } finally {
      setQrPending(false)
    }
  }

  return <div className={`registration-link-tools${showPreview ? ' registration-link-tools-preview' : ''}`} aria-label={t('registrationLinkTools')}>
    {title && <h3>{title}</h3>}
    {showPreview && (qrDataUrl ? <img className="registration-qr" src={qrDataUrl} alt={title ? `${title} QR code` : t('registrationQr')} /> : <span className="registration-qr-loading" role="status">{t('preparingQr')}</span>)}
    <button type="button" className="quiet-button" onClick={() => void handleCopy()}>
      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      {copied ? t('linkCopied') : t('copyLink')}
    </button>
    <button type="button" className="quiet-button" onClick={() => void handleQrDownload()} disabled={qrPending}>
      <QrCode size={15} aria-hidden="true" />
      {qrPending ? t('preparingQr') : t('downloadQr')}
    </button>
  </div>
}
