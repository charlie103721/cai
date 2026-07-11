import { fetchApi } from './api'

/** 我的资料（GET /api/me/profile，需登录）。 */
export interface MyProfile {
  name: string
  handle: string | null
  favorite_team: string | null
  image: string | null
}

/** 我的统计（GET /api/me/stats，游客可用）。 */
export interface MyStats {
  chats: number
  favorites: number
  likes: number
}

interface Envelope<T> {
  data: T
}

export const getMyProfile = () =>
  fetchApi<Envelope<MyProfile>>('/api/me/profile').then((r) => r.data)

export const getMyStats = () =>
  fetchApi<Envelope<MyStats>>('/api/me/stats').then((r) => r.data)

export class ProfileRequestError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code)
  }
}

/**
 * 更新资料（PATCH /api/me/profile，需登录）。用原始 fetch 以保留错误码，
 * handle 唯一冲突（409 HANDLE_TAKEN）在编辑框内联展示。
 */
export async function updateMyProfile(input: {
  handle?: string
  favorite_team?: string
}): Promise<MyProfile> {
  const res = await fetch('/api/me/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string }
    } | null
    throw new ProfileRequestError(body?.error?.code ?? 'REQUEST_FAILED', res.status)
  }
  const body = (await res.json()) as { data: MyProfile }
  return body.data
}
