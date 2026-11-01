import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

// A controlled local scene shows real compositor blur without capturing work data.
const output = path.resolve('artifacts'); mkdirSync(output, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', '--smoke', `--data-dir=${mkdtempSync(path.join(os.tmpdir(), 'shiguang-glass-'))}`], env });
try {
  let main;
  for (let i = 0; i < 100 && !main; i++) {
    main = app.windows().find(w => w.url().endsWith('/index.html'));
    if (!main) await new Promise(r => setTimeout(r, 50));
  }
  assert.ok(main);
  await main.getByRole('heading', { name: '提醒总览' }).waitFor();
  const snapshot = await main.evaluate(() => window.reminder.invoke('snapshot'));
  assert.ok(['acrylic', 'vibrancy', 'opaque'].includes(snapshot.runtime.material));
  const fallback = await main.evaluate(() => {
    const root = document.documentElement; const old = root.dataset.material;
    root.dataset.material = 'opaque';
    const color = getComputedStyle(root).backgroundColor;
    root.dataset.material = old;
    return color;
  });
  assert.notEqual(fallback, 'rgba(0, 0, 0, 0)', 'opaque fallback is readable without native blur');
  const scene = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const display = screen.getPrimaryDisplay(); const a = display.workArea;
    const width = Math.min(1280, a.width - 40), height = Math.min(850, a.height - 40);
    const bounds = { x: a.x + Math.floor((a.width - width) / 2), y: a.y + Math.floor((a.height - height) / 2), width, height };
    const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
    main.hide();
    const backdrop = new BrowserWindow({ ...bounds, frame: false, alwaysOnTop: true, webPreferences: { sandbox: true, nodeIntegration: false } });
    globalThis.glassBackdrop = backdrop;
    await backdrop.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><head><style>
      html{height:100%;background:radial-gradient(ellipse at 14% 80%,#edaf98 0,transparent 51%),radial-gradient(ellipse at 85% 20%,#748bd1 0,transparent 55%),linear-gradient(125deg,#c3b2d6,#9caed0 55%,#d1c5d4)}
      body{margin:0;height:100vh;background-image:radial-gradient(#ffffff55 .9px,transparent .9px);background-size:18px 18px;font:12px 'Segoe UI',sans-serif;color:#fff9}
      header{padding:25px 30px;letter-spacing:2px} .orb{position:absolute;left:24%;top:24%;width:270px;height:270px;border:1px solid #ffffff59;border-radius:50%;box-shadow:0 0 0 75px #ffffff0d,0 0 0 150px #ffffff07}
      footer{position:absolute;bottom:24px;left:30px;letter-spacing:1px}
      .marker{position:absolute;left:4px;top:4px;width:12px;height:12px;background:#4d83c9}
      </style></head><body><div class="marker"></div><header>SHIGUANG · MATERIAL STUDY</header><div class="orb"></div><footer>本地测试背景 · 用于观察系统毛玻璃效果</footer></body></html>`));
    backdrop.show(); backdrop.moveTop();
    return { bounds, displayId: String(display.id) };
  });
  await main.evaluate(() => window.reminder.invoke('capture'));
  const capture = app.windows().find(w => w.url().includes('capture=1'));
  await capture.locator('#capture-text').waitFor();
  await app.evaluate(({ BrowserWindow }, scene) => {
    const capture = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('capture=1'));
    capture.setPosition(scene.bounds.x + Math.round((scene.bounds.width - 680) / 2), scene.bounds.y + 170); capture.show(); capture.moveTop(); capture.focus();
  }, scene);
  const saveScene = async name => {
    await new Promise(r => setTimeout(r, 600)); // Wait for native acrylic/focus compositing.
    const base64 = await app.evaluate(async ({ desktopCapturer, screen }, scene) => {
      const display = screen.getAllDisplays().find(d => String(d.id) === scene.displayId);
      const scale = display.scaleFactor;
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) } });
      const source = sources.find(s => s.display_id === scene.displayId);
      if (!source) throw new Error('No display capture available');
      const b = scene.bounds;
      const cropped = source.thumbnail.crop({ x: Math.round((b.x - display.bounds.x) * scale), y: Math.round((b.y - display.bounds.y) * scale), width: Math.round(b.width * scale), height: Math.round(b.height * scale) });
      const pixels = cropped.toBitmap();
      const i = (Math.round(8 * scale) * cropped.getSize().width + Math.round(8 * scale)) * 4;
      const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]].sort((a, b) => a - b);
      if (Math.abs(rgb[0] - 77) > 2 || Math.abs(rgb[1] - 131) > 2 || Math.abs(rgb[2] - 201) > 2) throw new Error('Test backdrop is occluded; refusing to save unrelated desktop pixels');
      return cropped.toPNG().toString('base64');
    }, scene);
    writeFileSync(path.join(output, name), Buffer.from(base64, 'base64'));
  };
  await saveScene('glass-native-input.png');
  await capture.locator('#capture-text').fill('明天下午三点提醒我提交项目材料，提前半小时提醒');
  await capture.locator('#capture-text').press('Control+Enter');
  await capture.locator('#capture-save-form').waitFor();
  await app.evaluate(({ BrowserWindow }, scene) => {
    const capture = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('capture=1'));
    capture.setPosition(scene.bounds.x + Math.round((scene.bounds.width - 680) / 2), scene.bounds.y + 80);
  }, scene);
  await saveScene('glass-native-preview.png');
  assert.equal(await capture.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgba(0, 0, 0, 0)');
  await app.evaluate(({ BrowserWindow }, scene) => {
    const capture = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('capture=1')); capture.hide();
    const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'));
    main.setBounds({ x: scene.bounds.x + 70, y: scene.bounds.y + 40, width: scene.bounds.width - 140, height: scene.bounds.height - 80 });
    main.setAlwaysOnTop(true); main.show(); main.moveTop(); main.focus();
  }, scene);
  await saveScene('glass-native-workspace.png');
  console.log(JSON.stringify({ material: snapshot.runtime.material, screenshots: ['glass-native-input.png', 'glass-native-preview.png', 'glass-native-workspace.png'], note: 'Native compositor screenshots on a controlled local backdrop; no work data.' }));
} finally { await app.close(); }
