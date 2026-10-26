/**
 * 動作確認：申請システムを使わずに、PrimeDrive 上で
 *   フォルダ作成 → ダミーファイル 2 件アップロード → パスワード付きリンク発行 → 確認 → ごみ箱へ移動
 * を一通り実行する。導入時や PrimeDrive の画面更新後の確認に使う。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from './config.js';
import { PrimeDrive } from './primedrive.js';
import { checkExpiry } from './issueResult.js';
import { createLogger } from './logger.js';

const cfg = loadConfig({ needApi: false });
fs.mkdirSync(cfg.logDir, { recursive: true });
const log = createLogger(cfg.logDir);
const folder = 'SELFTEST-' + new Date().toISOString().replace(/\D/g, '').slice(0, 14);
// 申請システムと同じ文字種のパスワード
const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789#$%&+-=?@';
const password = Array.from(crypto.randomBytes(12), (b) => charset[b % charset.length]).join('') + 'A2#a';

const dir = path.join(cfg.workDir, folder);
fs.mkdirSync(dir, { recursive: true });
const files = ['動作確認1.txt', 'selftest 2.txt'].map((name, i) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `動作確認用ファイル ${i + 1}\n`);
  return { name, path: p };
});

const pd = new PrimeDrive(cfg.primedrive, { channel: cfg.browserChannel, headless: cfg.headless, log });
let ok = false;
try {
  await pd.start();
  await pd.login();
  await pd.openPath(cfg.primedrive.baseFolder);
  await pd.createFolder(folder);
  await pd.openPath([...cfg.primedrive.baseFolder, folder]);
  await pd.upload(files);
  await pd.openPath(cfg.primedrive.baseFolder);
  const link = await pd.issueLink(folder, { days: 3, password, downloadCount: cfg.downloadCount });
  checkExpiry(link.expiresAt, 3);
  await pd.verifyLink(link.url, password, files.map((f) => f.name));
  ok = true;
} catch (e) {
  const shot = path.join(cfg.logDir, `selftest-error-${Date.now()}.png`);
  await pd.screenshot(shot);
  log('動作確認に失敗しました：' + e.message + '（画面：' + shot + '）');
} finally {
  try {
    await pd.openPath(cfg.primedrive.baseFolder);
    if (await pd.exists([...cfg.primedrive.baseFolder, folder])) await pd.trash(folder);
  } catch (e) {
    log('後片付けに失敗しました。PrimeDrive 上の ' + folder + ' を手動で削除してください：' + e.message);
  }
  await pd.logout();
  await pd.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
log(ok ? '動作確認 OK' : '動作確認 NG');
process.exitCode = ok ? 0 : 1;
