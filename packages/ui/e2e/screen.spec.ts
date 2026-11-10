import { expect, test, type Page } from '@playwright/test'

// 架空の見本の案件（備品貸出アプリ 改修 v1.2）で、画面の振る舞いを確かめる。
// 見た目の細部ではなく、人が使うときに困ること（動かない帯・押せないリンク・はみ出す札）を見る。

/** エージェントの指示を画面へ送る（MCP の screen と同じ口） */
async function agent(page: Page, body: Record<string, unknown>): Promise<void> {
  const res = await page.request.post('/api/agent', { headers: { 'x-tadori': '1', 'content-type': 'application/json' }, data: body })
  expect(res.ok()).toBe(true)
}

/** 1 日の進行を、材料のある日（エージェントの確認と、各担当の予定が並ぶ日）で開く */
async function openDaily(page: Page): Promise<void> {
  await page.goto('/#daily')
  await page.locator('#daily-date').fill('2026-10-30')
  await page.locator('#daily-date').dispatchEvent('change')
  // 今日の日付の画面から、10/30 の画面に描き変わるのを待つ（文の形の見出しに日付が出る）
  await expect(page.locator('.daily-preview h3').first()).toContainText('10/30')
}

test.describe('上の帯と左の列は動かない', () => {
  test('中身が長い画面でスクロールしても、上の帯は窓の上に残り、動くのは上の帯の下の中身だけ', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 600 })
    await page.goto('/#glossary')
    await expect(page.getByRole('heading', { name: '用語' })).toBeVisible()
    const scroller = page.locator('.main > main')
    await scroller.evaluate(el => { el.scrollTop = 600 })
    expect(await scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    // ページ全体は動かない（スクロールバーが上の帯にかからない）
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)).toBe(0)
    const bar = await page.locator('.topbar').boundingBox()
    expect(bar?.y).toBe(0)
    // スクロールする所は、上の帯より下から始まる
    const area = await scroller.boundingBox()
    expect(area?.y ?? 0).toBeGreaterThanOrEqual((bar?.y ?? 0) + (bar?.height ?? 0) - 1)
  })
})

