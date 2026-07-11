/** Inbox placeholder — the live inbox arrives in F8. */
export default function ChatsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <span className="text-5xl">💬</span>
      <div className="text-lg font-bold">Chats</div>
      <p className="max-w-xs text-sm text-white/50">
        Your conversations will live here. Start one from the For You feed.
      </p>
    </div>
  )
}
