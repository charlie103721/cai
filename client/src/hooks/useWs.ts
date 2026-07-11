import { wsManager, type WsManager } from '@/lib/ws'

/**
 * 拿到共享的 WsManager 单例（订阅帧 / 发消息 / 标记已读）。
 * 连接的生命周期由 app 根部的 WsProvider 负责挂载/卸载。
 */
export function useWs(): WsManager {
  return wsManager
}
