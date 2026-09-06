const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const APP_ICON = path.join(__dirname, '..', 'build', 'icon.ico');
const BACKUP_FORMAT = 'ff14-fantasy-backup';
const BACKUP_VERSION = 1;
const DATA_SCHEMA = 1;
const GITHUB_RELEASE_DOWNLOAD_URL = 'https://github.com/392590748wanf-source/logfate/releases/latest/download';
// 正式站点优先；域名切换完成前或生产站故障时，保留测试站资料包作为安全回退。
const DATA_MANIFEST_URLS = [
  'https://logfate.com/data/manifest.json',
  'https://ff14-fantasy-ledge.pages.dev/data/manifest.json'
];
const DATASET_KEYS = ['nbbPreset', 'baseMaterials', 'submarineData', 'hqHelperFallback', 'retainerData', 'materialSources', 'exchangeSources', 'levequests'];
const BACKUP_KEYS = new Set([
  'ff14-770',
  'ff14-material-state',
  'ff14-material-purchases',
  'ff14-fantasy-prices',
  'ff14-submarine-ticket-settings',
  'ff14-other-material-ids',
  'ff14-submarine-stocks',
  'ff14-submarine-sales',
  'ff14-submarine-suite-sales',
  'ff14-submarine-operations',
  'ff14-submarine-npc-materials',
  'ff14-submarine-suites',
  'ff14-trade-inventory',
  'ff14-trade-source-cache',
  'ff14-garland-venture-core-cache',
  'ff14-market-refreshed-at'
]);

let mainWindow;

const bundledDataManifestPath = () => path.join(__dirname, '..', 'data', 'manifest.json');
const dataCacheDirectory = () => path.join(app.getPath('userData'), 'data-cache');
const dataCachePaths = () => ({
  directory: dataCacheDirectory(),
  manifest: path.join(dataCacheDirectory(), 'manifest.json'),
  bundle: path.join(dataCacheDirectory(), 'data-bundle.json')
});
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sameVersion = (left, right) => String(left || '') === String(right || '');
const applyOfficialUpdateFeed = () => autoUpdater.setFeedURL({ provider: 'generic', url: GITHUB_RELEASE_DOWNLOAD_URL });

const validateDataManifest = manifest => {
  if (!manifest || Number(manifest.schema) !== DATA_SCHEMA || !manifest.version || !manifest.publishedAt || !manifest.bundle) {
    throw new Error('数据清单格式不正确。');
  }
  if (!manifest.bundle.path || !/^[a-f0-9]{64}$/i.test(String(manifest.bundle.sha256 || ''))) {
    throw new Error('数据清单缺少有效校验信息。');
  }
  return manifest;
};

const validateDataBundle = (raw, manifest) => {
  const bundle = JSON.parse(raw);
  if (!bundle || Number(bundle.schema) !== DATA_SCHEMA || !sameVersion(bundle.version, manifest.version) || !bundle.datasets) {
    throw new Error('数据包版本或结构不正确。');
  }
  if (!DATASET_KEYS.every(key => bundle.datasets[key] && typeof bundle.datasets[key] === 'object')) {
    throw new Error('数据包缺少必要资料。');
  }
  return bundle;
};

const readJsonFile = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const readBundledDataManifest = async () => validateDataManifest(await readJsonFile(bundledDataManifestPath()));
const readCachedData = async () => {
  const paths = dataCachePaths();
  try {
    const [manifest, raw] = await Promise.all([readJsonFile(paths.manifest), fs.readFile(paths.bundle, 'utf8')]);
    validateDataManifest(manifest);
    if (sha256(raw) !== String(manifest.bundle.sha256).toLowerCase()) throw new Error('缓存数据校验失败。');
    return { manifest, bundle: validateDataBundle(raw, manifest) };
  } catch {
    return null;
  }
};
const activeDataStatus = async () => {
  const bundled = await readBundledDataManifest();
  const cached = await readCachedData();
  return { source: cached ? 'cache' : 'bundled', current: cached?.manifest || bundled, bundled };
};
const fetchDataManifest = async () => {
  const failures = [];
  for (const manifestUrl of DATA_MANIFEST_URLS) {
    try {
      const response = await fetch(manifestUrl, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
      if (!response.ok) throw new Error(`数据服务器返回 ${response.status}。`);
      return { manifest: validateDataManifest(await response.json()), manifestUrl };
    } catch (error) {
      failures.push(`${new URL(manifestUrl).host}：${error.message}`);
    }
  }
  throw new Error(`无法连接数据服务器：${failures.join('；')}`);
};
const fetchDataBundle = async (manifest, manifestUrl) => {
  const url = new URL(manifest.bundle.path, manifestUrl).toString();
  let response;
  try {
    response = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
  } catch (error) {
    throw new Error(`无法下载数据包：${error.message}`);
  }
  if (!response.ok) throw new Error(`数据包下载失败（${response.status}）。`);
  const raw = Buffer.from(await response.arrayBuffer()).toString('utf8');
  if (sha256(raw) !== String(manifest.bundle.sha256).toLowerCase()) throw new Error('数据包校验失败，文件未被应用。');
  return { raw, bundle: validateDataBundle(raw, manifest) };
};
const writeDataCache = async (manifest, raw) => {
  const paths = dataCachePaths();
  await fs.mkdir(paths.directory, { recursive: true });
  const suffix = randomUUID();
  const nextBundle = `${paths.bundle}.${suffix}.next`;
  const nextManifest = `${paths.manifest}.${suffix}.next`;
  const previousBundle = `${paths.bundle}.${suffix}.previous`;
  const previousManifest = `${paths.manifest}.${suffix}.previous`;
  await Promise.all([fs.writeFile(nextBundle, raw, 'utf8'), fs.writeFile(nextManifest, JSON.stringify(manifest, null, 2), 'utf8')]);
  try {
    await fs.rename(paths.bundle, previousBundle).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.rename(paths.manifest, previousManifest).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.rename(nextBundle, paths.bundle);
    await fs.rename(nextManifest, paths.manifest);
    await Promise.all([fs.rm(previousBundle, { force: true }), fs.rm(previousManifest, { force: true })]);
  } catch (error) {
    await Promise.all([fs.rm(nextBundle, { force: true }), fs.rm(nextManifest, { force: true })]);
    if (await fs.stat(previousBundle).then(() => true).catch(() => false)) await fs.rename(previousBundle, paths.bundle).catch(() => {});
    if (await fs.stat(previousManifest).then(() => true).catch(() => false)) await fs.rename(previousManifest, paths.manifest).catch(() => {});
    throw error;
  }
};

const sendUpdateStatus = status => {
  BrowserWindow.getAllWindows().forEach(window => window.webContents.send('updater:status', status));
};

const normalizeBackup = backup => {
  if (!backup || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION || !backup.storage || Array.isArray(backup.storage)) {
    throw new Error('备份文件格式不正确，或版本不受支持。');
  }
  const storage = {};
  Object.entries(backup.storage).forEach(([key, value]) => {
    if (!BACKUP_KEYS.has(key) || typeof value !== 'string') throw new Error('备份文件包含无效数据。');
    storage[key] = value;
  });
  if (!Object.keys(storage).length) throw new Error('备份文件中没有可恢复的账本数据。');
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: backup.exportedAt || '', storage };
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: `GilFate · v${app.getVersion()}`,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
};

