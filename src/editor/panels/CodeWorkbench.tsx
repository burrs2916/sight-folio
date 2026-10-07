/**
 * 项目代码工作台（IDE 风格：文件树 + 多标签编辑器）
 *
 * 点击任意「打开源码」入口后拉起：左侧文件树加载整个已扫描项目（轻量元数据，
 * 内容按需懒加载），中间多标签 Monaco 编辑器，焦点定位到当前跳转的文件与行。
 * 取代原先的单文件查看 dialog，对齐「比 IDEA 更强的开发平台」定位。
 */

import { useEffect, useMemo, useState, useCallback, useRef, Fragment, type MouseEvent as ReactMouseEvent } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import Dialog from "@mui/material/Dialog";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import CircularProgress from "@mui/material/CircularProgress";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import FolderIcon from "@mui/icons-material/Folder";
import SearchIcon from "@mui/icons-material/Search";
import ListAltIcon from "@mui/icons-material/ListAlt";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import TerminalIcon from "@mui/icons-material/Terminal";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import TextSnippetIcon from "@mui/icons-material/TextSnippet";
import LabelIcon from "@mui/icons-material/Label";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import CodeIcon from "@mui/icons-material/Code";
import {
  useCodeWorkbenchStore,
  openWorkbenchTab,
  type WorkbenchTab,
  type PaneNode,
  type PaneOrientation,
  type SplitDirection,
} from "../../store/codeWorkbenchStore";
import { useProjectStore } from "../../store/projectStore";
import { useToastStore } from "../../store/toastStore";
import { useAgentStore } from "../../store/agentStore";
import type { EditorSelectionInfo, MonacoEditorHandle } from "./MonacoCodeEditor";
import { useProblemsPanelStore } from "../../store/problemsPanelStore";
import { triggerDiagnosis } from "../../ai/triggerDiagnosis";
import { L } from "../../ai/aiLang";
import { CommandPalette, type WorkbenchCommand } from "./CommandPalette";
import { GotoLineDialog } from "./GotoLineDialog";
import { BookmarkPicker } from "./BookmarkPicker";
import { WorkbenchSearchPanel } from "./WorkbenchSearchPanel";
import { WorkbenchEditorPane } from "./WorkbenchEditorPane";
import { WorkbenchAiPanel } from "./WorkbenchAiPanel";
import { WorkbenchTerminalTabs } from "./WorkbenchTerminalTabs";
import { WorkbenchProblemsPanel } from "./WorkbenchProblemsPanel";
import { sendToActiveTerminal } from "./terminalBus";
import { RequirementsPanel } from "./RequirementsPanel";

/** 稳定的空标签数组，避免选择器返回新引用触发多余重渲染 */
const EMPTY_TABS: WorkbenchTab[] = [];
import { InlineChat } from "./InlineChat";
import { t } from "../../i18n";
import { readLineFromMetadata } from "../utils/sourceNavigate";
import { projectScanApi, type FileChangeEvent, type ProjectSymbol } from "../../services/tauri";

import { escapeRegExp, emitSymbolRenamed, replaceWordOnLine, type RenameTarget } from "./CodeWorkbenchShared";

import { buildOutlineTree, collectOutlineNodes, filterOutlineTree, kindSortIndex, symbolKindColor, symbolKindLabel, type OutlineNode } from "./CodeWorkbenchOutline";

import { buildTree, collectDirPaths, filterTreeNodes, treeHeaderSx, treeHeaderTextSx, treeItemSx, treeMenuSx, FileTreeNode, type TreeNode } from "./CodeWorkbenchTree";


import { DefinitionPicker, GoToSymbol, QuickOpen } from "./CodeWorkbenchPanels";

