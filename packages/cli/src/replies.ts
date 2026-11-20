import type { ReplyReader } from '@tadori/core'

/**
 * 待ちのスレッドに返事が来たかを読む口の一覧（チャットごとに 1 つ・読み取り専用）。
 * いまはどのチャットにもつないでいないので空（nudge と画面は「未接続のため未確認」と出す）。
 * 口を足す順は Slack → Discord → Google Chat（Teams は後回し）。トークンは環境変数か OS の資格情報の保管庫から読み、TSV やログには書かない
 */
export function replyReaders(): ReplyReader[] {
  return []
}
