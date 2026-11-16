import { afterAll, describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { docDiff, docVersions, versionAt } from '../src/infrastructure/doc-versions.js'

const made: string[] = []
afterAll(async () => { for (const d of made) await rm(d, { recursive: true, force: true }) })

const commitAt = (root: string, date: string, message: string) => {
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', message], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } })
}

/** docs/a.md を 3 回変えた案件（1 回目の間に、別のファイルだけの commit を挟む） */
async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tadori-doc-'))
  made.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'docs', 'a.md'), '# 章\n延滞は 30 日\n', 'utf8')
  commitAt(root, '2026-10-01T09:00:00+09:00', '基本設計の初版')
  await writeFile(join(root, 'docs', 'b.md'), 'ほか\n', 'utf8')
  commitAt(root, '2026-10-05T09:00:00+09:00', '別の文書')
  await writeFile(join(root, 'docs', 'a.md'), '# 章\n延滞は 60 日\n', 'utf8')
  commitAt(root, '2026-10-20T09:00:00+09:00', '延滞の日数を直す')
  return root
}

describe('docVersions', () => {
  test('その文書を変えた commit を、新しい順に（短い ID・日時・一言）返す。ほかの文書だけの commit は入れない', async () => {
    const root = await project()
    const versions = await docVersions(root, 'docs/a.md')
    expect(versions.map(v => [v.date, v.subject])).toEqual([
      ['2026-10-20T09:00:00+09:00', '延滞の日数を直す'],
      ['2026-10-01T09:00:00+09:00', '基本設計の初版'],
    ])
    expect(versions[0]?.commit).toMatch(/^[0-9a-f]{7,}$/)
  })

  test('git の外・commit の無い文書なら空', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'tadori-nogit-'))
    made.push(plain)
    expect(await docVersions(plain, 'docs/a.md')).toEqual([])
    expect(await docVersions(await project(), 'docs/none.md')).toEqual([])
  })
})

describe('docDiff', () => {
  test('2 つの版の、その文書だけの差分を返す（to を省けば、最後の commit まで）', async () => {
    const root = await project()
    const [latest, first] = await docVersions(root, 'docs/a.md')
    const diff = await docDiff(root, 'docs/a.md', first?.commit ?? '')
    expect(diff).toContain('-延滞は 30 日')
    expect(diff).toContain('+延滞は 60 日')
    expect(diff).not.toContain('b.md')
    expect(await docDiff(root, 'docs/a.md', latest?.commit ?? '', latest?.commit)).toBe('')
  })

  test('版の名前に commit の ID でないもの（オプションや範囲の書き方）が来たら断る', async () => {
    const root = await project()
    await expect(docDiff(root, 'docs/a.md', '--output=x')).rejects.toThrow()
    await expect(docDiff(root, 'docs/a.md', 'HEAD~1..HEAD')).rejects.toThrow()
  })
})

describe('versionAt', () => {
  test('その日時に有効だった版（その日時より前で、いちばん新しい版）。日付だけならその日の終わりまでを含む', () => {
    const versions = [
      { commit: 'c3', date: '2026-10-20T09:00:00+09:00', subject: '' },
      { commit: 'c1', date: '2026-10-01T09:00:00+09:00', subject: '' },
    ]
    expect(versionAt(versions, '2026-10-10')?.commit).toBe('c1')
    expect(versionAt(versions, '2026-10-20')?.commit).toBe('c3')
    expect(versionAt(versions, '2026-09-01')).toBeUndefined()
  })
})
