// 画面が受け取るデータの型。サーバー（packages/cli）が返す形を、そのまま使う（画面とサーバーで食い違わないように）
export type ProjectState = import('../../cli/src/state.js').ProjectState
export type Daily = import('../../cli/src/daily.js').Daily
