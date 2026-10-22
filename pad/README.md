# Power Automate Desktop フロー：PrimeDrive 送付キー発行

承認済みの申請を API から 1 件ずつ取り出し、PrimeDrive にファイルをアップロードして
**リンクパスワード付きの送付キー（ダウンロードリンク）** を発行し、URL を API に返します。

| ファイル | 内容 |
|---|---|
| [flow.robin.txt](flow.robin.txt) | PAD に貼り付けるフロー本体 |
| [作成手順.md](作成手順.md) | 貼り付け方、変数・資格情報の設定、ブラウザー拡張の導入、試運転の手順 |
| [画面調査.md](画面調査.md) | PrimeDrive の画面ごとの説明とセレクター一覧 |
| [LoadCredentials.ps1](LoadCredentials.ps1) | 資格情報を読み出す PowerShell（LoadCredentials で使う。貼り付けで不明なアクションになったときに手で入れ直す用） |

PrimeDrive の操作は、すべて **「Web ページで JavaScript 関数を実行」** で書いています（UI 要素リポジトリは使いません）。
キー操作は、ファイル選択ダイアログを開く Enter と、パスの貼り付けだけです。
JavaScript は実際の PrimeDrive 画面（Web 版 v43.0.7）で同じコードを動かして確認済みです。
PAD のフロー定義（Robin テキスト）は PAD 上では検証できていないため、**初回の試運転で微修正が必要になる場合があります**。

## 前提

| 項目 | 内容 |
|---|---|
| 実行 PC | ロボット専用の Windows PC（ロボット専用の Windows ユーザー推奨）。Microsoft Edge と PAD のブラウザー拡張 |
| PAD | 無償版を想定。スケジュール実行はないので、**担当者が手動で実行**する。承認済みがなくなるまで繰り返して自動で終わる |
| PrimeDrive アカウント | ロボット専用アカウント。**ファイル送付を許可するのはこのアカウントだけ**にする（後述） |
| ステージングフォルダ | Google ドライブ for デスクトップで同期（例：`G:\共有ドライブ\外部送付ステージング`） |
| 資格情報 | PrimeDrive のログイン情報と `ROBOT_TOKEN` は、フローに直接書かず、Windows 資格情報マネージャー（Web 資格情報 `PADRobot`）に保存し、PowerShell で読み出す |

## フロー変数（Main 先頭の設定）

| 変数 | 例 | 説明 |
|---|---|---|
| `ApiUrl` | `https://script.google.com/macros/s/xxxx/exec` | gas/api のデプロイ URL |
| `StagingRoot` | `G:\共有ドライブ\外部送付ステージング` | 同期先のローカルパス |
| `PrimeDriveUrl` | `https://primedrive.jp/v2/browse` | ログイン URL |
| `UploadFolder` | `外部送付` | PrimeDrive のホームからのアップロード先（`/` 区切り） |
| `MaxDownloads` | `10` | 送付キーのダウンロード回数の上限 |
| `ErrorShotDir` | `C:\PAD\PrimeDrive\errors` | エラー時のスクリーンショット保存先 |

## 処理の流れ

```
Main
 ├─ 0. 資格情報を読み込む（資格情報マネージャー → PowerShell）
 ├─ 1. ジョブ取得：POST {action:"queue", token}
 │     job が null なら終了
 ├─ 2. ファイル待機：%StagingRoot%\%folderName%\ に job.files がすべて揃うまで最大 10 分待つ
 ├─ 3. PrimeDrive 操作（エラー時は 6 へ）
 │     3-1. Edge 起動 → ログイン
 │     3-2. UploadFolder に「申請ID」フォルダを作成（同名があれば _2, _3 …）し、ファイルを 1 件ずつアップロード
 │     3-3. UploadFolder に戻り、申請 ID のフォルダを選択 →「ダウンロードリンク発行」
 │     3-4. ダウンロードリンク発行画面
 │           ・有効日数：job.expiryDays
 │           ・ダウンロード回数：MaxDownloads（「無制限」は OFF）
 │           ・リンクパスワード：job.password（「自動生成する」「ワンタイムパスワード」は OFF）
 │           ・「次へ」を押すと発行される（確認画面なし）
 │     3-5. 発行結果の本文（.ResultDetail）から URL と有効期限を取得し、
 │           送付方法（Gmail／メールソフト／PrimeDrive から送信）は選ばずに「閉じる」
 │     3-6. ログアウト → ブラウザを閉じる
 ├─ 4. 完了登録：POST {action:"complete", token, requestId, sendKeyUrl, keyExpiresAt}
 ├─ 5. 1 に戻る（承認済みがなくなるまで繰り返す。最大 MaxJobs 件）
 └─ 6. エラー時：スクリーンショットを保存し POST {action:"fail", token, requestId, message}
```

送付キーは **申請 ID のフォルダに対して 1 つ** 発行します。ファイルが複数あっても URL は 1 つで、
受信者は「一括ダウンロード」で ZIP として受け取ります。

### 注意点

- 送付キーの **メール送信機能は使わない** でください。メールは申請者本人が Gmail の下書きから送信します。
- 送付キー URL は `https://primedrive.jp/v2/access?key=…` の形式です。API 側で `SENDKEY_URL_PREFIX` から始まるかを検証するので、
  gas/api のスクリプトプロパティ `SENDKEY_URL_PREFIX` には **`https://primedrive.jp/v2/access?key=`** を設定してください。
- 送付キーの対象フォルダを削除・移動・名前変更すると、リンクは無効になります（E303）。発行後のフォルダは有効期限まで残してください。
- `queue` で取り出した申請は「送付キー発行中」になります。`PROCESSING_TIMEOUT_MIN`（既定 60 分）を過ぎても
  `complete`/`fail` が来なければ自動的に「発行エラー」に戻り、申請者に通知されます。
- リンクパスワードを含む変数は、PAD の変数ペインで「機密」にしてください（[作成手順.md](作成手順.md) 参照）。
- 実行中は PC を操作しないでください。ファイル選択ダイアログの操作だけはキー入力で行うためです。

## PrimeDrive 側の管理設定（必須）

この仕組みを迂回して送付キーが発行されないよう、PrimeDrive の管理者画面で次を設定してください。

1. **一般ユーザーのファイル送付（送付キー発行）を禁止**し、ロボット用アカウントのみ許可する。
2. ロボット用アカウントの PrimeDrive 標準の「送信時承認」は OFF にする
   （承認は申請アプリで実施済みのため。二重承認にする場合は ON のままにし、3-4 の後に承認待ちの処理を追加）。
3. 送付キーの既定有効期限・ダウンロード回数上限・パスワード必須を設定する。
   管理設定で上限を決めている場合は、申請アプリの有効日数の選択肢と `MaxDownloads` をその範囲内にしてください（範囲外だと入力エラーで発行エラーになります）。検証用アカウントでは「無期限」が選べない設定でした。
4. 操作ログ（5 年保管）を定期的に確認し、申請アプリの監査ログと突合する。
