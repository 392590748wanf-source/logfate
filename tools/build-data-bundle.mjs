import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, 'data');
const manifestPath = join(outputDirectory, 'manifest.json');
const versionPath = join(outputDirectory, 'version.json');
const checkOnly = process.argv.includes('--check');

const readSource = file => readFile(join(root, file), 'utf8');
const createSandbox = () => {
  const window = {};
  const sandbox = {
    window,
    JSON,
    Uint8Array,
    TextDecoder,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    localStorage: { getItem: () => null, setItem: () => {} }
  };
  vm.createContext(sandbox);
  return sandbox;
};

const execute = async (sandbox, file) => vm.runInContext(await readSource(file), sandbox, { filename: file });
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = value => createHash('sha256').update(value).digest('hex');

const version = JSON.parse(await readFile(versionPath, 'utf8'));
if (!version.version || !version.publishedAt) throw new Error('data/version.json 必须包含 version 与 publishedAt。');
const bundleFileName = `data-bundle-${String(version.version).replace(/[^0-9A-Za-z._-]/g, '-')}.json`;
const bundlePath = join(outputDirectory, bundleFileName);

const presetSandbox = createSandbox();
await execute(presetSandbox, 'nbb-preset.js');
if (!presetSandbox.nbbData) throw new Error('无法读取 nbb-preset.js 中的内置装备数据。');

const sandbox = createSandbox();
for (const file of ['base-materials.js', 'submarine-data.js', 'hqhelper-fallback.js', 'retainer-data.js', 'material-sources.js', 'craft-scrip-data.js', 'craft-scrips.js', 'levequests.js', 'levequest-catalog.js', 'fisher-leves.js', 'levequest-recipes.js', 'levequest-material-sources.js']) {
  await execute(sandbox, file);
}
await execute(sandbox, 'recipe-synthesis-data.js');

const equipmentSourceAudit = () => {
  const materials = sandbox.window.FF14_BASE_MATERIALS || {};
  const sources = sandbox.window.FF14_MATERIAL_SOURCES || {};
  const items = sandbox.window.FF14_HQHELPER_FALLBACK?.items || {};
  const ids = new Set();
  for (const recipe of Object.values(materials.b || {})) {
    for (let index = 0; index < recipe.length; index += 2) ids.add(String(recipe[index]));
  }
  return [...ids].sort((left, right) => Number(left) - Number(right)).map(uid => {
    const source = sources[uid] || {};
    const category = source.verified?.equipment || source.equipmentKinds?.[0] || materials.k?.[uid] || '常规采集品';
    return {
      uid: Number(uid),
      name: source.name || items[uid]?.n || `物品 ${uid}`,
      category,
      status: source.verified?.equipment ? '已核验' : '待核验',
      sources: source.verified?.sources || []
    };
  });
};

const craftScripAudit = () => {
  const scrips = sandbox.window.FF14_CRAFT_SCRIPS || {};
  const items = { ...(sandbox.window.FF14_HQHELPER_FALLBACK?.items || {}), ...(scrips.items || {}) };
  const recipes = { ...(sandbox.window.FF14_HQHELPER_FALLBACK?.recipes || {}), ...(scrips.recipes || {}) };
  const itemName = uid => items[String(uid)]?.n || `物品 ${uid}`;
  return {
    version: scrips.version || '未标记',
    publishedAt: scrips.publishedAt || null,
    sources: scrips.sources || {},
    status: scrips.audit?.status || '待核验',
    note: scrips.audit?.note || '',
    tickets: Object.entries(scrips.tickets || {}).map(([key, ticket]) => ({ key, label: ticket.label, minimumCollectableLevel: ticket.minimumCollectableLevel || null, scope: ticket.scope || '' })),
    exchanges: (scrips.exchanges || []).map(route => ({
      uid: Number(route.itemId), name: route.name || itemName(route.itemId),
      ticket: route.ticket, ticketCost: route.ticketCost, outputQuantity: route.outputQuantity,
      status: route.verified ? '已核验' : (items[route.itemId] ? '已核验物品' : '待核验物品'),
      source: route.source, sourceUrl: route.sourceUrl || '', scope: route.scope || ''
    })),
    collectables: (scrips.collectables || []).map(spec => {
      const recipe = recipes[String(spec.itemId)]?.[0];
      const ready = Boolean(spec.itemId && spec.job && Number(spec.maxPayout) > 0 && recipe);
      return {
        uid: Number(spec.itemId), name: spec.name || itemName(spec.itemId), ticket: spec.ticket,
        level: spec.level || null, job: spec.job || '', outputQuantity: spec.outputQuantity || recipe?.y || null,
        maxPayout: spec.maxPayout || null, recipeSource: spec.recipeSource || scrips.sources?.garland || '',
      ratings: spec.ratings || [], payouts: spec.payouts || [], marketExcluded: Boolean(spec.marketExcluded),
      status: ready && spec.verified ? '已核验' : '等待补充', reason: ready && spec.verified ? '' : '缺少物品、职业、配方、最高档回报或 Garland 核验'
      };
    })
  };
};

