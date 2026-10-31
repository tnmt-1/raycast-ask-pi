# Ask Pi for Raycast の仕組みと開発

使い方は [README.md](README.md) を参照してください。

## Pi の呼び出し方

選んだプロジェクトのディレクトリをカレントディレクトリにして、次のように Pi を起動します。

```sh
pi --mode json --session-id <UUID> [--model <モデル>] [--thinking <レベル>] --tools read,grep,find,ls,web_search,fetch_content --no-mcp
```

- `--mode json` で、Pi は処理の途中経過を JSONL のイベントとして標準出力に書き、終わると終了します。Extension はこのイベントを読み、本文の差分、ツールの実行、リトライ、エラーを画面に反映します。
- `--session-id` は、指定した ID のセッションを開き、なければ作ります。新しいセッションでは Extension が UUID を発行し、続けるときは同じ ID を渡します。
- `--model` と `--thinking` は、フォームで選んだときだけ渡します。渡さなければ、Pi の設定の既定値を使います。
- `--tools` と `--no-mcp` で、Pi が使えるツールを、ファイルを読むツールと Web を検索・取得するツールに限ります。ファイルの編集や書き込み、コマンドの実行、MCP のツールは使えません。
- 過去のやり取りは、`pi --mode rpc --session-id <ID>` を起動して `get_messages` コマンドを1回だけ送り、その応答から取り出します。Pi のセッションファイルを Extension が直接読むことはありません。
- プロンプトは標準入力から渡します。コマンドライン引数に入れないので、`-` で始まる文や `@` で始まる語、改行、引用符を含んでいても、オプションやファイル参照として解釈されません。
- プロセスは `child_process.spawn` に引数の配列を渡し、`shell: false` で起動します。シェルを通さないので、プロンプトやパスがシェルに解釈されることはありません。
- キャンセルでは `SIGTERM` を送り、3秒たっても終わらなければ `SIGKILL` を送ります。

## 構成

```
src/
  ask-agent.tsx            コマンド「Ask Pi」
  manage-projects.tsx      コマンド「Manage Agent Projects」
  components/
    PromptForm.tsx         プロジェクト、モデル、thinking、セッション、プロンプトの入力
    ProjectSelector.tsx    プロジェクトのドロップダウン
    ProjectForm.tsx        プロジェクトの追加
    ConversationView.tsx   会話の一覧、回答の表示、追加の質問
  agents/
    index.ts               エージェントの生成
    pi.ts                  Pi の実行
    pi-events.ts           Pi の JSON イベントの解釈
  services/
    process-runner.ts      プロセスの起動、JSONL の行分割、キャンセル
    sessions.ts            セッション一覧の操作
    projects.ts            プロジェクトファイルの読み込みと統合
    transcript.ts          会話を Markdown にする
    env.ts                 PATH の補完と ~ の展開
    pi-settings.ts         Pi の settings.json から enabledModels を読む
  hooks.ts                 LocalStorage と設定の読み書き
  types.ts                 Agent、Project、SessionRecord などの型
```

UI は `Agent` インターフェース（`types.ts`）の `run()` だけを呼びます。エージェント固有の処理は `agents/` にまとめています。

## 保存するデータ

- プロジェクト：Raycast で登録したものは、Raycast の LocalStorage に保存します。
- セッション：Extension が作ったセッションの ID、タイトル（最初のプロンプトの1行目）、更新日時を、プロジェクトごとに LocalStorage に保存します。

## 読むファイルと環境変数

- 環境変数は Raycast のプロセスのものをそのまま Pi に渡し、`PATH` だけを補います。
- Pi の `settings.json` からは `enabledModels` だけを使います。`settings.json` は `PI_CODING_AGENT_DIR`、なければ `~/.pi/agent` の下から読みます。

## 開発

```sh
npm test           # vitest でのユニットテスト
npm run typecheck
npm run lint       # ESLint と Prettier
npm run build
```

テストでは本物の Pi の代わりに、JSONL を出力するだけの小さなスクリプトを使います。Pi やモデルのプロバイダーには接続しません。
