/**
 * PrimeDrive の画面操作（2026/10 時点の画面で確認済み）。
 * 画面が変更された場合はここのセレクターを修正する。
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { parseIssueResult } from './issueResult.js';

const TIMEOUT = 30000;
const ERROR_TEXT = /エラー|失敗|できません|不備|E\d{3}/;

export class PrimeDrive {
  /**
   * @param {object} cfg loadConfig() の primedrive
   * @param {{channel?: string, headless?: boolean, log?: Function}} opts
   */
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.opts = opts;
    this.log = opts.log || (() => {});
    this.browser = null;
    this.page = null;
    this.path = []; // 現在開いているフォルダ（ホームからのパス）
  }

  async start() {
    this.browser = await chromium.launch({ channel: this.opts.channel, headless: this.opts.headless !== false });
    this.context = await this.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
    this.context.setDefaultTimeout(TIMEOUT);
    this.page = await this.context.newPage();
  }

  async close() {
    if (this.browser) await this.browser.close().catch(() => {});
    this.browser = null;
  }

  async screenshot(file) {
    if (this.page) await this.page.screenshot({ path: file, fullPage: true }).catch(() => {});
  }

  // ───────────── ログイン・ログアウト ─────────────

  async login() {
    const p = this.page;
    await p.goto(this.cfg.url, { waitUntil: 'networkidle' });
    await p.fill('input[name="corpId"]', this.cfg.corpId);
    await p.fill('input[name="userId"]', this.cfg.loginId);
    await p.fill('input[name="password"]', this.cfg.password);
    await p.click('button.LoginButton');
    try {
      await p.locator('.HeaderToolBar button.UserButton').waitFor();
    } catch {
      throw new Error('PrimeDrive にログインできません：' + (await this.popupText()));
    }
    await p.waitForLoadState('networkidle');
    await this.dismissPopups();
    this.path = [];
    this.log('PrimeDrive にログインしました');
  }

  async logout() {
    const p = this.page;
    try {
      await this.dismissPopups();
      await p.click('.HeaderToolBar button.UserButton');
      await p.locator('.MenuItemLabel', { hasText: /^ログアウト$/ }).click();
      await p.waitForURL(/\/logout|\/browse/);
      await p.locator('.HeaderToolBar button.UserButton').waitFor({ state: 'detached' });
      this.log('PrimeDrive からログアウトしました');
    } catch (e) {
      this.log('ログアウトに失敗しました（処理は継続）：' + e.message);
    }
  }

  // ───────────── 共通 ─────────────

  async popupText() {
    return this.page.evaluate(() =>
      [...document.querySelectorAll('.PopupWindow')].map((d) => d.innerText.replace(/\s+/g, ' ').trim()).join(' / '));
  }

  /** お知らせ・アンケート等、自分で開いていないポップアップを閉じる。 */
  async dismissPopups() {
    const p = this.page;
    for (let i = 0; i < 20; i++) {
      const hasBg = await p.locator('.popup-root .popup-background').count();
      if (!hasBg) return;
      const win = p.locator('.popup-root .PopupWindow').first();
      if (await win.count()) {
        this.log('ポップアップを閉じます：' + (await this.popupText()).slice(0, 100));
        await win.locator('.WindowCloseButton, .CancelButton, .CloseTextButton').first().click().catch(() => {});
      }
      await p.waitForTimeout(500);
    }
    throw new Error('ポップアップを閉じられません：' + (await this.popupText()));
  }

  /** fn() が true を返すまで待つ（fn が例外を投げたらそのまま失敗）。 */
  async until(fn, timeout, label, page = this.page) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await fn()) return;
      await page.waitForTimeout(300);
    }
    throw new Error(label + 'がタイムアウトしました。');
  }

  identifier(names) {
    return '/HOME/' + names.join('/');
  }

  row(names) {
    return this.page.locator(`tr.ListViewItem[data-identifier="${this.identifier(names).replace(/"/g, '\\"')}"]`);
  }

  async waitListLoaded() {
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(500);
  }

  /** ホームからのパスでフォルダを開く。 */
  async openPath(names) {
    const p = this.page;
    await this.dismissPopups();
    await p.click('.LeftToolBar button.TabHome');
    const home = p.locator('.DirectoryButton', { hasText: /^ホーム$/ }).first();
    if (this.path.length && (await home.isVisible())) await home.click();
    await this.waitListLoaded();
    this.path = [];
    for (const name of names) {
      const row = this.row([...this.path, name]);
      await row.waitFor();
      await row.locator('td[data-testid="titleDom"]').dblclick();
      this.path.push(name);
      await p.locator('.DirectoryButton.shown', { hasText: name }).waitFor();
      await this.waitListLoaded();
    }
  }

  async exists(names) {
    return (await this.row(names).count()) > 0;
  }

  async selectOnly(names) {
    const p = this.page;
    // 既存の選択を解除してから対象のみ選択する
    for (const r of await p.locator('tr.ListViewItem.checked').all()) {
      await r.locator('td.CheckboxColumn').click();
    }
    await this.row(names).locator('td.CheckboxColumn').click();
    await this.page.locator(`tr.ListViewItem.checked[data-identifier="${this.identifier(names)}"]`).waitFor();
  }

  // ───────────── フォルダ・ファイル操作 ─────────────

  async createFolder(name) {
    const p = this.page;
    await this.dismissPopups();
    await p.click('button.CommandNewFolder');
    const dlg = p.locator('.NewFolderDialog');
    await dlg.locator('input[name="folderName"]').fill(name);
    await dlg.locator('button.ProceedButton').click();
    await dlg.waitFor({ state: 'detached' });
    await this.row([...this.path, name]).waitFor();
    this.log('フォルダを作成しました：' + name);
  }

  /** 現在のフォルダ内の項目をごみ箱へ移動する（発行済みのダウンロードリンクも無効になる）。 */
  async trash(name) {
    const p = this.page;
    const names = [...this.path, name];
    await this.dismissPopups();
    await this.selectOnly(names);
    await p.click('button.TrashButton');
    const dlg = p.locator('.DeletionConfirmDialog');
    await dlg.locator('button.ProceedButton').click();
    await this.row(names).waitFor({ state: 'detached' });
    this.log('ごみ箱へ移動しました：' + name);
  }

  /**
   * 現在のフォルダへファイルをまとめてアップロードする。
   * アップロード画面はファイルを選ぶたびに次の選択欄が追加される。
   * @param {{name:string, path:string}[]} files
   */
  async upload(files) {
    const p = this.page;
    await this.dismissPopups();
    await p.click('button.CommandUpload');
    const dlg = p.locator('.FileUploadDialog');
    await dlg.waitFor();
    await p.waitForTimeout(800); // ダイアログの初期化完了前に選択すると反映されない
    for (let i = 0; i < files.length; i++) {
      const item = dlg.locator('.FileUploadAreaItem').nth(i);
      const nameInput = item.locator('input.FileNameInput');
      for (let attempt = 1; ; attempt++) {
        // パス指定だと環境（文字コード設定）によって日本語のファイル名が受け付けられないため、内容を直接渡す
        await item.locator('input[type="file"]').setInputFiles({
          name: files[i].name,
          mimeType: 'application/octet-stream',
          buffer: fs.readFileSync(files[i].path)
        });
        try {
          await this.until(async () => (await nameInput.inputValue()) !== '', 3000, 'ファイル選択');
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
        }
      }
      const shown = await nameInput.inputValue();
      if (shown !== files[i].name) throw new Error(`選択したファイル名が一致しません：${shown}（期待：${files[i].name}）`);
    }
    await dlg.locator('button.UploadStartButton').click();
    // 完了するとダイアログが閉じる。失敗時はダイアログ内または別ポップアップにメッセージが出る
    await this.until(async () => {
      if (!(await dlg.count())) return true;
      const msg = (await dlg.locator('.Message').innerText().catch(() => '')).trim();
      // 進捗表示（「アップロードしています...」）は正常。エラー表示のみ失敗とする
      const err = await p.locator('.PopupWindow:not(.FileUploadDialog)', { hasText: ERROR_TEXT }).count();
      if (msg || err) throw new Error('アップロードに失敗しました：' + msg + ' ' + (await this.popupText()));
      return false;
    }, 10 * 60 * 1000, 'アップロード');
    await this.waitListLoaded();
    for (const f of files) await this.row([...this.path, f.name]).waitFor();
    this.log(`アップロードしました（${files.length} 件）`);
  }

  /** 現在のフォルダにある項目の名前一覧。 */
  async listNames() {
    return this.page.evaluate(() =>
      [...document.querySelectorAll('tr.ListViewItem')].map((r) => r.dataset.identifier.split('/').pop()));
  }

  // ───────────── ダウンロードリンク発行 ─────────────

  /**
   * 現在のフォルダ内の項目にダウンロードリンクを発行する。メール送信機能は使わない。
   * @return {{url:string, expiresAt:string, targetName:string, downloadCount:number}}
   */
  async issueLink(name, { days, password, downloadCount }) {
    const p = this.page;
    await this.dismissPopups();
    await this.selectOnly([...this.path, name]);
    await p.click('button.CommandSend');
    const dlg = p.locator('.AccessKeyIssueDialog');
    await dlg.waitFor();

    // 前回の発行条件が非同期で読み込まれ入力値が上書きされるため、値が落ち着くまで待つ
    const read = () => dlg.evaluate((d) => {
      const q = (n) => d.querySelector(`[name="${n}"]`);
      return {
        days: q('availableDays_input').value,
        count: q('downloadCount_input').value,
        countUnlimited: q('downloadCount_checkbox').checked,
        pwLen: q('downloadPassword_input').value.length,
        pwAuto: q('downloadPassword_checkbox').checked,
        zipLen: q('zipEncryptPassword_input').value.length
      };
    });
    let prev = '';
    for (let i = 0; i < 20; i++) {
      const cur = JSON.stringify(await read());
      if (cur === prev && i >= 3) break;
      prev = cur;
      await p.waitForTimeout(400);
    }

    const setText = async (n, v) => {
      const input = dlg.locator(`input[name="${n}"]`);
      await input.fill(String(v));
      await input.press('Tab'); // 入力チェックはフォーカス移動時に確定する
    };
    const setChecked = async (n, on) => {
      const box = dlg.locator(`input[name="${n}"]`);
      if ((await box.isChecked()) !== on) await box.click();
    };
    await setChecked('downloadPassword_checkbox', false);
    await setText('availableDays_input', days);
    if (downloadCount) {
      await setChecked('downloadCount_checkbox', false);
      await setText('downloadCount_input', downloadCount);
    }
    await setText('downloadPassword_input', password);
    // 入力チェックの結果は少し遅れて反映される
    await this.until(async () => (await dlg.locator('input.validity-invalid').count()) === 0, 5000, '発行条件の入力')
      .catch(async () => { throw new Error('発行条件に入力エラーがあります：' + (await this.popupText())); });

    const v = await read();
    if (v.days !== String(days) || v.pwLen !== password.length || v.pwAuto ||
        (downloadCount && (v.count !== String(downloadCount) || v.countUnlimited))) {
      throw new Error('発行条件を入力できませんでした：' + JSON.stringify({ ...v, pwLen: v.pwLen ? '(入力済み)' : 0 }));
    }
    await dlg.locator('button.ProceedButton').click();
    const result = p.locator('.MailerSelectDialog .ResultDetail');
    await this.until(async () => {
      if (await result.count()) return true;
      const err = p.locator('.PopupWindow:not(.AccessKeyIssueDialog):not(.MailerSelectDialog)', { hasText: ERROR_TEXT });
      if (await err.count()) throw new Error('ダウンロードリンクを発行できません：' + (await this.popupText()));
      return false;
    }, 60000, 'ダウンロードリンク発行');
    const parsed = parseIssueResult(await result.innerText());
    // 送付方法の選択画面は「閉じる」で閉じる（PrimeDrive からのメール送信はしない）
    await p.locator('.MailerSelectDialog button.CloseTextButton').click();
    await p.locator('.MailerSelectDialog').waitFor({ state: 'detached' });
    this.log('ダウンロードリンクを発行しました：' + name + '（期限 ' + parsed.expiresAt + '）');
    return parsed;
  }

  /**
   * 発行したリンクを未ログインの別ブラウザで開き、パスワードが必須であること、
   * 正しいパスワードで期待どおりのファイルが見えることを確認する（ダウンロード回数は消費しない）。
   */
  async verifyLink(url, password, expectedNames) {
    const ctx = await this.browser.newContext({ locale: 'ja-JP' });
    try {
      const p = await ctx.newPage();
      p.setDefaultTimeout(TIMEOUT);
      const pretest = p.waitForResponse((r) => r.url().includes('/api/pretestAccessKey'));
      await p.goto(url, { waitUntil: 'networkidle' });
      const info = (await (await pretest).json()).result || {};
      if (info.requiredPassword !== true) throw new Error('発行したリンクにパスワードが設定されていません。');
      let entries = null;
      p.on('response', async (r) => {
        if (r.url().includes('/api/getEntriesByAccessKey')) entries = (await r.json().catch(() => ({}))).result || [];
      });
      const pw = p.locator('input[type="password"][name="password"]');
      await pw.fill(password);
      await pw.press('Tab');
      // 入力チェックの結果は少し遅れて反映されるため、有効になるまで待ってから OK を押す
      await this.until(async () => /validity-valid/.test(await pw.getAttribute('class')), 5000, 'パスワード入力', p);
      await p.locator('button.ProceedButton').click();
      await this.until(async () => {
        if (entries) return true;
        const err = p.locator('.PopupWindow', { hasText: ERROR_TEXT });
        if (await err.count()) throw new Error('発行したリンクを開けません：' + (await err.first().innerText()).replace(/\s+/g, ' '));
        return false;
      }, TIMEOUT, 'リンクの確認', p);
      let list = entries.map((e) => e.name);
      if (entries.length === 1 && entries[0].kind === 3) {
        // フォルダのリンク：受取人の画面にフォルダ内のファイル一覧が表示される
        const rows = p.locator('tr.ListViewItem');
        await this.until(async () => (await rows.count()) > 0, TIMEOUT, 'リンク先の一覧表示', p);
        list = await rows.evaluateAll((rs) => rs.map((r) => r.dataset.identifier.split('/').pop()));
      }
      list.sort();
      const expected = [...expectedNames].sort();
      if (JSON.stringify(list) !== JSON.stringify(expected)) {
        throw new Error('リンク先のファイルが一致しません：' + list.join(', '));
      }
      this.log('リンクの確認 OK（パスワード必須・ファイル ' + list.length + ' 件）');
    } finally {
      await ctx.close();
    }
  }
}
