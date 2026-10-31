# Local Coding Agent（Raycast Extension）

Raycast から、ローカルで動くコーディングエージェントにプロンプトを送り、回答を Raycast の中で読むための Extension です。ターミナルを開かずに、質問から回答の確認、追加の質問まで済ませられます。

初期の対応エージェントは [Pi](https://pi.dev) です。

## 前提

- macOS と Raycast 2.x
- Node.js 22.22.2 以降（Raycast の CLI が要求するバージョン）
- Pi CLI がインストール済みで、ターミナルから `pi` を実行できること
- Pi のプロバイダーと認証の設定が済んでいること

Extension は Pi の既存の設定と認証をそのまま使います。API キーを Extension に入力する必要はありません。

## セットアップ

```sh
cd raycast-local-agent
npm install
npm run dev
```

`npm run dev`（`ray develop`）を実行すると、Raycast に開発版の Extension が登録されます。

### Pi CLI の場所を設定する

Raycast から起動したプロセスには、シェルの `PATH` が引き継がれません。Pi の起動スクリプトは内部で `node` を呼ぶため、`pi` と `node` の両方が見つかるように設定します。

1. ターミナルで `which pi` と `which node` を実行し、場所を確かめます。
2. Raycast で「Ask Local Agent」を選び、`⌘ ,` で Extension の設定を開きます。
3. 次の2つを設定します。

| 設定            | 内容                                                       | 既定値                                                       |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| Pi CLI Path     | `pi` の絶対パス、またはコマンド名                          | `pi`                                                         |
| Additional PATH | 実行時に `PATH` の先頭へ追加するディレクトリ（`:` 区切り） | `~/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin` |

Additional PATH の既定値には、mise の shims と Homebrew の標準のインストール先を入れています。「Command not found」と表示されたら、この2つを見直してください。

### プロジェクトを登録する

作業ディレクトリは登録したプロジェクトから選びます。登録の方法は2つあり、両方を併用できます。

- Raycast で登録する：「Manage Agent Projects」で `⌘ N` を押してディレクトリを選びます。「Ask Local Agent」のフォームで `⌘ ⇧ N` を押しても登録できます。登録内容は Raycast の LocalStorage に保存されます。
- JSON ファイルに書く：設定の Projects File に指定したファイル（既定は `~/.config/raycast-local-agent/projects.json`）にプロジェクトを列挙します。

```json
{
  "projects": [
    { "name": "tools", "path": "~/dev/tools" },
    { "name": "web-app", "path": "/Users/me/dev/web-app" }
  ]
}
```

`name` を省くとディレクトリ名を使います。同じパスが両方にある場合は、JSON ファイルの内容を優先します。JSON ファイルを書き換えたあとは、「Manage Agent Projects」で `⌘ R` を押すと読み直します。

### そのほかの設定

| 設定                      | 内容                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Default Agent             | フォームを開いたときに選ばれているエージェント                                                       |
| Default Working Directory | フォームを開いたときに選ばれているプロジェクトのパス。登録済みのプロジェクトと一致する必要があります |

フォームでは前回使ったプロジェクトを Default Working Directory より優先して選びます。

## 使い方

1. Raycast で「Ask Local Agent」を開きます。
2. プロジェクトを選びます。
3. セッションを選びます。既定では、そのプロジェクトで最後に使ったセッションを続けます。新しく始めるときは「New session」を選ぶか、`⌘ N` を押します。
4. プロンプトを入力して `⌘ Enter` で実行します。
5. 会話の画面に移ります。左に自分のプロンプトの一覧（新しいものが上）、右にエージェントの回答が Markdown で表示されます。回答は届いた順に伸び、実行中は回答の下に進捗（実行中のツールなど）が出ます。
6. 追加で質問するときは、画面上部の検索バーにプロンプトを入力して Enter で送ります。検索バーは1行のみです。

左の一覧で前のプロンプトを選ぶと、そのときの回答を見られます。

既存のセッションを続けるときは、送る前にそのセッションの過去のプロンプトと回答を Pi から読み込み、一覧の下の「Earlier in …」に表示します。読み込みには数秒かかります。

### 会話の画面の操作

| 操作                         | ショートカット |
| ---------------------------- | -------------- |
| 追加の質問を送る             | `Enter`        |
| 実行を止める                 | `⌃ C`          |
| 選んだ回答をコピーする       | `⌘ ⇧ C`        |
| 選んだプロンプトをコピーする | `⌘ ⌥ C`        |
| 会話全体をコピーする         | `⌘ ⇧ T`        |
| 最後のプロンプトを再実行する | `⌘ R`          |
| 新しいセッションを始める     | `⌘ N`          |
| セッション ID をコピーする   | `⌘ ⌥ I`        |

実行中に Raycast を閉じたり、前の画面に戻ったりすると、エージェントのプロセスを止めます。止めたときも、それまでの会話は Pi のセッションに残っており、同じセッションを選べば続きから質問できます。

### セッション

Extension は自分で作ったセッションの ID、タイトル（最初のプロンプトの1行目）、更新日時を、プロジェクトごとに LocalStorage に保存します。Pi で直接作ったセッションは一覧に出ません。

フォームの「Remove Session from List」（`⌃ X`）は一覧から外すだけで、Pi のセッションファイルは消しません。

## 仕組み

### Pi の呼び出し方

選んだプロジェクトのディレクトリをカレントディレクトリにして、次のように Pi を起動します。

```sh
pi --mode json --session-id <UUID>
```

- `--mode json` で、Pi は処理の途中経過を JSONL のイベントとして標準出力に書き、終わると終了します。Extension はこのイベントを読み、本文の差分、ツールの実行、リトライ、エラーを画面に反映します。
- `--session-id` は、指定した ID のセッションを開き、なければ作ります。新しいセッションでは Extension が UUID を発行し、続けるときは同じ ID を渡します。
- 過去のやり取りは、`pi --mode rpc --session-id <ID>` を起動して `get_messages` コマンドを1回だけ送り、その応答から取り出します。Pi のセッションファイルを Extension が直接読むことはありません。
- プロンプトは標準入力から渡します。コマンドライン引数に入れないので、`-` で始まる文や `@` で始まる語、改行、引用符を含んでいても、オプションやファイル参照として解釈されません。
- プロセスは `child_process.spawn` に引数の配列を渡し、`shell: false` で起動します。シェルを通さないので、プロンプトやパスがシェルに解釈されることはありません。
- キャンセルでは `SIGTERM` を送り、3秒たっても終わらなければ `SIGKILL` を送ります。

### 構成

```
src/
  ask-agent.tsx            コマンド「Ask Local Agent」
  manage-projects.tsx      コマンド「Manage Agent Projects」
  components/
    PromptForm.tsx         エージェント、プロジェクト、セッション、プロンプトの入力
    ProjectSelector.tsx    プロジェクトのドロップダウン
    ProjectForm.tsx        プロジェクトの追加
    ConversationView.tsx   会話の一覧、回答の表示、追加の質問
  agents/
    index.ts               エージェントの一覧と生成
    pi.ts                  Pi の実行
    pi-events.ts           Pi の JSON イベントの解釈
  services/
    process-runner.ts      プロセスの起動、JSONL の行分割、キャンセル
    sessions.ts            セッション一覧の操作
    projects.ts            プロジェクトファイルの読み込みと統合
    transcript.ts          会話を Markdown にする
    env.ts                 PATH の補完と ~ の展開
  hooks.ts                 LocalStorage と設定の読み書き
  types.ts                 Agent、Project、SessionRecord などの型
```

UI は `Agent` インターフェース（`types.ts`）の `run()` だけを呼びます。エージェント固有の処理は `agents/` にまとめています。

### エージェントを追加する

Claude Code などを追加するときは、次の3か所を変えます。

1. `agents/` に、`Agent` を返す関数（例：`createClaudeCodeAgent`）を作ります。`run()` では、`onUpdate` で途中経過を通知し、`RunResult` を返します。プロセスの起動には `services/process-runner.ts` の `runProcess` を使えます。
2. `types.ts` の `AgentId` に ID を足し、`agents/index.ts` の `AGENT_CHOICES` と `createAgent` に登録します。
3. `package.json` の `defaultAgent` の選択肢と、必要なら CLI のパスの設定を足します。

## 安全性

- Extension は Pi を起動するだけで、プロンプトやソースコードをほかのサービスへ送る処理を持ちません。
- 環境変数は Raycast のプロセスのものをそのまま Pi に渡し、`PATH` だけを補います。環境変数の値を画面やログに出したり、保存したりしません。
- Extension が中身を読むファイルは、プロジェクトの JSON ファイルだけです。
- Extension 自身はファイルを削除しません。プロジェクトやセッションを一覧から外す操作では、確認のダイアログを出します。
- エージェントがプロジェクトの中でファイルを編集したり、コマンドを実行したりするかどうかは、Pi の設定と権限に従います。

## 開発

```sh
npm test           # vitest でのユニットテスト
npm run typecheck  # tsc --noEmit
npm run lint       # ray lint（ESLint と Prettier）
npm run build      # ray build
```

テストでは本物の Pi の代わりに、JSONL を出力するだけの小さなスクリプトを使います。Pi やモデルのプロバイダーには接続しません。
