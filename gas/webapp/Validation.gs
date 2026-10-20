/**
 * 誤送信防止のための入力チェック。
 * GAS のサービスに依存しない純粋関数のみを置く（test/validation.test.js で検証）。
 */

var FREE_MAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.co.jp', 'ymail.ne.jp', 'yahoo.com',
  'outlook.com', 'outlook.jp', 'hotmail.com', 'hotmail.co.jp', 'live.jp',
  'icloud.com', 'me.com', 'mac.com', 'docomo.ne.jp', 'ezweb.ne.jp',
  'au.com', 'softbank.ne.jp', 'i.softbank.jp', 'nifty.com', 'aol.com'
];

var BLOCKED_EXTENSIONS = ['exe', 'bat', 'cmd', 'com', 'scr', 'js', 'vbs', 'ps1', 'msi', 'lnk'];

var LIMITS = {
  MAX_RECIPIENTS: 10,
  MAX_FILES: 10,
  MAX_TOTAL_BYTES: 30 * 1024 * 1024,
  MIN_EXPIRY_DAYS: 1,
  MAX_EXPIRY_DAYS: 14
};

/** カンマ・セミコロン・空白・改行区切りのアドレス文字列を配列にする（小文字化・重複除去）。 */
function parseAddressList(text) {
  if (!text) return [];
  var seen = {};
  return String(text)
    .split(/[,;\s]+/)
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(function (s) {
      if (!s || seen[s]) return false;
      seen[s] = true;
      return true;
    });
}

function isValidEmail(addr) {
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(addr);
}

function domainOf(addr) {
  var i = addr.lastIndexOf('@');
  return i < 0 ? '' : addr.slice(i + 1).toLowerCase();
}

