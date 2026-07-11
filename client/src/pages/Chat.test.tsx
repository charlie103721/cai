import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Chat from './Chat'
import { getConversation } from '@/lib/chat'

// ── fake WebSocket manager ───────────────────────────────
type Listener = (frame: unknown) => void
const listeners: Record<string, Set<Listener>> = {}
let lastClientMsgId = ''
const sendMessage = vi.fn(async (_conv: string, _content: string, clientMsgId: string) => {
  lastClientMsgId = clientMsgId
  return { transport: 'socket' as const }
})
const markRead = vi.fn(async () => {})
const fakeWs = {
  isOpen: true,
  on: (type: string, cb: Listener) => {
    ;(listeners[type] ??= new Set()).add(cb)
    return () => listeners[type].delete(cb)
  },
  sendMessage,
  markRead,
}
function emit(type: string, frame: unknown) {
  act(() => listeners[type]?.forEach((cb) => cb(frame)))
}

vi.mock('@/hooks/useWs', () => ({ useWs: () => fakeWs }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/chat', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chat')>('@/lib/chat')
  return {
    ...actual,
    getConversation: vi.fn(),
    favoriteCharacter: vi.fn(),
    unfavoriteCharacter: vi.fn(),
  }
})

function assistantMsg(id: string, content: string) {
  return {
    id,
    conversation_id: 'conv1',
    role: 'assistant' as const,
    content,
    seq: 1,
    sender_character_id: 'arg',
    kind: 'text',
    status: 'complete',
    media_url: null,
    client_msg_id: null,
    created_at: '2026-07-11T11:00:00Z',
  }
}

function renderChat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/chat/conv1']}>
        <Routes>
          <Route path="/chat/:conversationId" element={<Chat />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(listeners)) delete listeners[k]
  lastClientMsgId = ''
  vi.mocked(getConversation).mockResolvedValue({
    conversation: {
      id: 'conv1',
      character_id: 'arg',
      title: null,
      type: 'dm',
      topic_id: null,
      last_read_seq: 0,
      created_at: '2026-07-11T10:00:00Z',
      updated_at: '2026-07-11T10:00:00Z',
    },
    messages: [],
    character: { id: 'arg', name: 'Old-Timer Argento', emoji: '🇦🇷', tagline: 't', greeting: 'g' },
  })
})

async function sendText(text: string) {
  const box = await screen.findByPlaceholderText(/Message Old-Timer/)
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(sendMessage).toHaveBeenCalled())
}

describe('Chat — live over the socket', () => {
  it('appends one bubble per message frame (multi-bubble turn)', async () => {
    renderChat()
    await sendText('hi')
    expect(await screen.findByText('hi')).toBeInTheDocument()

    emit('ack', {
      type: 'ack',
      clientMsgId: lastClientMsgId,
      userMessage: { ...assistantMsg('u1', 'hi'), role: 'user', client_msg_id: lastClientMsgId },
    })
    emit('message', { type: 'message', conversationId: 'conv1', message: assistantMsg('m1', 'reply one') })
    emit('message', { type: 'message', conversationId: 'conv1', message: assistantMsg('m2', 'reply two') })

    expect(await screen.findByText('reply one')).toBeInTheDocument()
    expect(await screen.findByText('reply two')).toBeInTheDocument()
  })

  it('rolls back the optimistic bubble and restores the composer on an error frame', async () => {
    renderChat()
    await sendText('hello there')
    // optimistic bubble is a <div>; composer is cleared → exactly one node
    const bubble = await screen.findByText('hello there')
    expect(bubble.tagName).toBe('DIV')

    emit('error', { type: 'error', clientMsgId: lastClientMsgId, code: 'CHAT_UNAVAILABLE' })

    // bubble removed; the only remaining node with that text is the restored composer
    await waitFor(() => {
      const box = screen.getByPlaceholderText(/Message Old-Timer/) as HTMLTextAreaElement
      expect(box.value).toBe('hello there')
    })
    const matches = screen.getAllByText('hello there')
    expect(matches).toHaveLength(1)
    expect(matches[0].tagName).toBe('TEXTAREA')
  })

  it('shows the inline signup prompt on a guest-limit error frame', async () => {
    renderChat()
    await sendText('one more')
    emit('error', { type: 'error', clientMsgId: lastClientMsgId, code: 'GUEST_LIMIT_REACHED' })

    expect(await screen.findByText(/used up the free chats/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument()
  })
})
