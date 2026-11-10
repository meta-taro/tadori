import { describe, expect, test } from 'vitest'
import { unknownTaskStatuses } from '../src/usecase/task-statuses.js'
import { sampleProject } from './fixtures.js'

describe('unknownTaskStatuses', () => {
  test('statuses.tsv に無い状態のタスクを、状態ごとにまとめて返す（空の状態も入れる）', () => {
    const project = {
      ...sampleProject,
      tasks: [
        ...sampleProject.tasks,
        { id: 'W-5', phase: 'it', name: 'a', status: '未確認' },
        { id: 'W-6', phase: 'it', name: 'b', status: '未確認' },
        { id: 'W-7', phase: 'it', name: 'c', status: '' },
      ],
    }
    expect(unknownTaskStatuses(project)).toEqual([
      { status: '未確認', taskIds: ['W-5', 'W-6'] },
      { status: '', taskIds: ['W-7'] },
    ])
  })

  test('全部の状態が statuses.tsv にあれば空', () => {
    expect(unknownTaskStatuses(sampleProject)).toEqual([])
  })
})
