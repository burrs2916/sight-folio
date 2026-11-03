/** CodeWorkbench 编辑器面板：Monaco 编辑器、引用/定义/重命名悬浮面板宿主。 */

import { useEffect, useMemo, useState, useCallback, useRef, Fragment } from "react";

import Drawer from "@mui/material/Drawer";

import Box from "@mui/material/Box";

import Button from "@mui/material/Button";

import Typography from "@mui/material/Typography";

import IconButton from "@mui/material/IconButton";

import Tooltip from "@mui/material/Tooltip";

import CircularProgress from "@mui/material/CircularProgress";

import Alert from "@mui/material/Alert";

import CloseIcon from "@mui/icons-material/Close";

import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";

import SearchIcon from "@mui/icons-material/Search";

import SmartToyIcon from "@mui/icons-material/SmartToy";

import {
  openWorkbenchTab,
  type WorkbenchTab,
  type SplitDirection} from "../../store/codeWorkbenchStore";

import { useProjectStore } from "../../store/projectStore";

import { useToastStore } from "../../store/toastStore";

import { MonacoCodeEditor, type HeatRange, type DeadRange, type CloneRange, type EditorSelectionInfo, type MonacoEditorHandle, type CursorStatus, type EditorInfo, type MarkerStats } from "./MonacoCodeEditor";

import type { SourceMark } from "../../store/sourceViewerStore";

import { useEditorDiagnosticsStore } from "../../store/editorDiagnosticsStore";

import { triggerDiagnosis } from "../../ai/triggerDiagnosis";

import { t } from "../../i18n";

import { projectScanApi} from "../../services/tauri";

import { PeekPanel, highlightCode } from "./CodeWorkbenchPanels";

import { onSymbolRenamed, replaceWordOnLine, type UsageGroup, type UsageHit } from "./CodeWorkbenchShared";


