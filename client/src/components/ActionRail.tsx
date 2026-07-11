import { useState, type CSSProperties } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fmt } from '@/lib/format'
import {
  likeCharacter,
  favoriteCharacter,
  unfavoriteCharacter,
  type PublicCharacter,
} from '@/lib/chat'

type Variant = 'mobile' | 'desktop'

interface Sizes {
  avatar: number
  badge: number
  btn: number
  heart: number
  bubble: number
  share: number
  count: number
}

const SIZES: Record<Variant, Sizes> = {
  mobile: { avatar: 50, badge: 22, btn: 46, heart: 36, bubble: 35, share: 34, count: 12 },
  desktop: { avatar: 56, badge: 24, btn: 52, heart: 40, bubble: 39, share: 38, count: 13 },
}

/**
 * TikTok-style action rail beside a persona slide/card: follow, like, chat, share.
 * Shared between the mobile full-bleed feed and the desktop card feed — only the
 * icon sizes and outer positioning differ (`variant`). All engagement is
 * optimistic against the real favorites/likes APIs and rolls back on error.
 */
export function ActionRail({
  character,
  variant,
  onChat,
}: {
  character: PublicCharacter
  variant: Variant
  onChat: () => void
}) {
  const s = SIZES[variant]
  const [liked, setLiked] = useState(character.liked)
  const [likeCount, setLikeCount] = useState(character.like_count)
  const [pop, setPop] = useState(0)
  const [favorited, setFavorited] = useState(character.favorited)

  const like = useMutation({
    mutationFn: () => likeCharacter(character.id),
    onMutate: () => {
      const prev = { liked, likeCount }
      setPop((p) => p + 1)
      setLiked((v) => !v)
      setLikeCount((n) => n + (prev.liked ? -1 : 1))
      return prev
    },
    onError: (_e, _v, ctx) => {
      if (ctx) {
        setLiked(ctx.liked)
        setLikeCount(ctx.likeCount)
      }
      toast.error('Could not update your like — please try again.')
    },
    onSuccess: (data) => {
      setLiked(data.liked)
      setLikeCount(data.like_count)
    },
  })

  const favorite = useMutation({
    mutationFn: () => (favorited ? unfavoriteCharacter(character.id) : favoriteCharacter(character.id)),
    onMutate: () => {
      const prev = favorited
      setFavorited((v) => !v)
      return prev
    },
    onError: (_e, _v, prev) => {
      if (prev !== undefined) setFavorited(prev)
      toast.error('Could not update follow — please try again.')
    },
    onSuccess: (data) => {
      setFavorited(data.favorited)
    },
  })

  const share = async () => {
    const url = typeof window !== 'undefined' ? window.location.origin + '/' : ''
    const shareData = { title: 'FanMouth', text: `Chat with ${character.name} on FanMouth`, url }
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share(shareData)
        return
      }
    } catch {
      return // user cancelled the native sheet — nothing to do
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied to clipboard')
    } catch {
      toast.error('Could not share this character')
    }
  }

  const btn: CSSProperties = {
    width: s.btn,
    height: s.btn,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    filter: 'drop-shadow(0 2px 5px rgba(0,0,0,.45))',
  }
  const wrap: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: variant === 'mobile' ? 3 : 4 }
  const n: CSSProperties = { fontSize: s.count, fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,.6)' }

  const outer: CSSProperties =
    variant === 'mobile'
      ? { position: 'absolute', right: 10, bottom: 150, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', zIndex: 10 }
      : { display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }

  return (
    <div style={outer}>
      <button
        aria-label={favorited ? 'Unfollow' : 'Follow'}
        onClick={() => favorite.mutate()}
        style={{ position: 'relative', marginBottom: 6, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.5))', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <div style={{ width: s.avatar, height: s.avatar, borderRadius: '9999px', background: 'rgba(255,255,255,.16)', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: variant === 'mobile' ? 25 : 27 }}>
          {character.emoji}
        </div>
        <div style={{ position: 'absolute', bottom: -10, left: '50%', transform: 'translateX(-50%)', width: s.badge, height: s.badge, borderRadius: '9999px', background: 'var(--brand)', color: 'var(--brand-foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, border: '2px solid #0c0c0d' }}>
          {favorited ? '✓' : '+'}
        </div>
      </button>

      <div style={wrap}>
        <button aria-label="Like" onClick={() => like.mutate()} style={btn}>
          <svg key={pop} viewBox="0 0 24 24" width={s.heart} height={s.heart} fill={liked ? 'var(--brand)' : '#fff'} style={{ animation: pop ? 'pop .4s ease' : 'none' }}>
            <path d="M12 21.6l-1.5-1.35C5.2 15.5 2 12.6 2 9.1 2 6.4 4.1 4.3 6.8 4.3c1.5 0 3 .7 3.9 1.8l1.3 1.5 1.3-1.5c.9-1.1 2.4-1.8 3.9-1.8 2.7 0 4.8 2.1 4.8 4.8 0 3.5-3.2 6.4-8.5 11.2L12 21.6z" />
          </svg>
        </button>
        <span style={n}>{fmt(likeCount)}</span>
      </div>

      <div style={wrap}>
        <button aria-label="Chat" style={btn} onClick={onChat}>
          <svg viewBox="0 0 24 24" width={s.bubble} height={s.bubble} fill="#fff">
            <path d="M12 3C6.9 3 2.8 6.5 2.8 10.8c0 2.4 1.3 4.6 3.4 6-.2 1-.8 2.3-1.7 3.3-.2.2 0 .6.3.5 1.9-.4 3.5-1.2 4.6-1.9.8.2 1.7.3 2.6.3 5.1 0 9.2-3.5 9.2-7.8S17.1 3 12 3z" />
          </svg>
        </button>
        <span style={n}>{fmt(character.chat_count)}</span>
      </div>

      <div style={wrap}>
        <button aria-label="Share" style={btn} onClick={() => void share()}>
          <svg viewBox="0 0 24 24" width={s.share} height={s.share} fill="#fff">
            <path d="M21.6 11.2l-8.3-6.9c-.6-.5-1.5-.1-1.5.7v3.2C6.4 8.5 2.5 12 2.5 18.5c0 .6.8.9 1.2.4 2-2.6 4.7-3.9 8.1-4v3.2c0 .8.9 1.2 1.5.7l8.3-6.9c.5-.4.5-1.1 0-1.5z" />
          </svg>
        </button>
        <span style={n}>Share</span>
      </div>
    </div>
  )
}
