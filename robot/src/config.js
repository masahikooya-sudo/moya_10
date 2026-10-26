import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** robot/.env を読み込む（既に環境変数がある項目は上書きしない）。 */
export function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`設定 ${name} がありません（robot/.env を確認してください）。`);
  return v;
}

/**
 * @param {{needApi?: boolean}} opts selftest では API 設定を必須にしない
 */
export function loadConfig({ needApi = true } = {}) {
  loadDotEnv();
  const count = process.env.DOWNLOAD_COUNT ? Number(process.env.DOWNLOAD_COUNT) : null;
  if (count !== null && !(Number.isInteger(count) && count > 0)) {
    throw new Error('DOWNLOAD_COUNT は正の整数で指定してください。');
  }
  return {
    apiUrl: needApi ? required('API_URL') : process.env.API_URL,
    robotToken: needApi ? required('ROBOT_TOKEN') : process.env.ROBOT_TOKEN,
    primedrive: {
      url: process.env.PRIMEDRIVE_URL || 'https://primedrive.jp/v2/browse',
      corpId: required('PRIMEDRIVE_CORP_ID'),
      loginId: required('PRIMEDRIVE_LOGIN_ID'),
      password: required('PRIMEDRIVE_PASSWORD'),
      baseFolder: (process.env.PRIMEDRIVE_BASE_FOLDER || '外部送付').split('/').filter(Boolean)
    },
    downloadCount: count,
    browserChannel: process.env.BROWSER_CHANNEL || undefined,
    headless: process.env.HEADLESS !== 'false',
    logDir: path.resolve(ROOT, process.env.LOG_DIR || './logs'),
    workDir: path.resolve(ROOT, './work')
  };
}
