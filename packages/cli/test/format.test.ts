import { describe, expect, test } from 'vitest'
import { resolve } from 'node:path'
import { trace } from '@tadori/core'
import { loadState } from '../src/state.js'
import { formatCheck, formatTrace } from '../src/format.js'

const EXAMPLE = resolve(import.meta.dirname, '../../../examples/lend-v12')

describe('formatCheck', () => {
  test('工程ごとに漏れと承認待ちを並べ、最後に合計を出す。割合は出さない', async () => {
    const { state } = await loadState(EXAMPLE, '2026-11-05')
    const text = formatCheck(state)
    expect(text).toMatch(/基本設計.*承認待ち 1/)
    expect(text).toMatch(/詳細設計.*基本設計の完了判定より前に着手/)
    expect(text).toMatch(/R9 .*TC-07/)
    expect(text).toMatch(/漏れ \d+ 件 \/ 承認待ち \d+ 件/)
    expect(text).not.toMatch(/%/)
  })
})

describe('formatCheck の「どの工程にも属さない漏れ」', () => {
  test('工程のルールの漏れは、その工程の欄だけに出し、「どの工程にも属さない漏れ」に重ねて出さない', async () => {
    const { state } = await loadState(EXAMPLE, '2026-11-05')
    const text = formatCheck(state)
    expect(text).not.toContain('どの工程にも属さない漏れ')
    expect(text.match(/R4 DD-2\.3/g)?.length).toBe(1)
  })
})

describe('formatCheck のルールが無い工程', () => {
  test('ルールが 1 つも無い工程は「残りなし」ではなく「ルールなし」と出す（通ったように見せない）', async () => {
    const { state } = await loadState(EXAMPLE, '2026-11-05')
    const noRules = { ...state, gates: state.gates.map(g => (g.phase.id === 'rel' ? { ...g, rules: [], leaks: [], pendingApprovals: [] } : g)) }
    expect(formatCheck(noRules)).toMatch(/■ リリース  ルールなし（まだ判定していません）/)
  })
})

describe('formatCheck の直し方', () => {
  test('漏れと承認待ちに、担当と直し方を出す', async () => {
    const { state } = await loadState(EXAMPLE, '2026-11-05')
    const text = formatCheck(state)
    expect(text).toContain('担当：設計担当　直し方：ledger/items.tsv の DD-2.3 の行（6 行目）の「改修後の対応」列に書く')
    expect(text).toContain('R2 承認待ち（差し戻し）　直し方：レビュー担当が ledger/approvals.tsv の R2 の行の状態を「承認」にする')
  })
})

describe('formatTrace', () => {
  test('元から順に並べ、切れ目には ✗ と足りない種類を出す', async () => {
    const { project } = await loadState(EXAMPLE, '2026-11-05')
    const result = trace(project, 'F-02')
    if (!result) throw new Error('F-02 が辿れません')
    const lines = formatTrace(result).split('\n')
    const at = (s: string) => lines.findIndex(l => l.includes(s))
    expect(at('BD-3')).toBeLessThan(at('TC-07'))
    expect(lines.at(at('TC-07') + 1)).toMatch(/✗.*RUN.*R9/)
  })

  test('つながり以外の漏れ（列が空など）がある行は ✗ にして、漏れの中身を下に出す', async () => {
    const { project } = await loadState(EXAMPLE, '2026-11-05')
    const result = trace(project, 'DD-2.3')
    if (!result) throw new Error('DD-2.3 が辿れません')
    const lines = formatTrace(result).split('\n')
    const at = lines.findIndex(l => l.includes('DD-2.3'))
    expect(lines.at(at)).toMatch(/^▶/) // 辿り始めは ▶ のまま
    expect(lines.at(at + 1)).toMatch(/漏れ R4/)
  })
})

describe('loadState の正本（origins）', () => {
  test('source 列が正本の表（sources.tsv）にある行は、リンクと「反映が古いか」を持つ', async () => {
    const { state } = await loadState(EXAMPLE, '2026-11-05')
    expect(state.origins['F-02']).toMatchObject({ name: '指摘の台帳', url: 'https://issues.example.com/lend-v12', stale: true })
    expect(state.origins['DD-2.3']).toBeUndefined()
  })
})

