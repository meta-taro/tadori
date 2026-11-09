import { afterAll, describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readActivity } from '../src/infrastructure/activity.js'

const made: string[] = []
afterAll(async () => { for (const d of made) await rm(d, { recursive: true, force: true }) })

const ITEMS = 'id\tkind\ttitle\tsource\trefs\tchange\n'
const git = (cwd: string, date: string, author: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: author, GIT_COMMITTER_NAME: author, GIT_AUTHOR_EMAIL: 'x@example.invalid', GIT_COMMITTER_EMAIL: 'x@example.invalid', GIT_AUTHOR_DATE: `${date}T10:00:00`, GIT_COMMITTER_DATE: `${date}T10:00:00` } })

describe('readActivity（その日に台帳とチェックの記録で何をしたか）', () => {
  test('台帳に足した行・直した行と、チェックの記録を、だれがしたかつきで返す', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tadori-act-'))
    made.push(dir)
    await mkdir(join(dir, 'ledger'), { recursive: true })
    await mkdir(join(dir, '.tadori'), { recursive: true })
    git(dir, '2026-11-08', 'x', 'init', '-q')
    await writeFile(join(dir, 'ledger/items.tsv'), `${ITEMS}DD-1\tDD\t上限の判定\td.md\t\t\n`, 'utf8')
    git(dir, '2026-11-08', '設計担当', 'add', '-A'); git(dir, '2026-11-08', '設計担当', 'commit', '-q', '-m', 'a')
    await writeFile(join(dir, 'ledger/items.tsv'), `${ITEMS}DD-1\tDD\t上限の判定\td.md\t\t変わる\nRUN-13\tRUN\tTC-04 の実施\tr.json\tTC-04\t\n`, 'utf8')
    git(dir, '2026-11-09', '設計担当', 'commit', '-q', '-am', 'b')
    await writeFile(join(dir, '.tadori/checks.tsv'), 'when\twho\twhat\twhere\twhy\thow\tresult\n2026-11-09 17:00\t検証担当\tR9 · 試験ケースに実施の記録がある\t.\t確認のため\ttadori check\t漏れ 1 件（TC-07）\n2026-11-08 09:00\t検証担当\tR8 · 観点\t.\t\t\t満たす\n', 'utf8')

    const entries = await readActivity(dir, '2026-11-09', '2026-11-09', [])
    expect(entries).toContainEqual(expect.objectContaining({ who: '設計担当', section: 'today', text: '台帳に RUN-13（TC-04 の実施）を足した', key: 'ledger:add:RUN-13' }))
    expect(entries).toContainEqual(expect.objectContaining({ who: '設計担当', text: '台帳の DD-1（上限の判定）の change を直した', key: 'ledger:edit:DD-1' }))
    expect(entries).toContainEqual(expect.objectContaining({ who: '検証担当', text: 'R9 · 試験ケースに実施の記録がある を確かめた（漏れ 1 件（TC-07））' }))
    expect(entries.some(e => e.text.includes('R8'))).toBe(false) // 前の日の記録は出さない
  })

  test('git の外でも、チェックの記録は読む', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tadori-act2-'))
    made.push(dir)
    await mkdir(join(dir, '.tadori'), { recursive: true })
    await writeFile(join(dir, '.tadori/checks.tsv'), 'when\twho\twhat\twhere\twhy\thow\tresult\n2026-11-09 17:00\t検証担当\tR9\t.\t\t\t満たす\n', 'utf8')
    expect(await readActivity(dir, '2026-11-09', '2026-11-09', [])).toHaveLength(1)
  })
})
