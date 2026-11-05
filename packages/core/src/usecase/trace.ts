import type { Item, Project } from '../domain/model.js'

/** 辿った線の 1 歩。行か、ルールが求める先が無い切れ目 */
export type TraceStep =
  | { readonly type: 'item'; readonly item: Item; readonly level: number }
  | { readonly type: 'missing'; readonly after: string; readonly rule: string; readonly kind: string }

export interface TraceResult {
  readonly start: Item
  readonly steps: readonly TraceStep[]
}

/**
 * 1 件から上流（refs）と下流（その行を refs に持つ行）を辿り、元から順に並べる。
 * つながりは台帳に書かれた ID だけで決める。推測でつながない。
 */
export function trace(project: Project, id: string): TraceResult | null {
  const byId = new Map(project.items.map(i => [i.id, i]))
  const start = byId.get(id)
  if (!start) return null

  const up = (i: Item) => i.refs.map(ref => byId.get(ref)).filter((x): x is Item => Boolean(x))
  const down = (i: Item) => project.items.filter(x => x.refs.includes(i.id))

  // 上流は負、下流は正の段（start からいくつ離れているか）。同じ行に 2 通りで着いたら、先に着いた段を使う
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

  const ordered = [...levels.entries()]
    .map(([itemId, level]) => ({ item: byId.get(itemId) as Item, level }))
    .sort((a, b) => a.level - b.level || a.item.id.localeCompare(b.item.id))

  // 辿った行のうち、covered のルールが求める先を持たない行の直後に切れ目を入れる
  const covered = project.rules.filter(r => r.kind === 'covered')
  const steps = ordered.flatMap(({ item, level }): TraceStep[] => {
    const gaps = covered
      .filter(r => r.from === item.kind && !project.items.some(x => x.kind === r.to && x.refs.includes(item.id)))
      .map((r): TraceStep => ({ type: 'missing', after: item.id, rule: r.id, kind: r.to }))
    return [{ type: 'item', item, level }, ...gaps]
  })

  return { start, steps }
}
