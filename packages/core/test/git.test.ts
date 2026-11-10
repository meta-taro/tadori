import { afterAll, describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { lastCommits, repositoryPrefix } from '../src/infrastructure/git.js'

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
