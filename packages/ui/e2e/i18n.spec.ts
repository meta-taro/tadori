import { expect, test } from '@playwright/test'

// 画面の言葉：英語を基本にし、OS / ブラウザの言語が日本語なら日本語。人が選んだ言語はこの PC に覚える。
// 案件の中で人が書いた言葉（工程の名前など）は訳さない。

test.describe('英語の画面（OS / ブラウザが英語）', () => {
  test.use({ locale: 'en-US' })

  test('左の列・上の帯・残課題が英語で出る。工程の名前（案件の言葉）はそのまま', async ({ page }) => {
    await page.goto('/#phases')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('link', { name: /Remaining work to release/ })).toBeVisible()
    await expect(page.locator('#summary')).toContainText('Gaps: 4')
    await expect(page.locator('#who-filter option').first()).toHaveText('Everyone')
    // 工程の名前は案件の設定に日本語で書かれているので、日本語のまま
    await expect(page.locator('#view')).toContainText('基本設計')
  })

  test('ルールセットと 1 日の進行も英語', async ({ page }) => {
    await page.goto('/#rules')
    await expect(page.getByRole('button', { name: 'Add a rule' })).toBeVisible()
    await page.goto('/#daily')
    await expect(page.getByRole('heading', { name: 'Daily progress' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy text' })).toBeVisible()
  })

  test('人が日本語を選んでいれば（この PC に覚えた言語）、英語の OS でも日本語', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('tadori-lang', 'ja'))
    await page.goto('/#phases')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
    await expect(page.locator('#summary')).toContainText('漏れ 4 件')
  })
})

test.describe('日本語の画面（OS / ブラウザが日本語）', () => {
  test.use({ locale: 'ja-JP' })

  test('左の列と上の帯が日本語で出る', async ({ page }) => {
    await page.goto('/#phases')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
    await expect(page.getByRole('link', { name: /リリースまでの残課題/ })).toBeVisible()
    await expect(page.locator('#summary')).toContainText('漏れ 4 件')
  })
})

test.describe('用語集の言語', () => {
  test.use({ locale: 'en-US' })
  test('英語の画面では、用語集も英語の列（見出しも英語）で出す', async ({ page }) => {
    await page.goto('/#glossary')
    await expect(page.locator('#view')).toContainText('General')
    await expect(page.locator('#view')).toContainText('Gap')
    await expect(page.locator('#view')).not.toContainText('完了判定')
  })
})

test.describe('英語の 1 日の進行の文の形', () => {
  test.use({ locale: 'en-US' })
  test('印は括弧も空白も付けずに札で出す（英語の既定は「[Planned] 」）', async ({ page }) => {
    await page.goto('/#daily')
    await page.locator('#daily-date').fill('2026-10-30')
    await page.locator('#daily-date').dispatchEvent('change')
    await expect(page.locator('.daily-preview h3').first()).toContainText('10/30')
    const pills = await page.locator('.daily-preview .daily-pill').allTextContents()
    expect(pills).toContain('Planned')
    expect(pills.every(p => /^[A-Za-z ]+$/.test(p))).toBe(true)
  })
})