const configureAutoUpdater = async () => {
  if (!app.isPackaged) return;
  applyOfficialUpdateFeed();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking', message: '正在检查客户端更新…' }));
  autoUpdater.on('update-available', info => {
    sendUpdateStatus({ state: 'available', version: info.version, message: `发现新版本 ${info.version}，正在下载…` });
  });
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'latest', message: '当前已是最新版本。' }));
  autoUpdater.on('download-progress', progress => sendUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent || 0), message: `正在下载更新：${Math.round(progress.percent || 0)}%` }));
  autoUpdater.on('update-downloaded', info => {
    sendUpdateStatus({ state: 'downloaded', version: info.version, message: `新版本 ${info.version} 已下载，可重启安装。` });
  });
  autoUpdater.on('error', error => {
    sendUpdateStatus({ state: 'error', message: `更新检查失败：${error.message}` });
  });
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 2500);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
};

ipcMain.handle('backup:export', async (_event, rawBackup) => {
  const backup = normalizeBackup(rawBackup);
  const date = new Date().toISOString().slice(0, 10);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出 GilFate 账本备份',
    defaultPath: `gilfate-backup-${date}.json`,
    filters: [{ name: 'GilFate 备份', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, JSON.stringify(backup, null, 2), 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('backup:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入 GilFate 账本备份',
    properties: ['openFile'],
    filters: [{ name: 'GilFate 备份', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  try {
    return { canceled: false, backup: normalizeBackup(JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'))) };
  } catch (error) {
    return { canceled: false, error: error.message || '无法读取备份文件。' };
  }
});

ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) return { available: false, message: '开发模式下不检查更新。' };
  try {
    applyOfficialUpdateFeed();
    await autoUpdater.checkForUpdates();
    return { available: true };
  } catch (error) {
    return { available: false, message: error.message || '更新检查失败。' };
  }
});

ipcMain.handle('updater:restart', () => {
  if (app.isPackaged) autoUpdater.quitAndInstall();
});

ipcMain.handle('data:status', async () => {
  try {
    return { available: true, clientVersion: app.getVersion(), ...(await activeDataStatus()) };
  } catch (error) {
    return { available: false, message: error.message || '无法读取本机数据版本。' };
  }
});

ipcMain.handle('data:load', async () => {
  const cached = await readCachedData();
  const status = await activeDataStatus();
  return { bundle: cached?.bundle || null, ...status };
});

ipcMain.handle('data:check', async () => {
  try {
    const [status, remote] = await Promise.all([activeDataStatus(), fetchDataManifest()]);
    const latest = remote.manifest;
    const updateAvailable = !sameVersion(status.current.version, latest.version);
    return {
      available: true,
      current: status.current,
      latest,
      updateAvailable,
      message: updateAvailable ? `发现资料更新 ${latest.version}。` : '当前资料已是最新版本。'
    };
  } catch (error) {
    return { available: false, message: error.message || '数据更新检查失败。' };
  }
});

ipcMain.handle('data:apply', async () => {
  try {
    const remote = await fetchDataManifest();
    const latest = remote.manifest;
    const status = await activeDataStatus();
    if (sameVersion(status.current.version, latest.version)) {
      return { available: true, updated: false, current: status.current, message: '当前资料已是最新版本。' };
    }
    const { raw } = await fetchDataBundle(latest, remote.manifestUrl);
    await writeDataCache(latest, raw);
    return { available: true, updated: true, current: latest, message: `资料 ${latest.version} 已下载，重载后生效。` };
  } catch (error) {
    return { available: false, message: error.message || '资料更新失败，已保留当前资料。' };
  }
});

app.whenReady().then(async () => {
  createWindow();
  await configureAutoUpdater().catch(error => sendUpdateStatus({ state: 'error', message: `更新初始化失败：${error.message}` }));
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
