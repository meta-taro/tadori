import './i18n.js'
import { checklistOf, checkpointsOf, coverageOf, loadProject, readCheckpointLog, runsOn, stagedDigest, STAGED_CHECKPOINT, t, type Checkpoint, type Coverage } from '@tadori/core'
import { loadDaily, localStamp } from './daily.js'
import { listJoin } from './i18n.js'

/**
 * 節目の呼び忘れを知らせる（tadori nudge）。エージェントのフック（Claude Code の hooks など）や定時の起動から呼んでもらう。
 * tadori は自分では動き出さない。いつ呼ぶかはフックの側が決め、tadori は「いま記録が足りているか」だけを答える。
 * 足りないときに止める（block）か知らせるだけか（notify）は、案件の .tadori/checkpoints.tsv の nudge 列で節目ごとに決める（既定は知らせるだけ）
 */

export interface NudgeRequest {
  /** 見る節目。省くと、その日の記録のまとめだけを返す */
  readonly at?: string
  /** 対象（WBS のタスク ID か台帳の ID）。コミット前の節目では使わない（stage してある変更が対象） */
  readonly target?: string
  /** その日の 1 日の進行の、古いままの待ちの行も見る（朝会・夕会の前など） */
  readonly staleWaits?: boolean
  /** その日（YYYY-MM-DD） */
  readonly today: string
  /** いまの時刻（試験で決めるため。省けば今） */
  readonly now?: Date
}

export interface Nudge {
  /** 足りているか（まとめだけのときは常に true） */
  readonly ok: boolean
  /** 足りないときにフックに止めさせるか（節目の nudge 列が block のときだけ） */
  readonly block: boolean
  /** エージェントと人が読む文 */
  readonly text: string
}

const timeOf = (when: string) => when.slice(11, 16)
/** 足りないことと、次にすること（日本語では文のあいだに空白を入れない） */
const then = (shortfall: string, next: string) => t('{shortfall} {next}', { shortfall, next })

/** その日の記録のまとめ（節目ごとの回数と、最後に記録した時刻） */
async function summaryText(dir: string, today: string): Promise<string> {
  const runs = runsOn(await readCheckpointLog(dir), today)
  if (!runs.length) return t('Checkpoint records today ({date}): none yet. At each checkpoint, read the items with checkpoint and record with checkpoint_record', { date: today })
  const counts = listJoin([...new Set(runs.map(r => r.at))].map(at => `${at} ${runs.filter(r => r.at === at).length}`))
  const open = runs.filter(r => r.open).length
  return t('Checkpoint records today ({date}): {n} ({counts}). Last recorded at {time}.{open}', {
    date: today, n: runs.length, counts, time: timeOf(runs.at(-1)?.when ?? ''),
    open: open ? t(' {n} of them still have misses not fixed', { n: open }) : '',
  })
}

/** 記録の足りなさを 1 文にする（足りていれば空） */
function shortfallOf(coverage: Coverage): string {
  if (!coverage.recorded) return ''
  if (coverage.missing.length) return t('The last record did not check: {ids}.', { ids: coverage.missing.join(', ') })
  if (coverage.open.length) return t('Misses in the last record are not fixed yet: {ids}.', { ids: coverage.open.join(', ') })
  return ''
}

