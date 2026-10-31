// 拖拽期间的全局副作用守卫（写作台三处宽度手柄共用）
//
// 事故背景：左栏（WritingPage）、右抽屉（WritingDrawer）、语料参考面板
// （CorpusReferencePanel）都在 pointerdown 时写 `document.body.style.userSelect = 'none'`，
// 只在 pointerup / pointercancel / 双击复位里复位。但这三处组件全部挂在
// `rightTab === 'body'` 分支内：用户**按住手柄拖动中途**切到「章详情 / 设定卡」
// （键盘快捷键、左栏章节树点击等入口不需要先松手），组件立即卸载 →
// window 上的 pointerup 监听随 effect cleanup 一起摘掉，永远等不到复位 →
// body 上残留 userSelect:none，切回正文后**整页文字无法选中**（选区、双击选词、
// Cmd+C 全失效），只能靠再拖一次手柄碰巧复位。这属于「隐藏的布局外副作用」，
// 症状离病灶很远（病灶在抽屉、症状在正文编辑区），故单独收敛成一个守卫。
//
// 设计：把「拖拽会话是否仍持有 body 样式」这件事交给 cleanup 兜底 ——
// 卸载时只要会话没正常结束，就把 body.userSelect 还原成挂载前记录的值
// （而不是硬写 ''，避免覆盖宿主页面本来的选区设置）。
import { useCallback, useEffect, useRef } from 'react';

/**
 * 返回 `begin`（进入拖拽态、接管 body.userSelect）与 `release`（结束拖拽态）。
 * 二者都必须幂等：重复 begin 只记一次原始值，重复 release 不产生副作用。
 */
export function useDragBodyGuard(): {
  begin: () => void;
  release: () => void;
} {
  /** 接管前的 body.userSelect 原值（null = 当前未接管） */
  const restoreRef = useRef<string | null>(null);

  const begin = useCallback(() => {
    if (restoreRef.current !== null) return;
    restoreRef.current = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
  }, []);

  const release = useCallback(() => {
    if (restoreRef.current === null) return;
    document.body.style.userSelect = restoreRef.current;
    restoreRef.current = null;
  }, []);

  // 卸载兜底：拖拽中途组件被卸载（切视图 / 切书 / 关抽屉）时还原样式
  useEffect(
    () => () => {
      if (restoreRef.current !== null) {
        document.body.style.userSelect = restoreRef.current;
        restoreRef.current = null;
      }
    },
    [],
  );

  return { begin, release };
}
