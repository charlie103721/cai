/**
 * Custom confirm dialog — replaces `window.confirm` (banned by AGENT.md).
 * Dark centered card matching the FanMouth Edit-profile modal styling.
 * Renders nothing when `open` is false.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  busy = false,
}: {
  open: boolean
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 360,
          maxWidth: '90%',
          background: '#161618',
          borderRadius: 18,
          border: '1px solid rgba(255,255,255,.1)',
          padding: '22px 24px 24px',
          boxShadow: '0 30px 80px rgba(0,0,0,.6)',
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: body ? 8 : 18 }}>{title}</div>
        {body && (
          <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.6)', lineHeight: 1.5, marginBottom: 20 }}>
            {body}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              background: 'rgba(255,255,255,.1)',
              border: '1px solid rgba(255,255,255,.14)',
              borderRadius: '9999px',
              padding: '12px',
              cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              flex: 1,
              fontSize: 14,
              fontWeight: 700,
              color: '#fff',
              background: '#c0392b',
              border: 'none',
              borderRadius: '9999px',
              padding: '12px',
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
