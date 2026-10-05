import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import { useRef } from 'react'

import type { MediaItem } from '../../features/media'
import { resolveCaption } from '../../features/media-captions'
import { captionValuesOf, tileImageSource } from './MediaGallery'

export function FeaturedStrip({ items, onOpen }: { items: MediaItem[]; onOpen: (mediaId: string) => void }) {
  const { t } = useTranslation()
  const rail = useRef<HTMLDivElement>(null)
  if (items.length === 0) return null
  return (
    <div className="media-featured" aria-label={t('mediaFeaturedHeading')}>
      <h3 className="media-featured-heading">{t('mediaFeaturedHeading')}</h3>
      <div className="media-featured-carousel">
        <div className="featured-navigation">
          <button type="button" className="quiet-button" aria-label={t('mediaPrevious')} onClick={() => rail.current?.scrollBy({ left: -260 })}><ChevronLeft size={20} /></button>
          <button type="button" className="quiet-button" aria-label={t('mediaNext')} onClick={() => rail.current?.scrollBy({ left: 260 })}><ChevronRight size={20} /></button>
        </div>
        <div className="media-featured-strip" role="group" aria-label={t('mediaFeaturedHeading')} ref={rail}>
          {items.map((item) => {
            const caption = resolveCaption(item.caption, captionValuesOf(item), 'long')
            const { src, srcSet } = tileImageSource(item)
            return (
              <button key={item.id} type="button" className="media-tile media-featured-tile" onClick={() => onOpen(item.id)} aria-label={item.alt_text}>
                {src && <img src={src} srcSet={srcSet || undefined} sizes="320px" alt="" loading="lazy" />}
                {item.media_type === 'video' && <span className="media-tile-play" aria-hidden="true"><Play size={22} /></span>}
                {caption && <span className="media-tile-caption">{caption}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
