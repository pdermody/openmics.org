const HANDLE_FORMAT = /^[A-Za-z0-9][A-Za-z0-9-]{1,48}[A-Za-z0-9]$/;
const ALL_DIGITS = /^[0-9]+$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Format rules from docs/6-open-mic-vanity-urls.md §5. Reservation and
// uniqueness are DB-backed checks handled separately by the repository.
export function isValidHandleFormat(candidate: string): boolean {
  return HANDLE_FORMAT.test(candidate) && !ALL_DIGITS.test(candidate) && !UUID_SHAPE.test(candidate);
}
