# 送付キー発行ロボット（Node.js + Playwright）

承認済みの外部送付申請について、PrimeDrive の画面を自動操作して **パスワード付きダウンロードリンク（送付キー）** を発行し、
URL を申請システムに登録します。Power Automate Desktop の代わりに使います（無料・タスクスケジューラで自動実行可）。

## 処理の流れ（1 申請あたり）

1. 申請システム API から承認済みの申請を 1 件取り出す（このとき申請システムがリンクパスワードを生成）
2. 送付ファイルを API から取得
3. PrimeDrive にログインし、`外部送付` フォルダの下に **申請 ID のフォルダ** を作成してファイルをアップロード
4. そのフォルダに **リンクパスワード・有効日数付きのダウンロードリンク** を発行（PrimeDrive からのメール送信はしない）
5. 発行したリンクをログインしていない別のブラウザで開き、**パスワードが必須であること** と **ファイルが揃っていること** を確認
6. URL と有効期限を申請システムに登録 → 申請者が Gmail の下書きを作成

途中で失敗した場合は、作成したフォルダをごみ箱へ移動して（＝発行済みリンクも無効化）、申請を「発行エラー」にします。
申請者は申請画面から再実行できます。承認済みの申請がなくなるまで繰り返し、最後にログアウトします。

## 必要なもの

| 項目 | 内容 |
|---|---|
| PC | 常時起動の Windows 10/11 PC（サーバーでも可） |
| Node.js | 20 以上の LTS 版（https://nodejs.org/ja ） |
| ブラウザ | Microsoft Edge（Windows 標準。Playwright が操作に使用） |
| PrimeDrive | ロボット用アカウント（ホーム直下に `外部送付` フォルダを作成しておく） |
| ネットワーク | `primedrive.jp`、`script.google.com`、`script.googleusercontent.com` へ HTTPS 接続できること |

## セットアップ

```bat
rem 1. このフォルダ（robot）を PC に配置し、依存パッケージを導入
cd C:\primedrive-robot
npm install

rem 2. 設定ファイルを作成して編集
copy .env.example .env
notepad .env
```

`.env` の設定項目：

| 項目 | 内容 |
|---|---|
| `API_URL` | 申請システム API（gas/api）のデプロイ URL |
| `ROBOT_TOKEN` | gas/api のスクリプトプロパティ `ROBOT_TOKEN` と同じ値 |
| `PRIMEDRIVE_CORP_ID` / `PRIMEDRIVE_LOGIN_ID` / `PRIMEDRIVE_PASSWORD` | ロボット用アカウント |
| `PRIMEDRIVE_BASE_FOLDER` | 送付用フォルダ（既定 `外部送付`） |
| `DOWNLOAD_COUNT` | ダウンロード回数の上限（空欄なら PrimeDrive の既定値） |
| `BROWSER_CHANNEL` | `msedge`（既定） |
| `HEADLESS` | `false` にすると画面を表示して動作 |

`.env` にはパスワードが入るため、ロボットを実行する Windows ユーザーと管理者だけが読めるようにしてください。

```bat
icacls .env /inheritance:r /grant:r "%USERNAME%:R" /grant:r "Administrators:F"
```

社内プロキシ経由で通信する場合は、`HTTPS_PROXY` を設定し、`NODE_USE_ENV_PROXY=1` も設定してください
（Node.js 22.21 以降／24 以降で有効）。

### 動作確認（申請システムを使わずに PrimeDrive の操作だけを確認）

```bat
npm run selftest
```

フォルダ作成 → ダミーファイル 2 件アップロード → パスワード付きリンク発行 → 確認 → ごみ箱へ移動 までを実行し、
最後に `動作確認 OK` と表示されれば成功です。導入時と、PrimeDrive の画面が更新されたときに実行してください。

### 定期実行（タスクスケジューラ）

```bat
schtasks /create /tn "PrimeDrive送付キー発行" /tr "C:\primedrive-robot\run.bat" /sc minute /mo 5 /ru "%USERDOMAIN%\%USERNAME%" /rp
```

または「タスク スケジューラ」で次のように設定します。

- 全般：「ユーザーがログオンしているかどうかにかかわらず実行する」
- トリガー：毎日、5 分ごとに繰り返す（継続時間：無期限）
- 操作：`run.bat` を実行（開始フォルダに robot フォルダを指定）
- 設定：「タスクが既に実行中の場合：新しいインスタンスを開始しない」

同時に 2 つ起動しても、ロックファイルにより 2 つ目はすぐ終了します。

## ログ

- `logs/robot-YYYY-MM-DD.log`：処理の記録（パスワードは記録しません）
- `logs/error-<申請ID>-<時刻>.png`：失敗時の画面（ファイル名などが写るため、ログフォルダの閲覧権限に注意）

## 運用上の注意

- `外部送付` フォルダ内の申請フォルダを **移動・名前変更・削除しない** でください（ダウンロードリンクが無効になります）。
  逆に、誤送信時にリンクを止めたい場合は、そのフォルダを削除すれば確実に無効化できます。
- 削除したフォルダは PrimeDrive のごみ箱に残ります。定期的にごみ箱を空にしてください。
- PrimeDrive の発行画面にある「この発行条件をデフォルト値として保存する」は使いません（ロボットは毎回値を入力します）。
- PrimeDrive の画面が変わると動かなくなることがあります。その場合は `npm run selftest` で確認し、
  `src/primedrive.js` のセレクター（下表）を修正してください。

## PrimeDrive の画面要素（2026/10 時点で確認）

| 操作 | 要素 |
|---|---|
| ログイン | `input[name=corpId]` / `input[name=userId]` / `input[name=password]` / `button.LoginButton`（成功すると `button.UserButton` が表示） |
| フォルダ一覧の行 | `tr.ListViewItem[data-identifier="/HOME/外部送付/<名前>"]`（ダブルクリックで開く。選択は行の `td.CheckboxColumn` をクリック） |
| 新規フォルダ | `button.CommandNewFolder` → `.NewFolderDialog input[name=folderName]` → `button.ProceedButton` |
| アップロード | `button.CommandUpload` → `.FileUploadDialog .FileUploadAreaItem input[type=file]`（選ぶたびに欄が増える）→ `button.UploadStartButton` |
| リンク発行 | 行を選択 → `button.CommandSend` → `.AccessKeyIssueDialog`：`availableDays_input`（有効日数）、`downloadCount_input`（回数）、`downloadPassword_input`（パスワード）→ `button.ProceedButton` |
| 発行結果 | `.MailerSelectDialog .ResultDetail`（「ダウンロードリンク: https://primedrive.jp/v2/access?key=…」）→ `button.CloseTextButton` で閉じる |
| ごみ箱へ移動 | 行を選択 → `button.TrashButton` → `.DeletionConfirmDialog button.ProceedButton` |
| ログアウト | `button.UserButton` → メニュー「ログアウト」 |

画面操作で確認した注意点：

- 発行画面は開いた直後に前回の条件が読み込まれ入力値が上書きされるため、値が落ち着いてから入力する。
- 入力欄の検証結果は少し遅れて反映されるため、Tab でフォーカスを外し、エラー表示が消えるのを待ってから次へ進む。
- アップロードでパス指定を使うと、環境によって日本語のファイル名が受け付けられないため、ファイル内容を直接渡す。
