import { isRuleTarget, type Item, type Leak, type Project } from '../domain/model.js'
import { runChecks } from './check.js'

/**
 * 辿った線の 1 歩。行か、ルールが求める先が無い切れ目。
 * 切れ目は、下流が無いとき（covered）は after、上流が無いとき（refers）は before に、その行の ID を持つ。
 */
export type TraceStep =
  | { readonly type: 'item'; readonly item: Item; readonly level: number; readonly leaks: readonly Leak[] }
  | { readonly type: 'missing'; readonly rule: string; readonly kind: string; readonly after?: string; readonly before?: string }

export interface TraceResult {
  readonly start: Item
  readonly steps: readonly TraceStep[]
}

/** start から上流（refs）と下流（その行を refs に持つ行）を辿り、start からの段を返す */
function levelsFrom(project: Project, start: Item, byId: ReadonlyMap<string, Item>): Map<string, number> {
  const up = (i: Item) => i.refs.map(ref => byId.get(ref)).filter((x): x is Item => Boolean(x))
  const down = (i: Item) => project.items.filter(x => x.refs.includes(i.id))

  // 上流は負、下流は正の段。同じ行に 2 通りで着いたら、先に着いた段を使う
  const levels = new Map<string, number>([[start.id, 0]])
  const walk = (next: (i: Item) => Item[], direction: -1 | 1) => {
    const queue: Array<[Item, number]> = [[start, 0]]
    while (queue.length) {
      const [current, depth] = queue.shift() as [Item, number]
      for (const n of next(current)) {
        if (levels.has(n.id)) continue
        levels.set(n.id, depth + direction)
        queue.push([n, depth + direction])
      }
    }
  }
  walk(up, -1)
  walk(down, 1)
  return levels
}

/**
 * 1 件から上流と下流を辿り、元から順に並べる。
 * つながりは台帳に書かれた ID だけで決める。推測でつながない。
 * 辿った行には、その行の漏れ（つながり以外の、列が空などの漏れも）を付ける。
 */
export function trace(project: Project, id: string): TraceResult | null {
  const byId = new Map(project.items.map(i => [i.id, i]))
  const start = byId.get(id)
  if (!start) return null

  const ordered = [...levelsFrom(project, start, byId).entries()]
    .map(([itemId, level]) => ({ item: byId.get(itemId) as Item, level }))
    .sort((a, b) => a.level - b.level || a.item.id.localeCompare(b.item.id))

  const leaks = runChecks(project)
  const kindIds = (kind: string) => new Set(project.items.filter(x => x.kind === kind).map(x => x.id))

  const steps = ordered.flatMap(({ item, level }): TraceStep[] => {
    // 上流が無い（refers）：行の手前に切れ目
    const before = project.rules
      .filter(r => r.kind === 'refers' && isRuleTarget(r, item))
      .filter(r => { const targets = kindIds(r.to); return !item.refs.some(ref => targets.has(ref)) })
      .map((r): TraceStep => ({ type: 'missing', before: item.id, rule: r.id, kind: r.to }))
    // 下流が無い（covered）：行の直後に切れ目
    const after = project.rules
      .filter(r => r.kind === 'covered' && isRuleTarget(r, item))
      .filter(r => !project.items.some(x => x.kind === r.to && x.refs.includes(item.id)))
      .map((r): TraceStep => ({ type: 'missing', after: item.id, rule: r.id, kind: r.to }))
    const own = leaks.filter(l => l.itemId === item.id)
    return [...before, { type: 'item', item, level, leaks: own }, ...after]
  })

  return { start, steps }
}
