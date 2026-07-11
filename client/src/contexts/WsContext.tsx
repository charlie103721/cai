import { useEffect, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { wsManager } from '@/lib/ws'

/**
 * WsProvider —— 把模块级单例 wsManager 的生命周期挂到 app 上：
 * 挂载时 connect、卸载时 disconnect，并把重连回调接到 TanStack 缓存失效
 * （对账拉取：会话列表 + 当前打开的会话）。
 *
 * 组件不持有 socket；F8 通过 useWs() 消费该单例。这里只做接线，不改现有 UI 行为。
 */
export function WsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  useEffect(() => {
    wsManager.setOnReconnect(() => {
      // 断线期间可能漏帧——重连后失效缓存，触发一次 REST 对账。
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['conversation'] })
    })
    wsManager.connect()
    return () => {
      wsManager.setOnReconnect(null)
      wsManager.disconnect()
    }
  }, [queryClient])

  return <>{children}</>
}
