import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import './i18n.js'
import { loadProject, summarizeProject, t, type ProjectSummary } from '@tadori/core'
import { approvalChanges } from './state.js'

/** デスクトップアプリが覚えている最近の案件（OS ごとの置き場所） */
export function recentFile(): string {
  const app = 'io.github.meta-taro.tadori'
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), app, 'recent-projects.txt')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', app, 'recent-projects.txt')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), app, 'recent-projects.txt')
}

/** 最近の案件のフォルダ。デスクトップアプリを使っていない PC では空 */
export async function readRecentProjects(file = recentFile()): Promise<string[]> {
  try {
    return (await readFile(file, 'utf8')).replace(/^﻿/, '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  } catch {
    // 一覧のファイルが無い：最近の案件は無い（エラーではない）
    return []
  }
}

export async function isProject(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, '.tadori'))).isDirectory()
  } catch {
    return false
  }
}

const ownerOf = (owner?: string) => (owner ? t(' ({owner})', { owner }) : '')

function summaryLines(dir: string, s: ProjectSummary): string[] {
  const head = `- ${s.name}  ${dir}`
  const counts = `    ${t('Gaps: {leaks} / Pending approval: {waits}', { leaks: s.leaks, waits: s.pendingApprovals })}`
  const late = s.late.map(x => `    ${t('Late {days} days: {id} {name}{owner}', { days: x.days, id: x.id, name: x.name, owner: ownerOf(x.owner) })}`)
  const due = s.dueToday.map(x => `    ${t('Due today: {id} {name}{owner}', { id: x.id, name: x.name, owner: ownerOf(x.owner) })}`)
  return [head, counts, ...late, ...due]
}

/** 案件 1 つ分。読めた案件は summary、読めなかった案件は problem（理由の文）を持つ */
export interface ProjectEntry {
  readonly dir: string
  readonly current: boolean
  readonly summary?: ProjectSummary
  readonly problem?: string
}

async function entryOf(dir: string, today: string, current: boolean): Promise<ProjectEntry> {
  if (!(await isProject(dir))) return { dir, current, problem: t('No .tadori here (skipped)') }
  try {
    const project = await loadProject(dir)
    return { dir, current, summary: summarizeProject(project, today, await approvalChanges(dir, project)) }
  } catch (error) {
    // 1 つの案件が読めなくても、ほかの案件は出す（理由はその案件の所に書く）
    const reason = error instanceof Error ? error.message : String(error)
    return { dir, current, problem: t('Could not read: {reason}', { reason }) }
  }
}

/**
 * 案件ごとに、漏れ・承認待ち・遅れ・今日が期日を集める。同じフォルダは 1 回だけ。
 * 合計や順位は作らない（点数を作らない）。並びは渡された順のまま。
 */
export async function collectProjects(dirs: readonly string[], today: string, currentDir?: string): Promise<ProjectEntry[]> {
  const current = currentDir ? resolve(currentDir) : undefined
  const unique = [...new Set(dirs.map(d => resolve(d)))]
  return Promise.all(unique.map(dir => entryOf(dir, today, dir === current)))
}

/** 案件ごとの事実を、人とエージェントが読む文にする（tadori projects・MCP の list_projects counts） */
export async function projectsText(dirs: readonly string[], today: string): Promise<string> {
  const entries = await collectProjects(dirs, today)
  if (!entries.length) return t('No projects. Pass project folders, or open one in the desktop app first')
  return entries
    .map(e => (e.summary ? summaryLines(e.dir, e.summary) : [`- ${e.dir}`, `    ${e.problem ?? ''}`]).join('\n'))
    .join('\n')
}
