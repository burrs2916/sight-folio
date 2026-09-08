// 测试统一在中文环境下运行（项目主语言），保证 i18n 的 t() 翻译与既有中文断言一致。
// 必须在 i18n 模块首次被导入前设定，否则 getInitialLang() 会按 jsdom 默认的 en-US 推断。
try {
  localStorage.setItem("project-sight-locale", "zh-CN");
} catch {
  /* localStorage 不可用时忽略，回落到默认语言 */
}
