import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadProject, ProjectLoadError } from '../src/infrastructure/repository.js'
import { appendChecks, saveSettings } from '../src/infrastructure/settings-store.js'

let dir = ''

async function put(path: string, text: string) {
  await mkdir(join(dir, path, '..'), { recursive: true })
  await writeFile(join(dir, path), text, 'utf8')
}

async function writeMinimalProject() {
  await put('.tadori/project.tsv', 'name\n見本の案件\n')
  await put('.tadori/phases.tsv', 'id\tname\torder\nbd\t基本設計\t1\ndd\t詳細設計\t2\n')
  await put('.tadori/statuses.tsv', 'id\tname\ttone\ntodo\t未着手\tnone\ndone\t完了\tok\n')
  await put('.tadori/rulesets/detail-design.tsv', 'id\tphase\tkind\tfrom\tto\tfield\tlabel\nR3\tdd\tcovered\tBD\tDD\t\t章から節が出ている\n')
  await put('ledger/items.tsv', 'id\tkind\ttitle\tsource\trefs\tchange\nBD-1\tBD\t章\ta.md\t\t\nDD-1\tDD\t節\tb.md\tBD-1\t変わる\n')
  await put('ledger/wbs.tsv', 'id\tphase\tname\tstart\tend\tstatus\nW-1\tbd\t作成\t2026-09-01\t2026-09-30\tdone\n')
  await put('ledger/approvals.tsv', 'rule\tstatus\twho\twhen\n')
}

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'tadori-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('loadProject', () => {
  test('案件のフォルダから工程・ルール・台帳・WBS を読む', async () => {
    await writeMinimalProject()
    const project = await loadProject(dir)
    expect(project.name).toBe('見本の案件')
    expect(project.phases.map(p => p.id)).toEqual(['bd', 'dd'])
    expect(project.rules.map(r => r.id)).toEqual(['R3'])
    expect(project.items.find(i => i.id === 'DD-1')).toMatchObject({ refs: ['BD-1'], fields: { change: '変わる' } })
    expect(project.tasks.at(0)).toMatchObject({ id: 'W-1', start: '2026-09-01', status: 'done' })
  })

  test('WBS のタスクは、台帳の行（種類 W）としても辿れる。台帳に書き写さなくてよい', async () => {
    await writeMinimalProject()
    const project = await loadProject(dir)
    expect(project.items.find(i => i.id === 'W-1')).toMatchObject({ kind: 'W', title: '作成', refs: [] })
  })

  test('台帳と WBS の行は、どのファイルの何行目かを覚える（# の行も数える）', async () => {
    await writeMinimalProject()
    await put('ledger/items.tsv', '# 説明\nid\tkind\ttitle\tsource\trefs\tchange\nBD-1\tBD\t章\ta.md\t\t\nDD-1\tDD\t節\tb.md\tBD-1\t変わる\n')
    const project = await loadProject(dir)
    expect(project.items.find(i => i.id === 'DD-1')).toMatchObject({ file: 'ledger/items.tsv', line: 4 })
    expect(project.items.find(i => i.id === 'W-1')).toMatchObject({ file: 'ledger/wbs.tsv', line: 2 })
  })

  test('refs は 、 か , で区切って複数書ける', async () => {
    await writeMinimalProject()
    await put('ledger/items.tsv', 'id\tkind\ttitle\tsource\trefs\nA\tBD\t章\ta.md\t\nB\tBD\t章\tb.md\t\nC\tDD\t節\tc.md\tA、B\nD\tDD\t節\td.md\tA, B\n')
    const project = await loadProject(dir)
    expect(project.items.find(i => i.id === 'C')?.refs).toEqual(['A', 'B'])
    expect(project.items.find(i => i.id === 'D')?.refs).toEqual(['A', 'B'])
  })

  test('期間の入っていないタスクは start / end を持たない', async () => {
    await writeMinimalProject()
    await put('ledger/wbs.tsv', 'id\tphase\tname\tstart\tend\tstatus\nW-1\tbd\t作成\t\t\ttodo\n')
    const task = (await loadProject(dir)).tasks.at(0)
    expect(task).not.toHaveProperty('start')
    expect(task).not.toHaveProperty('end')
  })

  test('ルールの判定の種類が決まった語でなければ、ファイル名と行つきで止める', async () => {
    await writeMinimalProject()
    await put('.tadori/rulesets/detail-design.tsv', 'id\tphase\tkind\tfrom\tto\tfield\tlabel\nR3\tdd\tcover\tBD\tDD\t\tx\n')
    await expect(loadProject(dir)).rejects.toThrow(ProjectLoadError)
    await expect(loadProject(dir)).rejects.toThrow(/detail-design\.tsv.*R3.*cover/)
  })

  test('ルールの only 列（列名=値）を読む', async () => {
    await writeMinimalProject()
    await put('.tadori/rulesets/implementation.tsv', 'id\tphase\tkind\tfrom\tto\tfield\tonly\tlabel\nR6\tdd\tcovered\tDD\tCOMMIT\t\tchange=変わる\tx\n')
    const rule = (await loadProject(dir)).rules.find(r => r.id === 'R6')
    expect(rule?.only).toEqual({ field: 'change', value: '変わる' })
  })

  test('日付が YYYY-MM-DD でなければ止める（画面に埋め込まれる値なので形を確かめる）', async () => {
    await writeMinimalProject()
    await put('ledger/wbs.tsv', 'id\tphase\tname\tstart\tend\tstatus\nW-1\tbd\t作成\t2026-09-01\t2026-09-30" onmouseover="x\tdone\n')
    await expect(loadProject(dir)).rejects.toThrow(/W-1.*日付/)
  })

  test('台帳・工程・ステータス・ルールセットが無ければ、全部漏れなしに見せずに止める', async () => {
    await writeMinimalProject()
    await rm(join(dir, 'ledger/items.tsv'))
    await expect(loadProject(dir)).rejects.toThrow(/items\.tsv/)
  })

  test('ID が重複していれば止める（WBS のタスクと台帳の行の重複も）', async () => {
    await writeMinimalProject()
    await put('ledger/items.tsv', 'id\tkind\ttitle\tsource\trefs\nBD-1\tBD\t章\ta.md\t\nW-1\tBD\t章\tb.md\t\n')
    await expect(loadProject(dir)).rejects.toThrow(/W-1.*重複/)
  })

  test('工程の order が数でなければ止める', async () => {
    await writeMinimalProject()
    await put('.tadori/phases.tsv', 'id\tname\torder\nbd\t基本設計\tいち\n')
    await expect(loadProject(dir)).rejects.toThrow(/bd.*order/)
  })

  test('種類と列の読み方（kinds.tsv・columns.tsv）を読む。無くてもよい', async () => {
    await writeMinimalProject()
    expect((await loadProject(dir)).labels).toEqual({ kinds: {}, columns: {}, workKinds: [] })
    await put('.tadori/kinds.tsv', 'id\tname\twork\nDD\t詳細設計の節\t\nRUN\t試験の記録\tyes\n')
    await put('.tadori/columns.tsv', 'id\tname\nchange\t改修後の対応\n')
    expect((await loadProject(dir)).labels).toEqual({ kinds: { DD: '詳細設計の節', RUN: '試験の記録' }, columns: { change: '改修後の対応' }, workKinds: ['RUN'] })
  })

  test('リンクの雛形（links.tsv）を読む。javascript: などは止める', async () => {
    await writeMinimalProject()
    await put('.tadori/links.tsv', 'tool\turl\nmd-business\tmd-business://open?path={path}&line={line}\n')
    expect((await loadProject(dir)).links).toEqual([{ tool: 'md-business', url: 'md-business://open?path={path}&line={line}' }])
    await put('.tadori/links.tsv', 'tool\turl\nmd-business\tjavascript:alert(1)\n')
    await expect(loadProject(dir)).rejects.toThrow(/links\.tsv.*md-business.*使えません/)
  })

  test('案件のフォルダでなければ（.tadori が無ければ）分かる言葉で止める', async () => {
    await expect(loadProject(dir)).rejects.toThrow(/\.tadori/)
  })
})

