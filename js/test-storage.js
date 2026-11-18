/* GitHub Pages shares one origin across projects. Keep test data separate. */
(() => {
  const separate = new URL(document.currentScript.src).pathname === '/kaku_test/js/test-storage.js';
  const prefix = separate ? 'kaku-test-web:' : '';
  const keys = () => {
    const storage = window.localStorage, out = [];
    for (let i=0; i<storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
    return out;
  };
  window.kakuTestWeb = separate;
  window.kakuStorage = Object.freeze({
    getItem(key) { return window.localStorage.getItem(prefix + key); },
    setItem(key, value) { window.localStorage.setItem(prefix + key, value); },
    removeItem(key) { window.localStorage.removeItem(prefix + key); },
    get length() { return keys().length; },
    key(index) { return keys()[index] ?? null; },
  });
})();
