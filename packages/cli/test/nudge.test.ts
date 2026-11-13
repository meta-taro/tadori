import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { execFile } from 'node:child_process'
import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { appendCheckpoint } from '@tadori/core'
import { hookJson, nudge } from '../src/nudge.js'

const run = promisify(execFile)
const EXAMPLE = resolve(import.meta.dirname, '../../../examples/lend-v12')
const today = '2026-11-13'
const now = new Date(2026, 10, 13, 17, 15)
let dir = ''

// 見本の案件を git にして、節目を 5 つ（コミット前は止める・朝会と夕会の前を足す）と、2 つの節目に効くルールを足す
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tadori-nudge-'))
  await cp(EXAMPLE, dir, { recursive: true })
  await writeFile(join(dir, '.tadori/checkpoints.tsv'), 'id\tname\tnudge\ncases-written\t試験ケースを書き終えた\t\nbefore-judge\t判定の前\t\nbefore-post\t投稿の前\t\nbefore-commit\tコミットの前\tblock\nbefore-standup\t朝会・夕会の前\tnotify\n', 'utf8')
  await appendFile(join(dir, '.tadori/rulesets/agreements.tsv'), 'S1\t\tnote\t\t\t\t\t\t\t1 日の進行の行を、今の事実と突き合わせる\tbefore-standup|before-commit\t1 行ずつ今の事実と突き合わせたか\n', 'utf8')
  await run('git', ['init', '-q'], { cwd: dir })
  await run('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
  await run('git', ['config', 'user.name', 'test'], { cwd: dir })
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-q', '-m', 'init'], { cwd: dir })
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

const answers = [{ rule: 'S1', result: 'ok', where: '.tadori/daily/2026-11-13.tsv' }]

describe('tadori nudge（節目の呼び忘れを知らせる）', () => {
  test('--at が無ければ、その日の記録のまとめ。まだ無いときもそう言う', async () => {
    const result = await nudge(dir, { today, now })
    expect(result).toMatchObject({ ok: true, block: false })
    expect(result.text).toContain('まだありません')
  })

  test('日に 1 回の節目は、その日の記録が無ければ足りないと返す。nudge が notify なら止めない', async () => {
    const result = await nudge(dir, { at: 'before-standup', today, now })
    expect(result).toMatchObject({ ok: false, block: false })
    expect(result.text).toContain('今日（2026-11-13）の before-standup の記録がありません')
  })

  test('stage した変更に before-commit の記録が無ければ足りない。nudge が block なら止める。stage が空なら足りている', async () => {
    expect((await nudge(dir, { at: 'before-commit', today, now })).ok).toBe(true)
    await writeFile(join(dir, 'notes.md'), '# メモ\n', 'utf8')
    await run('git', ['add', 'notes.md'], { cwd: dir })
    const result = await nudge(dir, { at: 'before-commit', today, now })
    expect(result).toMatchObject({ ok: false, block: true })
    expect(result.text).toContain('stage していますが')
    await appendCheckpoint(dir, { at: 'before-commit', who: 'エージェント', answers })
    expect((await nudge(dir, { at: 'before-commit', today, now })).ok).toBe(true)
  })

  test('日付を対象に記録すると足りる。まとめに回数と最後の時刻が出る', async () => {
    await appendCheckpoint(dir, { at: 'before-standup', target: today, who: 'エージェント', answers })
    // 記録の時刻は実際の今日なので、その日付で見る
    const day = new Date()
    const realToday = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    expect((await nudge(dir, { at: 'before-standup', today: realToday, now })).ok).toBe(true)
    const summary = await nudge(dir, { today: realToday, now })
    expect(summary.text).toMatch(/節目の記録：2 回（before-commit 1・before-standup 1）。最後の記録は \d{2}:\d{2}/)
  })

  test('--stale-waits で、その日の 1 日の進行の古い待ちの行も見る', async () => {
    await mkdir(join(dir, '.tadori/daily'), { recursive: true })
    await writeFile(join(dir, `.tadori/daily/${today}.tsv`), 'id\twho\tsection\ttext\twbs\tissue\tnote\torigin\tkey\ttag\tlinks\tbadges\tupdated\n'
      + 'm1\tA\ttoday\t上長に確認\t\t\t\tmanual\t\t\t\twait 確認中\t2026-11-13T10:12\n', 'utf8')
    const result = await nudge(dir, { at: 'before-standup', target: '', today, now, staleWaits: true })
    expect(result.ok).toBe(false)
    expect(result.text).toContain('m1')
  })

  test('節目が無ければ、何があるかを返す', async () => {
    const result = await nudge(dir, { at: 'before-lunch', today, now })
    expect(result.ok).toBe(false)
    expect(result.text).toContain('before-standup')
  })
})

describe('Claude Code の hooks に渡す JSON', () => {
  const missing = { ok: false, block: false, text: '記録がありません' }
  const blocking = { ok: false, block: true, text: '記録がありません' }
  const parse = (s: string) => JSON.parse(s) as Record<string, unknown>

  test('足りていれば何も出さない（まとめは出す）', () => {
    expect(hookJson({ ok: true, block: false, text: 'ok' }, 'Stop')).toBe('')
    expect(parse(hookJson({ ok: true, block: false, text: '今日は 2 回' }, 'SessionStart', true))).toEqual({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '今日は 2 回' } })
  })

  test('知らせるだけ：文脈に足せるフックは additionalContext、Stop は systemMessage', () => {
    expect(parse(hookJson(missing, 'PostToolUse'))).toEqual({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: '記録がありません' } })
    expect(parse(hookJson(missing, 'Stop'))).toEqual({ systemMessage: '記録がありません' })
  })

  test('止める：PreToolUse は deny、Stop・PostToolUse は decision block。UserPromptSubmit と SessionStart では止めない', () => {
    expect(parse(hookJson(blocking, 'PreToolUse'))).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '記録がありません' } })
    expect(parse(hookJson(blocking, 'Stop'))).toEqual({ decision: 'block', reason: '記録がありません' })
    expect(parse(hookJson(blocking, 'UserPromptSubmit'))).toEqual({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '記録がありません' } })
    expect(parse(hookJson(blocking, 'SessionStart'))).toEqual({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '記録がありません' } })
  })
})
