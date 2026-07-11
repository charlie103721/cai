import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from './AppShell'

vi.mock('@/lib/chat', () => ({
  getConversations: vi.fn().mockResolvedValue([]),
}))

function renderShell() {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<div>FEED_SCREEN</div>} />
            <Route path="/topics" element={<div>TOPICS_SCREEN</div>} />
            <Route path="/chats" element={<div>CHATS_SCREEN</div>} />
            <Route path="/me" element={<div>ME_SCREEN</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AppShell', () => {
  it('renders the feed at "/" and switches routes when tabs are clicked', () => {
    renderShell()
    expect(screen.getByText('FEED_SCREEN')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('link', { name: 'Topics' })[0])
    expect(screen.getByText('TOPICS_SCREEN')).toBeInTheDocument()
    expect(screen.queryByText('FEED_SCREEN')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('link', { name: 'Chats' })[0])
    expect(screen.getByText('CHATS_SCREEN')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('link', { name: 'Me' })[0])
    expect(screen.getByText('ME_SCREEN')).toBeInTheDocument()
  })

  it('floats the For You / Topics top tabs only over feed screens', () => {
    renderShell()
    // On the feed screen "For You" appears twice: the sidebar nav + the floating
    // TopTabs. (jsdom renders both frames since there's no CSS to hide one.)
    expect(screen.getAllByRole('link', { name: 'For You' })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('link', { name: 'Chats' })[0])
    // On the Chats screen the TopTabs are gone — only the sidebar "For You" left.
    expect(screen.getAllByRole('link', { name: 'For You' })).toHaveLength(1)
  })
})
