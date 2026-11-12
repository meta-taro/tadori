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
  /** この行が書かれている TSV と、その何行目か（md-business でその行を開くため） */
  readonly file?: string
  readonly line?: number
  /** md-business の検証シートから読んだ行なら、その行の ID（行を挿しても変わらない。md-business でその行を開くため） */
  readonly rowId?: string
}

/** WBS のタスク。期間は入っていないこともある */
export interface Task {
  readonly id: string
  readonly phase: string
  readonly name: string
  readonly start?: string
  readonly end?: string
  readonly status: string
  /** 担当（wbs.tsv の owner 列。書かなくてもよい）。1 日の進行を担当ごとに出すのに使う */
  readonly owner?: string
  /** この作業の課題の ID（wbs.tsv の issue 列。台帳の行の ID。書かなくてもよい）。1 日の進行で、同じ課題の作業を 1 件にまとめる */
  readonly issue?: string
  /** wbs.tsv の何行目か */
  readonly line?: number
}

/**
 * ルール。判定の種類は 5 つと、判定しない文のルール（note）。
 * - covered : from の種類のどの行にも、それを refs に持つ to の種類の行が 1 つ以上ある（下流が出ている）
 * - refers  : from の種類のどの行も、to の種類の行を 1 つ以上 refs に持つ（上流を元にしている）
 * - filled  : from の種類のどの行にも、field 列の値が入っている
 * - allowed : from の種類のどの行も、field 列の値が values のどれか（空の行はここでは見ない。filled で見る）
 * - approval: 人の承認が要る（判定は承認の記録を見るだけ。tadori は代わりに承認しない）
 * - note    : 判定しない。書くときの約束（カンペの書き方・人とエージェントの間の約束など）を label に書いて、読むだけ。
 *             漏れにも、工程の「ルールあり」の数にも入れない。工程は書かなくてよい
 */
export type RuleKind = 'covered' | 'refers' | 'filled' | 'allowed' | 'approval' | 'note'

/** ルールの分類（.tadori/rule-groups.tsv。名前と数は案件ごとに決める。書かなくてもよい） */
export interface RuleGroup {
  readonly id: string
  readonly name: string
  readonly order: number
  /** 帯の色（tone の none・wait・hole・ok か、決まった色の名前）。書かなければ既定の色 */
  readonly color?: RuleGroupColor
  /** だれまでに効くか。team＝チームで共有する / local＝その人とエージェントの間だけ（git に入れないファイルに置く） */
  readonly scope?: RuleGroupScope
}

export const RULE_GROUP_COLORS = ['none', 'wait', 'hole', 'ok', 'blue', 'green', 'yellow', 'red', 'purple', 'gray'] as const
export type RuleGroupColor = (typeof RULE_GROUP_COLORS)[number]
export const RULE_GROUP_SCOPES = ['team', 'local'] as const
export type RuleGroupScope = (typeof RULE_GROUP_SCOPES)[number]

/**
 * ルールの対象を絞る条件（rulesets の only 列）。
 * 「列名=値」「列名=値1|値2」（どれかに合う）、「列名!=値」（その値でない。|で複数も可）
 */
export interface RuleOnly {
  readonly field: string
  /** 書いたままの値（「a|b」など。画面と書き戻しに使う） */
  readonly value: string
  /** 「|」で分けた値。どれかに合えば（negate なら、どれにも合わなければ）対象 */
  readonly values?: readonly string[]
  /** 「!=」で書いたとき true */
  readonly negate?: boolean
}

export interface Rule {
  readonly id: string
  readonly phase: string
  readonly kind: RuleKind
  readonly from: string
  readonly to: string
  readonly field: string
  readonly label: string
  /** 対象の行を絞る（例：change 列が「変わる」の行だけ）。無ければ from の種類の全行 */
  readonly only?: RuleOnly
  /** allowed で使う、列に書いてよい値（rulesets の values 列を「|」で分けたもの） */
  readonly values?: readonly string[]
  /** 分類の ID（rulesets の group 列。rule-groups.tsv の id。書かなくてもよい） */
  readonly group?: string
  /** 担当の役割（例：設計担当・検証担当・PM）。漏れを直す人・承認する人。案件ごとに自由に書く */
  readonly owner?: string
  /** 効く節目の ID（rulesets の at 列を「|」で分けたもの）。その節目で、このルールをチェック項目として突きつける */
  readonly at?: readonly string[]
  /** 節目で突きつけるチェック項目の文（rulesets の check 列）。無ければ label を使う */
  readonly check?: string
}

