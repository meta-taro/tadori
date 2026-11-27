import { describe, expect, test } from 'vitest'
import { stageOf, statusMismatches } from '../src/usecase/status-mismatch.js'
import type { StatusDef, Task } from '../src/domain/model.js'
import type { DailyEntry } from '../src/usecase/daily-entries.js'

const statuses: StatusDef[] = [
  { id: 'todo', name: '未着手', tone: 'none' },
  { id: 'doing', name: '進行中', tone: 'wait' },
  { id: 'done', name: '完了', tone: 'ok' },
]
const task = (id: string, status: string): Task => ({ id, phase: 'it', name: `作業 ${id}`, status })
const row = (id: string, wbs: string, tag: string, origin: DailyEntry['origin'] = 'manual'): DailyEntry => ({ id, who: '', section: 'today', text: 'x', wbs: [wbs], tag, origin })

describe('工程の状態と、1 日の進行の行の印の食い違い', () => {
  test('statuses.tsv のいちばん上を未着手、tone ok を終えたとみなす（遅れの日数と同じ読み方）。途中の状態は見ない', () => {
    expect(stageOf('todo', statuses)).toBe('todo')
    expect(stageOf('完了', statuses)).toBe('done')
    expect(stageOf('doing', statuses)).toBeUndefined()
    expect(stageOf('unknown', statuses)).toBeUndefined()
  })

  test('未着手の工程に「作業中」「やり終えた」の行、終えた工程に「予定」「作業中」の行があると知らせる。消した行・合っている行は入れない', () => {
    const tasks = [task('W-1', 'todo'), task('W-2', 'done'), task('W-3', 'doing'), task('W-4', 'done')]
    const entries = [
      row('a', 'W-1', 'doing'), row('b', 'W-1', 'done'), row('c', 'W-1', 'plan'),
      row('d', 'W-2', 'plan'), row('e', 'W-2', 'doing', 'removed'),
      row('f', 'W-3', 'done'), row('g', 'W-4', 'done'),
    ]
    expect(statusMismatches(entries, tasks, statuses)).toEqual([
      { task: 'W-1', name: '作業 W-1', status: '未着手', stage: 'todo', tags: ['doing', 'done'], rows: ['a', 'b'] },
      { task: 'W-2', name: '作業 W-2', status: '完了', stage: 'done', tags: ['plan'], rows: ['d'] },
    ])
  })
})
