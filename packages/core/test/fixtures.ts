import type { Approval, Item, Phase, Project, Rule, Task } from '../src/domain/model.js'

// テスト用の小さな架空の案件。実案件のデータは使わない

const phases: Phase[] = [
  { id: 'bd', name: '基本設計', order: 1 },
  { id: 'dd', name: '詳細設計', order: 2 },
  { id: 'it', name: '結合テスト', order: 3 },
]

const rule = (r: Partial<Rule> & Pick<Rule, 'id' | 'phase' | 'kind'>): Rule => ({
  from: '', to: '', field: '', label: '', ...r,
})

const rules: Rule[] = [
  rule({ id: 'R2', phase: 'bd', kind: 'approval', label: '基本設計書をレビュー担当が承認した' }),
  rule({ id: 'R3', phase: 'dd', kind: 'covered', from: 'BD', to: 'DD', label: '基本設計の章から詳細設計の節が出ている' }),
  rule({ id: 'R4', phase: 'dd', kind: 'filled', from: 'DD', field: 'change', label: '改修後の対応が書いてある' }),
  rule({ id: 'R8', phase: 'it', kind: 'covered', from: 'V', to: 'TC', label: '観点ごとに試験ケースがある' }),
  rule({ id: 'R9', phase: 'it', kind: 'covered', from: 'TC', to: 'RUN', label: '試験ケースに実施の記録がある' }),
]

const item = (id: string, kind: string, refs: string[] = [], fields: Record<string, string> = {}): Item => ({
  id, kind, title: `${id} の題`, source: `${id}.md`, refs, fields,
})

const items: Item[] = [
  item('BD-1', 'BD'),
  item('BD-2', 'BD'), // 詳細設計の節が無い → R3 の漏れ
  item('DD-1', 'DD', ['BD-1'], { change: '変わる' }),
  item('DD-2', 'DD', ['BD-1'], { change: '' }), // 改修後の対応が空 → R4 の漏れ
  item('V-1', 'V', ['DD-1']),
  item('TC-1', 'TC', ['V-1']),
  item('TC-2', 'TC', ['V-1', 'V-9']), // V-9 は存在しない → ID の漏れ
  item('RUN-1', 'RUN', ['TC-1']),
  item('F-1', 'F', ['TC-2']),
]

const tasks: Task[] = [
  { id: 'W-1', phase: 'bd', name: '基本設計書の作成', start: '2026-09-01', end: '2026-09-30', status: 'done' },
  { id: 'W-2', phase: 'bd', name: '基本設計レビュー', start: '2026-10-01', end: '2026-10-10', status: 'review' },
  { id: 'W-3', phase: 'dd', name: '詳細設計', start: '2026-10-05', end: '2026-10-31', status: 'doing' },
  { id: 'W-4', phase: 'it', name: '結合テスト', start: '2026-11-10', end: '2026-11-30', status: 'todo' },
]

const approvals: Approval[] = [
  { rule: 'R2', status: '差し戻し', who: 'レビュー担当', when: '2026-10-10' },
]

export const sampleProject: Project = {
  name: '見本',
  phases,
  rules,
  items,
  tasks,
  approvals,
  statuses: [
    { id: 'todo', name: '未着手', tone: 'none' },
    { id: 'doing', name: '進行中', tone: 'wait' },
    { id: 'review', name: 'レビュー中', tone: 'wait' },
    { id: 'done', name: '完了', tone: 'ok' },
  ],
}
