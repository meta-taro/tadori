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

describe('値で判定するルール', () => {
  // 架空：試験ケースの結果（result 列）と、指摘（F）のつながり
  const items = [
    { id: 'TC-1', kind: 'TC', title: '上限ちょうど', source: 'qa', refs: [], fields: { result: 'OK' } },
    { id: 'TC-2', kind: 'TC', title: '延滞中', source: 'qa', refs: [], fields: { result: 'NG' } },
    { id: 'TC-3', kind: 'TC', title: '同時押し', source: 'qa', refs: [], fields: { result: 'NG' } },
    { id: 'TC-4', kind: 'TC', title: '祝日', source: 'qa', refs: [], fields: { result: 'pending' } },
    { id: 'F-1', kind: 'F', title: '延滞中に借りられた', source: 'issues', refs: ['TC-2'], fields: {} },
  ]
  const project = (rules: object[]) => ({ ...sampleProject, items, rules }) as typeof sampleProject

  test('only に「|」で複数の値：どれかに合う行だけを対象にする（結果が NG か保留の試験ケースには指摘がある）', () => {
    const rule = { id: 'V1', phase: 'it', kind: 'covered', from: 'TC', to: 'F', field: '', label: 'NG には指摘', only: { field: 'result', value: 'NG|pending', values: ['NG', 'pending'], negate: false } }
    expect(runChecks(project([rule])).filter(l => l.rule === 'V1').map(l => l.itemId)).toEqual(['TC-3', 'TC-4'])
  })

  test('only に「!=」：その値でない行だけを対象にする', () => {
    const rule = { id: 'V2', phase: 'it', kind: 'covered', from: 'TC', to: 'F', field: '', label: 'OK 以外には指摘', only: { field: 'result', value: 'OK', values: ['OK'], negate: true } }
    expect(runChecks(project([rule])).filter(l => l.rule === 'V2').map(l => l.itemId)).toEqual(['TC-3', 'TC-4'])
  })

  test('allowed：列の値が決めた値のどれかでなければ漏れにする（空はここでは見ない。filled で見る）', () => {
    const rule = { id: 'V3', phase: 'it', kind: 'allowed', from: 'TC', to: '', field: 'result', values: ['OK', 'NG'], label: '結果は OK か NG' }
    const leaks = runChecks(project([rule])).filter(l => l.rule === 'V3')
    expect(leaks.map(l => l.itemId)).toEqual(['TC-4'])
    expect(leaks[0]?.message).toContain('pending')
  })
})

describe('検証シートから読んだ行の漏れ', () => {
  test('直す行が検証シートの行なら、漏れに md-business の行 ID が付く（その行を選んで開くため）', () => {
    const project = {
      ...sampleProject,
      rules: [{ id: 'RS', phase: sampleProject.phases[0]?.id ?? '', kind: 'filled' as const, from: 'TCS', to: '', field: '結果', label: '結果がある' }],
      items: [{ id: 'TC-90', kind: 'TCS', title: '見本', source: 'qa/sheet.tsv', refs: [], fields: { 結果: '' }, file: 'qa/sheet.tsv', line: 4, rowId: 'r00000000000a' }],
    }
    expect(runChecks(project).find(l => l.rule === 'RS')).toMatchObject({ itemId: 'TC-90', file: 'qa/sheet.tsv', line: 4, rowId: 'r00000000000a' })
  })
})
