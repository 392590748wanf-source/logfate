const { contextBridge } = require('electron');

function cacheBestCraftMacros() {
  if (location.origin !== 'https://tnze.yyyy.games') return;
  const storageKey = 'gilfate-bestcraft-solved-macros:v1';
  const limit = 256;
  const solverNames = ['dfs_solve', 'nq_solve', 'reflect_solve', 'raphael_solve'];
  const validActions = actions => Array.isArray(actions) && actions.length > 0 && actions.length <= 500
    && actions.every(action => typeof action === 'string' && /^[a-z][a-z_]{0,63}$/.test(action));
  const readCache = () => {
    try {
      const entries = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return Array.isArray(entries) ? new Map(entries.slice(-limit).filter(entry =>
        Array.isArray(entry) && typeof entry[0] === 'string' && validActions(entry[1]))) : new Map();
    } catch {
      return new Map();
    }
  };
  const save = (key, actions) => {
    try {
      const entries = readCache();
      entries.delete(key);
      entries.set(key, actions);
      localStorage.setItem(storageKey, JSON.stringify([...entries].slice(-limit)));
    } catch {
      // Storage failures leave the original solver result available to BestCraft.
    }
  };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      const source = new URL(url, location.href);
      if (source.origin !== location.origin || !/^\/assets\/SolverWorker-[\w-]+\.js$/.test(source.pathname)) return;
      let key;
      this.addEventListener('message', ({ data }) => {
        if (key && validActions(data)) save(key, data);
      });
      const send = this.postMessage.bind(this);
      this.postMessage = (message, ...transfer) => {
        key = undefined;
        if (solverNames.includes(message?.name) && typeof message.args === 'string' && message.args.length <= 16384) {
          try {
            const { status } = JSON.parse(message.args);
            const content = document.getElementById('app')?.__vue_app__?.config.globalProperties.$pinia?.state.value.designer?.content;
            if (location.hash.split('?')[0] === '#/designer' && content?.item && status?.attributes && status.recipe) {
              // The request contains effective stats, quality, durability, buffs and
              // solver options. The recipe identity distinguishes equivalent recipes.
              key = JSON.stringify([source.pathname, content.recipeId ?? null, content.item.id, content.job, message.name, message.args]);
              const cached = readCache().get(key);
              if (cached) {
                setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: cached })), 0);
                return;
              }
            }
          } catch {
            // If BestCraft changes its request or page structure, solve normally.
          }
        }
        send(message, ...transfer);
      };
    }
  };
}

contextBridge.executeInMainWorld({ func: cacheBestCraftMacros });
