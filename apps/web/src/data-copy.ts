/**
 * User-facing copy for dataset load status. The data layer's messages are
 * already sentences, except unreachable-service errors where the transport
 * detail ("Failed to fetch") is glued on the end — that tail is browser
 * noise, so it is split out for optional secondary display instead of being
 * the headline a user acts on.
 */

const UNREACHABLE_PREFIX = "Data service unreachable: ";
const GENERIC_UNREACHABLE = "Data service unreachable.";

export function friendlyDataError(raw: string | null): string {
  if (raw === null || raw.trim() === "") return GENERIC_UNREACHABLE;
  return raw.startsWith(UNREACHABLE_PREFIX) ? GENERIC_UNREACHABLE : raw;
}

/** The transport tail of an unreachable-service error, or nothing. */
export function dataErrorDetail(raw: string | null): string | null {
  if (raw === null || !raw.startsWith(UNREACHABLE_PREFIX)) return null;
  const tail = raw.slice(UNREACHABLE_PREFIX.length).trim();
  return tail === "" ? null : tail;
}
