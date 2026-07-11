import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MePage from './MePage'
import { getMyProfile, getMyStats, updateMyProfile, ProfileRequestError } from '@/lib/me'
import { getFavorites } from '@/lib/chat'
import { useAuth } from '@/hooks/useAuth'

vi.mock('@/lib/me', async () => {
  const actual = await vi.importActual<typeof import('@/lib/me')>('@/lib/me')
  return { ...actual, getMyProfile: vi.fn(), getMyStats: vi.fn(), updateMyProfile: vi.fn() }
})
vi.mock('@/lib/chat', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chat')>('@/lib/chat')
  return { ...actual, getFavorites: vi.fn() }
})
vi.mock('@/lib/auth', () => ({ signOut: vi.fn() }))
vi.mock('@/hooks/useAuth', () => ({ useAuth: vi.fn() }))

function renderMe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(getMyStats).mockResolvedValue({ chats: 12, favorites: 2, likes: 34000 })
  vi.mocked(getFavorites).mockResolvedValue([])
})

describe('MePage — guest vs authed', () => {
  it('guest: shows a claim-your-handle signup CTA, no Log out', async () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false } as ReturnType<typeof useAuth>)
    renderMe()

    expect(await screen.findByText(/Sign up to claim your @handle/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Log out/ })).not.toBeInTheDocument()
    // stats still render for guests (guest-ok endpoint)
    expect(await screen.findByText('3.4w')).toBeInTheDocument()
  })

  it('authed: shows @handle and a Log out row, no signup CTA', async () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true } as ReturnType<typeof useAuth>)
    vi.mocked(getMyProfile).mockResolvedValue({ name: 'Charlie', handle: 'footy_fan', favorite_team: '🇦🇷', image: null })
    renderMe()

    expect(await screen.findByText('@footy_fan')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Log out/ })).toBeInTheDocument()
    expect(screen.queryByText(/Sign up to claim your @handle/)).not.toBeInTheDocument()
  })

  it('authed: surfaces a 409 HANDLE_TAKEN inline in the edit modal', async () => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true } as ReturnType<typeof useAuth>)
    vi.mocked(getMyProfile).mockResolvedValue({ name: 'Charlie', handle: 'footy_fan', favorite_team: '🇦🇷', image: null })
    vi.mocked(updateMyProfile).mockRejectedValueOnce(new ProfileRequestError('HANDLE_TAKEN', 409))
    renderMe()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }))
    const username = await screen.findByLabelText('Username')
    fireEvent.change(username, { target: { value: 'taken_handle' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/already taken/i)).toBeInTheDocument()
    await waitFor(() => expect(updateMyProfile).toHaveBeenCalledWith({ handle: 'taken_handle', favorite_team: '🇦🇷' }))
  })
})
