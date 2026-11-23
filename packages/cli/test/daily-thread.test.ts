import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addDaily, DailyInputError, loadDaily, updateDaily } from '../src/daily.js'
import { nudge } from '../src/nudge.js'
import { replyReaders } from '../src/replies.js'
import type { ReplyReader } from '@tadori/core'

// 架空の最小の案件。待ちの行に、返事を待っているチャットのスレッドの URL を結ぶ
let dir = ''
const day = '2026-11-20'
const SLACK = 'https://example.slack.com/archives/C0123ABCD/p1700000000123456'
const DISCORD = 'https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333'
const put = async (path: string, text: string) => {
  await mkdir(join(dir, path, '..'), { recursive: true })
  await writeFile(join(dir, path), text, 'utf8')
}
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tadori-thread-'))
  await put('.tadori/project.tsv', 'name\n架空の案件\n')
  await put('.tadori/phases.tsv', 'id\tname\torder\nbd\t基本設計\t1\n')
  await put('.tadori/statuses.tsv', 'id\tname\ttone\ntodo\t未着手\tnone\ndone\t完了\tok\n')
  await put('.tadori/rulesets/basic-design.tsv', 'id\tphase\tkind\tfrom\tto\tfield\tlabel\nR1\tbd\tapproval\t\t\t\t基本設計を承認した\n')
  await put('ledger/items.tsv', 'id\tkind\ttitle\tsource\trefs\n')
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('待ちの行のスレッド', () => {
  test('足すときに thread で Slack の投稿の URL を渡すと、行に残り、日ごとのファイルの thread 列に書く', async () => {
    const { entry } = await addDaily(dir, day, { section: 'today', text: '〈A さんの確認待ち（12:57 依頼）〉', thread: SLACK })
    expect(entry.thread).toBe(SLACK)
    expect(await readFile(join(dir, `.tadori/daily/${day}.tsv`), 'utf8')).toContain(SLACK)
    expect((await loadDaily(dir, day)).entries.find(e => e.id === entry.id)?.thread).toBe(SLACK)
  })

  test('直すときに別のチャット（Discord）に替えられ、空文字で外せる', async () => {
    const { entry } = await addDaily(dir, day, { section: 'today', text: '〈B さんの返事待ち〉' })
    expect((await updateDaily(dir, day, entry.id, { thread: DISCORD })).entry.thread).toBe(DISCORD)
    expect((await updateDaily(dir, day, entry.id, { thread: '' })).entry.thread).toBeUndefined()
  })

  test('チャットの投稿の形でない URL は断る（取り違えに気づけるように、受ける形を返す）', async () => {
    await expect(addDaily(dir, day, { section: 'today', text: 'x', thread: 'https://example.com/a' })).rejects.toThrow(DailyInputError)
    await expect(addDaily(dir, day, { section: 'today', text: 'x', thread: 'https://example.com/a' })).rejects.toThrow(/Slack/)
  })

  test('1 日の進行の文の補足に、どのチャットのスレッドかと URL を出す', async () => {
    const daily = await loadDaily(dir, day)
    expect(daily.text).toContain(`Slack のスレッド：${SLACK}`)
  })

  test('古いままの待ちの行にスレッドがあれば、チャットにつないでいないので返事の有無は未確認と知らせる', async () => {
    const header = 'id\twho\tsection\ttext\twbs\tissue\tnote\torigin\tkey\ttag\tlinks\tbadges\tupdated\tchecks\tthread\n'
    await put(`.tadori/daily/${day}.tsv`, header
      + `m1\tA\ttoday\t上長に確認\t\t\t\tmanual\t\t\t\twait 確認中\t2026-11-20T08:00\t\t${SLACK}\n`
      + 'm2\tA\ttoday\t別の確認\t\t\t\tmanual\t\t\t\twait 確認中\t2026-11-20T08:00\t\t\n')
    await put('.tadori/checkpoints.tsv', 'id\tname\tnudge\nbefore-meeting\t定例の会議の前\tnotify\n')
    const result = await nudge(dir, { at: 'before-meeting', today: day, now: new Date(2026, 10, 20, 12, 0), staleWaits: true })
    expect(result.text).toContain('m1, m2')
    expect(result.text).toContain('m1（Slack）は、チャットにつないでいないため返事の有無を確かめていません')
  })

  test('そのチャットの読む口を差し込めば、返事あり・まだ・読めなかったを行ごとに知らせる（本文は出さない）', async () => {
    const answered: ReplyReader = { service: 'slack', check: async () => ({ state: 'answered', by: 'A さん', at: '2026-11-20T10:05' }) }
    const result = await nudge(dir, { at: 'before-meeting', today: day, now: new Date(2026, 10, 20, 12, 0), staleWaits: true, readers: [answered] })
    expect(result.text).toContain('m1：Slack のスレッドに A さん の返事あり（2026-11-20 10:05）。行を直してください')
    expect(result.text).not.toContain('チャットにつないでいない')
    const failing: ReplyReader = { service: 'slack', check: async () => { throw new Error('missing_scope') } }
    const failed = await nudge(dir, { at: 'before-meeting', today: day, now: new Date(2026, 10, 20, 12, 0), staleWaits: true, readers: [failing] })
    expect(failed.text).toContain('m1：Slack のスレッドを読めませんでした（missing_scope）')
  })
})

describe('返事を読む口の差し方', () => {
  test('TADORI_SLACK_TOKEN を置いたときだけ Slack の口を差す（置いていなければ未接続）', () => {
    expect(replyReaders({}).map(r => r.service)).toEqual([])
    expect(replyReaders({ TADORI_SLACK_TOKEN: '  ' }).map(r => r.service)).toEqual([])
    expect(replyReaders({ TADORI_SLACK_TOKEN: 'xoxb-test' }).map(r => r.service)).toEqual(['slack'])
  })

  test('1 日の進行は、読む口を渡したときだけ確かめて replies に入れる（渡さなければチャットへつながない）', async () => {
    const answered: ReplyReader = { service: 'slack', check: async () => ({ state: 'answered', by: 'A さん', at: '2026-11-20T10:05' }) }
    expect((await loadDaily(dir, day)).replies).toEqual({})
    const daily = await loadDaily(dir, day, undefined, { readers: [answered] })
    expect(daily.replies).toEqual({ m1: { state: 'answered', by: 'A さん', at: '2026-11-20T10:05' } })
    expect(daily.threads).toEqual({ m1: 'Slack' })
  })
})
