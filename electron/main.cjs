const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { selectionToCrop } = require('./capture-geometry.cjs');

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
  'ff14-leve-plans',
  'ff14-leve-sales-ledger',
  'ff14-leve-sale-price-presets',
  'ff14-craft-scrip-manual-exchanges',
  'ff14-trade-inventory',
  'ff14-trade-source-cache',
  'ff14-garland-venture-core-cache',
  'ff14-market-refreshed-at'
]);

let mainWindow;
let downloadedClientUpdate = null;
let clientUpdateInstalling = false;
let clientUpdateInstallError = null;
let purchaseCaptureActive = false;

const bundledDataManifestPath = () => path.join(__dirname, '..', 'data', 'manifest.json');
const dataCacheDirectory = () => path.join(app.getPath('userData'), 'data-cache');
const dataCachePaths = () => ({
  directory: dataCacheDirectory(),
  manifest: path.join(dataCacheDirectory(), 'manifest.json'),
  bundle: path.join(dataCacheDirectory(), 'data-bundle.json')
});
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sha256File = async file => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
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
let validatedCacheFingerprint = null;
const readCachedData = async ({ bundled = null, includeBundle = false } = {}) => {
  const paths = dataCachePaths();
  try {
    const manifest = validateDataManifest(await readJsonFile(paths.manifest));
    // 相同资料已经随客户端内置；无需再次解析并通过 IPC 复制到渲染进程。
    if (bundled && sameVersion(manifest.version, bundled.version) &&
        String(manifest.bundle.sha256).toLowerCase() === String(bundled.bundle.sha256).toLowerCase()) return null;
    const fingerprint = `${manifest.version}:${String(manifest.bundle.sha256).toLowerCase()}`;
    if (!includeBundle && validatedCacheFingerprint === fingerprint) {
      // 首次已核验结构；后续状态读取仍校验文件内容，但不重复解析对象。
      if (await sha256File(paths.bundle) !== String(manifest.bundle.sha256).toLowerCase()) throw new Error('缓存数据校验失败。');
      return { manifest };
    }
    const raw = await fs.readFile(paths.bundle, 'utf8');
    if (sha256(raw) !== String(manifest.bundle.sha256).toLowerCase()) throw new Error('缓存数据校验失败。');
    const bundle = validateDataBundle(raw, manifest);
    validatedCacheFingerprint = fingerprint;
    return { manifest, bundle: includeBundle ? bundle : null };
  } catch {
    return null;
  }
};
const activeDataStatus = async () => {
  const bundled = await readBundledDataManifest();
  const cached = await readCachedData({ bundled });
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
  validateDataBundle(raw, manifest);
  return raw;
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
  BrowserWindow.getAllWindows().forEach(window => window.webContents.send('updater:status', {
    ...status,
    readyToInstall: Boolean(downloadedClientUpdate),
    installing: clientUpdateInstalling
  }));
};

const downloadedClientStatus = () => ({
  state: clientUpdateInstalling ? 'installing' : 'downloaded',
  version: downloadedClientUpdate?.version,
  message: clientUpdateInstalling
    ? '正在安装更新，客户端将关闭，安装完成后自动打开。'
    : `新版本 ${downloadedClientUpdate?.version} 已下载，可以确认安装。`
});

const checkClientUpdates = async () => {
  if (downloadedClientUpdate || clientUpdateInstalling) {
    sendUpdateStatus(downloadedClientStatus());
    return;
  }
  applyOfficialUpdateFeed();
  await autoUpdater.checkForUpdates();
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
  // “稍后”及普通退出均不安装，只接受用户明确确认的安装请求。
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking', message: '正在检查客户端更新…' }));
  autoUpdater.on('update-available', info => {
    sendUpdateStatus({ state: 'available', version: info.version, message: `发现新版本 ${info.version}，正在下载…` });
  });
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'latest', message: '当前已是最新版本。' }));
  autoUpdater.on('download-progress', progress => sendUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent || 0), message: `正在下载更新：${Math.round(progress.percent || 0)}%` }));
  autoUpdater.on('update-downloaded', info => {
    downloadedClientUpdate = info;
    sendUpdateStatus(downloadedClientStatus());
  });
  autoUpdater.on('error', error => {
    const installing = clientUpdateInstalling;
    if (installing) {
      clientUpdateInstallError = error.message || '无法启动安装程序。';
      clientUpdateInstalling = false;
    }
    sendUpdateStatus({ state: 'error', message: `${installing ? '更新安装启动失败' : '客户端更新失败'}：${error.message}` });
  });
  setTimeout(() => checkClientUpdates().catch(() => {}), 2500);
  setInterval(() => checkClientUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
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

const verifyMainSender = event => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error('截图请求来源无效。');
  }
};

ipcMain.handle('purchase:capture-displays', event => {
  verifyMainSender(event);
  const current = screen.getDisplayMatching(mainWindow.getBounds());
  return {
    currentId: String(current.id),
    displays: screen.getAllDisplays().map((display, index) => ({
      id: String(display.id),
      label: display.label || `显示器 ${index + 1}`,
      width: display.bounds.width,
      height: display.bounds.height
    }))
  };
});

