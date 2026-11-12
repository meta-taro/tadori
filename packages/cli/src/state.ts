import { join } from 'node:path'
import { unknownTaskStatuses, type UnknownTaskStatus, approvalTargets, buildGates, buildLink, lastCommits, loadProject, originOf, type Origin, readChecks, readCheckpointLog, checkpointsOf, type Checkpoint, type CheckpointRow, readMembers, repositoryPrefix, resolvedItems, runChecks, type Member, type Gate, type Leak, type Project, type ResolvedItem } from '@tadori/core'

/** 漏れに「md-business で開く」の URL を付けたもの（雛形が .tadori/links.tsv にあるとき） */
export type LeakWithLink = Leak & {
  /** 直す行を md-business で開く URL（雛形があるとき） */
  readonly openUrl?: string
  /** 試験ケースの漏れか（git-qa で実施できる） */
  readonly runnable: boolean
  /** そのケースを git-qa で実施する URL（雛形があるとき） */
  readonly runUrl?: string
}

/** 画面と MCP に渡す、案件のいまの姿（読むたびに TSV から組み立てる。tadori は控えを持たない） */
export interface ProjectState {
  readonly today: string
  /** 案件の名前と、予定の表の呼び名（書いていなければ無い。画面は「WBS」と呼ぶ） */
  readonly project: { readonly name: string; readonly scheduleLabel?: string }
  readonly phases: Project['phases']
  readonly statuses: Project['statuses']
  readonly rules: Project['rules']
  /** ルールの分類（.tadori/rule-groups.tsv の並び順。書いていなければ空） */
  readonly ruleGroups: NonNullable<Project['ruleGroups']>
  readonly tasks: Project['tasks']
  readonly items: Project['items']
  readonly approvals: Project['approvals']
  readonly labels: NonNullable<Project['labels']>
  readonly leaks: readonly LeakWithLink[]
  readonly gates: readonly Gate[]
  readonly checks: Awaited<ReturnType<typeof readChecks>>
  /** 節目で確かめた記録（.tadori/checkpoint-log.tsv。書いた順） */
  readonly checkpointLog: readonly CheckpointRow[]
  /** 節目の並び（案件が決めたものか、既定の 4 つ） */
  readonly checkpoints: readonly Checkpoint[]
  /** 前のチェックでは漏れだったが、いまは漏れの無い行（チェックの記録から読むだけ） */
  readonly resolved: readonly ResolvedItem[]
  /** 人の表（.tadori/members.tsv。人 → 役割。書かなくてもよい）。画面で人ごとに絞るのに使う */
  readonly members: readonly Member[]
  /** 行 ID → 正本へのリンクと、正本から手元へ反映した記録（.tadori/sources.tsv にある正本の行だけ） */
  readonly origins: Readonly<Record<string, Origin>>
  /** WBS の状態のうち、statuses.tsv に無いもの（状態ごとのタスク）。読み込みは止めずに知らせる */
  readonly unknownStatuses: readonly UnknownTaskStatus[]
}

export async function loadState(dir: string, today: string): Promise<{ project: Project; state: ProjectState }> {
  const project = await loadProject(dir)
  const leaks = runChecks(project)
  const checks = await readChecks(dir)
  const members = await readMembers(dir)
  const prefix = await repositoryPrefix(dir)
  const state: ProjectState = {
    today,
    project: { name: project.name, ...(project.scheduleLabel ? { scheduleLabel: project.scheduleLabel } : {}) },
    phases: [...project.phases].sort((a, b) => a.order - b.order),
    statuses: project.statuses,
    rules: project.rules,
    ruleGroups: project.ruleGroups ?? [],
    tasks: project.tasks,
    items: project.items,
    approvals: project.approvals,
    labels: project.labels ?? { kinds: {}, columns: {} },
    leaks: withOpenLinks(project, dir, prefix, leaks),
    gates: buildGates(project, leaks, today, await approvalChanges(dir, project)),
    checks,
    checkpointLog: await readCheckpointLog(dir),
    checkpoints: checkpointsOf(project),
    resolved: resolvedItems(checks, leaks),
    members,
    origins: originsOf(project, today),
    unknownStatuses: unknownTaskStatuses(project),
  }
  return { project, state }
}

/** 承認された承認のルールが見る文書の、最後の commit（承認のあとに変わったかを見るため） */
async function approvalChanges(dir: string, project: Project): Promise<Awaited<ReturnType<typeof lastCommits>>> {
  const approved = new Set(project.approvals.filter(a => a.status === '承認').map(a => a.rule))
  const files = [...new Set(project.rules.filter(r => approved.has(r.id)).flatMap(r => approvalTargets(project, r)))]
  return files.length ? lastCommits(dir, files) : {}
}

/** 正本の表にある行だけ、正本へのリンクと反映の記録を集める */
function originsOf(project: Project, today: string): Record<string, Origin> {
  const sources = project.sources ?? []
  return Object.fromEntries(project.items.flatMap(item => {
    const origin = originOf(item, sources, today)
    return origin ? [[item.id, origin] as const] : []
  }))
}

/** 手元の日付を YYYY-MM-DD で返す */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * 漏れに、直す行を md-business で開く URL を付ける。開いたあとの動きは md-business に任せる。
 * 雛形が無ければ何も付けない（画面のアイコンは薄く出て押せない）。
 * prefix は git リポジトリの最上位から案件のフォルダまでの場所（{repopath} に使う）。
 */
function withOpenLinks(project: Project, dir: string, prefix: string, leaks: readonly Leak[]): LeakWithLink[] {
  const mdBusiness = project.links?.find(l => l.tool === 'md-business')
  const gitQa = project.links?.find(l => l.tool === 'git-qa')
  const byId = new Map(project.items.map(i => [i.id, i]))
  return leaks.map(l => {
    const item = byId.get(l.itemId)
    // 試験ケースの漏れは git-qa で実施できる。シートの場所は台帳の source 列（例：qa/test-spec.tsv）
    const runnable = item?.kind === 'TC'
    const openUrl = mdBusiness && l.file
      ? buildLink(mdBusiness.url, { path: l.file, repopath: prefix + l.file, abspath: join(dir, l.file), id: l.itemId, ...(l.line ? { line: l.line } : {}), ...(l.rowId ? { rowid: l.rowId } : {}) })
      : undefined
    const sheet = item?.source.split(/\s/)[0] ?? ''
    const runUrl = gitQa && runnable
      ? buildLink(gitQa.url, { path: sheet, repopath: prefix + sheet, abspath: join(dir, sheet), id: l.itemId })
      : undefined
    return { ...l, runnable, ...(openUrl ? { openUrl } : {}), ...(runUrl ? { runUrl } : {}) }
  })
}
