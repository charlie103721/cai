import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TopicsPage from './TopicsPage'
import type { DailyTopic } from '@/lib/chat'
import { getTodayTopics, createConversation } from '@/lib/chat'

vi.mock('@/lib/chat', () => ({
  getTodayTopics: vi.fn(),
  createConversation: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const topic: DailyTopic = {
  id: 't1',
  title: 'Final Preview',
  headline: 'Who lifts the trophy?',
  content: 'c',
  topic_date: '2026-07-11',
  heat: 67000,
  tags: ['Argentina', 'Title Pick'],
  hue: 28,
  pinned: true,
  participants: [
    { id: 'arg', name: 'Old-Timer Argento', emoji: '🇦🇷' },
    { id: 'rival', name: 'The Hater', emoji: '😤' },
  ],
}

function renderTopics() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TopicsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TopicsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a quiet empty state pointing to the For You feed when there are no topics', async () => {
    vi.mocked(getTodayTopics).mockResolvedValueOnce([])
    renderTopics()

    expect(await screen.findByText('No topics today')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Go to For You/ })).toHaveAttribute('href', '/')
  })

  it('seeds a chat with the first participant and the topic id on Chat →', async () => {
    vi.mocked(getTodayTopics).mockResolvedValueOnce([topic])
    vi.mocked(createConversation).mockResolvedValueOnce({
      conversation: { id: 'conv1' },
    } as Awaited<ReturnType<typeof createConversation>>)
    renderTopics()

    const cta = await screen.findByRole('button', { name: /Chat/ })
    fireEvent.click(cta)

    await waitFor(() => expect(createConversation).toHaveBeenCalledWith('arg', 't1'))
  })

  it('renders the topic heat with the compact formatter', async () => {
    vi.mocked(getTodayTopics).mockResolvedValueOnce([topic])
    renderTopics()

    expect(await screen.findByText(/Heat 6\.7w/)).toBeInTheDocument()
  })
})
