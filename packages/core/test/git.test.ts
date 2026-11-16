import { afterAll, describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { lastCommits, repositoryPrefix, ruleAddedDates } from '../src/infrastructure/git.js'

const made: string[] = []
afterAll(async () => { for (const d of made) await rm(d, { recursive: true, force: true }) })

describe('repositoryPrefix', () => {
  test('案件のフォルダが git リポジトリの中の 1 段下なら、最上位からの場所を返す', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tadori-git-'))
    made.push(root)
    execFileSync('git', ['init', '-q'], { cwd: root })
    await mkdir(join(root, 'examples', 'lend'), { recursive: true })
    expect(await repositoryPrefix(join(root, 'examples', 'lend'))).toBe('examples/lend/')
  })

  test('最上位そのもの・git の外なら空', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'tadori-nogit-'))
    made.push(plain)
    expect(await repositoryPrefix(plain)).toBe('')
  })
})

describe('ruleAddedDates', () => {
  const commitAt = (root: string, date: string) => {
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'x'], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } })
  }

  test('ルールごとに、ルールセットにその ID の行が最初に入った commit の日を返す（直しても、別のファイルへ移しても変わらない）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tadori-git-'))
    made.push(root)
    execFileSync('git', ['init', '-q'], { cwd: root })
    const sets = join(root, '.tadori', 'rulesets')
    await mkdir(sets, { recursive: true })
    const header = '# 見本\nid\tphase\tkind\tlabel\n'
    await writeFile(join(sets, 'a.tsv'), `${header}R1\tbd\tnote\t最初\n`, 'utf8')
    commitAt(root, '2026-10-01T09:00:00+09:00')
    await writeFile(join(sets, 'a.tsv'), `${header}R1\tbd\tnote\t直した\nR2\tbd\tnote\t次\n`, 'utf8')
    commitAt(root, '2026-10-15T09:00:00+09:00')
    await writeFile(join(sets, 'a.tsv'), `${header}R1\tbd\tnote\t直した\n`, 'utf8')
    await writeFile(join(sets, 'b.tsv'), `${header}R2\tbd\tnote\t次\nN3\t\tnote\t約束\n`, 'utf8')
    commitAt(root, '2026-11-02T09:00:00+09:00')
    expect(await ruleAddedDates(root)).toEqual({ R1: '2026-10-01', R2: '2026-10-15', N3: '2026-11-02' })
  })

  test('git の外・ルールセットの履歴が無ければ空', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'tadori-nogit-'))
    made.push(plain)
    expect(await ruleAddedDates(plain)).toEqual({})
  })
})

describe('lastCommits', () => {
  test('ファイルごとに、最後に変えた commit（短い ID と日時）を返す。commit の無いファイルは入れない', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tadori-git-'))
    made.push(root)
    execFileSync('git', ['init', '-q'], { cwd: root })
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, 'docs', 'a.md'), 'a', 'utf8')
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'a'], { cwd: root, env: { ...process.env, GIT_COMMITTER_DATE: '2026-10-12T09:00:00+09:00' } })
    const result = await lastCommits(root, ['docs/a.md', 'docs/none.md'])
    expect(Object.keys(result)).toEqual(['docs/a.md'])
    expect(result['docs/a.md']?.commit).toMatch(/^[0-9a-f]{7,}$/)
    expect(result['docs/a.md']?.date).toBe('2026-10-12T09:00:00+09:00')
  })

  test('git の外なら空', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'tadori-nogit-'))
    made.push(plain)
    expect(await lastCommits(plain, ['a.md'])).toEqual({})
  })
})
