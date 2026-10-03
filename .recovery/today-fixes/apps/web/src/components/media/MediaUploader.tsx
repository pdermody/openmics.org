import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Link2, X } from 'lucide-react'

import { putToPresignedUrl, useCommitMedia, useCreateUploadUrl } from '../../features/media'

// The file picker is the universal upload path (camera capture + photo library on phones
// and tablets); drag-and-drop is a pointer enhancement, never the only path (§8.2).

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
const MAX_PHOTO_BYTES = 10_485_760

export type UploadableRegistration = {
  id: string
  performer_name: string
  performer_city?: string | null
}

type UploadRow = {
  localId: string
  file: File
  previewUrl: string
  progress: number
  status: 'queued' | 'uploading' | 'committing' | 'done' | 'error' | 'cancelled'
  error?: string
  controller: AbortController
  registrationId: string
}

function validateFile(file: File): 'type' | 'size' | null {
  const name = file.name.toLowerCase()
  const looksHeic = file.type === 'image/heic' || file.type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif')
  if (looksHeic || !(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) return 'type'
  if (file.size > MAX_PHOTO_BYTES) return 'size'
  return null
}

export function MediaUploader({ eventId, openMicId, registrations, onCommitted }: {
  eventId?: string
  openMicId?: string
  registrations?: UploadableRegistration[]
  onCommitted?: () => void
}) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<UploadRow[]>([])
  // Mutable mirror of `rows` so the async upload loop can read the latest row state
  // synchronously (React state updates are not flushed until the next render, so reading
  // via a setState updater inside runUpload returned undefined and the upload never ran).
  const rowsRef = useRef<UploadRow[]>([])
  const [batchRegistrationId, setBatchRegistrationId] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const createUploadUrl = useCreateUploadUrl()
  const commitMedia = useCommitMedia()

  // Video link form (§8.4 "+ Add video")
  const [videoFormOpen, setVideoFormOpen] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const [videoCaption, setVideoCaption] = useState('')
  const [videoRegistrationId, setVideoRegistrationId] = useState('')
  const [videoError, setVideoError] = useState('')
  const videoPreviewId = parseVideoLink(videoUrl)

  const attributionEnabled = Boolean(eventId && registrations)

  function addFiles(fileList: FileList | File[]) {
    const nextRows: UploadRow[] = []
    for (const file of Array.from(fileList)) {
      const invalid = validateFile(file)
      nextRows.push({
        localId: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        progress: 0,
        status: invalid ? 'error' : 'queued',
        error: invalid ? t(invalid === 'type' ? 'mediaUploadInvalidType' : 'mediaUploadTooLarge') : undefined,
        controller: new AbortController(),
        registrationId: batchRegistrationId,
      })
    }
    setRowsAndRef((current) => [...current, ...nextRows])
    for (const row of nextRows) {
      if (row.status === 'queued') void runUpload(row.localId)
    }
  }

  function setRowsAndRef(updater: (current: UploadRow[]) => UploadRow[]) {
    rowsRef.current = updater(rowsRef.current)
    setRows(rowsRef.current)
  }

  function updateRow(localId: string, patch: Partial<UploadRow>) {
    setRowsAndRef((current) => current.map((row) => (row.localId === localId ? { ...row, ...patch } : row)))
  }

  function readRow(localId: string): UploadRow | undefined {
    return rowsRef.current.find((row) => row.localId === localId)
  }

  async function runUpload(localId: string) {
    const row = readRow(localId)
    if (!row || row.status === 'cancelled' || row.status === 'done') return
    try {
      updateRow(localId, { status: 'uploading', progress: 0, error: undefined })
      const reservation = await createUploadUrl.mutateAsync({ media_type: 'photo', mime_type: row.file.type, size_bytes: row.file.size })
      if (row.controller.signal.aborted) return
      await putToPresignedUrl(reservation.upload_url, row.file, {
        signal: row.controller.signal,
        onProgress: (fraction) => updateRow(localId, { progress: fraction }),
      })
      if (row.controller.signal.aborted) return
      updateRow(localId, { status: 'committing' })
      await commitMedia.mutateAsync({
        media_type: 'photo',
        object_key: reservation.object_key,
        ...(eventId ? { event_id: eventId } : {}),
        ...(openMicId ? { open_mic_id: openMicId } : {}),
        ...(row.registrationId ? { registration_id: row.registrationId } : {}),
      })
      updateRow(localId, { status: 'done', progress: 1 })
      onCommitted?.()
    } catch (error) {
      if (row.controller.signal.aborted || (error as DOMException).name === 'AbortError') {
        updateRow(localId, { status: 'cancelled' })
      } else {
        updateRow(localId, { status: 'error', error: t('mediaUploadFailed') })
      }
    }
  }

  function cancelRow(row: UploadRow) {
    row.controller.abort()
    if (row.status === 'queued') updateRow(row.localId, { status: 'cancelled' })
  }

  function cancelAll() {
    for (const row of rows) {
      if (row.status === 'queued' || row.status === 'uploading' || row.status === 'committing') cancelRow(row)
    }
  }

  async function submitVideo(event: React.FormEvent) {
    event.preventDefault()
    setVideoError('')
    if (!videoPreviewId) {
      setVideoError(t('mediaVideoInvalidUrl'))
      return
    }
    try {
      await commitMedia.mutateAsync({
        media_type: 'video',
        video_url: videoUrl.trim(),
        caption: videoCaption.trim() || undefined,
        ...(eventId ? { event_id: eventId } : {}),
        ...(openMicId ? { open_mic_id: openMicId } : {}),
        ...(videoRegistrationId ? { registration_id: videoRegistrationId } : {}),
      })
      setVideoFormOpen(false)
      setVideoUrl('')
      setVideoCaption('')
      setVideoRegistrationId('')
      onCommitted?.()
    } catch {
      setVideoError(t('mediaVideoAddFailed'))
    }
  }

  const activeCount = rows.filter((row) => row.status === 'queued' || row.status === 'uploading' || row.status === 'committing').length

  return (
    <div className="media-uploader">
      {attributionEnabled && (
        <label className="media-uploader-attribution">
          <span>{t('mediaAttributeAllTo')}</span>
          <select value={batchRegistrationId} onChange={(event) => setBatchRegistrationId(event.target.value)}>
            <option value="">{t('mediaNoPerformer')}</option>
            {registrations!.map((registration) => (
              <option key={registration.id} value={registration.id}>
                {registration.performer_name}{registration.performer_city ? ` · ${registration.performer_city}` : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      <div
        className={`media-dropzone${isDragOver ? ' drag-over' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setIsDragOver(true) }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragOver(false)
          if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files)
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ALLOWED_MIME_TYPES.join(',')}
          className="visually-hidden"
          aria-label={t('mediaChoosePhotos')}
          onChange={(event) => {
            if (event.target.files?.length) addFiles(event.target.files)
            event.target.value = ''
          }}
        />
        <ImagePlus size={28} aria-hidden="true" />
        <p>{t('mediaDropzoneHint')}</p>
        <button type="button" className="primary-button" onClick={() => fileInputRef.current?.click()}>{t('mediaChoosePhotos')}</button>
        <button type="button" className="secondary-button" onClick={() => setVideoFormOpen((open) => !open)}>
          <Link2 size={15} aria-hidden="true" /> {t('mediaAddVideo')}
        </button>
      </div>

      {videoFormOpen && (
        <form className="media-video-form" onSubmit={submitVideo}>
          <label>
            <span>{t('mediaVideoUrlLabel')}</span>
            <input type="url" value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder={t('mediaVideoUrlPlaceholder')} required />
          </label>
          {videoPreviewId && (
            <img
              className="media-video-preview"
              src={videoPreviewId.platform === 'youtube' ? `https://i.ytimg.com/vi/${videoPreviewId.id}/hqdefault.jpg` : `https://vumbnail.com/${videoPreviewId.id}.jpg`}
              alt=""
            />
          )}
          <label>
            <span>{t('mediaCaptionLabel')}</span>
            <input value={videoCaption} maxLength={500} onChange={(event) => setVideoCaption(event.target.value)} />
          </label>
          {attributionEnabled && (
            <label>
              <span>{t('mediaAttributionLabel')}</span>
              <select value={videoRegistrationId} onChange={(event) => setVideoRegistrationId(event.target.value)}>
                <option value="">{t('mediaNoPerformer')}</option>
                {registrations!.map((registration) => (
                  <option key={registration.id} value={registration.id}>
                    {registration.performer_name}{registration.performer_city ? ` · ${registration.performer_city}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {videoError && <p className="form-error" role="alert">{videoError}</p>}
          <button type="submit" className="primary-button" disabled={commitMedia.isPending}>{t('mediaAddVideoSubmit')}</button>
        </form>
      )}

      {rows.length > 0 && (
        <div className="media-upload-list">
          <div className="media-upload-list-header">
            <span>{t('mediaUploadListHeading', { count: rows.length })}</span>
            {activeCount > 0 && <button type="button" className="link-button" onClick={cancelAll}>{t('mediaCancelAll')}</button>}
          </div>
          <ul>
            {rows.map((row) => (
              <li key={row.localId} className={`media-upload-row media-upload-${row.status}`}>
                <img src={row.previewUrl} alt="" className="media-upload-thumb" />
                <div className="media-upload-row-main">
                  <span className="media-upload-name">{row.file.name}</span>
                  {attributionEnabled && (
                    <select
                      value={row.registrationId}
                      aria-label={t('mediaAttributionLabel')}
                      disabled={row.status === 'done' || row.status === 'uploading' || row.status === 'committing'}
                      onChange={(event) => updateRow(row.localId, { registrationId: event.target.value })}
                    >
                      <option value="">{t('mediaNoPerformer')}</option>
                      {registrations!.map((registration) => (
                        <option key={registration.id} value={registration.id}>
                          {registration.performer_name}{registration.performer_city ? ` · ${registration.performer_city}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {(row.status === 'uploading' || row.status === 'committing') && (
                    <progress value={row.status === 'committing' ? 1 : row.progress} max={1} aria-label={t('mediaUploadProgress', { name: row.file.name })} />
                  )}
                  {row.status === 'error' && <span className="form-error" role="alert">{row.error}</span>}
                  {row.status === 'done' && <span className="form-success" role="status">{t('mediaUploadDone')}</span>}
                  {row.status === 'cancelled' && <span className="field-hint">{t('mediaUploadCancelled')}</span>}
                </div>
                <div className="media-upload-row-actions">
                  {(row.status === 'queued' || row.status === 'uploading' || row.status === 'committing') && (
                    <button type="button" className="quiet-button icon-button" onClick={() => cancelRow(row)} aria-label={t('mediaCancelUpload', { name: row.file.name })}><X size={15} /></button>
                  )}
                  {row.status === 'error' && (
                    <button type="button" className="link-button" onClick={() => { const fresh = new AbortController(); updateRow(row.localId, { status: 'queued', error: undefined, progress: 0, controller: fresh }); void runUpload(row.localId) }}>{t('tryAgain')}</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Client-side mirror of the API video host allowlist for instant feedback (the server
 * remains authoritative — apps/api/src/media/source-policy.ts). */
function parseVideoLink(rawUrl: string): { platform: 'youtube' | 'vimeo'; id: string } | null {
  try {
    const url = new URL(rawUrl.trim())
    const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '')
    if (host === 'youtu.be') {
      const id = url.pathname.replace(/^\//, '').split('/')[0]
      if (/^[A-Za-z0-9_-]{6,20}$/.test(id)) return { platform: 'youtube', id }
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const watchId = url.searchParams.get('v') ?? ''
      if (url.pathname === '/watch' && /^[A-Za-z0-9_-]{6,20}$/.test(watchId)) return { platform: 'youtube', id: watchId }
      const embed = /^\/(embed|shorts|live)\/([^/?#]+)/.exec(url.pathname)
      if (embed && /^[A-Za-z0-9_-]{6,20}$/.test(embed[2])) return { platform: 'youtube', id: embed[2] }
    }
    if (host === 'vimeo.com') {
      const id = url.pathname.replace(/^\//, '').split('/')[0]
      if (/^[0-9]{6,12}$/.test(id)) return { platform: 'vimeo', id }
    }
    if (host === 'player.vimeo.com') {
      const embed = /^\/video\/([0-9]{6,12})/.exec(url.pathname)
      if (embed) return { platform: 'vimeo', id: embed[1] }
    }
    return null
  } catch {
    return null
  }
}