test.describe('リリースまでの残課題', () => {
  test('工程ごとに漏れと承認待ちを出し、割合や点数は出さない', async ({ page }) => {
    await page.goto('/#phases')
    await expect(page.locator('#view')).toContainText('基本設計')
    await expect(page.locator('#summary')).toContainText('漏れ 4 件')
    await expect(page.locator('#view')).not.toContainText('%')
  })

  test('上の帯に、最後のチェック（いつ・誰）を出し、押すとチェックの記録へ移る', async ({ page }) => {
    await page.goto('/#phases')
    const chip = page.locator('.last-check')
    await expect(chip).toContainText('最後のチェック')
    await chip.click()
    await expect(page).toHaveURL(/#log$/)
  })
})

test.describe('つながりを辿る', () => {
  test('正本の表にある行は、正本へのリンク（新しいタブ）と反映の記録を出す。記録が無ければ「古い」', async ({ page }) => {
    await page.goto('/#trace-F-02')
    const link = page.locator('.sp-card .origin-link')
    await expect(link).toHaveAttribute('href', 'https://issues.example.com/lend-v12')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
    await expect(page.locator('.sp-card .origin.stale')).toContainText('古い')
  })
})

test.describe('1 日の進行', () => {
  test('文の形は見出し・番号付きの一覧・印の札で描き、WBS の番号は画面の中のその場所へのリンクにする', async ({ page }) => {
    await openDaily(page)
    const preview = page.locator('.daily-preview')
    await expect(preview.locator('h3').first()).toContainText('今日')
    await expect(preview.locator('.daily-preview-list li').first()).toBeVisible()
    await expect(preview.locator('.daily-pill').first()).toHaveText(/^(確認|予定)$/)
    await expect(preview.locator('a.daily-ref', { hasText: 'W-03' }).first()).toHaveAttribute('href', '#browse-W-03')
    // 文そのもの（コピーする文字）には URL や画面の飛び先を混ぜない
    await expect(preview).not.toContainText('#browse-')
  })

  test('担当で絞ると、その人の行だけになる（役割で書いた行も含む）', async ({ page }) => {
    await openDaily(page)
    // 絞る前は全員の行（行の頭の担当の札で見分ける）。設計担当の行は、絞ったあとも同じ数だけ残る
    const owners = await page.locator('.daily-entry .daily-who').allTextContents()
    const mine = owners.filter(o => o.includes('設計担当')).length
    expect(mine).toBeGreaterThan(0)
    expect(mine).toBeLessThan(owners.length)
    await page.locator('#who-filter').selectOption('設計担当')
    await expect(page.locator('.daily-entry')).toHaveCount(mine)
    await page.locator('#who-filter').selectOption('')
  })

  test('行の本文の欄は行の幅を使い、長い行も途中で切れない', async ({ page }) => {
    await openDaily(page)
    const input = page.locator('.daily-text').first()
    const fits = await input.evaluate((el: HTMLInputElement) => el.scrollWidth <= el.clientWidth + 1)
    expect(fits).toBe(true)
  })
})

test.describe('エージェントの専用カーソル', () => {
  test('窓の右端にあるものを指しても、一言の札は窓の中に収まる', async ({ page }) => {
    await openDaily(page)
    await agent(page, { action: 'point', target: 'W-03', message: '設計担当の次の作業です。W-03 はレビュー中のまま、予定より遅れています' })
    const label = page.locator('.hl-label')
    await expect(label).toBeVisible()
    const box = await label.boundingBox()
    const width = page.viewportSize()?.width ?? 0
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
  })

  test('filter で、どの画面もその人の分に絞る', async ({ page }) => {
    await page.goto('/#phases')
    await agent(page, { action: 'filter', value: '検証担当' })
    await expect(page.locator('#who-filter')).toHaveValue('検証担当')
    await agent(page, { action: 'filter', value: '' })
    await expect(page.locator('#who-filter')).toHaveValue('')
  })
})

test.describe('1 日の進行の行のリンクと担当', () => {
  test('担当で絞っていないときは、見出しの横に「全員」、各行の頭に担当の札を出す。絞ると出さない', async ({ page }) => {
    await openDaily(page)
    await expect(page.locator('.daily-section h2 .daily-scope').first()).toHaveText('全員')
    await expect(page.locator('.daily-entry .daily-who').first()).toBeVisible()
    await page.locator('#who-filter').selectOption('設計担当')
    await expect(page.locator('.daily-section h2 .daily-scope').first()).toHaveText('設計担当')
    await expect(page.locator('.daily-entry .daily-who')).toHaveCount(0)
    await page.locator('#who-filter').selectOption('')
  })

  test('links を付けた行は、行の末尾に「表示名 ↗」を出し、押すと新しいタブで開く。URL は文字に出さない', async ({ page }) => {
    const res = await page.request.post('/api/daily/2026-10-30/entries', {
      headers: { 'x-tadori': '1', 'content-type': 'application/json' },
      data: { section: 'today', who: '設計担当', text: 'QA を返した', links: [{ label: 'QA表', url: 'https://sheets.example.com/qa#row=12' }] },
    })
    expect(res.ok()).toBe(true)
    await openDaily(page)
    const link = page.locator('.daily-entry .daily-link', { hasText: 'QA表 ↗' })
    await expect(link).toHaveAttribute('href', 'https://sheets.example.com/qa#row=12')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(page.locator('.daily-entry').filter({ hasText: 'QA表' })).not.toContainText('https://')
    // 文の形では、補足の「QA表：URL」も「QA表 ↗」のリンクにする
    await expect(page.locator('.daily-preview a', { hasText: 'QA表 ↗' })).toHaveAttribute('href', 'https://sheets.example.com/qa#row=12')
  })
})

test.describe('1 日の進行の文の形の担当', () => {
  test('担当で絞っていないときは、文の形の行の頭の担当名を札にする（「：」は札に出さない）。絞ると出さない', async ({ page }) => {
    await openDaily(page)
    const who = page.locator('.daily-preview .daily-who').first()
    await expect(who).toBeVisible()
    await expect(who).not.toContainText('：')
    await page.locator('#who-filter').selectOption('設計担当')
    await expect(page.locator('.daily-preview .daily-who')).toHaveCount(0)
    await page.locator('#who-filter').selectOption('')
  })
})

test.describe('バージョンと更新', () => {
  const newer = { current: '0.1.0', latest: '0.2.0', isNewer: true, releaseUrl: 'https://github.com/meta-taro/tadori/releases/tag/v0.2.0', downloadUrl: 'https://meta-taro.github.io/tadori/download.html' }

  test('新しい版があれば上の帯に札を出し、押すと配布のページを開くリンクを出す', async ({ page }) => {
    await page.route('**/api/update', route => route.fulfill({ json: newer }))
    await page.goto('/#phases')
    const chip = page.locator('.update-chip')
    await expect(chip).toHaveText('新しい版 0.2.0')
    await chip.click()
    const panel = page.getByRole('dialog', { name: 'バージョンと更新' })
    await expect(panel).toContainText('新しい版 0.2.0 があります')
    await expect(panel.getByRole('link', { name: '配布のページを開く' })).toHaveAttribute('href', newer.downloadUrl)
    await panel.getByRole('button', { name: '閉じる' }).click()
    await expect(panel).toHaveCount(0)
  })

  test('最新なら札を出さず、確かめられないときは理由を出す（「最新」と決めつけない）', async ({ page }) => {
    await page.goto('/#phases')
    await expect(page.locator('#summary')).toContainText('漏れ')
    await expect(page.locator('.update-chip')).toHaveCount(0)
    // 画面が配る update.js を、ブラウザの中で読み込んで開く（型の検査では、ブラウザの URL は解決できないので文字で渡す）
    await page.evaluate(async path => { const m = await import(path); await m.showUpdatePanel() }, '/update.js')
    const panel = page.getByRole('dialog', { name: 'バージョンと更新' })
    await expect(panel).toContainText('tadori 0.1.0')
    await expect(panel).toContainText('切ってあります')
  })
})

test.describe('server の中の例外と版', () => {
  test('server が落ちたら、画面に例外の要点と記録の場所を出す（「ターミナルを見て」ではなく）', async ({ page }) => {
    await page.route('**/api/daily?*', route => route.fulfill({ status: 500, json: { error: 'サーバーの中で問題が起きました：x is not a function', logFile: 'C:/logs/server-2026-11-09.log' } }))
    await page.goto('/#daily')
    await expect(page.locator('#view')).toContainText('x is not a function')
    await expect(page.locator('#view')).toContainText('server-2026-11-09.log')
  })

  test('server が元のコードより古い版なら、上の帯に知らせる', async ({ page }) => {
    await page.route('**/api/version', route => route.fulfill({ json: { version: '0.1.0', builtAt: '2026-11-09T04:50:00.000Z', commit: 'abc1234', isStale: true } }))
    await page.goto('/#phases')
    await expect(page.locator('.stale-chip')).toHaveText('server が古い版です')
  })
})

test.describe('ルールを画面から足す・直す・消す', () => {
  test('空いている ID で足すと、すぐ一覧に出る。直す・消すもできる', async ({ page }) => {
    await page.goto('/#rules')
    await page.getByRole('button', { name: 'ルールを足す' }).click()
    const form = page.locator('#rule-form')
    await expect(form.locator('[name="id"]')).toHaveValue(/^R\d+$/)
    const id = await form.locator('[name="id"]').inputValue()
    await form.locator('[name="phase"]').selectOption('it')
    await form.locator('[name="kind"]').selectOption('filled')
    await form.locator('[name="from"]').fill('TC')
    await form.locator('[name="field"]').fill('verifier')
    await form.locator('[name="owner"]').fill('検証担当')
    await form.locator('[name="label"]').fill('試験ケースに確かめる人がいる')
    await form.getByRole('button', { name: '保存' }).click()
    const row = page.locator('tr', { hasText: id })
    await expect(row).toContainText('試験ケースに確かめる人がいる')

    await row.getByRole('button', { name: '直す' }).click()
    await form.locator('[name="owner"]').fill('開発担当')
    await form.getByRole('button', { name: '保存' }).click()
    await expect(page.locator('tr', { hasText: id })).toContainText('開発担当')

    // 消すのは 2 回押す（1 回目で「もう一度押すと消す」に変わる）
    // 直した直後は、ファイルの変化の知らせで画面が描き直されるが、1 回目に押した状態は保たれる
    await page.locator('tr', { hasText: id }).getByRole('button', { name: '消す' }).click()
    await page.waitForTimeout(800)
    await page.locator('tr', { hasText: id }).getByRole('button', { name: 'もう一度押すと消す' }).click()
    await expect(page.locator('tr', { hasText: id })).toHaveCount(0)
  })

  test('知らない種類のルールなど、保存できないときは理由を出し、一覧は変えない', async ({ page }) => {
    await page.goto('/#rules')
    await page.getByRole('button', { name: 'ルールを足す' }).click()
    const form = page.locator('#rule-form')
    await form.locator('[name="id"]').fill('R9')
    await form.locator('[name="label"]').fill('x')
    await form.getByRole('button', { name: '保存' }).click()
    await expect(form.locator('.form-problems')).toContainText('R9')
  })
})

test.describe('1 日の進行の本文の語のリンク（anchor）', () => {
  test('本文の語（何回目か）をリンクにし、行末には出さない。本文に無い語は行末に「表示名 ↗」で出す', async ({ page }) => {
    const res = await page.request.post('/api/daily/2026-10-30/entries', {
      headers: { 'x-tadori': '1', 'content-type': 'application/json' },
      data: { section: 'today', who: '設計担当', text: 'QA を読んで QA を返した', links: [{ label: 'QA表', url: 'https://sheets.example.com/qa', anchor: 'QA', nth: 2 }, { label: 'MR', url: 'https://git.example.com/mr/3', anchor: 'プルリク' }] },
    })
    expect(res.ok()).toBe(true)
    await openDaily(page)
    const anchor = page.locator('.daily-preview a.daily-anchor', { hasText: 'QA' })
    await expect(anchor).toHaveCount(1)
    await expect(anchor).toHaveAttribute('href', 'https://sheets.example.com/qa')
    // 2 回目の QA だけがリンクで、1 回目は文字のまま
    const li = page.locator('.daily-preview li', { hasText: 'QA を読んで' })
    await expect(li).toContainText('QA を読んで QA を返した')
    expect(await li.innerHTML()).toMatch(/QA を読んで <a class="daily-anchor"[^>]*>QA<\/a> を返した/)
    // 行の一覧：語が見つかったリンクは行末に出さず、見つからないリンクは出す
    const row = page.locator('.daily-entry').filter({ has: page.locator('input[value="QA を読んで QA を返した"]') })
    await expect(row.locator('.daily-link', { hasText: 'QA表' })).toHaveCount(0)
    await expect(row.locator('.daily-link', { hasText: 'MR ↗' })).toHaveCount(1)
  })
})

test.describe('プロダクトの WBS', () => {
  test('各タスクの行に担当を出し、担当順に並べ替えられる', async ({ page }) => {
    await page.goto('/#browse')
    await expect(page.locator('#task-W-01 .owner')).toHaveText('設計担当')
    await page.locator('#wbs-sort').selectOption('owner')
    // 工程ごとに、担当の名前順（担当の無いタスクは最後）
    const owners = await page.locator('.wbs-task .owner').first().locator('xpath=../..').locator('.wbs-task .owner').allTextContents()
    const named = owners.filter(Boolean)
    expect(named).toEqual([...named].sort((a, b) => a.localeCompare(b)))
    expect(owners.slice(named.length).every(o => o === '')).toBe(true)
  })
})

test.describe('判定しない文のルールと分類', () => {
  test('分類で絞ると、その分類のルールだけになり、文のルールは「判定しない」と出る', async ({ page }) => {
    await page.goto('/#rules')
    await page.locator('[data-filter="group"][data-value="agreement"]').click()
    const rows = page.locator('.rules-list tbody tr')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('N3')
    await expect(rows.first()).toContainText('判定しない')
    await expect(rows.first()).toContainText('人とエージェントの間の約束')
    await page.locator('[data-filter="group"][data-value="all"]').click()
  })

  test('工程なしで文のルールを足せる', async ({ page }) => {
    await page.goto('/#rules')
    await page.getByRole('button', { name: 'ルールを足す' }).click()
    const form = page.locator('#rule-form')
    await form.locator('[name="id"]').fill('N9')
    await form.locator('[name="phase"]').selectOption('')
    await form.locator('[name="kind"]').selectOption('note')
    await form.locator('[name="group"]').selectOption('visible')
    await form.locator('[name="label"]').fill('報告は結論を先に書く')
    await form.getByRole('button', { name: '保存' }).click()
    await expect(page.locator('tr', { hasText: 'N9' })).toContainText('報告は結論を先に書く')
  })
})

test.describe('チェックの記録', () => {
  test('1 回の実行（時刻・だれ・なぜが同じ）を 1 枚にまとめ、見出しは漏れの合計。満たすルールは畳み、新しいものが上', async ({ page }) => {
    await page.goto('/#log')
    const entries = page.locator('.log-entry')
    await expect(entries).toHaveCount(2)
    const run = entries.first()
    await expect(run.locator('.log-head')).toContainText('漏れ 4 件')
    await expect(run.locator('.log-head')).toContainText('満たす 2 件')
    await expect(run.locator('.log-rule')).toHaveCount(4)
    await expect(run.locator('.log-met')).not.toHaveAttribute('open', '')
    await expect(run.locator('.log-meta')).toContainText('2026-10-30')
    await expect(entries.last().locator('.log-meta')).toContainText('2026-10-20')
    const ids = run.locator('.log-ids').first()
    await ids.click()
    await expect(ids).toHaveAttribute('aria-expanded', 'true')
  })
})
