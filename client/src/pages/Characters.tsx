import { useNavigate, Link } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Flame } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AppShell } from '@/components/AppShell'
import { getCharacters, getTodayTopics, getConversations, createConversation } from '@/lib/chat'

export default function Characters() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isAuthenticated } = useAuth()

  const characters = useQuery({ queryKey: ['characters'], queryFn: getCharacters })
  const topics = useQuery({ queryKey: ['topics-today'], queryFn: getTodayTopics })
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: getConversations })

  const startChat = useMutation({
    mutationFn: createConversation,
    onSuccess: ({ conversation }) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      navigate(`/chat/${conversation.id}`)
    },
  })

  const recent = (conversations.data ?? []).slice(0, 5)

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 pb-12 md:p-8">
          {/* 移动端顶栏（桌面端品牌在侧边栏里） */}
          <header className="flex items-center justify-between pt-2 md:hidden">
            <h1 className="text-2xl font-bold">⚽ 球迷嘴替</h1>
            {!isAuthenticated && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/login">登录</Link>
              </Button>
            )}
          </header>

          <section className="hidden md:block">
            <h1 className="text-3xl font-bold">找个懂球的聊两句</h1>
            <p className="mt-1 text-muted-foreground">
              世界杯正酣——吹你的主队，骂你的对家，或者恶补一下怎么装懂球
            </p>
          </section>
          <p className="text-sm text-muted-foreground md:hidden">
            世界杯正酣，找个懂球的聊两句
          </p>

          {topics.data && topics.data.length > 0 && (
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Flame className="size-4 text-orange-500" /> 今日话题
              </h2>
              <ul className="flex flex-col gap-1.5">
                {topics.data.map((t) => (
                  <li key={t.id} className="text-sm text-muted-foreground">
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

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {characters.isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-32 animate-pulse rounded-xl border bg-card" />
              ))}
            {(characters.data ?? []).map((ch) => (
              <button
                key={ch.id}
                className="flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-accent hover:shadow-md disabled:opacity-50"
                disabled={startChat.isPending}
                onClick={() => startChat.mutate(ch.id)}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-3xl">{ch.emoji}</span>
                  <span className="font-semibold">{ch.name}</span>
                </div>
                <p className="text-sm text-muted-foreground">{ch.tagline}</p>
              </button>
            ))}
          </section>

          {/* 移动端最近会话（桌面端由侧边栏承担） */}
          {recent.length > 0 && (
            <section className="md:hidden">
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">最近聊过</h2>
              <ul className="flex flex-col gap-2">
                {recent.map((conv) => (
                  <li key={conv.id}>
                    <Link
                      to={`/chat/${conv.id}`}
                      className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-accent"
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
        </div>
      </div>
    </AppShell>
  )
}
