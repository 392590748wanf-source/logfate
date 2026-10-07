(function (root) {
  'use strict';

  const pad = value => String(value).padStart(2, '0');
  const validDate = (year, month, day) => {
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
  };
  const inferDate = (month, day, reference = new Date()) => {
    const current = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
    for (let year = reference.getFullYear(); year >= reference.getFullYear() - 8; year -= 1) {
      if (!validDate(year, month, day)) continue;
      const candidate = new Date(year, month - 1, day);
      if (candidate <= current) return `${year}-${pad(month)}-${pad(day)}`;
    }
    return '';
  };
  const validIsoDate = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    return Boolean(match && validDate(Number(match[1]), Number(match[2]), Number(match[3])));
  };
  const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
  const numericToken = value => {
    const match = /^(\d[\d,]*(?:\.\d+)?)/.exec(String(value || '').trim());
    return match ? Number(match[1].replace(/,/g, '')) : NaN;
  };
  const parseJoinedDateTime = (text, reference) => {
    const match = /^(\d{1,2})[/\.\-]([\d:]+)$/.exec(String(text || '').trim());
    if (!match) return null;
    const month = Number(match[1]), tail = match[2], candidates = [];
    for (const dayLength of [1, 2]) {
      const day = Number(tail.slice(0, dayLength)), clock = tail.slice(dayLength);
      const colon = /^(\d{1,2}):([0-5]\d)$/.exec(clock);
      const compact = colon ? null : /^(\d{3,4})$/.exec(clock);
      if (!colon && !compact) continue;
      const hour = Number(colon ? colon[1] : compact[1].slice(0, -2));
      const minute = Number(colon ? colon[2] : compact[1].slice(-2));
      const date = inferDate(month, day, reference);
      const time = `${pad(hour)}:${pad(minute)}`;
      if (date && validTime(time)) candidates.push({ date, time });
    }
    // An ambiguous split stays blank for manual review.
    return candidates.length === 1 ? candidates[0] : null;
  };

  const parseWords = (words, reference) => {
    const ordered = words.filter(word => String(word.text || '').trim()).sort((a, b) => a.left - b.left);
    const dateIndex = ordered.findIndex(word => /^\d{1,2}[/.\-]\d{1,2}$/.test(word.text));
    const timeIndex = ordered.findIndex((word, index) => (dateIndex < 0 || index > dateIndex) && /^\d{1,2}:\d{2}$/.test(word.text));
    const dateParts = dateIndex < 0 ? [] : ordered[dateIndex].text.split(/[/.\-]/).map(Number);
    const timeParts = timeIndex < 0 ? [] : ordered[timeIndex].text.split(':').map(Number);
    const joinedIndex = dateIndex < 0 ? ordered.findIndex(word => parseJoinedDateTime(word.text, reference)) : -1;
    const joined = joinedIndex < 0 ? null : parseJoinedDateTime(ordered[joinedIndex].text, reference);
    const date = joined?.date || (dateParts.length === 2 ? inferDate(dateParts[0], dateParts[1], reference) : '');
    const time = joined?.time || (timeParts.length === 2 && timeParts[0] <= 23 && timeParts[1] <= 59
      ? `${pad(timeParts[0])}:${pad(timeParts[1])}` : '');
    const cutoff = dateIndex >= 0 ? dateIndex : joinedIndex >= 0 ? joinedIndex : timeIndex >= 0 ? timeIndex : ordered.length;
    const numbers = ordered.slice(0, cutoff)
      .map(word => ({ ...word, value: numericToken(word.text) }))
      .filter(word => Number.isFinite(word.value));
    if (numbers.length < 2 && dateIndex < 0 && timeIndex < 0 && joinedIndex < 0) return null;
    // A lone number cannot safely be assigned to either price or quantity.
    const price = numbers.length >= 2 ? numbers[0] : null;
    const quantity = numbers.length >= 2 ? numbers[1] : null;
    const incomplete = !date || !time || !price || !quantity || price.value <= 0 || quantity.value <= 0;
    return {
      date,
      time,
      unitPrice: price ? String(price.value) : '',
      quantity: quantity ? String(quantity.value) : '',
      needsReview: incomplete || Boolean(joined) || Number(price.confidence) < 50 || Number(quantity.confidence) < 50
    };
  };

  const parseTsv = (tsv, reference = new Date()) => {
    const lines = new Map();
    for (const line of String(tsv || '').split(/\r?\n/).slice(1)) {
      const columns = line.split('\t');
      if (columns.length < 12 || columns[0] !== '5') continue;
      const key = columns.slice(1, 5).join(':');
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push({ text: columns.slice(11).join('\t').trim(), left: Number(columns[6]), confidence: Number(columns[10]) });
    }
    return [...lines.values()].map(words => parseWords(words, reference)).filter(Boolean);
  };

  const priceColumnBounds = (tsv, expectedRows, imageSize) => {
    const lines = new Map();
    for (const line of String(tsv || '').split(/\r?\n/).slice(1)) {
      const columns = line.split('\t');
      if (columns.length < 12 || columns[0] !== '5') continue;
      const key = columns.slice(1, 5).join(':');
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push({
        text: columns.slice(11).join('\t').trim(),
        left: Number(columns[6]), top: Number(columns[7]),
        width: Number(columns[8]), height: Number(columns[9])
      });
    }
    const prices = [];
    for (const words of lines.values()) {
      const ordered = words.filter(word => word.text).sort((a, b) => a.left - b.left);
      const dateIndex = ordered.findIndex(word => /^\d{1,2}[/.\-]\d{1,2}$/.test(word.text));
      // The date/time OCR is often merged into one word on long screenshots.
      // Locate the two leftmost numeric columns instead; reject the distant date column.
      const numbers = (dateIndex >= 0 ? ordered.slice(0, dateIndex) : ordered)
        .filter(word => Number.isFinite(numericToken(word.text)));
      const pairs = numbers.slice(0, -1).map((price, index) => {
        const quantity = numbers[index + 1];
        return { price, quantity, gap: quantity.left - price.left - price.width };
      }).filter(pair => pair.price.width > 0 && pair.price.height > 0 && pair.gap >= 0 &&
        pair.gap <= Math.max(40, imageSize.width * 0.2));
      // An HQ icon can itself OCR as "3" to the left of the price. Its glyph is narrower
      // than the price, whereas a true price word is at least as wide as the quantity.
      const likelyPairs = pairs.filter(pair => pair.price.width >= pair.quantity.width);
      const best = (likelyPairs.length ? likelyPairs : pairs).sort((a, b) => a.gap - b.gap)[0];
      if (!best) continue;
      prices.push(best.price);
    }
    if (prices.length < 2 || prices.length !== expectedRows) return null;
    const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const height = median(prices.map(price => price.height));
    const rightEdges = prices.map(price => price.left + price.width);
    const rightEdge = median([...rightEdges]);
    if (rightEdges.some(right => Math.abs(right - rightEdge) > height)) return null;
    const padding = Math.max(2, Math.round(height * 0.2));
    const trim = Math.max(4, Math.round(height * 0.65));
    const verticalPadding = Math.max(7, Math.round(height * 0.7));
    const left = Math.max(0, Math.min(...prices.map(price => price.left)) - padding);
    const top = Math.max(0, Math.min(...prices.map(price => price.top)) - verticalPadding);
    const right = Math.min(imageSize.width, rightEdge - trim);
    const bottom = Math.min(imageSize.height, Math.max(...prices.map(price => price.top + price.height)) + verticalPadding);
    if (right - left < 12 || bottom - top < height * 2) return null;
    return { left, top, width: right - left, height: bottom - top };
  };

  const reconcileColumnPrices = (rows, text) => {
    const prices = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (prices.length !== rows.length || !prices.every(price => /^\d{1,9}$/.test(price) && Number(price) > 0)) return rows;
    return rows.map((row, index) => {
      if (!row.unitPrice || !Number.isInteger(Number(row.unitPrice))) return row;
      const price = String(Number(prices[index]));
      if (Number(price) === Number(row.unitPrice)) return row;
      // Never silently change a high-confidence full-row result: surface the disagreement for review.
      if (!row.needsReview) return { ...row, needsReview: true, columnDisagrees: true };
      return { ...row, unitPrice: price, needsReview: true, columnCorrected: true };
    });
  };

  const parseText = (text, reference = new Date()) => String(text || '').split(/\r?\n/).map(line => {
    const match = /^\s*(\d[\d,]*(?:\.\d+)?)[^\d\n]{1,8}(\d+).*?(\d{1,2})[/.\-](\d{1,2})\s+(\d{1,2}):([0-5]\d)\s*$/.exec(line);
    if (!match || Number(match[5]) > 23) return null;
    const date = inferDate(Number(match[3]), Number(match[4]), reference);
    return date ? { date, time: `${pad(Number(match[5]))}:${match[6]}`, unitPrice: String(Number(match[1].replace(/,/g, ''))), quantity: match[2], needsReview: true } : null;
  }).filter(Boolean);

  const mergeRows = (processedRows, originalRows) => {
    if (!processedRows.length) return originalRows.map(row => ({ ...row, needsReview: true }));
    if (processedRows.length !== originalRows.length) return processedRows.map(row => ({ ...row, needsReview: true }));
    return processedRows.map((row, index) => {
      const other = originalRows[index];
      if (!other || (row.date && other.date && row.date !== other.date) ||
        (row.time && other.time && row.time !== other.time) ||
        (row.quantity && other.quantity && row.quantity !== other.quantity)) {
        return { ...row, needsReview: true };
      }
      const merged = {
        ...row,
        date: row.date || other.date,
        time: row.time || other.time,
        quantity: row.quantity || other.quantity,
        unitPrice: row.unitPrice || other.unitPrice,
        needsReview: row.needsReview || other.needsReview || !row.date || !row.time ||
          !row.quantity || !row.unitPrice || !other.date || !other.time ||
          !other.quantity || !other.unitPrice
      };
      if (!row.unitPrice || !other.unitPrice || row.unitPrice === other.unitPrice) return merged;
      const shorter = [row.unitPrice, other.unitPrice].sort((a, b) => a.length - b.length)[0];
      const value = row.unitPrice.startsWith(shorter) && other.unitPrice.startsWith(shorter) ? shorter : row.unitPrice;
      return { ...merged, unitPrice: value, needsReview: true };
    });
  };

  const validateRows = rows => {
    const entries = [], errors = [];
    rows.forEach((row, index) => {
      if (!row.selected) return;
      const quantity = Number(row.quantity), unitPrice = Number(row.unitPrice);
      if (!validIsoDate(row.date)) return errors.push({ index, message: '日期无效' });
      if (!validTime(row.time)) return errors.push({ index, message: '时间无效' });
      if (!Number.isSafeInteger(quantity) || quantity <= 0) return errors.push({ index, message: '数量必须为正整数' });
      if (!Number.isFinite(unitPrice) || unitPrice <= 0 || unitPrice > 1e9) return errors.push({ index, message: '单价必须大于 0' });
      const total = Number((quantity * unitPrice * 1.05).toFixed(2));
      if (!Number.isFinite(total) || total <= 0) return errors.push({ index, message: '合价无效' });
      entries.push({ date: row.date, time: row.time, quantity, unitPrice, tax: 0.05, total });
    });
    if (!entries.length && !errors.length) errors.push({ index: -1, message: '请勾选至少一笔采购记录' });
    return { entries, errors };
  };

  let loadingScript;
  let activeWorker;
  let activeCancel;
  let recognitionToken = 0;
  const localUrl = name => new URL(`assets/ocr/${name}`, document.baseURI).href;
  const loadScript = () => {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    if (!loadingScript) loadingScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = localUrl('tesseract.min.js');
      script.onload = () => resolve(root.Tesseract);
      script.onerror = () => reject(new Error('本地识别组件加载失败。'));
      document.head.append(script);
    }).catch(error => { loadingScript = null; throw error; });
    return loadingScript;
  };
  const preprocess = async source => {
    const objectUrl = source instanceof Blob ? URL.createObjectURL(source) : null;
    const image = new Image();
    try {
      image.src = objectUrl || source;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 20_000_000) {
        throw new Error('图片尺寸过大或格式无法读取。');
      }
      const scale = Math.min(3, Math.max(1, 2000 / image.naturalWidth));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      for (let offset = 0; offset < pixels.data.length; offset += 400) {
        sum += (pixels.data[offset] + pixels.data[offset + 1] + pixels.data[offset + 2]) / 3;
      }
      const dark = sum / Math.ceil(pixels.data.length / 400) < 120;
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        let value = (pixels.data[offset] * .299 + pixels.data[offset + 1] * .587 + pixels.data[offset + 2] * .114);
        if (dark) value = 255 - value;
        value = Math.max(0, Math.min(255, (value - 128) * 1.4 + 128));
        pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = value;
      }
      context.putImageData(pixels, 0, 0);
      const result = canvas.toDataURL('image/png');
      canvas.width = canvas.height = 0;
      return { dataUrl: result, width: image.naturalWidth, height: image.naturalHeight };
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  };
  const recognize = async (source, progress) => {
    const token = ++recognitionToken;
    const Tesseract = await loadScript();
    const processed = await preprocess(source);
    if (token !== recognitionToken) throw new Error('识别已取消。');
    let worker;
    try {
      worker = await Tesseract.createWorker('eng', 1, {
        workerPath: localUrl('worker.min.js'),
        corePath: localUrl('').replace(/\/$/, ''),
        langPath: localUrl('lang').replace(/\/$/, ''),
        workerBlobURL: false,
        logger: message => progress?.(message)
      });
      if (token !== recognitionToken) throw new Error('识别已取消。');
      activeWorker = worker;
      const canceled = new Promise((_, reject) => { activeCancel = () => reject(new Error('识别已取消。')); });
      const result = await Promise.race([worker.recognize(processed.dataUrl, {}, { text: true, tsv: true }), canceled]);
      const original = await Promise.race([worker.recognize(source, {}, { text: true, tsv: true }), canceled]);
      const primaryRows = parseTsv(result.data.tsv);
      const originalRows = parseTsv(original.data.tsv);
      let rows = mergeRows(primaryRows.length ? primaryRows : parseText(result.data.text), originalRows.length ? originalRows : parseText(original.data.text));
      const bounds = priceColumnBounds(original.data.tsv, rows.length, processed);
      if (bounds && rows.every(row => row.unitPrice && Number.isInteger(Number(row.unitPrice)))) {
        try {
          await worker.setParameters({ tessedit_pageseg_mode: 6, tessedit_char_whitelist: '0123456789' });
          const column = await Promise.race([worker.recognize(source, { rectangle: bounds }, { text: true }), canceled]);
          let columnText = column.data.text;
          // Tesseract may merge or drop lines when the final row touches the image edge.
          // A one-pixel lower margin changes segmentation without changing the sampled prices.
          if (String(columnText || '').split(/\r?\n/).filter(line => line.trim()).length !== rows.length) {
            const retry = await Promise.race([worker.recognize(source, { rectangle: { ...bounds, height: bounds.height + 1 } }, { text: true }), canceled]);
            columnText = retry.data.text;
          }
          if (String(columnText || '').split(/\r?\n/).filter(line => line.trim()).length !== rows.length && bounds.top >= 2) {
            const retry = await Promise.race([worker.recognize(source, { rectangle: { ...bounds, top: bounds.top - 2 } }, { text: true }), canceled]);
            columnText = retry.data.text;
          }
          rows = reconcileColumnPrices(rows, columnText);
        } catch (error) {
          if (token !== recognitionToken) throw error;
          // A failed refinement must not discard the original rows.
        }
      }
      return { rows };
    } finally {
      if (token === recognitionToken) activeCancel = null;
      if (activeWorker === worker) activeWorker = null;
      if (worker) await worker.terminate();
    }
  };
  const cancel = async () => {
    recognitionToken += 1;
    const worker = activeWorker;
    activeCancel?.();
    activeCancel = null;
    activeWorker = null;
    if (worker) await worker.terminate();
  };

  const api = { inferDate, parseTsv, parseText, priceColumnBounds, reconcileColumnPrices, mergeRows, validateRows, validIsoDate, validTime, recognize, cancel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PurchaseOcr = api;
})(typeof window !== 'undefined' ? window : globalThis);
