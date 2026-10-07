// Optional packaged-style renderer smoke test; reads only the supplied image and never opens the real ledger.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const output = path.join(__dirname, '.cache', 'ocr-smoke-result.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ stage: 'starting' }));

const sample = process.argv[2];
if (!sample) throw new Error('Provide a PNG/JPEG screenshot path.');
const dataUrl = `data:image/png;base64,${fs.readFileSync(sample).toString('base64')}`;

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false } });
  let server;
  try {
    if (process.argv.includes('--web')) {
      const root = path.resolve(__dirname, '..');
      server = http.createServer((request, response) => {
        const target = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
        if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
        const type = target.endsWith('.html') ? 'text/html' : target.endsWith('.js') ? 'text/javascript' : target.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
        fs.readFile(target, (error, data) => {
          if (error) response.writeHead(404).end();
          else response.writeHead(200, { 'Content-Type': type }).end(data);
        });
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      await window.loadURL(`http://127.0.0.1:${server.address().port}/tools/purchase-ocr-smoke.html`);
    } else {
      await window.loadFile(path.join(__dirname, 'purchase-ocr-smoke.html'));
    }
    const source = process.argv.includes('--blob')
      ? `fetch(${JSON.stringify(dataUrl)}).then(response => response.blob())`
      : `Promise.resolve(${JSON.stringify(dataUrl)})`;
    const result = await window.webContents.executeJavaScript(`${source}.then(image => window.PurchaseOcr.recognize(image)).then(result => result.rows)`);
    fs.writeFileSync(output, JSON.stringify({ stage: 'done', rows: result }, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (!result.length) process.exitCode = 1;
  } catch (error) {
    fs.writeFileSync(output, JSON.stringify({ stage: 'error', message: String(error?.stack || error) }, null, 2));
    console.error(error);
    process.exitCode = 1;
  } finally {
    window.destroy();
    server?.close();
    app.quit();
  }
});
