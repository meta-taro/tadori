import { afterAll, describe, expect, test } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/infrastructure/scaffold.js'
import { loadProject, PATHS } from '../src/infrastructure/repository.js'

const made: string[] = []
afterAll(async () => { for (const d of made) await rm(d, { recursive: true, force: true }) })

async function emptyDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tadori-init-'))
  made.push(dir)
  return dir
}

describe('initProject', () => {
  test('空のフォルダに、tadori が読める最小の設定と台帳を作る', async () => {
    const dir = await emptyDir()
    const result = await initProject(dir, '試しの案件')
    expect(result.created).toEqual(expect.arrayContaining([PATHS.project, PATHS.phases, PATHS.statuses, PATHS.items, PATHS.wbs, PATHS.approvals]))
    expect(result.skipped).toEqual([])
    const project = await loadProject(dir)
    expect(project.name).toBe('試しの案件')
    expect(project.phases.length).toBeGreaterThan(0)
    expect(project.statuses.map(s => s.id)).toContain('done')
  })

  test('ルールは例をコメントで置くだけ（会社ごとに書くもので、tadori が決めない）', async () => {
    const dir = await emptyDir()
    await initProject(dir, 'x')
    expect((await loadProject(dir)).rules).toEqual([])
    const files = (await initProject(dir, 'x')).skipped.filter(f => f.startsWith(PATHS.rulesets))
    expect(files.length).toBe(1)
    expect(await readFile(join(dir, files[0] as string), 'utf8')).toMatch(/# .*covered/)
  })

  test('ステータスの表の先頭に、行の順番の意味（1 行目＝まだ始めていない・tone ok＝終わった）を書く', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tadori-init-'))
    try {
      await initProject(dir, '見本')
      const text = await readFile(join(dir, PATHS.statuses), 'utf8')
      expect(text).toContain('1 行目')
      expect(text).toMatch(/まだ始めていない/)
      expect(text).toMatch(/ok.*終わった/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('すでにあるファイルは書き換えない', async () => {
    const dir = await emptyDir()
    await mkdir(join(dir, 'ledger'), { recursive: true })
    await writeFile(join(dir, PATHS.items), 'id\tkind\ttitle\tsource\trefs\nA-1\tA\t元からある\t\t\n', 'utf8')
    const result = await initProject(dir, 'x')
    expect(result.skipped).toContain(PATHS.items)
    expect(await readFile(join(dir, PATHS.items), 'utf8')).toContain('元からある')
  })
})
