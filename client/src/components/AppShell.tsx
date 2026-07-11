import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Check, LogOut } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { signOut } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { getConversations, deleteConversation } from '@/lib/chat'

/**
 * 响应式外壳：桌面端（md+）左侧会话侧边栏 + 右侧内容区，
 * 移动端隐藏侧边栏，页面自己负责导航。
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  )
}

function Sidebar() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { id: activeId } = useParams()
  const { isAuthenticated, session } = useAuth()
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const conversations = useQuery({ queryKey: ['conversations'], queryFn: getConversations })

  const remove = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_data, deletedId) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setConfirmingId(null)
      if (deletedId === activeId) navigate('/')
    },
  })

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex items-center justify-between p-4">
        <Link to="/" className="text-lg font-bold">
          ⚽ 球迷嘴替
        </Link>
        <Button variant="outline" size="sm" asChild>
          <Link to="/">
            <Plus className="size-4" /> 开新对话
          </Link>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">最近聊过</p>
        {conversations.data?.length === 0 && (
          <p className="px-2 text-sm text-muted-foreground">还没有对话，挑个角色开聊吧</p>
        )}
        <ul className="flex flex-col gap-1">
          {(conversations.data ?? []).map((conv) => (
            <li key={conv.id} className="group relative">
              <Link
                to={`/chat/${conv.id}`}
                className={`flex items-center gap-2 rounded-md px-2 py-2 pr-9 text-sm transition-colors hover:bg-sidebar-accent ${
                  conv.id === activeId ? 'bg-sidebar-accent font-medium' : ''
                }`}
              >
                <span className="text-lg">{conv.character?.emoji ?? '💬'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{conv.character?.name ?? '未知角色'}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {conv.title ?? '新对话'}
                  </span>
                </span>
              </Link>
              <button
                aria-label={confirmingId === conv.id ? '确认删除' : '删除对话'}
                className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 transition-opacity ${
                  confirmingId === conv.id
                    ? 'bg-destructive text-white opacity-100'
                    : 'text-muted-foreground opacity-0 hover:bg-sidebar-accent group-hover:opacity-100'
                }`}
                onClick={() => {
                  if (confirmingId === conv.id) remove.mutate(conv.id)
                  else setConfirmingId(conv.id)
                }}
                onBlur={() => setConfirmingId(null)}
              >
                {confirmingId === conv.id ? (
                  <Check className="size-3.5" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t p-3">
        {isAuthenticated ? (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground">
              {session?.user.email}
            </span>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              <LogOut className="size-4" />
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" asChild>
              <Link to="/login">登录</Link>
            </Button>
            <Button size="sm" variant="outline" className="flex-1" asChild>
              <Link to="/signup">注册</Link>
            </Button>
          </div>
        )}
      </div>
    </aside>
  )
}
