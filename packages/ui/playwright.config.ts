import { defineConfig } from '@playwright/test'

/**
 * 画面のテスト。架空の見本の案件（examples/lend-v12）を tadori serve で開き、ブラウザで確かめる。
 * 手元の Windows では入っている Edge を使う（ブラウザを別に落とさないため）。CI では Playwright の Chromium を使う。
 * 先に pnpm -r build で CLI を建てておくこと（serve は packages/cli/dist を動かす）。
 */
const PORT = 4987
/** 予定の表の無い案件を開くサーバー（e2e/screen.spec.ts の NO_SCHEDULE_URL と同じ） */
const NO_SCHEDULE_PORT = 4988
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
    // 既存の画面のテストは日本語の画面で見る（英語の画面は i18n.spec.ts で見る）
    locale: 'ja-JP',
    ...(useEdge ? { channel: 'msedge' } : {}),
  },
  webServer: [
    {
      // 見本を一時フォルダへ写して開く（テストが書いても、リポジトリの見本は変わらない）
      command: `node e2e/serve.mjs ${PORT}`,
      url: `http://127.0.0.1:${PORT}/api/state`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // 予定の表（ledger/wbs.tsv）の無い案件。見本を写してから wbs.tsv を外す
      command: `node e2e/serve.mjs ${NO_SCHEDULE_PORT} --no-wbs`,
      url: `http://127.0.0.1:${NO_SCHEDULE_PORT}/api/state`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