/**
 * 工程の節目（試験ケースを書き終えた・判定を付ける前・外へ投稿する前・コミット前など）。
 * 節目では、そこに効くルールだけを並べ、項目ごとに結果と根拠の場所を記録させる。
 * 案件が .tadori/checkpoints.tsv で決める。書かなければ既定の 4 つ
 */
export interface Checkpoint {
  readonly id: string
  readonly name: string
}

/** 既定の節目の ID（名前はそのときの言語で付ける） */
export const DEFAULT_CHECKPOINT_IDS = ['cases-written', 'before-judge', 'before-post', 'before-commit'] as const

/** コミット前の節目。対象は「いま stage してある変更」で、tadori が印を付ける */
export const STAGED_CHECKPOINT = 'before-commit'

/** 台帳のファイル（直し方の案内に使う。読み書きの場所と同じ） */
export const LEDGER_FILES = {
  items: 'ledger/items.tsv',
  wbs: 'ledger/wbs.tsv',
  approvals: 'ledger/approvals.tsv',
} as const

/** ルールの対象の行か（種類が from で、only があればその列の値も合う） */
export function isRuleTarget(rule: Rule, item: Item): boolean {
  if (item.kind !== rule.from) return false
  if (!rule.only) return true
  const actual = (item.fields[rule.only.field] ?? '').trim()
  const values = rule.only.values ?? [rule.only.value]
  const matches = values.includes(actual)
  return rule.only.negate ? !matches : matches
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
  /** どのファイルの、どの行の、何を直せば消えるか（1 行） */
  readonly fix?: string
  /** 直す担当（ルールの owner） */
  readonly owner?: string
  /** 直す行が書かれている TSV と行番号（分かるとき） */
  readonly file?: string
  readonly line?: number
  /** 直す行が md-business の検証シートの行なら、その行 ID */
  readonly rowId?: string
}

/** 存在しない ID を指している、を表すルール ID（どのルールセットにも属さない） */
export const DANGLING_RULE_ID = 'ID'

/** ステータスの設定。tone は表示の意味だけ（none / wait / hole / ok） */
export interface StatusDef {
  readonly id: string
  readonly name: string
  readonly tone: 'none' | 'wait' | 'hole' | 'ok'
}

/** 種類（kind）と列の読み方。企業・案件ごとに違うので設定で持つ（.tadori/kinds.tsv・columns.tsv） */
export interface Labels {
  readonly kinds: Readonly<Record<string, string>>
  readonly columns: Readonly<Record<string, string>>
  /** 「やったこと」に当たる種類（.tadori/kinds.tsv の work 列）。1 日の進行で、台帳の整備と分ける */
  readonly workKinds?: readonly string[]
}

/** 読み方があればそれを、無ければ記号を前後に空白を付けて返す（文の中で記号だと分かるように） */
export function labelOf(names: Readonly<Record<string, string>> | undefined, code: string): string {
  const name = names?.[code]
  return name ? name : ` ${code} `
}

/** 読み込んだ案件の全体 */
export interface Project {
  /** 種類と列の読み方。無ければ記号のまま出す */
  readonly labels?: Labels
  /** ほかの道具を開くリンクの雛形（.tadori/links.tsv） */
  readonly links?: readonly import('./links.js').LinkTemplate[]
  /** 正本の表（.tadori/sources.tsv。書かなくてもよい） */
  readonly sources?: readonly import('./sources.js').SourceDef[]
  /** ルールの分類（.tadori/rule-groups.tsv の並び順。書かなければ空） */
  readonly ruleGroups?: readonly RuleGroup[]
  /** 節目（.tadori/checkpoints.tsv。書かなければ無く、既定の 4 つを使う） */
  readonly checkpoints?: readonly Checkpoint[]
  readonly name: string
  /** 予定の表（ledger/wbs.tsv）の呼び名（project.tsv の schedule_label。例：スケジュール・工程表）。書かなければ画面は「WBS」 */
  readonly scheduleLabel?: string
  readonly phases: readonly Phase[]
  readonly rules: readonly Rule[]
  readonly items: readonly Item[]
  readonly tasks: readonly Task[]
  readonly approvals: readonly Approval[]
  readonly statuses: readonly StatusDef[]
}
