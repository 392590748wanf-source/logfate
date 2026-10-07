import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'assets', 'ocr');
const tesseractRoot = dirname(require.resolve('tesseract.js/package.json'));
const fromTesseract = createRequire(require.resolve('tesseract.js/package.json'));
const coreRoot = dirname(fromTesseract.resolve('tesseract.js-core/package.json'));
const englishRoot = dirname(require.resolve('@tesseract.js-data/eng/package.json'));

const assets = [
  [join(tesseractRoot, 'dist', 'tesseract.min.js'), join(output, 'tesseract.min.js')],
  [join(tesseractRoot, 'dist', 'worker.min.js'), join(output, 'worker.min.js')],
  [join(tesseractRoot, 'LICENSE.md'), join(output, 'LICENSE-tesseract.txt')],
  [join(coreRoot, 'LICENSE'), join(output, 'LICENSE-core.txt')],
  [join(englishRoot, 'package.json'), join(output, 'english-model-package.json')],
  [join(englishRoot, '4.0.0_best_int', 'eng.traineddata.gz'), join(output, 'lang', 'eng.traineddata.gz')]
];
for (const variant of ['tesseract-core', 'tesseract-core-simd', 'tesseract-core-lstm', 'tesseract-core-simd-lstm']) {
  for (const extension of ['.wasm.js', '.wasm']) {
    assets.push([join(coreRoot, variant + extension), join(output, variant + extension)]);
  }
}
for (const [source, target] of assets) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}
console.log('Prepared local OCR assets.');
