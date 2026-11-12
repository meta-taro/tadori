import './i18n.js'
import {
  appendCheckpoint, checklistOf, checkpointsOf, CHECKPOINT_RESULTS, coverageOf, loadProject, readCheckpointLog, stagedDigest,
  STAGED_CHECKPOINT, t, type CheckpointAnswer, type CheckpointWritten, type Coverage,
} from '@tadori/core'

/**
 * 工程の節目のチェック（MCP の checkpoint・checkpoint_record と、CLI の tadori checkpoint が同じものを使う）。
 * 節目に効くルールを項目として突きつけ、全部に結果と根拠の場所があるときだけ記録する。
 * 「先へ進めない」は tadori だけでは止められないので、verify を git の pre-commit やエージェントのフックから呼んでもらう
 */

export interface CheckpointTarget {
  readonly at: string
  /** WBS のタスク ID か台帳の ID。コミット前の節目では使わない（stage してある変更が対象） */
  readonly target?: string
}

/** 節目の一覧と、それぞれに効くルールの数 */
export async function checkpointListText(dir: string): Promise<string> {
  const project = await loadProject(dir)
  const lines = checkpointsOf(project).map(c => t('- {id} ({name}): {count} rules', { id: c.id, name: c.name, count: checklistOf(project.rules, c.id).length }))
  return [t('Checkpoints (rules apply through the at column of the rulesets):'), ...lines].join('\n')
}

/** 対象を決める（コミット前は stage の印。stage が空なら null） */
async function resolveTarget(dir: string, request: CheckpointTarget): Promise<string | null> {
  if (request.at === STAGED_CHECKPOINT) return stagedDigest(dir)
  return (request.target ?? '').trim()
}

/** 記録の様子を 1 文にする */
function coverageText(coverage: Coverage): string {
  if (!coverage.recorded) return t('There is no record yet for this target (rules to check: {ids})', { ids: coverage.missing.join(', ') })
  if (coverage.missing.length) return t('The last record did not check: {ids} (rules added since then). Check them and record again', { ids: coverage.missing.join(', ') })
  if (coverage.open.length) return t('The last record has misses not fixed yet: {ids}', { ids: coverage.open.join(', ') })
  return t('There is a record that checked every applicable rule')
}

/** その節目で突きつける項目の一覧（いまの記録の様子つき） */
export async function checklistText(dir: string, request: CheckpointTarget): Promise<string> {
  const project = await loadProject(dir)
  const items = checklistOf(project.rules, request.at)
  if (!checkpointsOf(project).some(c => c.id === request.at)) return t('The checkpoint "{at}" is not defined ({allowed})', { at: request.at, allowed: checkpointsOf(project).map(c => c.id).join(' / ') })
  if (!items.length) return t('No rule applies at the checkpoint {at}', { at: request.at })
  const target = await resolveTarget(dir, request)
  const lines = [
    t('Check each item at {at}. For each, record ok / na / fixed / open and where you checked (file:line or ledger ID) with checkpoint_record:', { at: request.at }),
    ...items.map(i => `- ${i.rule}: ${i.check}`),
  ]
  if (target) lines.push('', coverageText(coverageOf(project.rules, request.at, target, await readCheckpointLog(dir))))
  return lines.join('\n')
}

/** 記録する（項目が欠けていれば core が WriteRefused で断る） */
export async function recordCheckpoint(dir: string, request: CheckpointTarget & { readonly who: string; readonly answers: readonly CheckpointAnswer[] }): Promise<CheckpointWritten> {
  return appendCheckpoint(dir, request)
}

export interface Verified {
  readonly ok: boolean
  readonly text: string
}

/**
 * 通ってよいか。最後の記録が、いま効くルールをすべて当てていて、未対応のミスが無ければ通る。
 * コミット前は、stage が空（記録のファイルだけの commit も含む）なら通す
 */
export async function verifyCheckpoint(dir: string, request: CheckpointTarget): Promise<Verified> {
  const project = await loadProject(dir)
  const target = await resolveTarget(dir, request)
  if (request.at === STAGED_CHECKPOINT && target === null) return { ok: true, text: t('Nothing to check: nothing is staged') }
  if (!target) return { ok: false, text: t('Give the target: the WBS task ID or ledger ID this check is for') }
  if (!checklistOf(project.rules, request.at).length) return { ok: true, text: t('No rule applies at the checkpoint {at}', { at: request.at }) }
  const coverage = coverageOf(project.rules, request.at, target, await readCheckpointLog(dir))
  const ok = coverage.recorded && !coverage.missing.length && !coverage.open.length
  const how = ok ? '' : `\n${t('Read the items with checkpoint (MCP) or tadori checkpoint --at {at}, check each one, and record with checkpoint_record', { at: request.at })}`
  return { ok, text: `${coverageText(coverage)}${how}` }
}

/** MCP の入力から答えの並びを作る（形が違う行は、空の値にして core の検査に断らせる） */
export function answersOf(value: unknown): CheckpointAnswer[] {
  if (!Array.isArray(value)) return []
  return value.map(v => {
    const row = (v ?? {}) as Record<string, unknown>
    const s = (x: unknown) => (typeof x === 'string' ? x : '')
    return { rule: s(row.rule), result: s(row.result), where: s(row.where), ...(s(row.note) ? { note: s(row.note) } : {}) }
  })
}

export const RESULT_VALUES = CHECKPOINT_RESULTS
