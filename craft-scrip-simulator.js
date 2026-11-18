(function (root, factory) {
  const simulator = factory();
  if (typeof module === 'object' && module.exports) module.exports = simulator;
  else root.CraftScripSimulator = simulator;
})(globalThis, function () {
  const assetRoot = 'https://tnze.yyyy.games/assets/';
  const engine = 'app_wasm-BVsPZCk_.js';
  const binary = 'app_wasm_bg-CAusScub.wasm';
  const dataVersion = 'a72e645591e5bf8b';
  // Increase the cache revision when simulation rules or macro timings change.
  const cacheKey = `ff14-craft-scrip-macros:v1:${dataVersion}:${engine}:${binary}`;
  const planCacheKey = `ff14-craft-scrip-hq:v1:${dataVersion}:${engine}:${binary}`;
  const cacheLimit = 256;
  const maxHqAttempts = 12;
  const api = 'https://v2.xivapi.com/api/sheet/';
  const skills = {
    basic_synthesis: ['制作', 3], basic_touch: ['加工', 3], masters_mend: ['精修', 3],
    observe: ['观察', 3], waste_not: ['俭约', 2], veneration: ['崇敬', 2],
    standard_touch: ['中级加工', 3], great_strides: ['阔步', 2], innovation: ['改革', 2],
    final_appraisal: ['最终确认', 2], waste_not_ii: ['长期俭约', 2],
    byregot_s_blessing: ['比尔格的祝福', 3], muscle_memory: ['坚信', 3],
    careful_synthesis: ['模范制作', 3], manipulation: ['掌握', 2], prudent_touch: ['俭约加工', 3],
    reflect: ['闲静', 3], preparatory_touch: ['坯料加工', 3], groundwork: ['坯料制作', 3],
    delicate_synthesis: ['精密制作', 3], trained_eye: ['工匠的神速技巧', 3],
    advanced_touch: ['上级加工', 3], prudent_synthesis: ['俭约制作', 3], trained_finesse: ['工匠的神技', 3],
    refined_touch: ['精炼加工', 3], immaculate_mend: ['巧夺天工', 3], trained_perfection: ['工匠的绝技', 3]
  };

  async function solveInWorker(request, config, publish) {
    const get = async (sheet, id, fields) => {
      const response = await fetch(`${config.api}${sheet}/${id}?version=${config.dataVersion}&fields=${encodeURIComponent(fields)}`);
      if (!response.ok) throw new Error('配方资料获取失败');
      const data = await response.json();
      if (data.row_id !== id || data.version !== config.dataVersion || !data.fields) throw new Error('配方资料版本不匹配');
      return data.fields;
    };
    const recipe = await get('Recipe', request.recipeId, 'ItemResult@as(raw),CraftType@as(raw),RecipeLevelTable@as(raw),DifficultyFactor,QualityFactor,DurabilityFactor,RequiredCraftsmanship,RequiredControl,IsExpert,AmountResult,MaterialQualityFactor,Ingredient@as(raw),AmountIngredient');
    if (recipe['ItemResult@as(raw)'] !== request.itemId || recipe['CraftType@as(raw)'] !== request.job || recipe.AmountResult !== request.output) {
      throw new Error('配方、职业或产出与本机资料不匹配');
    }
    if (recipe.IsExpert) throw new Error('高难度配方暂无法自动核验');
    if (request.attributes.craftsmanship < recipe.RequiredCraftsmanship || request.attributes.control < recipe.RequiredControl) {
      throw new Error('当前方案配装未达到制作门槛');
    }
    const levelId = recipe['RecipeLevelTable@as(raw)'];
    const level = await get('RecipeLevelTable', levelId, 'ClassJobLevel,Stars,SuggestedCraftsmanship,SuggestedControl,Difficulty,Quality,ProgressDivider,QualityDivider,ProgressModifier,QualityModifier,Durability,ConditionsFlag');
    if (level.ConditionsFlag !== 15) throw new Error('当前配方的制作状态暂无法自动核验');
    const rlv = {
      id: levelId, class_job_level: level.ClassJobLevel, stars: level.Stars,
      suggested_craftsmanship: level.SuggestedCraftsmanship, suggested_control: level.SuggestedControl ?? null,
      difficulty: level.Difficulty, quality: level.Quality, durability: level.Durability,
      progress_divider: level.ProgressDivider, quality_divider: level.QualityDivider,
      progress_modifier: level.ProgressModifier, quality_modifier: level.QualityModifier, conditions_flag: level.ConditionsFlag
    };
    const difficulty = Math.floor(level.Difficulty * recipe.DifficultyFactor / 100);
    const quality = Math.floor(level.Quality * recipe.QualityFactor / 100);
    const durability = Math.floor(level.Durability * recipe.DurabilityFactor / 100);
    // The game shows collectability on a scale of 1 per 10 quality.
    const targetQuality = request.target * 10;
    if (!rlv.class_job_level || !difficulty || !quality || !durability || targetQuality > quality) {
      throw new Error('缺少适用的配方难度或收藏价值资料');
    }
    const wasm = await import(config.assetRoot + config.engine);
    await wasm.default({ module_or_path: config.assetRoot + config.binary });
    const recipeInfo = {
      rlv, job_level: level.ClassJobLevel, difficulty, quality, durability, conditions_flag: level.ConditionsFlag
    };
    const baseStatus = wasm.new_status(request.attributes, recipeInfo, 0);
    const newStatus = initialQuality => ({ ...baseStatus, quality: initialQuality });
    const replay = (start, actions) => {
      if (!actions.every(action => Object.hasOwn(config.skills, action))) return null;
      const successors = { Normal: ['Normal', 'Good', 'Excellent'], Good: ['Normal'], Excellent: ['Poor'], Poor: ['Normal'] };
      let states = new Map([['Normal', start]]);
      for (const action of actions) {
        const next = new Map();
        for (const [condition, state] of states) {
          const result = wasm.simulate({ ...state, condition }, [action]);
          if (result.errors.length) return null;
          // Allowed actions have deterministic CP, durability and progress with
          // these four conditions. Keep the lowest quality at each next condition.
          for (const nextCondition of successors[condition]) {
            const previous = next.get(nextCondition);
            if (!previous || result.status.quality < previous.quality) next.set(nextCondition, result.status);
          }
        }
        states = next;
      }
      return [...states.values()].reduce((worst, state) => state.quality < worst.quality ? state : worst);
    };
    const qualityRotation = [
      'reflect', 'manipulation', 'waste_not_ii', 'innovation', 'preparatory_touch',
      'preparatory_touch', 'preparatory_touch', 'preparatory_touch', 'innovation', 'great_strides', 'byregot_s_blessing'
    ];
    const findMacro = (initialQuality, seeds = [], useRaphael = false) => {
      const start = newStatus(initialQuality);
      const prefixes = [
        [], ['trained_eye'], ['reflect'], ['reflect', 'basic_touch', 'refined_touch'],
        ['reflect', 'innovation', 'preparatory_touch', 'basic_touch'],
        ['reflect', 'innovation', 'great_strides', 'preparatory_touch'],
        ['reflect', 'innovation', 'great_strides', 'byregot_s_blessing'],
        qualityRotation,
        ['reflect', 'trained_perfection', 'basic_touch', ...qualityRotation.slice(1)],
        ['reflect', 'basic_touch', 'trained_perfection', ...qualityRotation.slice(1)]
      ];
      const reflection = wasm.reflect_solve(start, false);
      for (let count = 2; count <= Math.min(12, reflection.length); count++) prefixes.push(reflection.slice(0, count));
      const unique = new Set();
      let best = null;
      const consider = actions => {
        if (!actions.length) return;
        const result = replay(start, actions);
        if (!result || result.quality < targetQuality || result.progress < difficulty) return;
        const seconds = actions.reduce((sum, action) => sum + config.skills[action][1], 0);
        if (!best || seconds < best.seconds) best = { actions, seconds, collectability: Math.floor(result.quality / 10) };
      };
      seeds.forEach(consider);
      if (useRaphael) {
        try { consider(wasm.raphael_solve(start, targetQuality, true, false, false, false, false, true, 0)); }
        catch { /* The cheaper rotations can still provide a verified result. */ }
      }
      for (const prefix of prefixes) {
        const key = prefix.join(',');
        if (unique.has(key)) continue;
        unique.add(key);
        const state = replay(start, prefix);
        if (!state || state.quality < targetQuality) continue;
        try {
          const completions = state.progress >= difficulty ? [[]] : [
            wasm.nq_solve(state, 5, false),
            ['veneration', 'groundwork', 'groundwork', 'groundwork', 'groundwork']
          ];
          for (const tail of completions) {
            // Stop adding actions as soon as the recipe completes.
            const actions = [...prefix];
            let remainder = state;
            for (const action of tail) {
              if (remainder.progress >= difficulty) break;
              const step = wasm.simulate(remainder, [action]);
              if (step.errors.length) break;
              actions.push(action);
              remainder = step.status;
            }
            if (remainder.progress >= difficulty) consider(actions);
          }
        } catch {
          // A prefix may meet the target but leave too little durability or CP.
        }
      }
      return best;
    };
    const format = (best, initialQuality) => {
      const lines = best.actions.map(action => {
        const [name, wait] = config.skills[action];
        return `/ac "${name}" <wait.${wait}>`;
      });
      const scripts = [];
      for (let offset = 0; offset < lines.length; offset += 15) scripts.push(lines.slice(offset, offset + 15).join('\n'));
      return { seconds: best.seconds, collectability: best.collectability, scripts, initialQuality };
    };
    const zero = findMacro(0);
    if (zero) return { macros: [format(zero, 0)], ingredients: [], qualityCap: 0 };

    const amounts = new Map();
    for (const [index, uid] of (recipe['Ingredient@as(raw)'] || []).entries()) {
      const amount = recipe.AmountIngredient?.[index];
      if (uid > 0 && amount > 0) amounts.set(uid, (amounts.get(uid) || 0) + amount);
    }
    if (!amounts.size || !Number.isFinite(recipe.MaterialQualityFactor)) throw new Error('缺少初期品质配方资料');
    if (!recipe.MaterialQualityFactor) throw new Error('此配方无法通过 HQ 材料提高初期品质');
    const response = await fetch(`${config.api}Item?version=${config.dataVersion}&rows=${[...amounts.keys()].join(',')}&fields=CanBeHq,LevelItem%40as(raw)`);
    if (!response.ok) throw new Error('HQ 垫料资料获取失败');
    const items = await response.json();
    if (items.version !== config.dataVersion || !items.rows?.length) throw new Error('HQ 垫料资料版本不匹配');
    const ingredients = [];
    for (const [uid, amount] of amounts) {
      const fields = items.rows.find(row => row.row_id === uid)?.fields;
      const itemLevel = fields?.['LevelItem@as(raw)'];
      if (typeof fields?.CanBeHq !== 'boolean' || (fields.CanBeHq && !(itemLevel > 0))) throw new Error('缺少 HQ 垫料资料');
      if (fields.CanBeHq) ingredients.push({ uid, amount, level: itemLevel });
    }
    if (!ingredients.length) throw new Error('此配方没有可提高初期品质的 HQ 材料');
    const qualityCap = quality * recipe.MaterialQualityFactor / 100;
    const totalWeight = ingredients.reduce((sum, item) => sum + item.amount * item.level, 0);
    const startingQuality = weight => Math.floor(qualityCap * (weight / totalWeight));
    let weights = new Set([0]);
    for (const item of ingredients) {
      const next = new Set();
      for (const weight of weights) {
        for (let count = 0; count <= item.amount; count++) next.add(weight + count * item.level);
      }
      weights = next;
    }
    const qualities = [...new Set([...weights].map(startingQuality))].filter(Boolean).sort((a, b) => b - a);
    const steps = Math.min(qualities.length, config.maxHqAttempts);
    const macros = [];
    const seeds = [];
    for (let step = 0; step < steps; step++) {
      const initialQuality = qualities[Math.floor(step * (qualities.length - 1) / Math.max(1, steps - 1))];
      addCandidate(initialQuality);
    }
    // The full solver is slower. Try roughly half the available starting
    // quality first, then inspect the highest quality for a faster rotation.
    const halfway = qualities.findLast(value => value >= qualityCap / 2) || qualities[0];
    for (const initialQuality of new Set([halfway, qualities[0]])) addCandidate(initialQuality, true);
    if (!macros.length) throw new Error('尝试 HQ 垫料后，当前配装仍未找到可稳定达到最高档的宏');
    return { macros, ingredients, qualityCap };

    function addCandidate(initialQuality, useRaphael = false) {
      const best = findMacro(initialQuality, seeds, useRaphael);
      if (!best) return;
      // Find the least quality that still gives the same verified reward with this macro.
      let lower = 0, upper = initialQuality;
      while (lower < upper) {
        const middle = Math.floor((lower + upper) / 2);
        const result = replay(newStatus(middle), best.actions);
        if (result && result.quality >= targetQuality) upper = middle;
        else lower = middle + 1;
      }
      const result = replay(newStatus(lower), best.actions);
      if (macros.some(macro => macro.initialQuality <= lower && macro.seconds <= best.seconds)) return;
      seeds.push(best.actions);
      for (let index = macros.length - 1; index >= 0; index--) {
        if (macros[index].initialQuality >= lower && macros[index].seconds >= best.seconds) macros.splice(index, 1);
      }
      macros.push(format({ ...best, collectability: Math.floor(result.quality / 10) }, lower));
      publish({ macros, ingredients, qualityCap });
    }
  }

  function runWorker(request, onCandidate) {
    const config = { assetRoot, engine, binary, dataVersion, api, skills, maxHqAttempts };
    const source = `self.onmessage = async ({ data }) => {
      try { self.postMessage({ plan: await (${solveInWorker})(data, ${JSON.stringify(config)}, partial => self.postMessage({ partial })) }); }
      catch (error) { self.postMessage({ error: error?.message || String(error) }); }
    };`;
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      let worker;
      try { worker = new Worker(url); }
      finally { URL.revokeObjectURL(url); }
      let partial;
      const finish = (error, plan) => {
        clearTimeout(timer);
        worker.terminate();
        if (error && !partial) reject(new Error(error));
        else resolve(plan || partial);
      };
      const timer = setTimeout(() => finish('后台模拟超时'), 90_000);
      worker.onmessage = ({ data }) => {
        if (data.partial) {
          partial = data.partial;
          onCandidate?.(partial);
        } else finish(data.error, data.plan);
      };
      worker.onerror = () => finish('后台模拟器加载失败');
      worker.postMessage(request);
    });
  }

  let queue = Promise.resolve();
  function solve(request, onCandidate) {
    const pending = queue.then(() => runWorker(request, onCandidate));
    queue = pending.catch(() => {});
    return pending;
  }

  function validMacro(macro, target) {
    if (!Number.isSafeInteger(target) || target <= 0 || !Number.isSafeInteger(macro?.seconds) || macro.seconds <= 0
        || !Number.isSafeInteger(macro.collectability) || macro.collectability < target
        || !Array.isArray(macro.scripts) || !macro.scripts.length) return false;
    let seconds = 0;
    for (const script of macro.scripts) {
      if (typeof script !== 'string') return false;
      const lines = script.split('\n');
      if (lines.length > 15) return false;
      for (const line of lines) {
        const match = /^\/ac "[^"\r\n]+" <wait\.([23])>$/.exec(line);
        if (!match) return false;
        seconds += Number(match[1]);
      }
    }
    return seconds === macro.seconds;
  }

  function validPlan(plan, target) {
    return Array.isArray(plan?.macros) && plan.macros.length > 0 && plan.macros.length <= maxHqAttempts + 2
      && Number.isFinite(plan.qualityCap) && plan.qualityCap >= 0
      && Array.isArray(plan.ingredients) && plan.ingredients.length <= 8
      && new Set(plan.ingredients.map(item => item?.uid)).size === plan.ingredients.length
      && plan.ingredients.every(item => Number.isSafeInteger(item?.uid) && item.uid > 0
        && Number.isSafeInteger(item.amount) && item.amount > 0 && item.amount <= 255
        && Number.isSafeInteger(item.level) && item.level > 0)
      && plan.macros.every(macro => validMacro(macro, target) && Number.isSafeInteger(macro.initialQuality)
        && macro.initialQuality >= 0 && macro.initialQuality <= plan.qualityCap);
  }

  function cheapestPlan(plan, prices, hourlyRate) {
    const totalWeight = plan.ingredients.reduce((sum, item) => sum + item.level * item.amount, 0);
    let combinations = new Map([[0, { cost: 0, counts: [] }]]);
    for (const item of plan.ingredients) {
      const { hq = 0, nq = 0 } = prices.get(item.uid) || {};
      const next = new Map();
      for (const [weight, combination] of combinations) {
        for (let count = 0; count <= item.amount; count++) {
          const remaining = item.amount - count;
          if ((count && !(hq > 0)) || (remaining && !(nq > 0))) continue;
          const newWeight = weight + count * item.level;
          const cost = combination.cost + count * hq + remaining * nq;
          if (!next.has(newWeight) || cost < next.get(newWeight).cost) {
            next.set(newWeight, { cost, counts: [...combination.counts, count] });
          }
        }
      }
      combinations = next;
    }
    let selected = null;
    for (const [weight, combination] of combinations) {
      const initialQuality = totalWeight ? Math.floor(plan.qualityCap * (weight / totalWeight)) : 0;
      const hqCount = combination.counts.reduce((sum, count) => sum + count, 0);
      for (const macro of plan.macros) {
        if (initialQuality < macro.initialQuality) continue;
        const cost = combination.cost + macro.seconds * hourlyRate / 3600;
        if (!selected || cost < selected.cost || (cost === selected.cost && hqCount < selected.hqCount)) {
          selected = { macro, cost, hqCount, initialQuality,
            hqCounts: new Map(plan.ingredients.map((item, index) => [item.uid, combination.counts[index]])) };
        }
      }
    }
    return selected;
  }

  function readCache(storage) {
    try {
      const entries = new Map();
      for (const storageKey of [cacheKey, planCacheKey]) {
        let saved;
        try { saved = JSON.parse(storage.getItem(storageKey) || '[]'); }
        catch { continue; }
        if (!Array.isArray(saved)) continue;
        for (const entry of saved.slice(-cacheLimit)) {
          if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
          const [key, value] = entry;
          try {
            const plan = storageKey === cacheKey && Array.isArray(value?.hqIngredients) && !value.hqIngredients.length
              ? { macros: [{ ...value, initialQuality: 0 }], ingredients: [], qualityCap: 0 } : value?.plan || value;
            const target = JSON.parse(key)?.target;
            if (validPlan(plan, target)) entries.set(key, { plan });
            else if (storageKey === planCacheKey && Number.isSafeInteger(target) && target > 0
                && typeof value?.error === 'string' && value.error && value.error.length <= 240) {
              entries.set(key, { error: value.error });
            }
          } catch { /* Skip damaged entries. */ }
        }
      }
      return entries;
    } catch {
      return new Map();
    }
  }

  function writeCache(storage, key, result) {
    try {
      const entries = readCache(storage);
      entries.delete(key);
      entries.set(key, result);
      storage.setItem(planCacheKey, JSON.stringify([...entries].slice(-cacheLimit)));
    } catch {
      // Keep the current session usable if storage is unavailable or full.
    }
  }

  return { solve, validPlan, cheapestPlan, readCache, writeCache };
});
