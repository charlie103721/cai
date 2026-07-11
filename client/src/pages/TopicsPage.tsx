import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useMediaQuery } from 'usehooks-ts'
import { getTodayTopics, type DailyTopic } from '@/lib/chat'
import { fmt } from '@/lib/format'
import { useStartChat } from '@/hooks/useStartChat'

/** Daily-topic reels — same scroll-snap pattern as the feed, over today's topics. */
export default function TopicsPage() {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const topics = useQuery({ queryKey: ['topics-today'], queryFn: getTodayTopics })
  const startChat = useStartChat()

  const onChat = (t: DailyTopic) => {
    const first = t.participants[0]
    if (!first) return
    startChat.mutate({ characterId: first.id, topicId: t.id })
  }

  if (topics.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-white/40">Loading…</div>
  }

  const list = topics.data ?? []

  if (list.length === 0) {
    return <EmptyReel />
  }

  return (
    <div className="relative h-full overflow-y-auto snap-y snap-mandatory" style={{ scrollbarWidth: 'none' }}>
      {list.map((t) =>
        isDesktop ? (
          <DesktopReel key={t.id} t={t} onChat={() => onChat(t)} />
        ) : (
          <MobileReel key={t.id} t={t} onChat={() => onChat(t)} />
        ),
      )}
    </div>
  )
}

function EmptyReel() {
  return (
    <div
      className="snap-start"
      style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '0 34px', textAlign: 'center', background: 'radial-gradient(125% 70% at 50% 20%, hsl(42 30% 20%) 0%, hsl(28 30% 10%) 46%, #0a0a0c 100%)' }}
    >
      <span style={{ fontSize: 66, animation: 'float 6s ease-in-out infinite' }}>🔥</span>
      <div style={{ fontSize: 18, fontWeight: 800 }}>No topics today</div>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,.6)', lineHeight: 1.5 }}>
        Check back later — meanwhile, meet the characters over on the For You feed.
      </div>
      <Link to="/" style={{ marginTop: 6, fontSize: 14, fontWeight: 600, color: 'var(--brand-foreground)', background: 'var(--brand)', borderRadius: '9999px', padding: '11px 22px' }}>
        Go to For You →
      </Link>
    </div>
  )
}

function topicSceneBg(hue: number) {
  return `radial-gradient(125% 70% at 50% 20%, hsl(${hue} 46% 26%) 0%, hsl(${hue} 40% 12%) 46%, #0a0a0c 100%)`
}
function topicWashBg(hue: number) {
  return `radial-gradient(60% 40% at 80% 88%, hsl(${hue} 55% 30% / .35), transparent 70%)`
}

function ReelBody({ t, big }: { t: DailyTopic; big: number }) {
  return (
    <>
      <div style={{ position: 'absolute', top: '26%', width: 180, height: 180, borderRadius: '9999px', background: `radial-gradient(circle, hsl(${t.hue} 80% 55% / .4), transparent 68%)`, filter: 'blur(26px)' }} />
      <span style={{ fontSize: big === 30 ? 78 : 66, position: 'relative', animation: 'float 6s ease-in-out infinite' }}>🔥</span>
      <div style={{ fontSize: big === 30 ? 13 : 12.5, fontWeight: 700, letterSpacing: '.04em', color: 'var(--brand)' }}>Today’s Topic · Heat {fmt(t.heat)}</div>
      <div style={{ fontSize: big === 30 ? 15 : 14, color: 'rgba(255,255,255,.65)' }}>{t.title}</div>
      <div style={{ fontSize: big, fontWeight: 800, lineHeight: 1.3 }}>{t.headline}</div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'center' }}>
        {t.tags.map((x, i) => (
          <span key={i} style={{ fontSize: 11.5, color: 'rgba(255,255,255,.8)', background: 'rgba(255,255,255,.1)', borderRadius: 12, padding: '3px 11px' }}>#{x}</span>
        ))}
      </div>
    </>
  )
}

function ReelFooter({ t, onChat }: { t: DailyTopic; onChat: () => void }) {
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '20px 18px 24px', background: 'linear-gradient(transparent, rgba(0,0,0,.82) 55%)', display: 'flex', flexDirection: 'column', gap: 12, animation: 'rise .45s ease both' }}>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,.85)' }}>Pick a character and dive into this topic</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {t.participants.map((p) => (
          <span key={p.id} style={{ width: 40, height: 40, borderRadius: '9999px', background: 'rgba(255,255,255,.14)', border: '2px solid rgba(255,255,255,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19 }}>{p.emoji}</span>
        ))}
        <button onClick={onChat} disabled={t.participants.length === 0} style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 600, color: 'var(--brand-foreground)', background: 'var(--brand)', border: 'none', borderRadius: '9999px', padding: '11px 20px', cursor: t.participants.length ? 'pointer' : 'default', opacity: t.participants.length ? 1 : 0.5 }}>Chat →</button>
      </div>
    </div>
  )
}

function MobileReel({ t, onChat }: { t: DailyTopic; onChat: () => void }) {
  return (
    <div className="snap-start" style={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: topicSceneBg(t.hue) }}>
      <div style={{ position: 'absolute', inset: 0, background: topicWashBg(t.hue) }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '0 34px', textAlign: 'center', position: 'relative' }}>
        <ReelBody t={t} big={26} />
      </div>
      <ReelFooter t={t} onChat={onChat} />
    </div>
  )
}

function DesktopReel({ t, onChat }: { t: DailyTopic; onChat: () => void }) {
  return (
    <div className="snap-start" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20 }}>
        <div style={{ position: 'relative', width: 440, height: 660, borderRadius: 20, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.5)', background: topicSceneBg(t.hue) }}>
          <div style={{ position: 'absolute', inset: 0, background: topicWashBg(t.hue) }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '0 40px', textAlign: 'center' }}>
            <ReelBody t={t} big={30} />
          </div>
          <ReelFooter t={t} onChat={onChat} />
        </div>
        {/* rail-width spacer keeps the card aligned with the persona feed */}
        <div style={{ width: 52 }} />
      </div>
    </div>
  )
}
