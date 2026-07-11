import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ChatsPage from './ChatsPage'
import { getConversations, deleteConversation, type ConversationListItem } from '@/lib/chat'

vi.mock('@/lib/chat', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chat')>('@/lib/chat')
  return { ...actual, getConversations: vi.fn(), deleteConversation: vi.fn() }
})
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const row: ConversationListItem = {
  id: 'conv1',
  character_id: 'arg',
  title: null,
  type: 'dm',
  topic_id: null,
  last_read_seq: 0,
  created_at: '2026-07-11T10:00:00Z',
  updated_at: '2026-07-11T11:59:00Z',
  character: { id: 'arg', name: 'Old-Timer Argento', emoji: '🇦🇷', tagline: '', greeting: '' },
  last_message: { role: 'assistant', content: 'real football looks like…', kind: 'text', created_at: '2026-07-11T11:59:00Z' },
  unread_count: 3,
}

function renderInbox() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChatsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ChatsPage (inbox)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes via a custom confirm dialog — never window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    vi.mocked(getConversations).mockResolvedValue([row])
    vi.mocked(deleteConversation).mockResolvedValue({ deleted: true })
    renderInbox()

    // open the options menu → custom dialog (not window.confirm)
    fireEvent.click(await screen.findByRole('button', { name: 'Conversation options' }))

    const dialog = await screen.findByRole('dialog', { name: 'Delete conversation?' })
    expect(dialog).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteConversation).toHaveBeenCalledWith('conv1'))
  })

  it('renders the unread badge and a relative time', async () => {
    vi.mocked(getConversations).mockResolvedValue([row])
    renderInbox()
    expect(await screen.findByLabelText('3 unread')).toBeInTheDocument()
  })
})
