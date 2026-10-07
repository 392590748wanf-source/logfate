// 只使用模拟窗口、存储和更新器；不运行安装程序，也不读取真实用户账本。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const root = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'fantasy.js'), 'utf8');

const mainHarness = async (packaged = true) => {
  const handlers = new Map(), appHandlers = new Map(), statuses = [], order = [], timers = [];
  const updater = new EventEmitter();
  let checks = 0, quits = 0;
  updater.setFeedURL = feed => { updater.feed = feed; };
  updater.checkForUpdates = async () => { checks++; };
  updater.quitAndInstall = (...args) => { order.push(['install', ...args]); };
  const sender = { session: { flushStorageData: () => order.push(['flush']) } };
  const app = { isPackaged: packaged, whenReady: () => ({ then() {} }), on: (name, fn) => appHandlers.set(name, fn), quit: () => { quits++; } };
  const electron = { app, BrowserWindow: { getAllWindows: () => [{ webContents: { send: (_channel, status) => statuses.push(status) } }] }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } };
  const context = vm.createContext({
    require: name => name === 'electron' ? electron : name === 'electron-updater' ? { autoUpdater: updater } : name === './capture-geometry.cjs' ? require(path.join(root, 'electron', 'capture-geometry.cjs')) : require(name),
    __dirname: path.join(root, 'electron'), process: { platform: 'win32' },
    setTimeout: fn => timers.push(fn), setInterval: fn => timers.push(fn)
  });
  vm.runInContext(mainSource + '\nthis.configure = configureAutoUpdater;', context);
  await context.configure();
  return { updater, statuses, order, sender, handlers, appHandlers, timers, checks: () => checks, quits: () => quits };
};

const rendererHarness = (desktop = true) => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      open: false, disabled: false, hidden: true, textContent: '', opens: 0, events: {},
      showModal() { this.open = true; this.opens++; }, close() { this.open = false; },
      addEventListener(name, fn) { this.events[name] = fn; }
    });
    return elements.get(id);
  };
  const order = [];
  let statusCallback, saveError, install = async () => ({ started: true, message: '已发起安装' });
  const bridge = { onUpdateStatus: fn => { statusCallback = fn; }, restartToUpdate: () => { order.push('install'); return install(); } };
  const context = vm.createContext({
    document: { querySelector: element, querySelectorAll: () => [...elements.values()] }, desktopBridge: desktop ? bridge : null, desktopUpdateLatest: element('#desktop-update-latest'),
    save: () => { order.push('save'); if (saveError) throw saveError; }
  });
  const start = rendererSource.indexOf("  const desktopInstallDialog = document.querySelector('#desktop-install-dialog');");
  const end = rendererSource.indexOf("  document.querySelectorAll('[data-close]')", start);
  assert.ok(start > 0 && end > start, '必须检查实际前端更新处理代码');
  vm.runInContext(rendererSource.slice(start, end), context);
  const backdropStart = rendererSource.indexOf("  document.querySelectorAll('dialog').forEach(dialog => {", end);
  const backdropEnd = rendererSource.indexOf('  const purchaseOcrDialog', backdropStart);
  vm.runInContext(rendererSource.slice(backdropStart, backdropEnd), context);
  return { element, order, status: value => statusCallback(value), failSave: error => { saveError = error; }, install: fn => { install = fn; } };
};

