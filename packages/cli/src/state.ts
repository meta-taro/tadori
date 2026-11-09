import { join } from 'node:path'
import { buildGates, buildLink, loadProject, readChecks, readMembers, repositoryPrefix, resolvedItems, runChecks, type Member, type Gate, type Leak, type Project, type ResolvedItem } from '@tadori/core'

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
  readonly project: { readonly name: string }
  readonly phases: Project['phases']
  readonly statuses: Project['statuses']
  readonly rules: Project['rules']
  readonly tasks: Project['tasks']
  readonly items: Project['items']
  readonly approvals: Project['approvals']
  readonly labels: NonNullable<Project['labels']>
  readonly leaks: readonly LeakWithLink[]
  readonly gates: readonly Gate[]
  readonly checks: Awaited<ReturnType<typeof readChecks>>
  /** 前のチェックでは漏れだったが、いまは漏れの無い行（チェックの記録から読むだけ） */
  readonly resolved: readonly ResolvedItem[]
  /** 人の表（.tadori/members.tsv。人 → 役割。書かなくてもよい）。画面で人ごとに絞るのに使う */
  readonly members: readonly Member[]
}

export async function loadState(dir: string, today: string): Promise<{ project: Project; state: ProjectState }> {
  const project = await loadProject(dir)
  const leaks = runChecks(project)
  const checks = await readChecks(dir)
  const members = await readMembers(dir)
  const prefix = await repositoryPrefix(dir)
  const state: ProjectState = {
    today,
    project: { name: project.name },
    phases: [...project.phases].sort((a, b) => a.order - b.order),
    statuses: project.statuses,
    rules: project.rules,
    tasks: project.tasks,
    items: project.items,
    approvals: project.approvals,
    labels: project.labels ?? { kinds: {}, columns: {} },
    leaks: withOpenLinks(project, dir, prefix, leaks),
    gates: buildGates(project, leaks, today),
    checks,
    resolved: resolvedItems(checks, leaks),
    members,
  }
  return { project, state }
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
      ? buildLink(mdBusiness.url, { path: l.file, repopath: prefix + l.file, abspath: join(dir, l.file), id: l.itemId, ...(l.line ? { line: l.line } : {}) })
      : undefined
    const sheet = item?.source.split(/\s/)[0] ?? ''
    const runUrl = gitQa && runnable
      ? buildLink(gitQa.url, { path: sheet, repopath: prefix + sheet, abspath: join(dir, sheet), id: l.itemId })
      : undefined
    return { ...l, runnable, ...(openUrl ? { openUrl } : {}), ...(runUrl ? { runUrl } : {}) }
  })
}
