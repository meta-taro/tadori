import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { projectsText, readRecentProjects } from '../src/projects.js'

const EXAMPLE = resolve(import.meta.dirname, '../../../examples/lend-v12')
let empty = ''

beforeAll(async () => {
  empty = await mkdtemp(join(tmpdir(), 'tadori-projects-'))
})
afterAll(async () => {
  await rm(empty, { recursive: true, force: true })
})

describe('projectsText', () => {
  test('案件ごとに、漏れ・承認待ちの件数と、遅れているタスク・今日が期日のタスクを担当つきで並べる', async () => {
    // 見本では W-03（10/20 終わりのレビュー中）が 3 日遅れ、W-04（10/23 終わり）が今日まで
    const text = await projectsText([EXAMPLE], '2026-10-23')
    expect(text).toContain('備品貸出アプリ 改修 v1.2（架空の見本）')
    expect(text).toMatch(/漏れ \d+ 件 \/ 承認待ち \d+ 件/)
    expect(text).toContain('3 日遅れ: W-03 基本設計レビュー（設計担当）')
    expect(text).toContain('今日が期日: W-04 詳細設計（貸出上限）（設計担当）')
    expect(text).not.toContain('%')
  })

  test('案件でないフォルダは理由を書いて飛ばし、ほかの案件は出す', async () => {
    const text = await projectsText([empty, EXAMPLE], '2026-10-23')
    expect(text).toContain(`- ${empty}\n    .tadori が無いので飛ばしました`)
    expect(text).toContain('備品貸出アプリ')
  })

  test('同じフォルダは 1 回だけ出す', async () => {
    const text = await projectsText([EXAMPLE, `${EXAMPLE}/`], '2026-10-23')
    expect(text.split('備品貸出アプリ').length - 1).toBe(1)
  })

  test('案件が 1 つも無ければ、どうすればよいかを返す', async () => {
    expect(await projectsText([], '2026-10-23')).toContain('案件がありません')
  })
})

describe('readRecentProjects', () => {
  test('1 行に 1 フォルダ。BOM と空行は読み飛ばす', async () => {
    const file = join(empty, 'recent.txt')
    await writeFile(file, '\uFEFFC:/a\r\n\r\n  C:/b  \n', 'utf8')
    expect(await readRecentProjects(file)).toEqual(['C:/a', 'C:/b'])
  })

  test('一覧のファイルが無ければ空', async () => {
    expect(await readRecentProjects(join(empty, 'none.txt'))).toEqual([])
  })
})
