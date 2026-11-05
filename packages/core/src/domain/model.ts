/**
 * tadori のドメインの型。
 *
 * 正本は md-business の文書・git-qa の証跡・案件の git にあり、tadori はそれを読んでつなぐだけ。
 * ここにある型は「読んだ結果」の形で、tadori が新しい正本を持つためのものではない。
 */

/** 工程（基本設計・詳細設計など）。並びは案件ごとに違う */
export interface Phase {
  readonly id: string
  readonly name: string
  readonly order: number
}

/**
 * 台帳の 1 行。設計書の章・節、commit、観点、試験ケース、試験の記録、指摘、再発防止など。
 * refs は「この行が元にしている行の ID」（上流への線）。
 */
export interface Item {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly source: string
  readonly refs: readonly string[]
  /** 列名 → 値。kind ごとに使う列が違う（例：詳細設計の節の「改修後の対応」） */
  readonly fields: Readonly<Record<string, string>>
}

/** WBS のタスク。期間は入っていないこともある */
export interface Task {
  readonly id: string
  readonly phase: string
  readonly name: string
  readonly start?: string
  readonly end?: string
  readonly status: string
}

/**
 * ルール。判定の種類は 4 つ。
 * - covered : from の種類のどの行にも、それを refs に持つ to の種類の行が 1 つ以上ある（下流が出ている）
 * - refers  : from の種類のどの行も、to の種類の行を 1 つ以上 refs に持つ（上流を元にしている）
 * - filled  : from の種類のどの行にも、field 列の値が入っている
 * - approval: 人の承認が要る（判定は承認の記録を見るだけ。tadori は代わりに承認しない）
 */
export type RuleKind = 'covered' | 'refers' | 'filled' | 'approval'

export interface Rule {
  readonly id: string
  readonly phase: string
  readonly kind: RuleKind
  readonly from: string
  readonly to: string
  readonly field: string
  readonly label: string
  /** 対象の行を絞る（例：change 列が「変わる」の行だけ）。無ければ from の種類の全行 */
  readonly only?: { readonly field: string; readonly value: string }
}

/** ルールの対象の行か（種類が from で、only があればその列の値も合う） */
export function isRuleTarget(rule: Rule, item: Item): boolean {
  if (item.kind !== rule.from) return false
  return !rule.only || item.fields[rule.only.field] === rule.only.value
}

export type ApprovalStatus = '承認' | '差し戻し' | '待ち'

/** 人の承認の記録。人が書く */
export interface Approval {
  readonly rule: string
  readonly status: ApprovalStatus
  readonly who: string
  readonly when: string
}

/** 漏れ：ルールが求めるつながりが無い箇所。tadori が出すのは一覧まで */
export interface Leak {
  readonly rule: string
  readonly itemId: string
  readonly message: string
}

/** 存在しない ID を指している、を表すルール ID（どのルールセットにも属さない） */
export const DANGLING_RULE_ID = 'ID'

/** ステータスの設定。tone は表示の意味だけ（none / wait / hole / ok） */
export interface StatusDef {
  readonly id: string
  readonly name: string
  readonly tone: 'none' | 'wait' | 'hole' | 'ok'
}

/** 読み込んだ案件の全体 */
export interface Project {
  readonly name: string
  readonly phases: readonly Phase[]
  readonly rules: readonly Rule[]
  readonly items: readonly Item[]
  readonly tasks: readonly Task[]
  readonly approvals: readonly Approval[]
  readonly statuses: readonly StatusDef[]
}
