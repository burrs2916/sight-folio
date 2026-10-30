// AI 语料「生成卡片」删除后的编辑下标校正（纯函数）
//
// 背景：生成结果区每张卡片同时挂着「就地编辑」和「删除」入口，二者可交叉操作。
// 正在编辑第 2 张时点掉第 1 张的删除，是正常操作序列。数组收缩后若编辑下标不跟着走：
//   cur === i（删的正是正在编辑的那张）→ 应退出编辑态；
//   cur >  i（删的是它前面的卡）    → 下标必须前移 1，否则指向别的卡片，
//                                     保存时会把当前草稿**覆盖到错误的卡片**（数据损坏）；
//   cur <  i                        → 不受影响。
// 旧实现只处理了 cur === i 归零，漏掉前移分支。
export type NullableEditIndex = number | null;

/**
 * 计算删除下标 deleteIdx 之后，编辑下标 editIdx 应有的新值。
 * 入参为 null 表示当前不在编辑态，直接返回 null。
 */
export function shiftEditIndexAfterDelete(editIdx: NullableEditIndex, deleteIdx: number): NullableEditIndex {
  if (editIdx === null) return null;
  if (editIdx === deleteIdx) return null;
  return editIdx > deleteIdx ? editIdx - 1 : editIdx;
}
