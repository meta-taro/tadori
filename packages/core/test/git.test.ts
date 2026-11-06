import { afterAll, describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repositoryPrefix } from '../src/infrastructure/git.js'

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
