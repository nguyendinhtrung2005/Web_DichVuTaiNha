import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function stopChild(child) {
  if (!child || !Number.isInteger(child.pid) || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const task = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      task.once('exit', resolve);
      task.once('error', resolve);
    });
  } else {
    child.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), pause(5000)]);
  }
}

export async function launchBrowser({ artifactDirectory, env = process.env }) {
  const candidates = [env.CUSTOMER_BROWSER_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error('Chrome/Edge is unavailable. Configure CUSTOMER_BROWSER_PATH.');
  const artifactRoot = path.resolve(artifactDirectory);
  const profile = path.resolve(artifactRoot, `customer-browser-${Date.now()}`);
  if (path.dirname(profile) !== artifactRoot) throw new Error('Browser profile must stay in the test artifact directory.');
  await mkdir(profile, { recursive: true });
  const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const debugURL = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Timed out starting the headless browser.')), 30000);
      const consume = (chunk) => {
        output = (output + String(chunk)).slice(-12000);
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      };
      browser.stderr.on('data', consume);
      browser.stdout.on('data', consume);
      browser.once('error', (error) => { clearTimeout(timeout); reject(error); });
      browser.once('exit', () => { clearTimeout(timeout); reject(new Error('Headless browser exited before opening a debugging connection.')); });
    });
    const address = new URL(debugURL);
    const target = await fetch(`http://127.0.0.1:${address.port}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json());
    const page = await CdpPage.connect(target.webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Ho_Chi_Minh' });
    return {
      page,
      async close() {
        page.close();
        await stopChild(browser);
        if (path.dirname(profile) !== artifactRoot) throw new Error('Refusing to remove a profile outside the test artifact directory.');
        await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      },
    };
  } catch (error) {
    await stopChild(browser);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    throw error;
  }
}

export class CdpPage {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        clearTimeout(entry.timeout);
        if (message.error) entry.reject(new Error(`CDP ${entry.method} failed: ${message.error.message}`));
        else entry.resolve(message.result);
      } else {
        for (const listener of this.listeners) listener(message);
      }
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('Unable to connect to the browser debugging socket.')), { once: true });
    });
    return new CdpPage(socket);
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timed out.`)); }, 30000);
      this.pending.set(id, { method, resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error('The browser test expression raised an exception.');
    return result.result?.value;
  }
  async waitFor(expression, message, timeout = 45000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try { const value = await this.evaluate(expression); if (value) return value; } catch { /* A navigation may replace the execution context. */ }
      await pause(150);
    }
    throw new Error(message);
  }
  async goto(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor('document.readyState === "complete"', 'Page did not finish loading.');
  }
  async fill(label, value) {
    const expression = `(async () => {
      const label = [...document.querySelectorAll('label')].find(item => {
        const copy = item.cloneNode(true);
        copy.querySelectorAll('input,select,textarea,button').forEach(control => control.remove());
        return copy.textContent.trim() === ${JSON.stringify(label)};
      });
      const control = label?.control || (label?.htmlFor && document.getElementById(label.htmlFor));
      if (!control || control.disabled) return false;
      control.focus();
      if (control instanceof HTMLTextAreaElement || (control instanceof HTMLInputElement && control.type !== 'date')) return {native:true};
      const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, ${JSON.stringify(String(value))});
      control.dispatchEvent(new Event('input', {bubbles:true}));
      control.dispatchEvent(new Event('change', {bubbles:true}));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {native:false};
    })()`;
    const control = await this.waitFor(expression, `Editable control is unavailable: ${label}`);
    if (control.native) {
      await this.send('Input.dispatchKeyEvent', {type:'keyDown', key:'a', code:'KeyA', windowsVirtualKeyCode:65, modifiers:2});
      await this.send('Input.dispatchKeyEvent', {type:'keyUp', key:'a', code:'KeyA', windowsVirtualKeyCode:65, modifiers:2});
      await this.send('Input.dispatchKeyEvent', {type:'keyDown', key:'Backspace', code:'Backspace', windowsVirtualKeyCode:8});
      await this.send('Input.dispatchKeyEvent', {type:'keyUp', key:'Backspace', code:'Backspace', windowsVirtualKeyCode:8});
      if (String(value)) await this.send('Input.insertText', {text:String(value)});
      await this.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    }
  }
  async click(text, { aria = false } = {}) {
    const expression = `(() => {
      const candidates = [...document.querySelectorAll('button,a,[role="button"]')].filter(item => ${aria ? `item.getAttribute('aria-label') === ${JSON.stringify(text)}` : `item.textContent.trim() === ${JSON.stringify(text)}`} && item.getClientRects().length && !item.disabled);
      const element = candidates.find(item => item.tagName === 'BUTTON') || candidates[0];
      if (!element) return false;
      element.click(); return true;
    })()`;
    await this.waitFor(expression, `Clickable control is unavailable: ${text}`);
  }
  async text(value) {
    return this.waitFor(`document.body.innerText.includes(${JSON.stringify(value)})`, `Expected Customer UI text did not appear: ${value}`);
  }
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close() {
    for (const entry of this.pending.values()) { clearTimeout(entry.timeout); entry.reject(new Error('Browser closed.')); }
    this.pending.clear();
    this.socket.close();
  }
}
