// 在内存中执行真实的备份处理逻辑；不会读取或写入用户账本。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const rendererSource = fs.readFileSync(path.join(root, 'fantasy.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
const storage = new Map();
let reloads = 0;
let shouldRestore = false;
const rendererContext = {
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  },
  location: { reload: () => { reloads++; } },
  confirm: () => shouldRestore
};
for (const name of [
  'leveSalesStorageKey', 'levePricePresetStorageKey', 'craftScripManualStorageKey',
  'tradeInventoryStorageKey', 'tradeSourceCacheStorageKey', 'garlandVentureCoreCacheStorageKey'
]) {
  const match = rendererSource.match(new RegExp(`const ${name} = '([^']+)';`));
  assert.ok(match, `找不到前端字段 ${name}`);
  rendererContext[name] = match[1];
}
const frontStart = rendererSource.indexOf('  const backupStorageKeys = [');
const frontEnd = rendererSource.indexOf('  const sales = () =>', frontStart);
assert.ok(frontStart > 0 && frontEnd > frontStart);
vm.runInNewContext(rendererSource.slice(frontStart, frontEnd) + '\nthis.backup = { backupStorageKeys, createBackup, validateBackup, restoreBackup };', rendererContext);

const handlers = new Map();
const files = new Map();
let saveCanceled = false, saveDialogCalls = 0, openDialogCalls = 0;
const electron = {
  app: { getPath: () => 'in-memory-user-data', whenReady: () => ({ then() {} }), on() {} },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  dialog: {
    showSaveDialog: async () => {
      saveDialogCalls++;
      return saveCanceled ? { canceled: true } : { canceled: false, filePath: 'memory-backup.json' };
    },
    showOpenDialog: async () => {
      openDialogCalls++;
      return { canceled: false, filePaths: ['memory-backup.json'] };
    }
  },
  shell: {}
};
const memoryFs = {
  writeFile: async (file, content) => { files.set(file, content); },
  readFile: async file => {
    if (!files.has(file)) throw new Error('File not found');
    return files.get(file);
  }
};
const mainContext = {
  require: name => name === 'electron' ? electron
    : name === 'electron-updater' ? { autoUpdater: {} }
    : name === 'node:fs/promises' ? memoryFs
    : require(name),
  __dirname: path.join(root, 'electron'),
  process: { platform: 'win32' }
};
vm.runInNewContext(mainSource + '\nthis.backupKeys = [...BACKUP_KEYS];', mainContext);

(async () => {
  const front = rendererContext.backup;
  const frontKeys = [...front.backupStorageKeys].sort();
  const mainKeys = [...mainContext.backupKeys].sort();
  assert.equal(new Set(frontKeys).size, frontKeys.length, '前端备份字段不得重复');
  assert.equal(new Set(mainKeys).size, mainKeys.length, '主进程备份字段不得重复');
  assert.deepEqual(mainKeys, frontKeys, '前端备份字段与客户端主进程允许字段必须完全一致');

  for (const key of frontKeys) storage.set(key, JSON.stringify({ key, quantity: 3 }));
  const backup = front.createBackup();
  assert.equal(backup.version, 1, '沿用原备份格式');
  const exportBackup = handlers.get('backup:export');
  const importBackup = handlers.get('backup:import');
  const saved = await exportBackup(null, backup);
  assert.equal(saved.canceled, false);
  assert.equal(saved.filePath, 'memory-backup.json');
  assert.deepEqual(JSON.parse(files.get(saved.filePath)).storage, JSON.parse(JSON.stringify(backup.storage)), '导出完整保留全部字段');
  const imported = await importBackup();
  assert.equal(imported.canceled, false);
  assert.deepEqual(JSON.parse(JSON.stringify(imported.backup.storage)), JSON.parse(JSON.stringify(backup.storage)));
  assert.deepEqual(JSON.parse(JSON.stringify(front.validateBackup(imported.backup))), JSON.parse(JSON.stringify(backup.storage)));

  shouldRestore = false;
  storage.set(frontKeys[0], 'unchanged');
  assert.equal(front.restoreBackup(imported.backup), false, '取消导入不改变现有数据');
  assert.equal(storage.get(frontKeys[0]), 'unchanged');
  shouldRestore = true;
  front.restoreBackup(imported.backup);
  assert.equal(storage.get(frontKeys[0]), backup.storage[frontKeys[0]]);
  assert.equal(reloads, 1);

  const oldBackup = { ...backup, storage: { 'ff14-770': '{}' } };
  assert.equal((await exportBackup(null, oldBackup)).canceled, false, '旧备份仍可导出');
  assert.equal((await importBackup()).backup.storage['ff14-770'], '{}', '旧备份仍可导入');
  const previousDialogs = saveDialogCalls;
  await assert.rejects(exportBackup(null, { ...backup, storage: { unknown: '{}' } }), /备份文件包含无效数据/);
  await assert.rejects(exportBackup(null, { ...backup, storage: {} }), /没有可恢复的账本数据/);
  assert.equal(saveDialogCalls, previousDialogs, '无效备份不会打开保存窗口');
  files.set('memory-backup.json', JSON.stringify({ ...backup, storage: { unknown: '{}' } }));
  assert.match((await importBackup()).error, /备份文件包含无效数据/, '未知字段仍被拒绝');
  assert.ok(openDialogCalls >= 3);
  saveCanceled = true;
  assert.equal((await exportBackup(null, backup)).canceled, true, '取消保存不写文件');
  console.log('Client backup export/import checks passed (in-memory only).');
})().catch(error => { console.error(error); process.exitCode = 1; });
