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

/**
 * 案件ごとに、漏れ・承認待ち・遅れ・今日が期日を並べる。
 * 合計や順位は出さない（点数を作らない）。読めない案件は理由を書いて飛ばし、ほかの案件は出す。
 */
export async function projectsText(dirs: readonly string[], today: string): Promise<string> {
  const unique = [...new Set(dirs.map(d => resolve(d)))]
  if (!unique.length) return t('No projects. Pass project folders, or open one in the desktop app first')
  const blocks: string[][] = []
  for (const dir of unique) {
    if (!(await isProject(dir))) {
      blocks.push([`- ${dir}`, `    ${t('No .tadori here (skipped)')}`])
      continue
    }
    try {
      const project = await loadProject(dir)
      blocks.push(summaryLines(dir, summarizeProject(project, today, await approvalChanges(dir, project))))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      blocks.push([`- ${dir}`, `    ${t('Could not read: {reason}', { reason })}`])
    }
  }
  return blocks.map(b => b.join('\n')).join('\n')
}
