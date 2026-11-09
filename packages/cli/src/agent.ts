/**
 * エージェントが、画面の中の専用カーソルで tadori を操作するための指示。
 * 人のマウスは使わない（奪わない）。画面は自分のカーソルをその場所へ動かし、ページの中でボタンを押す。
 * 判定や保存の近道ではない：押せるのは、人が画面で押せるものと同じものだけ。
 */
export type AgentAction =
  | { readonly action: 'point'; readonly target: string; readonly message?: string }
  | { readonly action: 'click'; readonly target: string; readonly message?: string }
  | { readonly action: 'type'; readonly target: string; readonly value: string; readonly message?: string }
  | { readonly action: 'go'; readonly hash: string; readonly message?: string }
  | { readonly action: 'say'; readonly message: string }
  /** 画面の人の絞り込みを切り替える（空なら全員） */
  | { readonly action: 'filter'; readonly value: string }

const ACTIONS = ['point', 'click', 'type', 'go', 'say', 'filter'] as const
/** 画面に出す文字の上限（吹き出し・打つ文字） */
const MAX_TEXT = 500

export class AgentActionError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function text(body: Record<string, unknown>, key: string, required: boolean): string | undefined {
  const value = body[key]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || !value.trim()) throw new AgentActionError(`${key} を文字で書いてください`)
  if (value.length > MAX_TEXT) throw new AgentActionError(`${key} が長すぎます（${MAX_TEXT} 文字まで）`)
  return value
}

/** 受けた JSON を、画面に流してよい指示にする。おかしければ理由つきで断る */
export function parseAgentAction(body: unknown): AgentAction {
  if (!isRecord(body)) throw new AgentActionError('指示は JSON のオブジェクトで送ってください')
  const action = body.action
  if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
    throw new AgentActionError(`知らない動きです：${String(action)}（使えるのは ${ACTIONS.join(' / ')}）`)
  }
  const message = text(body, 'message', action === 'say')
  const withMessage = message === undefined ? {} : { message }
  switch (action) {
    case 'filter': {
      // 人の名前（空なら全員）。絞るだけで、何も書き換えない
      const value = body.value ?? ''
      if (typeof value !== 'string' || value.length > MAX_TEXT) throw new AgentActionError('value は人の名前を文字で（空なら全員）')
      return { action, value: value.trim() }
    }
    case 'say':
      return { action, message: message as string }
    case 'go': {
      const hash = text(body, 'hash', true) as string
      // 画面の中の移動だけ。外のページへは移らせない
      if (!hash.startsWith('#')) throw new AgentActionError('hash は # で始まる画面の中の場所にしてください（例：#rules）')
      return { action, hash, ...withMessage }
    }
    case 'type':
      return { action, target: text(body, 'target', true) as string, value: text(body, 'value', true) as string, ...withMessage }
    default:
      return { action: action as 'point' | 'click', target: text(body, 'target', true) as string, ...withMessage }
  }
}
