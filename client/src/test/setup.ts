import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Vitest globals are off, so RTL's auto-cleanup isn't wired — unmount between
// tests ourselves to keep each render isolated.
afterEach(() => cleanup())

// jsdom has no matchMedia — usehooks-ts `useMediaQuery` needs it. Default to
// the mobile (< lg) frame; individual tests override before rendering.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}
