import { describe, it, expect } from 'vitest'
import { fmt, relTime } from './format'

describe('fmt', () => {
  it('returns the raw integer below 1000', () => {
    expect(fmt(0)).toBe('0')
    expect(fmt(5)).toBe('5')
    expect(fmt(999)).toBe('999')
  })

  it('formats thousands with a "k" suffix and one decimal', () => {
    expect(fmt(1000)).toBe('1.0k')
    expect(fmt(1500)).toBe('1.5k')
    expect(fmt(9999)).toBe('10.0k')
  })

  it('formats ten-thousands with a "w" suffix, dropping a trailing .0', () => {
    expect(fmt(10000)).toBe('1w')
    expect(fmt(12000)).toBe('1.2w')
    expect(fmt(241000)).toBe('24.1w')
    expect(fmt(67000)).toBe('6.7w')
  })
})

describe('relTime', () => {
  const now = Date.parse('2026-07-11T12:00:00Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it('renders "now" for empty/invalid input and sub-minute deltas', () => {
    expect(relTime(null, now)).toBe('now')
    expect(relTime(undefined, now)).toBe('now')
    expect(relTime('not-a-date', now)).toBe('now')
    expect(relTime(ago(30_000), now)).toBe('now')
  })

  it('renders minutes under an hour', () => {
    expect(relTime(ago(2 * 60_000), now)).toBe('2m')
    expect(relTime(ago(18 * 60_000), now)).toBe('18m')
    expect(relTime(ago(59 * 60_000), now)).toBe('59m')
  })

  it('renders hours under a day', () => {
    expect(relTime(ago(60 * 60_000), now)).toBe('1h')
    expect(relTime(ago(3 * 60 * 60_000), now)).toBe('3h')
  })

  it('renders days beyond 24h', () => {
    expect(relTime(ago(24 * 60 * 60_000), now)).toBe('1d')
    expect(relTime(ago(3 * 24 * 60 * 60_000), now)).toBe('3d')
  })
})
