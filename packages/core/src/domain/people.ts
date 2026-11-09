/**
 * 人と役割。WBS の担当は人の名前、ルールの担当（漏れを直す人）は役割（設計担当など）で書かれることが多い。
 * 案件の .tadori/members.tsv（列 name・git・roles）で「人 → 役割」を書くと、人で絞ったときに、その人の役割の漏れも出せる。
 */
export interface Member {
  /** 人の名前（WBS の owner 列と同じ書き方） */
  readonly name: string
  /** git の作者名（commit から担当を決めるとき） */
  readonly git: string
  /** その人の役割（ルールの owner 列と同じ書き方。書かなくてもよい） */
  readonly roles: readonly string[]
}

/** 担当の欄を人ごとに分ける（「A・B」「A、B」「A,B」「A/B」のように 2 人以上書かれることがある） */
export const ownersOf = (owner: string | undefined): string[] =>
  (owner ?? '').split(/[・、,，/／]/).map(s => s.trim()).filter(Boolean)

/** owner の欄が、その人（who）の分か。名前の一致か、その人の役割の一致。who が空なら、だれの分でもあるとみなす */
export function isFor(owner: string | undefined, who: string, members: readonly Member[]): boolean {
  if (!who) return true
  const names = ownersOf(owner)
  const roles = members.find(m => m.name === who)?.roles ?? []
  return names.includes(who) || names.some(n => roles.includes(n))
}
