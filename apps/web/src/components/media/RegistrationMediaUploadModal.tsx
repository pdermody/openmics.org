import { useCallback, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { canAttributeMedia } from '../../features/media'
import type { RosterRegistration } from '../../features/organizer'
import { MediaUploader, type MediaUploaderHandle } from './MediaUploader'

export function RegistrationMediaUploadModal({ eventId, registration, onClose }: {
  eventId: string
  registration: RosterRegistration
  onClose: () => void
}) {
  const { t } = useTranslation()
  const uploader = useRef<MediaUploaderHandle>(null)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const attachPortal = useCallback((node: HTMLSpanElement | null) => {
    if (node) setPortalTarget(node.closest<HTMLElement>('.app') ?? document.body)
  }, [])
  const eligible = canAttributeMedia(registration)
  const requestClose = () => {
    if (uploader.current?.hasUnfinishedWork()) setConfirmingClose(true)
    else onClose()
  }

  return <Dialog.Root open onOpenChange={(open) => { if (!open) requestClose() }}>
    <span hidden ref={attachPortal} />
    {portalTarget && <Dialog.Portal container={portalTarget}>
      <Dialog.Overlay className="modal-backdrop">
        <Dialog.Content className="modal-panel" aria-describedby={undefined}>
          <div className="modal-header">
            <Dialog.Title>{t('mediaAddForPerformer', { performer: registration.performer_name })}</Dialog.Title>
            <button type="button" className="modal-close" aria-label={t('close')} onClick={requestClose}><X size={18} aria-hidden="true" /></button>
          </div>
          {confirmingClose && <div className="media-upload-close-confirmation">
            <p role="alert">{t('mediaCancelUnfinishedConfirm')}</p>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setConfirmingClose(false)}>{t('mediaContinueUploading')}</button>
              <button type="button" className="primary-button" onClick={() => { uploader.current?.cancelUnfinished(); onClose() }}>{t('mediaCancelAndClose')}</button>
            </div>
          </div>}
          {!eligible && <p className="field-hint" role="status">{t(registration.media_consent ? 'mediaRegistrationNotEligible' : 'mediaRegistrationNeedsConsent')}</p>}
          <div hidden={confirmingClose || !eligible}>
            <MediaUploader ref={uploader} eventId={eventId} fixedRegistration={registration} inlineVideo uploadsDisabled={!eligible} />
          </div>
        </Dialog.Content>
      </Dialog.Overlay>
    </Dialog.Portal>}
  </Dialog.Root>
}
