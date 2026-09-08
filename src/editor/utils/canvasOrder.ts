// project-sight: 画布渲染顺序辅助
//
// ─── 历史教训（2026-08-19）───
// SceneEditor 的画布 .map() 必须让 dependency-edge 排在非边前面（让实体 DOM
// 在后、视觉/命中测试都在上层）。第一次写时用了单数组分桶：
//   const out = [];
//   let edgeEnd = 0;
//   for (...) { if (edge) out[edgeEnd++] = c; else out.push(c); }
// 在 edges 与非边交替（[F1 F2 E1 E2]）时，edge 写入 out[0..edgeEnd] 会**覆盖**
// 之前 push 的非边位置，导致 F1/F2 永久丢失 —— 观感即「实体突然看不见」。
// 三关测试能过是因为 typescript 类型对，运行时是数量错位，纯单元测试才能拦下。
// 故独立成纯函数 + 重点回归测试。

import type { SceneComponent } from "../../types/editor";

/**
 * 视口过滤 + 排序：依赖边先于实体。
 *
 * @param components 画布全部实体（通常来自 useEditorStore(s => s.components)）
 * @param visibleEntityIds null = 视口裁剪未就绪，全量渲染；非 null = 仅渲染视口内
 * @returns 新数组：dependency-edge 在前（保持原顺序），其余实体在后（保持原顺序）
 */
export function sortComponentsEdgesFirst(
  components: SceneComponent[],
  visibleEntityIds: Set<string> | null,
): SceneComponent[] {
  const visible = visibleEntityIds
    ? components.filter((c) => visibleEntityIds.has(c.id))
    : components;
  const edges: SceneComponent[] = [];
  const others: SceneComponent[] = [];
  // 两段独立 push，不共享底层数组 → 边与非边交替写入时不会互相覆盖。
  for (let i = 0; i < visible.length; i++) {
    const c = visible[i];
    if (c.type === "dependency-edge") edges.push(c);
    else others.push(c);
  }
  return edges.concat(others);
}