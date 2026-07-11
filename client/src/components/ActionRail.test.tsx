import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ActionRail } from './ActionRail'
import type { PublicCharacter } from '@/lib/chat'
import { likeCharacter } from '@/lib/chat'

vi.mock('@/lib/chat', () => ({
  likeCharacter: vi.fn(),
  favoriteCharacter: vi.fn(),
  unfavoriteCharacter: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const character: PublicCharacter = {
  id: 'arg',
  name: 'Old-Timer Argento',
  emoji: '🇦🇷',
  tagline: 't',
  greeting: 'g',
  hue: 220,
  like_count: 5,
  liked: false,
  chat_count: 8926,
  favorited: false,
}

function renderRail() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ActionRail character={character} variant="mobile" onChat={() => {}} />
    </QueryClientProvider>,
  )
}

describe('ActionRail like', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rolls the like count back to its original value when the request fails', async () => {
    vi.mocked(likeCharacter).mockRejectedValueOnce(new Error('boom'))
    renderRail()

    expect(screen.getByText('5')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Like' }))

    // after the failed mutation settles, the count is back to 5 (optimism undone)
    await waitFor(() => expect(likeCharacter).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument())
  })

  it('keeps the server-confirmed count on success', async () => {
    vi.mocked(likeCharacter).mockResolvedValueOnce({ liked: true, like_count: 6 })
    renderRail()

    fireEvent.click(screen.getByRole('button', { name: 'Like' }))

    await waitFor(() => expect(screen.getByText('6')).toBeInTheDocument())
  })
})
