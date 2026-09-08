/**
 * 接收者限定名（对标 joern CPG 的 CALL.methodFullName）。
 *
 * joern 每个语言前端为 `obj.method()` 生成 CALL 节点时，会同时记录 receiver 根标识符
 * 与 methodFullName，因此 `child_process.exec` 与 `RegExp.exec` 在图里是两条不同的边。
 *
 * 我们的 call_edges 表已通过解析层 P0 采集 `calleeReceiver`（obj.method() 的最左根标识符），
 * 本助手把它拼回「接收者.方法」限定名，供调用图 / 影响分析 / 执行流画像的边标签使用，
 * 使同名 sink 在画布上可区分 —— 填掉 P0 落地后「数据已采集却无画像消费」的空洞
 * （renderable≠useful 式缺口）。
 */
export function receiverQualifiedName(
  name: string,
  receiver?: string | null
): string {
  const r = (receiver ?? "").trim();
  if (!r) return name;
  return `${r}.${name}`;
}
