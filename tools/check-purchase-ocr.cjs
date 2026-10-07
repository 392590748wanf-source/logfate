const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ocr = require('../purchase-ocr.js');
const { selectionToCrop } = require('../electron/capture-geometry.cjs');

assert.equal(ocr.inferDate(10, 7, new Date(2026, 9, 7)), '2026-10-07');
assert.equal(ocr.inferDate(12, 31, new Date(2026, 0, 1)), '2025-12-31');
assert.equal(ocr.inferDate(2, 29, new Date(2026, 9, 7)), '2024-02-29');
assert.equal(ocr.validIsoDate('2026-02-29'), false);
assert.equal(ocr.validTime('15:53'), true);
assert.equal(ocr.validTime('25:53'), false);

const tsv = ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'];
function word(line, column, text, confidence = 90) {
  tsv.push(`5\t1\t1\t1\t${line}\t${column}\t${column * 70}\t${line * 20}\t30\t10\t${confidence}\t${text}`);
}
for (const [index, price, quantity, confidence] of [[1, '1005', '48', 24], [2, '99', '34', 86], [3, '98', '20', 90], [4, '975', '46', 37], [5, '975', '99', 38]]) {
  word(index, 1, price, confidence);
  word(index, 2, quantity);
  word(index, 3, 'MRE');
  word(index, 4, '10/7');
  word(index, 5, '15:53');
}
const parsed = ocr.parseTsv(tsv.join('\n'), new Date(2026, 9, 7));
assert.equal(parsed.length, 5);
assert.deepEqual(parsed.map(row => row.quantity), ['48', '34', '20', '46', '99']);
assert.deepEqual(parsed.map(row => row.needsReview), [true, false, false, true, true]);
assert.equal(parsed[0].time, '15:53');
assert.deepEqual(ocr.priceColumnBounds(tsv.join('\n'), 5, { width: 500, height: 200 }), { left: 68, top: 13, width: 25, height: 104 });
const fusedDateTsv = tsv.map(line => line.replace(/\t10\/7$/, '\t10/715:53'));
assert.deepEqual(ocr.priceColumnBounds(fusedDateTsv.join('\n'), 5, { width: 500, height: 200 }), { left: 68, top: 13, width: 25, height: 104 });
const hqTsv = [tsv[0], ...Array.from({ length: 5 }, (_, index) => `5\t1\t1\t1\t${index + 1}\t0\t10\t${(index + 1) * 20}\t12\t10\t80\t3`), ...tsv.slice(1)];
assert.deepEqual(ocr.priceColumnBounds(hqTsv.join('\n'), 5, { width: 500, height: 200 }), { left: 68, top: 13, width: 25, height: 104 });
assert.equal(ocr.priceColumnBounds(tsv.join('\n'), 4, { width: 500, height: 200 }), null);
const refined = ocr.reconcileColumnPrices(parsed, '100\n99\n98\n97\n97\n');
assert.deepEqual(refined.map(row => row.unitPrice), ['100', '99', '98', '97', '97']);
assert.equal(refined[0].columnCorrected, true);
assert.equal(refined[0].needsReview, true);
const disputed = ocr.reconcileColumnPrices([parsed[1]], '98\n')[0];
assert.equal(disputed.unitPrice, '99');
assert.equal(disputed.columnDisagrees, true);
assert.equal(disputed.needsReview, true);
assert.equal(ocr.reconcileColumnPrices([{ ...parsed[1], unitPrice: '99.00' }], '99\n')[0].columnDisagrees, undefined);
assert.equal(ocr.reconcileColumnPrices(parsed, '100\n').length, parsed.length);
const incompleteTsv = [tsv[0],
  '5\t1\t1\t1\t1\t1\t70\t20\t30\t10\t90\t80',
  '5\t1\t1\t1\t1\t2\t140\t20\t30\t10\t90\t22',
  '5\t1\t1\t1\t1\t3\t210\t20\t30\t10\t90\t10/7',
  '5\t1\t1\t1\t2\t1\t70\t40\t30\t10\t90\t48',
  '5\t1\t1\t1\t2\t2\t210\t40\t30\t10\t90\t10/7',
  '5\t1\t1\t1\t2\t3\t280\t40\t30\t10\t90\t15:53'
].join('\n');
const incompleteRows = ocr.parseTsv(incompleteTsv, new Date(2026, 9, 7));
assert.equal(incompleteRows.length, 2);
assert.equal(incompleteRows[0].time, '');
assert.equal(incompleteRows[0].needsReview, true);
assert.equal(incompleteRows[1].unitPrice, '');
assert.equal(incompleteRows[1].quantity, '');
assert.equal(incompleteRows[1].needsReview, true);
const merged = ocr.mergeRows([{ ...parsed[0], unitPrice: '100' }, { ...parsed[1], unitPrice: '997' }], [parsed[0], parsed[1]]);
assert.deepEqual(merged.map(row => row.unitPrice), ['100', '99']);
assert.deepEqual(merged.map(row => row.needsReview), [true, true]);
assert.equal(ocr.parseText('99p 34 买家 10/7 15:53', new Date(2026, 9, 7))[0].unitPrice, '99');
const joinedTsv = [tsv[0],
  '5\t1\t1\t1\t1\t1\t70\t20\t30\t10\t90\t15009',
  '5\t1\t1\t1\t1\t2\t140\t20\t15\t10\t90\t1',
  '5\t1\t1\t1\t1\t3\t280\t20\t60\t10\t90\t2/91035'
].join('\n');
const joinedRow = ocr.parseTsv(joinedTsv, new Date(2026, 9, 7))[0];
assert.equal(joinedRow.date, '2026-02-09');
assert.equal(joinedRow.time, '10:35');
assert.equal(joinedRow.needsReview, true);
assert.deepEqual(ocr.mergeRows([{ ...joinedRow, date: '', time: '' }], [joinedRow])[0].date, '2026-02-09');
const ambiguousTsv = joinedTsv.replace('2/91035', '10/121:18');
assert.equal(ocr.parseTsv(ambiguousTsv, new Date(2026, 9, 7))[0].date, '');

