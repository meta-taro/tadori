import { describe, expect, test } from 'vitest'
import { carriedOver, entriesFromSheet, memberOf, mergeDaily, readAloud, staleWaits, withoutSummaries, type DailyEntry } from '../src/usecase/daily-entries.js'
import { buildDaily, type StatusChange } from '../src/usecase/daily.js'
import type { Project, Task } from '../src/domain/model.js'

const auto = (key: string, text: string, extra: Partial<DailyEntry> = {}): DailyEntry =>
  ({ id: '', who: '設計担当', section: 'today', text, wbs: [], origin: 'auto', key, ...extra })

describe('mergeDaily（下書きを作り直しても、人やエージェントが触った行は上書きしない）', () => {
  test('初めて作るときは、自動の行に番号の ID を振って全部入れる', () => {
    const merged = mergeDaily([], [auto('wbs:W-01', '画面の設計'), auto('wbs:W-02', 'API の設計')])
    expect(merged.map(e => e.id)).toEqual(['a1', 'a2'])
  })

  test('直した行・消した行は残し、同じ key の自動の行では上書きしない', () => {
    const existing: DailyEntry[] = [
      { ...auto('wbs:W-01', '画面の設計'), id: 'a1', text: '一覧画面の並び順を直した', origin: 'edited' },
      { ...auto('wbs:W-02', 'API の設計'), id: 'a2', origin: 'removed' },
    ]
    const merged = mergeDaily(existing, [auto('wbs:W-01', '画面の設計'), auto('wbs:W-02', 'API の設計')])
    expect(merged.find(e => e.key === 'wbs:W-01')?.text).toBe('一覧画面の並び順を直した')
    expect(merged.find(e => e.key === 'wbs:W-02')?.origin).toBe('removed')
    expect(merged).toHaveLength(2)
  })

  test('人が足した行は残す。新しく見つかった自動の行は足す。触っていない自動の行は新しい中身にする', () => {
    const existing: DailyEntry[] = [
      { ...auto('wbs:W-01', '画面の設計'), id: 'a1' },
      { id: 'm1', who: '設計担当', section: 'consult', text: '試験の環境はいつ空くか確かめたい', wbs: [], origin: 'manual' },
    ]
    const merged = mergeDaily(existing, [auto('wbs:W-01', '画面の設計（2 画面）'), auto('ledger:add:RUN-13', '台帳に RUN-13 を足した')])
    expect(merged.map(e => e.id)).toEqual(['a1', 'm1', 'a2'])
    expect(merged.find(e => e.id === 'a1')?.text).toBe('画面の設計（2 画面）')
    expect(merged.find(e => e.id === 'm1')?.text).toBe('試験の環境はいつ空くか確かめたい')
  })

  test('触っていない自動の行で、もう材料が無いものは消す（人が触った行は消さない）', () => {
    const existing: DailyEntry[] = [{ ...auto('wbs:W-09', '消えた作業'), id: 'a1' }, { ...auto('wbs:W-08', '直した'), id: 'a2', origin: 'edited' }]
    const merged = mergeDaily(existing, [])
    expect(merged.map(e => e.id)).toEqual(['a2'])
  })
})


describe('entriesFromSheet（WBS の変化から作った下書きを、行にする）', () => {
  const statuses = [{ id: 'todo', name: '未着手', tone: 'none' as const }, { id: 'doing', name: '進行中', tone: 'wait' as const }, { id: 'done', name: '完了', tone: 'ok' as const }]
  const t = (id: string, name: string, status: string, owner: string, issue?: string): Task =>
    ({ id, phase: 'dd', name, status, owner, start: '2026-11-09', end: '2026-11-12', ...(issue ? { issue } : {}) })
  const project = {
    name: 'x', phases: [], rules: [], approvals: [], statuses,
    tasks: [t('W-01', '画面の設計', 'done', '設計担当', 'BUG-012'), t('W-02', 'API の設計', 'doing', '設計担当・検証担当')],
    items: [{ id: 'BUG-012', kind: 'BUG', title: '一覧の並び順が逆になる不具合', source: 'i.md', refs: [], fields: { short: '並び順' } }],
  } as unknown as Project
  const changes: StatusChange[] = [{ taskId: 'W-01', date: '2026-11-09', from: 'doing', to: 'done' }]
  const entries = entriesFromSheet(buildDaily(project, changes, '2026-11-09'), '続き ')

  test('今日・次の作業日の行になり、課題は短い名前、続く作業は渡した印を頭に付け、WBS と担当を持つ', () => {
    expect(entries).toContainEqual(expect.objectContaining({ section: 'today', text: 'BUG-012 並び順 画面の設計', wbs: ['W-01'], issue: 'BUG-012', who: '設計担当', origin: 'auto', key: 'wbs:today:W-01' }))
    expect(entries).toContainEqual(expect.objectContaining({ section: 'next', text: '続き API の設計', wbs: ['W-02'], who: '設計担当・検証担当', key: 'wbs:next:W-02' }))
  })
})

