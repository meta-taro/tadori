// 組んだ CLI を、試験導入している人と同じ順で使う：init → 台帳を書く → check → why
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXAMPLE, harnessEnv, requireBuilt, runCli } from './run.js'

beforeAll(() => { requireBuilt() })

describe('見本の案件', () => {
  test('check は工程ごとの漏れと承認待ちを出し、漏れがあれば終了コード 1。割合は出さない', () => {
    const { code, stdout } = runCli(['check', EXAMPLE])
    expect(code).toBe(1)
    expect(stdout).toMatch(/■ 基本設計/)
    expect(stdout).toMatch(/漏れ \d+ 件 \/ 承認待ち \d+ 件/)
    expect(stdout).not.toMatch(/%/)
  })

  test('why は 1 件を上から辿る', () => {
    const { code, stdout } = runCli(['why', 'F-02', EXAMPLE])
    expect(code).toBe(0)
    expect(stdout).toContain('F-02')
  })
})

describe('新しく始める案件（init から）', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tadori-harness-'))
    execFileSync('git', ['init', '-q'], { cwd: dir, env: harnessEnv() })
  })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  test('init で置いたものだけで check が流れ、ルールの無い工程は「ルールなし」と出る', () => {
    expect(runCli(['init', dir, '--name', '試しの案件']).code).toBe(0)
    const { code, stdout, stderr } = runCli(['check', dir])
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout).toContain('ルールなし')
  })

  test('init の statuses.tsv は、行の順番の意味を先頭に書いている', async () => {
    const text = await readFile(join(dir, '.tadori/statuses.tsv'), 'utf8')
    expect(text).toMatch(/1 行目は「まだ始めていない」/)
  })

  test('WBS の状態を名前で書いても読み、表に無い状態は check が知らせる（漏れではないので終了コードは変えない）', async () => {
    const phases = await readFile(join(dir, '.tadori/phases.tsv'), 'utf8')
    const phase = phases.split(/\r?\n/).find(line => line && !line.startsWith('#') && !line.startsWith('id\t'))?.split('\t')[0]
    await writeFile(join(dir, 'ledger/wbs.tsv'), `id\tphase\tname\tstart\tend\tstatus\nW-1\t${phase}\t作る\t\t\t未着手\nW-2\t${phase}\t見直す\t\t\t未確認\n`, 'utf8')
    const { code, stdout } = runCli(['check', dir])
    expect(code).toBe(0)
    expect(stdout).toContain('■ .tadori/statuses.tsv に無い WBS の状態')
    expect(stdout).toContain('「未確認」：W-2')
    expect(stdout).not.toContain('「未着手」')
  })
})
