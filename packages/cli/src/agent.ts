import './i18n.js'
import { t } from '@tadori/core'

/**
 * エージェントが、画面の中の専用カーソルで tadori を操作するための指示。
 * 人のマウスは使わない（奪わない）。画面は自分のカーソルをその場所へ動かし、ページの中でボタンを押す。
 * 判定や保存の近道ではない：押せるのは、人が画面で押せるものと同じものだけ。
 */
/** 吹き出しを出しておく秒数（省けば画面が文の長さで決める） */
type Shown = { readonly seconds?: number }
export type AgentAction =
  | ({ readonly action: 'point'; readonly target: string; readonly message?: string } & Shown)
  | ({ readonly action: 'click'; readonly target: string; readonly message?: string } & Shown)
  | ({ readonly action: 'type'; readonly target: string; readonly value: string; readonly message?: string } & Shown)
  | ({ readonly action: 'go'; readonly hash: string; readonly message?: string } & Shown)
  | ({ readonly action: 'say'; readonly message: string } & Shown)
  /** 画面の人の絞り込みを切り替える（空なら全員） */
  | { readonly action: 'filter'; readonly value: string }

const ACTIONS = ['point', 'click', 'type', 'go', 'say', 'filter'] as const
/** 画面に出す文字の上限（吹き出し・打つ文字） */
const MAX_TEXT = 500
/** 吹き出しを出しておく秒数の範囲 */
const MIN_SECONDS = 1
const MAX_SECONDS = 60

export class AgentActionError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function text(body: Record<string, unknown>, key: string, required: boolean): string | undefined {
  const value = body[key]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || !value.trim()) throw new AgentActionError(t('{key} must be non-empty text', { key }))
  if (value.length > MAX_TEXT) throw new AgentActionError(t('{key} is too long (up to {max} characters)', { key, max: MAX_TEXT }))
  return value
}

/** 受けた JSON を、画面に流してよい指示にする。おかしければ理由つきで断る */
export function parseAgentAction(body: unknown): AgentAction {
  if (!isRecord(body)) throw new AgentActionError(t('Send the instruction as a JSON object'))
  const action = body.action
  if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
    throw new AgentActionError(t('Unknown action: {action} (available: {list})', { action: String(action), list: ACTIONS.join(' / ') }))
  }
  const message = text(body, 'message', action === 'say')
  const seconds = body.seconds
  if (seconds !== undefined && (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS)) {
    throw new AgentActionError(t('seconds must be a number from {min} to {max}', { min: MIN_SECONDS, max: MAX_SECONDS }))
  }
  const withMessage = { ...(message === undefined ? {} : { message }), ...(seconds === undefined ? {} : { seconds }) }
  switch (action) {
    case 'filter': {
      // 人の名前（空なら全員）。絞るだけで、何も書き換えない
      const value = body.value ?? ''
      if (typeof value !== 'string' || value.length > MAX_TEXT) throw new AgentActionError(t('value must be a person\'s name as text (empty for everyone)'))
      return { action, value: value.trim() }
    }
    case 'say':
      return { action, ...withMessage, message: message as string }
    case 'go': {
      const hash = text(body, 'hash', true) as string
      // 画面の中の移動だけ。外のページへは移らせない
      if (!hash.startsWith('#')) throw new AgentActionError(t('hash must be a place on the screen starting with # (e.g. #rules)'))
      return { action, hash, ...withMessage }
    }
    case 'type':
      return { action, target: text(body, 'target', true) as string, value: text(body, 'value', true) as string, ...withMessage }
    default:
      return { action: action as 'point' | 'click', target: text(body, 'target', true) as string, ...withMessage }
  }
}
