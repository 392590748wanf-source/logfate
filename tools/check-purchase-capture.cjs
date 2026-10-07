// 模拟 Electron 屏幕源和窗口；不读取真实屏幕或账本。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const handlers = new Map();
const ipcMain = Object.assign(new EventEmitter(), { handle: (name, handler) => handlers.set(name, handler) });
const sender = {};
const actions = [], crops = [];
let nextSelection = { x: 100, y: 50, width: 200, height: 100, viewportWidth: 1000, viewportHeight: 500 };
let failSource = false;
const image = {
  isEmpty: () => false,
  getSize: () => ({ width: 2000, height: 1000 }),
  toDataURL: () => 'data:image/png;base64,UE5H',
  crop: crop => { crops.push(crop); return { toPNG: () => Buffer.from('PNG') }; }
};
class Overlay extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {}, send() {} });
  }
  setAlwaysOnTop() {}
  removeMenu() {}
  loadFile() { return Promise.resolve(); }
  show() { queueMicrotask(() => ipcMain.emit('purchase:capture-selection', { sender: this.webContents }, nextSelection)); }
  close() { this.destroyed = true; this.emit('closed'); }
  isDestroyed() { return this.destroyed; }
}
const fakeMainWindow = {
  webContents: sender,
  isDestroyed: () => false,
  isVisible: () => true,
  getBounds: () => ({ x: 0, y: 0, width: 1000, height: 500 }),
  hide: () => actions.push('hide'),
  show: () => actions.push('show'),
  focus: () => actions.push('focus')
};
const display = { id: 7, label: '测试显示器', bounds: { x: 0, y: 0, width: 1000, height: 500 }, scaleFactor: 2 };
const electron = {
  app: { whenReady: () => ({ then() {} }), on() {}, getPath: () => 'memory', getVersion: () => '1.1.17' },
  BrowserWindow: Overlay,
  desktopCapturer: { getSources: async () => {
    if (failSource) throw new Error('screen unavailable');
    return [{ display_id: '7', thumbnail: image }];
  } },
  dialog: {}, ipcMain, screen: { getAllDisplays: () => [display], getDisplayMatching: () => display }, shell: {}
};
const context = vm.createContext({
  require: name => name === 'electron' ? electron : name === 'electron-updater' ? { autoUpdater: {} } : name === './capture-geometry.cjs' ? require(path.join(root, 'electron', 'capture-geometry.cjs')) : require(name),
  __dirname: path.join(root, 'electron'), Buffer, process, console,
  setTimeout: callback => { callback(); return 0; }, setInterval
});
vm.runInContext(source + '\nmainWindow = fakeMainWindow;', Object.assign(context, { fakeMainWindow }));

(async () => {
  const displays = handlers.get('purchase:capture-displays')({ sender });
  assert.equal(displays.currentId, '7');
  assert.equal(displays.displays[0].label, '测试显示器');
  const capture = handlers.get('purchase:capture-area');
  const result = await capture({ sender }, { displayId: '7', hideWindow: true });
  assert.equal(result.canceled, false);
  assert.match(result.dataUrl, /^data:image\/png;base64,/);
  assert.deepEqual(crops[0], { x: 200, y: 100, width: 400, height: 200 });
  assert.deepEqual(actions, ['hide', 'show', 'focus']);

  actions.length = 0;
  nextSelection = null;
  assert.equal((await capture({ sender }, { displayId: '7', hideWindow: false })).canceled, true);
  assert.deepEqual(actions, [], '不隐藏模式不得操作主窗口');

  actions.length = 0;
  failSource = true;
  await assert.rejects(capture({ sender }, { displayId: '7', hideWindow: true }), /screen unavailable/);
  assert.deepEqual(actions, ['hide', 'show', 'focus'], '失败后必须恢复主窗口');
  console.log('Purchase screenshot hide, cancel, crop and recovery checks passed (mock only).');
})().catch(error => { console.error(error); process.exitCode = 1; });
