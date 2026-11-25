import { describe, expect, test } from 'vitest'
import { parseThread } from '@tadori/core'
import { discordReader } from '../src/reply-discord.js'

// Discord の REST の代わり：呼ばれた道と鍵を覚え、決めた答えを返す（実際にはつながない）
function fakeDiscord(answers: Record<string, { status?: number; body: unknown }>) {
  const calls: { path: string; auth: string }[] = []
  const fetcher = async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url))
    const path = `${u.pathname.replace('/api/v10', '')}${u.search}`
    calls.push({ path, auth: String(new Headers(init?.headers).get('authorization')) })
    const answer = answers[path] ?? { status: 404, body: { message: 'Unknown Channel', code: 10003 } }
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 })
  }
  return { calls, fetcher: fetcher as typeof fetch }
}

const GUILD = '111111111111111111'
const CHANNEL = '222222222222222222'
const PARENT = '333333333333333333'
const onMessage = parseThread(`https://discord.com/channels/${GUILD}/${CHANNEL}/${PARENT}`)!
const onThread = parseThread(`https://discord.com/channels/${GUILD}/${PARENT}`)!
const TZ = 'Asia/Tokyo'
const user = (id: string, extra: Record<string, unknown> = {}) => ({ id, username: `u${id}`, ...extra })
const parent = { status: 200, body: { id: PARENT, author: user('9'), timestamp: '2026-11-20T00:00:00.000+00:00', content: '確認お願いします' } }

describe('Discord の返事を読む口（読み取り専用）', () => {
  test('親の投稿から開いたスレッドに、投稿した人以外の返事があれば、返事あり（表示名・最初の返事の時刻）。本文は返さない', async () => {
    const { calls, fetcher } = fakeDiscord({
      [`/channels/${CHANNEL}/messages/${PARENT}`]: parent,
      [`/channels/${PARENT}/messages?limit=100`]: { body: [
        // 新しい順で返る
        { id: '5', author: user('7', { global_name: 'B さん' }), timestamp: '2026-11-20T02:00:00.000+00:00', content: '後の返事' },
        { id: '4', author: user('8', { global_name: 'A さん' }), timestamp: '2026-11-20T01:05:00.000+00:00', content: 'OK です' },
        { id: '3', author: user('9'), timestamp: '2026-11-20T00:30:00.000+00:00', content: '補足' },
      ] },
    })
    const reply = await discordReader('bot-test', { fetcher, timeZone: TZ }).check(onMessage, [])
    expect(reply).toEqual({ state: 'answered', by: 'A さん', at: '2026-11-20T10:05' })
    expect(JSON.stringify(reply)).not.toContain('OK です')
    expect(calls[0]?.auth).toBe('Bot bot-test')
  })

  test('スレッドが無ければ、チャンネルで親の投稿へ返信したものを数える（ほかの投稿への返信や、ボットは数えない）', async () => {
    const { fetcher } = fakeDiscord({
      [`/channels/${CHANNEL}/messages/${PARENT}`]: parent,
      [`/channels/${CHANNEL}/messages?after=${PARENT}&limit=100`]: { body: [
        { id: '6', author: user('8', { global_name: 'A さん' }), timestamp: '2026-11-20T03:00:00.000+00:00', message_reference: { message_id: PARENT } },
        { id: '5', author: user('6', { bot: true }), timestamp: '2026-11-20T01:00:00.000+00:00', message_reference: { message_id: PARENT } },
        { id: '4', author: user('7'), timestamp: '2026-11-20T00:10:00.000+00:00', message_reference: { message_id: '1' } },
      ] },
    })
    expect(await discordReader('bot-test', { fetcher, timeZone: TZ }).check(onMessage, [])).toEqual({ state: 'answered', by: 'A さん', at: '2026-11-20T12:00' })
  })

  test('スレッドの URL だけのときは、スレッドを立てた人以外の最初の返事を数える。無ければ、まだ', async () => {
    const { fetcher } = fakeDiscord({
      [`/channels/${PARENT}`]: { body: { id: PARENT, owner_id: '9' } },
      [`/channels/${PARENT}/messages?limit=100`]: { body: [{ id: '4', author: user('9'), timestamp: '2026-11-20T00:30:00.000+00:00' }] },
    })
    expect(await discordReader('bot-test', { fetcher, timeZone: TZ }).check(onThread, [])).toEqual({ state: 'waiting' })
  })

  test('待ちの相手（Discord の利用者 ID）を渡せば、その人の返事だけを数える', async () => {
    const { fetcher } = fakeDiscord({
      [`/channels/${CHANNEL}/messages/${PARENT}`]: parent,
      [`/channels/${PARENT}/messages?limit=100`]: { body: [{ id: '4', author: user('8'), timestamp: '2026-11-20T01:05:00.000+00:00' }] },
    })
    expect(await discordReader('bot-test', { fetcher, timeZone: TZ }).check(onMessage, ['7'])).toEqual({ state: 'waiting' })
  })

  test('Discord が断ったら、その理由で失敗する（ボットにチャンネルを見る権限が無いなど）', async () => {
    const { fetcher } = fakeDiscord({ [`/channels/${CHANNEL}/messages/${PARENT}`]: { status: 403, body: { message: 'Missing Access', code: 50001 } } })
    await expect(discordReader('bot-test', { fetcher, timeZone: TZ }).check(onMessage, [])).rejects.toThrow('Missing Access')
  })
})
