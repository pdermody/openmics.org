const HANDLE_FORMAT = /^[A-Za-z0-9][A-Za-z0-9-]{1,48}[A-Za-z0-9]$/
const ALL_DIGITS = /^[0-9]+$/
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NON_ALNUM_RUN = /[^a-z0-9]+/g
const MULTI_HYPHEN = /-{2,}/g
const COMBINING_MARKS = /[\u0300-\u036f]/g

/** Format rules mirror apps/api/src/handles/validation.ts — a client-side hint only; the server is authoritative. */
export function isValidHandleFormat(candidate: string): boolean {
  return HANDLE_FORMAT.test(candidate) && !ALL_DIGITS.test(candidate) && !UUID_SHAPE.test(candidate)
}

/** Mirrors apps/api/src/handles/slugify.ts (minus the random-suffix fallback) for a live suggestion as the user types a name. */
export function suggestHandle(displayName: string): string {
  let value = displayName.normalize('NFKD').replace(COMBINING_MARKS, '')
  value = value.toLowerCase()
  value = value.replace(/['\u2019]/g, '')
  value = value.replace(/&/g, '-and-')
  value = value.replace(/@/g, '-at-')
  value = value.replace(NON_ALNUM_RUN, '-')
  value = value.replace(/^-+|-+$/g, '')
  value = value.replace(MULTI_HYPHEN, '-')

  if (value.length > 50) {
    const truncated = value.slice(0, 50)
    const lastHyphen = truncated.lastIndexOf('-')
    value = lastHyphen > 0 ? truncated.slice(0, lastHyphen) : truncated
  }

  return value
}
