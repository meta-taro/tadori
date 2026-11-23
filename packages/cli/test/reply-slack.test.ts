import { describe, expect, test } from 'vitest'
import { parseThread } from '@tadori/core'
import { slackReader } from '../src/reply-slack.js'

// Slack の Web API の代わり：呼ばれた道と鍵を覚え、決めた答えを返す（実際にはつながない）
function fakeSlack(answers: Record<string, unknown>) {
  const calls: { path: string; auth: string }[] = []
  const fetcher = async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url))
    calls.push({ path: `${u.pathname}${u.search}`, auth: String(new Headers(init?.headers).get('authorization')) })
    const body = answers[u.pathname.replace('/api/', '')]
    return new Response(JSON.stringify(body ?? { ok: false, error: 'unknown_method' }), { status: 200 })
  }
  return { calls, fetcher: fetcher as typeof fetch }
}

const thread = parseThread('https://example.slack.com/archives/C0123ABCD/p1700000000123456')!
// 時刻は試験の PC の時差によらないよう、日本時間で読む
const TZ = 'Asia/Tokyo'

describe('Slack の返事を読む口（読み取り専用）', () => {
  test('親の投稿の人以外の返事があれば、返事あり（表示名・その返事の時刻）。本文は返さない', async () => {
    const { calls, fetcher } = fakeSlack({
      'conversations.replies': { ok: true, messages: [
        { user: 'U_ME', ts: '1700000000.123456', text: '確認お願いします' },
        { user: 'U_ME', ts: '1700000100.000001', text: '補足です' },
        { user: 'U_A', ts: '1700003600.000002', text: 'OK です' },
      ] },
      'users.info': { ok: true, user: { name: 'a', real_name: 'A 実名', profile: { display_name: 'A さん' } } },
    })
    const reader = slackReader('xoxb-test', { fetcher, timeZone: TZ })
    const reply = await reader.check(thread, [])
    expect(reply).toEqual({ state: 'answered', by: 'A さん', at: '2023-11-15T08:13' })
    expect(JSON.stringify(reply)).not.toContain('OK です')
    expect(calls[0]?.path).toBe('/api/conversations.replies?channel=C0123ABCD&ts=1700000000.123456&limit=200')
    expect(calls[0]?.auth).toBe('Bearer xoxb-test')
    expect(calls[1]?.path).toBe('/api/users.info?user=U_A')
  })

  test('待ちの相手（Slack の利用者 ID）を渡せば、その人の返事だけを数える', async () => {
    const { fetcher } = fakeSlack({
      'conversations.replies': { ok: true, messages: [{ user: 'U_ME', ts: '1700000000.123456' }, { user: 'U_B', ts: '1700000200.000001' }] },
    })
    expect(await slackReader('xoxb-test', { fetcher, timeZone: TZ }).check(thread, ['U_A'])).toEqual({ state: 'waiting' })
  })

  test('返事が無ければ、まだ', async () => {
    const { fetcher } = fakeSlack({ 'conversations.replies': { ok: true, messages: [{ user: 'U_ME', ts: '1700000000.123456' }] } })
    expect(await slackReader('xoxb-test', { fetcher, timeZone: TZ }).check(thread, [])).toEqual({ state: 'waiting' })
  })

  test('表示名が読めなければ（users:read が無いなど）、利用者 ID で出す', async () => {
    const { fetcher } = fakeSlack({
      'conversations.replies': { ok: true, messages: [{ user: 'U_ME', ts: '1700000000.123456' }, { user: 'U_A', ts: '1700003600.000002' }] },
      'users.info': { ok: false, error: 'missing_scope' },
    })
    expect(await slackReader('xoxb-test', { fetcher, timeZone: TZ }).check(thread, [])).toMatchObject({ state: 'answered', by: 'U_A' })
  })

  test('Slack が断ったら、その理由（not_in_channel など）で失敗する', async () => {
    const { fetcher } = fakeSlack({ 'conversations.replies': { ok: false, error: 'not_in_channel' } })
    await expect(slackReader('xoxb-test', { fetcher, timeZone: TZ }).check(thread, [])).rejects.toThrow('not_in_channel')
  })
})
