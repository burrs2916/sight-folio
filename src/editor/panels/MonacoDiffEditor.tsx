// sight-folio: 只读对比视图编辑器（对标 Zed DiffEditor 双 buffer 对照）
//
// 设计（代码工作台·窗格差异对照，2026-08-27）：
// - 复用 @monaco-editor/react 的 DiffEditor（与 MonacoCodeEditor 共用同一 monaco chunk）；
// - 先装配 monacoSetup（loader 指向本地 monaco-editor 包，离线 / Tauri 可用，与 MonacoCodeEditor 同源）；
// - 两端 read-only：仅做对照阅读 + 变更导航，不写回（符合 review 语义，renderable AND useful）；
// - 顶部一行标签条显示「修改侧 ↔ 原始侧」，无差异时给「无差异」芯片，避免死视图。
//
// 注意：本文件顶部**绝不能静态 import monaco-editor / @monaco-editor/react**（会把内核拖进主包）；
// monaco 装配在 monacoSetup.ts，由下面懒加载引用。

import { lazy, Suspense } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import { t } from "../../i18n";
import { monacoLanguageOf } from "../../utils/languageMeta";
import { useCodeFont } from "../../hooks/useCodeFont";
import type { WorkbenchTab } from "../../store/codeWorkbenchStore";

/** 懒加载 DiffEditor：先 monacoSetup 装配 loader，再加载 @monaco-editor/react 的 DiffEditor（共享 monaco chunk） */
function loadDiffEditor() {
  return (async () => {
    await import("./monacoSetup");
    const m = await import("@monaco-editor/react");
    return { default: m.DiffEditor };
  })();
}
const DiffEditor = lazy(loadDiffEditor);

export interface MonacoDiffEditorProps {
  /** 持有 diff 规格的标签（tab.diff 必存在） */
  tab: WorkbenchTab;
  /** 主题（light/dark） */
  themeMode: "light" | "dark";
}

function EditorFallback() {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "text.secondary",
        fontSize: 13,
      }}
    >
      {t("workbench.loading")}
    </Box>
  );
}

/** 只读对比视图：左边 original（磁盘/另一文件），右边 modified（工作缓冲区/当前文件），Monaco 内置变更导航（沟槽箭头跳上/下一处差异）。 */
export function MonacoDiffEditor({ tab, themeMode }: MonacoDiffEditorProps) {
  // 字号跟随「设置 → 字体大小」（此前写死 13，切档位在差异对照上毫无反应）
  const codeFont = useCodeFont("diff");
  const diff = tab.diff;
  if (!diff) return null;
  const lang = monacoLanguageOf(tab.language ?? "");
  const identical = diff.modifiedText === diff.originalText;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* 标签条：修改侧 ↔ 原始侧（对标 Zed diff 头部两侧文件名） */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          height: 28,
          flexShrink: 0,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          fontSize: 12,
          userSelect: "none",
        }}
      >
        <Typography component="span" noWrap sx={{ fontWeight: 600, color: "text.primary", maxWidth: "40%", overflow: "hidden", textOverflow: "ellipsis" }}>
          {diff.modifiedLabel}
        </Typography>
        <Typography component="span" sx={{ color: "text.secondary" }}>
          ↔
        </Typography>
        <Typography component="span" noWrap sx={{ fontWeight: 600, color: "text.primary", maxWidth: "40%", overflow: "hidden", textOverflow: "ellipsis" }}>
          {diff.originalLabel}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {identical ? (
          <Chip size="small" color="success" variant="outlined" label={t("workbench.diff.identical")} />
        ) : (
          <Chip size="small" color="default" variant="outlined" label={t("workbench.diff.hasChanges")} />
        )}
      </Box>

      {/* 对比主体 */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Suspense fallback={<EditorFallback />}>
          <DiffEditor
            original={diff.originalText}
            modified={diff.modifiedText}
            language={lang}
            theme={themeMode === "dark" ? "vs-dark" : "light"}
            height="100%"
            options={{
              readOnly: true,
              renderSideBySide: true,
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: codeFont.fontSize,
              originalEditable: false,
              renderOverviewRuler: true,
              ignoreTrimWhitespace: false,
              diffWordWrap: "off",
            }}
          />
        </Suspense>
      </Box>
    </Box>
  );
}