export function EditorPane({
  tab,
  themeMode,
  heatRanges,
  deadRanges,
  cloneRanges,
  marks,
  onAskAi,
  onChangeCapture,
  onRequestAiOpen,
  gotoSymbols,
  editorHandleRef,
  onSelectionExternal,
  onCursorStatusChange,
  onEditorInfoChange,
  onMarkerStatsChange,
  onColumnSelectionChange,
  onWordWrapChange,
  onFontSizeChange,
  onMarkClick,
  onRenameSymbol,
  onGoToDefinition,
  openFileInSplit,
  onScroll,
  bookmarks,
  onToggleBookmark,
}: {
  tab: WorkbenchTab;
  themeMode: "light" | "dark";
  heatRanges: HeatRange[];
  deadRanges: DeadRange[];
  cloneRanges: CloneRange[];
  /** 行内洞察标记（审查发现），由外壳按激活文件从 findings 实时推导后传入 */
  marks?: SourceMark[];
  onAskAi?: (sel: EditorSelectionInfo) => void;
  /** 编辑器内容变更回调（Body 用于收集最新文本 + 置脏标记） */
  onChangeCapture?: (text: string) => void;
  /** 请求展开内嵌 AI 面板（诊断按钮等在工作台独立窗口内无画布订阅者，需显式展开） */
  onRequestAiOpen?: () => void;
  /** 可定位符号名（小写集合），用于按住 Ctrl/⌘ 悬停显示跳转下划线 */
  gotoSymbols?: string[];
  /** 暴露给工作台 AI 面板的编辑器命令句柄（插入光标 / 应用到文件 / 跳转） */
  editorHandleRef?: React.MutableRefObject<MonacoEditorHandle | null>;
  /** 选区变化上报（供 Body 维护 AI 上下文芯片） */
  onSelectionExternal?: (sel: EditorSelectionInfo | null) => void;
  /** 光标/选区状态回传（供外壳状态栏渲染行:列 + 选区统计，对标 Zed CursorPosition 状态栏项） */
  onCursorStatusChange?: (status: CursorStatus) => void;
  /** 编辑器文档信息回传（行尾符 LF/CRLF，对标 Zed LineEndingIndicator 状态栏项） */
  onEditorInfoChange?: (info: EditorInfo) => void;
  /** 诊断计数回传（供外壳状态栏渲染「问题」指示项：N 错误 · M 警告，对标 Zed 状态栏 Problems） */
  onMarkerStatsChange?: (stats: MarkerStats) => void;
  /** 列选择模式状态回传（供外壳状态栏渲染指示项，对标 Zed ColumnarSelection 视觉反馈） */
  onColumnSelectionChange?: (on: boolean) => void;
  /** 软换行状态回传（供外壳状态栏渲染指示项，对标 Zed 软换行视觉反馈） */
  onWordWrapChange?: (on: boolean) => void;
  /** 编辑器字号变化回传（供外壳状态栏渲染字号缩放控件，对标 Zed 字号设置在状态栏可见） */
  onFontSizeChange?: (size: number) => void;
  /** 行内审查发现标记（沟槽图标）点击回调：传回 findingId 与锚点 DOM，供外壳聚焦/行动 */
  onMarkClick?: (findingId: string, anchorEl: HTMLElement | null) => void;
  /** 重命名符号：右键菜单 / F2 触发，由外壳聚合引用并弹出确认（对标 Zed editor::Rename） */
  onRenameSymbol?: (info: { word: string; line: number; column: number }) => void;
  /** 跳转到定义：右键菜单 / Ctrl+单击触发；多定义时由外壳弹候选选择器（对标 Zed navigate_to_hover_links） */
  onGoToDefinition?: (info: { word: string; line: number; column: number }) => void;
  /** 编辑器滚动比例（0~1）变化回调：由外壳用于窗格同步滚动（对标 Zed 多窗格同文件对照滚动） */
  onScroll?: (ratio: number) => void;
  /** 当前文件的书签行号集合（来自外壳 store.bookmarks[fileId]），供编辑器沟槽渲染琥珀金标记 */
  bookmarks?: number[];
  /** 沟槽点击切换书签的回调：传回被点击行号（1 起），由外壳写入/移除 store 书签（对标 Zed 沟槽点击 ToggleBookmark） */
  onToggleBookmark?: (line: number) => void;
  /** 在分屏打开文件（Peek / 选择等分屏动作复用，对标 Zed split 打开；dir 复用 lastSplitDirRef 会话记忆） */
  openFileInSplit?: (
    fid: string,
    relPath: string,
    name: string,
    language: string | null,
    line: number | null,
    dir?: SplitDirection,
    column?: number | null
  ) => void;
}) {
  const [selection, setSelection] = useState<EditorSelectionInfo | null>(null);
  const [usagesOpen, setUsagesOpen] = useState(false);
  const [usages, setUsages] = useState<UsageHit[]>([]);
  const [usagesWord, setUsagesWord] = useState("");
  // 内联 Peek 定义浮层状态（对标 VS Code Peek Definition；单定义场景原地预览，Esc 返回）。多定义回落 onGoToDefinition（DefinitionPicker）。
  const [peek, setPeek] = useState<{
    word: string;
    fileId: string;
    relPath: string;
    name: string;
    language: string | null;
    line: number;
    anchor: { x: number; y: number } | null;
  } | null>(null);
  const symbols = useProjectStore((s) => s.symbols);
  const symbolRefs = useProjectStore((s) => s.symbolRefs);
  const callEdges = useProjectStore((s) => s.callEdges);
  const files = useProjectStore((s) => s.files);

  // ── 引用结果按文件分组 + 键盘导航（对标 Zed find_all_references 的多缓冲分组呈现）──
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selIdx, setSelIdx] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement | null>(null);
  // 编辑器光标行（对标 Zed find_all_references 的「active match 跟随光标」）：本窗格作用域，
  // 用于引用抽屉高亮「光标当前所在行的引用」并自动定位，使抽屉成为「我在引用中的位置」实时地图。
  const [cursorLine, setCursorLine] = useState(0);
  // 引用行内代码预览：对标 Zed find_all_references 多缓冲 excerpt（引用呈现真实代码 + 命中词高亮）。
  // 按 fileId 去重懒读源码（每文件只读一次），封顶 24 个文件防超大项目卡顿；读取失败静默降级到静态 h.text。
  const [refExcerpts, setRefExcerpts] = useState<Record<string, string[]>>({});
  const refExcerptsRef = useRef<Record<string, string[]>>({});
  useEffect(() => {
    refExcerptsRef.current = refExcerpts;
  }, [refExcerpts]);

  const groupedUsages = useMemo<UsageGroup[]>(() => {
    const map = new Map<string, UsageHit[]>();
    const order: string[] = [];
    for (const h of usages) {
      if (!map.has(h.fileId)) {
        map.set(h.fileId, []);
        order.push(h.fileId);
      }
      map.get(h.fileId)!.push(h);
    }
    const groups: UsageGroup[] = order.map((fileId) => {
      const items = map.get(fileId)!.slice().sort((a, b) => a.line - b.line);
      const label = files.find((f) => f.id === fileId)?.relPath ?? items[0].filePath;
      return { fileId, label, count: items.length, items };
    });
    groups.sort((a, b) => a.label.localeCompare(b.label));
    return groups;
  }, [usages, files]);

  const flat = useMemo(() => {
    const items: UsageHit[] = [];
    const idxMap = new Map<string, number>();
    for (const g of groupedUsages) {
      if (collapsed.has(g.fileId)) continue;
      for (const it of g.items) {
        const key = `${it.fileId}:${it.line}`;
        if (!idxMap.has(key)) {
          idxMap.set(key, items.length);
          items.push(it);
        }
      }
    }
    return { items, idxMap };
  }, [groupedUsages, collapsed]);

  // 光标跟随：仅本窗格文件(tab.fileId)的引用能命中，跨文件抽屉不会误标（光标行恒为当前文件行）。
  const cursorUidx =
    cursorLine > 0 ? flat.idxMap.get(`${tab.fileId}:${cursorLine}`) ?? -1 : -1;

  const jumpTo = useCallback(
    (h: UsageHit) => {
      openWorkbenchTab(h.fileId, h.line, t("workbench.jumpToUsage", { name: usagesWord }));
      // 保持抽屉打开，便于像 Zed 多缓冲引用面板那样逐步跳转
    },
    [openWorkbenchTab, usagesWord],
  );

  const onListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (flat.items.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelIdx((i) => Math.min(i + 1, flat.items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const it = flat.items[selIdx >= 0 ? selIdx : 0];
        if (it) jumpTo(it);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setUsagesOpen(false);
      }
    },
    [flat.items, selIdx, jumpTo],
  );

  // 新的一次查找：重置折叠与选中
  useEffect(() => {
    setCollapsed(new Set());
    setSelIdx(-1);
  }, [usages]);

  // 抽屉打开：聚焦列表以便键盘导航
  useEffect(() => {
    if (usagesOpen) {
      const id = requestAnimationFrame(() => listRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [usagesOpen]);

  // 选中项滚动入视口（不抢焦点）
  useEffect(() => {
    if (selIdx < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-uidx="${selIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selIdx, flat]);

  // 光标跟随：编辑器光标落在某引用行时，将该条目滚入视口（仅当命中项变化时才滚动，不抢焦点）
  useEffect(() => {
    if (cursorUidx < 0 || !usagesOpen) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-uidx="${cursorUidx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursorUidx, usagesOpen, flat]);

  // 抽屉打开：按 fileId 懒读被引用文件源码（跨文件引用组在抽屉内直接预览该行代码，对标 Zed 多缓冲 excerpt）
  useEffect(() => {
    if (!usagesOpen) {
      setRefExcerpts({});
      return;
    }
    let cancelled = false;
    const fileIds = Array.from(new Set(usages.map((u) => u.fileId))).slice(0, 24);
    (async () => {
      const map: Record<string, string[]> = { ...refExcerptsRef.current };
      for (const fid of fileIds) {
        if (map[fid]) continue;
        try {
          const src = await projectScanApi.readSourceFile(fid);
          if (!src.skippedReason) map[fid] = src.lines;
        } catch {
          // 读取失败（二进制/过大/越权）：静默跳过，绝不阻断抽屉
        }
      }
      if (!cancelled) setRefExcerpts(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [usagesOpen, usages]);

  // 重命名提交事件 → 乐观刷新引用抽屉（仅当抽屉正展示被重命名的符号）。
  // 对标 Zed find_all_references：引用视图持有真实 buffer 锚点，重命名后文本即时更新；我们无共享 buffer，
  // 故订阅全局重命名事件主动同步标题/预览/懒读缓存到新名，避免抽屉变成旧名死视图（renderable≠useful）。
  useEffect(() => {
    return onSymbolRenamed((oldName, newName) => {
      if (!usagesOpen || usagesWord !== oldName) return;
      // 命中行预览文本逐行按词边界替换旧名→新名（与 rename 同语义，全局多命中）
      setUsages((prev) =>
        prev.map((h) => ({ ...h, text: replaceWordOnLine(h.text, oldName, newName).text })),
      );
      // 抽屉标题 + 行内高亮锚点（highlightCode 以 usagesWord 为命中词）切到新名
      setUsagesWord(newName);
      // 懒读源码缓存同步替换——否则引用预览仍从缓存读旧名代码行；替换后上方 effect 因该 fileId 已在
      // refExcerpts 中而跳过重取，保留我们乐观写入的内容，零闪动。
      setRefExcerpts((prev) => {
        const next: Record<string, string[]> = {};
        for (const fid of Object.keys(prev)) {
          next[fid] = prev[fid].map((ln) => replaceWordOnLine(ln, oldName, newName).text);
        }
        return next;
      });
      // 同步 ref，避免上方 effect 读取到未更新的 ref 而跳过重取（与 state 保持一致）
      const refNext: Record<string, string[]> = {};
      for (const fid of Object.keys(refExcerptsRef.current)) {
        refNext[fid] = refExcerptsRef.current[fid].map((ln) =>
          replaceWordOnLine(ln, oldName, newName).text,
        );
      }
      refExcerptsRef.current = refNext;
    });
  }, [usagesOpen, usagesWord]);

  // 编辑落盘：最新文本由 Body 的 onChangeCapture 收集，脏标记与保存也在 Body 统一管理


  // 查找引用：合并 symbolRefs（通用符号引用）与 callEdges（函数调用），按(文件,行)去重
  const handleFindUsages = useCallback(
    (word: string) => {
      const hits: UsageHit[] = [];
      const seen = new Set<string>();
      for (const r of symbolRefs) {
        if (r.symbolName !== word) continue;
        const k = `${r.fromFileId}:${r.refLine}`;
        if (seen.has(k)) continue;
        seen.add(k);
        hits.push({ fileId: r.fromFileId, filePath: r.fromFilePath, line: r.refLine, text: r.refText, kind: `ref:${r.kind}` });
      }
      for (const e of callEdges) {
        if (e.calleeName !== word) continue;
        const k = `${e.callerFileId}:${e.lineNo}`;
        if (seen.has(k)) continue;
        seen.add(k);
        hits.push({ fileId: e.callerFileId, filePath: e.callerFilePath, line: e.lineNo, text: `${e.callerName}()`, kind: "call" });
      }
      hits.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line);
      setUsages(hits);
      setUsagesWord(word);
      setUsagesOpen(true);
    },
    [symbolRefs, callEdges],
  );

  // 内联 Peek 定义（对标 VS Code Peek Definition；Zed 无此能力，我们自建浮层）。
  // 与 onGoToDefinition 同源解析，但单定义不跳转——弹浮层原地预览；多定义回落既有 DefinitionPicker（onGoToDefinition，零回归）。
  const handlePeekDefinition = useCallback(
    (info: { word: string; line: number; column: number; anchor: { x: number; y: number } | null }) => {
      const word = info.word;
      if (!word) return;
      let matches = symbols.filter((s) => s.name === word);
      if (matches.length === 0) {
        const ci = symbols.find((s) => s.name.toLowerCase() === word.toLowerCase());
        if (ci) matches = [ci];
      }
      if (matches.length === 0) {
        useToastStore.getState().showToast(t("workbench.peekNoDefinition", { name: word }), "info");
        return;
      }
      if (matches.length > 1) {
        // 多定义：复用既有 DefinitionPicker（已含分组/折叠），peek 仅增强单定义场景，避免重复 UI 与行为漂移。
        onGoToDefinition?.(info);
        return;
      }
      const best = matches[0];
      const file = files.find((f) => f.id === best.fileId);
      setPeek({
        word,
        fileId: best.fileId,
        relPath: best.filePath,
        name: file?.name ?? best.filePath.split("/").pop() ?? best.filePath,
        language: file?.language ?? null,
        line: best.lineStart,
        anchor: info.anchor,
      });
    },
    [symbols, files, onGoToDefinition],
  );

  // 右键菜单「AI 诊断此符号」：把光标处符号名 + 精确行号交给 AI（复用既有 triggerDiagnosis 通道，
  // 结论自动回流画布；让编辑器右键菜单从「导航」升级为「可执行的分析动作」）。
  const handleDiagnoseSymbolAt = useCallback(
    (info: { word: string; line: number; column: number }) => {
      if (!tab.relPath) return;
      void triggerDiagnosis({
        filePath: tab.relPath,
        kind: "complexity",
        title: info.word,
        lineRange: [info.line, info.line],
      });
    },
    [tab.relPath],
  );

  if (tab.loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: 1.5 }}>
        <CircularProgress size={22} />
        <Typography variant="body2" color="text.secondary">
          {t("workbench.loading")}
        </Typography>
      </Box>
    );
  }
  if (tab.error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{t("workbench.loadFail", { error: tab.error })}</Alert>
      </Box>
    );
  }
  if (!tab.content) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="info">{t("workbench.noActive")}</Alert>
      </Box>
    );
  }
  return (
    <Box sx={{ position: "relative", flex: 1, minHeight: 0, bgcolor: "background.paper" }}>
      <MonacoCodeEditor
        key={tab.fileId}
        value={tab.content.lines.join("\n")}
        language={tab.content.language}
        theme={themeMode}
        readOnly={tab.readOnly}
        onChange={(val) => onChangeCapture?.(val ?? "")}
        revealLine={tab.focusLine}
        revealColumn={tab.focusColumn}
        marks={marks}
        heatRanges={heatRanges}
        deadRanges={deadRanges}
        cloneRanges={cloneRanges}
        onSelectionChange={(sel) => {
          setSelection(sel);
          onSelectionExternal?.(sel);
        }}
        onGoToDefinition={onGoToDefinition}
        onFindReferences={handleFindUsages}
        onPeekDefinition={handlePeekDefinition}
        onDiagnoseSymbol={handleDiagnoseSymbolAt}
        onRenameSymbol={onRenameSymbol}
        gotoSymbols={gotoSymbols}
        onDiagnosticsChange={(diags) => useEditorDiagnosticsStore.getState().setDiagnostics(tab.relPath, diags)}
        onCursorStatusChange={(status) => {
          setCursorLine(status.line);
          onCursorStatusChange?.(status);
        }}
        onEditorInfoChange={onEditorInfoChange}
        onMarkerStatsChange={onMarkerStatsChange}
        onColumnSelectionChange={onColumnSelectionChange}
        onWordWrapChange={onWordWrapChange}
        onFontSizeChange={onFontSizeChange}
        onMarkClick={onMarkClick}
        onScroll={onScroll}
        bookmarks={bookmarks}
        onToggleBookmark={onToggleBookmark}
        ref={editorHandleRef}
      />
      {peek && (
        <PeekPanel
          word={peek.word}
          fileId={peek.fileId}
          relPath={peek.relPath}
          name={peek.name}
          language={peek.language}
          line={peek.line}
          anchor={peek.anchor}
          onClose={() => setPeek(null)}
          onOpen={(fid, relPath, name, language, line) =>
            openFileInSplit?.(fid, relPath, name, language, line)
          }
        />
      )}
      <Box sx={{ position: "absolute", top: 8, right: 12, zIndex: 6, display: "flex", gap: 1 }}>
        {selection && (
          <>
          <Tooltip title={t("workbench.findUsagesHint", { word: selection.text.trim() })}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<SearchIcon sx={{ fontSize: 14 }} />}
              onClick={() => handleFindUsages(selection.text.trim())}
              sx={{
                textTransform: "none",
                fontSize: 11,
                height: 26,
                minWidth: 0,
                px: 1.25,
                boxShadow: 2,
              }}
            >
              {t("workbench.findUsages")}
            </Button>
          </Tooltip>
          <Tooltip title={t("workbench.diagnoseSelectionHint", { path: tab.relPath, line: selection.startLine })}>
            <Button
              size="small"
              variant="contained"
              startIcon={<AutoAwesomeIcon sx={{ fontSize: 14 }} />}
              onClick={() => {
                onRequestAiOpen?.();
                void triggerDiagnosis({
                  filePath: tab.relPath,
                  kind: "generic",
                  title: t("workbench.diagnoseSelection"),
                  lineRange: [selection.startLine, selection.endLine],
                  detail: selection.text.slice(0, 600),
                });
                setSelection(null);
              }}
              sx={{
                textTransform: "none",
                fontSize: 11,
                height: 26,
                minWidth: 0,
                px: 1.25,
                boxShadow: 2,
              }}
            >
              {t("workbench.diagnoseSelection")}
            </Button>
          </Tooltip>
          <Tooltip title={t("workbench.askAiHint", { path: tab.relPath, line: selection.startLine })}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<SmartToyIcon sx={{ fontSize: 14 }} />}
              onClick={() => {
                onAskAi?.(selection);
                setSelection(null);
              }}
              sx={{
                textTransform: "none",
                fontSize: 11,
                height: 26,
                minWidth: 0,
                px: 1.25,
                boxShadow: 2,
              }}
            >
              {t("workbench.askAi")}
            </Button>
          </Tooltip>
        </>
        )}
      </Box>

      <Drawer
        anchor="right"
        open={usagesOpen}
        onClose={() => setUsagesOpen(false)}
        sx={{ "& .MuiDrawer-paper": { width: 340 } }}
      >
        <Box sx={{ p: 1.5, height: "100%", display: "flex", flexDirection: "column" }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {t("workbench.findUsages")}: {usagesWord} ({usages.length})
            </Typography>
            <IconButton size="small" onClick={() => setUsagesOpen(false)} aria-label={t("workbench.close")}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
          <Box
            ref={listRef}
            tabIndex={0}
            onKeyDown={onListKeyDown}
            sx={{ flex: 1, overflow: "auto", outline: "none" }}
          >
            {usages.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                {t("workbench.noUsages")}
              </Typography>
            ) : (
              groupedUsages.map((g) => {
                const isCollapsed = collapsed.has(g.fileId);
                const isActive = g.fileId === tab.fileId;
                return (
                  <Box key={g.fileId} sx={{ mb: 0.5 }}>
                    <Box
                      onClick={(e) => {
                        e.stopPropagation();
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.fileId)) next.delete(g.fileId);
                          else next.add(g.fileId);
                          return next;
                        });
                      }}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.75,
                        px: 1,
                        py: 0.5,
                        cursor: "pointer",
                        userSelect: "none",
                        borderRadius: 1,
                        bgcolor: isActive ? "action.selected" : "transparent",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                      title={t("workbench.refsToggle")}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: 11,
                          flexShrink: 0,
                          transform: isCollapsed ? "rotate(-90deg)" : "none",
                          transition: "transform .12s",
                          color: "text.secondary",
                        }}
                      >
                        ▾
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          fontWeight: 700,
                          fontSize: 11,
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: isActive ? "primary.main" : "text.primary",
                        }}
                      >
                        {g.label}
                        {isActive ? ` ${t("workbench.refsActiveFile")}` : ""}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ fontSize: 10, color: "text.secondary", flexShrink: 0 }}
                      >
                        {t("workbench.refsCount", { n: g.count })}
                      </Typography>
                    </Box>
                    {!isCollapsed &&
                      g.items.map((h) => {
                        const uidx = flat.idxMap.get(`${h.fileId}:${h.line}`);
                        const selected = uidx != null && uidx === selIdx;
                        const isCursor = uidx != null && uidx === cursorUidx;
                        // 行内代码预览：优先用懒读到的真实源码行，读取未就绪/失败降级到静态 h.text（绝不空白）。
                        const lineArr = refExcerpts[h.fileId];
                        const codeLine = lineArr ? lineArr[h.line - 1] ?? h.text : h.text;
                        // 键盘选中或光标跟随项展开 ±1 上下文（对标 Zed excerpt_context_lines，避免长列表塌陷）
                        const expanded = (selected || isCursor) && !!lineArr;
                        return (
                          <Fragment key={`${h.fileId}:${h.line}`}>
                            <Box
                              data-uidx={uidx}
                              onClick={() => {
                                if (uidx != null) setSelIdx(uidx);
                                jumpTo(h);
                              }}
                              sx={{
                                display: "flex",
                                gap: 0.75,
                                pl: 2.5,
                                pr: 1,
                                py: 0.5,
                                cursor: "pointer",
                                borderLeft: "2px solid",
                                // 键盘选中=蓝边；光标跟随=琥珀金边（品牌色 #EF9F27），两者可叠加
                                borderColor: selected
                                  ? "primary.main"
                                  : isCursor
                                    ? "#EF9F27"
                                    : "transparent",
                                bgcolor: selected
                                  ? "action.selected"
                                  : isCursor
                                    ? "rgba(239,159,39,0.12)"
                                    : "transparent",
                                "&:hover": { bgcolor: "action.hover" },
                              }}
                            >
                              <Typography
                                variant="caption"
                                sx={{
                                  fontWeight: 600,
                                  fontSize: 10,
                                  color: "text.secondary",
                                  flexShrink: 0,
                                  width: 36,
                                  textAlign: "right",
                                }}
                              >
                                {h.line}
                              </Typography>
                              <Box
                                component="span"
                                sx={{
                                  flex: 1,
                                  minWidth: 0,
                                  color: "text.secondary",
                                  fontFamily: "monospace",
                                  fontSize: 10,
                                  whiteSpace: "pre",
                                  overflow: "hidden",
                                }}
                              >
                                {highlightCode(codeLine, usagesWord)}
                              </Box>
                            </Box>
                            {expanded &&
                              (() => {
                                const ctxStart = Math.max(1, h.line - 1);
                                const ctxEnd = Math.min(lineArr!.length, h.line + 1);
                                const rows: React.ReactNode[] = [];
                                for (let ln = ctxStart; ln <= ctxEnd; ln++) {
                                  const isRef = ln === h.line;
                                  const code = lineArr![ln - 1] ?? "";
                                  rows.push(
                                    <Box
                                      key={ln}
                                      title={t("workbench.refsJumpLine", { line: ln })}
                                      onClick={(e) => {
                                        // 对标 Zed Definitions 多缓冲：摘录每行都是真实可导航位置，点击跳该行。
                                        e.stopPropagation();
                                        jumpTo({ ...h, line: ln });
                                      }}
                                      sx={{
                                        display: "flex",
                                        fontFamily: "monospace",
                                        fontSize: 10.5,
                                        lineHeight: 1.5,
                                        px: 1,
                                        cursor: "pointer",
                                        color: isRef ? "text.primary" : "text.secondary",
                                        bgcolor: isRef ? "rgba(239,159,39,0.16)" : "transparent",
                                        "&:hover": {
                                          bgcolor: isRef
                                            ? "rgba(239,159,39,0.24)"
                                            : "rgb(var(--template-palette-primary-mainChannel) / 0.1)",
                                        },
                                      }}
                                    >
                                      <Box
                                        component="span"
                                        sx={{
                                          flex: "0 0 30px",
                                          width: 30,
                                          textAlign: "right",
                                          pr: 1,
                                          color: "text.disabled",
                                          userSelect: "none",
                                        }}
                                      >
                                        {ln}
                                      </Box>
                                      <Box
                                        component="span"
                                        sx={{
                                          minWidth: 0,
                                          flex: 1,
                                          whiteSpace: "pre",
                                          overflow: "hidden",
                                        }}
                                      >
                                        {highlightCode(code, usagesWord)}
                                      </Box>
                                    </Box>
                                  );
                                }
                                return (
                                  <Box
                                    sx={{
                                      ml: 2.5,
                                      mt: 0.25,
                                      mb: 0.5,
                                      borderLeft: "2px solid #EF9F27",
                                      pl: 0.5,
                                    }}
                                  >
                                    {rows}
                                  </Box>
                                );
                              })()}
                          </Fragment>
                        );
                      })}
                  </Box>
                );
              })
            )}
          </Box>
          <Box sx={{ px: 1, py: 0.5, borderTop: 1, borderColor: "divider", mt: 0.5 }}>
            <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
              {t("workbench.refsNavHint")}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", display: "block", mt: 0.25 }}>
              {t("workbench.refsCursorHint")}
            </Typography>
          </Box>
        </Box>
      </Drawer>
    </Box>
  );
}

/** 全局快开面板（Ctrl/Cmd+P）：按文件名/路径模糊匹配，键盘 ↑↓ 选择、⏎ 打开、Esc 关闭。 */
