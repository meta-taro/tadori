import { describe, expect, test } from 'vitest'
import { parseThread } from '../src/domain/threads.js'

describe('parseThread（待ちの行に結ぶチャットのスレッドの URL）', () => {
  test('Slack の投稿の URL から、チャンネルと投稿の ts を読む', () => {
    expect(parseThread('https://example.slack.com/archives/C0123ABCD/p1700000000123456')).toEqual({
      service: 'slack', url: 'https://example.slack.com/archives/C0123ABCD/p1700000000123456',
      host: 'example.slack.com', channel: 'C0123ABCD', message: '1700000000.123456',
    })
  })

  test('Slack のスレッドの中の返事の URL なら、親の投稿の ts（thread_ts）をスレッドとして読む', () => {
    expect(parseThread('https://example.slack.com/archives/C0123ABCD/p1700000099000001?thread_ts=1700000000.123456&cid=C0123ABCD')).toMatchObject({
      service: 'slack', channel: 'C0123ABCD', message: '1700000000.123456',
    })
  })

  test('Discord のメッセージの URL と、スレッド（チャンネル）だけの URL を読む', () => {
    expect(parseThread('https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333')).toMatchObject({
      service: 'discord', host: 'discord.com', space: '111111111111111111', channel: '222222222222222222', message: '333333333333333333',
    })
    expect(parseThread('https://discord.com/channels/111111111111111111/222222222222222222')).toMatchObject({
      service: 'discord', channel: '222222222222222222',
    })
    expect(parseThread('https://discord.com/channels/111111111111111111/222222222222222222')?.message).toBeUndefined()
  })

  test('Google Chat のスペースのスレッドの URL を読む', () => {
    expect(parseThread('https://chat.google.com/room/AAAAbbbbCCC/dDdDeEeE1234')).toMatchObject({
      service: 'gchat', space: 'AAAAbbbbCCC', channel: 'AAAAbbbbCCC', message: 'dDdDeEeE1234',
    })
  })

  test('Teams のチャネルの投稿の URL を読む（返事の URL なら親の投稿をスレッドとする）', () => {
    // Teams のチャネル ID は URL の中で符号化されている。読むと元の ID に戻す
    const encodedChannel = '19%3Aabc123%40thread.tacv2'
    const url = `https://teams.microsoft.com/l/message/${encodedChannel}/1700000000000?groupId=00000000-0000-0000-0000-000000000001&parentMessageId=1699999999999`
    expect(parseThread(url)).toMatchObject({
      service: 'teams', channel: decodeURIComponent(encodedChannel), message: '1699999999999', space: '00000000-0000-0000-0000-000000000001',
    })
  })

  test('どのチャットの形でもない URL・http の URL・壊れた文字は読まない', () => {
    expect(parseThread('https://example.com/archives/C0123ABCD/p1700000000123456')).toBeUndefined()
    expect(parseThread('http://example.slack.com/archives/C0123ABCD/p1700000000123456')).toBeUndefined()
    expect(parseThread('https://example.slack.com/archives/C0123ABCD')).toBeUndefined()
    expect(parseThread('https://evil.example/https://discord.com/channels/1/2/3')).toBeUndefined()
    expect(parseThread('not a url')).toBeUndefined()
    expect(parseThread('')).toBeUndefined()
  })
})
