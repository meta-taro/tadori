import { t, type ReplyCheck, type ReplyReader } from '@tadori/core'
import { listJoin } from './i18n.js'
import { slackReader } from './reply-slack.js'

/**
 * 待ちのスレッドに返事が来たかを読む口の一覧（チャットごとに 1 つ・読み取り専用）。
 * トークンを置いたチャットだけ口を差す。置いていないチャットは「未接続のため未確認」と出す。
 * トークンは環境変数から読み、TSV・ログ・画面には書かない（置くのは人）。
 * - Slack：TADORI_SLACK_TOKEN（ボットのトークン。権限は channels:history・groups:history（非公開を見るときだけ）・users:read）
 * 口を足す順は Slack → Discord → Google Chat（Teams は後回し）
 */
export function replyReaders(env: Readonly<Record<string, string | undefined>> = process.env): ReplyReader[] {
  const slack = env.TADORI_SLACK_TOKEN?.trim()
  return [...(slack ? [slackReader(slack)] : [])]
}

/** 行ごとに確かめた返事の答え */
export interface CheckedReply {
  readonly id: string
  /** チャットの名前（Slack など） */
  readonly service: string
  readonly reply: ReplyCheck
}

/** 確かめた答えを、人とエージェントが読む文にする（未接続のものは 1 文にまとめる）。本文は出さない */
export function replyLines(checked: readonly CheckedReply[]): string[] {
  const unconnected = checked.filter(c => c.reply.state === 'unconnected').map(c => t('{id} ({service})', { id: c.id, service: c.service }))
  return [
    ...checked.flatMap(({ id, service, reply }) => {
      if (reply.state === 'answered') return [t('{id}: {by} replied in the {service} thread ({at}). Update the line', { id, service, by: reply.by, at: reply.at.replace('T', ' ') })]
      if (reply.state === 'waiting') return [t('{id}: no answer yet in the {service} thread', { id, service })]
      if (reply.state === 'failed') return [t('{id}: could not read the {service} thread ({reason})', { id, service, reason: reply.reason })]
      return []
    }),
    ...(unconnected.length ? [t('{threads}: not connected to the chat, so whether the answer came has not been checked', { threads: listJoin(unconnected) })] : []),
  ]
}
