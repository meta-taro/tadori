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
  await expect(page.getByRole('heading', { name: /今日 2/ })).toBeVisible()
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
    await page.locator('#who-filter').selectOption('設計担当')
    await expect(page.locator('.daily-entry .daily-meta').first()).toContainText('設計担当')
    const owners = await page.locator('.daily-entry .daily-meta > span.cond').allTextContents()
    expect(owners.length).toBeGreaterThan(0)
    expect(owners.every(o => o.includes('設計担当'))).toBe(true)
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
