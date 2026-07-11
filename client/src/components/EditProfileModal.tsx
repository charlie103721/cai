import { useState } from 'react'
import { ProfileRequestError } from '@/lib/me'

/**
 * Edit-profile modal — dark card exactly per the Desktop design (`@`-prefixed
 * username input + bio/team textarea + Cancel / brand Save). Shared by both
 * layouts. Mounted fresh per open (parent gates on `editing`) so the draft
 * seeds from props without a sync effect. `onSave` performs the real write
 * (PATCH for authed users, localStorage for guests) and may throw a
 * `ProfileRequestError`; a 409 `HANDLE_TAKEN` (or an invalid-format 400) is
 * surfaced inline under the username field.
 */
export function EditProfileModal({
  isGuest,
  initialName,
  initialTeam,
  onClose,
  onSave,
}: {
  isGuest: boolean
  initialName: string
  initialTeam: string
  onClose: () => void
  onSave: (values: { name: string; team: string }) => Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const [team, setTeam] = useState(initialTeam)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      await onSave({ name: name.trim(), team: team.trim() })
      onClose()
    } catch (err) {
      if (err instanceof ProfileRequestError && err.code === 'HANDLE_TAKEN') {
        setError('That @handle is already taken.')
      } else if (err instanceof ProfileRequestError && err.code === 'INVALID_BODY') {
        setError('Handle must be 3–20 letters, numbers, or underscores.')
      } else {
        setError('Could not save — please try again.')
      }
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit profile"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 400, maxWidth: '90%', background: '#161618', borderRadius: 18, border: '1px solid rgba(255,255,255,.1)', padding: '22px 24px 24px', boxShadow: '0 30px 80px rgba(0,0,0,.6)' }}
      >
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 18 }}>Edit profile</div>

        <label htmlFor="edit-username" style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.5)' }}>
          Username
        </label>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, marginBottom: error ? 6 : 16, borderRadius: 12, border: `1px solid ${error ? 'rgba(224,90,74,.7)' : 'rgba(255,255,255,.14)'}`, background: 'rgba(255,255,255,.06)', padding: '0 12px' }}
        >
          <span style={{ color: 'rgba(255,255,255,.4)', fontSize: 15 }}>@</span>
          <input
            id="edit-username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1, height: 46, border: 'none', background: 'transparent', color: '#fff', fontSize: 15, fontFamily: 'var(--font-sans)', outline: 'none' }}
          />
        </div>
        {error && <div style={{ fontSize: 12.5, color: '#e8917f', marginBottom: 14 }}>{error}</div>}

        <label htmlFor="edit-team" style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.5)' }}>
          Favorite team
        </label>
        <textarea
          id="edit-team"
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          rows={2}
          placeholder="e.g. 🇦🇷 Argentina"
          style={{ width: '100%', marginTop: 6, marginBottom: isGuest ? 14 : 22, resize: 'none', borderRadius: 12, border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.06)', color: '#fff', padding: '11px 12px', fontSize: 15, fontFamily: 'var(--font-sans)', lineHeight: 1.4, outline: 'none' }}
        />

        {isGuest && (
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.5)', lineHeight: 1.5, marginBottom: 20 }}>
            Saved on this device. Sign up to claim a permanent @handle.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#fff', background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.14)', borderRadius: '9999px', padding: '12px', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--brand-foreground)', background: 'var(--brand)', border: 'none', borderRadius: '9999px', padding: '12px', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
