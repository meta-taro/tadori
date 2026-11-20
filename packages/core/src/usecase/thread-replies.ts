import type { ChatThread, ThreadService } from '../domain/threads.js'

/**
 * 待ちのスレッドに返事が来たか。tadori が持つのは、返事があったか・誰か（表示名）・いつかだけで、本文は持たない。
 * answered＝返事あり / waiting＝まだ無い / unconnected＝そのチャットへつないでいない（読む口が無いか、トークンが無い） /
 * failed＝つないだが読めなかった（権限が足りない・投稿が無いなど。理由を人に見せる）
 */
export type ReplyCheck =
  | { readonly state: 'answered'; readonly by: string; readonly at: string }
  | { readonly state: 'waiting' }
  | { readonly state: 'unconnected' }
  | { readonly state: 'failed'; readonly reason: string }

/**
 * チャットごとの、返事を読む口（読み取り専用）。チャットに応えるときは、これを 1 つ作って差し込む。
 * 投稿・返信・リアクションはしない。読んだ本文は返さず、捨てる
 */
export interface ReplyReader {
  readonly service: ThreadService
  /** スレッドの親の投稿より後に、waitingOn（そのチャットでの利用者 ID。空なら投稿者以外の誰でも）から返事が付いたか */
  readonly check: (thread: ChatThread, waitingOn: readonly string[]) => Promise<ReplyCheck>
}

/** スレッドに返事が来たかを、そのチャットの読む口で確かめる。口が無ければ unconnected、口が失敗すれば failed（握り潰さず理由を返す） */
export async function checkReply(thread: ChatThread, readers: readonly ReplyReader[], waitingOn: readonly string[] = []): Promise<ReplyCheck> {
  const reader = readers.find(r => r.service === thread.service)
  if (!reader) return { state: 'unconnected' }
  try {
    return await reader.check(thread, waitingOn)
  } catch (error: unknown) {
    return { state: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}
