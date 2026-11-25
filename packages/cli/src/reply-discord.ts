import type { ChatThread, ReplyCheck, ReplyReader } from '@tadori/core'

/**
 * Discord の返事を読む口（読み取り専用）。ボットのトークンで、チャンネル・投稿を読む REST だけを呼ぶ。
 * 投稿・返信・リアクションはしない。返事の本文は返さない（返すのは、返事があったか・誰か・いつかだけ）。
 * 本文を読まないので、特権のインテント（Message Content）は要らない。
 * 要る権限：見るチャンネルで「チャンネルを見る」「メッセージ履歴を読む」（スレッドは親のチャンネルの権限を継ぐ）。
 *
 * 返事の数え方：
 * - URL が投稿を指すとき：その投稿から開いたスレッド（スレッドの ID は親の投稿の ID と同じ）があれば、その中の投稿。
 *   スレッドが無ければ、チャンネルでその投稿へ「返信」した投稿
 * - URL がスレッドだけを指すとき：スレッドの中の投稿（スレッドを立てた人を、親の投稿の人とみなす）
 * ボットの投稿は返事に数えない（人の返事を待っているため）
 */
const API = 'https://discord.com/api/v10'
const TIMEOUT_MS = 5000
/** Discord の「そのチャンネルは無い」（投稿からスレッドが開かれていない） */
const UNKNOWN_CHANNEL = 10003

export interface DiscordReaderOptions {
  /** 通信の差し替え（試験用）。省けば fetch */
  readonly fetcher?: typeof fetch
  /** 返事の時刻を出す時差（試験用）。省けばその PC の時差 */
  readonly timeZone?: string
}

interface DiscordUser {
  readonly id: string
  readonly username?: string
  readonly global_name?: string | null
  readonly bot?: boolean
}

interface DiscordMessage {
  readonly id: string
  readonly author?: DiscordUser
  readonly timestamp?: string
  readonly message_reference?: { readonly message_id?: string }
}

/** Discord の断り（HTTP の状態と、Discord の番号・理由） */
class DiscordError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message)
  }
}

/** ISO の時刻を、その PC の時刻の YYYY-MM-DDTHH:MM にする（sv-SE は「YYYY-MM-DD HH:MM:SS」の形で出る） */
function stampOf(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleString('sv-SE', { timeZone, hour12: false }).slice(0, 16).replace(' ', 'T')
}

/** 投稿の ID（snowflake）は時刻の順に増える。古い順に並べる */
const byOldest = (a: DiscordMessage, b: DiscordMessage) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)

export function discordReader(token: string, options: DiscordReaderOptions = {}): ReplyReader {
  const fetcher = options.fetcher ?? fetch
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetcher(`${API}${path}`, {
      headers: { authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = await res.json().catch(() => ({})) as { message?: string; code?: number }
    if (!res.ok) throw new DiscordError(body.message ?? `HTTP ${res.status}`, body.code)
    return body as T
  }

  /** 投稿から開いたスレッドの中の投稿。スレッドが無ければ undefined */
  const threadMessages = async (threadId: string): Promise<DiscordMessage[] | undefined> => {
    try {
      return await get<DiscordMessage[]>(`/channels/${threadId}/messages?limit=100`)
    } catch (error) {
      if (error instanceof DiscordError && error.code === UNKNOWN_CHANNEL) return undefined
      throw error
    }
  }

  /** 返事の候補と、親の投稿をした人 */
  const candidates = async (thread: ChatThread): Promise<{ poster: string | undefined; messages: DiscordMessage[] }> => {
    if (!thread.message) {
      const channel = await get<{ owner_id?: string }>(`/channels/${thread.channel}`)
      return { poster: channel.owner_id, messages: await get<DiscordMessage[]>(`/channels/${thread.channel}/messages?limit=100`) }
    }
    const parent = await get<DiscordMessage>(`/channels/${thread.channel}/messages/${thread.message}`)
    const inThread = await threadMessages(thread.message)
    if (inThread) return { poster: parent.author?.id, messages: inThread }
    const after = await get<DiscordMessage[]>(`/channels/${thread.channel}/messages?after=${thread.message}&limit=100`)
    return { poster: parent.author?.id, messages: after.filter(m => m.message_reference?.message_id === thread.message) }
  }

  return {
    service: 'discord',
    check: async (thread: ChatThread, waitingOn: readonly string[]): Promise<ReplyCheck> => {
      const { poster, messages } = await candidates(thread)
      // 待ちの相手が決まっていればその人の、決まっていなければ親の投稿の人以外の、最初の返事
      const reply = [...messages].sort(byOldest).find(m => m.author && !m.author.bot && m.timestamp
        && (waitingOn.length ? waitingOn.includes(m.author.id) : m.author.id !== poster))
      if (!reply?.author || !reply.timestamp) return { state: 'waiting' }
      return {
        state: 'answered',
        by: reply.author.global_name || reply.author.username || reply.author.id,
        at: stampOf(reply.timestamp, options.timeZone),
      }
    },
  }
}
