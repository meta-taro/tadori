import { describe, expect, test } from 'vitest'
import { approvalTargets, changedAfterApproval, sourceFile } from '../src/usecase/approval-changes.js'
import { buildGates } from '../src/usecase/gates.js'
import { runChecks } from '../src/usecase/check.js'
import type { Project } from '../src/domain/model.js'
import { sampleProject } from './fixtures.js'

const TODAY = '2026-11-05'

// R2 を「承認」にし、見る文書を BD の行の source にした案件
const approvedProject: Project = {
  ...sampleProject,
  rules: sampleProject.rules.map(r => (r.id === 'R2' ? { ...r, from: 'BD', owner: 'レビュー担当' } : r)),
  approvals: [{ rule: 'R2', status: '承認', who: 'レビュー担当', when: '2026-10-10' }],
}

describe('sourceFile', () => {
  test('source の「§」や行番号を外して、ファイルの場所だけにする', () => {
    expect(sourceFile('docs/basic-design.md §2')).toBe('docs/basic-design.md')
    expect(sourceFile('src/lend/guard.ts:42')).toBe('src/lend/guard.ts')
    expect(sourceFile('docs/a.md')).toBe('docs/a.md')
  })

  test('リンク（http など）と空は、見るファイルにしない', () => {
    expect(sourceFile('https://example.test/doc')).toBe('')
    expect(sourceFile('')).toBe('')
  })
})

describe('approvalTargets', () => {
  test('承認のルールの from の種類の行の source を、重ねずに集める', () => {
    const rule = approvedProject.rules.find(r => r.id === 'R2')
    if (!rule) throw new Error('R2 not found')
    expect(approvalTargets(approvedProject, rule)).toEqual(['BD-1.md', 'BD-2.md'])
  })

  test('from が無い承認のルールは、何も見ない（これまでどおり）', () => {
    const rule = sampleProject.rules.find(r => r.id === 'R2')
    if (!rule) throw new Error('R2 not found')
    expect(approvalTargets(sampleProject, rule)).toEqual([])
  })
})

describe('changedAfterApproval', () => {
  test('承認の日より後の日の commit があれば、その中でいちばん新しいものを返す', () => {
    const changes = { 'BD-1.md': { commit: 'aaa1111', date: '2026-10-12T09:00:00+09:00' }, 'BD-2.md': { commit: 'bbb2222', date: '2026-10-15T09:00:00+09:00' } }
    expect(changedAfterApproval('2026-10-10', ['BD-1.md', 'BD-2.md'], changes)).toEqual({ file: 'BD-2.md', commit: 'bbb2222', date: '2026-10-15T09:00:00+09:00' })
  })

  test('承認が日付だけなら、同じ日の commit は承認の前とみなす（どちらが先か分からないので、戻さない）', () => {
    const changes = { 'BD-1.md': { commit: 'aaa1111', date: '2026-10-10T18:00:00+09:00' } }
    expect(changedAfterApproval('2026-10-10', ['BD-1.md'], changes)).toBeUndefined()
  })

  test('承認に時刻まで書いてあれば、時刻で比べる', () => {
    const changes = { 'BD-1.md': { commit: 'aaa1111', date: '2026-10-10T18:00:00+09:00' } }
    expect(changedAfterApproval('2026-10-10T12:00+09:00', ['BD-1.md'], changes)?.commit).toBe('aaa1111')
    expect(changedAfterApproval('2026-10-10T19:00+09:00', ['BD-1.md'], changes)).toBeUndefined()
  })

  test('承認の日が読めなければ、戻さない（読めない日付で承認を消さない）', () => {
    const changes = { 'BD-1.md': { commit: 'aaa1111', date: '2026-10-12T09:00:00+09:00' } }
    expect(changedAfterApproval('', ['BD-1.md'], changes)).toBeUndefined()
    expect(changedAfterApproval('先週', ['BD-1.md'], changes)).toBeUndefined()
  })
})

describe('buildGates と承認のあとの変更', () => {
  test('承認のあとに見る文書が commit されたら、承認待ちに戻し、どのファイルのどの commit かを付ける', () => {
    const changes = { 'BD-2.md': { commit: 'bbb2222', date: '2026-10-15T09:00:00+09:00' } }
    const bd = buildGates(approvedProject, runChecks(approvedProject), TODAY, changes).find(g => g.phase.id === 'bd')
    expect(bd?.pendingApprovals.map(r => r.id)).toEqual(['R2'])
    expect(bd?.state).toBe('waiting')
    expect(bd?.pending.at(0)).toMatchObject({
      status: '承認',
      changedAfter: { file: 'BD-2.md', commit: 'bbb2222', date: '2026-10-15T09:00:00+09:00' },
      fix: 'レビュー担当が BD-2.md の変更（bbb2222）を見て、ledger/approvals.tsv の R2 の行の日付を、見た日に書き直す',
    })
  })

  test('承認より前の commit だけなら、承認のまま', () => {
    const changes = { 'BD-1.md': { commit: 'aaa1111', date: '2026-10-01T09:00:00+09:00' } }
    const bd = buildGates(approvedProject, runChecks(approvedProject), TODAY, changes).find(g => g.phase.id === 'bd')
    expect(bd?.pendingApprovals).toEqual([])
    expect(bd?.state).toBe('clear')
  })

  test('変更の記録を渡さなければ、これまでどおり承認の記録だけを見る', () => {
    const bd = buildGates(approvedProject, runChecks(approvedProject), TODAY).find(g => g.phase.id === 'bd')
    expect(bd?.pendingApprovals).toEqual([])
  })
})
