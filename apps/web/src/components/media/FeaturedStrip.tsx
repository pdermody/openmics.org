import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { MediaItem } from '../../features/media'
import { resolveCaption } from '../../features/media-captions'
import { captionValuesOf, tileImageSource } from './MediaGallery'

export function FeaturedStrip({ items, onOpen }: { items: MediaItem[]; onOpen: (mediaId: string) => void }) {
  const { t } = useTranslation()
  const rail = useRef<HTMLDivElement>(null)
  const [navigation, setNavigation] = useState({ previous: false, next: false })
  useEffect(() => {
    const element = rail.current
    if (!element) return
    const measure = () => {
      const previous = element.scrollLeft > 1
      const next = element.scrollWidth - element.clientWidth - element.scrollLeft > 1
      setNavigation((current) => current.previous === previous && current.next === next ? current : { previous, next })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    element.addEventListener('scroll', measure)
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', measure)
    }
  }, [items])
  if (items.length === 0) return null
  return (
    <div className="media-featured" aria-label={t('mediaFeaturedHeading')}>
      <h3 className="media-featured-heading">{t('mediaFeaturedHeading')}</h3>
      <div className="media-featured-carousel">
        {(navigation.previous || navigation.next) && <div className="featured-navigation">
          {navigation.previous ? <button type="button" className="quiet-button" aria-label={t('mediaPrevious')} onClick={() => rail.current?.scrollBy({ left: -260 })}><ChevronLeft size={20} /></button> : <span />}
          {navigation.next && <button type="button" className="quiet-button" aria-label={t('mediaNext')} onClick={() => rail.current?.scrollBy({ left: 260 })}><ChevronRight size={20} /></button>}
        </div>}
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
