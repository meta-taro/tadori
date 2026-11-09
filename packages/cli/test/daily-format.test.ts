import { describe, expect, test } from 'vitest'
import { buildDaily, type Project, type StatusChange, type Task } from '@tadori/core'
import { formatDaily, formatEntries, DEFAULT_DAILY_FORMAT } from '../src/daily-format.js'
import { linksOf } from '../src/daily.js'
import { entriesFromSheet } from '@tadori/core'

// 架空の案件。担当は役割の名前だけ
const statuses = [
  { id: 'todo', name: '未着手', tone: 'none' as const },
  { id: 'doing', name: '進行中', tone: 'wait' as const },
  { id: 'done', name: '完了', tone: 'ok' as const },
]
const task = (id: string, name: string, status: string, start: string, end: string): Task =>
  ({ id, phase: 'dd', name, status, owner: '設計担当', start, end })
const project = {
  name: '架空', phases: [{ id: 'dd', name: '詳細設計', order: 1 }], rules: [], approvals: [], statuses,
  tasks: [
    { ...task('W-01', '画面の設計', 'done', '2026-11-04', '2026-11-09'), issue: 'Q-12' },
    { ...task('W-02', '画面の設計レビュー', 'doing', '2026-11-09', '2026-11-11'), issue: 'Q-12' },
    task('W-03', 'API の設計', 'todo', '2026-11-10', '2026-11-13'),
  ],
  items: [{ id: 'Q-12', kind: 'Q', title: '一覧の並び順を利用者が選べるようにするかの確認', source: 'questions.md', refs: [], fields: { short: '並び順' } }],
} as unknown as Project
const changes: StatusChange[] = [
  { taskId: 'W-01', date: '2026-11-09', from: 'doing', to: 'done' },
  { taskId: 'W-02', date: '2026-11-09', from: 'todo', to: 'doing' },
]
const sheet = buildDaily(project, changes, '2026-11-09', '設計担当')
const text = formatDaily(sheet, project)
const section = (head: RegExp, body = text) => body.split('\n\n').find(s => head.test(s)) ?? ''

describe('補足の正本へのリンク', () => {
  test('課題の source が正本の表にあれば、補足に正本の URL と反映の記録を添える', () => {
    const withSource = {
      ...project,
      items: [{ ...project.items[0], source: '課題表 #12', fields: { synced_at: '2026-11-08 18:00', synced_by: '設計担当' } }],
      sources: [{ name: '課題表', url: 'https://issues.example.com/p', locator: '{url}/{num}', staleDays: 7 }],
    } as unknown as Project
    const notes = section(/^補足/, formatDaily(sheet, withSource))
    expect(notes).toContain('1. 課題 Q-12：一覧の並び順を利用者が選べるようにするかの確認（課題表 #12）正本：https://issues.example.com/p/12（反映 2026-11-08 18:00 設計担当）')
  })
})

describe('formatDaily（1 日の進行の文・既定の形）', () => {
  test('見出しは 今日・次の作業日・相談・補足 の順で、日付と曜日を入れる', () => {
    const heads = text.split('\n').filter(l => /^(今日|次の作業日|相談|補足)/.test(l))
    expect(heads).toEqual(['今日（11/9 月）1 件', '次の作業日（11/10 火）', '相談', '補足'])
  })

  test('1 件は 課題 → 短い名前 → 作業 →（WBS の ID 状態 期限）。同じ課題の WBS の行は 1 件にまとめる', () => {
    expect(section(/^今日/)).toContain('1. ［作業中］Q-12 並び順 画面の設計・画面の設計レビュー（W-01 完了 11/9・W-02 進行中 11/11）')
  })

  test('課題の無い作業は課題を書かない。既定では続く作業に印を付けない', () => {
    expect(section(/^次の作業日/)).toContain('2. ［予定］Q-12 並び順 画面の設計レビュー（W-02 進行中 11/11）')
    expect(section(/^次の作業日/)).toContain('3. ［予定］API の設計（W-03 未着手 11/13）')
  })

  test('本文に場所を挟まない。正式な名前と場所は、同じ番号で補足に出す', () => {
    expect(section(/^今日/)).not.toContain('questions.md')
    expect(section(/^補足/)).toContain('1. 課題 Q-12：一覧の並び順を利用者が選べるようにするかの確認（questions.md）')
    expect(section(/^補足/)).toMatch(/^3\. W-03：API の設計（詳細設計・11\/10〜11\/13）/m)
  })

  test('相談は人が書くので、見出しだけを置く（tadori は中身を作らない）', () => {
    expect(section(/^相談/)).toBe('相談')
  })
})

describe('formatEntries の形は案件ごとに変えられる（.tadori/daily-format.tsv）', () => {
  const custom = {
    ...DEFAULT_DAILY_FORMAT,
    today: 'Done ({date}) x{count}',
    next: 'Next ({date})',
    consult: 'Ask',
    notes: 'Refs',
    wbs: '#{num}',
    continued: '[cont] ',
  }
  const out = formatEntries(entriesFromSheet(sheet, custom.continued), project, '2026-11-09', custom)

  test('見出しの言葉・WBS の番号の書き方・続く作業の印を、案件の設定で変えられる', () => {
    expect(out.split('\n').filter(l => /^(Done|Next|Ask|Refs)/.test(l))).toEqual(['Done (11/9 月) x1', 'Next (11/10 火)', 'Ask', 'Refs'])
    expect(section(/^Next/, out)).toContain('2. ［予定］Q-12 並び順 [cont] 画面の設計レビュー（#02 進行中 11/11）')
  })
})

