import type { Phase, Project, StatusDef } from '../domain/model.js'

/** ID の重複と空の名前を見る（工程・ステータスで共通） */
function basicProblems(entries: readonly { id: string; name: string }[], label: string): string[] {
  const seen = new Set<string>()
  return entries.flatMap(e => {
    const problems: string[] = []
    if (!e.id.trim()) problems.push(`${label}の ID が空です`)
    // # で始まる行は次に読むと説明の行として読み飛ばされ、タブや改行は列をずらす
    if (e.id.startsWith('#') || /[\t\r\n]/.test(e.id) || e.id !== e.id.trim()) {
      problems.push(`${label}の ID「${e.id}」は使えません（# で始まる・タブや改行を含む・前後に空白がある）`)
    }
    if (/[\t\r\n]/.test(e.name)) problems.push(`${label}「${e.id}」の名前にタブや改行は使えません`)
    if (!e.name.trim()) problems.push(`${label}「${e.id}」の名前が空です`)
    if (seen.has(e.id)) problems.push(`${label}の ID「${e.id}」が重複しています`)
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
    const tasks = project.tasks.filter(t => t.phase === p.id).map(t => t.id)
    const users = [...rules, ...tasks]
    return users.length ? [`工程「${p.name}」は ${users.join('・')} が使っているので消せません。先にそちらを移してください`] : []
  })
  return [...basicProblems(next, '工程'), ...inUse]
}

/** ステータスの設定を変えてよいかを見る。タスクが使っているステータスは消せない */
export function validateStatuses(project: Project, next: readonly StatusDef[]): string[] {
  if (!next.length) return ['ステータスは 1 つ以上必要です']
  const kept = new Set(next.map(s => s.id))
  const inUse = project.statuses.filter(s => !kept.has(s.id)).flatMap(s => {
    const tasks = project.tasks.filter(t => t.status === s.id).map(t => t.id)
    return tasks.length ? [`ステータス「${s.name}」は ${tasks.join('・')} が使っているので消せません`] : []
  })
  return [...basicProblems(next, 'ステータス'), ...inUse]
}
