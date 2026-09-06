#!/usr/bin/env node
/**
 * 下载固定潜水艇部件图标到客户端资源目录。
 * 工房部件不会随市场资料变动，因此客户端离线时也应能显示它们。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = async (file, global) => {
  const context = { window: {} };
  vm.runInNewContext(await readFile(resolve(root, file), 'utf8'), context, { filename: file });
  return context.window[global];
};

const [submarineData, hqHelperFallback] = await Promise.all([
  load('submarine-data.js', 'FF14_SUBMARINE_DATA'),
  load('hqhelper-fallback.js', 'FF14_HQHELPER_FALLBACK')
]);
const destination = resolve(root, 'assets', 'submarine-icons');
const entries = (submarineData.parts || []).map(part => ({ id: String(part.id), icon: Number(hqHelperFallback.icons?.[String(part.id)] || 0) }));
const missing = entries.filter(entry => !(entry.icon > 0));
if (missing.length) throw new Error(`缺少潜水艇部件图标 ID：${missing.map(entry => entry.id).join('、')}`);

await mkdir(destination, { recursive: true });
let cursor = 0;
const failures = [];
const download = async () => {
  while (cursor < entries.length) {
    const entry = entries[cursor++];
    try {
      const response = await fetch(`https://www.garlandtools.org/files/icons/item/${entry.icon}.png`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await writeFile(resolve(destination, `${entry.id}.png`), Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      failures.push(`${entry.id}（${error.message || '下载失败'}）`);
    }
  }
};
await Promise.all(Array.from({ length: 8 }, download));
if (failures.length) throw new Error(`下载失败：${failures.join('、')}`);
console.log(`已下载 ${entries.length} 个潜水艇部件图标到 assets/submarine-icons。`);
