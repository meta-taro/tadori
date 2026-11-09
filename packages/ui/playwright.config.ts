import { defineConfig } from '@playwright/test'

/**
 * 画面のテスト。架空の見本の案件（examples/lend-v12）を tadori serve で開き、ブラウザで確かめる。
 * 手元の Windows では入っている Edge を使う（ブラウザを別に落とさないため）。CI では Playwright の Chromium を使う。
 * 先に pnpm -r build で CLI を建てておくこと（serve は packages/cli/dist を動かす）。
 */
const PORT = 4987
const useEdge = process.platform === 'win32' && !process.env.CI

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    ...(useEdge ? { channel: 'msedge' } : {}),
  },
  webServer: {
    // 見本を一時フォルダへ写して開く（テストが書いても、リポジトリの見本は変わらない）
    command: `node e2e/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/state`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
