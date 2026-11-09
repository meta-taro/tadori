import { afterAll, describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readStatusChanges } from '../src/infrastructure/status-history.js'

const made: string[] = []
afterAll(async () => { for (const d of made) await rm(d, { recursive: true, force: true }) })

const HEADER = 'id\tphase\tname\tstart\tend\tstatus\towner\n'
const git = (cwd: string, date: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_DATE: `${date}T10:00:00`, GIT_COMMITTER_DATE: `${date}T10:00:00` } })

describe('readStatusChanges（WBS の状態が変わった日を、git の履歴から読む）', () => {
  test('commit ごとの状態を比べ、変わった日と前後の状態を返す。commit していない書き換えは今日の変化とする', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tadori-hist-'))
    made.push(dir)
    await mkdir(join(dir, 'ledger'), { recursive: true })
    git(dir, '2026-11-01', 'init', '-q')
    git(dir, '2026-11-01', 'config', 'user.email', 'test@example.invalid')
    git(dir, '2026-11-01', 'config', 'user.name', 'test')
    const write = (rows: string) => writeFile(join(dir, 'ledger/wbs.tsv'), HEADER + rows, 'utf8')
    await write('W-01\tdd\t画面の設計\t\t\ttodo\t設計担当\n')
    git(dir, '2026-11-02', 'add', '-A'); git(dir, '2026-11-02', 'commit', '-q', '-m', 'a')
    await write('W-01\tdd\t画面の設計\t\t\tdoing\t設計担当\n')
    git(dir, '2026-11-05', 'commit', '-q', '-am', 'b')
    await write('W-01\tdd\t画面の設計\t\t\tdone\t設計担当\n') // commit していない

    const changes = await readStatusChanges(dir, '2026-11-09')
    expect(changes).toEqual([
      { taskId: 'W-01', date: '2026-11-05', from: 'todo', to: 'doing' },
      { taskId: 'W-01', date: '2026-11-09', from: 'doing', to: 'done' },
    ])
  })

  test('git の外なら、変化は読めないので空', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tadori-nohist-'))
    made.push(dir)
    expect(await readStatusChanges(dir, '2026-11-09')).toEqual([])
  })
})
