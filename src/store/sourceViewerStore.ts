/**
 * 源码查看器状态（画布实体 / 符号 / 审查发现 → 代码行的最后一跳）
 *
 * 需求 §2 概念映射表 EventBinding 要求「点击实体跳转到对应代码行」。
 * 在此之前，分析器能算出「这个文件圈复杂度 42、有 3 处 FIXME、被引用 17 次」，
 * 但用户看完这些数字之后无路可走 —— 看不到代码本身，分析就停在了结论上。
 *
 * 这个 store 是全局单例：任何面板只要拿到 fileId 就能把源码拉起来，
 * 不需要各自实现一遍加载/错误/滚动定位。
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { projectScanApi, type SourceFileContent } from "../services/tauri";

/** 行内标记：在源码左侧沟槽上标出「这一行有什么问题」 */
export interface SourceMark {
  line: number;
  label: string;
  severity: "error" | "warning" | "info" | "debt" | "symbol";
  /** 关联的审查发现 id（仅审查发现标记携带），供编辑器内联标记点击回查并聚焦/行动 */
  findingId?: string;
}

interface SourceViewerState {
  open: boolean;
  loading: boolean;
  error: string | null;
  content: SourceFileContent | null;
  /** 打开时要跳转并高亮的行号（1 起）；null 表示从头显示 */
  targetLine: number | null;
  /** 副标题：说明"为什么跳到这里"，如「FIXME: 需要重构」 */
  reason: string | null;
  /** 沟槽标记（技术债 / 审查发现 / 符号定义位置） */
  marks: SourceMark[];
  /** 每次 open 自增，供查看器识别"同一文件的新一次跳转"以重新滚动 */
  seq: number;
}

interface SourceViewerActions {
  /** 打开源码查看器并定位到指定行 */
  openSource: (opts: {
    fileId: string;
    line?: number | null;
    reason?: string | null;
    marks?: SourceMark[];
  }) => Promise<void>;
  /** 在已打开的文件内跳到另一行（不重新读盘） */
  jumpTo: (line: number, reason?: string | null) => void;
  close: () => void;
}

export type SourceViewerStore = SourceViewerState & SourceViewerActions;

let _seq = 0;

export const useSourceViewerStore = create<SourceViewerStore>()(
  immer((set, get) => ({
    open: false,
    loading: false,
    error: null,
    content: null,
    targetLine: null,
    reason: null,
    marks: [],
    seq: 0,

    openSource: async ({ fileId, line = null, reason = null, marks = [] }) => {
      _seq += 1;
      const seq = _seq;
      // 同一个文件重复打开时不重新读盘，只移动高亮行 —— 从左侧列表连点
      // 多个技术债标记时体验差别很大（不会闪一下白屏）。
      const cached = get().content;
      if (cached && cached.fileId === fileId) {
        set((s) => {
          s.open = true;
          s.loading = false;
          s.error = null;
          s.targetLine = line;
          s.reason = reason;
          s.marks = marks.length > 0 ? marks : s.marks;
          s.seq = seq;
        });
        return;
      }

      set((s) => {
        s.open = true;
        s.loading = true;
        s.error = null;
        s.content = null;
        s.targetLine = line;
        s.reason = reason;
        s.marks = marks;
        s.seq = seq;
      });

      try {
        const content = await projectScanApi.readSourceFile(fileId);
        // 加载期间用户可能已经点开了别的文件，丢弃过期响应
        if (get().seq !== seq) return;
        set((s) => {
          s.content = content;
          s.loading = false;
        });
      } catch (e) {
        if (get().seq !== seq) return;
        set((s) => {
          s.loading = false;
          s.error = e instanceof Error ? e.message : String(e);
        });
      }
    },

    jumpTo: (line, reason = null) => {
      _seq += 1;
      const seq = _seq;
      set((s) => {
        s.targetLine = line;
        s.reason = reason;
        s.seq = seq;
      });
    },

    close: () => {
      set((s) => {
        s.open = false;
        s.targetLine = null;
        s.reason = null;
      });
    },
  }))
);

/** 便捷函数：非 React 上下文（画布事件、工具函数）中打开源码 */
export function openSourceAt(
  fileId: string,
  line?: number | null,
  reason?: string | null,
  marks?: SourceMark[]
) {
  void useSourceViewerStore.getState().openSource({ fileId, line, reason, marks });
}