const levequestSourceAudit = () => {
  const sourceData = sandbox.window.FF14_LEVEQUEST_MATERIAL_SOURCES || { items: {}, audit: {} };
  return {
    ...sourceData.audit,
    sources: sourceData.sources || {},
    materials: Object.entries(sourceData.items || {}).map(([uid, source]) => ({
      uid: Number(uid), name: source.n || `物品 ${uid}`, status: source.status || '待核验',
      categories: source.kinds || [], npc: source.npc || null,
      sourceUrl: source.sourceUrl || '', evidence: source.evidence || {}
    }))
  };
};

const bundle = {
  schema: 1,
  version: version.version,
  publishedAt: version.publishedAt,
  datasets: {
    nbbPreset: presetSandbox.nbbData,
    baseMaterials: sandbox.window.FF14_BASE_MATERIALS,
    submarineData: sandbox.window.FF14_SUBMARINE_DATA,
    hqHelperFallback: sandbox.window.FF14_HQHELPER_FALLBACK,
    retainerData: sandbox.window.FF14_RETAINER_DATA,
    materialSources: sandbox.window.FF14_MATERIAL_SOURCES,
    exchangeSources: sandbox.window.FF14_EXCHANGE_SOURCES,
    craftScrips: sandbox.window.FF14_CRAFT_SCRIPS,
    levequests: sandbox.window.FF14_LEVEQUESTS,
    levequestCatalog: sandbox.window.FF14_LEVEQUEST_CATALOG,
    fisherLeves: sandbox.window.FF14_FISHER_LEVES,
    levequestRecipes: sandbox.window.FF14_LEVEQUEST_RECIPES,
    levequestMaterialSources: sandbox.window.FF14_LEVEQUEST_MATERIAL_SOURCES,
    recipeSynthesis: sandbox.window.FF14_RECIPE_SYNTHESIS,
    materialSourceAudit: { equipment: equipmentSourceAudit(), craftScrips: craftScripAudit(), levequests: levequestSourceAudit() }
  }
};
const bundleText = json(bundle);
const manifest = {
  schema: 1,
  version: version.version,
  publishedAt: version.publishedAt,
  bundle: {
    path: bundleFileName,
    sha256: sha256(bundleText),
    bytes: Buffer.byteLength(bundleText)
  }
};
const manifestText = json(manifest);

if (checkOnly) {
  const [existingBundle, existingManifest] = await Promise.all([readFile(bundlePath, 'utf8'), readFile(manifestPath, 'utf8')]);
  if (existingBundle !== bundleText || existingManifest !== manifestText) throw new Error('数据包已过期，请运行 pnpm data:build 后提交 data 目录。');
  console.log(`数据包校验通过：${version.version}`);
} else {
  await mkdir(dirname(bundlePath), { recursive: true });
  await Promise.all([writeFile(bundlePath, bundleText, 'utf8'), writeFile(manifestPath, manifestText, 'utf8')]);
  console.log(`已生成数据包：${version.version}`);
}