/** 節目の記録が足りているか。足りなければ、何が足りないかの文 */
async function checkpointShortfall(dir: string, checkpoint: Checkpoint, request: NudgeRequest): Promise<string> {
  const project = await loadProject(dir)
  if (!checklistOf(project.rules, checkpoint.id).length) return ''
  const log = await readCheckpointLog(dir)
  const howTo = t('Read the items with checkpoint (MCP) or tadori checkpoint --at {at}, check each one, and record with checkpoint_record', { at: checkpoint.id })
  if (checkpoint.id === STAGED_CHECKPOINT) {
    const digest = await stagedDigest(dir)
    if (!digest) return ''
    const coverage = coverageOf(project.rules, checkpoint.id, digest, log)
    if (!coverage.recorded) return then(t('Changes are staged, but there is no {at} record for them yet.', { at: checkpoint.id }), howTo)
    const short = shortfallOf(coverage)
    return short ? then(short, howTo) : ''
  }
  const target = (request.target ?? '').trim()
  if (target) {
    const coverage = coverageOf(project.rules, checkpoint.id, target, log)
    if (!coverage.recorded) return then(t('There is no {at} record for {target} yet.', { at: checkpoint.id, target }), howTo)
    const short = shortfallOf(coverage)
    return short ? then(short, howTo) : ''
  }
  // 対象を決めない節目（朝会・夕会の前・外へ投稿する前など）は、その日に 1 回でも記録したかを見る
  return runsOn(log, request.today, checkpoint.id).length ? '' : then(t('There is no {at} record today ({date}).', { at: checkpoint.id, date: request.today }), howTo)
}

/** その日の 1 日の進行の、古いままの待ちの行 */
async function staleWaitShortfall(dir: string, request: NudgeRequest): Promise<string> {
  const daily = await loadDaily(dir, request.today, undefined, { now: request.now ?? new Date() })
  const ids = daily.stale.ids
  return ids.length ? t('{n} waiting lines in today\'s daily progress have not been edited for {hours} hours or more: {ids}. Check whether the answer came, then update them', { n: ids.length, hours: daily.stale.hours, ids: ids.join(', ') }) : ''
}

export async function nudge(dir: string, request: NudgeRequest): Promise<Nudge> {
  const at = (request.at ?? '').trim()
  if (!at) return { ok: true, block: false, text: await summaryText(dir, request.today) }
  const project = await loadProject(dir)
  const checkpoint = checkpointsOf(project).find(c => c.id === at)
  if (!checkpoint) return { ok: false, block: false, text: t('The checkpoint "{at}" is not defined ({allowed})', { at, allowed: checkpointsOf(project).map(c => c.id).join(' / ') }) }
  const shortfalls = [await checkpointShortfall(dir, checkpoint, request), ...(request.staleWaits ? [await staleWaitShortfall(dir, request)] : [])].filter(Boolean)
  if (!shortfalls.length) return { ok: true, block: false, text: t('{at}: records are in place ({time})', { at, time: localStamp(request.now).slice(11) }) }
  return { ok: false, block: checkpoint.nudge === 'block', text: [`tadori nudge (${at}${checkpoint.name !== at ? ` ${checkpoint.name}` : ''}):`, ...shortfalls.map(s => `- ${s}`)].join('\n') }
}

/** フックの種類ごとに、止められるか */
const CAN_BLOCK = new Set(['PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop'])
/** エージェントの文脈に文を足せるフック */
const CAN_ADD_CONTEXT = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'])

/**
 * Claude Code の hooks がそのまま読める JSON（標準出力に出す）。何も言うことが無ければ空。
 * - 止める（block）：PreToolUse は permissionDecision deny、PostToolUse・Stop は decision block と reason
 * - 知らせるだけ：文脈に足せるフックは hookSpecificOutput.additionalContext、Stop は systemMessage（人の画面に出る）
 * - まとめ（--at なし）は、SessionStart などで毎回文脈に足す
 * 利用者の発言を消してしまうので、UserPromptSubmit では止めない（知らせるだけにする）
 */
export function hookJson(result: Nudge, event: string, isSummary = false): string {
  if (result.ok && !isSummary) return ''
  if (result.block && CAN_BLOCK.has(event)) {
    if (event === 'PreToolUse') return JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: result.text } })
    return JSON.stringify({ decision: 'block', reason: result.text })
  }
  if (CAN_ADD_CONTEXT.has(event)) return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: result.text } })
  return JSON.stringify({ systemMessage: result.text })
}
