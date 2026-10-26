/**
 * PrimeDrive の「ダウンロードリンクを発行しました」画面の表示内容を解析する。
 *
 * 表示例：
 *   対象名: 20261026-091500-AB12 (9B)
 *   ダウンロードリンク: https://primedrive.jp/v2/access?key=XXXX
 *   有効期限: 2026/11/02 09:16
 *   ダウンロード回数: 30
 */
export function parseIssueResult(text) {
  const get = (label) => {
    const m = String(text).match(new RegExp(label + '\\s*[:：]\\s*(.+)'));
    return m ? m[1].trim() : null;
  };
  const target = get('対象名');
  const url = get('ダウンロードリンク');
  const expires = get('有効期限');
  const count = get('ダウンロード回数');
  if (!url || !/^https:\/\/\S+$/.test(url)) throw new Error('発行結果からダウンロードリンクを読み取れません。');
  if (!expires) throw new Error('発行結果から有効期限を読み取れません。');
  return {
    targetName: target ? target.replace(/\s*\([^)]*\)\s*$/, '') : null,
    url,
    expiresAt: parseJstDateTime(expires),
    downloadCount: count && /^\d+$/.test(count) ? Number(count) : count
  };
}

/** "2026/11/02 09:16" を日本時間として ISO 8601 文字列にする。 */
export function parseJstDateTime(s) {
  const m = String(s).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) throw new Error('日時の形式が想定外です：' + s);
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${m[5]}:00+09:00`;
}

/** 発行された有効期限が、指定日数どおりか（前後 1 日の誤差は許容）を確認する。 */
export function checkExpiry(expiresAtIso, expiryDays, now = new Date()) {
  const diffDays = (new Date(expiresAtIso).getTime() - now.getTime()) / 86400000;
  if (Math.abs(diffDays - expiryDays) > 1) {
    throw new Error(`有効期限が指定（${expiryDays} 日）と異なります：${expiresAtIso}`);
  }
}

/** Windows・PrimeDrive で扱えないファイル名を拒否する。 */
export function assertSafeFileName(name) {
  if (!name || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || /^\.+$/.test(name) || /[. ]$/.test(name)) {
    throw new Error('扱えないファイル名です：' + name);
  }
}
