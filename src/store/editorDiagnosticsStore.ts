import { create } from "zustand";

/**
 * 编辑器实时诊断（取自 Monaco 内置标记，对标 VS Code 红波浪线）。
 *
 * 用途：把「正在写的代码里的真实语法/类型错误」暴露给 AI 面板，让它能做
 * VS Code 式「修复此错误」——这是原面板（围着预计算扫描台账转）完全缺失的能力。
 *
 * 共享模型：编辑器（MonacoCodeEditor）与 AI 面板（WorkbenchAiPanel）在同一 webview 内，
 * 用模块级 store 打通，无需 prop 透传。无实时编辑器时（主窗口分析页）诊断自然为空，优雅降级。
 */
export interface EditorDiagnostic {
  message: string;
  severity: "error" | "warning";
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  code?: string;
  source?: string;
}

interface EditorDiagnosticsState {
  /** 按文件相对路径索引的诊断列表 */
  byRelPath: Record<string, EditorDiagnostic[]>;
  setDiagnostics: (relPath: string, diags: EditorDiagnostic[]) => void;
  clear: (relPath: string) => void;
}

export const useEditorDiagnosticsStore = create<EditorDiagnosticsState>((set) => ({
  byRelPath: {},
  setDiagnostics: (relPath, diags) => set((s) => ({ byRelPath: { ...s.byRelPath, [relPath]: diags } })),
  clear: (relPath) =>
    set((s) => {
      if (!(relPath in s.byRelPath)) return s;
      const next = { ...s.byRelPath };
      delete next[relPath];
      return { byRelPath: next };
    }),
}));
