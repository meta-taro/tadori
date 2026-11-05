import { join } from 'node:path'
import { buildGates, buildLink, loadProject, readChecks, resolvedItems, runChecks, type Gate, type Leak, type Project, type ResolvedItem } from '@tadori/core'

/** 漏れに「md-business で開く」の URL を付けたもの（雛形が .tadori/links.tsv にあるとき） */
export type LeakWithLink = Leak & { readonly openUrl?: string }

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
}

export async function loadState(dir: string, today: string): Promise<{ project: Project; state: ProjectState }> {
  const project = await loadProject(dir)
  const leaks = runChecks(project)
  const checks = await readChecks(dir)
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
    leaks: withOpenLinks(project, dir, leaks),
    gates: buildGates(project, leaks, today),
    checks,
    resolved: resolvedItems(checks, leaks),
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
 * 雛形が無ければ何も付けない（画面には「場所をコピー」だけが出る）。
 */
function withOpenLinks(project: Project, dir: string, leaks: readonly Leak[]): LeakWithLink[] {
  const template = project.links?.find(l => l.tool === 'md-business')
  if (!template) return [...leaks]
  return leaks.map(l => (l.file
    ? { ...l, openUrl: buildLink(template.url, { path: l.file, abspath: join(dir, l.file), id: l.itemId, ...(l.line ? { line: l.line } : {}) }) }
    : l))
}
