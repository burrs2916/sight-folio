// 测试统一在中文环境下运行（项目主语言），保证 i18n 的 t() 翻译与既有中文断言一致。
// 必须在 i18n 模块首次被导入前设定，否则 getInitialLang() 会按 jsdom 默认的 en-US 推断。

// jsdom 27 未在 window 上暴露 localStorage（升级后测试环境回退），导致全部依赖
// localStorage 的测试（T5 崩溃恢复草稿层等 49 个文件）在 beforeEach 即失败。
// 仅当缺失时挂一个内存版 Storage 垫片；jsdom 自带时此块不生效。
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(String(k), String(v));
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: shim, configurable: true });
}

try {
  localStorage.setItem("project-sight-locale", "zh-CN");
} catch {
  /* localStorage 不可用时忽略，回落到默认语言 */
}