describe('memberOf（git の作者名を担当にする）', () => {
  test('表があれば表の担当、無ければ作者名そのまま', () => {
    const members = [{ name: '設計担当', git: 'sekkei-dev', roles: [] }]
    expect(memberOf('sekkei-dev', members)).toBe('設計担当')
    expect(memberOf('検証担当', members)).toBe('検証担当')
  })
})

describe('entriesFromSheet の既定', () => {
  test('続く作業の印は、渡さなければ付けない', () => {
    const statuses = [{ id: 'doing', name: '進行中', tone: 'wait' as const }]
    const project = { name: 'x', phases: [], rules: [], approvals: [], statuses, items: [], tasks: [{ id: 'W-02', phase: 'dd', name: 'API の設計', status: 'doing', start: '2026-11-09', end: '2026-11-12' }] } as unknown as Project
    expect(entriesFromSheet(buildDaily(project, [], '2026-11-09'))[0]?.text).toBe('API の設計')
  })
})

describe('entriesFromSheet の続く印の区切り', () => {
  test('印のあとに区切りが無ければ、空白を 1 つ入れる', () => {
    const statuses = [{ id: 'doing', name: '進行中', tone: 'wait' as const }]
    const project = { name: 'x', phases: [], rules: [], approvals: [], statuses, items: [], tasks: [{ id: 'W-02', phase: 'dd', name: 'API の設計', status: 'doing', start: '2026-11-09', end: '2026-11-12' }] } as unknown as Project
    const sheet = buildDaily(project, [], '2026-11-09')
    expect(entriesFromSheet(sheet, '続き')[0]?.text).toBe('続き API の設計')
    expect(entriesFromSheet(sheet, '続き：')[0]?.text).toBe('続き：API の設計')
  })
})

describe('entriesFromSheet の印（tag）', () => {
  test('今日に済みへ変わった作業は done、今日に途中の状態へ変わった作業は doing、次の作業日の行は plan', () => {
    const statuses = [{ id: 'todo', name: '未着手', tone: 'none' as const }, { id: 'doing', name: '進行中', tone: 'wait' as const }, { id: 'done', name: '完了', tone: 'ok' as const }]
    const t = (id: string, status: string, start: string): Task => ({ id, phase: 'dd', name: id, status, start, end: '2026-11-20' })
    const project = { name: 'x', phases: [], rules: [], approvals: [], statuses, items: [], tasks: [t('W-1', 'done', '2026-11-01'), t('W-2', 'doing', '2026-11-01'), t('W-3', 'todo', '2026-11-10')] } as unknown as Project
    const changes: StatusChange[] = [{ taskId: 'W-1', date: '2026-11-09', from: 'doing', to: 'done' }, { taskId: 'W-2', date: '2026-11-09', from: 'todo', to: 'doing' }]
    const entries = entriesFromSheet(buildDaily(project, changes, '2026-11-09'))
    const tagOf = (section: string, id: string) => entries.find(e => e.section === section && e.wbs.includes(id))?.tag
    expect(tagOf('today', 'W-1')).toBe('done')
    expect(tagOf('today', 'W-2')).toBe('doing')
    expect(tagOf('next', 'W-3')).toBe('plan')
  })
})

