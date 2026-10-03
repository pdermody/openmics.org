import { useTranslation } from 'react-i18next'
import { Play } from 'lucide-react'

import type { MediaItem } from '../../features/media'
import { resolveCaption } from '../../features/media-captions'
import { captionValuesOf, tileImageSource } from './MediaGallery'

// The organizer-curated strip above the series grid (design §5.1, §11.4): the organizer's
// manual order always wins over the active sort; the parent hides it while a filter is
// active. Horizontally scrollable rail on mobile, two-row grid on desktop (CSS).
export function FeaturedStrip({ items, onOpen }: { items: MediaItem[]; onOpen: (mediaId: string) => void }) {
  const { t } = useTranslation()
  if (items.length === 0) return null
  return (
    <div className="media-featured" aria-label={t('mediaFeaturedHeading')}>
      <h3 className="media-featured-heading">{t('mediaFeaturedHeading')}</h3>
      <div className="media-featured-strip" role="list">
        {items.map((item) => {
          const caption = resolveCaption(item.caption, captionValuesOf(item), 'long')
          const { src, srcSet } = tileImageSource(item)
          return (
            <button key={item.id} type="button" role="listitem" className="media-tile media-featured-tile" onClick={() => onOpen(item.id)} aria-label={item.alt_text}>
              {src && <img src={src} srcSet={srcSet || undefined} sizes="320px" alt="" loading="lazy" />}
              {item.media_type === 'video' && <span className="media-tile-play" aria-hidden="true"><Play size={22} /></span>}
              {caption && <span className="media-tile-caption">{caption}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
