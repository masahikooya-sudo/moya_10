/**
 * 送付キー発行ロボット：承認済みの申請がなくなるまで、
 *   ファイル取得 → PrimeDrive へアップロード → パスワード付きリンク発行 → 確認 → 申請システムへ登録
 * を繰り返す。タスクスケジューラ等で定期実行する。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';
import { ApiClient } from './apiClient.js';
import { PrimeDrive } from './primedrive.js';
import { checkExpiry, assertSafeFileName } from './issueResult.js';
import { createLogger } from './logger.js';

const MAX_JOBS_PER_RUN = 20;
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;

/** 申請 1 件分の処理。成功時はリンク情報を返す。 */
async function processJob(job, { api, pd, cfg, log }) {
  const folder = job.folderName;
  assertSafeFileName(folder);
  job.files.forEach(assertSafeFileName);
  if (new Set(job.files).size !== job.files.length) throw new Error('同じ名前のファイルが複数あります。');

  // 1. ファイルを申請システムから取得
  const dir = path.join(cfg.workDir, folder);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const local = [];
  for (let i = 0; i < job.files.length; i++) {
    const f = await api.getFile(job.requestId, i);
    if (f.name !== job.files[i]) throw new Error('取得したファイル名が一致しません：' + f.name);
    const file = path.join(dir, f.name);
    fs.writeFileSync(file, Buffer.from(f.base64, 'base64'));
    local.push({ name: f.name, path: file });
  }
  log(`ファイルを取得しました（${local.length} 件）`);

  try {
    // 2. 申請 ID のフォルダを作成してアップロード（前回の途中分があれば削除＝リンクも無効化）
    await pd.openPath(cfg.primedrive.baseFolder);
    if (await pd.exists([...cfg.primedrive.baseFolder, folder])) {
      log('前回の処理途中のフォルダを削除します');
      await pd.trash(folder);
    }
    await pd.createFolder(folder);
    await pd.openPath([...cfg.primedrive.baseFolder, folder]);
    await pd.upload(local);
    const names = await pd.listNames();
    if (JSON.stringify([...names].sort()) !== JSON.stringify(local.map((f) => f.name).sort())) {
      throw new Error('アップロード後のファイルが一致しません：' + names.join(', '));
    }

    // 3. フォルダに対してパスワード付きダウンロードリンクを発行
    await pd.openPath(cfg.primedrive.baseFolder);
    const link = await pd.issueLink(folder, {
      days: job.expiryDays,
      password: job.password,
      downloadCount: cfg.downloadCount
    });
    if (link.targetName && link.targetName !== folder) throw new Error('発行対象が一致しません：' + link.targetName);
    checkExpiry(link.expiresAt, job.expiryDays);

    // 4. 未ログインのブラウザでパスワード必須・内容を確認
    await pd.verifyLink(link.url, job.password, local.map((f) => f.name));
    return link;
  } catch (e) {
    // 発行済みのリンクが残らないよう、フォルダごとごみ箱へ（失敗しても元のエラーを優先）
    try {
      await pd.openPath(cfg.primedrive.baseFolder);
      if (await pd.exists([...cfg.primedrive.baseFolder, folder])) await pd.trash(folder);
    } catch (cleanupError) {
      log('後片付けに失敗しました：' + cleanupError.message);
    }
    throw e;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function acquireLock(file) {
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < LOCK_STALE_MS) return false;
  } catch { /* ロックなし */ }
  fs.writeFileSync(file, String(process.pid));
  return true;
}

async function main() {
  const cfg = loadConfig();
  fs.mkdirSync(cfg.logDir, { recursive: true });
  const log = createLogger(cfg.logDir);
  const lockFile = path.join(os.tmpdir(), 'primedrive-sendkey-robot.lock');
  if (!acquireLock(lockFile)) {
    log('別のロボットが実行中のため終了します');
    return;
  }
  const api = new ApiClient(cfg.apiUrl, cfg.robotToken);
  let pd = null;
  let processed = 0;
  let failed = 0;
  try {
    for (let n = 0; n < MAX_JOBS_PER_RUN; n++) {
      const job = await api.nextJob();
      if (!job) break;
      log(`申請 ${job.requestId}（${job.company}）の処理を開始します`);
      try {
        if (!pd) {
          pd = new PrimeDrive(cfg.primedrive, { channel: cfg.browserChannel, headless: cfg.headless, log });
          await pd.start();
          await pd.login();
        }
        const link = await processJob(job, { api, pd, cfg, log });
        await api.complete(job.requestId, link.url, link.expiresAt);
        log(`申請 ${job.requestId}：完了しました`);
        processed++;
      } catch (e) {
        failed++;
        const shot = path.join(cfg.logDir, `error-${job.requestId}-${Date.now()}.png`);
        if (pd) await pd.screenshot(shot);
        log(`申請 ${job.requestId}：失敗しました：${e.message}（画面：${shot}）`);
        await api.fail(job.requestId, e.message).catch((e2) => log('失敗の登録に失敗しました：' + e2.message));
        // 画面の状態が不明なため、次の申請はログインからやり直す
        if (pd) { await pd.close(); pd = null; }
      }
    }
  } finally {
    if (pd) { await pd.logout(); await pd.close(); }
    fs.rmSync(lockFile, { force: true });
    log(`終了：成功 ${processed} 件、失敗 ${failed} 件`);
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
