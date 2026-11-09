import type { Phase, Project, StatusDef } from '../domain/model.js'
import { joinList, t } from '../i18n.js'

/** 工程とステータスで、同じ問題を言う文（言語ごとに文の形が違うので、それぞれ 1 つの文にする） */
interface BasicMessages {
  readonly emptyId: () => string
  readonly badId: (id: string) => string
  readonly badName: (id: string) => string
  readonly emptyName: (id: string) => string
  readonly duplicateId: (id: string) => string
}

const PHASE_MESSAGES: BasicMessages = {
  emptyId: () => t('A phase ID is empty'),
  badId: id => t('The phase ID "{id}" cannot be used (it starts with #, contains a tab or line break, or has leading or trailing spaces)', { id }),
  badName: id => t('The name of phase "{id}" cannot contain tabs or line breaks', { id }),
  emptyName: id => t('The name of phase "{id}" is empty', { id }),
  duplicateId: id => t('The phase ID "{id}" is duplicated', { id }),
}

const STATUS_MESSAGES: BasicMessages = {
  emptyId: () => t('A status ID is empty'),
  badId: id => t('The status ID "{id}" cannot be used (it starts with #, contains a tab or line break, or has leading or trailing spaces)', { id }),
  badName: id => t('The name of status "{id}" cannot contain tabs or line breaks', { id }),
  emptyName: id => t('The name of status "{id}" is empty', { id }),
  duplicateId: id => t('The status ID "{id}" is duplicated', { id }),
}

/** ID の重複と空の名前を見る（工程・ステータスで共通） */
function basicProblems(entries: readonly { id: string; name: string }[], messages: BasicMessages): string[] {
  const seen = new Set<string>()
  return entries.flatMap(e => {
    const problems: string[] = []
    if (!e.id.trim()) problems.push(messages.emptyId())
    // # で始まる行は次に読むと説明の行として読み飛ばされ、タブや改行は列をずらす
    if (e.id.startsWith('#') || /[\t\r\n]/.test(e.id) || e.id !== e.id.trim()) {
      problems.push(messages.badId(e.id))
    }
    if (/[\t\r\n]/.test(e.name)) problems.push(messages.badName(e.id))
    if (!e.name.trim()) problems.push(messages.emptyName(e.id))
    if (seen.has(e.id)) problems.push(messages.duplicateId(e.id))
    seen.add(e.id)
    return problems
  })
}

/**
 * 工程の設定を変えてよいかを見る。
 * ルールや WBS のタスクが使っている工程を消すと、それらが宙に浮くので止める。
 */
export function validatePhases(project: Project, next: readonly Phase[]): string[] {
  const kept = new Set(next.map(p => p.id))
  const removed = project.phases.filter(p => !kept.has(p.id))
  const inUse = removed.flatMap(p => {
    const rules = project.rules.filter(r => r.phase === p.id).map(r => r.id)
    const tasks = project.tasks.filter(task => task.phase === p.id).map(task => task.id)
    const users = [...rules, ...tasks]
    return users.length
      ? [t('Phase "{name}" cannot be removed because it is used by {users}. Move those first', { name: p.name, users: joinList(users) })]
      : []
  })
  return [...basicProblems(next, PHASE_MESSAGES), ...inUse]
}

/** ステータスの設定を変えてよいかを見る。タスクが使っているステータスは消せない */
export function validateStatuses(project: Project, next: readonly StatusDef[]): string[] {
  if (!next.length) return [t('At least one status is required')]
  const kept = new Set(next.map(s => s.id))
  const inUse = project.statuses.filter(s => !kept.has(s.id)).flatMap(s => {
    const tasks = project.tasks.filter(task => task.status === s.id).map(task => task.id)
    return tasks.length ? [t('Status "{name}" cannot be removed because it is used by {tasks}', { name: s.name, tasks: joinList(tasks) })] : []
  })
  return [...basicProblems(next, STATUS_MESSAGES), ...inUse]
}
