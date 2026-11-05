import { describe, expect, test } from 'vitest'
import { runChecks } from '../src/usecase/check.js'
import { DANGLING_RULE_ID } from '../src/domain/model.js'
import { sampleProject } from './fixtures.js'

describe('runChecks', () => {
  const leaks = runChecks(sampleProject)
  const of = (rule: string) => leaks.filter(l => l.rule === rule).map(l => l.itemId)

  test('covered：元の行を参照する先の行が無ければ漏れにする', () => {
    expect(of('R3')).toEqual(['BD-2'])
  })

  test('covered：先の行が 1 つでもあれば漏れにしない', () => {
    expect(of('R8')).toEqual([]) // V-1 には TC-1・TC-2 がある
  })

  test('covered：試験ケースに実施の記録が無ければ漏れにする', () => {
    expect(of('R9')).toEqual(['TC-2'])
  })

  test('filled：決められた列が空なら漏れにする', () => {
    expect(of('R4')).toEqual(['DD-2'])
  })

  test('存在しない ID を指していれば漏れにする', () => {
    expect(of(DANGLING_RULE_ID)).toEqual(['TC-2'])
    const dangling = leaks.find(l => l.rule === DANGLING_RULE_ID)
    expect(dangling?.message).toContain('V-9')
  })

  test('refers：元の行が、決めた種類の行を 1 つも refs に持っていなければ漏れにする', () => {
    const project = {
      ...sampleProject,
      rules: [{ id: 'R1', phase: 'bd', kind: 'refers' as const, from: 'DD', to: 'BD', field: '', label: '節が章を元にしている' }],
      items: [
        ...sampleProject.items,
        { id: 'DD-9', kind: 'DD', title: '元の無い節', source: 'x.md', refs: ['V-1'], fields: { change: '変わる' } },
      ],
    }
    expect(runChecks(project).filter(l => l.rule === 'R1').map(l => l.itemId)).toEqual(['DD-9'])
  })

  test('only：列の値で対象の行を絞る（例：改修後に「変わる」節だけ commit を求める）', () => {
    const project = {
      ...sampleProject,
      rules: [{ id: 'R6', phase: 'dd', kind: 'covered' as const, from: 'DD', to: 'COMMIT', field: '', label: '変わる節は commit がある', only: { field: 'change', value: '変わる' } }],
    }
    // DD-1 は「変わる」で commit が無い → 漏れ。DD-2 は change が空なので対象外
    expect(runChecks(project).filter(l => l.rule === 'R6').map(l => l.itemId)).toEqual(['DD-1'])
  })

  test('人の承認のルールは漏れにしない（承認待ちは完了判定で扱う）', () => {
    expect(of('R2')).toEqual([])
  })

  test('漏れの文は、種類と列の読み方（設定）を使う。設定に無ければ記号のまま', () => {
    const project = {
      ...sampleProject,
      labels: { kinds: { RUN: '試験の記録' }, columns: { change: '改修後の対応' } },
    }
    const messages = runChecks(project).map(l => l.message).join('\n')
    expect(messages).toContain('TC-2「TC-2 の題」に試験の記録が紐づいていない')
    expect(messages).toContain('DD-2「DD-2 の題」の改修後の対応が空')
    expect(messages).toContain('に DD が紐づいていない') // 読み方の無い種類は記号のまま
  })

  test('漏れには、担当（ルールの owner）と、どこをどう直せば消えるかが付く', () => {
    const project = {
      ...sampleProject,
      rules: sampleProject.rules.map(r => (r.id === 'R4' ? { ...r, owner: '設計担当' } : r)),
      labels: { kinds: { RUN: '試験の記録' }, columns: { change: '改修後の対応' } },
    }
    const leaks = runChecks(project)
    const r4 = leaks.find(l => l.rule === 'R4')
    expect(r4).toMatchObject({ owner: '設計担当' })
    expect(r4?.fix).toBe('ledger/items.tsv の DD-2 の行の「改修後の対応」列に書く')
    const r9 = leaks.find(l => l.rule === 'R9')
    expect(r9?.owner).toBeUndefined() // owner の無いルールは担当なし
    expect(r9?.fix).toBe('ledger/items.tsv に試験の記録（RUN）の行を足し、その refs に TC-2 を書く')
    const r3 = leaks.find(l => l.rule === 'R3')
    expect(r3?.fix).toBe('ledger/items.tsv に DD の行を足し、その refs に BD-2 を書く')
    const dangling = leaks.find(l => l.rule === 'ID')
    expect(dangling?.fix).toContain('TC-2 の行の refs')
  })

  test('行番号が分かる行の漏れには、ファイルと行番号を付け、直し方にも行番号を書く', () => {
    const project = {
      ...sampleProject,
      items: sampleProject.items.map(i => (i.id === 'DD-2' ? { ...i, file: 'ledger/items.tsv', line: 12 } : i)),
    }
    const r4 = runChecks(project).find(l => l.rule === 'R4')
    expect(r4).toMatchObject({ file: 'ledger/items.tsv', line: 12 })
    expect(r4?.fix).toBe('ledger/items.tsv の DD-2 の行（12 行目）の「change」列に書く')
  })

  test('漏れの文には、どの行がどのルールを満たしていないかが入る', () => {
    const leak = leaks.find(l => l.rule === 'R3')
    expect(leak?.message).toContain('BD-2')
  })
})
