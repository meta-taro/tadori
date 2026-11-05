import { describe, expect, test } from 'vitest'
import { validatePhases, validateStatuses } from '../src/usecase/settings.js'
import { sampleProject } from './fixtures.js'

describe('validatePhases', () => {
  test('工程を足す・並べ替えるのは通す', () => {
    const next = [
      { id: 'dd', name: '詳細設計', order: 1 },
      { id: 'bd', name: '基本設計', order: 2 },
      { id: 'it', name: '結合テスト', order: 3 },
      { id: 'st', name: '総合テスト', order: 4 },
    ]
    expect(validatePhases(sampleProject, next)).toEqual([])
  })

  test('ルールやタスクが使っている工程は消せない', () => {
    const next = [{ id: 'dd', name: '詳細設計', order: 1 }, { id: 'it', name: '結合テスト', order: 2 }]
    const problems = validatePhases(sampleProject, next)
    expect(problems.join('\n')).toMatch(/基本設計/)
    expect(problems.join('\n')).toMatch(/R2/)
    expect(problems.join('\n')).toMatch(/W-1/)
  })

  test('# で始まる ID や、タブ・改行・前後の空白を含む ID は止める（次に読むと消えたり列がずれたりする）', () => {
    const base = sampleProject.phases
    const problems = validatePhases(sampleProject, [...base, { id: '#x', name: '総合テスト', order: 9 }, { id: 'a\tb', name: 'x', order: 10 }])
    expect(problems.join('\n')).toMatch(/#x/)
    expect(problems.join('\n')).toMatch(/a\tb|タブ/)
  })

  test('ID の重複と空の名前は止める', () => {
    const next = [{ id: 'bd', name: '', order: 1 }, { id: 'bd', name: '基本設計', order: 2 }, { id: 'dd', name: '詳細設計', order: 3 }, { id: 'it', name: '結合テスト', order: 4 }]
    const problems = validatePhases(sampleProject, next)
    expect(problems.join('\n')).toMatch(/重複/)
    expect(problems.join('\n')).toMatch(/名前/)
  })
})

describe('validateStatuses', () => {
  test('タスクが使っているステータスは消せない', () => {
    const next = sampleProject.statuses.filter(s => s.id !== 'doing')
    expect(validateStatuses(sampleProject, next).join('\n')).toMatch(/進行中.*W-3/)
  })

  test('ステータスは 1 つ以上要る', () => {
    expect(validateStatuses({ ...sampleProject, tasks: [] }, [])).toEqual(['ステータスは 1 つ以上必要です'])
  })
})
