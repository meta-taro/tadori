import { DEFAULT_CHECKPOINT_IDS, type Checkpoint, type Project, type Rule } from '../domain/model.js'
import { t } from '../i18n.js'

/**
 * 工程の節目のチェック。
 * 節目に効くルール（rulesets の at 列）だけを項目として並べ、項目ごとに結果と根拠の場所を出させる。
 * 欠けがあれば記録しない。記録は「そのとき有ったルールをすべて当てた」ことの証拠になり、
 * 後から不具合が見つかったとき「ルールが足りなかった」のか「当て方が足りなかった」のかを切り分ける材料にする。
 * ここは人の承認ではない（記録するのは確かめた本人で、漏れを埋めたとは判定しない）
 */

/**
 * 項目の結果。ok＝確かめて満たしていた / na＝この対象には当てはまらない /
 * fixed＝ミスを見つけて直した / open＝ミスを見つけたが、まだ直していない（記録は残すが、確かめは通らない）
 */
export const CHECKPOINT_RESULTS = ['ok', 'na', 'fixed', 'open'] as const
/** 何が抜けていて、どう直したか（直していないか）を note に書かせる結果 */
const NEEDS_NOTE: readonly string[] = ['fixed', 'open']
export type CheckpointResult = (typeof CHECKPOINT_RESULTS)[number]

/** 記録のまとめの行の rule の値（その回に当てたルールの一覧と、まとめの 1 文を持つ） */
export const SUMMARY_RULE = '*'

export interface CheckpointAnswer {
  readonly rule: string
  readonly result: string
  /** 根拠の場所（ファイル:行・台帳の ID など）。該当なしなら、なぜ当てはまらないか */
  readonly where: string
  readonly note?: string
}

/** 記録の 1 行（.tadori/checkpoint-log.tsv） */
export interface CheckpointRow {
  /** 1 回の記録の ID（同じ回の行は同じ値） */
  readonly run: string
  readonly when: string
  readonly who: string
  readonly at: string
  /** 対象（WBS のタスク ID・台帳の ID。コミット前は stage の印） */
  readonly target: string
  /** その時点のルールセットの版（ルールの TSV の最後の commit。手元で直したままなら +dirty） */
  readonly ruleset: string
  readonly rule: string
  readonly result: string
  readonly where: string
  readonly note: string
}

export interface ChecklistEntry {
  readonly rule: string
  readonly check: string
}

/** 案件の節目（書かなければ既定の 4 つ。名前はいまの言語） */
export function checkpointsOf(project: Pick<Project, 'checkpoints'>): readonly Checkpoint[] {
  if (project.checkpoints?.length) return project.checkpoints
  const names: Record<(typeof DEFAULT_CHECKPOINT_IDS)[number], string> = {
    'cases-written': t('Test cases written'),
    'before-judge': t('Before giving a verdict'),
    'before-post': t('Before posting outside'),
    'before-commit': t('Before committing'),
  }
  return DEFAULT_CHECKPOINT_IDS.map(id => ({ id, name: names[id] }))
}

/** その節目に効くルールを、チェック項目の並びにする（check が無ければ label を項目にする） */
export function checklistOf(rules: readonly Rule[], at: string): ChecklistEntry[] {
  return rules.filter(r => r.at?.includes(at)).map(r => ({ rule: r.id, check: r.check || r.label }))
}

/** 記録を断る理由（空なら書いてよい）。欠けた項目・場所の無い項目・結果の値の誤り・その節目に効かないルールを、まとめて返す */
export function refusalsOf(rules: readonly Rule[], at: string, answers: readonly CheckpointAnswer[]): string[] {
  const expected = checklistOf(rules, at).map(c => c.rule)
  const answered = new Set(answers.map(a => a.rule))
  const problems: string[] = []
  const missing = expected.filter(id => !answered.has(id))
  if (missing.length) problems.push(t('No result for: {ids}. Check every item before recording', { ids: missing.join(', ') }))
  for (const answer of answers) {
    if (!expected.includes(answer.rule)) problems.push(t('{rule} does not apply at the checkpoint {at}', { rule: answer.rule, at }))
    if (!(CHECKPOINT_RESULTS as readonly string[]).includes(answer.result)) problems.push(t('{rule}: the result "{result}" is not allowed ({allowed})', { rule: answer.rule, result: answer.result, allowed: CHECKPOINT_RESULTS.join(' / ') }))
    if (NEEDS_NOTE.includes(answer.result) && !(answer.note ?? '').trim()) problems.push(t('{rule}: for {result}, write in note what was missing and what you did (or that it is not fixed yet)', { rule: answer.rule, result: answer.result }))
    if (!answer.where.trim()) problems.push(t('{rule}: write where you checked (file:line or ledger ID). For na, write why it does not apply', { rule: answer.rule }))
  }
  return problems
}

/** まとめの 1 文（例：cases-written：該当ルール 6 件すべて OK／6 件中 1 件ミス） */
export function summaryOf(at: string, answers: readonly CheckpointAnswer[]): string {
  const count = (result: CheckpointResult) => answers.filter(a => a.result === result).length
  const misses = count('fixed') + count('open')
  if (!misses) return t('{at}: all {count} applicable rules OK (ok {ok}, na {na})', { at, count: answers.length, ok: count('ok'), na: count('na') })
  return t('{at}: {misses} of {count} applicable rules missed (fixed {fixed}, not fixed {open})', { at, count: answers.length, misses, fixed: count('fixed'), open: count('open') })
}

export interface Coverage {
  /** この節目・この対象の記録があるか */
  readonly recorded: boolean
  /** いま効くルールのうち、最後の記録で当てていないもの（ルールが後から増えたときも出る） */
  readonly missing: readonly string[]
  /** 最後の記録で、ミスを見つけたがまだ直していないもの */
  readonly open: readonly string[]
}

/** 1 回の記録（まとめの行から読む） */
export interface CheckpointRun {
  readonly run: string
  readonly when: string
  readonly at: string
  readonly target: string
  /** まだ直していないミスが残った回か */
  readonly open: boolean
}

/** その日（YYYY-MM-DD）の記録を、書いた順に返す。at を渡すとその節目だけ */
export function runsOn(log: readonly CheckpointRow[], day: string, at?: string): CheckpointRun[] {
  return log
    .filter(r => r.rule === SUMMARY_RULE && r.when.startsWith(day) && (!at || r.at === at))
    .map(r => ({ run: r.run, when: r.when, at: r.at, target: r.target, open: r.result === 'open' }))
}

/** この節目・この対象の最後の記録が、いま効くルールをすべて当てているか */
export function coverageOf(rules: readonly Rule[], at: string, target: string, log: readonly CheckpointRow[]): Coverage {
  const expected = checklistOf(rules, at).map(c => c.rule)
  const mine = log.filter(r => r.at === at && r.target === target)
  const lastRun = mine.at(-1)?.run
  if (!lastRun) return { recorded: false, missing: expected, open: [] }
  const rows = mine.filter(r => r.run === lastRun && r.rule !== SUMMARY_RULE)
  const answered = new Set(rows.map(r => r.rule))
  return { recorded: true, missing: expected.filter(id => !answered.has(id)), open: rows.filter(r => r.result === 'open').map(r => r.rule) }
}
