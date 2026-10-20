# Power Automate Desktop フロー：PrimeDrive 送付キー発行

承認済みの申請を API から 1 件ずつ取り出し、PrimeDrive にファイルをアップロードして
**リンクパスワード付きの送付キー（ダウンロードリンク）** を発行し、URL を API に返します。

> PrimeDrive の画面要素（ボタン・入力欄）は契約環境の画面に合わせて **PAD のレコーダーで記録** してください。
> 下記の Robin コードは API 連携部分の参考実装です。UI 操作部分は手順として記載しています。

## 前提

| 項目 | 内容 |
|---|---|
| 実行 PC | ロボット専用の Windows PC（無人実行なら Power Automate の無人 RPA ライセンス） |
| PrimeDrive アカウント | ロボット専用アカウント。**ファイル送付を許可するのはこのアカウントだけ**にする（後述） |
| ステージングフォルダ | Google ドライブ for デスクトップで同期（例：`G:\共有ドライブ\外部送付ステージング`） |
| 資格情報 | PrimeDrive のログイン情報・`ROBOT_TOKEN` はフローに直書きせず、Windows 資格情報マネージャーまたは Power Automate の資格情報（Azure Key Vault）から取得 |
| 起動 | Power Automate クラウドフローのスケジュール（例：5 分ごと）、またはタスクスケジューラ |

## フロー変数

| 変数 | 例 | 説明 |
|---|---|---|
| `ApiUrl` | `https://script.google.com/macros/s/xxxx/exec` | gas/api のデプロイ URL |
| `RobotToken` | （資格情報から取得） | gas/api の `ROBOT_TOKEN` と同じ値 |
| `StagingRoot` | `G:\共有ドライブ\外部送付ステージング` | 同期先のローカルパス |
| `PrimeDriveUrl` | `https://xxxx.primedrive.jp/` | 契約環境のログイン URL |
| `UploadFolder` | `/外部送付` | PrimeDrive 上のアップロード先フォルダ |

## 処理の流れ

```
Main
 ├─ 1. ジョブ取得：POST {action:"queue", token}
 │     job が null なら終了
 ├─ 2. ファイル待機：%StagingRoot%\%requestId%\ に job.files がすべて揃うまで最大 10 分待つ
 ├─ 3. PrimeDrive 操作（エラー時は 6 へ）
 │     3-1. ブラウザ起動 → ログイン
 │     3-2. アップロード先フォルダに「申請ID」フォルダを作成し、ファイルをアップロード
 │     3-3. アップロードしたファイル（またはフォルダ）を選択 →「送付キー発行」
 │     3-4. 送付キー設定画面
 │           ・パスワード：job.password を入力（「パスワードを設定する」を ON）
 │           ・有効期限：今日 + job.expiryDays 日
 │           ・（任意）ダウンロード回数上限
 │           ・送付キーのメール送信は「しない」／PrimeDrive の Web メーラーは使わない
 │     3-5. 発行された送付キー URL を画面（またはクリップボード）から取得
 │     3-6. ログアウト → ブラウザを閉じる
 ├─ 4. 完了登録：POST {action:"complete", token, requestId, sendKeyUrl}
 ├─ 5. 1 に戻る（承認済みが無くなるまで繰り返す）
 └─ 6. エラー時：スクリーンショットを保存し POST {action:"fail", token, requestId, message}
```

### 注意点

- 送付キーの **メール送信機能は使わない** でください。メールは申請者本人が Gmail の下書きから送信します。
- 3-5 で取得した URL は API 側で `SENDKEY_URL_PREFIX` から始まるかを検証します。
- `queue` で取り出した申請は「送付キー発行中」になります。`PROCESSING_TIMEOUT_MIN`（既定 60 分）を過ぎても
  `complete`/`fail` が来なければ自動的に「発行エラー」に戻り、申請者に通知されます。
- パスワードはフローのログ・変数ダンプに残さないよう、PAD の「機密テキスト」として扱ってください。

## 参考：API 呼び出し部分（Robin）

```robin
# 1. ジョブ取得
Web.InvokeWebService.InvokeWebService Url: ApiUrl Method: Web.Method.Post Accept: $'''application/json''' ContentType: $'''application/json''' RequestBody: $'''{\"action\":\"queue\",\"token\":\"%RobotToken%\"}''' ConnectionTimeout: 60 FollowRedirection: True ClearCookies: False FailOnErrorStatus: True EncodeRequestBody: False UserAgent: $'''PAD''' Encoding: Web.Encoding.UTF8 AcceptUntrustedCertificates: False ResponseHeaders=> ResponseHeaders Response=> Response StatusCode=> StatusCode
Variables.ConvertJsonToCustomObject Json: Response CustomObject=> Res
IF Res['ok'] <> True THEN
    EXIT FUNCTION
END
IF IsEmpty(Res['job']) THEN
    EXIT FUNCTION
END
SET Job TO Res['job']

# 2. ファイル待機（job.files の各ファイルが存在するまで）
SET JobDir TO $'''%StagingRoot%\\%Job['folderName']%'''
LOOP FOREACH FileName IN Job['files']
    File.WaitForFile.WaitForFileToBeCreated File: $'''%JobDir%\\%FileName%''' FailOnTimeout: True Timeout: 600
END

# 3. PrimeDrive 操作（レコーダーで作成）… 結果を SendKeyUrl に格納

# 4. 完了登録
Web.InvokeWebService.InvokeWebService Url: ApiUrl Method: Web.Method.Post Accept: $'''application/json''' ContentType: $'''application/json''' RequestBody: $'''{\"action\":\"complete\",\"token\":\"%RobotToken%\",\"requestId\":\"%Job['requestId']%\",\"sendKeyUrl\":\"%SendKeyUrl%\"}''' ConnectionTimeout: 60 FollowRedirection: True ClearCookies: False FailOnErrorStatus: True EncodeRequestBody: False UserAgent: $'''PAD''' Encoding: Web.Encoding.UTF8 AcceptUntrustedCertificates: False Response=> Response StatusCode=> StatusCode
```

エラー処理は 3 のブロックを「エラー発生時」設定（On block error）で囲み、`fail` を呼び出してください。
`message` に含める例外メッセージは、`"` と改行を置換してから JSON に埋め込んでください。

> Apps Script の Web アプリは POST に対して 302 リダイレクトを返します。`FollowRedirection: True` を必ず指定してください。

## PrimeDrive 側の管理設定（必須）

この仕組みを迂回して送付キーが発行されないよう、PrimeDrive の管理者画面で次を設定してください。

1. **一般ユーザーのファイル送付（送付キー発行）を禁止**し、ロボット用アカウントのみ許可する。
2. ロボット用アカウントの PrimeDrive 標準の「送信時承認」は OFF にする
   （承認は申請アプリで実施済みのため。二重承認にする場合は ON のままにし、3-4 の後に承認待ちの処理を追加）。
3. 送付キーの既定有効期限・ダウンロード回数上限・パスワード必須を設定する。
4. 操作ログ（5 年保管）を定期的に確認し、申請アプリの監査ログと突合する。
