import { describe, it, expect } from 'vitest'
import { fmt } from './format'

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
