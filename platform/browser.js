'use strict';
window.createPoketourPlatform = function createPoketourPlatform(overrides = {}) {
  const config = overrides.config || window.POKETOUR_CONFIG || {};
  const fetcher = overrides.fetch || ((...args) => fetch(...args));
  const geolocation = Object.hasOwn(overrides, 'geolocation') ? overrides.geolocation : globalThis.navigator?.geolocation;
  const lifecycleDocument = overrides.document || document;
  const lifecycleWindow = overrides.window || window;
  const base = (config.apiBaseUrl || '').replace(/\/$/, '');
  const browserMode = config.storageMode === 'browser';
  let runtime;
  const browserStore = () => runtime ||= (overrides.browserStore ? Promise.resolve(overrides.browserStore) : import('./browser-store.mjs').then(module => module.createBrowserStore()));
  if (base && (!/^https:\/\//.test(base) || new URL(base).username || new URL(base).password)) throw Error('API base URL must use HTTPS without embedded credentials.');
  return {
    browserMode,
    saveLabel: browserMode ? '이 브라우저에 저장됨' : '로컬 서버에 저장됨',
    allowDebug: !browserMode && config.allowDebug !== false,
    apiFetch(path, options) {
      if (!path.startsWith('/api/')) throw Error('Expected an API path');
      if (browserMode) return browserStore().then(store => store.request(path, options));
      return fetcher(base + path, options);
    },
    assets: { fetch: (path, options) => fetcher('./' + path, options) },
    auth: {
      loginUrl: config.auth?.loginUrl || './',
      loginLabel: config.auth?.loginLabel || '다시 불러오기',
    },
    backup: () => browserStore().then(store => store.backup()),
    restore: backup => browserStore().then(store => store.restore(backup)),
    location: {
      available: !!geolocation,
      watchPosition: (...args) => geolocation?.watchPosition(...args),
      clearWatch: id => geolocation?.clearWatch(id),
    },
    lifecycle: {
      onResume(callback) {
        const handler = () => { if (!lifecycleDocument.hidden) callback(); };
        lifecycleDocument.addEventListener('visibilitychange', handler);
        return () => lifecycleDocument.removeEventListener('visibilitychange', handler);
      },
      onPageHide(callback) { lifecycleWindow.addEventListener('pagehide', callback); },
    },
  };
};
window.PoketourPlatform = window.createPoketourPlatform();
