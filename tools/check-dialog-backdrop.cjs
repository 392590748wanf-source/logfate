// 模拟弹窗点击；不启动客户端，也不读取本机账本。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'fantasy.js'), 'utf8');
const start = source.indexOf("  document.querySelectorAll('dialog').forEach(dialog => {");
const end = source.indexOf('\n  });', start);
assert(start >= 0 && end > start, '未找到弹窗遮罩点击处理');
const handler = source.slice(start, end + '\n  });'.length);

const createDialog = () => ({
  events: {}, closes: 0,
  getBoundingClientRect: () => ({ left: 100, right: 500, top: 100, bottom: 500 }),
  addEventListener(name, callback) { this.events[name] = callback; },
  close() { this.closes++; }
});
const purchaseDialog = createDialog();
const installDialog = createDialog();
vm.runInNewContext(handler, {
  document: { querySelectorAll: () => [purchaseDialog, installDialog] },
  desktopInstallDialog: installDialog,
  desktopInstallBusy: true
});
const pointer = (dialog, name, x, y, target = dialog) => dialog.events[name]({ clientX: x, clientY: y, target });
const click = (dialog, x, y, target = dialog) => {
  pointer(dialog, 'pointerdown', x, y, target);
  pointer(dialog, 'click', x, y, target);
};

click(purchaseDialog, 100, 100); // 白框边缘
click(purchaseDialog, 101, 300); // 白框内留白
click(purchaseDialog, 499, 499); // 另一侧边缘
click(purchaseDialog, 200, 200, {}); // 弹窗内容
assert.equal(purchaseDialog.closes, 0, '点击弹窗内不应关闭');

pointer(purchaseDialog, 'pointerdown', 99, 300);
pointer(purchaseDialog, 'click', 101, 300);
pointer(purchaseDialog, 'pointerdown', 101, 300);
pointer(purchaseDialog, 'click', 99, 300);
pointer(purchaseDialog, 'pointerdown', 99, 300);
purchaseDialog.events.pointercancel();
pointer(purchaseDialog, 'click', 99, 300);
assert.equal(purchaseDialog.closes, 0, '拖拽或取消点击不应关闭');

click(purchaseDialog, 99, 300);
assert.equal(purchaseDialog.closes, 1, '点击真正的遮罩应关闭');
click(installDialog, 99, 300);
assert.equal(installDialog.closes, 0, '安装中不应关闭确认弹窗');

console.log('Dialog backdrop and inside-edge click checks passed.');