describe('formatEntries の番号の振り方', () => {
  const perSection = formatEntries(entriesFromSheet(sheet), project, '2026-11-09', { ...DEFAULT_DAILY_FORMAT, numbering: 'per-section' })

  test('per-section なら見出しごとに 1 から振り直し、補足は見出しの名前で分けて同じ番号を使う', () => {
    expect(section(/^次の作業日/, perSection)).toMatch(/^次の作業日（11\/10 火）\n1\. /)
    expect(section(/^補足/, perSection)).toMatch(/^補足\n今日\n1\. 課題 Q-12/)
    expect(section(/^補足/, perSection)).toMatch(/\n次の作業日\n1\. 課題 Q-12/)
  })

  test('既定は通し番号', () => {
    expect(section(/^次の作業日/)).toMatch(/\n2\. /)
  })
})

describe('formatEntries の台帳の整備', () => {
  const entries = [
    ...entriesFromSheet(sheet),
    { id: 'a9', who: '設計担当', section: 'upkeep' as const, text: '台帳の DD-1（上限の判定）の change を直した', wbs: [], origin: 'auto' as const },
  ]

  test('台帳の整備は、相談のあとに別の見出しで出す（今日の作業と同じ見た目で並べない）', () => {
    const out = formatEntries(entries, project, '2026-11-09')
    const heads = out.split('\n').filter(l => /^(今日|次の作業日|相談|台帳の整備|補足)/.test(l))
    expect(heads).toEqual(['今日（11/9 月）1 件', '次の作業日（11/10 火）', '相談', '台帳の整備', '補足'])
    expect(section(/^今日/, out)).not.toContain('台帳の')
  })

  test('upkeep_mode が hide なら、台帳の整備は出さない。整備が無い日は見出しも出さない', () => {
    expect(formatEntries(entries, project, '2026-11-09', { ...DEFAULT_DAILY_FORMAT, upkeep_mode: 'hide' })).not.toContain('台帳の整備')
    expect(text).not.toContain('台帳の整備')
  })
})

describe('formatEntries の印', () => {
  const tagged = [
    { id: 'a1', who: 'x', section: 'today' as const, text: '画面の設計', wbs: [], origin: 'auto' as const, tag: 'done' },
    { id: 'a2', who: 'x', section: 'next' as const, text: 'API の設計', wbs: [], origin: 'auto' as const, tag: 'plan' },
  ]

  test('行の頭に印を出す。言葉は既定（済・予定）で、案件の設定で替えられる', () => {
    const out = formatEntries(tagged, project, '2026-11-09')
    expect(out).toContain('1. ［済］画面の設計')
    expect(out).toContain('2. ［予定］API の設計')
    const custom = formatEntries(tagged, project, '2026-11-09', { ...DEFAULT_DAILY_FORMAT, tag_done: 'DONE', tag_format: '<{tag}> ' })
    expect(custom).toContain('1. <DONE> 画面の設計')
  })

  test('印の言葉を空にすると、その印は出さない', () => {
    expect(formatEntries(tagged, project, '2026-11-09', { ...DEFAULT_DAILY_FORMAT, tag_plan: '' })).toContain('2. API の設計')
  })
})

describe('linksOf（文の中の WBS・課題の書き方 → 画面の飛び先）', () => {
  test('WBS は案件の書き方（例：WBS{num}）のまま、課題は ID のまま、飛び先を付ける', () => {
    const entries = entriesFromSheet(sheet, DEFAULT_DAILY_FORMAT.continued)
    const links = linksOf(entries, { ...DEFAULT_DAILY_FORMAT, wbs: 'WBS{num}' })
    expect(links).toEqual(expect.arrayContaining([{ text: 'WBS01', href: '#browse-W-01' }, { text: 'Q-12', href: '#trace-Q-12' }]))
  })
})

describe('行のリンクと、担当で絞っていないときの担当名', () => {
  const entries = [
    { id: 'm1', who: '設計担当', section: 'today' as const, text: 'QA を返した', wbs: [], origin: 'manual' as const, links: [{ label: 'QA表', url: 'https://sheets.example.com/qa#row=12' }] },
    { id: 'm2', who: '検証担当', section: 'next' as const, text: '観点を見直す', wbs: [], origin: 'manual' as const },
  ]

  test('行のリンクは読み上げる行には入れず、補足に「表示名：URL」で出す', () => {
    const text = formatEntries(entries, project, '2026-11-09')
    expect(text).toMatch(/^1\. QA を返した$/m)
    expect(section(/^補足/, text)).toContain('1. QA表：https://sheets.example.com/qa#row=12')
  })

  test('showWho（担当で絞っていない）なら、読み上げる行に担当名を入れる。絞っているときは入れない', () => {
    expect(formatEntries(entries, project, '2026-11-09', DEFAULT_DAILY_FORMAT, { showWho: true })).toMatch(/^1\. 設計担当：QA を返した$/m)
    expect(formatEntries(entries, project, '2026-11-09', { ...DEFAULT_DAILY_FORMAT, who_format: '（{who}）' }, { showWho: true })).toMatch(/^2\. （検証担当）観点を見直す$/m)
    expect(formatEntries(entries, project, '2026-11-09')).not.toContain('設計担当：')
  })
})
