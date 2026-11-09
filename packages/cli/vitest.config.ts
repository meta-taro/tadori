import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // git の環境変数を外してからテストを始める（test/setup-git-env.ts）
    setupFiles: ['./test/setup-git-env.ts'],
  },
})
