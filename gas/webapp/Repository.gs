/**
 * スプレッドシートの読み書き。
 * ※ gas/api/Repository.gs と同一内容を保つこと（両プロジェクトで同じシートを扱うため）。
 */

var SHEETS = {
  REQUESTS: '申請',
  APPROVERS: '承認者',
  CLIENTS: '取引先',
  AUDIT: '監査ログ'
};

var REQUEST_COLUMNS = [
  'requestId', 'status', 'createdAt', 'updatedAt',
  'applicant', 'approver', 'company', 'to', 'cc',
  'subject', 'body', 'purpose', 'expiryDays',
  'files', 'folderId', 'warnings',
  'decidedAt', 'approverComment',
  'robotLockedAt', 'sendKeyUrl', 'linkPassword', 'keyExpiresAt', 'issuedAt', 'errorMessage',
  'ticketHash', 'ticketExpiresAt', 'ticketUsed', 'draftedAt'
];

var STATUS = {
  PENDING: '承認待ち',
  APPROVED: '承認済み(発行待ち)',
  PROCESSING: '送付キー発行中',
  ISSUED: '送付キー発行済み',
  DRAFTED: '下書き作成済み',
  REJECTED: '差戻し',
  CANCELLED: '取下げ',
  ERROR: '発行エラー'
};

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('スクリプトプロパティ SPREADSHEET_ID が未設定です。');
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('シート「' + name + '」がありません。setupSheets() を実行してください。');
  return sheet;
}

/** 初回のみ実行：必要なシートとヘッダーを作成する。 */
function setupSheets() {
  var ss = getSpreadsheet_();
  var defs = {};
  defs[SHEETS.REQUESTS] = REQUEST_COLUMNS;
  defs[SHEETS.APPROVERS] = ['承認者メール', '氏名'];
  defs[SHEETS.CLIENTS] = ['取引先名', '許可ドメイン(カンマ区切り)', '有効(TRUE/FALSE)'];
  defs[SHEETS.AUDIT] = ['日時', '申請ID', '実行者', '操作', '詳細'];
  Object.keys(defs).forEach(function (name) {
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(defs[name]);
      sheet.setFrozenRows(1);
    }
  });
}

function rowToRequest_(row) {
  var r = {};
  REQUEST_COLUMNS.forEach(function (col, i) { r[col] = row[i]; });
  r.files = r.files ? JSON.parse(r.files) : [];
  r.warnings = r.warnings ? JSON.parse(r.warnings) : [];
  return r;
}

function requestToRow_(r) {
  return REQUEST_COLUMNS.map(function (col) {
    var v = r[col];
    if (col === 'files' || col === 'warnings') return JSON.stringify(v || []);
    if (v === undefined || v === null) return '';
    // 先頭が = + - @ の文字列は数式と解釈されるため、文字列として保存させる
    if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
    return v;
  });
}

function listRequests_(predicate) {
  var sheet = getSheet_(SHEETS.REQUESTS);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, REQUEST_COLUMNS.length).getValues();
  var result = [];
  values.forEach(function (row, i) {
    if (!row[0]) return;
    var r = rowToRequest_(row);
    r._row = i + 2;
    if (!predicate || predicate(r)) result.push(r);
  });
  return result;
}

function findRequest_(requestId) {
  var found = listRequests_(function (r) { return r.requestId === requestId; });
  if (found.length === 0) throw new Error('申請が見つかりません：' + requestId);
  return found[0];
}

function insertRequest_(r) {
  getSheet_(SHEETS.REQUESTS).appendRow(requestToRow_(r));
}

function saveRequest_(r) {
  r.updatedAt = new Date();
  getSheet_(SHEETS.REQUESTS)
    .getRange(r._row, 1, 1, REQUEST_COLUMNS.length)
    .setValues([requestToRow_(r)]);
}

/**
 * 状態遷移をロック付きで行う。現在の状態が expected に含まれない場合はエラー。
 * mutate(r) で値を書き換えた後に保存する。
 */
function transition_(requestId, expected, mutate) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var r = findRequest_(requestId);
    if (expected.indexOf(r.status) < 0) {
      throw new Error('現在の状態（' + r.status + '）ではこの操作はできません。');
    }
    mutate(r);
    saveRequest_(r);
    return r;
  } finally {
    lock.releaseLock();
  }
}

function listApprovers_() {
  var sheet = getSheet_(SHEETS.APPROVERS);
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues()
    .filter(function (row) { return row[0]; })
    .map(function (row) { return { email: String(row[0]).trim().toLowerCase(), name: String(row[1]) }; });
}

function listClients_() {
  var sheet = getSheet_(SHEETS.CLIENTS);
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues()
    .filter(function (row) { return row[0] && row[2] !== false && String(row[2]).toUpperCase() !== 'FALSE'; })
    .map(function (row) {
      return {
        name: String(row[0]).trim(),
        domains: String(row[1]).split(/[,\s]+/)
          .map(function (d) { return d.trim().toLowerCase().replace(/^@/, ''); })
          .filter(Boolean)
      };
    });
}

function audit_(requestId, actor, action, detail) {
  getSheet_(SHEETS.AUDIT).appendRow([new Date(), requestId, actor, action, detail || '']);
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');
}
