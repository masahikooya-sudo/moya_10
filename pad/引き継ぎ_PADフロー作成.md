# 引き継ぎ：PrimeDrive 送付キー発行の PAD フロー作成

新しいセッションで、このファイルを読んでから作業を始めること。

## 目的

`pad/README.md` の設計に沿って、Power Automate Desktop（PAD）に貼り付けられるフロー（Robin テキスト）を作る。
PrimeDrive の画面は、この環境の Chromium と Playwright で実際に操作して調べ、確認済みのセレクターだけを使う。

## 環境（ユーザーが設定済み）

| 環境変数 | 内容 |
|---|---|
| `PRIMEDRIVE_URL` | `https://primedrive.jp/v2/browse` |
| `PRIMEDRIVE_CORP_ID` | コーポレートID |
| `PRIMEDRIVE_LOGIN_ID` | 検証用アカウントのユーザID |
| `PRIMEDRIVE_PASSWORD` | 検証用アカウントのパスワード |

- ネットワーク：`primedrive.jp` は接続可（`www.primedrive.jp` は不可だが、ログイン画面では未使用）。
- 値は **画面出力・ログ・コミットに絶対に出さない**。スクリーンショットにパスワードが写らないようにする。
- Playwright：`NODE_PATH=$(npm root -g)` でグローバルの `playwright` を使う（`playwright install` はしない）。
- 作業ファイル（スクリーンショット・調査スクリプト）はスクラッチパッドに置く。

## 判明済みのこと

ログイン画面（`/v2/browse` を開くと表示。通信先は primedrive.jp と Google Fonts のみ）

| 項目 | セレクター |
|---|---|
| コーポレートID | `input[name="corpId"]` |
| ユーザID | `input[name="userId"]` |
| パスワード | `input[name="password"]` |
| ログインボタン | `button.LoginButton` |

## やること

1. ログインし、画面ごとにスクリーンショットと主要要素（入力欄・ボタン・メニュー）を記録する。
2. テスト用フォルダの確認 → フォルダ作成 → ダミーファイル（中身「テスト」の .txt）アップロード。
3. 送付キー発行：パスワード設定・有効期限・（あれば）ダウンロード回数上限。発行後の URL の取得場所を特定する。
   - 送付キーのメール送信機能は使わない。
4. 発行 URL を開き、パスワードでダウンロードできることを確認する。
5. 後片付け：テスト送付キーの無効化、テストファイル・フォルダの削除、ログアウト。
6. 成果物を作ってコミット・プッシュ（ブランチ `claude/gallant-galileo-bg3uzq`）：
   - `pad/flow.robin.txt`：PAD に貼り付けるフロー。PrimeDrive 操作は可能な限り
     「Web ページで JavaScript 関数を実行」で書き、UI 要素リポジトリに依存しない。
     ファイル選択ダイアログのみキー入力で操作する。
   - `pad/作成手順.md`：貼り付け方、変数・資格情報の設定、ブラウザ拡張の導入、試運転手順。
   - `pad/画面調査.md`：画面ごとの説明とセレクター一覧（スクリーンショットは機微情報が写らないもののみ）。
   - `pad/README.md` の該当箇所を更新。
7. API 側（`gas/api/Code.gs`）の `SENDKEY_URL_PREFIX` に設定すべき値をユーザーに伝える。

## 前提として決まっていること

- 申請・承認・下書き作成は Google Apps Script で構築・デプロイ済み（ドメイン：pd-procurement.jp）。
- PAD は無償版を想定（スケジュール実行なし、担当者が手動で実行）。フローは承認済みがなくなるまで繰り返す。
- PAD の Robin テキストはこの環境では検証できない。初回の試運転で微修正が必要になる前提でユーザーに伝える。
