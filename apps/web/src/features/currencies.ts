const FALLBACK_CURRENCIES = ['AUD', 'CAD', 'EUR', 'GBP', 'JPY', 'NZD', 'USD']

function currencyLabel(code: string): string {
  try {
    const names = new Intl.DisplayNames(undefined, { type: 'currency' })
    return `${names.of(code) ?? code} (${code})`
  } catch {
    return code
  }
}

/** ISO 4217 currencies supplied by the browser, with a compact fallback for older engines. */
export const CURRENCIES = (typeof Intl.supportedValuesOf === 'function'
  ? Intl.supportedValuesOf('currency')
  : FALLBACK_CURRENCIES
).map((code) => [code, currencyLabel(code)] as const)
