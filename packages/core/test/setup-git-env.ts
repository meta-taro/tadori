// テストの中で動かす git が、手元のリポジトリを触らないようにする。
// commit 前の検査（Git の hook）の中では、git が GIT_DIR・GIT_INDEX_FILE などを付けてテストを起こす。
// それを引き継いだまま一時フォルダで git init や git config をすると、一時フォルダではなく
// このリポジトリの設定と索引を書き換えてしまう（実際に core.bare と user.name が書き換わった）。
for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_')) delete process.env[key]
}

// これまでのテストは日本語の文を確かめている。言語を日本語に固定する（英語の文は、言語を指定したテストで見る）
process.env.TADORI_LANG = 'ja'
