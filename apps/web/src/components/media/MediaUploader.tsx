import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Link2, X } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { friendlyApiErrorMessage } from '../../api/client'
import { putToPresignedUrl, useCommitMedia, useCreateUploadUrl, useUpdateMedia } from '../../features/media'
import { fetchVideoTitle } from '../../features/video-metadata'
import { Modal } from '../../views/shared'

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
  mediaId?: string
  attributionPending?: boolean
  attributionError?: string
}

const videoSchema = z.object({
  url: z.string().trim().refine((value) => parseVideoLink(value) !== null),
  caption: z.string().max(500),
  registrationId: z.string(),
})
type VideoForm = z.infer<typeof videoSchema>

export type MediaUploaderHandle = {
  hasUnfinishedWork: () => boolean
  cancelUnfinished: () => void
}

type MediaUploaderProps = {
  registrations?: UploadableRegistration[]
  onCommitted?: () => void
  inlineVideo?: boolean
  uploadsDisabled?: boolean
  ref?: Ref<MediaUploaderHandle>
} & (
  | { eventId: string; openMicId?: never; fixedRegistration?: UploadableRegistration }
  | { openMicId: string; eventId?: never; fixedRegistration?: never }
)

function validateFile(file: File): 'type' | 'size' | null {
  const name = file.name.toLowerCase()
  const looksHeic = file.type === 'image/heic' || file.type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif')
  if (looksHeic || !(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) return 'type'
  if (file.size > MAX_PHOTO_BYTES) return 'size'
  return null
}

export function MediaUploader({ eventId, openMicId, registrations, fixedRegistration, onCommitted, inlineVideo = false, uploadsDisabled = false, ref }: MediaUploaderProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<UploadRow[]>([])
  // Mutable mirror of `rows` so the async upload loop can read the latest row state
  // synchronously (React state updates are not flushed until the next render, so reading
  // via a setState updater inside runUpload returned undefined and the upload never ran).
  const rowsRef = useRef<UploadRow[]>([])
  const mounted = useRef(false)
  const uploadsAllowed = useRef(!uploadsDisabled)
  const [batchRegistrationId, setBatchRegistrationId] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const createUploadUrl = useCreateUploadUrl()
  const commitMedia = useCommitMedia()
  const updateMedia = useUpdateMedia()
  const videoPending = useRef(false)

  // Video link form (§8.4 "+ Add video")
  const [videoFormOpen, setVideoFormOpen] = useState(false)
  const videoForm = useForm<VideoForm>({
    resolver: zodResolver(videoSchema),
    defaultValues: { url: '', caption: '', registrationId: '' },
  })
  const videoUrl = useWatch({ control: videoForm.control, name: 'url' })
  const [videoError, setVideoError] = useState('')
  const videoPreviewId = parseVideoLink(videoUrl)
  // Keyed by video so a stale in-flight fetch can never apply to a newer URL. Remembers
  // the last title it autofilled, so a later URL change only replaces an untouched
  // autofilled caption — never one the organizer typed or edited.
  const prefillState = useRef({ key: '', title: '' })

  function onVideoUrlChange(rawUrl: string) {
    videoForm.setValue('url', rawUrl)
    const link = parseVideoLink(rawUrl)
    prefillState.current = link ? { key: `${link.platform}:${link.id}`, title: prefillState.current.title } : { key: '', title: '' }
  }

  const attributionEnabled = Boolean(eventId && registrations && !fixedRegistration)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const row of rowsRef.current) {
        row.controller.abort()
        URL.revokeObjectURL(row.previewUrl)
      }
    }
  }, [])

  useEffect(() => {
    uploadsAllowed.current = !uploadsDisabled
    if (uploadsDisabled) {
      for (const row of rowsRef.current) {
        if (row.status === 'queued' || row.status === 'uploading') row.controller.abort()
      }
    }
  }, [uploadsDisabled])

  // Caption prefill from the provider's oEmbed title (design §8.4): fires once per resolved
  // URL (keyed by the primitive video id, since parseVideoLink returns a fresh object each
  // render), debounced, straight from the browser (no API round-trip). A null title (unknown
  // video, provider unreachable) simply leaves the field as-is.
  const videoKey = videoPreviewId ? `${videoPreviewId.platform}:${videoPreviewId.id}` : null
  useEffect(() => {
    if (!videoKey) return
    const link = parseVideoLink(videoUrl)
    if (!link) return
    const timer = setTimeout(() => {
      void fetchVideoTitle(link).then((title) => {
        if (!mounted.current || !title || prefillState.current.key !== videoKey) return
        const previousTitle = prefillState.current.title
        prefillState.current = { key: videoKey, title: title.slice(0, 500) }
        const current = videoForm.getValues('caption')
        if (!current || current === previousTitle) videoForm.setValue('caption', prefillState.current.title)
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [videoKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function addFiles(fileList: FileList | File[]) {
    if (uploadsDisabled) return
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
        registrationId: fixedRegistration?.id ?? batchRegistrationId,
      })
    }
    setRowsAndRef((current) => [...current, ...nextRows])
    for (const row of nextRows) {
      if (row.status === 'queued') void runUpload(row.localId)
    }
  }

  function setRowsAndRef(updater: (current: UploadRow[]) => UploadRow[]) {
    rowsRef.current = updater(rowsRef.current)
    if (mounted.current) setRows(rowsRef.current)
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
      if (row.controller.signal.aborted) {
        updateRow(localId, { status: 'cancelled' })
        return
      }
      if (!uploadsAllowed.current) {
        updateRow(localId, { status: 'error', error: t('mediaRegistrationNotEligible') })
        return
      }
      await putToPresignedUrl(reservation.upload_url, row.file, {
        signal: row.controller.signal,
        onProgress: (fraction) => updateRow(localId, { progress: fraction }),
      })
      if (row.controller.signal.aborted) {
        updateRow(localId, { status: 'cancelled' })
        return
      }
      updateRow(localId, { status: 'committing' })
      const registrationId = readRow(localId)?.registrationId
      const committed = await commitMedia.mutateAsync({
        media_type: 'photo',
        object_key: reservation.object_key,
        ...(eventId ? { event_id: eventId } : {}),
        ...(openMicId ? { open_mic_id: openMicId } : {}),
        ...(registrationId ? { registration_id: registrationId } : {}),
      })
      updateRow(localId, { status: 'done', progress: 1, mediaId: committed.id, registrationId: committed.registration_id ?? '' })
      if (mounted.current) onCommitted?.()
    } catch (error) {
      if (row.controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        updateRow(localId, { status: 'cancelled' })
      } else {
        updateRow(localId, { status: 'error', error: friendlyApiErrorMessage(error, t('mediaUploadFailed')) })
      }
    }
  }

  function cancelRow(row: UploadRow) {
    if (row.status === 'committing' || row.status === 'done') return
    row.controller.abort()
    updateRow(row.localId, { status: 'cancelled' })
  }

  useImperativeHandle(ref, () => ({
    hasUnfinishedWork: () => videoPending.current || rowsRef.current.some((row) => ['queued', 'uploading', 'committing'].includes(row.status)),
    cancelUnfinished: () => {
      for (const row of rowsRef.current) {
        if (row.status === 'queued' || row.status === 'uploading') cancelRow(row)
      }
    },
  }))

  function cancelAll() {
    for (const row of rows) {
      if (row.status === 'queued' || row.status === 'uploading') cancelRow(row)
    }
  }

  async function changeAttribution(row: UploadRow, registrationId: string) {
    if (!row.mediaId || readRow(row.localId)?.attributionPending || fixedRegistration) return
    updateRow(row.localId, { attributionPending: true, attributionError: undefined })
    try {
      const updated = await updateMedia.mutateAsync({ id: row.mediaId, registration_id: registrationId || null })
      updateRow(row.localId, { registrationId: updated.registration_id ?? '', attributionPending: false })
    } catch (error) {
      updateRow(row.localId, { attributionPending: false, attributionError: friendlyApiErrorMessage(error, t('mediaAttributionFailed')) })
    }
  }

  async function submitVideo(values: VideoForm) {
    if (videoPending.current) return
    setVideoError('')
    if (uploadsDisabled) {
      setVideoError(t('mediaRegistrationNotEligible'))
      return
    }
    videoPending.current = true
    try {
      await commitMedia.mutateAsync({
        media_type: 'video',
        video_url: values.url,
        caption: values.caption.trim() || undefined,
        ...(eventId ? { event_id: eventId } : {}),
        ...(openMicId ? { open_mic_id: openMicId } : {}),
        ...((fixedRegistration?.id ?? values.registrationId) ? { registration_id: fixedRegistration?.id ?? values.registrationId } : {}),
      })
      if (!mounted.current) return
      setVideoFormOpen(false)
      videoForm.reset()
      prefillState.current = { key: '', title: '' }
      onCommitted?.()
    } catch (error) {
      if (mounted.current) setVideoError(friendlyApiErrorMessage(error, t('mediaVideoAddFailed')))
    } finally {
      videoPending.current = false
    }
  }

  const activeCount = rows.filter((row) => row.status === 'queued' || row.status === 'uploading').length

  return (
    <div className="media-uploader">
      {fixedRegistration && <p className="field-hint">{t('mediaFixedPerformer', { performer: fixedRegistration.performer_name })}</p>}
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
          disabled={uploadsDisabled}
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
        <button type="button" className="primary-button" disabled={uploadsDisabled} onClick={() => fileInputRef.current?.click()}>{t('mediaChoosePhotos')}</button>
        <button type="button" className="secondary-button" disabled={uploadsDisabled} onClick={() => setVideoFormOpen(true)}>
          <Link2 size={15} aria-hidden="true" /> {t('mediaAddVideo')}
        </button>
      </div>

      {videoFormOpen && (
        <VideoFormPresentation inline={inlineVideo} title={t('mediaAddVideo')} onClose={() => { if (!videoForm.formState.isSubmitting) setVideoFormOpen(false) }}>
          <form className="media-video-form" onSubmit={(event) => { void videoForm.handleSubmit(submitVideo)(event) }}>
            <label>
              <span>{t('mediaVideoUrlLabel')}</span>
              <input type="url" {...videoForm.register('url')} onChange={(event) => onVideoUrlChange(event.target.value)} placeholder={t('mediaVideoUrlPlaceholder')} required />
            </label>
            {videoForm.formState.errors.url && <p className="form-error" role="alert">{t('mediaVideoInvalidUrl')}</p>}
            {videoPreviewId && (
              <img
                className="media-video-preview"
                src={videoPreviewId.platform === 'youtube' ? `https://i.ytimg.com/vi/${videoPreviewId.id}/hqdefault.jpg` : `https://vumbnail.com/${videoPreviewId.id}.jpg`}
                alt=""
              />
            )}
            <label>
              <span>{t('mediaCaptionLabel')}</span>
              <input {...videoForm.register('caption')} maxLength={500} />
            </label>
            {attributionEnabled && (
              <label>
                <span>{t('mediaAttributionLabel')}</span>
                <select {...videoForm.register('registrationId')}>
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
            <div className="modal-actions">
              <button type="submit" className="primary-button" disabled={commitMedia.isPending || uploadsDisabled}>{t('mediaAddVideoSubmit')}</button>
              <button type="button" className="secondary-button" disabled={commitMedia.isPending} onClick={() => setVideoFormOpen(false)}>{t('cancel')}</button>
            </div>
          </form>
        </VideoFormPresentation>
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
                      disabled={row.attributionPending || row.status === 'uploading' || row.status === 'committing'}
                      onChange={(event) => {
                        if (row.status === 'done') void changeAttribution(row, event.target.value)
                        else updateRow(row.localId, { registrationId: event.target.value })
                      }}
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
                  {row.attributionPending && <span role="status">{t('mediaAttributionSaving')}</span>}
                  {row.attributionError && <span className="form-error" role="alert">{row.attributionError}</span>}
                  {row.status === 'done' && <span className="form-success" role="status">{t('mediaUploadDone')}</span>}
                  {row.status === 'cancelled' && <span className="field-hint">{t('mediaUploadCancelled')}</span>}
                </div>
                <div className="media-upload-row-actions">
                  {(row.status === 'queued' || row.status === 'uploading') && (
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

function VideoFormPresentation({ inline, title, onClose, children }: { inline: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return inline ? <section aria-label={title}>{children}</section> : <Modal title={title} onClose={onClose}>{children}</Modal>
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
