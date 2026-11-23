import type { ChatThread, ReplyCheck, ReplyReader } from '@tadori/core'

/**
 * Slack の返事を読む口（読み取り専用）。ボットのトークンで conversations.replies と users.info だけを呼ぶ。
 * 投稿・返信・リアクションはしない。返事の本文は読んでも返さず、捨てる（返すのは、返事があったか・誰か・いつかだけ）。
 * 要る権限：channels:history（公開チャンネル）・groups:history（非公開を見るときだけ）・users:read（表示名。無ければ利用者 ID で出す）。
 * ボットは、見るチャンネルに招待しておく（していなければ not_in_channel で失敗する）
 */
const API = 'https://slack.com/api/'
const TIMEOUT_MS = 5000

export interface SlackReaderOptions {
  /** 通信の差し替え（試験用）。省けば fetch */
  readonly fetcher?: typeof fetch
  /** 返事の時刻を出す時差（試験用）。省けばその PC の時差 */
  readonly timeZone?: string
}

interface SlackMessage {
  readonly user?: string
  readonly ts?: string
}

/** Slack の ts（秒.マイクロ秒）を、その PC の時刻の YYYY-MM-DDTHH:MM にする */
function stampOf(ts: string, timeZone?: string): string {
  const date = new Date(Number(ts.split('.')[0]) * 1000)
  // sv-SE は「YYYY-MM-DD HH:MM:SS」の形で出る
  return date.toLocaleString('sv-SE', { timeZone, hour12: false }).slice(0, 16).replace(' ', 'T')
}

export function slackReader(token: string, options: SlackReaderOptions = {}): ReplyReader {
  const fetcher = options.fetcher ?? fetch
  const call = async (method: string, params: Record<string, string>): Promise<Record<string, unknown>> => {
    const res = await fetcher(`${API}${method}?${new URLSearchParams(params).toString()}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json() as Record<string, unknown>
    if (body.ok !== true) throw new Error(String(body.error ?? 'unknown_error'))
    return body
  }

  /** 表示名（表示名 → 実名 → 名前）。読めなければ利用者 ID（users:read が無くても返事の有無は出せるように） */
  const nameOf = async (user: string): Promise<string> => {
    try {
      const body = await call('users.info', { user })
      const info = (body.user ?? {}) as { name?: string; real_name?: string; profile?: { display_name?: string } }
      return info.profile?.display_name || info.real_name || info.name || user
    } catch {
      // 表示名は飾り。読めない理由（権限など）で返事の有無まで失わないよう、ID で出す
      return user
    }
  }

  return {
    service: 'slack',
    check: async (thread: ChatThread, waitingOn: readonly string[]): Promise<ReplyCheck> => {
      if (!thread.message) throw new Error('no message in the URL')
      const body = await call('conversations.replies', { channel: thread.channel, ts: thread.message, limit: '200' })
      const messages = (Array.isArray(body.messages) ? body.messages : []) as SlackMessage[]
      const poster = messages.find(m => m.ts === thread.message)?.user
      // 待ちの相手が決まっていればその人の、決まっていなければ親の投稿の人以外の、最初の返事
      const reply = messages.find(m => m.ts !== thread.message && m.user && m.ts
        && (waitingOn.length ? waitingOn.includes(m.user) : m.user !== poster))
      if (!reply?.user || !reply.ts) return { state: 'waiting' }
      return { state: 'answered', by: await nameOf(reply.user), at: stampOf(reply.ts, options.timeZone) }
    },
  }
}
