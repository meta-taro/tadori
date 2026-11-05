import { buildGates, loadProject, readChecks, runChecks, type Gate, type Project } from '@tadori/core'

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
  readonly leaks: ReturnType<typeof runChecks>
  readonly gates: readonly Gate[]
  readonly checks: Awaited<ReturnType<typeof readChecks>>
}

export async function loadState(dir: string, today: string): Promise<{ project: Project; state: ProjectState }> {
  const project = await loadProject(dir)
  const leaks = runChecks(project)
  const state: ProjectState = {
    today,
    project: { name: project.name },
    phases: [...project.phases].sort((a, b) => a.order - b.order),
    statuses: project.statuses,
    rules: project.rules,
    tasks: project.tasks,
    items: project.items,
    approvals: project.approvals,
    leaks,
    gates: buildGates(project, leaks, today),
    checks: await readChecks(dir),
  }
  return { project, state }
}

/** 手元の日付を YYYY-MM-DD で返す */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
