// 画面が受け取るデータの型。サーバー（packages/cli）が返す形を、そのまま使う（画面とサーバーで食い違わないように）
export type ProjectState = import('../../cli/src/state.js').ProjectState
export type Daily = import('../../cli/src/daily.js').Daily

// ProjectState の中の 1 件ずつの形。画面で別の形を書き起こさず、サーバーの形から取り出す
export type Phase = ProjectState['phases'][number]
export type StatusDef = ProjectState['statuses'][number]
export type Rule = ProjectState['rules'][number]
export type Task = ProjectState['tasks'][number]
export type Item = ProjectState['items'][number]
export type Approval = ProjectState['approvals'][number]
export type Labels = ProjectState['labels']
export type Leak = ProjectState['leaks'][number]
export type Gate = ProjectState['gates'][number]
export type CheckRecord = ProjectState['checks'][number]
export type ResolvedItem = ProjectState['resolved'][number]
export type Member = ProjectState['members'][number]
export type Origin = ProjectState['origins'][string]
export type DailyEntry = Daily['entries'][number]

// 保存したときにサーバーが返す、commit の結果
export type CommitResult = import('../../core/src/infrastructure/git.js').CommitResult
// つながりを辿った結果（/api/trace が返す形）
export type TraceResult = import('../../core/src/usecase/trace.js').TraceResult
export type TraceStep = TraceResult['steps'][number]
// エージェントが専用カーソルで画面を操作する指示（/api/events の agent で届く形）
export type AgentAction = import('../../cli/src/agent.js').AgentAction
// 新しい版があるか（/api/update が返す形）
export type UpdateInfo = import('../../cli/src/update-check.js').UpdateInfo
