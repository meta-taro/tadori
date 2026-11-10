import { defineConfig } from 'vitest/config'

// 出す前の試験（ハーネス）。組んだもの（packages/cli/dist）を、使う人と同じ道で本物のプロセスとして動かす。
// 単体テストが通っても、組んだ CLI・MCP のプロセス・serve の HTTP・画面の部品の置き場所のどこかで
// 食い違っていれば、試験導入している人が先に気づくことになる。それを出す前に止めるため。
export default defineConfig({
  test: {
    include: ['harness/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