export function CodeWorkbenchBody({
  onRequestClose,
  showBackButton = true,
}: {
  onRequestClose: () => void;
  showBackButton?: boolean;
}) {
  const panes = useCodeWorkbenchStore((s) => s.panes);
  const paneTree = useCodeWorkbenchStore((s) => s.paneTree);
  const activePaneId = useCodeWorkbenchStore((s) => s.activePaneId);
  // tabs / activeFileId 取「当前激活窗格」，与 Zed 一致：外壳的 AI 面板 / 大纲 / 终端跟随聚焦窗格
  const tabs = useCodeWorkbenchStore((s) => s.panes[s.activePaneId]?.tabs ?? EMPTY_TABS);
  const activeFileId = useCodeWorkbenchStore((s) => s.panes[s.activePaneId]?.activeFileId ?? null);
  const openTab = useCodeWorkbenchStore((s) => s.openTab);
  const setDraggingFile = useCodeWorkbenchStore((s) => s.setDraggingFile);
  const splitPaneWithFile = useCodeWorkbenchStore((s) => s.splitPaneWithFile);
  const setActive = useCodeWorkbenchStore((s) => s.setActive);
  const closeTab = useCodeWorkbenchStore((s) => s.closeTab);
  const togglePin = useCodeWorkbenchStore((s) => s.togglePin);
  const closeOthers = useCodeWorkbenchStore((s) => s.closeOthers);
  const closeLeft = useCodeWorkbenchStore((s) => s.closeLeft);
  const closeRight = useCodeWorkbenchStore((s) => s.closeRight);
  const closeAll = useCodeWorkbenchStore((s) => s.closeAll);
  const reorderTab = useCodeWorkbenchStore((s) => s.reorderTab);
  const toggleReadOnly = useCodeWorkbenchStore((s) => s.toggleReadOnly);
  const splitPane = useCodeWorkbenchStore((s) => s.splitPane);
  const closePane = useCodeWorkbenchStore((s) => s.closePane);
  const setActivePane = useCodeWorkbenchStore((s) => s.setActivePane);
  const moveTabToPane = useCodeWorkbenchStore((s) => s.moveTabToPane);
  const splitPaneWithTab = useCodeWorkbenchStore((s) => s.splitPaneWithTab);
  const setDraggingTab = useCodeWorkbenchStore((s) => s.setDraggingTab);
  const setAxisFlexes = useCodeWorkbenchStore((s) => s.setAxisFlexes);
  const resetPaneSizes = useCodeWorkbenchStore((s) => s.resetPaneSizes);
  const resetLayout = useCodeWorkbenchStore((s) => s.resetLayout);

  // 窗格可拖拽分隔条（对标 Zed PaneGroup 分隔条：按所属 axis 调整 flex 权重，双击复位均分）
  const paneContainerRef = useRef<HTMLDivElement>(null);
  const axisRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setAxisRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) axisRefs.current.set(id, el);
      else axisRefs.current.delete(id);
    },
    []
  );
  const [dragDivider, setDragDivider] = useState<{ axisId: string; gapIndex: number } | null>(null);

  const onDividerDown = useCallback(
    (axisId: string, i: number, horizontal: boolean, flexes: number[], e: React.MouseEvent) => {
      e.preventDefault();
      const axisEl = axisRefs.current.get(axisId);
      if (!axisEl) return;
      const rect = axisEl.getBoundingClientRect();
      const size = horizontal ? rect.width : rect.height;
      if (size <= 0) return;
      const fa = flexes[i] ?? 1;
      const fb = flexes[i + 1] ?? 1;
      const sum = fa + fb;
      // Zed 最小尺寸：横向 80px / 纵向 100px，换算成 flex 下限避免窗格被压没
      const minFlex = Math.max(0.04, ((horizontal ? 80 : 100) / size) * sum);
      const startPos = horizontal ? e.clientX : e.clientY;
      setDragDivider({ axisId, gapIndex: i });
      const prevCursor = document.body.style.cursor;
      document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
      const onMove = (ev: MouseEvent) => {
        const cur = horizontal ? ev.clientX : ev.clientY;
        const delta = ((cur - startPos) / size) * sum; // 像素增量 → flex 单位
        let na = fa + delta;
        na = Math.max(minFlex, Math.min(sum - minFlex, na));
        const nb = sum - na;
        const next = [...flexes];
        next[i] = na;
        next[i + 1] = nb;
        setAxisFlexes(axisId, next);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = prevCursor;
        setDragDivider(null);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [setAxisFlexes]
  );

  // 双击分隔条 → 全部 axis flex 复位均分（对标 Zed 双击 handle 均分）
  const onDividerReset = useCallback(() => {
    resetPaneSizes();
  }, [resetPaneSizes]);

  const files = useProjectStore((s) => s.files);
  // 符号索引三表（定义/引用/调用），供重命名符号聚合 (文件,行) 定位点
  const symbols = useProjectStore((s) => s.symbols);
  const symbolRefs = useProjectStore((s) => s.symbolRefs);
  const callEdges = useProjectStore((s) => s.callEdges);
  // 打开文件并反向联动主窗口画布（选中对应实体并居中）
  const openFileInTab = useCallback(
    (fid: string, line?: number | null, column?: number | null) => {
      const f = files.find((x) => x.id === fid);
      if (!f) return;
      openTab(f.id, f.relPath, f.name, f.language, line ?? null, null, [], column ?? null);
      void emit("workbench-focus-canvas", { fileId: f.id });
    },
    [files, openTab]
  );

  // 拆分窗格打开文件（对标 Zed go_to_file_split_*）：先在激活窗格旁按 dir 方向生长一个空分屏（设为激活），
  // 再在该分屏打开目标文件。与 openFileInTab 共享同一 openTab 口径，零重复基建。
  const openFileInSplit = useCallback(
    (
      fid: string,
      relPath: string,
      name: string,
      language: string | null,
      line: number | null,
      dir: SplitDirection = "right",
      column?: number | null
    ) => {
      splitPane(dir, "empty");
      openTab(fid, relPath, name, language, line, null, [], column ?? null);
      void emit("workbench-focus-canvas", { fileId: fid });
    },
    [splitPane, openTab]
  );

  // 递归渲染窗格树（对标 Zed `PaneGroup` 渲染：轴节点按自身 orientation 排布子节点并插分隔条，
  // 叶子窗格承载标签+编辑器；嵌套轴各自持 flex 权重，支持任意层级拆分）
  // 用函数而非立即对象，避免在闭包中早于部分 state setter（如 setSelection）声明处求值
  const getPaneProps = () => ({
    files,
    onActivateEditor: (ref: MonacoEditorHandle | null) => {
      editorHandleRef.current = ref;
    },
    onChangeCapture: (text: string) => {
      const pid = useCodeWorkbenchStore.getState().activePaneId;
      const fid = useCodeWorkbenchStore.getState().panes[pid]?.activeFileId;
      if (fid) {
        contentBuffers.current.set(fid, text);
        scheduleSave(fid);
      }
    },
    onAskAi: (sel: EditorSelectionInfo | null) => void askAi("selection", sel),
    onRequestAiOpen: () => {
      setAiOpen(true);
      setRightTab(0);
    },
    onOpenInline: () => setInlineOpen(true),
    splitPane,
    closePane,
    setActivePane,
    activePaneId,
    setActive,
    closeTab,
    togglePin,
    closeOthers,
    closeLeft,
    closeRight,
    closeAll,
    reorderTab,
    moveTabToPane,
    splitPaneWithTab,
    setDraggingTab,
    setDraggingFile,
    splitPaneWithFile,
    toggleReadOnly,
    openTab,
    onOpenFile: openFileInTab,
    onToggleOutline: () => setOutlineOpen((v) => !v),
    onOpenInTerminal: (dir?: string) => {
      setTerminalOpen(true);
      if (dir) sendToActiveTerminal(`cd "${dir}"\n`);
    },
    onSelectionChange: setSelection,
    onCursorLineChange: setCursorLine,
    onOpenGotoLine: () => setGotoOpen(true),
    onRenameSymbol: handleRenameSymbol,
    onGoToDefinition: handleGoToDefinition,
    openFileInSplit,
  });
  const renderPaneNode = (node: PaneNode, axis: PaneOrientation | null, flex: number): React.ReactNode => {
    if (node.kind === "pane") {
      return (
        <WorkbenchEditorPane
          key={node.id}
          paneId={node.id}
          paneFlex={flex}
          paneAxis={axis}
          onShowBookmarks={() => setBookmarkPickerOpen(true)}
          {...getPaneProps()}
        />
      );
    }
    const isRow = node.axis === "row";
    const els: React.ReactNode[] = [];
    node.children.forEach((child, i) => {
      els.push(renderPaneNode(child, node.axis, node.flexes[i] ?? 1));
      if (i < node.children.length - 1) {
        els.push(
          <Box
            key={`div-${node.id}-${i}`}
            onMouseDown={(e) => onDividerDown(node.id, i, isRow, node.flexes, e)}
            onDoubleClick={onDividerReset}
            title={t("workbench.pane.resizeHint")}
            sx={{
              flex: "0 0 6px",
              cursor: isRow ? "col-resize" : "row-resize",
              bgcolor:
                dragDivider?.axisId === node.id && dragDivider.gapIndex === i
                  ? "primary.main"
                  : "transparent",
              "&:hover": { bgcolor: "action.hover" },
              zIndex: 2,
              transition:
                dragDivider?.axisId === node.id && dragDivider.gapIndex === i
                  ? "none"
                  : "background-color 120ms",
            }}
          />
        );
      }
    });
    return (
      <Box
        key={node.id}
        ref={setAxisRef(node.id)}
        sx={{
          flex,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: isRow ? "row" : "column",
          overflow: "hidden",
        }}
      >
        {els}
      </Box>
    );
  };

  // 改动评审列表点击文件名时用：AI 改的往往不是当前打开的文件，必须能跳过去并定位行。
  // relPath → fileId 映射走 files 表；line 经 openTab 的 focusLine 落到编辑器 revealLine。
  const handleOpenPath = useCallback(
    (relPath: string, line?: number) => {
      const f = files.find((x) => x.relPath === relPath);
      if (!f) return;
      openTab(f.id, f.relPath, f.name, f.language, line ?? null);
      void emit("workbench-focus-canvas", { fileId: f.id });
    },
    [files, openTab]
  );
  // 项目内搜索结果跳转：命中只带 fileId + 行号，需反查 files 取 name/language/relPath 再 openTab 落到 revealLine。
  const handleSearchJump = useCallback(
    (fileId: string, lineNo: number) => {
      const f = files.find((x) => x.id === fileId);
      if (!f) return;
      openTab(f.id, f.relPath, f.name, f.language, lineNo);
    },
    [files, openTab]
  );
  // 内嵌 AI 面板：构建带精确坐标（文件:行）的上下文提示，让 AI 不跑偏
  type AiAskKind = "file" | "selection" | "test" | "review";
  const buildAiPrompt = (kind: AiAskKind, filePath: string, lang: string, sel?: EditorSelectionInfo | null): string => {
    const codeBlock = sel?.text ? `\n\n\`\`\`${lang}\n${sel.text}\n\`\`\`` : "";
    const ref = sel ? `${filePath}:${sel.startLine}-${sel.endLine}` : filePath;
    if (kind === "selection") {
      return L(
        `请解释下面选中的代码，并说明它的作用、潜在问题与改进点：\n\n【文件】${ref}${codeBlock}\n\n先通过 project_context / scan_records(action="dossier", path="${filePath}") 读取真实上下文，不要凭空猜测。`,
        `Please explain the selected code and point out its purpose, potential issues and improvements:\n\n[File] ${ref}${codeBlock}\n\nFirst read the real context via project_context / scan_records(action="dossier", path="${filePath}").`,
      );
    }
    if (kind === "test") {
      return L(
        `请为文件 ${filePath} 编写单元测试，覆盖关键函数/分支与边界情况，并给出可执行的测试代码。先通过 scan_records 读取真实代码。`,
        `Please write unit tests for ${filePath} covering key functions/branches and edge cases with runnable test code. First read the real code via scan_records.`,
      );
    }
    if (kind === "review") {
      return L(
        `请审查文件 ${filePath}，指出 bug、坏味道（bad smell）、安全隐患与可改进点，引用具体「文件:行号」证据。先通过 scan_records 读取真实代码。`,
        `Please review ${filePath}, point out bugs, code smells, security risks and improvements, citing concrete "file:line" evidence. First read the real code via scan_records.`,
      );
    }
    return L(
      `请解释文件 ${filePath} 的整体结构、关键逻辑、依赖关系与潜在问题，给出模块级概述。先通过 scan_records(action="dossier", path="${filePath}") 读取真实代码。`,
      `Please explain the overall structure, key logic, dependencies and potential issues of ${filePath} at module level. First read the real code via scan_records(action="dossier", path="${filePath}").`,
    );
  };

  // 内嵌 AI 面板：确保 Agent + 会话存在，发出上下文化消息并展开右侧面板
  const askAi = useCallback(
    async (kind: AiAskKind, sel?: EditorSelectionInfo | null) => {
      const file = tabs.find((t) => t.fileId === activeFileId);
      if (!file) return;
      const toast = useToastStore.getState().showToast;
      let agentStore = useAgentStore.getState();
      if (agentStore.agents.length === 0) await agentStore.loadAgents();
      agentStore = useAgentStore.getState();
      if (agentStore.agents.length === 0) {
        toast(t("aiPanel.diagnose.noAgent"), "error");
        return;
      }
      // 线程连续：复用当前会话（同 Agent），只有「新对话」才开线程（修掉「每点一次建新会话」的爆炸）
      let convId = agentStore.selectedConversationId;
      const selectedConv = convId ? agentStore.conversations.find((c) => c.id === convId) : null;
      if (selectedConv) {
        if (agentStore.selectedAgentId !== selectedConv.agentId) {
          useAgentStore.getState().selectAgent(selectedConv.agentId);
        }
      } else {
        const agent = agentStore.agents.find((a) => a.id === agentStore.selectedAgentId) ?? agentStore.agents[0];
        if (agentStore.selectedAgentId !== agent.id) useAgentStore.getState().selectAgent(agent.id);
        const conv = await useAgentStore.getState().createConversation(agent.id, t("workbench.aiConvTitle", { file: file.name }));
        convId = conv.id;
      }
      useAgentStore.getState().selectConversation(convId);
      const prompt = buildAiPrompt(kind, file.relPath, file.language ?? "", sel);
      if (!convId) return;
      await useAgentStore.getState().sendMessage(convId, prompt);
      setAiOpen(true);
    },
    [tabs, activeFileId],
  );
  const findings = useProjectStore((s) => s.findings);

  // 当前激活文件的审查发现计数（驱动顶部状态条徽标，与编辑器行内标记同源）
  const activeFindingsCount = useMemo(() => {
    if (!activeFileId) return 0;
    let n = 0;
    for (const f of findings) {
      if (f.targetId === activeFileId && readLineFromMetadata(f.metadata)) n += 1;
    }
    return n;
  }, [findings, activeFileId]);

  // 编辑器命令句柄：仅激活标签挂载，指向当前打开的编辑器，供 AI 面板「插入光标 / 应用到文件」
  const editorHandleRef = useRef<MonacoEditorHandle | null>(null);
  // 当前编辑器选区（供 AI 上下文芯片实时反映选区）
  const [selection, setSelection] = useState<EditorSelectionInfo | null>(null);

  const tree = useMemo(() => buildTree(files), [files]);


  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  // 文件树右键菜单（对标 ProjectTree 的专业上下文菜单，本工作台无画布故不含「在画布中定位」）
  const [treeMenu, setTreeMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);
  const closeTreeMenu = () => setTreeMenu(null);
  const handleTreeContextMenu = (node: TreeNode, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTreeMenu({ x: e.clientX, y: e.clientY, node });
  };
  // 按 / 与 \ 双分隔符取父目录（跨平台：macOS/Linux 用 /，Windows 用 \）
  const dirOf = (p: string): string => {
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return i > 0 ? p.slice(0, i) : p;
  };
  // 解析节点的绝对路径：文件直接查 files；目录从其首个子文件反推（空目录退化为相对路径）
  const absPathOf = (node: TreeNode): string | null => {
    if (!node.isDir) {
      return files.find((f) => f.id === node.fileId)?.path ?? null;
    }
    const child = files.find((f) => f.relPath.startsWith(node.path + "/"));
    if (child) {
      const suffix = child.relPath.slice(node.path.length);
      return child.path.slice(0, child.path.length - suffix.length);
    }
    return null;
  };
  const copyToClipboard = (label: string, value: string) => {
    void navigator.clipboard?.writeText(value);
    useToastStore.getState().success(t("projectTree.copied", { kind: label }));
    closeTreeMenu();
  };
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  // 对标 VS Code：AI 面板是常驻右侧栏，默认展开。用户关/开后记忆偏好（localStorage），
  // 下次进工作台不再重新点开——「右侧就是 AI 面板」从打开那一刻就在。
  const [aiOpen, setAiOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem("workbench.ai.open");
    return saved === null ? true : saved === "1";
  });
  // 记忆开/合偏好（跨会话保持，对标 VS Code 的 Chat 面板状态持久化）
  useEffect(() => {
    try {
      localStorage.setItem("workbench.ai.open", aiOpen ? "1" : "0");
    } catch {
      /* localStorage 不可用时静默降级，不影响面板本身 */
    }
  }, [aiOpen]);
  // 集成终端开/合偏好（对标 VS Code 的终端面板，Ctrl+` / Cmd+` 切换）
  const [terminalOpen, setTerminalOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem("workbench.terminal.open");
    return saved === "1";
  });
  useEffect(() => {
    try {
      localStorage.setItem("workbench.terminal.open", terminalOpen ? "1" : "0");
    } catch {
      /* localStorage 不可用时静默降级 */
    }
  }, [terminalOpen]);
  // 集成终端是「键盘孤岛」：当按键源自终端（.xterm 内）时，所有 app 级快捷键必须放行给 PTY，
  // 否则 Ctrl/Cmd+P（应进 shell，如 fzf/上一条）、Ctrl/Cmd+S（XOFF）会被 app 抢走，表现为"有些键用不了"。
  const isTerminalTarget = (e: KeyboardEvent): boolean =>
    !!(e.target as HTMLElement | null)?.closest?.(".xterm");
  // Ctrl+` / Cmd+` 切换终端（IDE 习惯）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setTerminalOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // 右侧 dock 的 tab：0 = AI 助手，1 = 需求分析（业务功能独立于 AI 交互入口）。
  // requirements-capture 等 AI 预设只 *读取* 需求基线（数据流向），本 tab 切换不改变这一事实。
  const [rightTab, setRightTab] = useState<number>(0);
  // 需求分析面板「AI 协助」芯片注入到 AI 输入框的一次性提示词；消费后置空避免重复触发。
  const [pendingAiPrompt, setPendingAiPrompt] = useState<string | null>(null);
  // dock 宽度与拖拽（原 AI 面板的宽度/拖拽上移到这一层，两个 tab 共享同一宽度与手柄）
  const [dockWidth, setDockWidth] = useState<number>(() => {
    const w = Number(localStorage.getItem("workbench.ai.width"));
    return Number.isFinite(w) && w > 0 ? w : 430;
  });
  const dockDraggingRef = useRef(false);
  const startDockDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dockDraggingRef.current = true;
    const startX = e.clientX;
    const startW = dockWidth;
    const onMove = (ev: MouseEvent) => {
      if (!dockDraggingRef.current) return;
      const nw = Math.max(300, Math.min(900, startW + (startX - ev.clientX)));
      setDockWidth(nw);
    };
    const onUp = () => {
      dockDraggingRef.current = false;
      try {
        localStorage.setItem("workbench.ai.width", String(dockWidth));
      } catch {
        /* 忽略持久化失败 */
      }
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [dockWidth]);
  const [inlineOpen, setInlineOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  // 大纲（对标 Zed outline）：层级树 + 过滤 + 跟随光标 + 折叠
  const [outlineQuery, setOutlineQuery] = useState("");
  const [collapsedOutline, setCollapsedOutline] = useState<Set<string>>(new Set());
  // 大纲视图模式：层级树 ↔ 按类型聚类（对标「结构化符号导航」，大文件下可一键跳到某类符号）
  const [outlineViewMode, setOutlineViewMode] = useState<"tree" | "kind">("tree");
  const [collapsedKind, setCollapsedKind] = useState<Set<string>>(new Set());
  const [cursorLine, setCursorLine] = useState(0);
  const outlineListRef = useRef<HTMLDivElement>(null);
  // 自动保存：编辑即防抖写回磁盘（无需手动保存按钮）
  // 按文件隔离缓冲区与定时器，杜绝「切标签后旧定时器把 B 全文写进 A」的串写缺陷（P0-A）
  const contentBuffers = useRef<Map<string, string>>(new Map());
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // 我们刚写盘的文件（短 TTL），用于区分「自己刚保存」与「外部/AI 改盘」（P0-B）
  const justWroteByUs = useRef<Map<string, number>>(new Map());

  // Ctrl/Cmd+P 唤起全局快开面板（与主流编辑器一致）；终端内按键放行给 PTY。
  // 注意：Shift 组合留给命令面板（Ctrl/Cmd+Shift+P），此处必须排除，否则会同时唤起两个面板。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        setQuickOpenOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl/Cmd+Shift+P 唤起统一命令面板（对标 Zed command_palette / VS Code Ctrl+Shift+P）；
  // 终端内按键放行给 PTY（如 shell 的 fzf 历史搜索）。
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  // 转到行（对标 Zed go_to_line / VS Code Ctrl+G）：从一处精确跳到 line:column
  const [gotoOpen, setGotoOpen] = useState(false);
  // 项目内全文搜索（对标 Zed crates/search ProjectSearchView / VS Code Ctrl+Shift+F）
  const [searchOpen, setSearchOpen] = useState(false);
  // 问题面板（对标 Zed crates/diagnostics ProjectDiagnosticsEditor）：聚合所有已打开文件的实时诊断，
  // 开关走 useProblemsPanelStore（与状态栏「问题」指示项跨组件通信）。
  const problemsOpen = useProblemsPanelStore((s) => s.open);
  const setProblemsOpen = useProblemsPanelStore((s) => s.setOpen);
  // 转到项目符号（对标 Zed Go to Symbol in Project / VS Code Ctrl+Shift+O）
  const [symbolOpen, setSymbolOpen] = useState(false);
  // 查看书签清单（对标 Zed ViewBookmarks：全部书签聚合为可跳转清单）
  const [bookmarkPickerOpen, setBookmarkPickerOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        setCmdPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl/Cmd+G 唤起「转到行」（对标 Zed go_to_line / VS Code Ctrl+G）；终端内按键放行给 PTY。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        setGotoOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl/Cmd+Shift+F 唤起「项目内搜索」（对标 Zed crates/search ProjectSearchView / VS Code Ctrl+Shift+F）；
  // 终端内按键放行给 PTY（如 shell 的前向搜索）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl/Cmd+Shift+O 唤起「转到项目符号」（对标 Zed Go to Symbol in Project / VS Code Ctrl+Shift+O）；
  // 终端内按键放行给 PTY（如 shell 的编辑命令）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        setSymbolOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 窗格键盘导航（对标 Zed ActivatePaneInDirection / ActivateNextPane / SwapPanesInDirection）：
  //  - Ctrl/Cmd+Shift+Alt+Arrow → 按方向把焦点移到几何相邻窗格（避免与多光标 Ctrl/Cmd+Alt+↑/↓ 冲突，零回归）；
  //  - Ctrl/Cmd+Alt+[ / ] → 循环切到上一/下一窗格；
  //  - Ctrl/Cmd+Shift+Alt+Arrow 仅做方向聚焦；交换位置经命令面板暴露（不占额外键位）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      const dirMap: Record<string, SplitDirection> = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      };
      // 方向聚焦：Ctrl/Cmd + Shift + Alt + Arrow
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.shiftKey && !e.repeat) {
        const dir = dirMap[e.key];
        if (dir) {
          e.preventDefault();
          useCodeWorkbenchStore.getState().activatePaneInDirection(dir);
        }
        return;
      }
      // 循环切换窗格：Ctrl/Cmd + Alt + [ / ]
      if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && !e.repeat) {
        if (e.key === "]") {
          e.preventDefault();
          useCodeWorkbenchStore.getState().activateNextPane();
        } else if (e.key === "[") {
          e.preventDefault();
          useCodeWorkbenchStore.getState().activatePrevPane();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 标签键盘导航（对标 Zed pane::ActivateNextItem / ActivatePreviousItem / ActivateItem）：
  //  - Ctrl/Cmd+PageDown / PageUp → 当前窗格的下一/上一标签（到尾/到头回绕，零回归）；
  //  - Ctrl/Cmd+1..9 → 按索引切到当前窗格第 N 个标签（越界忽略，对标 Zed ctrl-1..9 = ActivateItem）。
  //  刻意避开多光标(Ctrl/Cmd+Alt+↑/↓)、窗格循环(Ctrl/Cmd+Alt+[ ])、窗格方向聚焦(Ctrl/Cmd+Shift+Alt+Arrow) 键位，守零回归。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.altKey) return; // 让位给多光标 / 窗格循环键位，避免误触
      if (e.key === "PageDown" && !e.shiftKey) {
        e.preventDefault();
        useCodeWorkbenchStore.getState().activateNextTab();
      } else if (e.key === "PageUp" && !e.shiftKey) {
        e.preventDefault();
        useCodeWorkbenchStore.getState().activatePrevTab();
      } else if (!e.shiftKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        useCodeWorkbenchStore.getState().activateTabByIndex(Number(e.key) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 书签键位（对标 Zed ToggleBookmark / GoToNextBookmark / GoToPreviousBookmark）：
  //  - Ctrl/Cmd+F2 → 切换当前行书签；Ctrl/Cmd+Shift+F2 → 下一书签；Ctrl/Cmd+Alt+F2 → 上一书签。
  //  仅当按住 Ctrl/Cmd 时接管（普通 F2 仍是重命名符号，由编辑器 addCommand 处理，零冲突）；
  //  终端聚焦时让位（isTerminalTarget 守卫，零回归）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      if (e.key !== "F2") return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      e.preventDefault();
      if (e.shiftKey && !e.altKey) editorHandleRef.current?.goToNextBookmark();
      else if (e.altKey && !e.shiftKey) editorHandleRef.current?.goToPrevBookmark();
      else editorHandleRef.current?.toggleBookmark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 文件树筛选：有筛选词时自动全展开命中分支，否则沿用用户展开状态
  const filteredTree = useMemo(
    () => (filter.trim() ? filterTreeNodes(tree, filter.trim()) : null),
    [tree, filter]
  );
  const displayTree = filteredTree ?? tree;
  const displayExpanded = filteredTree ? collectDirPaths(filteredTree) : expanded;
  // 打开新文件时自动展开其所在路径，确保焦点文件可见
  useEffect(() => {
    const a = tabs.find((t) => t.fileId === activeFileId);
    if (!a) return;
    const parts = a.relPath.split("/");
    const anc = new Set<string>();
    let p = "";
    for (let i = 0; i < parts.length - 1; i++) {
      p = p ? `${p}/${parts[i]}` : parts[i];
      anc.add(p);
    }
    setExpanded(anc);
  }, [activeFileId, tabs]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const activeTab = tabs.find((t) => t.fileId === activeFileId) ?? null;

  // ═══ 重命名符号（对标 Zed editor::Rename：光标符号 → 聚合引用 → 确认跨文件改写）═══
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameOld, setRenameOld] = useState("");
  const [renameNew, setRenameNew] = useState("");
  const [renameTargets, setRenameTargets] = useState<RenameTarget[]>([]);
  const [renameIndexed, setRenameIndexed] = useState(true);
  const [renameBusy, setRenameBusy] = useState(false);

  // ═══ 转到定义候选选择器（对标 Zed navigate_to_hover_links：num_locations>1 弹 Definitions 浮层）═══
  const [defPickerOpen, setDefPickerOpen] = useState(false);
  const [defPickerWord, setDefPickerWord] = useState("");
  const [defPickerCandidates, setDefPickerCandidates] = useState<ProjectSymbol[]>([]);

  // 取当前激活标签（供只读判断与「仅当前文件」降级扫描）
  const getActiveTab = useCallback((): WorkbenchTab | null => {
    const st = useCodeWorkbenchStore.getState();
    const pane = st.panes[st.activePaneId];
    if (!pane) return null;
    return pane.tabs.find((t) => t.fileId === pane.activeFileId) ?? null;
  }, []);

  // 重命名符号：聚合 定义(symbols) + 引用(symbolRefs) + 调用(callEdges) 的 (文件,行) 定位点。
  // 若项目索引零命中，降级为「仅当前文件内词边界全量替换」（覆盖局部变量/参数等未被索引的符号）。
  const handleRenameSymbol = useCallback(
    (info: { word: string; line: number; column: number }) => {
      const activeTab = getActiveTab();
      if (activeTab?.readOnly) {
        useToastStore.getState().showToast(t("workbench.rename.readOnly"), "info");
        return;
      }
      const word = info.word;
      if (!word) return;
      const targets = new Map<string, RenameTarget>();
      const add = (fileId: string, line: number) => {
        const key = `${fileId}:${line}`;
        if (targets.has(key)) return;
        const f = files.find((x) => x.id === fileId);
        targets.set(key, { fileId, filePath: f?.relPath ?? fileId, line });
      };
      for (const s of symbols) {
        if (s.name === word) add(s.fileId, s.lineStart);
      }
      for (const r of symbolRefs) {
        if (r.symbolName === word) add(r.fromFileId, r.refLine);
      }
      for (const e of callEdges) {
        if (e.calleeName === word) add(e.callerFileId, e.lineNo);
      }
      let indexed = true;
      if (targets.size === 0) {
        // 降级：仅当前文件内按词边界全量替换（覆盖局部变量/参数等未被 symbols 索引的符号）
        indexed = false;
        const lines = activeTab?.content ? activeTab.content.lines : [];
        const re = new RegExp(`\\b${escapeRegExp(word)}\\b`);
        lines.forEach((ln, i) => {
          if (re.test(ln)) add(activeTab!.fileId, i + 1);
        });
      }
      if (targets.size === 0) {
        useToastStore.getState().showToast(t("workbench.rename.noTarget", { name: word }), "info");
        return;
      }
      setRenameIndexed(indexed);
      setRenameOld(word);
      setRenameNew(word);
      setRenameTargets(Array.from(targets.values()));
      setRenameOpen(true);
    },
    [getActiveTab, symbols, symbolRefs, callEdges, files],
  );

  // 跳转到定义：聚合 symbols 同名候选；单定义直接跳（保持原行为，无回归），
  // 多定义跨文件时弹候选选择器让用户选（对标 Zed navigate_to_hover_links: num_locations>1 → Definitions 浮层，而非静默跳 matches[0]）。
  const handleGoToDefinition = useCallback(
    (info: { word: string; line: number; column: number }) => {
      const word = info.word;
      if (!word) return;
      let matches = symbols.filter((s) => s.name === word);
      if (matches.length === 0) {
        const ci = symbols.find((s) => s.name.toLowerCase() === word.toLowerCase());
        if (ci) matches = [ci];
      }
      if (matches.length === 0) return;
      if (matches.length === 1) {
        const best = matches[0];
        openWorkbenchTab(best.fileId, best.lineStart, t("workbench.jumpToSymbol", { name: word }));
        return;
      }
      const defKinds = new Set([
        "function", "method", "class", "interface", "constructor",
        "enum", "struct", "trait", "module", "namespace", "type",
      ]);
      // 默认选中：优先同文件内定义，其次按定义型符号排序（与 Zed 单一定位点偏好一致）
      const sorted = matches.slice().sort((a, b) => {
        const aSame = a.fileId === activeFileId ? 1 : 0;
        const bSame = b.fileId === activeFileId ? 1 : 0;
        if (aSame !== bSame) return bSame - aSame;
        return (defKinds.has(b.kind) ? 1 : 0) - (defKinds.has(a.kind) ? 1 : 0);
      });
      setDefPickerWord(word);
      setDefPickerCandidates(sorted);
      setDefPickerOpen(true);
    },
    [symbols, activeFileId, openWorkbenchTab],
  );

  // 取某文件当前应写盘文本：优先未保存缓冲区，否则回退到标签内存内容，最后读磁盘。
  // 避免覆盖编辑器里尚未落盘的改动（相比搜索替换轮直接读磁盘，这里更稳妥）。
  const getFileText = useCallback(async (fid: string): Promise<string | null> => {
    const buf = contentBuffers.current.get(fid);
    if (buf != null) return buf;
    const panes = useCodeWorkbenchStore.getState().panes;
    for (const pid in panes) {
      const tt = panes[pid].tabs.find((t) => t.fileId === fid);
      if (tt?.content) return tt.content.lines.join("\n");
    }
    try {
      const src = await projectScanApi.readSourceFile(fid);
      if (src.skippedReason) return null;
      return src.lines.join("\n");
    } catch {
      return null;
    }
  }, []);

  // 确认重命名：按文件分组，逐文件读→行级重写→受控写回（自动 .bak + 登记台账 + 增量重扫）。
  const confirmRename = useCallback(async () => {
    const newName = renameNew.trim();
    if (!newName) {
      useToastStore.getState().showToast(t("workbench.rename.emptyName"), "warning");
      return;
    }
    if (newName === renameOld) {
      setRenameOpen(false);
      return;
    }
    setRenameBusy(true);
    try {
      const byFile = new Map<string, Set<number>>();
      for (const tg of renameTargets) {
        if (!byFile.has(tg.fileId)) byFile.set(tg.fileId, new Set());
        byFile.get(tg.fileId)!.add(tg.line);
      }
      let total = 0;
      let fileCount = 0;
      for (const [fileId, lineSet] of byFile) {
        const text = await getFileText(fileId);
        if (text == null) continue; // 二进制/过大/读取失败：安全跳过，绝不写回
        const lines = text.split("\n");
        for (const ln of lineSet) {
          if (ln >= 1 && ln <= lines.length) {
            const before = lines[ln - 1];
            const { text: after, count } = replaceWordOnLine(before, renameOld, newName);
            if (after !== before) {
              lines[ln - 1] = after;
              total += count;
            }
          }
        }
        await projectScanApi.writeSourceFile(fileId, lines.join("\n"), {
          reason: t("workbench.rename.ledgerReason", { old: renameOld, new: newName }),
          origin: "user",
        });
        fileCount++;
      }
      // 写盘成功后广播重命名事件：引用抽屉(EditorPane)据此乐观刷新（标题/预览/缓存切到新名），
      // 对标 Zed find_all_references 引用视图随 buffer 实时更新。
      emitSymbolRenamed(renameOld, newName);
      useToastStore.getState().showToast(
        t("workbench.rename.done", { old: renameOld, new: newName, count: total, files: fileCount }),
        "success",
      );
    } catch (e) {
      useToastStore.getState().showToast(t("workbench.rename.fail", { error: String(e) }), "error");
    } finally {
      setRenameBusy(false);
      setRenameOpen(false);
    }
  }, [renameNew, renameOld, renameTargets, getFileText]);

  // 全部窗格已打开缓冲区去重聚合（供「切换到打开的文件」模糊缓冲区切换器，对标 Zed buffer_picker 列出全部打开缓冲区）
  const openBuffers = useMemo(() => {
    const seen = new Set<string>();
    const list: { fileId: string; name: string; relPath: string }[] = [];
    for (const p of Object.values(panes)) {
      for (const tab of p.tabs) {
        if (seen.has(tab.fileId)) continue;
        seen.add(tab.fileId);
        list.push({ fileId: tab.fileId, name: tab.name, relPath: tab.relPath });
      }
    }
    return list;
  }, [panes]);

  // 统一命令面板命令注册表（对标 Zed command_palette 的 available_actions）：
  // 动作以数据驱动，组件只负责模糊匹配 / 频次排序 / 历史，不耦合任何业务逻辑。
  const workbenchCommands: WorkbenchCommand[] = useMemo(() => {
    const nav = t("workbench.cmd.catNav");
    const ai = t("workbench.cmd.catAi");
    const view = t("workbench.cmd.catView");
    const file = t("workbench.cmd.catFile");
    const selection = t("workbench.cmd.catSelection");
    const pane = t("workbench.cmd.catPane");
    const diagnostic = t("workbench.cmd.catDiagnostic");
    const edit = t("workbench.cmd.catEdit");
    const tabsCat = t("workbench.cmd.catTabs");
    const fold = t("workbench.cmd.catFold");
    const bookmarksCat = t("workbench.cmd.catBookmarks");
    const convert = t("workbench.cmd.catConvert");
    const catLines = t("workbench.cmd.catLines");
    return [
      {
        id: "gotoFile",
        title: t("workbench.cmd.gotoFile"),
        category: nav,
        keybinding: "Ctrl/Cmd+P",
        keywords: "open file quick switch",
        run: () => setQuickOpenOpen(true),
      },
      {
        id: "gotoLine",
        title: t("workbench.cmd.gotoLine"),
        category: nav,
        keybinding: "Ctrl/Cmd+G",
        keywords: "go to line column jump navigate",
        run: () => setGotoOpen(true),
      },
      {
        id: "gotoSymbol",
        title: t("workbench.cmd.gotoSymbol"),
        category: nav,
        keybinding: "Ctrl/Cmd+Shift+O",
        keywords: "symbol function class interface jump navigate definition",
        run: () => setSymbolOpen(true),
      },
      {
        id: "goToDefinition",
        title: t("workbench.cmd.goToDefinition"),
        category: nav,
        keybinding: "F12",
        keywords: "definition jump navigate symbol",
        run: () => editorHandleRef.current?.goToDefinition(),
      },
      {
        id: "findReferences",
        title: t("workbench.cmd.findReferences"),
        category: nav,
        keybinding: "Shift+F12",
        keywords: "references usages find all navigate",
        run: () => editorHandleRef.current?.findReferences(),
      },
      {
        id: "peekDefinition",
        title: t("workbench.cmd.peekDefinition"),
        category: nav,
        keybinding: "Alt+F12",
        keywords: "peek definition preview inline glance navigate",
        run: () => editorHandleRef.current?.peekDefinition(),
      },
      {
        id: "goToTypeDefinition",
        title: t("workbench.cmd.goToTypeDefinition"),
        category: nav,
        keywords: "type definition jump navigate",
        run: () => editorHandleRef.current?.goToTypeDefinition(),
      },
      {
        id: "goToImplementation",
        title: t("workbench.cmd.goToImplementation"),
        category: nav,
        keywords: "implementation jump navigate",
        run: () => editorHandleRef.current?.goToImplementation(),
      },
      {
        id: "goToDeclaration",
        title: t("workbench.cmd.goToDeclaration"),
        category: nav,
        keywords: "declaration jump navigate",
        run: () => editorHandleRef.current?.goToDeclaration(),
      },
      {
        id: "searchProject",
        title: t("workbench.cmd.searchProject"),
        category: nav,
        keybinding: "Ctrl/Cmd+Shift+F",
        keywords: "search find in files content grep project",
        run: () => setSearchOpen(true),
      },
      {
        id: "renameSymbol",
        title: t("workbench.cmd.renameSymbol"),
        category: nav,
        keybinding: "F2",
        keywords: "rename symbol refactor identifier",
        run: () => {
          const w = editorHandleRef.current?.getWordAtCursor();
          if (w) handleRenameSymbol({ word: w, line: 0, column: 0 });
        },
      },
      {
        id: "addCursorAbove",
        title: t("workbench.cmd.addCursorAbove"),
        category: selection,
        keybinding: "Ctrl/Cmd+Alt+↑",
        keywords: "multi cursor selection above add edit",
        run: () => editorHandleRef.current?.addSelectionAbove(),
      },
      {
        id: "addCursorBelow",
        title: t("workbench.cmd.addCursorBelow"),
        category: selection,
        keybinding: "Ctrl/Cmd+Alt+↓",
        keywords: "multi cursor selection below add edit",
        run: () => editorHandleRef.current?.addSelectionBelow(),
      },
      {
        id: "selectAllMatches",
        title: t("workbench.cmd.selectAllMatches"),
        category: selection,
        keybinding: "Ctrl/Cmd+Shift+L",
        keywords: "select all occurrences matches multi cursor replace",
        run: () => editorHandleRef.current?.selectAllMatches(),
      },
      {
        id: "addSelectionToNextMatch",
        title: t("workbench.cmd.addSelectionNext"),
        category: selection,
        keybinding: "Ctrl/Cmd+D",
        keywords: "add next occurrence match selection multi cursor incremental",
        run: () => editorHandleRef.current?.addSelectionToNextMatch(),
      },
      {
        id: "addSelectionToPreviousMatch",
        title: t("workbench.cmd.addSelectionPrev"),
        category: selection,
        keybinding: "Ctrl/Cmd+Shift+D",
        keywords: "add previous occurrence match selection multi cursor incremental reverse",
        run: () => editorHandleRef.current?.addSelectionToPreviousMatch(),
      },
      {
        id: "toggleColumnSelection",
        title: t("workbench.cmd.toggleColumnSelection"),
        category: selection,
        keywords: "column block rectangular selection alt drag",
        run: () => editorHandleRef.current?.toggleColumnSelection(),
      },
      {
        id: "expandSelection",
        title: t("workbench.cmd.expandSelection"),
        category: selection,
        keybinding: "Shift+Alt+→",
        keywords: "select larger syntax node expand selection smart select",
        run: () => editorHandleRef.current?.expandSelection(),
      },
      {
        id: "shrinkSelection",
        title: t("workbench.cmd.shrinkSelection"),
        category: selection,
        keybinding: "Shift+Alt+←",
        keywords: "select smaller syntax node shrink selection smart select",
        run: () => editorHandleRef.current?.shrinkSelection(),
      },
      {
        id: "toggleLineComment",
        title: t("workbench.cmd.toggleLineComment"),
        category: edit,
        keybinding: "Ctrl/Cmd+/",
        keywords: "comment line toggle edit",
        run: () => editorHandleRef.current?.toggleLineComment(),
      },
      {
        id: "toggleBlockComment",
        title: t("workbench.cmd.toggleBlockComment"),
        category: edit,
        keybinding: "Shift+Alt+A",
        keywords: "comment block toggle edit",
        run: () => editorHandleRef.current?.toggleBlockComment(),
      },
      {
        id: "formatDocument",
        title: t("workbench.cmd.formatDocument"),
        category: edit,
        keybinding: "Shift+Alt+F",
        keywords: "format document indent edit",
        run: () => editorHandleRef.current?.formatDocument(),
      },
      {
        id: "duplicateLine",
        title: t("workbench.cmd.duplicateLine"),
        category: edit,
        keybinding: "Shift+Alt+↓",
        keywords: "duplicate line copy down edit",
        run: () => editorHandleRef.current?.duplicateLine(),
      },
      {
        id: "moveLineUp",
        title: t("workbench.cmd.moveLineUp"),
        category: edit,
        keybinding: "Alt+↑",
        keywords: "move line up edit",
        run: () => editorHandleRef.current?.moveLineUp(),
      },
      {
        id: "moveLineDown",
        title: t("workbench.cmd.moveLineDown"),
        category: edit,
        keybinding: "Alt+↓",
        keywords: "move line down edit",
        run: () => editorHandleRef.current?.moveLineDown(),
      },
      {
        id: "joinLines",
        title: t("workbench.cmd.joinLines"),
        category: edit,
        keybinding: "Ctrl/Cmd+J",
        keywords: "join lines merge edit",
        run: () => editorHandleRef.current?.joinLines(),
      },
      // —— 行结构编辑（对标 Zed DeleteLine / InsertNewlineAbove / InsertNewlineBelow / Transpose）——
      // 此前这些日常操作仅能靠 Monaco 原生键位（若有），命令面板与右键菜单均不可达＝renderable≠useful 缺口；本轮补齐可达入口。
      {
        id: "deleteLine",
        title: t("workbench.cmd.deleteLine"),
        category: edit,
        keybinding: "Ctrl/Cmd+Shift+K",
        keywords: "delete line remove edit",
        run: () => editorHandleRef.current?.deleteLine(),
      },
      {
        id: "insertLineAbove",
        title: t("workbench.cmd.insertLineAbove"),
        category: edit,
        keywords: "insert line above newline edit",
        run: () => editorHandleRef.current?.insertLineAbove(),
      },
      {
        id: "insertLineBelow",
        title: t("workbench.cmd.insertLineBelow"),
        category: edit,
        keywords: "insert line below newline edit",
        run: () => editorHandleRef.current?.insertLineBelow(),
      },
      {
        id: "transpose",
        title: t("workbench.cmd.transpose"),
        category: edit,
        keywords: "transpose swap characters edit",
        run: () => editorHandleRef.current?.transpose(),
      },
      // —— 缩进 / 取消缩进 / 向上复制行（对标 Zed Indent / Outdent / DuplicateLineUp）——
      // 此前仅能靠原生 Tab/Shift+Tab 键位（且依赖编辑器聚焦），命令面板与右键菜单均不可达＝renderable≠useful 缺口；本轮补齐双入口。
      {
        id: "indentSelection",
        title: t("workbench.cmd.indentSelection"),
        category: edit,
        keybinding: "Tab",
        keywords: "indent selection increase tab edit",
        run: () => editorHandleRef.current?.indentSelection(),
      },
      {
        id: "outdentSelection",
        title: t("workbench.cmd.outdentSelection"),
        category: edit,
        keybinding: "Shift+Tab",
        keywords: "outdent selection decrease untab edit",
        run: () => editorHandleRef.current?.outdentSelection(),
      },
      {
        id: "duplicateLineUp",
        title: t("workbench.cmd.duplicateLineUp"),
        category: edit,
        keybinding: "Shift+Alt+↑",
        keywords: "duplicate line up copy edit",
        run: () => editorHandleRef.current?.duplicateLineUp(),
      },
      // —— 词级移动 / 扩选 / 删除（对标 Zed MoveWordLeft/Right、SelectToPreviousWordStart/NextWordEnd、DeleteWordLeft/Right）——
      // 此前仅能靠 Monaco 原生 Ctrl/Cmd+←/→/Backspace/Delete 键位（且依赖编辑器聚焦），命令面板与右键菜单均不可达＝renderable≠useful 缺口；本轮补齐双入口。
      {
        id: "moveWordLeft",
        title: t("workbench.cmd.moveWordLeft"),
        category: edit,
        keywords: "move word left caret navigate edit",
        run: () => editorHandleRef.current?.moveWordLeft(),
      },
      {
        id: "moveWordRight",
        title: t("workbench.cmd.moveWordRight"),
        category: edit,
        keywords: "move word right caret navigate edit",
        run: () => editorHandleRef.current?.moveWordRight(),
      },
      {
        id: "selectWordLeft",
        title: t("workbench.cmd.selectWordLeft"),
        category: edit,
        keywords: "select word left extend selection edit",
        run: () => editorHandleRef.current?.selectWordLeft(),
      },
      {
        id: "selectWordRight",
        title: t("workbench.cmd.selectWordRight"),
        category: edit,
        keywords: "select word right extend selection edit",
        run: () => editorHandleRef.current?.selectWordRight(),
      },
      {
        id: "deleteWordLeft",
        title: t("workbench.cmd.deleteWordLeft"),
        category: edit,
        keywords: "delete word left backspace edit",
        run: () => editorHandleRef.current?.deleteWordLeft(),
      },
      {
        id: "deleteWordRight",
        title: t("workbench.cmd.deleteWordRight"),
        category: edit,
        keywords: "delete word right edit",
        run: () => editorHandleRef.current?.deleteWordRight(),
      },
      // —— 子词级移动 / 扩选 / 删除（对标 Zed MoveTo*Subword / SelectTo*Subword / DeleteTo*Subword*：camelCase/下划线切分的子词粒度）——
      // 此前整词家族已补命令面板/右键双入口，子词维度完全缺失＝renderable≠useful 缺口（03:00 轮待续②）；本轮补齐双入口。
      {
        id: "moveSubwordLeft",
        title: t("workbench.cmd.moveSubwordLeft"),
        category: edit,
        keywords: "subword move left caret navigate camelcase edit",
        run: () => editorHandleRef.current?.moveSubwordLeft(),
      },
      {
        id: "moveSubwordRight",
        title: t("workbench.cmd.moveSubwordRight"),
        category: edit,
        keywords: "subword move right caret navigate camelcase edit",
        run: () => editorHandleRef.current?.moveSubwordRight(),
      },
      {
        id: "selectSubwordLeft",
        title: t("workbench.cmd.selectSubwordLeft"),
        category: edit,
        keywords: "subword select left extend selection camelcase edit",
        run: () => editorHandleRef.current?.selectSubwordLeft(),
      },
      {
        id: "selectSubwordRight",
        title: t("workbench.cmd.selectSubwordRight"),
        category: edit,
        keywords: "subword select right extend selection camelcase edit",
        run: () => editorHandleRef.current?.selectSubwordRight(),
      },
      {
        id: "deleteSubwordLeft",
        title: t("workbench.cmd.deleteSubwordLeft"),
        category: edit,
        keywords: "subword delete left backspace camelcase edit",
        run: () => editorHandleRef.current?.deleteSubwordLeft(),
      },
      {
        id: "deleteSubwordRight",
        title: t("workbench.cmd.deleteSubwordRight"),
        category: edit,
        keywords: "subword delete right camelcase edit",
        run: () => editorHandleRef.current?.deleteSubwordRight(),
      },
      {
        id: "deleteToNextWordStart",
        title: t("workbench.cmd.deleteToNextWordStart"),
        category: edit,
        keywords: "delete next word start skip edit",
        run: () => editorHandleRef.current?.deleteToNextWordStart(),
      },
      {
        id: "deleteToPreviousWordEnd",
        title: t("workbench.cmd.deleteToPreviousWordEnd"),
        category: edit,
        keywords: "delete previous word end edit",
        run: () => editorHandleRef.current?.deleteToPreviousWordEnd(),
      },
      // —— 行首尾编辑（对标 Zed MoveToEndOfLine / MoveToStartOfLine / DeleteToEndOfLine / DeleteToStartOfLine / CutToEndOfLine / CutToStartOfLine）——
      // 此前这些日常操作仅能靠 Monaco 原生 End/Home/Shift+Del 键位（依赖编辑器聚焦），命令面板与右键菜单均不可达＝renderable≠useful 缺口。
      {
        id: "moveToEndOfLine",
        title: t("workbench.cmd.moveToEndOfLine"),
        category: edit,
        keybinding: "End",
        keywords: "move end of line caret edit",
        run: () => editorHandleRef.current?.moveToEndOfLine(),
      },
      {
        id: "moveToStartOfLine",
        title: t("workbench.cmd.moveToStartOfLine"),
        category: edit,
        keybinding: "Home",
        keywords: "move start of line caret edit",
        run: () => editorHandleRef.current?.moveToStartOfLine(),
      },
      {
        id: "deleteToEndOfLine",
        title: t("workbench.cmd.deleteToEndOfLine"),
        category: edit,
        keywords: "delete end of line edit",
        run: () => editorHandleRef.current?.deleteToEndOfLine(),
      },
      {
        id: "deleteToStartOfLine",
        title: t("workbench.cmd.deleteToStartOfLine"),
        category: edit,
        keywords: "delete start of line edit",
        run: () => editorHandleRef.current?.deleteToStartOfLine(),
      },
      {
        id: "cutToEndOfLine",
        title: t("workbench.cmd.cutToEndOfLine"),
        category: edit,
        keywords: "cut end of line clipboard edit",
        run: () => editorHandleRef.current?.cutToEndOfLine(),
      },
      {
        id: "cutToStartOfLine",
        title: t("workbench.cmd.cutToStartOfLine"),
        category: edit,
        keywords: "cut start of line clipboard edit",
        run: () => editorHandleRef.current?.cutToStartOfLine(),
      },
      {
        id: "goToMatchingBracket",
        title: t("workbench.cmd.goToMatchingBracket"),
        category: edit,
        keybinding: "Ctrl/Cmd+Shift+\\",
        keywords: "matching bracket jump navigate edit",
        run: () => editorHandleRef.current?.goToMatchingBracket(),
      },
      {
        id: "moveToEnclosingBracket",
        title: t("workbench.cmd.moveToEnclosingBracket"),
        category: edit,
        keywords: "enclosing bracket move navigate edit",
        run: () => editorHandleRef.current?.moveToEnclosingBracket(),
      },
      {
        id: "selectToEnclosingBracket",
        title: t("workbench.cmd.selectToEnclosingBracket"),
        category: edit,
        keywords: "enclosing bracket select edit",
        run: () => editorHandleRef.current?.selectToEnclosingBracket(),
      },
      // —— 文本大小写转换（对标 Zed ConvertTo* 家族：UpperCase/LowerCase/TitleCase/SnakeCase/KebabCase/UpperCamelCase/LowerCamelCase/SentenceCase）——
      // 算法逐字移植 Zed convert_case（defaults 边界），命令面板入口保证可达（无需先聚焦编辑器也能转换）；选区为空时取光标处单词。
      {
        id: "convertUpper",
        title: t("workbench.cmd.convertUpper"),
        category: convert,
        keywords: "upper case uppercase transform convert",
        run: () => editorHandleRef.current?.convertToUpper(),
      },
      {
        id: "convertLower",
        title: t("workbench.cmd.convertLower"),
        category: convert,
        keywords: "lower case lowercase transform convert",
        run: () => editorHandleRef.current?.convertToLower(),
      },
      {
        id: "convertTitle",
        title: t("workbench.cmd.convertTitle"),
        category: convert,
        keywords: "title case transform convert",
        run: () => editorHandleRef.current?.convertToTitle(),
      },
      {
        id: "convertSnake",
        title: t("workbench.cmd.convertSnake"),
        category: convert,
        keywords: "snake case underscore transform convert",
        run: () => editorHandleRef.current?.convertToSnake(),
      },
      {
        id: "convertKebab",
        title: t("workbench.cmd.convertKebab"),
        category: convert,
        keywords: "kebab case hyphen dash transform convert",
        run: () => editorHandleRef.current?.convertToKebab(),
      },
      {
        id: "convertPascal",
        title: t("workbench.cmd.convertPascal"),
        category: convert,
        keywords: "pascal case upper camel transform convert",
        run: () => editorHandleRef.current?.convertToPascal(),
      },
      {
        id: "convertCamel",
        title: t("workbench.cmd.convertCamel"),
        category: convert,
        keywords: "camel case lower camel transform convert",
        run: () => editorHandleRef.current?.convertToCamel(),
      },
      {
        id: "convertSentence",
        title: t("workbench.cmd.convertSentence"),
        category: convert,
        keywords: "sentence case transform convert",
        run: () => editorHandleRef.current?.convertToSentence(),
      },
      // —— 行级排序 / 去重（对标 Zed SortLines* / UniqueLines*：选区独立变换，命令面板保证可达，无全局键位以免劫持 Monaco 原生 chords）——
      {
        id: "sortLinesCI",
        title: t("workbench.cmd.sortLinesCI"),
        category: catLines,
        keywords: "sort lines alphabetical case insensitive order arrange",
        run: () => editorHandleRef.current?.sortLinesCI(),
      },
      {
        id: "sortLinesCS",
        title: t("workbench.cmd.sortLinesCS"),
        category: catLines,
        keywords: "sort lines alphabetical case sensitive order arrange",
        run: () => editorHandleRef.current?.sortLinesCS(),
      },
      {
        id: "sortLinesLen",
        title: t("workbench.cmd.sortLinesLen"),
        category: catLines,
        keywords: "sort lines length shortest longest order arrange",
        run: () => editorHandleRef.current?.sortLinesLen(),
      },
      {
        id: "uniqueLinesCI",
        title: t("workbench.cmd.uniqueLinesCI"),
        category: catLines,
        keywords: "unique dedupe remove duplicate lines case insensitive",
        run: () => editorHandleRef.current?.uniqueLinesCI(),
      },
      {
        id: "uniqueLinesCS",
        title: t("workbench.cmd.uniqueLinesCS"),
        category: catLines,
        keywords: "unique dedupe remove duplicate lines case sensitive",
        run: () => editorHandleRef.current?.uniqueLinesCS(),
      },
      {
        id: "goToNextProblem",
        title: t("workbench.cmd.goToNextProblem"),
        category: diagnostic,
        keybinding: "F8",
        keywords: "diagnostic error warning next problem jump navigate",
        run: () => editorHandleRef.current?.goToNextProblem(),
      },
      {
        id: "goToPrevProblem",
        title: t("workbench.cmd.goToPrevProblem"),
        category: diagnostic,
        keybinding: "Shift+F8",
        keywords: "diagnostic error warning previous problem jump navigate",
        run: () => editorHandleRef.current?.goToPrevProblem(),
      },
      {
        id: "fold",
        title: t("workbench.cmd.fold"),
        category: fold,
        keybinding: "Ctrl/Cmd+Shift+[",
        keywords: "fold collapse region cursor",
        run: () => editorHandleRef.current?.foldAtCursor(),
      },
      {
        id: "unfold",
        title: t("workbench.cmd.unfold"),
        category: fold,
        keybinding: "Ctrl/Cmd+Shift+]",
        keywords: "unfold expand region cursor",
        run: () => editorHandleRef.current?.unfoldAtCursor(),
      },
      {
        id: "toggleFold",
        title: t("workbench.cmd.toggleFold"),
        category: fold,
        keybinding: "Ctrl/Cmd+K Ctrl+L",
        keywords: "toggle fold collapse",
        run: () => editorHandleRef.current?.toggleFoldAtCursor(),
      },
      {
        id: "foldRecursively",
        title: t("workbench.cmd.foldRecursively"),
        category: fold,
        keybinding: "Ctrl/Cmd+K Ctrl+[",
        keywords: "fold recursively nested collapse",
        run: () => editorHandleRef.current?.foldRecursively(),
      },
      {
        id: "unfoldRecursively",
        title: t("workbench.cmd.unfoldRecursively"),
        category: fold,
        keybinding: "Ctrl/Cmd+K Ctrl+]",
        keywords: "unfold recursively nested expand",
        run: () => editorHandleRef.current?.unfoldRecursively(),
      },
      {
        id: "foldAll",
        title: t("workbench.cmd.foldAll"),
        category: fold,
        keybinding: "Ctrl/Cmd+K Ctrl+0",
        keywords: "fold all collapse everything",
        run: () => editorHandleRef.current?.foldAll(),
      },
      {
        id: "unfoldAll",
        title: t("workbench.cmd.unfoldAll"),
        category: fold,
        keybinding: "Ctrl/Cmd+K Ctrl+J",
        keywords: "unfold all expand everything",
        run: () => editorHandleRef.current?.unfoldAll(),
      },
      {
        id: "foldSelection",
        title: t("workbench.cmd.foldSelection"),
        category: fold,
        keybinding: "Ctrl/Cmd+K Ctrl+,",
        keywords: "fold selected selection region collapse",
        run: () => editorHandleRef.current?.foldSelection(),
      },
      ...Array.from({ length: 7 }, (_, i) => i + 1).map((lv) => ({
        id: `foldLevel${lv}`,
        title: t("workbench.cmd.foldLevel", { level: lv }),
        category: fold,
        keybinding: `Ctrl/Cmd+K Ctrl+${lv}`,
        keywords: `fold level ${lv} collapse nesting depth`,
        run: () => editorHandleRef.current?.foldLevel(lv),
      })),
      {
        id: "toggleWordWrap",
        title: t("workbench.cmd.toggleWordWrap"),
        category: fold,
        keybinding: "Alt+Z",
        keywords: "soft wrap word wrap line wrap toggle",
        run: () => editorHandleRef.current?.toggleWordWrap(),
      },
      {
        id: "foldFunctionBodies",
        title: t("workbench.cmd.foldFunctionBodies"),
        category: fold,
        keywords: "fold function bodies collapse definitions classes methods rust fn",
        run: () => editorHandleRef.current?.foldFunctionBodies(),
      },
      // —— 书签（对标 Zed ToggleBookmark / GoToNextBookmark / GoToPreviousBookmark / ViewBookmarks）——
      {
        id: "toggleBookmark",
        title: t("workbench.cmd.toggleBookmark"),
        category: bookmarksCat,
        keybinding: "Ctrl/Cmd+F2",
        keywords: "bookmark mark line gutter toggle pin",
        run: () => editorHandleRef.current?.toggleBookmark(),
      },
      {
        id: "nextBookmark",
        title: t("workbench.cmd.nextBookmark"),
        category: bookmarksCat,
        keybinding: "Ctrl/Cmd+Shift+F2",
        keywords: "bookmark next jump navigate",
        run: () => editorHandleRef.current?.goToNextBookmark(),
      },
      {
        id: "prevBookmark",
        title: t("workbench.cmd.prevBookmark"),
        category: bookmarksCat,
        keybinding: "Ctrl/Cmd+Alt+F2",
        keywords: "bookmark previous jump navigate",
        run: () => editorHandleRef.current?.goToPrevBookmark(),
      },
      {
        id: "viewBookmarks",
        title: t("workbench.cmd.viewBookmarks"),
        category: bookmarksCat,
        keywords: "bookmarks list all view jump navigate picker",
        run: () => setBookmarkPickerOpen(true),
      },
      {
        id: "toggleAi",
        title: t("workbench.cmd.toggleAi"),
        category: ai,
        keywords: "chat assistant panel",
        run: () => setAiOpen((v) => !v),
      },
      {
        id: "openRequirements",
        title: t("workbench.cmd.openRequirements"),
        category: ai,
        keywords: "requirements spec capture",
        run: () => {
          setRightTab(1);
          setAiOpen(true);
        },
      },
      {
        id: "toggleTerminal",
        title: t("workbench.cmd.toggleTerminal"),
        category: view,
        keybinding: "Ctrl/Cmd+`",
        keywords: "console shell",
        run: () => setTerminalOpen((v) => !v),
      },
      {
        id: "toggleProblems",
        title: t("workbench.cmd.toggleProblems"),
        category: view,
        keywords: "diagnostics problems errors warnings panel",
        run: () => useProblemsPanelStore.getState().toggle(),
      },
      {
        id: "toggleOutline",
        title: t("workbench.cmd.toggleOutline"),
        category: view,
        keywords: "symbol structure map",
        run: () => setOutlineOpen((v) => !v),
      },
      {
        id: "toggleInlineAi",
        title: t("workbench.cmd.toggleInlineAi"),
        category: ai,
        keywords: "inline assist ask",
        run: () => setInlineOpen((v) => !v),
      },
      {
        id: "copyPath",
        title: t("workbench.cmd.copyPath"),
        category: file,
        keywords: "clipboard path",
        run: () => {
          if (activeTab?.relPath) navigator.clipboard?.writeText(activeTab.relPath);
        },
      },
      {
        id: "locateFile",
        title: t("workbench.cmd.locateFile"),
        category: file,
        keywords: "tree reveal focus",
        run: () => {
          if (!activeTab) return;
          const parts = activeTab.relPath.split("/");
          let p = "";
          const anc = new Set<string>();
          for (let i = 0; i < parts.length - 1; i++) {
            p = p ? `${p}/${parts[i]}` : parts[i];
            anc.add(p);
          }
          setExpanded(anc);
        },
      },
      {
        id: "closeCurrentTab",
        title: t("workbench.cmd.closeCurrentTab"),
        category: file,
        keywords: "close tab",
        run: () => {
          if (activeFileId) closeTab(activeFileId);
        },
      },
      {
        id: "nextTab",
        title: t("workbench.cmd.nextTab"),
        category: tabsCat,
        keybinding: "Ctrl/Cmd+PageDown",
        keywords: "switch tab forward next",
        run: () => useCodeWorkbenchStore.getState().activateNextTab(),
      },
      {
        id: "prevTab",
        title: t("workbench.cmd.prevTab"),
        category: tabsCat,
        keybinding: "Ctrl/Cmd+PageUp",
        keywords: "switch tab back previous",
        run: () => useCodeWorkbenchStore.getState().activatePrevTab(),
      },
      {
        id: "lastTab",
        title: t("workbench.cmd.lastTab"),
        category: tabsCat,
        keywords: "switch tab last final end",
        run: () => {
          if (tabs.length) useCodeWorkbenchStore.getState().activateTabByIndex(tabs.length - 1);
        },
      },
      // —— 标签管理家族（对标 Zed pane::close_other_items / close_items_to_the_left|right / close_all_items，
      //    均保留 pinned；此前仅右键菜单可达，命令面板不可达 = renderable≠useful 发现性缺口） ——
      {
        id: "closeOthers",
        title: t("workbench.cmd.closeOthers"),
        category: tabsCat,
        keywords: "close others tabs keep active",
        run: () => { if (activeFileId) useCodeWorkbenchStore.getState().closeOthers(activeFileId); },
      },
      {
        id: "closeLeft",
        title: t("workbench.cmd.closeLeft"),
        category: tabsCat,
        keywords: "close left tabs",
        run: () => { if (activeFileId) useCodeWorkbenchStore.getState().closeLeft(activeFileId); },
      },
      {
        id: "closeRight",
        title: t("workbench.cmd.closeRight"),
        category: tabsCat,
        keywords: "close right tabs",
        run: () => { if (activeFileId) useCodeWorkbenchStore.getState().closeRight(activeFileId); },
      },
      {
        id: "closeAll",
        title: t("workbench.cmd.closeAll"),
        category: tabsCat,
        keywords: "close all tabs",
        run: () => useCodeWorkbenchStore.getState().closeAll(),
      },
      {
        id: "pinTab",
        title: t("workbench.cmd.pinTab"),
        category: tabsCat,
        keywords: "pin unpin tab toggle",
        run: () => { if (activeFileId) useCodeWorkbenchStore.getState().togglePin(activeFileId); },
      },
      // 按序号定位标签（对标 Zed pane::activate_item(N)；Alt+1..9 已绑，此处仅补面板曝光）
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `goToTab${i + 1}`,
        title: t("workbench.cmd.goToTab", { n: i + 1 }),
        category: tabsCat,
        keywords: `go to tab ${i + 1} switch index`,
        run: () => useCodeWorkbenchStore.getState().activateTabByIndex(i),
      })),
      // —— 切换到打开的文件（对标 Zed buffer_picker：列出全部已打开缓冲区，模糊过滤后跳） ——
      ...openBuffers.map((b) => ({
        id: `buffer:${b.fileId}`,
        title: b.name,
        category: tabsCat,
        keywords: `switch open buffer ${b.relPath}`,
        run: () => useCodeWorkbenchStore.getState().activateBuffer(b.fileId),
      })),
      {
        id: "resetLayout",
        title: t("workbench.cmd.resetLayout"),
        category: view,
        keywords: "reset layout panes split restore default",
        run: () => {
          resetLayout();
          useToastStore.getState().showToast(
            t("workbench.layout.resetToast"),
            "success"
          );
        },
      },
      // —— 编辑器字号缩放（对标 Zed IncreaseBufferFontSize / DecreaseBufferFontSize / ResetBufferFontSize）——
      // 此前编辑器无任何字号控制入口（命令面板/状态栏均缺失）＝renderable≠useful 缺口；本轮补齐双入口。
      {
        id: "increaseFont",
        title: t("workbench.cmd.increaseFont"),
        category: view,
        keywords: "font size larger zoom in increase editor readability",
        run: () => editorHandleRef.current?.increaseFont(),
      },
      {
        id: "decreaseFont",
        title: t("workbench.cmd.decreaseFont"),
        category: view,
        keywords: "font size smaller zoom out decrease editor readability",
        run: () => editorHandleRef.current?.decreaseFont(),
      },
      {
        id: "resetFont",
        title: t("workbench.cmd.resetFont"),
        category: view,
        keywords: "font size reset default editor zoom restore",
        run: () => editorHandleRef.current?.resetFont(),
      },
      // —— 窗格导航（对标 Zed ActivatePaneInDirection / ActivateNextPane / SwapPanesInDirection） ——
      {
        id: "focusPaneLeft",
        title: t("workbench.cmd.focusPaneLeft"),
        category: pane,
        keybinding: "Ctrl/Cmd+Shift+Alt+←",
        keywords: "pane focus left navigate split",
        run: () => useCodeWorkbenchStore.getState().activatePaneInDirection("left"),
      },
      {
        id: "focusPaneRight",
        title: t("workbench.cmd.focusPaneRight"),
        category: pane,
        keybinding: "Ctrl/Cmd+Shift+Alt+→",
        keywords: "pane focus right navigate split",
        run: () => useCodeWorkbenchStore.getState().activatePaneInDirection("right"),
      },
      {
        id: "focusPaneUp",
        title: t("workbench.cmd.focusPaneUp"),
        category: pane,
        keybinding: "Ctrl/Cmd+Shift+Alt+↑",
        keywords: "pane focus up navigate split",
        run: () => useCodeWorkbenchStore.getState().activatePaneInDirection("up"),
      },
      {
        id: "focusPaneDown",
        title: t("workbench.cmd.focusPaneDown"),
        category: pane,
        keybinding: "Ctrl/Cmd+Shift+Alt+↓",
        keywords: "pane focus down navigate split",
        run: () => useCodeWorkbenchStore.getState().activatePaneInDirection("down"),
      },
      {
        id: "focusPaneNext",
        title: t("workbench.cmd.focusPaneNext"),
        category: pane,
        keybinding: "Ctrl/Cmd+Alt+]",
        keywords: "pane next cycle focus",
        run: () => useCodeWorkbenchStore.getState().activateNextPane(),
      },
      {
        id: "focusPanePrev",
        title: t("workbench.cmd.focusPanePrev"),
        category: pane,
        keybinding: "Ctrl/Cmd+Alt+[",
        keywords: "pane previous cycle focus",
        run: () => useCodeWorkbenchStore.getState().activatePrevPane(),
      },
      {
        id: "swapPaneLeft",
        title: t("workbench.cmd.swapPaneLeft"),
        category: pane,
        keywords: "pane swap left exchange position",
        run: () => useCodeWorkbenchStore.getState().swapPanesInDirection("left"),
      },
      {
        id: "swapPaneRight",
        title: t("workbench.cmd.swapPaneRight"),
        category: pane,
        keywords: "pane swap right exchange position",
        run: () => useCodeWorkbenchStore.getState().swapPanesInDirection("right"),
      },
      {
        id: "swapPaneUp",
        title: t("workbench.cmd.swapPaneUp"),
        category: pane,
        keywords: "pane swap up exchange position",
        run: () => useCodeWorkbenchStore.getState().swapPanesInDirection("up"),
      },
      {
        id: "swapPaneDown",
        title: t("workbench.cmd.swapPaneDown"),
        category: pane,
        keywords: "pane swap down exchange position",
        run: () => useCodeWorkbenchStore.getState().swapPanesInDirection("down"),
      },
    ];
  }, [
    t,
    activeTab,
    activeFileId,
    tabs,
    setAiOpen,
    setRightTab,
    setTerminalOpen,
    setOutlineOpen,
    setInlineOpen,
    setExpanded,
    setQuickOpenOpen,
    closeTab,
    setActive,
    openBuffers,
    resetLayout,
    handleRenameSymbol,
    editorHandleRef,
  ]);

  // 取某文件当前应写盘的文本：优先未保存缓冲区，否则回退到标签内存内容（Ctrl+S 无改动时也安全）
  const getTabText = useCallback((fid: string): string | null => {
    const buf = contentBuffers.current.get(fid);
    if (buf != null) return buf;
    const tab = useCodeWorkbenchStore.getState().panes[useCodeWorkbenchStore.getState().activePaneId]?.tabs.find((t) => t.fileId === fid);
    return tab?.content ? tab.content.lines.join("\n") : null;
  }, []);

  // 清掉某文件待触发的保存定时器（切标签/关标签/立即保存前调用，避免旧定时器错写到别的文件）
  const clearSaveTimer = useCallback((fid: string) => {
    const t = saveTimers.current.get(fid);
    if (t) {
      clearTimeout(t);
      saveTimers.current.delete(fid);
    }
  }, []);

  // 自动保存：防抖写回磁盘（编辑停止 800ms 后触发）
  const flushSave = useCallback(
    async (fid: string) => {
      clearSaveTimer(fid);
      const text = getTabText(fid);
      if (!fid || text == null) return;
      const toast = useToastStore.getState().showToast;
      try {
        const res = await projectScanApi.writeSourceFile(fid, text);
        // 写盘成功 → 该文件回到「干净」状态：清缓冲区 + 标记刚由我们写盘（区分外部改盘）
        contentBuffers.current.delete(fid);
        justWroteByUs.current.set(fid, Date.now());
        useCodeWorkbenchStore.getState().setContent(fid, text);
        toast(t("workbench.autoSaved", { file: res.relPath }), "success");
      } catch (e) {
        toast(t("workbench.saveFail", { error: e instanceof Error ? e.message : String(e) }), "error");
      }
    },
    [clearSaveTimer, getTabText],
  );

  const scheduleSave = useCallback(
    (fid: string) => {
      clearSaveTimer(fid);
      saveTimers.current.set(
        fid,
        setTimeout(() => {
          void flushSave(fid);
        }, 800),
      );
    },
    [clearSaveTimer, flushSave],
  );

  // 切/关标签前先把当前文件待写缓冲区落盘，避免静默丢改动（P0-A）
  const flushPendingBeforeLeave = useCallback(
    (fid: string | null) => {
      if (!fid) return;
      if (contentBuffers.current.has(fid)) {
        clearSaveTimer(fid);
        void flushSave(fid);
      }
    },
    [clearSaveTimer, flushSave],
  );

  // 切/关标签前先落盘当前文件待写缓冲区（P0-A 防静默丢改动）

  // Ctrl/Cmd+S 立即写回（仍屏蔽浏览器保存对话框；自动保存已覆盖常规场景）；终端内按键放行给 PTY
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTerminalTarget(e)) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        flushPendingBeforeLeave(activeFileId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flushPendingBeforeLeave, activeFileId]);

  // P0-B：监听外部/AI 改盘，避免 AI 改完被用户下一次按键静默覆盖
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await listen<FileChangeEvent[]>("file-changes", (event) => {
          const changes = Array.isArray(event.payload) ? event.payload : [];
          if (!changes.length) return;
          const openTabs = useCodeWorkbenchStore.getState().panes[useCodeWorkbenchStore.getState().activePaneId]?.tabs ?? EMPTY_TABS;
          for (const c of changes) {
            if (c.kind === "removed") continue;
            const p = c.path.replace(/\\/g, "/");
            const match = openTabs.find((t) => {
              const r = t.relPath.replace(/\\/g, "/");
              return p === r || p.endsWith("/" + r);
            });
            if (!match) continue;
            const fid = match.fileId;
            // 我们自己刚写盘的，跳过（否则会把自己刚保存的当成外部改盘）
            const wrote = justWroteByUs.current.get(fid);
            if (wrote && Date.now() - wrote < 2000) continue;
            if (contentBuffers.current.has(fid)) {
              // 用户有未保存改动 + 外部又改了盘 → 提示而非静默覆盖
              useCodeWorkbenchStore.getState().markDiskChanged(fid);
            } else {
              // 无未保存改动 → 静默原地重读，刷新出 AI/外部的最新内容
              void useCodeWorkbenchStore.getState().reloadTab(fid);
            }
          }
        });
      } catch {
        /* 监听注册失败不影响编辑器本身 */
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  // 当前激活文件的符号大纲（按行排序，点条目跳到对应行）
  const outlineSymbols = useMemo<ProjectSymbol[]>(() => {
    if (!activeFileId) return [];
    return symbols
      .filter((s) => s.fileId === activeFileId)
      .sort((a, b) => a.lineStart - b.lineStart || a.name.localeCompare(b.name));
  }, [symbols, activeFileId]);

  // 大纲层级树（按包含关系推导嵌套）+ 全部节点（用于展开/折叠/过滤）
  const outlineTree = useMemo(() => buildOutlineTree(outlineSymbols), [outlineSymbols]);
  const allOutlineNodes = useMemo(() => collectOutlineNodes(outlineTree), [outlineTree]);
  const outlineQueryLc = outlineQuery.trim().toLowerCase();
  const filteredOutlineTree = useMemo(
    () => (outlineQueryLc ? filterOutlineTree(outlineTree, outlineQueryLc) : outlineTree),
    [outlineTree, outlineQueryLc],
  );
  // 「按类型聚类」视图：把（已过滤的）符号按 kind 分组，组内按行号排序；分组顺序由 KIND_ORDER 稳定化。
  const kindGroups = useMemo(() => {
    const list: ProjectSymbol[] = [];
    const walk = (ns: OutlineNode[]) => {
      for (const n of ns) {
        list.push(n.sym);
        if (n.children.length) walk(n.children);
      }
    };
    walk(filteredOutlineTree);
    const map = new Map<string, ProjectSymbol[]>();
    const order: string[] = [];
    for (const s of list) {
      const k = s.kind || "unknown";
      if (!map.has(k)) {
        map.set(k, []);
        order.push(k);
      }
      map.get(k)!.push(s);
    }
    order.sort((a, b) => kindSortIndex(a) - kindSortIndex(b) || a.localeCompare(b));
    return order.map((k) => ({
      kind: k,
      items: map.get(k)!.slice().sort((x, y) => x.lineStart - y.lineStart),
    }));
  }, [filteredOutlineTree]);
  // 跟随光标：光标所在（最深）符号高亮，便于在长文件中随时定位当前位置
  const activeOutlineId = useMemo(() => {
    if (!cursorLine) return null;
    let best: OutlineNode | null = null;
    for (const n of allOutlineNodes) {
      const s = n.sym;
      if (s.lineStart <= cursorLine && cursorLine <= s.lineEnd) {
        if (!best || n.depth > best.depth) best = n;
      }
    }
    return best?.sym.id ?? null;
  }, [allOutlineNodes, cursorLine]);

  // 跟随光标：活动符号进入视口（仅平滑滚动，不抢焦点，避免打断编辑）
  useEffect(() => {
    if (!activeOutlineId || !outlineListRef.current) return;
    const el = outlineListRef.current.querySelector(
      `[data-outline-id="${CSS.escape(activeOutlineId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeOutlineId, filteredOutlineTree]);
  // 可定位符号名集合（小写去重），供编辑器按住 Ctrl/⌘ 悬停显示跳转下划线

  // 面包屑符号段：取光标所在（最内层）符号，点击可跳转该行（renderable AND useful）

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {/* 顶栏 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        {showBackButton && (
          <Tooltip title={t("workbench.backCanvas")}>
            <IconButton size="small" onClick={onRequestClose} aria-label={t("workbench.backCanvas")}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600, lineHeight: 1.2 }}>
            {t("workbench.title")}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
            {activeTab ? activeTab.relPath : t("workbench.subtitle")}
          </Typography>
        </Box>
        {activeFindingsCount > 0 && (
          <Chip
            size="small"
            color="warning"
            label={t("workbench.marks", { n: activeFindingsCount })}
            sx={{ height: 20, fontSize: 10 }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t("workbench.outlineToggle")}>
          <IconButton size="small" onClick={() => setOutlineOpen((v) => !v)} color={outlineOpen ? "primary" : "default"} aria-label={t("workbench.outlineToggle")}>
            <ListAltIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workbench.aiToggle")}>
          <IconButton size="small" onClick={() => setAiOpen((v) => !v)} color={aiOpen ? "primary" : "default"} aria-label={t("workbench.aiToggle")}>
            <SmartToyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workbench.terminalToggle")}>
          <IconButton size="small" onClick={() => setTerminalOpen((v) => !v)} color={terminalOpen ? "primary" : "default"} aria-label={t("workbench.terminalToggle")}>
            <TerminalIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workbench.problemsToggle")}>
          <IconButton size="small" onClick={() => useProblemsPanelStore.getState().toggle()} color={problemsOpen ? "primary" : "default"} aria-label={t("workbench.problemsToggle")}>
            <ReportProblemIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workbench.close")}>
          <IconButton size="small" onClick={onRequestClose} aria-label={t("workbench.close")}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* 主体：左栏(文件树+符号大纲) + 右编辑区 */}
      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* 左侧栏：文件树与上方可折叠的符号大纲堆叠 */}
        <Box
          sx={{
            width: 264,
            flexShrink: 0,
            borderRight: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <Box sx={{ px: 1, pt: 0.5, pb: 0.5 }}>
            <TextField
              size="small"
              fullWidth
              placeholder={t("workbench.filterPlaceholder")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setFilter("");
                if (e.key === "Enter") {
                  const firstFile = displayTree.find((n) => n.fileId);
                  if (firstFile?.fileId) {
                    openFileInTab(firstFile.fileId);
                  }
                }
              }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  sx: { fontSize: 12 },
                },
              }}
              sx={{ "& .MuiInputBase-root": { height: 30 } }}
            />
          </Box>
          {/* 文件树滚动区 */}
          <Box sx={{ flex: 1, overflow: "auto", minHeight: 0, py: 0.5 }}>
            {displayTree.length === 0 ? (
              <Typography variant="caption" color="text.disabled" sx={{ display: "block", px: 1.5, py: 1 }}>
                {filteredTree ? t("workbench.noMatch") : t("workbench.empty")}
              </Typography>
            ) : (
              displayTree.map((n) => (
                <FileTreeNode
                  key={n.path}
                  node={n}
                  depth={0}
                  expanded={displayExpanded}
                  onToggle={toggle}
                  onOpen={(fid) => openFileInTab(fid)}
                  activeFileId={activeFileId}
                  onDragFileStart={(fid) => setDraggingFile({ fileId: fid })}
                  onDragFileEnd={() => setDraggingFile(null)}
                  onContextMenu={handleTreeContextMenu}
                />
              ))
            )}
          </Box>
          <Menu
            anchorReference="anchorPosition"
            anchorPosition={treeMenu ? { top: treeMenu.y + 4, left: treeMenu.x + 4 } : undefined}
            anchorOrigin={{ vertical: "top", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "left" }}
            open={Boolean(treeMenu)}
            onClose={closeTreeMenu}
            slotProps={{ paper: { sx: treeMenuSx } }}
          >
            {treeMenu &&
              (() => {
                const node = treeMenu.node;
                const abs = absPathOf(node) ?? node.path;
                const rel = node.path;
                const reveal = () => {
                  const p = absPathOf(node);
                  if (p) {
                    void invoke("reveal_in_file_manager", { path: p }).catch(() => {});
                    useToastStore.getState().info(t("projectTree.revealToast", { name: node.name }));
                  }
                  closeTreeMenu();
                };
                type Item = { label: string; icon: React.ReactNode; onClick: () => void };
                const sections: { header: string; items: Item[] }[] = [];
                if (!node.isDir) {
                  sections.push({
                    header: t("projectTree.secActions"),
                    items: [
                      {
                        label: t("workbench.treeMenu.openInSplit"),
                        icon: <CodeIcon sx={{ fontSize: 16 }} />,
                        onClick: () => {
                          if (node.fileId) {
                            openFileInSplit(node.fileId, node.path, node.name, node.language ?? null, null, "right", null);
                          }
                          closeTreeMenu();
                        },
                      },
                    ],
                  });
                  sections.push({
                    header: t("projectTree.secAi"),
                    items: [
                      {
                        label: t("panel.menu.aiDiagnose"),
                        icon: <AutoFixHighIcon sx={{ fontSize: 16 }} />,
                        onClick: () => {
                          triggerDiagnosis({ filePath: node.path, kind: "file", title: t("projectTree.aiDiagnoseTitle", { name: node.name }) });
                          closeTreeMenu();
                        },
                      },
                    ],
                  });
                }
                const copyItems: Item[] = [
                  {
                    label: t("projectTree.copyDir"),
                    icon: <FolderIcon sx={{ fontSize: 16 }} />,
                    onClick: () => copyToClipboard(t("projectTree.copyDir"), node.isDir ? abs : dirOf(abs)),
                  },
                  ...(node.isDir
                    ? []
                    : [
                        {
                          label: t("projectTree.copyFile"),
                          icon: <InsertDriveFileIcon sx={{ fontSize: 16 }} />,
                          onClick: () => copyToClipboard(t("projectTree.copyFile"), abs),
                        },
                      ]),
                  {
                    label: t("projectTree.copyRel"),
                    icon: <TextSnippetIcon sx={{ fontSize: 16 }} />,
                    onClick: () => copyToClipboard(t("projectTree.copyRel"), node.isDir ? rel : dirOf(rel)),
                  },
                  {
                    label: t("projectTree.copyName"),
                    icon: <LabelIcon sx={{ fontSize: 16 }} />,
                    onClick: () => copyToClipboard(t("projectTree.copyName"), node.name),
                  },
                ];
                sections.push({ header: t("projectTree.copyHeader"), items: copyItems });
                sections.push({
                  header: t("projectTree.secSystem"),
                  items: [
                    {
                      label: t("workbench.tabMenu.revealInFileManager"),
                      icon: <FolderOpenIcon sx={{ fontSize: 16 }} />,
                      onClick: reveal,
                    },
                  ],
                });
                return (
                  <>
                    {sections.map((sec, i) => (
                      <Box key={sec.header + i}>
                        {i > 0 && <Divider sx={{ my: 0.5, mx: 1 }} />}
                        <Box sx={treeHeaderSx}>
                          <Typography variant="caption" sx={treeHeaderTextSx}>
                            {sec.header}
                          </Typography>
                        </Box>
                        {sec.items.map((it) => (
                          <MenuItem key={it.label} onClick={it.onClick} sx={treeItemSx}>
                            <ListItemIcon sx={{ minWidth: 28 }}>{it.icon}</ListItemIcon>
                            <ListItemText primary={it.label} sx={{ "& .MuiListItemText-primary": { fontSize: 13 } }} />
                          </MenuItem>
                        ))}
                      </Box>
                    ))}
                  </>
                );
              })()}
          </Menu>
          {/* 符号大纲（可折叠 · 层级树 + 过滤 + 跟随光标，对标 Zed outline 的嵌套/过滤/跳转能力） */}
          {outlineOpen && (
            <Box
              sx={{
                height: "52%",
                flexShrink: 0,
                borderTop: 1,
                borderColor: "divider",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              {/* 标题行 + 视图模式切换 + 全部展开/折叠 */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary", flex: 1 }}>
                  {t("workbench.outlineTitle")}
                </Typography>
                {/* 视图模式切换：层级树 ↔ 按类型聚类（对标结构化符号导航，大文件一键跳到某类符号） */}
                <Box
                  sx={{
                    display: "flex",
                    borderRadius: 1,
                    overflow: "hidden",
                    border: "1px solid",
                    borderColor: "divider",
                    flexShrink: 0,
                  }}
                  title={t("workbench.outlineToggleView")}
                >
                  {(["tree", "kind"] as const).map((m) => (
                    <Box
                      key={m}
                      onClick={() => setOutlineViewMode(m)}
                      sx={{
                        px: 0.6,
                        py: 0.2,
                        fontSize: 10,
                        cursor: "pointer",
                        userSelect: "none",
                        bgcolor: outlineViewMode === m ? "primary.main" : "transparent",
                        color: outlineViewMode === m ? "#fff" : "text.secondary",
                        "&:hover": { bgcolor: outlineViewMode === m ? "primary.main" : "action.hover" },
                      }}
                    >
                      {m === "tree" ? t("workbench.outlineViewTree") : t("workbench.outlineViewKind")}
                    </Box>
                  ))}
                </Box>
                <Typography variant="caption" color="text.disabled">
                  {allOutlineNodes.length}
                </Typography>
                <Tooltip title={t("workbench.outlineExpandAll")}>
                  <IconButton
                    size="small"
                    sx={{ p: 0.25 }}
                    onClick={() => {
                      setCollapsedOutline(new Set());
                      setCollapsedKind(new Set());
                    }}
                   aria-label={t("workbench.outlineExpandAll")}>
                    <span style={{ fontSize: 12, lineHeight: 1 }}>▾▾</span>
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("workbench.outlineCollapseAll")}>
                  <IconButton
                    size="small"
                    sx={{ p: 0.25 }}
                    onClick={() => {
                      setCollapsedOutline(
                        new Set(
                          allOutlineNodes.filter((n) => n.children.length > 0).map((n) => n.sym.id),
                        ),
                      );
                      setCollapsedKind(new Set(kindGroups.map((g) => g.kind)));
                    }}
                   aria-label={t("workbench.outlineCollapseAll")}>
                    <span style={{ fontSize: 12, lineHeight: 1 }}>▸▸</span>
                  </IconButton>
                </Tooltip>
              </Box>
              {/* 过滤输入框 */}
              <Box sx={{ px: 1, pb: 0.5 }}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder={t("workbench.outlineFilter")}
                  value={outlineQuery}
                  onChange={(e) => setOutlineQuery(e.target.value)}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      ),
                      sx: { fontSize: 12 },
                    },
                  }}
                  sx={{ "& .MuiInputBase-root": { height: 28 } }}
                />
              </Box>
              {/* 层级树 */}
              <Box ref={outlineListRef} sx={{ flex: 1, overflow: "auto", minHeight: 0, pb: 1 }}>
                {allOutlineNodes.length === 0 ? (
                  <Typography variant="caption" color="text.disabled" sx={{ display: "block", px: 1.5, py: 1 }}>
                    {t("workbench.noSymbols")}
                  </Typography>
                ) : filteredOutlineTree.length === 0 ? (
                  <Typography variant="caption" color="text.disabled" sx={{ display: "block", px: 1.5, py: 1 }}>
                    {t("workbench.noMatch")}
                  </Typography>
                ) : outlineViewMode === "tree" ? (
                  (() => {
                    const renderNode = (n: OutlineNode): JSX.Element => {
                      const hasChildren = n.children.length > 0;
                      const collapsed = collapsedOutline.has(n.sym.id);
                      const isActive = n.sym.id === activeOutlineId;
                      const indent = 6 + n.depth * 12;
                      return (
                        <Box key={n.sym.id}>
                          <Box
                            data-outline-id={n.sym.id}
                            onClick={() =>
                              useCodeWorkbenchStore
                                .getState()
                                .jumpTo(n.sym.lineStart, t("workbench.outlineJump", { name: n.sym.name }))
                            }
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 0.5,
                              pl: `${indent}px`,
                              pr: 1,
                              py: 0.4,
                              cursor: "pointer",
                              borderLeft: `2px solid ${isActive ? "primary.main" : "transparent"}`,
                              bgcolor: isActive ? "action.selected" : "transparent",
                              "&:hover": { bgcolor: "action.hover" },
                            }}
                          >
                            {hasChildren ? (
                              <Box
                                component="span"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCollapsedOutline((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(n.sym.id)) next.delete(n.sym.id);
                                    else next.add(n.sym.id);
                                    return next;
                                  });
                                }}
                                sx={{
                                  width: 14,
                                  flexShrink: 0,
                                  fontSize: 11,
                                  color: "text.secondary",
                                  cursor: "pointer",
                                }}
                              >
                                {collapsed ? "▸" : "▾"}
                              </Box>
                            ) : (
                              <Box component="span" sx={{ width: 14, flexShrink: 0 }} />
                            )}
                            <Typography
                              variant="caption"
                              sx={{
                                flexShrink: 0,
                                width: 34,
                                fontSize: 9,
                                color: symbolKindColor(n.sym.kind),
                                textTransform: "uppercase",
                                fontWeight: 600,
                              }}
                              noWrap
                            >
                              {symbolKindLabel(n.sym.kind)}
                            </Typography>
                            <Typography
                              variant="caption"
                              noWrap
                              sx={{ flex: 1, fontWeight: isActive ? 700 : 500 }}
                            >
                              {n.sym.name}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.disabled"
                              sx={{ flexShrink: 0, fontSize: 10 }}
                            >
                              {n.sym.lineStart}
                            </Typography>
                          </Box>
                          {hasChildren && (!collapsed || outlineQueryLc) && n.children.map((c) => renderNode(c))}
                        </Box>
                      );
                    };
                    return filteredOutlineTree.map((n) => renderNode(n));
                  })()
                ) : (
                  kindGroups.map((g) => {
                    const isCollapsed = collapsedKind.has(g.kind);
                    return (
                      <Fragment key={g.kind}>
                        <Box
                          onClick={() =>
                            setCollapsedKind((prev) => {
                              const next = new Set(prev);
                              if (next.has(g.kind)) next.delete(g.kind);
                              else next.add(g.kind);
                              return next;
                            })
                          }
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                            pl: 1,
                            pr: 1,
                            py: 0.4,
                            cursor: "pointer",
                            userSelect: "none",
                            bgcolor: "action.selected",
                            "&:hover": { bgcolor: "action.hover" },
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{
                              fontSize: 11,
                              fontWeight: 700,
                              flexShrink: 0,
                              color: symbolKindColor(g.kind),
                              textTransform: "uppercase",
                            }}
                          >
                            {symbolKindLabel(g.kind)}
                          </Typography>
                          <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>
                            {g.items.length}
                          </Typography>
                          <Box component="span" sx={{ fontSize: 11, color: "text.secondary", ml: "auto" }}>
                            {isCollapsed ? "▸" : "▾"}
                          </Box>
                        </Box>
                        {!isCollapsed &&
                          g.items.map((s) => {
                            const isActive = s.id === activeOutlineId;
                            return (
                              <Box
                                key={s.id}
                                data-outline-id={s.id}
                                onClick={() =>
                                  useCodeWorkbenchStore
                                    .getState()
                                    .jumpTo(s.lineStart, t("workbench.outlineJump", { name: s.name }))
                                }
                                sx={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 0.5,
                                  pl: "6px",
                                  pr: 1,
                                  py: 0.4,
                                  cursor: "pointer",
                                  borderLeft: `2px solid ${isActive ? "primary.main" : "transparent"}`,
                                  bgcolor: isActive ? "action.selected" : "transparent",
                                  "&:hover": { bgcolor: "action.hover" },
                                }}
                              >
                                <Typography
                                  variant="caption"
                                  sx={{
                                    flexShrink: 0,
                                    width: 34,
                                    fontSize: 9,
                                    color: symbolKindColor(s.kind),
                                    textTransform: "uppercase",
                                    fontWeight: 600,
                                  }}
                                  noWrap
                                >
                                  {symbolKindLabel(s.kind)}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  noWrap
                                  sx={{ flex: 1, fontWeight: isActive ? 700 : 500 }}
                                >
                                  {s.name}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  color="text.disabled"
                                  sx={{ flexShrink: 0, fontSize: 10 }}
                                >
                                  {s.lineStart}
                                </Typography>
                              </Box>
                            );
                          })}
                      </Fragment>
                    );
                  })
                )}
              </Box>
            </Box>
          )}
        </Box>

        {/* 多窗格编辑区（对标 Zed PaneGroup）：递归窗格树，各 axis 按自身 orientation 排布窗格 */}
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
          <Box
            ref={paneContainerRef}
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              userSelect: dragDivider !== null ? "none" : undefined,
            }}
          >
            {renderPaneNode(paneTree, null, 1)}
          </Box>
          {inlineOpen && (
              <InlineChat
                open={inlineOpen}
                onClose={() => setInlineOpen(false)}
                activeFile={
                  activeTab
                    ? {
                        fileId: activeTab.fileId,
                        relPath: activeTab.relPath,
                        language: activeTab.language,
                        name: activeTab.name,
                        totalLines: activeTab.content?.totalLines,
                      }
                    : null
                }
                selection={selection}
                editorRef={editorHandleRef}
                onOpenPanel={() => {
                  setInlineOpen(false);
                  setAiOpen(true);
                  setRightTab(0);
                }}
              />
            )}
        </Box>

        {/* 右侧 dock：tab 分栏（AI 助手 | 需求分析），两个 tab 共享同一宽度与拖拽手柄。
           需求分析是独立业务功能，不再混进 AI 面板的模式下拉——AI 入口只管「怎么跟 AI 对话」。 */}
        {aiOpen && (
          <Box
            sx={{
              width: dockWidth,
              flexShrink: 0,
              borderLeft: 1,
              borderColor: "divider",
              bgcolor: "background.paper",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              position: "relative",
            }}
          >
            {/* 拖拽手柄（共享宽度，整块 dock 可拖） */}
            <Box
              onMouseDown={startDockDrag}
              sx={{ position: "absolute", left: -3, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 5, "&:hover": { bgcolor: "primary.main", opacity: 0.3 } }}
            />
            {/* tab 栏 */}
            <Box sx={{ display: "flex", alignItems: "center", borderBottom: 1, borderColor: "divider", pl: 0.5, pr: 0.25 }}>
              <Tabs value={rightTab} onChange={(_e, v) => setRightTab(v)} sx={{ minHeight: 34, flex: 1 }}>
                <Tab label={t("workbench.tab.ai")} sx={{ minHeight: 34, py: 0.5, fontSize: 12, textTransform: "none" }} />
                <Tab label={t("workbench.tab.requirements")} sx={{ minHeight: 34, py: 0.5, fontSize: 12, textTransform: "none" }} />
              </Tabs>
              <IconButton size="small" onClick={() => setAiOpen(false)} sx={{ flexShrink: 0 }} aria-label={t("workbench.close")}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
            {/* tab 内容 */}
            <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {rightTab === 0 && (
                <WorkbenchAiPanel
                  activeFile={
                    activeTab
                      ? {
                          fileId: activeTab.fileId,
                          relPath: activeTab.relPath,
                          language: activeTab.language,
                          name: activeTab.name,
                          totalLines: activeTab.content?.totalLines,
                        }
                      : null
                  }
                  selection={selection}
                  editorRef={editorHandleRef}
                  onClose={() => setAiOpen(false)}
                  onOpenPath={handleOpenPath}
                  initialPrompt={pendingAiPrompt}
                  onConsumeInitialPrompt={() => setPendingAiPrompt(null)}
                  isBookScene={false}
                />
              )}
              {rightTab === 1 && (
                <RequirementsPanel
                  onAssist={(prompt) => {
                    setPendingAiPrompt(prompt);
                    setRightTab(0);
                  }}
                />
              )}
            </Box>
          </Box>
        )}
      </Box>
      {/* 集成终端（IDE 标准可交互 shell；默认收起，顶部终端按钮 / Ctrl+` 开合） */}
      {terminalOpen && (
        <Box
          sx={{
            height: 240,
            flexShrink: 0,
            borderTop: 1,
            borderColor: "divider",
            minHeight: 0,
          }}
        >
          <WorkbenchTerminalTabs onClose={() => setTerminalOpen(false)} />
        </Box>
      )}
      <QuickOpen
        open={quickOpenOpen}
        onClose={() => setQuickOpenOpen(false)}
        files={files}
        onPick={(fid, line, col) => openFileInTab(fid, line, col)}
        onPickSplit={(fid, line, col, dir) => {
          const f = files.find((x) => x.id === fid);
          if (f) openFileInSplit(f.id, f.relPath, f.name, f.language, line ?? null, dir ?? "right", col ?? null);
        }}
      />
      <GoToSymbol
        open={symbolOpen}
        onClose={() => setSymbolOpen(false)}
        symbols={symbols}
        onPickSplit={openFileInSplit}
        files={files}
        onPick={(fileId, relPath, name, language, line) =>
          openTab(fileId, relPath, name, language, line, t("workbench.symbolJump", { name }))
        }
      />
      <CommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        commands={workbenchCommands}
        title={t("workbench.commandPalette")}
        placeholder={t("workbench.commandPalettePlaceholder")}
        emptyText={t("workbench.commandPaletteEmpty")}
      />
      <GotoLineDialog
        open={gotoOpen}
        onClose={() => setGotoOpen(false)}
        editorHandleRef={editorHandleRef}
      />
      {/* 查看书签清单（对标 Zed ViewBookmarks：全部书签聚合为可跳转清单；点击即跳、Delete 即删） */}
      <BookmarkPicker
        open={bookmarkPickerOpen}
        onClose={() => setBookmarkPickerOpen(false)}
        onPick={(fileId, line) => openFileInTab(fileId, line)}
      />
      <WorkbenchSearchPanel
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onJump={handleSearchJump}
      />
      {problemsOpen && (
        <WorkbenchProblemsPanel onClose={() => setProblemsOpen(false)} onJump={handleOpenPath} />
      )}

      {/* 重命名符号对话框（对标 Zed editor::Rename 的内联确认：预填旧名 → 确认跨文件改写） */}
      <Dialog
        open={renameOpen}
        onClose={() => !renameBusy && setRenameOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <Box sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t("workbench.rename.title")}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
            <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 700 }}>{renameOld}</Box>
            {" → "}
            {renameIndexed
              ? t("workbench.rename.summary", {
                  count: renameTargets.length,
                  files: new Set(renameTargets.map((x) => x.fileId)).size,
                })
              : t("workbench.rename.currentFileOnly", { count: renameTargets.length })}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={renameNew}
            placeholder={t("workbench.rename.placeholder")}
            onChange={(e) => setRenameNew(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmRename();
              else if (e.key === "Escape") setRenameOpen(false);
            }}
            sx={{ mb: 1 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
            {t("workbench.rename.note")}
          </Typography>
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
            <Button size="small" disabled={renameBusy} onClick={() => setRenameOpen(false)}>
              {t("workbench.rename.cancel")}
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={renameBusy || !renameNew.trim() || renameNew.trim() === renameOld}
              onClick={confirmRename}
              startIcon={renameBusy ? <CircularProgress size={14} color="inherit" /> : null}
            >
              {renameBusy ? t("workbench.rename.busy") : t("workbench.rename.confirm")}
            </Button>
          </Box>
        </Box>
      </Dialog>
      <DefinitionPicker
        open={defPickerOpen}
        onClose={() => setDefPickerOpen(false)}
        word={defPickerWord}
        candidates={defPickerCandidates}
        files={files}
        onPick={(fileId, relPath, name, language, line) => {
          openWorkbenchTab(fileId, line, t("workbench.jumpToSymbol", { name }));
          setDefPickerOpen(false);
        }}
        onPickSplit={openFileInSplit}
      />
    </Box>
  );
}

export function CodeWorkbench() {
  const open = useCodeWorkbenchStore((s) => s.open);
  const close = useCodeWorkbenchStore((s) => s.close);
  return (
    <Dialog
      open={open}
      onClose={close}
      fullScreen
      slotProps={{ paper: { sx: { bgcolor: "background.default" } } }}
    >
      <CodeWorkbenchBody onRequestClose={close} showBackButton />
    </Dialog>
  );
}

