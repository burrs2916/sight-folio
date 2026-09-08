// project-sight: 画布 ↔ 代码工作台 双向联动
// 主窗口画布选中文件型实体 → 已开的独立工作台自动跳转该文件；
// 工作台内打开文件 → 反向聚焦主窗口画布对应实体。
// 用回环保护（suppressFollow）避免「画布选中→工作台跳转→反向聚焦→画布选中」死循环。
import { useEffect } from "react";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import { findComponentForFile } from "./canvasLink";
import type { ProjectFile } from "../../services/tauri";

const WORKBENCH_LABEL = "code-workbench";

/**
 * 画布作用域广播事件（对标 VS Code 没有的「AI 认知画布」能力）：
 * 主窗口画布选中某文件型实体时，把当前作用域（文件 + 标签）广播给 AI 面板，
 * 让 AI 带着「用户正在画布查看此实体」的分析事实作答，而非只看编辑器里打开的文件。
 * 事件全局广播，故代码工作台窗口里的 AI 面板也能收到（与 verify 投射同源）。
 * payload: { kind: "entity", relPath, label, fileId } | { kind: null }
 */
export const AI_SCOPE_EVENT = "ai-scope-changed";

/** 画布当前作用域载荷类型（AI 面板据此渲染芯片 + 注入上下文） */
export interface AiScopePayload {
  kind: "entity" | null;
  relPath?: string;
  label?: string;
  fileId?: string;
}

// 防止双向联动回环：工作台反向聚焦画布时会置位，主窗口选中态副作用据此跳过一次 emit
let suppressFollow = false;

/** 组件 → 文件：经 config.filePath / 文件名 + 语言 反查 ProjectFile */
function findFileForComponent(comp: {
  config?: Record<string, unknown>;
  name?: string;
}): ProjectFile | undefined {
  const cfg = comp.config ?? {};
  const filePath = typeof cfg.filePath === "string" ? cfg.filePath : undefined;
  const fileName = typeof cfg.fileName === "string" ? cfg.fileName : undefined;
  const lang = String(cfg.language ?? "");
  const files = useProjectStore.getState().files;
  if (filePath) {
    const byPath = files.find((f) => f.relPath === filePath);
    if (byPath) return byPath;
  }
  if (fileName) {
    const byName = files.find((f) => f.name === fileName && (f.language ?? "") === lang);
    if (byName) return byName;
    const byNameFallback = files.find((f) => f.name === fileName);
    if (byNameFallback) return byNameFallback;
  }
  return undefined;
}

/** 主窗口：订阅画布选中态，选中文件型实体且独立工作台已开时让其跳转。 */
export function useCanvasWorkbenchLink() {
  const selectedIds = useEditorStore((s) => s.selection.selectedIds);
  const isWorkbench = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("workbench");
  useEffect(() => {
    if (isWorkbench) return; // 仅在主窗口生效
    // ── 画布作用域广播（先于联动副作用，确保「空选/多选取」也清掉旧作用域）──
    // VS Code 的 AI 面板只认「编辑器打开的文件」，不认画布上正在看的实体；
    // 这里把画布当前作用域投给 AI 面板，是它结构上做不到的能力。
    const broadcastScope = async () => {
      if (selectedIds.length === 1) {
        const comp = useEditorStore.getState().components.find((c) => c.id === selectedIds[0]);
        const file = comp ? findFileForComponent(comp) : undefined;
        if (file) {
          await emit(AI_SCOPE_EVENT, {
            kind: "entity",
            relPath: file.relPath,
            label: comp?.name ?? file.name,
            fileId: file.id,
          } satisfies AiScopePayload);
          return;
        }
      }
      await emit(AI_SCOPE_EVENT, { kind: null } satisfies AiScopePayload);
    };
    void broadcastScope();

    if (suppressFollow) {
      suppressFollow = false;
      return;
    }
    if (selectedIds.length !== 1) return;
    const comp = useEditorStore.getState().components.find((c) => c.id === selectedIds[0]);
    if (!comp) return;
    const file = findFileForComponent(comp);
    if (!file) return;
    // 仅在独立工作台窗口存在时跟随，避免无谓 emit
    if (!WebviewWindow.getByLabel(WORKBENCH_LABEL)) return;
    void emit("code-workbench-open", {
      fileId: file.id,
      line: null,
      analysisId: useProjectStore.getState().activeAnalysisId,
    });
  }, [selectedIds, isWorkbench]);
}

/** 主窗口：监听工作台发来的「聚焦画布」请求，完成反向联动（带回环保护）。 */
export function useWorkbenchFocusCanvasListener() {
  const isWorkbench = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("workbench");
  useEffect(() => {
    if (isWorkbench) return; // 仅在主窗口监听
    let un: UnlistenFn | undefined;
    (async () => {
      un = await listen<{ fileId: string }>("workbench-focus-canvas", (ev) => {
        suppressFollow = true;
        const file = useProjectStore.getState().files.find((f) => f.id === ev.payload.fileId);
        if (file) {
          const comp = findComponentForFile(file);
          if (comp) useEditorStore.getState().focusComponent(comp.id);
        }
        // 选中变化可能在下一拍才触发，短延时后解除保护
        setTimeout(() => {
          suppressFollow = false;
        }, 80);
      });
    })();
    return () => {
      un?.();
    };
  }, [isWorkbench]);
}
