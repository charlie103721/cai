/** Brand verified-check badge (from the FanMouth design kit). */
export function Verified({ s = 13 }: { s?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={s} height={s} style={{ flexShrink: 0 }}>
      <path fill="var(--brand)" d="M12 1l2.4 2.1 3.1-.5 1.1 3 2.9 1.3-1 3.1 1 3.1-2.9 1.3-1.1 3-3.1-.5L12 23l-2.4-2.1-3.1.5-1.1-3-2.9-1.3 1-3.1-1-3.1 2.9-1.3 1.1-3 3.1.5z" />
      <path fill="#fff" d="M10.6 14.6l-2.2-2.2-1.2 1.2 3.4 3.4 6-6-1.2-1.2z" />
    </svg>
  )
}
