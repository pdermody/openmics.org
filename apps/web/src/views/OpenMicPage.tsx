import { DetailPage } from './DetailPage'
import type { ThemeProps } from './shared'

export function OpenMicPage({ id, theme, mode }: { id: string } & ThemeProps) {
  return <DetailPage kind="open-mic" id={id} theme={theme} mode={mode} />
}