const good = { selected: true, date: '2026-10-07', time: '15:53', quantity: '48', unitPrice: '100' };
assert.deepEqual(ocr.validateRows([good]).entries[0], { date: '2026-10-07', time: '15:53', quantity: 48, unitPrice: 100, tax: 0.05, total: 5040 });
assert.equal(ocr.validateRows([good, { ...good, quantity: '0' }]).errors.length, 1);
assert.equal(ocr.validateRows([{ ...good, selected: false }]).errors[0].message, '请勾选至少一笔采购记录');
assert.equal(ocr.validateRows([good, { ...good, selected: false, date: 'bad' }]).errors.length, 0);

assert.deepEqual(selectionToCrop({ x: 100, y: 50, width: 200, height: 100, viewportWidth: 1000, viewportHeight: 500 }, { width: 2000, height: 1000 }), { x: 200, y: 100, width: 400, height: 200 });
assert.equal(selectionToCrop({ x: 100, y: 50, width: 10, height: 100, viewportWidth: 1000, viewportHeight: 500 }, { width: 2000, height: 1000 }), null);
assert.deepEqual(selectionToCrop({ x: 950, y: 450, width: 100, height: 100, viewportWidth: 1000, viewportHeight: 500 }, { width: 2000, height: 1000 }), { x: 1900, y: 900, width: 100, height: 100 });

const root = path.resolve(__dirname, '..');
for (const asset of ['tesseract.min.js', 'worker.min.js', 'lang/eng.traineddata.gz', 'tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js']) {
  assert.ok(fs.statSync(path.join(root, 'assets/ocr', asset)).size > 0, `Missing OCR asset: ${asset}`);
}
console.log('Purchase OCR parsing, validation, crop geometry and local assets: OK');
