/**
 * 下書き本文の組み立てとリンクパスワード生成。
 * GAS のサービスに依存しない部分は test/maildraft.test.js で検証する。
 */

/** 本文テンプレートに送付キー情報を差し込む。{{URL}} が無ければ末尾に追記する。 */
function renderMailBody(body, url, expiresAtText) {
  var text = String(body);
  if (text.indexOf('{{URL}}') < 0) {
    text = text.replace(/\s*$/, '') + '\n\n' +
      '■ダウンロードURL\n' + url + '\n' +
      '■有効期限\n' + expiresAtText + '\n' +
      '※ダウンロード用パスワードは別メールにてお送りします。\n';
  } else {
    text = text.split('{{URL}}').join(url);
  }
  return text.split('{{有効期限}}').join(expiresAtText);
}

function renderPasswordMail(subject, company, password, expiresAtText) {
  return {
    subject: '【パスワードのお知らせ】' + subject,
    body: company + '\nご担当者様\n\n' +
      '先ほどお送りした「' + subject + '」のダウンロード用パスワードをお知らせいたします。\n\n' +
      '■パスワード\n' + password + '\n\n' +
      '■有効期限\n' + expiresAtText + '\n\n' +
      '本メールにお心当たりのない場合は、お手数ですが破棄のうえご連絡ください。\n'
  };
}

// 紛らわしい文字（0/O, 1/l/I）を除いた文字種
var PASSWORD_CHARSETS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnpqrstuvwxyz',
  '23456789',
  '#$%&+-=?@'
];

/**
 * 各文字種を 1 文字以上含むパスワードを生成する。
 * @param {number} length
 * @param {function(): number[]} randomBytes 0-255 の乱数配列を返す関数
 */
function generatePassword(length, randomBytes) {
  var all = PASSWORD_CHARSETS.join('');
  while (true) {
    var bytes = randomBytes();
    var out = '';
    for (var i = 0; i < bytes.length && out.length < length; i++) {
      // 剰余の偏りを避けるため、範囲外のバイトは捨てる
      var limit = 256 - (256 % all.length);
      if (bytes[i] < limit) out += all.charAt(bytes[i] % all.length);
    }
    if (out.length < length) continue;
    var hasAll = PASSWORD_CHARSETS.every(function (set) {
      return out.split('').some(function (ch) { return set.indexOf(ch) >= 0; });
    });
    if (hasAll) return out;
  }
}

/** GAS 用：UUID v4（暗号論的乱数）を乱数源にする。 */
function gasRandomBytes_() {
  var bytes = [];
  for (var i = 0; i < 4; i++) {
    var hex = Utilities.getUuid().replace(/-/g, '');
    // バージョン・バリアントのニブルを含む 7〜9 バイト目を除外
    hex = hex.slice(0, 12) + hex.slice(18);
    for (var j = 0; j < hex.length; j += 2) bytes.push(parseInt(hex.substr(j, 2), 16));
  }
  return bytes;
}

if (typeof module !== 'undefined') {
  module.exports = {
    renderMailBody: renderMailBody,
    renderPasswordMail: renderPasswordMail,
    generatePassword: generatePassword,
    PASSWORD_CHARSETS: PASSWORD_CHARSETS
  };
}
