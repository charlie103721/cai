import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalStorage } from 'usehooks-ts'
import { EditProfileModal } from '@/components/EditProfileModal'
import { useAuth } from '@/hooks/useAuth'
import { useStartChat } from '@/hooks/useStartChat'
import { signOut } from '@/lib/auth'
import { fmt } from '@/lib/format'
import { getMyProfile, getMyStats, updateMyProfile } from '@/lib/me'
import { getFavorites } from '@/lib/chat'

const SETTINGS_ICONS = {
  notifications: 'M12 3a6 6 0 0 0-6 6v3l-1.5 3h15L18 12V9a6 6 0 0 0-6-6zM9.5 18a2.5 2.5 0 0 0 5 0',
  appearance: 'M12 3v18M3 12h18',
  language: 'M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  help: 'M12 17h.01M12 13a2 2 0 1 0-2-2',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
}

function avatarBg(hue: number): string {
  return `radial-gradient(circle at 50% 35%, hsl(${hue} 42% 26%), hsl(${hue} 40% 12%))`
}

/**
 * Profile — gradient hero banner + overlapping avatar, stats row, favorites
 * scroller, settings list. Authed users read/write the real profile
 * (`/api/me/profile`); guests keep a display name + team in localStorage and
 * get a "claim your @handle" signup nudge. Body centers at max-560px on desktop.
 */
