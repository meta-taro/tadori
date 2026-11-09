import { describe, expect, test } from 'vitest'
import { buildLink, validateLinkTemplate } from '../src/domain/links.js'

describe('buildLink', () => {
  test('雛形の {path} {line} {id} {abspath} に、URL で崩れない形にして差し込む', () => {
    const url = buildLink('md-business://open?path={path}&line={line}&id={id}&abs={abspath}', {
      path: 'ledger/items.tsv', line: 6, id: 'DD-2.3', abspath: 'C:/work/案件 A/ledger/items.tsv',
    })
    expect(url).toBe('md-business://open?path=ledger%2Fitems.tsv&line=6&id=DD-2.3&abs=C%3A%2Fwork%2F%E6%A1%88%E4%BB%B6%20A%2Fledger%2Fitems.tsv')
  })

  test('{repopath} には、git リポジトリの最上位からの場所を差し込む', () => {
    expect(buildLink('md-business://open?repo=github.com/o/r&path={repopath}', { repopath: 'examples/lend-v12/ledger/items.tsv' }))
      .toBe('md-business://open?repo=github.com/o/r&path=examples%2Flend-v12%2Fledger%2Fitems.tsv')
  })

  test('値の無い差し込みだけの引数は、リンクから外す（空の line= や id= を渡さない）', () => {
    expect(buildLink('x://open?path={path}&line={line}', { path: 'a.tsv' })).toBe('x://open?path=a.tsv')
    expect(buildLink('x://open?line={line}&path={path}&mode=grid', { path: 'a.tsv' })).toBe('x://open?path=a.tsv&mode=grid')
    expect(buildLink('x://open?id={rowid}', {})).toBe('x://open')
  })

  test('{rowid} には md-business の検証シートの行 ID を差し込む（行を挿しても変わらないので、その行を開ける）', () => {
    expect(buildLink('md-business://open?path={path}&line={line}&id={rowid}', { path: 'qa/sheet.tsv', line: 4, rowid: 'r3f9a2c81b40e' }))
      .toBe('md-business://open?path=qa%2Fsheet.tsv&line=4&id=r3f9a2c81b40e')
  })
})

describe('validateLinkTemplate', () => {
  test('独自の URL スキームと http(s) は通す', () => {
    expect(validateLinkTemplate('md-business://open?path={path}')).toBeNull()
    expect(validateLinkTemplate('https://example.invalid/open?path={path}')).toBeNull()
  })

  test('押すと画面の中で命令が動く形（javascript: など）は断る', () => {
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', ' data:text/html,x', 'vbscript:x', 'file:///etc/passwd']) {
      expect(validateLinkTemplate(bad)).toMatch(/使えません/)
    }
  })

  test('スキームの無いものは断る', () => {
    expect(validateLinkTemplate('open?path={path}')).toMatch(/スキーム/)
  })
})
