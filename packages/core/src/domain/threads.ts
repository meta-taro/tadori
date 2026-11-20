/**
 * 1 日の進行の待ちの行に結ぶ、チャットのスレッドの URL。
 * tadori は URL の形からどのチャットのどの投稿かを読むだけで、本文は持たない。
 * 返事が来たかを確かめるのは、そのチャットへ読み取り専用でつないだときだけ（つないでいなければ「未確認」と出す）
 */
export const THREAD_SERVICES = ['slack', 'discord', 'gchat', 'teams'] as const
export type ThreadService = (typeof THREAD_SERVICES)[number]

export interface ChatThread {
  readonly service: ThreadService
  /** 渡されたままの URL（画面のリンクに使う） */
  readonly url: string
  readonly host: string
  /** サーバー（Discord）・スペース（Google Chat）・チーム（Teams）。Slack には無い */
  readonly space?: string
  /** チャンネル（Slack・Discord・Teams）。Google Chat ではスペース */
  readonly channel: string
  /** スレッドの親の投稿（Slack は ts の形 1700000000.123456）。Discord のスレッドだけの URL には無い */
  readonly message?: string
}

const SLACK_HOST = /^[a-z0-9-]+(\.enterprise)?\.slack\.com$/
const DISCORD_HOSTS = ['discord.com', 'ptb.discord.com', 'canary.discord.com', 'discordapp.com']
const GCHAT_HOSTS = ['chat.google.com']
const TEAMS_HOSTS = ['teams.microsoft.com', 'teams.cloud.microsoft']

/** Slack の URL の p1700000000123456 を ts の 1700000000.123456 にする */
const slackTs = (p: string) => `${p.slice(0, 10)}.${p.slice(10)}`

function slackThread(url: URL, raw: string): ChatThread | undefined {
  if (!SLACK_HOST.test(url.hostname)) return undefined
  const match = /^\/archives\/([CGD][A-Z0-9]{4,})\/p(\d{16})\/?$/.exec(url.pathname)
  if (!match) return undefined
  const [, channel = '', p = ''] = match
  // スレッドの中の返事の URL には thread_ts が付く。返事を待つのは親の投稿のスレッド
  const threadTs = url.searchParams.get('thread_ts')
  const message = threadTs && /^\d{10}\.\d{6}$/.test(threadTs) ? threadTs : slackTs(p)
  return { service: 'slack', url: raw, host: url.hostname, channel, message }
}

function discordThread(url: URL, raw: string): ChatThread | undefined {
  if (!DISCORD_HOSTS.includes(url.hostname)) return undefined
  const match = /^\/channels\/(\d+|@me)\/(\d+)(?:\/(\d+))?\/?$/.exec(url.pathname)
  if (!match) return undefined
  const [, space = '', channel = '', message] = match
  return { service: 'discord', url: raw, host: url.hostname, space, channel, ...(message ? { message } : {}) }
}

function gchatThread(url: URL, raw: string): ChatThread | undefined {
  if (!GCHAT_HOSTS.includes(url.hostname)) return undefined
  const match = /^\/(?:room|dm)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)
  if (!match) return undefined
  const [, space = '', message = ''] = match
  return { service: 'gchat', url: raw, host: url.hostname, space, channel: space, message }
}

function teamsThread(url: URL, raw: string): ChatThread | undefined {
  if (!TEAMS_HOSTS.includes(url.hostname)) return undefined
  const match = /^\/l\/message\/([^/]+)\/(\d+)\/?$/.exec(url.pathname)
  if (!match) return undefined
  const [, encoded = '', id = ''] = match
  let channel: string
  try { channel = decodeURIComponent(encoded) } catch { return undefined }
  if (!channel.startsWith('19:')) return undefined
  // 返事の URL には parentMessageId が付く（0 は親そのもの）。返事を待つのは親の投稿のスレッド
  const parent = url.searchParams.get('parentMessageId') ?? ''
  const message = /^\d+$/.test(parent) && parent !== '0' ? parent : id
  const space = url.searchParams.get('groupId') ?? ''
  return { service: 'teams', url: raw, host: url.hostname, channel, message, ...(space ? { space } : {}) }
}

/** チャットのスレッドの URL を読む。https で、Slack・Discord・Google Chat・Teams のどれかの投稿の形でなければ undefined */
export function parseThread(raw: string): ChatThread | undefined {
  const value = raw.trim()
  if (!value || /\s/.test(value)) return undefined
  let url: URL
  try { url = new URL(value) } catch { return undefined }
  if (url.protocol !== 'https:') return undefined
  return slackThread(url, value) ?? discordThread(url, value) ?? gchatThread(url, value) ?? teamsThread(url, value)
}

/** 画面と文に出すチャットの名前 */
export const THREAD_SERVICE_NAMES: Readonly<Record<ThreadService, string>> = {
  slack: 'Slack', discord: 'Discord', gchat: 'Google Chat', teams: 'Teams',
}
