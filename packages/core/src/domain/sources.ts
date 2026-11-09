import type { Item } from './model.js'
/**
 * 正本（台帳の行の元になった文書・シート・課題）へのリンク。
 * 台帳は手元の写しで、正本は外の道具にある。URL は案件の .tadori/sources.tsv にだけ書く（tadori 本体には入れない）。
 * 外の道具とは同期しない。リンクを出して、人やエージェントが正本を開けるようにするだけ。
 */
export interface SourceDef {
  /** 台帳の source 列の先頭に書く名前（例：仕様書・試験シート） */
  readonly name: string
  /** 正本の URL */
  readonly url: string
  /** 場所まで飛ぶ URL のひな形（{url}＝URL、{loc}＝名前のあとの文字、{num}＝その中の最初の数）。空なら URL のまま */
  readonly locator: string
  /** 正本から手元へ反映してから、何日で「古い」とするか */
  readonly staleDays: number
}

export interface SourceLink {
  readonly name: string
  readonly url: string
  /** 名前のあとに書いた場所（例：§2.3・15 行目） */
  readonly place: string
}

/** source 列の先頭が設定の名前なら、その正本へのリンク（長い名前を先に見る）。無ければ undefined */
export function sourceLinkOf(source: string, sources: readonly SourceDef[]): SourceLink | undefined {
  const text = source.trim()
  const def = [...sources].sort((a, b) => b.name.length - a.name.length).find(s => text === s.name || text.startsWith(`${s.name} `) || text.startsWith(`${s.name}　`))
  if (!def) return undefined
  const place = text.slice(def.name.length).trim()
  const num = place.match(/\d+/)?.[0] ?? ''
  const url = def.locator
    ? def.locator.replace(/\{(url|loc|num)\}/g, (_, key: string) => (key === 'url' ? def.url : encodeURIComponent(key === 'loc' ? place : num)))
    : def.url
  return { name: def.name, url, place }
}

/** 正本から手元へ反映してから staleDays を超えたか（反映した記録が無いものも古いとみなす） */
export function isStale(syncedAt: string | undefined, today: string, staleDays: number): boolean {
  const day = syncedAt?.slice(0, 10)
  if (!day || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return true
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000
  return days > staleDays
}

/** 台帳の行の正本と、正本から手元へ反映した記録（synced_at・synced_by 列） */
export interface Origin extends SourceLink {
  readonly syncedAt?: string
  readonly syncedBy?: string
  /** 反映してから、その正本の staleDays を超えた（記録が無いものも含む） */
  readonly stale: boolean
}

/** 行の source 列が正本の設定にあれば、リンクと反映の記録を返す。無ければ undefined */
export function originOf(item: Pick<Item, 'source' | 'fields'>, sources: readonly SourceDef[], today: string): Origin | undefined {
  const link = sourceLinkOf(item.source, sources)
  if (!link) return undefined
  const def = sources.find(s => s.name === link.name) as SourceDef
  const syncedAt = item.fields.synced_at || undefined
  const syncedBy = item.fields.synced_by || undefined
  return { ...link, ...(syncedAt ? { syncedAt } : {}), ...(syncedBy ? { syncedBy } : {}), stale: isStale(syncedAt, today, def.staleDays) }
}
