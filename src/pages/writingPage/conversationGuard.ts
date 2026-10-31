// 会话归属守卫（第十二轮批①，2026-10-31）
//
// 病灶：AiCorpusPanel 的 sendAndRefresh 在 await（发消息 + 拉消息列表）期间不校验
// 会话归属。面板随 chatTitle（按书）切换**不卸载**——生成/发送中途切到另一本书，
// 旧请求照样 resolve，返回的是 A 书会话的消息，却被 setMessages 灌进当前（B 书）
// 面板显示；handleGenerate 更把 A 书的推荐句 setGenCards 写入当前 state，
// 持久化 effect 随即以 B 书的键落盘——**B 书已有的生成结果被 A 书结果覆盖**（数据损坏），
// 且用户看到的推荐句全部来自另一本书的上下文（语义污染）。
// 与第七轮「内联 AI 跨章守卫」（inlineChapterIdRef）同一病灶家族：异步结果按
// 「发起时的归属」落账，归属已变即作废，绝不写进别的会话/别的书。
//
// 口径：
// - 发起时捕获 owner（当时的 convId），resolve 时与当前 convId 比对；
// - null 也是合法值（会话尚未建立/已销毁），只有「相等」才算归属未变；
// - 作废路径：不 setMessages、不 setGenCards、返回 null（调用方按既有 !rows 分支安静收敛）。
//   旧结果不丢——它已在 A 书会话历史里落库，切回 A 书由 open effect 重新拉取。

/** 会话是否已切走：owner（发起时 convId）与当前 convId 不同即过期。 */
export function isConvStale(ownerConvId: string | null, currentConvId: string | null): boolean {
  return ownerConvId !== currentConvId;
}
