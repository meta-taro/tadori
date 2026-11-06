import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PATHS } from './repository.js'

/**
 * tadori を試す案件のリポジトリに、読める最小の設定と台帳を置く（tadori init）。
 * 工程・ステータスは叩き台。ルールは会社ごとに書くものなので、例をコメントで置くだけにする。
 */

const STARTER_RULESET = `${PATHS.rulesets}/rules.tsv`

/** 置くファイルと中身（# の行は tadori が読み飛ばす） */
function templates(name: string): ReadonlyArray<readonly [string, string]> {
  return [
    [PATHS.project, `name\n${name}\n`],
    [PATHS.phases, [
      '# 工程。会社・案件に合わせて書き換える（画面の「設定」からも変えられる）',
      'id\tname\torder',
      'design\t設計\t1',
      'impl\t実装\t2',
      'test\t試験\t3',
      'rel\tリリース\t4',
    ].join('\n') + '\n'],
    [PATHS.statuses, [
      '# WBS のタスクのステータス。tone：none（色なし）・wait（待ち）・hole（止まっている）・ok（済み）',
      'id\tname\ttone',
      'todo\t未着手\tnone',
      'doing\t進行中\twait',
      'review\tレビュー中\twait',
      'hold\t保留\thole',
      'done\t完了\tok',
    ].join('\n') + '\n'],
    [STARTER_RULESET, [
      '# 工程ごとのルール。エージェントが書き、画面で読む。kind は 4 種類：',
      '#   covered  その種類のどの行にも、それを元にした下流の行がある',
      '#   refers   その種類のどの行も、上流の行を元にしている',
      '#   filled   その種類のどの行にも、field の列の値が入っている',
      '#   approval 人の承認が要る（承認の記録は ledger/approvals.tsv）',
      '# 例（行頭の # を外すと効く）：',
      '#R1\tdesign\tcovered\tSPEC\tTC\t\t\t検証担当\t仕様の節ごとに試験ケースがある',
      '#R2\tdesign\tapproval\t\t\t\t\tレビュー担当\t設計書をレビュー担当が承認した',
      'id\tphase\tkind\tfrom\tto\tfield\tonly\towner\tlabel',
    ].join('\n') + '\n'],
    [PATHS.items, [
      '# 台帳。refs は「この行が元にしている行の ID」。、か , で区切って複数書ける',
      '# kind は自由に決める（例：SPEC=仕様の節・TC=試験ケース）。読み方は .tadori/kinds.tsv に書ける',
      'id\tkind\ttitle\tsource\trefs',
    ].join('\n') + '\n'],
    [PATHS.wbs, [
      '# WBS のタスク。台帳の行（種類 W）としても辿れる。日付は YYYY-MM-DD',
      'id\tphase\tname\tstart\tend\tstatus',
    ].join('\n') + '\n'],
    [PATHS.approvals, [
      '# 人の承認の記録。status は「承認」か、それ以外（差し戻しなど）。tadori は代わりに承認しない',
      'rule\tstatus\twho\twhen',
    ].join('\n') + '\n'],
  ]
}

export interface InitResult {
  /** 新しく置いたファイル */
  readonly created: readonly string[]
  /** すでにあったので触らなかったファイル */
  readonly skipped: readonly string[]
}

/** 無いファイルだけを置く。あるファイルは書き換えない（試す途中で書いたものを消さないため） */
export async function initProject(dir: string, name: string): Promise<InitResult> {
  const created: string[] = []
  const skipped: string[] = []
  for (const [path, text] of templates(name)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    try {
      await writeFile(join(dir, path), text, { encoding: 'utf8', flag: 'wx' })
      created.push(path)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      skipped.push(path)
    }
  }
  return { created, skipped }
}
