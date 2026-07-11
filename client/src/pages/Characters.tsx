import { useNavigate, Link } from 'react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  getCharacters,
  getTodayTopics,
  getConversations,
  createConversation,
} from '@/lib/chat'

export default function Characters() {
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()

  const characters = useQuery({ queryKey: ['characters'], queryFn: getCharacters })
  const topics = useQuery({ queryKey: ['topics-today'], queryFn: getTodayTopics })
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: getConversations })

  const startChat = useMutation({
    mutationFn: createConversation,
    onSuccess: ({ conversation }) => navigate(`/chat/${conversation.id}`),
  })

  const recent = (conversations.data ?? []).slice(0, 5)

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-4 pb-10">
      <header className="flex items-center justify-between pt-4">
        <div>
          <h1 className="text-2xl font-bold">⚽ 球迷嘴替</h1>
          <p className="text-sm text-muted-foreground">世界杯正酣，找个懂球的聊两句</p>
        </div>
        {!isAuthenticated && (
          <Button variant="outline" size="sm" asChild>
            <Link to="/login">登录</Link>
          </Button>
        )}
      </header>

      {topics.data && topics.data.length > 0 && (
        <section className="rounded-lg border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">🔥 今日话题</h2>
          <ul className="flex flex-col gap-1">
            {topics.data.map((t) => (
              <li key={t.id} className="text-sm">
                {t.title}
              </li>
            ))}
          </ul>
        </section>
      )}

      {startChat.isError && (
        <Alert variant="destructive">
          <AlertDescription>开聊失败了，稍后再试试</AlertDescription>
        </Alert>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {characters.isLoading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border bg-card" />
          ))}
        {(characters.data ?? []).map((ch) => (
          <button
            key={ch.id}
            className="flex flex-col items-start gap-1 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent disabled:opacity-50"
            disabled={startChat.isPending}
            onClick={() => startChat.mutate(ch.id)}
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl">{ch.emoji}</span>
              <span className="font-semibold">{ch.name}</span>
            </div>
            <p className="text-sm text-muted-foreground">{ch.tagline}</p>
          </button>
        ))}
      </section>

      {recent.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">最近聊过</h2>
          <ul className="flex flex-col gap-2">
            {recent.map((conv) => (
              <li key={conv.id}>
                <Link
                  to={`/chat/${conv.id}`}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent"
                >
                  <span className="text-xl">{conv.character?.emoji ?? '💬'}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {conv.character?.name ?? '未知角色'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {conv.title ?? '新对话'}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