describe('英語の見本（examples/lend-v12-en）', () => {
  test('日本語の見本と同じ漏れ・承認待ちを出し、英語の文で読める', async () => {
    const { withLang } = await import('@tadori/core')
    const ja = (await loadState(EXAMPLE, '2026-11-05')).state
    // 漏れの文と直し方は、案件を読むときに作る。英語で読む
    const en = (await withLang('en', () => loadState(resolve(import.meta.dirname, '../../../examples/lend-v12-en'), '2026-11-05'))).state
    expect(en.leaks.map(l => `${l.rule}:${l.itemId}`).sort()).toEqual(ja.leaks.map(l => `${l.rule}:${l.itemId}`).sort())
    expect(en.gates.map(g => g.pendingApprovals.length)).toEqual(ja.gates.map(g => g.pendingApprovals.length))
    expect(en.resolved.map(r => r.itemId).sort()).toEqual(ja.resolved.map(r => r.itemId).sort())
    const text = withLang('en', () => formatCheck(en))
    expect(text).toContain('R2 pending approval (sent back)')
    expect(text).not.toMatch(/[ぁ-んァ-ヶ]/)
  })
})

describe('formatCheck の「承認のあとに変わった」', () => {
  test('承認のあとに、承認のルールが見る文書（from の種類の行の source）が commit されたら、承認待ちに戻して何が変わったかを出す', async () => {
    const { cp, mkdtemp, mkdir, readFile, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { execFileSync } = await import('node:child_process')
    const dir = await mkdtemp(join(tmpdir(), 'tadori-stale-'))
    try {
      await cp(EXAMPLE, dir, { recursive: true })
      // R2（基本設計書の承認）に見る文書の種類 BD を書き、承認にする
      const rulesPath = join(dir, '.tadori/rulesets/basic-design.tsv')
      const rules = await readFile(rulesPath, 'utf8')
      await writeFile(rulesPath, rules.replace(/^R2\tbd\tapproval\t\t/m, 'R2\tbd\tapproval\tBD\t'), 'utf8')
      await writeFile(join(dir, 'ledger/approvals.tsv'), 'rule\tstatus\twho\twhen\nR2\t承認\tレビュー担当\t2026-10-20\n', 'utf8')
      await mkdir(join(dir, 'docs'), { recursive: true })
      await writeFile(join(dir, 'docs/basic-design.md'), '# 基本設計\n', 'utf8')
      const git = (args: string[], date?: string) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: dir, env: { ...process.env, ...(date ? { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : {}) } })
      git(['init', '-q'])
      git(['add', '.'])
      git(['commit', '-q', '-m', 'before'], '2026-10-18T09:00:00+09:00')
      const before = formatCheck((await loadState(dir, '2026-11-05')).state)
      expect(before).not.toMatch(/R2 承認待ち/)

      await writeFile(join(dir, 'docs/basic-design.md'), '# 基本設計\n\n書き足し\n', 'utf8')
      git(['commit', '-q', '-am', 'after'], '2026-10-25T09:00:00+09:00')
      const after = formatCheck((await loadState(dir, '2026-11-05')).state)
      expect(after).toMatch(/R2 承認待ち（承認のあとに docs\/basic-design\.md が変わった：[0-9a-f]+ 2026-10-25）/)
      expect(after).toContain('レビュー担当が docs/basic-design.md の変更')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('formatCheck の statuses.tsv に無い WBS の状態', () => {
  test('一覧に無い状態のタスクを状態ごとに出し、直し方を添える。名前で書いた状態は知らせない', async () => {
    const { cp, mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'tadori-status-'))
    try {
      await cp(EXAMPLE, dir, { recursive: true })
      const wbsPath = join(dir, 'ledger/wbs.tsv')
      const wbs = await readFile(wbsPath, 'utf8')
      // W-01 は名前（完了）で、W-02 は一覧に無い「未確認」で書く
      await writeFile(wbsPath, wbs.replace(/^(W-01\t.*\t)done(\t)/m, '$1完了$2').replace(/^(W-02\t.*\t)done(\t)/m, '$1未確認$2'), 'utf8')
      const { state } = await loadState(dir, '2026-11-05')
      expect(state.unknownStatuses).toEqual([{ status: '未確認', taskIds: ['W-02'] }])
      const text = formatCheck(state)
      expect(text).toContain('■ .tadori/statuses.tsv に無い WBS の状態')
      expect(text).toContain('「未確認」：W-02')
      expect(text).toContain('直し方：.tadori/statuses.tsv にその状態を足す')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