function levenshtein(a, b) {
  var prev = [];
  for (var j = 0; j <= b.length; j++) prev[j] = j;
  for (var i = 1; i <= a.length; i++) {
    var cur = [i];
    for (var k = 1; k <= b.length; k++) {
      cur[k] = Math.min(
        prev[k] + 1,
        cur[k - 1] + 1,
        prev[k - 1] + (a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 登録済みドメインのうち、タイプミスと思われる近いものを返す（無ければ null）。 */
function suggestDomain(domain, knownDomains) {
  var best = null;
  var bestDist = 3;
  knownDomains.forEach(function (d) {
    var dist = levenshtein(domain, d);
    if (dist > 0 && dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  });
  return best;
}

function extensionOf(fileName) {
  var i = fileName.lastIndexOf('.');
  return i < 0 ? '' : fileName.slice(i + 1).toLowerCase();
}

/**
 * 申請内容を検証する。
 * @param {Object} input {company, to, cc, subject, body, purpose, approver, expiryDays, files:[{name,size}]}
 * @param {Object} ctx   {applicant, internalDomain, clients:[{name, domains:[]}], approvers:[email]}
 * @return {{errors:string[], warnings:string[], to:string[], cc:string[]}}
 */
function validateRequest(input, ctx) {
  var errors = [];
  var warnings = [];
  var to = parseAddressList(input.to);
  var cc = parseAddressList(input.cc);
  var internalDomain = String(ctx.internalDomain || '').toLowerCase();

  var client = null;
  ctx.clients.forEach(function (c) {
    if (c.name === input.company) client = c;
  });
  if (!client) errors.push('取引先がマスタに登録されていません：' + (input.company || '(未選択)'));

  if (to.length === 0) errors.push('宛先(To)を入力してください。');
  if (to.length + cc.length > LIMITS.MAX_RECIPIENTS) {
    errors.push('宛先は To/Cc 合わせて ' + LIMITS.MAX_RECIPIENTS + ' 件までです。');
  }

  var allKnownDomains = [];
  ctx.clients.forEach(function (c) { allKnownDomains = allKnownDomains.concat(c.domains); });

  function checkAddress(addr, field) {
    if (!isValidEmail(addr)) {
      errors.push(field + ' のアドレス形式が不正です：' + addr);
      return;
    }
    var d = domainOf(addr);
    if (d === internalDomain) {
      if (field === 'To') warnings.push('To に社内アドレスが含まれています：' + addr);
      return;
    }
    if (client && client.domains.indexOf(d) < 0) {
      var hint = suggestDomain(d, client.domains);
      var otherClient = null;
      ctx.clients.forEach(function (c) {
        if (c !== client && c.domains.indexOf(d) >= 0) otherClient = c.name;
      });
      var msg = field + ' のドメイン「' + d + '」は取引先「' + client.name + '」の登録ドメインではありません。';
      if (otherClient) msg += '（別の取引先「' + otherClient + '」のドメインです）';
      else if (hint) msg += '（「' + hint + '」の入力ミスではありませんか？）';
      errors.push(msg);
    }
    if (FREE_MAIL_DOMAINS.indexOf(d) >= 0) {
      warnings.push('フリーメールアドレスが含まれています：' + addr);
    }
  }
  to.forEach(function (a) { checkAddress(a, 'To'); });
  cc.forEach(function (a) { checkAddress(a, 'Cc'); });
  to.forEach(function (a) {
    if (cc.indexOf(a) >= 0) warnings.push('To と Cc に同じアドレスがあります：' + a);
  });

  if (!input.subject || !String(input.subject).trim()) errors.push('件名を入力してください。');
  if (!input.body || !String(input.body).trim()) errors.push('本文を入力してください。');
  if (!input.purpose || !String(input.purpose).trim()) errors.push('送付目的を入力してください（承認者が判断に使います）。');
  if (/パスワード\s*[:：]\s*\S+/.test(input.body || '')) {
    errors.push('本文にパスワードを書かないでください。パスワードは別の下書きで自動作成されます。');
  }

  if (!input.approver) {
    errors.push('承認者を選択してください。');
  } else if (String(input.approver).toLowerCase() === String(ctx.applicant).toLowerCase()) {
    errors.push('自分自身を承認者にすることはできません。');
  } else if (ctx.approvers.map(function (a) { return a.toLowerCase(); })
      .indexOf(String(input.approver).toLowerCase()) < 0) {
    errors.push('承認者マスタに登録されていない承認者です：' + input.approver);
  }

  var days = Number(input.expiryDays);
  if (!(days >= LIMITS.MIN_EXPIRY_DAYS && days <= LIMITS.MAX_EXPIRY_DAYS && Math.floor(days) === days)) {
    errors.push('有効期限は ' + LIMITS.MIN_EXPIRY_DAYS + '〜' + LIMITS.MAX_EXPIRY_DAYS + ' 日で指定してください。');
  }

  var files = input.files || [];
  if (files.length === 0) errors.push('送付ファイルを選択してください。');
  if (files.length > LIMITS.MAX_FILES) errors.push('ファイルは ' + LIMITS.MAX_FILES + ' 個までです。');
  var total = 0;
  files.forEach(function (f) {
    total += Number(f.size) || 0;
    if (BLOCKED_EXTENSIONS.indexOf(extensionOf(f.name)) >= 0) {
      errors.push('送付できない種類のファイルです：' + f.name);
    }
  });
  if (total > LIMITS.MAX_TOTAL_BYTES) errors.push('ファイルの合計サイズは 30MB までです。');

  // 他の取引先名がファイル名・件名・本文に含まれていないか（取り違え防止）
  if (client) {
    ctx.clients.forEach(function (c) {
      if (c === client || !c.name || client.name.indexOf(c.name) >= 0) return;
      files.forEach(function (f) {
        if (f.name.indexOf(c.name) >= 0) {
          warnings.push('ファイル名に別の取引先名「' + c.name + '」が含まれています：' + f.name);
        }
      });
      if (String(input.subject || '').indexOf(c.name) >= 0 || String(input.body || '').indexOf(c.name) >= 0) {
        warnings.push('件名または本文に別の取引先名「' + c.name + '」が含まれています。');
      }
    });
  }

  return { errors: errors, warnings: warnings, to: to, cc: cc };
}

if (typeof module !== 'undefined') {
  module.exports = {
    parseAddressList: parseAddressList,
    isValidEmail: isValidEmail,
    domainOf: domainOf,
    levenshtein: levenshtein,
    suggestDomain: suggestDomain,
    validateRequest: validateRequest,
    LIMITS: LIMITS
  };
}
