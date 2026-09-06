const NON_ALNUM_RUN = /[^a-z0-9]+/g;
const MULTI_HYPHEN = /-{2,}/g;
const ALL_DIGITS = /^[0-9]+$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMBINING_MARKS = /[\u0300-\u036f]/g;

// Auto-generation algorithm from docs/6-open-mic-vanity-urls.md §6.
export function slugifyDisplayName(displayName: string, randomSuffix = defaultRandomSuffix): string {
  let value = displayName.normalize('NFKD').replace(COMBINING_MARKS, '');
  value = value.toLowerCase();
  value = value.replace(/['\u2019]/g, '');
  value = value.replace(/&/g, '-and-');
  value = value.replace(/@/g, '-at-');
  value = value.replace(NON_ALNUM_RUN, '-');
  value = value.replace(/^-+|-+$/g, '');
  value = value.replace(MULTI_HYPHEN, '-');

  if (value.length > 50) {
    const truncated = value.slice(0, 50);
    const lastHyphen = truncated.lastIndexOf('-');
    value = lastHyphen > 0 ? truncated.slice(0, lastHyphen) : truncated;
  }

  if (value.length < 3 || ALL_DIGITS.test(value) || UUID_SHAPE.test(value)) {
    value = `${value || 'handle'}-${randomSuffix()}`.slice(0, 50);
  }

  return value;
}

function defaultRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}
