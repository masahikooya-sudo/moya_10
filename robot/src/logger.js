import fs from 'node:fs';
import path from 'node:path';

/** 画面とログファイル（日付ごと）へ出力する。パスワード等は渡さないこと。 */
export function createLogger(logDir) {
  return (message) => {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const line = `[${jst}] ${message}`;
    console.log(line);
    if (logDir) {
      fs.appendFileSync(path.join(logDir, `robot-${jst.slice(0, 10)}.log`), line + '\n');
    }
  };
}
