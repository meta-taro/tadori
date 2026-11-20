/**
 * 1 日の進行の待ちの行に結ぶ、チャットのスレッドの URL。
 * tadori は URL の形からどのチャットのどの投稿かを読むだけで、本文は持たない。
 * 返事が来たかを確かめるのは、そのチャットへ読み取り専用でつないだときだけ（つないでいなければ「未確認」と出す）
 */
export const THREAD_SERVICES = ['slack', 'discord', 'gchat', 'teams', 'chatwork', 'mattermost'] as const
export type ThreadService = (typeof THREAD_SERVICES)[number]

export interface ChatThread {
  readonly service: ThreadService
  /** 渡されたままの URL（画面のリンクに使う） */
  readonly url: string
  readonly host: string
  /** サーバー（Discord）・スペース（Google Chat）・チーム（Teams・Mattermost）。Slack・Chatwork には無い */
  readonly space?: string
  /** チャンネル（Slack・Discord・Teams）。Google Chat ではスペース、Chatwork ではルーム。Mattermost の投稿の URL には無い（空） */
  readonly channel: string
  /** スレッドの親の投稿（Slack は ts の形 1700000000.123456）。Discord のスレッドだけの URL には無い */
  readonly message?: string
}

const SLACK_HOST = /^[a-z0-9-]+(\.enterprise)?\.slack\.com$/
const DISCORD_HOSTS = ['discord.com', 'ptb.discord.com', 'canary.discord.com', 'discordapp.com']
const GCHAT_HOSTS = ['chat.google.com']
const TEAMS_HOSTS = ['teams.microsoft.com', 'teams.cloud.microsoft']
const CHATWORK_HOSTS = ['www.chatwork.com', 'chatwork.com', 'kcw.kddi.ne.jp']

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

/** Chatwork のメッセージの URL（#!rid<ルーム>-<メッセージ>）。返事は同じルームの中に付く */
function chatworkThread(url: URL, raw: string): ChatThread | undefined {
  if (!CHATWORK_HOSTS.includes(url.hostname)) return undefined
  const match = /^#!rid(\d+)-(\d+)$/.exec(url.hash)
  if (!match) return undefined
  const [, channel = '', message = ''] = match
  return { service: 'chatwork', url: raw, host: url.hostname, channel, message }
}

/** Mattermost の投稿の URL（/<チーム>/pl/<投稿>）。自前で立てることが多いので、場所ではなく道の形で見分ける */
function mattermostThread(url: URL, raw: string): ChatThread | undefined {
  const match = /^\/([a-z0-9_-]+)\/pl\/([a-z0-9]{26})\/?$/.exec(url.pathname)
  if (!match) return undefined
  const [, space = '', message = ''] = match
  return { service: 'mattermost', url: raw, host: url.hostname, space, channel: '', message }
}

/**
 * チャットごとの URL の読み方。新しいチャットに応えるときは、ここに 1 つ足す（順に試し、最初に読めたものを使う）。
 * 道の形だけで見分けるもの（Mattermost）は、場所で見分けるものの後に置く
 */
const READERS: readonly ((url: URL, raw: string) => ChatThread | undefined)[] = [slackThread, discordThread, gchatThread, teamsThread, chatworkThread, mattermostThread]

/** チャットのスレッドの URL を読む。https で、READERS のどれかの投稿の形でなければ undefined */
export function parseThread(raw: string): ChatThread | undefined {
  const value = raw.trim()
  if (!value || /\s/.test(value)) return undefined
  let url: URL
  try { url = new URL(value) } catch { return undefined }
  if (url.protocol !== 'https:') return undefined
  for (const read of READERS) {
    const thread = read(url, value)
    if (thread) return thread
  }
  return undefined
}

/** 画面と文に出すチャットの名前 */
export const THREAD_SERVICE_NAMES: Readonly<Record<ThreadService, string>> = {
  slack: 'Slack', discord: 'Discord', gchat: 'Google Chat', teams: 'Teams', chatwork: 'Chatwork', mattermost: 'Mattermost',
}
