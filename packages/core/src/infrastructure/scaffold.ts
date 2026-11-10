import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { t } from '../i18n.js'
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
      `# ${t('Phases. Rewrite them to fit your organization and project (you can also change them from "Settings" on the screen)')}`,
      'id\tname\torder',
      `design\t${t('Design')}\t1`,
      `impl\t${t('Implementation')}\t2`,
      `test\t${t('Testing')}\t3`,
      `rel\t${t('Release')}\t4`,
    ].join('\n') + '\n'],
    [PATHS.statuses, [
      `# ${t('Statuses of WBS tasks. tone: none (no color), wait (waiting), hole (stuck), ok (done)')}`,
      `# ${t('The order of the rows matters: the 1st row means "not started yet", and a status with tone ok means "done". Every other status counts as started and not done')}`,
      `# ${t('Write the status column of ledger/wbs.tsv with an id (or a name) from this table. tadori check shows statuses that are not here')}`,
      'id\tname\ttone',
      `todo\t${t('Not started')}\tnone`,
      `doing\t${t('In progress')}\twait`,
      `review\t${t('In review')}\twait`,
      `hold\t${t('On hold')}\thole`,
      `done\t${t('Done')}\tok`,
    ].join('\n') + '\n'],
    [STARTER_RULESET, [
      `# ${t('Rules for each phase. An agent writes them and the screen reads them. There are 4 kinds:')}`,
      `#   covered  ${t('every row of that kind has a downstream row based on it')}`,
      `#   refers   ${t('every row of that kind is based on an upstream row')}`,
      `#   filled   ${t('every row of that kind has a value in the field column')}`,
      `#   approval ${t('a person must approve (approvals are recorded in ledger/approvals.tsv)')}`,
      `# ${t('Examples (remove the leading # to enable):')}`,
      `#R1\tdesign\tcovered\tSPEC\tTC\t\t\t${t('QA owner')}\t${t('Every spec section has a test case')}`,
      `#R2\tdesign\tapproval\t\t\t\t\t${t('Reviewer')}\t${t('The reviewer approved the design document')}`,
      'id\tphase\tkind\tfrom\tto\tfield\tonly\towner\tlabel',
    ].join('\n') + '\n'],
    [PATHS.items, [
      `# ${t('The ledger. refs are "the IDs of the rows this row is based on". Separate several with 、 or ,')}`,
      `# ${t('Choose kinds freely (e.g. SPEC = spec section, TC = test case). You can give them readable names in .tadori/kinds.tsv')}`,
      'id\tkind\ttitle\tsource\trefs',
    ].join('\n') + '\n'],
    [PATHS.wbs, [
      `# ${t('WBS tasks. They can also be traced as ledger rows (kind W). Dates are YYYY-MM-DD')}`,
      'id\tphase\tname\tstart\tend\tstatus',
    ].join('\n') + '\n'],
    [PATHS.approvals, [
      // 状態の値（承認・差し戻し）は人が書くデータなので、英語の文でも訳さない
      `# ${t('Approvals by people. status is "承認" (approved) or anything else (e.g. 差し戻し, sent back). tadori never approves on anyone\'s behalf')}`,
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