describe('appendChecks', () => {
  const record = { when: '2026-11-05 10:00', who: 'エージェント', what: 'R3', where: '.', why: '試し', how: 'tadori check', result: '満たす' }

  test('末尾に改行の無いファイルでも、前の行にくっつけずに足す', async () => {
    await writeMinimalProject()
    await put('.tadori/checks.tsv', '# 記録\nwhen\twho\twhat\twhere\twhy\thow\tresult\n2026-11-01 09:00\t人\tR2\t.\t完了判定\t目視\t承認')
    await appendChecks(dir, [record], '記録')
    const lines = (await readFile(join(dir, '.tadori/checks.tsv'), 'utf8')).trimEnd().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines.at(0)).toBe('# 記録') // 人が書いた # の行は残す
    expect(lines.at(-1)).toBe('2026-11-05 10:00\tエージェント\tR3\t.\t試し\ttadori check\t満たす')
  })

  test('見出しの列が決まった形と違えば、ずらして書かずに止める', async () => {
    await writeMinimalProject()
    await put('.tadori/checks.tsv', 'who\twhen\twhat\twhere\twhy\thow\tresult\n')
    await expect(appendChecks(dir, [record], '記録')).rejects.toThrow(/見出し/)
  })
})

describe('saveSettings', () => {
  test('工程を書き戻す。git 管理外なら commit せず、その理由を返す', async () => {
    await writeMinimalProject()
    const result = await saveSettings(dir, { phases: [{ id: 'dd', name: '詳細設計', order: 1 }] }, '工程を変更')
    expect(result.committed).toBe(false)
    expect(result.reason).toMatch(/git/)
    expect(await readFile(join(dir, '.tadori/phases.tsv'), 'utf8')).toBe('id\tname\torder\ndd\t詳細設計\t1\n')
  })

  test('commit したら、push していない commit の数を返す（push 先が無ければ null）', async () => {
    await writeMinimalProject()
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
    git(dir, 'init', '-q')
    git(dir, 'config', 'user.name', 'test')
    git(dir, 'config', 'user.email', 'test@example.invalid')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'init')

    const first = await saveSettings(dir, { phases: [{ id: 'bd', name: '基本', order: 1 }, { id: 'dd', name: '詳細設計', order: 2 }] }, '1 回目')
    expect(first).toMatchObject({ committed: true, unpushed: null }) // push 先がまだ無い

    // push 先（裸のリポジトリ）を足して、いまの状態を push する
    const remote = await mkdtemp(join(tmpdir(), 'tadori-remote-'))
    git(remote, 'init', '-q', '--bare')
    git(dir, 'remote', 'add', 'origin', remote)
    git(dir, 'push', '-q', '-u', 'origin', 'HEAD')
    const second = await saveSettings(dir, { phases: [{ id: 'bd', name: '基本設計', order: 1 }, { id: 'dd', name: '詳細設計', order: 2 }] }, '2 回目')
    expect(second).toMatchObject({ committed: true, unpushed: 1 })
    await rm(remote, { recursive: true, force: true })
  })

  test('案件がそれ自身の git リポジトリなら、変えたファイルを commit する', async () => {
    await writeMinimalProject()
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('init', '-q')
    git('config', 'user.name', 'test')
    git('config', 'user.email', 'test@example.invalid')
    git('add', '-A')
    git('commit', '-q', '-m', 'init')

    const result = await saveSettings(dir, { statuses: [{ id: 'todo', name: '未着手', tone: 'none' }] }, 'ステータスを変更')
    expect(result.committed).toBe(true)
    expect(git('log', '-1', '--pretty=%s').trim()).toBe('chore(tadori): ステータスを変更')
    expect(git('status', '--porcelain').trim()).toBe('')
  })
})
