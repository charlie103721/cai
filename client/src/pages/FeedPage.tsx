import { useState, type UIEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMediaQuery } from 'usehooks-ts'
import { getCharacters, type PublicCharacter } from '@/lib/chat'
import { ActionRail } from '@/components/ActionRail'
import { Verified } from '@/components/Verified'
import { useStartChat } from '@/hooks/useStartChat'

/** Vertical scroll-snap feed of persona slides — mobile full-bleed, desktop card. */
export default function FeedPage() {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const characters = useQuery({ queryKey: ['characters'], queryFn: getCharacters })
  const startChat = useStartChat()
  const [idx, setIdx] = useState(0)

  const list = characters.data ?? []
  const onChat = (id: string) => startChat.mutate({ characterId: id })

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setIdx(Math.round(el.scrollTop / el.clientHeight))
  }

  if (characters.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-white/40">Loading…</div>
    )
  }
  if (characters.isError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-white/40">
        Could not load the feed — please try again.
      </div>
    )
  }

  return (
    <div
      className="relative h-full overflow-y-auto snap-y snap-mandatory"
      style={{ scrollbarWidth: 'none' }}
      onScroll={isDesktop ? undefined : onScroll}
    >
      {list.map((c) =>
        isDesktop ? (
          <DesktopSlide key={c.id} c={c} onChat={() => onChat(c.id)} />
        ) : (
          <MobileSlide key={c.id} c={c} onChat={() => onChat(c.id)} />
        ),
      )}
      {!isDesktop && list.length > 0 && <Progress n={list.length} i={idx} />}
    </div>
  )
}

function Progress({ n, i }: { n: number; i: number }) {
  return (
    <div style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 5, zIndex: 15 }}>
      {Array.from({ length: n }).map((_, k) => (
        <span key={k} style={{ width: 3, height: k === i ? 16 : 7, borderRadius: 2, background: k === i ? 'var(--brand)' : 'rgba(255,255,255,.3)', transition: 'all .25s' }} />
      ))}
    </div>
  )
}

function sceneBg(hue: number) {
  return `radial-gradient(125% 70% at 50% 20%, hsl(${hue} 46% 26%) 0%, hsl(${hue} 40% 12%) 46%, #0a0a0c 100%)`
}
function washBg(hue: number) {
  return `radial-gradient(60% 40% at 80% 88%, hsl(${hue} 55% 30% / .35), transparent 70%)`
}
function glowBg(hue: number) {
  return `radial-gradient(circle, hsl(${hue} 70% 55% / .55), transparent 68%)`
}

function CtaOverlay({ c, onChat, name, greet, cta }: { c: PublicCharacter; onChat: () => void; name: number; greet: number; cta: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: 'rise .45s ease both' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: name, fontWeight: 700 }}>@{c.name}</span>
        <Verified />
      </div>
      <div style={{ fontSize: greet, lineHeight: 1.55, color: 'rgba(255,255,255,.9)' }}>{c.greeting}</div>
      <button onClick={onChat} style={{ alignSelf: 'flex-start', marginTop: 4, fontSize: cta, fontWeight: 600, color: 'var(--brand-foreground)', background: 'var(--brand)', border: 'none', borderRadius: '9999px', padding: '11px 22px', cursor: 'pointer', boxShadow: '0 8px 22px hsl(var(--brand-glow) / .4)' }}>
        Start chatting →
      </button>
    </div>
  )
}

function MobileSlide({ c, onChat }: { c: PublicCharacter; onChat: () => void }) {
  return (
    <div className="snap-start" style={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: sceneBg(c.hue) }}>
      <div style={{ position: 'absolute', inset: 0, background: washBg(c.hue) }} />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <div style={{ position: 'absolute', width: 230, height: 230, borderRadius: '9999px', background: glowBg(c.hue), filter: 'blur(30px)', animation: 'glow 5s ease-in-out infinite' }} />
        <span style={{ fontSize: 140, filter: 'drop-shadow(0 14px 34px rgba(0,0,0,.5))', animation: 'float 6s ease-in-out infinite', position: 'relative' }}>{c.emoji}</span>
      </div>
      <ActionRail character={c} variant="mobile" onChat={onChat} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '22px 76px 24px 18px', background: 'linear-gradient(transparent, rgba(0,0,0,.55) 30%, rgba(0,0,0,.82))' }}>
        <CtaOverlay c={c} onChat={onChat} name={18} greet={13.5} cta={14} />
      </div>
    </div>
  )
}

function DesktopSlide({ c, onChat }: { c: PublicCharacter; onChat: () => void }) {
  return (
    <div className="snap-start" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20 }}>
        <div style={{ position: 'relative', width: 440, height: 660, borderRadius: 20, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.5)', background: sceneBg(c.hue) }}>
          <div style={{ position: 'absolute', inset: 0, background: washBg(c.hue) }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ position: 'absolute', width: 260, height: 260, borderRadius: '9999px', background: `radial-gradient(circle, hsl(${c.hue} 70% 55% / .5), transparent 68%)`, filter: 'blur(34px)', animation: 'glow 5s ease-in-out infinite' }} />
            <span style={{ fontSize: 168, filter: 'drop-shadow(0 16px 38px rgba(0,0,0,.5))', animation: 'float 6s ease-in-out infinite', position: 'relative' }}>{c.emoji}</span>
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '26px 22px', background: 'linear-gradient(transparent, rgba(0,0,0,.55) 30%, rgba(0,0,0,.82))' }}>
            <CtaOverlay c={c} onChat={onChat} name={20} greet={14.5} cta={15} />
          </div>
        </div>
        <ActionRail character={c} variant="desktop" onChat={onChat} />
      </div>
    </div>
  )
}