ipcMain.handle('purchase:capture-area', async (event, options = {}) => {
  verifyMainSender(event);
  if (purchaseCaptureActive) throw new Error('已有截图正在进行。');
  const display = screen.getAllDisplays().find(item => String(item.id) === String(options.displayId));
  if (!display) throw new Error('所选显示器不可用，请重新选择。');
  const hideWindow = options.hideWindow === true;
  const wasVisible = mainWindow.isVisible();
  let overlay;
  purchaseCaptureActive = true;
  try {
    if (hideWindow && wasVisible) {
      mainWindow.hide();
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.min(7680, Math.ceil(display.bounds.width * display.scaleFactor)),
        height: Math.min(4320, Math.ceil(display.bounds.height * display.scaleFactor))
      }
    });
    const source = sources.find(item => item.display_id === String(display.id)) || (sources.length === 1 ? sources[0] : null);
    if (!source || source.thumbnail.isEmpty()) throw new Error('无法读取所选显示器画面；可改用选择图片。');
    const image = source.thumbnail;
    const size = image.getSize();
    if (size.width < 1 || size.height < 1 || size.width * size.height > 32_000_000) throw new Error('截图尺寸超出支持范围。');
    overlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, 'capture-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.removeMenu();
    overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const captureWindow = overlay;
    const result = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value, error = null) => {
        if (settled) return;
        settled = true;
        ipcMain.removeListener('purchase:capture-selection', onSelection);
        if (error) reject(error);
        else resolve(value);
      };
      const onSelection = (selectionEvent, selection) => {
        if (selectionEvent.sender !== captureWindow.webContents) return;
        if (!selection) return finish({ canceled: true });
        const crop = selectionToCrop(selection, size);
        if (!crop) return finish({ canceled: true });
        try {
          if (crop.width * crop.height > 20_000_000) throw new Error('框选区域过大，请缩小范围。');
          const png = image.crop(crop).toPNG();
          if (png.length > 12 * 1024 * 1024) throw new Error('截图超过 12 MB，请缩小范围。');
          finish({ canceled: false, dataUrl: `data:image/png;base64,${png.toString('base64')}` });
        } catch (error) {
          finish(null, new Error(`无法裁剪截图：${error.message}`));
        }
      };
      ipcMain.on('purchase:capture-selection', onSelection);
      captureWindow.on('closed', () => finish({ canceled: true }));
      captureWindow.webContents.on('did-fail-load', (_event, _code, description) => {
        finish(null, new Error(description || '截图框选窗口加载失败。'));
      });
      captureWindow.loadFile(path.join(__dirname, 'capture-overlay.html')).then(() => {
        if (settled) return;
        captureWindow.webContents.send('purchase:capture-image', image.toDataURL());
        captureWindow.show();
      }).catch(error => finish(null, error));
    });
    return await result;
  } finally {
    if (overlay && !overlay.isDestroyed()) overlay.close();
    if (hideWindow && wasVisible && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    purchaseCaptureActive = false;
  }
});

ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) return { available: false, message: '开发模式下不检查更新。' };
  try {
    await checkClientUpdates();
    return { available: true };
  } catch (error) {
    return { available: false, message: error.message || '更新检查失败。' };
  }
});

ipcMain.handle('updater:restart', async event => {
  if (!app.isPackaged) return { started: false, message: '开发模式下不安装更新。' };
  if (clientUpdateInstalling) return { started: false, installing: true, message: '正在启动安装，请勿重复操作。' };
  if (!downloadedClientUpdate) return { started: false, message: '更新尚未下载完成，请先检查并下载更新。' };
  clientUpdateInstalling = true;
  clientUpdateInstallError = null;
  sendUpdateStatus(downloadedClientStatus());
  try {
    // 前端已同步保存账目；安装前将该窗口的 localStorage 写入刷新到磁盘。
    event.sender.session.flushStorageData();
    autoUpdater.quitAndInstall(true, true);
    // quitAndInstall 返回 void；通过 error 事件捕获其可检测到的启动失败。
    await Promise.resolve();
    if (clientUpdateInstallError) return { started: false, message: `更新安装启动失败：${clientUpdateInstallError}` };
    return { started: true, message: '已发起安装，安装完成后会自动打开新版客户端。' };
  } catch (error) {
    clientUpdateInstalling = false;
    const message = `更新安装启动失败：${error.message || '无法启动安装程序。'}`;
    sendUpdateStatus({ state: 'error', message });
    return { started: false, message };
  }
});

ipcMain.handle('data:status', async () => {
  try {
    return { available: true, clientVersion: app.getVersion(), ...(await activeDataStatus()) };
  } catch (error) {
    return { available: false, message: error.message || '无法读取本机数据版本。' };
  }
});

ipcMain.handle('data:load', async () => {
  const bundled = await readBundledDataManifest();
  const cached = await readCachedData({ bundled, includeBundle: true });
  if (cached?.bundle?.datasets) {
    // 审查明细仅供资料构建/核验，界面不使用；不跨进程复制这份大型冗余数据。
    delete cached.bundle.datasets.materialSourceAudit;
  }
  return { bundle: cached?.bundle || null, source: cached ? 'cache' : 'bundled', current: cached?.manifest || bundled, bundled };
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
    const raw = await fetchDataBundle(latest, remote.manifestUrl);
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
