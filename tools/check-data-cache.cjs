// 仅使用内存中的模拟资料包；不读取或修改真实客户端缓存。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const datasets = Object.fromEntries([
  'nbbPreset', 'baseMaterials', 'submarineData', 'hqHelperFallback',
  'retainerData', 'materialSources', 'exchangeSources', 'levequests'
].map(key => [key, {}]));
datasets.materialSourceAudit = { largeAudit: 'x'.repeat(100000) };
const rawBundle = JSON.stringify({ schema: 1, version: '0.0.10', datasets });
const bundledManifest = version => ({ schema: 1, version, publishedAt: '2026-10-07', bundle: { path: 'data-bundle.json', sha256: digest(version), bytes: 1 } });
const cachedManifest = { schema: 1, version: '0.0.10', publishedAt: '2026-10-07', bundle: { path: 'data-bundle.json', sha256: digest(rawBundle), bytes: Buffer.byteLength(rawBundle) } };

const harness = (bundled, cached = cachedManifest, raw = rawBundle) => {
  const handlers = new Map(), reads = [], streams = [];
  const dataDirectory = path.join(root, 'data');
  const cacheDirectory = path.join(root, '.mock-user-data', 'data-cache');
  const files = new Map([
    [path.join(dataDirectory, 'manifest.json'), JSON.stringify(bundled)],
    [path.join(cacheDirectory, 'manifest.json'), JSON.stringify(cached)],
    [path.join(cacheDirectory, 'data-bundle.json'), raw]
  ]);
  const fakeFs = {
    readFile: async file => {
      reads.push(String(file));
      if (!files.has(String(file))) throw new Error('ENOENT');
      return files.get(String(file));
    }
  };
  const context = vm.createContext({
    require: name => {
      if (name === 'electron') return {
        app: { getPath: () => path.join(root, '.mock-user-data'), getVersion: () => '1.1.17', whenReady: () => ({ then() {} }), on() {} },
        BrowserWindow: { getAllWindows: () => [] }, dialog: {}, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, shell: {}
      };
      if (name === 'electron-updater') return { autoUpdater: {} };
      if (name === './capture-geometry.cjs') return require(path.join(root, 'electron', 'capture-geometry.cjs'));
      if (name === 'node:fs/promises') return fakeFs;
      if (name === 'node:fs') return { createReadStream: file => {
        streams.push(String(file));
        return (async function* () { yield Buffer.from(files.get(String(file)) || ''); })();
      } };
      return require(name);
    },
    __dirname: path.join(root, 'electron'), Buffer, process, console, setTimeout, setInterval
  });
  vm.runInContext(source, context);
  return { handlers, reads, streams, cacheBundlePath: path.join(cacheDirectory, 'data-bundle.json') };
};

(async () => {
  const same = harness({ ...cachedManifest });
  const sameLoad = await same.handlers.get('data:load')();
  assert.equal(sameLoad.bundle, null, '内置资料相同则不通过 IPC 重复复制资料包');
  assert.equal(sameLoad.source, 'bundled');
  await same.handlers.get('data:status')();
  assert.ok(!same.reads.includes(same.cacheBundlePath));
  assert.deepEqual(same.streams, [], '相同校验值不需要读取缓存资料文件');

  const newer = harness(bundledManifest('0.0.9'));
  const status = await newer.handlers.get('data:status')();
  assert.equal(status.source, 'cache');
  assert.equal(newer.reads.filter(file => file === newer.cacheBundlePath).length, 1, '首次状态读取必须核验资料包结构');
  await newer.handlers.get('data:status')();
  assert.equal(newer.reads.filter(file => file === newer.cacheBundlePath).length, 1, '后续状态读取不重复解析整份资料包');
  assert.deepEqual(newer.streams, [newer.cacheBundlePath], '后续状态读取应流式校验缓存');
  const loaded = await newer.handlers.get('data:load')();
  assert.equal(loaded.bundle.version, '0.0.10');
  assert.equal(loaded.bundle.datasets.materialSourceAudit, undefined, '不向界面发送不使用的审查明细');
  assert.equal(newer.reads.filter(file => file === newer.cacheBundlePath).length, 2, '向界面加载时再读取一次缓存资料');

  const damaged = harness(bundledManifest('0.0.9'), cachedManifest, rawBundle + 'damaged');
  assert.equal((await damaged.handlers.get('data:status')()).source, 'bundled', '损坏的缓存回退到内置资料');
  assert.equal((await damaged.handlers.get('data:load')()).bundle, null);
  console.log('Client data cache memory checks passed (in-memory only).');
})().catch(error => { console.error(error); process.exitCode = 1; });
