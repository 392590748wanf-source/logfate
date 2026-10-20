const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(__dirname, 'build-web-deploy.mjs')], { cwd: root, stdio: 'pipe' });

const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const built = fs.readFileSync(path.join(root, 'dist-web', 'index.html'), 'utf8');
const references = [...source.matchAll(/\b(src|href)="([^"?]+\.(?:js|css))"/g)];
assert.ok(references.length > 0, '入口页面应引用本地脚本和样式');
for (const [, attribute, asset] of references) {
  const bytes = fs.readFileSync(path.join(root, 'dist-web', asset));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  assert.ok(built.includes(`${attribute}="${asset}?v=${hash}"`), `${asset} 应使用内容版本标识`);
}
assert.ok(source.includes('href="app.css"') && source.includes('src="fantasy.js"'), '客户端源页面不应被网页构建改写');
console.log('Web deployment asset cache checks passed.');
