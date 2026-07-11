import type { ReactNode } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { getConversations } from '@/lib/chat'

/** Nav glyphs shared by the desktop sidebar and the mobile tab bar. */
const NAV_ICONS: Record<string, ReactNode> = {
  feed: <path d="M3 10.5 12 3l9 7.5M5 9v11h14V9" />,
  topics: <path d="M12 3s5 3.5 5 8a5 5 0 0 1-10 0c0-1.5.8-2.6.8-2.6s.7 1.4 1.7 1.4c0-2.2.9-3.8 2.5-6.2z" />,
  messages: <path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" />,
  me: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </>
  ),
}

interface NavItem {
  key: string
  path: string
  label: string
}

const NAV: NavItem[] = [
  { key: 'feed', path: '/', label: 'For You' },
  { key: 'topics', path: '/topics', label: 'Topics' },
  { key: 'messages', path: '/chats', label: 'Chats' },
  { key: 'me', path: '/me', label: 'Me' },
]

// Mobile tab bar keeps the design's Home wording for the feed.
const TAB_LABELS: Record<string, string> = { feed: 'Home', topics: 'Topics', messages: 'Chats', me: 'Me' }

/**
 * Responsive app shell — one shell, two frames switching at Tailwind `lg`.
 * Mobile (< lg): status spacer + content + bottom TabBar; TopTabs float over
 * the feed screens. Desktop (lg+): 240px Sidebar with RECENT chats + content.
 * Rendered as a layout route; pages render into <Outlet/>.
 */
export function AppShell() {
  const { pathname } = useLocation()
  const activeKey =
    pathname === '/topics'
      ? 'topics'
      : pathname === '/chats'
        ? 'messages'
        : pathname === '/me'
          ? 'me'
          : pathname === '/'
            ? 'feed'
            : null
  const showTopTabs = pathname === '/' || pathname === '/topics'

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#0c0c0d] text-white lg:flex-row">
      <DesktopSidebar activeKey={activeKey} />
      {/* status-bar spacer (mobile only) */}
      <div className="h-[30px] shrink-0 lg:hidden" />
      <main className="relative flex min-h-0 flex-1 flex-col">
        {showTopTabs && <TopTabs active={activeKey === 'topics' ? 'topics' : 'feed'} />}
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </main>
      <MobileTabBar activeKey={activeKey} />
    </div>
  )
}

function NavIcon({ name, active, size }: { name: string; active: boolean; size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={active ? 'var(--brand)' : 'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {NAV_ICONS[name]}
    </svg>
  )
}

function TopTabs({ active }: { active: 'feed' | 'topics' }) {
  const tab = (key: 'feed' | 'topics', to: string, label: string) => (
    <Link
      to={to}
      style={{
        fontSize: 15,
        fontWeight: active === key ? 700 : 500,
        color: active === key ? '#fff' : 'rgba(255,255,255,.55)',
        textShadow: '0 1px 3px rgba(0,0,0,.5)',
        padding: '0 2px 3px',
        borderBottom: active === key ? '2px solid var(--brand)' : '2px solid transparent',
        transition: 'color .2s',
      }}
    >
      {label}
    </Link>
  )
  return (
    <div className="lg:hidden" style={{ position: 'absolute', top: 6, left: 0, right: 0, zIndex: 20, display: 'flex', justifyContent: 'center', gap: 22 }}>
      {tab('feed', '/', 'For You')}
      {tab('topics', '/topics', 'Topics')}
    </div>
  )
}

function MobileTabBar({ activeKey }: { activeKey: string | null }) {
  return (
    <nav
      className="lg:hidden"
      style={{ height: 56, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-around', borderTop: '1px solid rgba(255,255,255,.08)', background: '#0c0c0d', zIndex: 35 }}
    >
      {NAV.map((item) => {
        const on = activeKey === item.key
        return (
          <Link
            key={item.key}
            to={item.path}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: on ? 600 : 400, color: on ? '#fff' : 'rgba(255,255,255,.42)' }}
          >
            <NavIcon name={item.key} active={on} size={21} />
            {TAB_LABELS[item.key]}
          </Link>
        )
      })}
    </nav>
  )
}

function DesktopSidebar({ activeKey }: { activeKey: string | null }) {
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: getConversations })
  const recents = (conversations.data ?? [])
    .slice()
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
    .slice(0, 6)

  return (
    <aside className="hidden w-60 flex-none flex-col border-r border-white/10 bg-[#0a0a0b] px-3 py-5 lg:flex">
      <Link to="/" className="flex items-center gap-2 px-2.5 pb-[18px] text-[19px] font-extrabold">
        ⚽ FanMouth
      </Link>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const on = activeKey === item.key
          return (
            <Link
              key={item.key}
              to={item.path}
              className="flex items-center gap-3 rounded-[10px] px-3 py-[11px] text-[15px]"
              style={{ background: on ? 'rgba(255,255,255,.08)' : 'transparent', color: on ? '#fff' : 'rgba(255,255,255,.62)', fontWeight: on ? 700 : 500 }}
            >
              <NavIcon name={item.key} active={on} size={22} />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="mx-2.5 mb-2 mt-[22px] text-[11px] font-semibold tracking-[.05em] text-white/40">RECENT</div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {recents.map((conv) => (
          <Link
            key={conv.id}
            to={`/chat/${conv.id}`}
            className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-white/80"
          >
            <span className="text-[22px] leading-none">{conv.character?.emoji ?? '💬'}</span>
            <span className="truncate text-[13.5px] font-semibold">{conv.character?.name ?? 'Chat'}</span>
          </Link>
        ))}
      </div>
    </aside>
  )
}
