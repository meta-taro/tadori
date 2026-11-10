import './i18n.js'
import { currentLang, t, type Origin, type TraceResult } from '@tadori/core'
import { listJoin } from './i18n.js'
import type { ProjectState } from './state.js'

/** 担当と直し方の 1 行（例：担当：設計担当　直し方：…）。check と MCP の list_leaks が同じものを使う */
export function fixText(fix: string, owner?: string): string {
  return `${owner ? t('Owner: {owner}  ', { owner }) : ''}${t('How to fix: {fix}', { fix })}`
}

/** 承認の状態（中では承認・差し戻し・待ちで持つ）を、いまの言語の言葉にする */
export function approvalStatusText(status: string): string {
  if (currentLang() !== 'en') return status
  return ({ 承認: 'approved', 差し戻し: 'sent back', 待ち: 'waiting' } as Record<string, string>)[status] ?? status
}

/** tadori check の出力。工程ごとの漏れと承認待ちの中身だけを出す（割合や点数は出さない） */
export function formatCheck(state: ProjectState): string {
  const lines = [t('{name}  (as of {today})', { name: state.project.name, today: state.today }), '']
  for (const gate of state.gates) {
    const counts = [
      gate.leaks.length ? t('Gaps {count}', { count: gate.leaks.length }) : '',
      gate.pendingApprovals.length ? t('Pending approval {count} ({ids})', { count: gate.pendingApprovals.length, ids: listJoin(gate.pendingApprovals.map(r => r.id)) }) : '',
    ].filter(Boolean).join(' / ') || (gate.rules.length ? t('Nothing left') : t('No rules (not checked yet)'))
    const early = gate.startedBefore ? t('  ← started before the {phase} phase gate', { phase: gate.startedBefore.name }) : ''
    const late = gate.maxLateDays ? t('  {days} days late', { days: gate.maxLateDays }) : ''
    lines.push(`■ ${gate.phase.name}  ${counts}${late}${early}`)
    for (const leak of gate.leaks) {
      lines.push(`    ${leak.rule} ${leak.message}`)
      // 誰が・どこをどう直せば消えるか
      if (leak.fix) lines.push(`        ${fixText(leak.fix, leak.owner)}`)
    }
    for (const p of gate.pending) {
      // 承認のあとに見る文書が変わったものは、状態ではなく何が変わったかを出す
      const status = p.changedAfter
        ? t('{file} changed after approval: {commit} {date}', { file: p.changedAfter.file, commit: p.changedAfter.commit, date: p.changedAfter.date.slice(0, 10) })
        : approvalStatusText(p.status)
      lines.push(`    ${t('{rule} pending approval ({status})  How to fix: {fix}', { rule: p.rule.id, status, fix: p.fix })}`)
    }
  }
  // 同じ漏れかは、ルールと行の ID で見る（画面向けにリンクを足した写しと、工程が持つ元の漏れは別の物なので、物の同一では比べない）
  const keyOf = (l: { rule: string; itemId: string }) => `${l.rule}\t${l.itemId}`
  const inPhase = new Set(state.gates.flatMap(g => g.leaks.map(keyOf)))
  const dangling = state.leaks.filter(l => !inPhase.has(keyOf(l)))
  if (dangling.length) {
    lines.push(t('■ Gaps not in any phase'))
    for (const leak of dangling) lines.push(`    ${leak.rule} ${leak.message}`)
  }
  // statuses.tsv に無い WBS の状態は「始まっていて、終わっていない」と数えられる。漏れではないので終了コードは変えず、知らせるだけ
  if (state.unknownStatuses.length) {
    lines.push(t('■ WBS statuses not in .tadori/statuses.tsv (counted as started and not done)'))
    for (const u of state.unknownStatuses) lines.push(`    ${t('"{status}": {ids}', { status: u.status, ids: listJoin(u.taskIds) })}`)
    lines.push(`    ${t('How to fix: add the status to .tadori/statuses.tsv (the 1st row means not started yet, tone ok means done), or write a status that is there in ledger/wbs.tsv')}`)
  }
  const waits = state.gates.reduce((n, g) => n + g.pendingApprovals.length, 0)
  lines.push('', t('Gaps: {leaks} / Pending approval: {waits}', { leaks: state.leaks.length, waits }))
  return lines.join('\n')
}

/** tadori why の出力。元から順に並べ、切れ目には ✗ を付ける */
export function formatTrace(result: TraceResult, origins: Readonly<Record<string, Origin>> = {}): string {
  // 切れ目として出す漏れは、行の下に重ねて出さない
  const shownAsGap = new Set(result.steps.flatMap(s => (s.type === 'missing' ? [`${s.rule}:${s.after ?? s.before}`] : [])))
  return result.steps.flatMap(step => {
    if (step.type === 'missing') {
      const vars = { kind: step.kind, rule: step.rule }
      return [step.before ? t('    ✗ No upstream {kind} ({rule})  ← broken here', vars) : t('    ✗ No {kind} ({rule})  ← broken here', vars)]
    }
    const other = step.leaks.filter(l => !shownAsGap.has(`${l.rule}:${l.itemId}`))
    const mark = step.item.id === result.start.id ? '▶' : other.length ? '✗' : '・'
    return [
      t('{mark} {kind} {id}  {title}  ({source})', { mark, kind: step.item.kind.padEnd(6), id: step.item.id, title: step.item.title, source: step.item.source }),
      // つながり以外の漏れ（列が空など）は、その行の下に出す
      ...other.map(l => t('      Gap {rule}: {message}', { rule: l.rule, message: l.message })),
      ...(origins[step.item.id] ? [`      ${originText(origins[step.item.id] as Origin)}`] : []),
    ]
  }).join('\n')
}

/** 正本の URL と、正本から手元へ反映した記録を 1 行で（例：正本：https://…（反映 2026-11-08 09:00 検証担当）） */
export function originText(origin: Origin): string {
  const who = origin.syncedBy ? ` ${origin.syncedBy}` : ''
  const synced = origin.syncedAt ? t('synced {at}{who}', { at: origin.syncedAt, who }) : t('no sync record')
  return t('Source of truth: {url} ({synced}{stale})', { url: origin.url, synced, stale: origin.stale ? t(', stale') : '' })
}
