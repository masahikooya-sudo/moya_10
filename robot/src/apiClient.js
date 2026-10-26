/** 申請システム（gas/api）との通信。 */
export class ApiClient {
  constructor(url, token) {
    this.url = url;
    this.token = token;
  }

  async call(action, params = {}) {
    // Apps Script の Web アプリは 302 で応答本文の URL に転送するため、redirect: 'follow' で受け取る
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: this.token, ...params }),
      redirect: 'follow'
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`API の応答が JSON ではありません（HTTP ${res.status}）。API_URL を確認してください。`);
    }
    if (!body.ok) throw new Error(`API エラー（${action}）：${body.error}`);
    return body;
  }

  /** 承認済みの申請を 1 件取り出す。無ければ null。 */
  async nextJob() {
    return (await this.call('queue')).job;
  }

  async getFile(requestId, index) {
    return (await this.call('file', { requestId, index })).file;
  }

  async complete(requestId, sendKeyUrl, keyExpiresAt) {
    return this.call('complete', { requestId, sendKeyUrl, keyExpiresAt });
  }

  async fail(requestId, message) {
    return this.call('fail', { requestId, message });
  }
}