export default function MePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isAuthenticated } = useAuth()
  const startChat = useStartChat()
  const [editing, setEditing] = useState(false)

  const [guestName, setGuestName] = useLocalStorage('fanmouth:displayName', '')
  const [guestTeam, setGuestTeam] = useLocalStorage('fanmouth:favoriteTeam', '')

  const profile = useQuery({
    queryKey: ['me', 'profile'],
    queryFn: getMyProfile,
    enabled: isAuthenticated,
  })
  const stats = useQuery({ queryKey: ['me', 'stats'], queryFn: getMyStats })
  const favorites = useQuery({ queryKey: ['favorites'], queryFn: getFavorites })

  const handle = isAuthenticated
    ? (profile.data?.handle ?? profile.data?.name ?? 'me')
    : guestName || 'guest'
  const team = isAuthenticated ? (profile.data?.favorite_team ?? '⚽') : guestTeam || '⚽'
  const bio = `World Cup die-hard · Team ${team}`

  const statRow: Array<[string, string]> = [
    [fmt(stats.data?.chats ?? 0), 'Chats'],
    [fmt(stats.data?.favorites ?? 0), 'Favorites'],
    [fmt(stats.data?.likes ?? 0), 'Likes'],
  ]

  const onSave = async ({ name, team: nextTeam }: { name: string; team: string }) => {
    if (isAuthenticated) {
      await updateMyProfile({ handle: name, favorite_team: nextTeam })
      await queryClient.invalidateQueries({ queryKey: ['me', 'profile'] })
    } else {
      setGuestName(name)
      setGuestTeam(nextTeam)
    }
  }

  const favs = favorites.data ?? []

  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
      {/* hero banner */}
      <div
        className="relative h-[118px] lg:h-[150px]"
        style={{ background: 'radial-gradient(120% 140% at 50% 0%, hsl(42 46% 30%), hsl(28 40% 14%) 70%, #0c0c0d)' }}
      >
        <button
          aria-label="Settings"
          className="absolute right-3.5 top-3.5 flex size-[34px] items-center justify-center rounded-full text-[15px]"
          style={{ background: 'rgba(0,0,0,.28)', border: '1px solid rgba(255,255,255,.16)', color: '#fff' }}
        >
          ⚙
        </button>
      </div>

      <div className="mx-auto w-full max-w-[560px] px-5 pb-10 lg:px-6">
        {/* avatar + identity */}
        <div className="-mt-[46px] flex flex-col items-center gap-[11px] lg:-mt-[52px] lg:gap-3" style={{ animation: 'rise .4s ease both' }}>
          <div
            className="flex size-[92px] items-center justify-center rounded-full text-[46px] lg:size-[104px] lg:text-[52px]"
            style={{ background: 'radial-gradient(circle at 50% 30%, hsl(42 46% 28%), #14110a)', border: '3px solid #0c0c0d', boxShadow: '0 0 0 2px var(--brand)' }}
          >
            ⚽
          </div>
          <div className="text-center">
            <div className="text-xl font-extrabold lg:text-[22px]">@{handle}</div>
            <div className="mt-[3px] text-[12.5px] text-white/55 lg:text-[13px]">{bio}</div>
            {!isAuthenticated && (
              <button
                onClick={() => navigate('/signup')}
                className="mt-2 text-[12.5px] font-semibold"
                style={{ color: 'var(--brand)' }}
              >
                Sign up to claim your @handle →
              </button>
            )}
          </div>

          {/* stats */}
          <div className="my-0.5 flex w-full max-w-[320px] justify-around border-y border-white/[.08] py-2">
            {statRow.map(([value, label]) => (
              <div key={label} className="flex flex-col items-center gap-px">
                <span className="text-lg font-extrabold lg:text-xl">{value}</span>
                <span className="text-[11px] text-white/50 lg:text-xs">{label}</span>
              </div>
            ))}
          </div>

          <button
            onClick={() => setEditing(true)}
            className="w-full max-w-[320px] rounded-full py-[11px] text-sm font-bold lg:py-3"
            style={{ background: 'var(--brand)', color: 'var(--brand-foreground)' }}
          >
            Edit profile
          </button>
        </div>

        {/* favorites */}
        <div className="mb-3 mt-6 text-xs font-bold tracking-[.05em] text-white/45">★ FAVORITES</div>
        {favs.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-white/12 px-3 py-5 text-center text-[13px] text-white/40">
            No favorites yet — tap ☆ in a chat to save a character here.
          </div>
        ) : (
          <div className="flex gap-3.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {favs.map((c) => (
              <button
                key={c.id}
                onClick={() => startChat.mutate({ characterId: c.id })}
                className="flex w-[66px] flex-none flex-col items-center gap-[7px] lg:w-[76px] lg:gap-2"
              >
                <div
                  className="flex size-[60px] items-center justify-center rounded-full text-[29px] lg:size-[66px] lg:text-[32px]"
                  style={{ background: avatarBg(c.hue), border: '2px solid var(--brand)' }}
                >
                  {c.emoji}
                </div>
                <span className="max-w-full truncate text-center text-[10.5px] text-white/75 lg:text-[11px]">
                  {c.name}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* settings */}
        <div className="mb-2 mt-6 text-xs font-bold tracking-[.05em] text-white/45">SETTINGS</div>
        <div className="overflow-hidden rounded-[14px] border border-white/[.08]">
          <SettingRow icon={SETTINGS_ICONS.notifications} label="Notifications" value="On" />
          <SettingRow icon={SETTINGS_ICONS.appearance} label="Appearance" value="Dark" first={false} />
          <SettingRow icon={SETTINGS_ICONS.language} label="Language" value="English" first={false} />
          <SettingRow
            icon={SETTINGS_ICONS.help}
            label="Help & feedback"
            first={false}
            href="mailto:support@fanmouth.app"
          />
          {isAuthenticated && (
            <SettingRow
              icon={SETTINGS_ICONS.logout}
              label="Log out"
              first={false}
              onClick={() => void signOut()}
            />
          )}
        </div>
      </div>

      {editing && (
        <EditProfileModal
          isGuest={!isAuthenticated}
          initialName={isAuthenticated ? (profile.data?.handle ?? '') : guestName}
          initialTeam={isAuthenticated ? (profile.data?.favorite_team ?? '') : guestTeam}
          onClose={() => setEditing(false)}
          onSave={onSave}
        />
      )}
    </div>
  )
}

function SettingRow({
  icon,
  label,
  value,
  first = true,
  href,
  onClick,
}: {
  icon: string
  label: string
  value?: string
  first?: boolean
  href?: string
  onClick?: () => void
}) {
  const interactive = !!href || !!onClick
  const inner = (
    <>
      <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="lg:h-5 lg:w-5">
        <path d={icon} />
      </svg>
      <span className="flex-1 text-sm lg:text-[14.5px]">{label}</span>
      {value && <span className="text-[12.5px] text-white/40 lg:text-[13px]">{value}</span>}
      <span className="text-base text-white/30 lg:text-[17px]">›</span>
    </>
  )
  const cls = `flex w-full items-center gap-3 px-3.5 py-[13px] text-left lg:px-4 lg:py-3.5 ${first ? '' : 'border-t border-white/[.06]'} ${interactive ? '' : 'cursor-default opacity-70'}`

  if (href) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    )
  }
  return (
    <button onClick={onClick} disabled={!interactive} className={cls}>
      {inner}
    </button>
  )
}
