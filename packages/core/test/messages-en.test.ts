import { afterAll, describe, expect, test } from 'vitest'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { JA } from '../src/i18n-ja.js'
import { withLang } from '../src/i18n.js'
import { saveItem } from '../src/infrastructure/project-writer.js'
import { loadProject, PATHS } from '../src/infrastructure/repository.js'
import { initProject } from '../src/infrastructure/scaffold.js'
import { runChecks } from '../src/usecase/check.js'
import { buildGates } from '../src/usecase/gates.js'
import { validateStatuses } from '../src/usecase/settings.js'
import { sampleProject } from './fixtures.js'

// tadori が出す言葉は英語が基本。日本語は辞書で引く（ほかのテストは日本語に固定してある）

const EXAMPLE = resolve(import.meta.dirname, '../../../examples/lend-v12')
const made: string[] = []
afterAll(async () => { for (const d of made) await rm(d, { recursive: true, force: true }) })

async function copyOfExample(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tadori-en-'))
  made.push(dir)
  await cp(EXAMPLE, dir, { recursive: true })
  return dir
}

/** 文の中の {名前} の一覧（並べ替えて比べる） */
const placeholdersOf = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1] as string).sort()

describe('英語の文', () => {
  test('漏れの文と直し方は、英語の 1 つの文になる（読み方があればそれを、無ければ記号を使う）', () => {
    const project = { ...sampleProject, labels: { kinds: { RUN: 'test record' }, columns: { change: 'post-change handling' } } }
    const leaks = withLang('en', () => runChecks(project))
    const r9 = leaks.find(l => l.rule === 'R9')
    expect(r9?.message).toBe('TC-2 "TC-2 の題" has no linked test record (試験ケースに実施の記録がある)')
    expect(r9?.fix).toBe('Add a test record (RUN) row to ledger/items.tsv and write TC-2 in its refs')
    expect(leaks.find(l => l.rule === 'R3')?.fix).toBe('Add a DD row to ledger/items.tsv and write BD-2 in its refs')
    expect(leaks.find(l => l.rule === 'R4')?.fix).toBe('Fill in the "post-change handling" column of the DD-2 row in ledger/items.tsv')
    expect(leaks.find(l => l.rule === 'ID')?.message).toBe('TC-2 points to IDs that do not exist: V-9')
  })

  test('承認待ちの案内は、承認の値（承認）を訳さずに英語の文で出す', () => {
    const gates = withLang('en', () => buildGates(sampleProject, runChecks(sampleProject), '2026-10-20'))
    const pending = gates.flatMap(g => g.pending).find(p => p.rule.id === 'R2')
    expect(pending?.fix).toBe('The approver sets the status of the R2 row in ledger/approvals.tsv to "承認" (approved), with their name and the date')
  })

  test('書くのを断った理由（WriteRefused）は英語で出る', async () => {
    const dir = await copyOfExample()
    await expect(withLang('en', () => saveItem(dir, { id: 'DD-2.3', kind: 'DD', title: 'x' }, { create: true })))
      .rejects.toThrow('DD-2.3 is already in the ledger (use update to change it)')
    await expect(withLang('en', () => saveItem(dir, { id: 'X-1', kind: 'X', title: 'x', refs: ['NOPE-9', 'NOPE-8'] }, { create: true })))
      .rejects.toThrow('refs contains IDs that are not in the ledger: NOPE-9, NOPE-8 (do not link by guesswork; add those rows first)')
  })

  test('案件の読み込みの問題は英語で出る', async () => {
    const dir = await copyOfExample()
    await writeFile(join(dir, PATHS.phases), 'id\tname\torder\ndesign\tDesign\tfirst\n', 'utf8')
    const error = await withLang('en', () => loadProject(dir)).catch((e: unknown) => e)
    expect((error as Error).message).toContain('Could not read the project:\n- ')
    expect((error as Error).message).toContain('.tadori/phases.tsv, design: order "first" must be a number')
  })

  test('設定の問題は英語で出る。並べる ID は「, 」でつなぐ', () => {
    const problems = withLang('en', () => validateStatuses(sampleProject, [{ id: 'todo', name: 'To do', tone: 'none' }]))
    expect(problems).toContain('Status "完了" cannot be removed because it is used by W-1')
    expect(withLang('en', () => validateStatuses(sampleProject, []))).toEqual(['At least one status is required'])
  })

  test('tadori init の雛形は、英語では英語の説明と名前で置く', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tadori-en-init-'))
    made.push(dir)
    await withLang('en', () => initProject(dir, 'trial'))
    const phases = await readFile(join(dir, PATHS.phases), 'utf8')
    expect(phases).toContain('design\tDesign\t1')
    expect(phases).not.toMatch(/[぀-ヿ一-鿿]/)
    expect((await loadProject(dir)).statuses.map(s => s.name)).toContain('Done')
  })
})

describe('日本語の辞書', () => {
  test('どの文も、英語の鍵と同じ {名前} を使う（差し込む値が抜けたり余ったりしない）', () => {
    const mismatched = Object.entries(JA).filter(([en, ja]) => placeholdersOf(en).join() !== placeholdersOf(ja).join())
    expect(mismatched).toEqual([])
  })
})
