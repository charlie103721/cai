/**
 * Compact count formatter (from the FanMouth design kit):
 *   ≥ 10000 → "x.xw" (万, trailing ".0" dropped)
 *   ≥ 1000  → "x.xk"
 *   otherwise the raw integer as a string.
 */
export function fmt(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return '' + n
}

/**
 * Compact relative-time label for inbox rows (from the FanMouth design kit):
 *   < 1 min  → "now"
 *   < 1 hour → "{m}m"   (e.g. 2m, 18m)
 *   < 1 day  → "{h}h"   (e.g. 1h, 3h)
 *   otherwise → "{d}d"  (e.g. 1d)
 * Accepts an ISO timestamp (or null); invalid/empty input renders "now".
 */
export function relTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'now'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'now'
  const diffMs = now - then
  if (diffMs < 60_000) return 'now'
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
