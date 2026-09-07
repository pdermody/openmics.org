import { DetailPage } from './DetailPage'
import type { ThemeProps } from './shared'

export function EventPage({ id, theme, mode }: { id: string } & ThemeProps) {
  return <DetailPage kind="event" id={id} theme={theme} mode={mode} />
}