(async () => {
  const main = await mainHarness();
  assert.equal(main.updater.autoDownload, true);
  assert.equal(main.updater.autoInstallOnAppQuit, false, '普通退出不能安装');
  assert.equal(main.updater.feed.url, 'https://github.com/392590748wanf-source/logfate/releases/latest/download');
  const invoke = () => main.handlers.get('updater:restart')({ sender: main.sender });
  assert.equal((await invoke()).started, false, '未下载不能安装');
  assert.deepEqual(main.order, []);
  await main.handlers.get('updater:check')();
  assert.equal(main.checks(), 1);
  main.updater.emit('download-progress', { percent: 50.4 });
  assert.equal(main.statuses.at(-1).percent, 50);
  main.updater.emit('update-downloaded', { version: '9.9.9' });
  assert.equal(main.statuses.at(-1).readyToInstall, true);
  await main.handlers.get('updater:check')();
  await main.timers[0]();
  assert.equal(main.checks(), 1, '已下载不重复检查或覆盖待安装状态');
  main.appHandlers.get('window-all-closed')();
  assert.equal(main.quits(), 1);
  assert.deepEqual(main.order, [], '普通退出不调用安装接口');
  assert.equal((await invoke()).started, true);
  assert.deepEqual(main.order, [['flush'], ['install', true, true]], '落盘后静默安装并自动运行');
  assert.equal(main.statuses.at(-1).state, 'installing');
  assert.equal((await invoke()).installing, true, '重复安装拦截');
  assert.equal(main.order.length, 2);

  for (const failure of ['flush', 'throw', 'event', 'async-event']) {
    const h = await mainHarness();
    h.updater.emit('update-downloaded', { version: '9.9.9' });
    if (failure === 'flush') h.sender.session.flushStorageData = () => { throw new Error('flush failed'); };
    else h.updater.quitAndInstall = () => {
      if (failure === 'throw') throw new Error('installer failed');
      if (failure === 'event') h.updater.emit('error', new Error('installer failed'));
      if (failure === 'async-event') Promise.resolve().then(() => h.updater.emit('error', new Error('installer failed')));
    };
    const result = await h.handlers.get('updater:restart')({ sender: h.sender });
    assert.equal(result.started, false, failure);
    assert.equal(h.statuses.at(-1).installing, false);
    assert.equal(h.statuses.at(-1).readyToInstall, true, '失败保留待安装包');
    assert.match(result.message, /failed/);
  }
  const dev = await mainHarness(false);
  assert.equal((await dev.handlers.get('updater:restart')({ sender: dev.sender })).started, false);
  assert.deepEqual(dev.order, []);

  const ui = rendererHarness();
  const downloaded = { state: 'downloaded', version: '9.9.9', readyToInstall: true, installing: false };
  const dialog = ui.element('#desktop-install-dialog');
  const confirm = ui.element('#desktop-install-confirm');
  const clickBackdrop = () => { dialog.events.pointerdown({ target: dialog }); dialog.events.click({ target: dialog }); };
  ui.status(downloaded);
  assert.equal(dialog.open, true);
  assert.equal(ui.element('#desktop-update-restart').hidden, false);
  ui.element('#desktop-install-later').onclick();
  assert.equal(dialog.open, false);
  assert.deepEqual(ui.order, [], '稍后既不保存也不启动安装');
  ui.status(downloaded);
  assert.equal(dialog.opens, 1, '手动检查不会反复弹出同版本确认');
  ui.element('#desktop-update-restart').onclick();
  assert.equal(dialog.open, true, '安装按钮能重新打开确认');
  clickBackdrop();
  assert.equal(dialog.open, false, '安装前点击遮罩只关闭确认，不安装');
  ui.element('#desktop-update-restart').onclick();
  ui.failSave(new Error('quota'));
  await confirm.onclick();
  assert.deepEqual(ui.order, ['save']);
  assert.match(ui.element('#desktop-install-status').textContent, /账目保存失败/);
  assert.equal(confirm.disabled, false);
  ui.failSave(null);
  ui.install(async () => ({ started: false, message: '无法启动安装程序' }));
  await confirm.onclick();
  assert.match(ui.element('#desktop-install-status').textContent, /无法启动/);
  assert.equal(confirm.disabled, false);
  let complete;
  ui.install(() => new Promise(resolve => { complete = resolve; }));
  const pending = confirm.onclick();
  const count = ui.order.length;
  await confirm.onclick();
  assert.equal(ui.order.length, count, '安装期间重复点击无效');
  assert.equal(confirm.disabled, true);
  assert.equal(ui.element('#desktop-update-check').disabled, true);
  ui.element('#desktop-install-later').onclick();
  assert.equal(dialog.open, true, '安装期间不能选择稍后');
  let canceled = false;
  dialog.events.cancel({ preventDefault: () => { canceled = true; } });
  assert.equal(canceled, true, '安装期间 Escape 不关闭');
  clickBackdrop();
  assert.equal(dialog.open, true, '安装期间遮罩不关闭');
  complete({ started: true, message: '已发起安装' });
  await pending;
  assert.deepEqual(ui.order.slice(-2), ['save', 'install']);
  ui.status({ state: 'error', message: '启动失败', readyToInstall: true, installing: false });
  assert.equal(confirm.disabled, false, '可检测到的异步失败恢复按钮');
  assert.equal(ui.element('#desktop-install-status').textContent, '启动失败');
  ui.element('#desktop-install-later').onclick();
  assert.equal(dialog.open, false);
  const website = rendererHarness(false);
  await website.element('#desktop-install-confirm').onclick();
  website.element('#desktop-update-restart').onclick();
  assert.deepEqual(website.order, []);
  assert.equal(website.element('#desktop-install-dialog').open, false, '网页端不显示客户端安装确认');
  assert.ok(!rendererSource.includes('setUpdateSourceBusy'), '不再调用已删除的加速服务函数');
  assert.ok(rendererSource.includes('dialog === desktopInstallDialog && desktopInstallBusy'), '安装时禁止点击遮罩关闭');

  let exposed;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, 'electron/preload.cjs'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_name, api) => { exposed = api; } }, ipcRenderer: { invoke: async channel => { calls.push(channel); return { started: true }; } } })
  });
  assert.equal((await exposed.restartToUpdate()).started, true);
  assert.deepEqual(calls, ['updater:restart'], '沿用既有预加载接口');
  console.log('Client updater mock checks passed (no real installer or user data).');
})().catch(error => { console.error(error); process.exitCode = 1; });
