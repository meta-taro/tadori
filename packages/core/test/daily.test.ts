import { describe, expect, test } from 'vitest'
import { buildDaily, nextWorkday, type StatusChange } from '../src/usecase/daily.js'
import type { Item, Project, Task } from '../src/domain/model.js'

// 架空の案件。担当は役割の名前だけ（実在の人の名前は使わない）
const statuses = [
  { id: 'todo', name: '未着手', tone: 'none' as const },
  { id: 'doing', name: '進行中', tone: 'wait' as const },
  { id: 'done', name: '完了', tone: 'ok' as const },
]
const task = (id: string, name: string, status: string, owner: string, start: string, end: string): Task =>
  ({ id, phase: 'dd', name, status, owner, start, end })
const tasks: Task[] = [
  { ...task('W-01', '画面の設計', 'done', '設計担当', '2026-11-04', '2026-11-09'), issue: 'BUG-012' },
  { ...task('W-02', '画面の設計レビュー', 'doing', '設計担当', '2026-11-09', '2026-11-11'), issue: 'BUG-012' },
  task('W-03', 'API の設計', 'todo', '設計担当', '2026-11-10', '2026-11-13'),
  task('W-04', '試験ケースの作成', 'doing', '検証担当', '2026-11-05', '2026-11-12'),
  task('W-05', '設定画面の設計', 'todo', '設計担当', '2026-11-20', '2026-11-25'),
]
const items: Item[] = [
  { id: 'BUG-012', kind: 'BUG', title: '一覧の並び順が逆', source: 'issues/012.md', refs: [], fields: {} },
]
const project = { name: '架空', phases: [{ id: 'dd', name: '詳細設計', order: 1 }], rules: [], items, tasks, approvals: [], statuses } as unknown as Project
const changes: StatusChange[] = [
  { taskId: 'W-01', date: '2026-11-09', from: 'doing', to: 'done' },
  { taskId: 'W-02', date: '2026-11-09', from: 'todo', to: 'doing' },
  { taskId: 'W-04', date: '2026-11-05', from: 'todo', to: 'doing' },
]

describe('nextWorkday', () => {
  test('土日を飛ばして次の平日にする', () => {
    expect(nextWorkday('2026-11-09')).toBe('2026-11-10') // 月 → 火
    expect(nextWorkday('2026-11-13')).toBe('2026-11-16') // 金 → 月
  })
})

describe('buildDaily（人単位の 1 日の進行）', () => {
  const sheet = buildDaily(project, changes, '2026-11-09', '設計担当')

  test('担当で絞る', () => {
    const ids = [...sheet.today, ...sheet.next].flatMap(l => l.tasks.map(t => t.id))
    expect(ids).not.toContain('W-04')
  })

  test('今日：その日に状態が変わったタスク。同じ課題につながる WBS の行は 1 件にまとめる', () => {
    expect(sheet.today).toHaveLength(1)
    expect(sheet.today[0]?.issue?.id).toBe('BUG-012')
    expect(sheet.today[0]?.tasks.map(t => t.id)).toEqual(['W-01', 'W-02'])
  })

  test('次の作業日：続いている作業と、その日までに始まるものを出す。先のものは出さない', () => {
    expect(sheet.nextDate).toBe('2026-11-10')
    const w02 = sheet.next.find(l => l.tasks.some(t => t.id === 'W-02'))
    expect(w02?.continued).toBe(true)
    expect(sheet.next.some(l => l.tasks.some(t => t.id === 'W-03'))).toBe(true)
    expect(sheet.next.some(l => l.tasks.some(t => t.id === 'W-05'))).toBe(false)
    expect(sheet.next.some(l => l.tasks.some(t => t.id === 'W-01'))).toBe(false) // 済んだものは次回に出さない
  })

  test('番号は今日から次回へ通しで振る（補足と同じ番号にするため）', () => {
    expect(sheet.today.map(l => l.no)).toEqual([1])
    expect(sheet.next.map(l => l.no)).toEqual(sheet.next.map((_, i) => i + 2))
  })

  test('担当を渡さなければ、全員分を出す', () => {
    const all = buildDaily(project, changes, '2026-11-09')
    expect([...all.today, ...all.next].flatMap(l => l.tasks.map(t => t.id))).toContain('W-04')
  })
})

describe('buildDaily の課題', () => {
  test('課題は WBS の issue 列に書かれたものだけ。台帳の行が WBS を refs に持っていても、推測で課題にしない', () => {
    const guessing = { ...project, items: [...items, { id: 'BD-2', kind: 'BD', title: '貸出上限', source: 'bd.md', refs: ['W-03'], fields: {} }] } as unknown as Project
    const sheet = buildDaily(guessing, changes, '2026-11-09', '設計担当')
    const w03 = sheet.next.find(l => l.tasks.some(t => t.id === 'W-03'))
    expect(w03?.issue).toBeUndefined()
  })
})

describe('buildDaily の担当が 2 人', () => {
  test('担当の欄に「A・B」のように 2 人書いてあれば、どちらの名前でも絞れる', () => {
    const pair = { ...project, tasks: [...tasks, task('W-06', '共同の見直し', 'doing', '設計担当・検証担当', '2026-11-09', '2026-11-12')] } as unknown as Project
    for (const who of ['設計担当', '検証担当']) {
      const sheet = buildDaily(pair, changes, '2026-11-09', who)
      expect(sheet.next.some(l => l.tasks.some(t => t.id === 'W-06'))).toBe(true)
    }
  })
})
