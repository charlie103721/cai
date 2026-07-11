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