describe('carriedOver（前の作業日の「次の作業日」に人が足した行を、今日の予定に持ち越す）', () => {
  const previous: DailyEntry[] = [
    { id: 'm1', who: '設計担当', section: 'next', text: 'API の設計を始める', wbs: ['W-03'], origin: 'manual', tag: 'plan' },
    { id: 'a2', who: '設計担当', section: 'next', text: '画面の設計レビュー（直した）', wbs: [], origin: 'edited', key: 'wbs:next:W-02' },
    { id: 'a3', who: '設計担当', section: 'next', text: '自動のまま', wbs: [], origin: 'auto', key: 'wbs:next:W-04' },
    { id: 'm2', who: '設計担当', section: 'next', text: '消した行', wbs: [], origin: 'removed' },
    { id: 'm3', who: '設計担当', section: 'consult', text: '相談', wbs: [], origin: 'manual' },
  ]

  test('人が足した行・直した行だけを、今日の予定（自動の行と同じ扱い）にする。自動のまま・消した・ほかの見出しは持ち越さない', () => {
    const carried = carriedOver(previous, '2026-11-09')
    expect(carried.map(e => e.text)).toEqual(['API の設計を始める', '画面の設計レビュー（直した）'])
    expect(carried[0]).toMatchObject({ section: 'today', origin: 'auto', tag: 'plan', wbs: ['W-03'], key: 'carry:2026-11-09:m1' })
  })

  test('今日に置いた行を直したり消したりしても、作り直しで戻らない（鍵で見分ける）', () => {
    const carried = carriedOver(previous, '2026-11-09')
    const todayFile: DailyEntry[] = [{ ...(carried[0] as DailyEntry), id: 'a1', text: '直した', origin: 'edited' }]
    const merged = mergeDaily(todayFile, carried)
    expect(merged.filter(e => e.key === 'carry:2026-11-09:m1').map(e => e.text)).toEqual(['直した'])
  })
})

describe('課題ごとの要約（読み上げ用）', () => {
  const row = (id: string, text: string, extra: Partial<DailyEntry> = {}): DailyEntry =>
    ({ id, who: '設計担当', section: 'today', text, wbs: [], origin: 'manual', ...extra })
  const entries: DailyEntry[] = [
    row('m1', '設計書を直した', { issue: 'BL-1' }),
    row('m2', '試験書を直した', { issue: 'BL-1' }),
    row('m3', '問い合わせに答えた', { issue: 'BL-2' }),
    row('m4', '朝会の準備'),
    row('m5', '仕様変更があって、いまは結合試験の途中です。今日は終わりません。終わったらリリースの準備をします', { section: 'summary', issue: 'BL-1' }),
    row('m6', '明日は BL-1 の試験の残り', { section: 'next', issue: 'BL-1' }),
  ]

  test('読み上げでは、要約のある課題の今日の行を要約 1 行に置き換え、要約を今日の先頭に出す', () => {
    const read = readAloud(entries)
    expect(read.filter(e => e.section === 'today').map(e => e.id)).toEqual(['m5', 'm3', 'm4'])
    expect(read.find(e => e.id === 'm5')?.section).toBe('today')
  })

  test('読み上げでも、要約の無い課題・課題の無い行・次の作業日の行はそのまま', () => {
    const read = readAloud(entries)
    expect(read.map(e => e.id)).toContain('m3')
    expect(read.map(e => e.id)).toContain('m4')
    expect(read.find(e => e.id === 'm6')?.section).toBe('next')
  })

  test('要約が無ければ、読み上げも今の行のまま', () => {
    const plain = entries.filter(e => e.section !== 'summary')
    expect(readAloud(plain)).toEqual(plain)
  })

  test('詳しく（今の表示）の文には、要約の行を入れない', () => {
    expect(withoutSummaries(entries).map(e => e.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm6'])
  })
})

describe('staleWaits（古いままの待ちの行）', () => {
  const row = (id: string, over: Partial<DailyEntry>): DailyEntry => ({ id, who: 'A', section: 'today', text: '', wbs: [], origin: 'manual', ...over })
  const now = new Date(2026, 10, 13, 16, 0)
  const rule = { hours: 3, words: ['確認中'] }

  test('wait のバッジか決めた語のある行で、3 時間以上直していないものだけを返す', () => {
    const entries = [
      row('m1', { badges: [{ text: '待ち', tone: 'wait' }], updated: '2026-11-13T10:12' }),
      row('m2', { text: '上長に確認中', updated: '2026-11-13T12:59' }),
      row('m3', { text: '上長に確認中', updated: '2026-11-13T13:30' }),
      row('m4', { badges: [{ text: '遅延', tone: 'hole' }], updated: '2026-11-13T08:00' }),
      row('m5', { text: '確認中', origin: 'removed', updated: '2026-11-13T08:00' }),
      row('a1', { text: '確認中', origin: 'auto' }),
    ]
    expect(staleWaits(entries, now, rule).map(e => e.id)).toEqual(['m1', 'm2'])
  })

  test('hours が 0 なら何も返さない', () => {
    expect(staleWaits([row('m1', { text: '確認中', updated: '2026-11-01T00:00' })], now, { ...rule, hours: 0 })).toEqual([])
  })
})
