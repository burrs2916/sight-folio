import { memo, useMemo, useState, useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import RuleIcon from "@mui/icons-material/Rule";
import DataObjectIcon from "@mui/icons-material/DataObject";
import BuildIcon from "@mui/icons-material/Build";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ImageIcon from "@mui/icons-material/Image";
import { ClassGlyph, InterfaceGlyph, FunctionGlyph, ModuleGlyph } from "../renderers/glyphs";
import { useProjectStore } from "../../store/projectStore";
import { useEditorStore } from "../../store/editorStore";
import { useToastStore } from "../../store/toastStore";
import { triggerDiagnosis } from "../../ai/triggerDiagnosis";
import { AI_COLOR } from "../../ai/aiBrand";
import { languageColor } from "../../utils/languageMeta";
import { isImageFile, isAssetFile, assetFormatLabel } from "../utils/fileKind";
import { buildFileTree, type TreeNode } from "../utils/fileTree";
import { buildImagePreviewData, getCachedProjectRoot, imageAbsPath, imageFormatLabel, formatImageSize, useAssetImage, useProjectRoot } from "../utils/imageAsset";
import { findComponentForFile } from "../utils/canvasLink";
import { navigateToSource } from "../utils/sourceNavigate";
import type { ProjectFile, ProjectSymbol } from "../../services/tauri";
import { t } from "../../i18n";

/** 文件行统计（含此前未被文件树使用的复杂度与重复代码） */
interface FileRowStats {
  findings: number;
  symbols: number;
  techDebt: number;
  complexity: number;
  complexityLevel: string | null;
  clones: number;
  /**
   * 度量引擎：ast = tree-sitter 精确解析，heuristic = 行级关键字估算。
   * 必须让用户看得见 —— 把估算值当成事实是分析工具最容易犯的错。
   */
  engine: string;
  /** 文件内最复杂的函数（AST 独有）：比「这个文件很复杂」有用得多 */
  hotFunction: string;
  maxFunctionCc: number;
  maxNesting: number;
  functionCount: number;
}

/** 复杂度等级 → 颜色（与画布热力配色一致） */
const COMPLEXITY_COLOR: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  extreme: "#ef4444",
};

/**
 * 复杂度色点的悬浮说明。
 *
 * heuristic：只有一个文件级估算值，如实标注「行级估算」；
 * ast：能指到具体函数，直接说「最复杂 xxx()，CC n，嵌套 m 层」——
 *      这句话才是用户真正能拿去改代码的信息。
 */
function complexityTitle(st: FileRowStats): string {
  const level = st.complexityLevel ? t(`filesPanel.complexity.${st.complexityLevel}`) : (st.complexityLevel ?? "");
  if (st.engine !== "ast") {
    return t("filesPanel.ccEstimated", { cc: st.complexity, level });
  }
  const hot = st.hotFunction ? t("filesPanel.ccHotFunction", { fn: st.hotFunction, cc: st.maxFunctionCc }) : "";
  return t("filesPanel.ccAst", { cc: st.complexity, level, count: st.functionCount, nesting: st.maxNesting, hot });
}

/**
 * 项目文件树
 * 显示扫描得到的 project_files 列表，按目录结构组织。
 * 联动能力：
 * - 点击文件 → 画布定位对应实体并选中（右侧画像随之联动）
 * - 文件行显示审查违规徽标 / 符号计数 / 语言色点
 */
export const ScannedFilesPanel = memo(function ScannedFilesPanel() {
  const files = useProjectStore((s) => s.files);
  const findings = useProjectStore((s) => s.findings);
  const symbols = useProjectStore((s) => s.symbols);
  const techDebt = useProjectStore((s) => s.techDebt);
  const metrics = useProjectStore((s) => s.metrics);
  const clones = useProjectStore((s) => s.clones);
  const focusLanguage = useProjectStore((s) => s.focusLanguage);
  const setFocusLanguage = useProjectStore((s) => s.setFocusLanguage);
  const activeAnalysisId = useProjectStore((s) => s.activeAnalysisId);
  const showToast = useToastStore((s) => s.showToast);

  // 违规 / 符号 / 复杂度 / 重复 统计索引
  //
  // metrics、clones 这两份数据一直躺在 store 里没被文件树用上；
  // 文件树是用户最常停留的面板，把复杂度和重复率放在这里比藏在画布徽标里更有用。
  const fileStats = useMemo(() => {
    const map = new Map<string, FileRowStats>();
    files.forEach((f) =>
      map.set(f.id, {
        findings: 0,
        symbols: 0,
        techDebt: 0,
        complexity: 0,
        complexityLevel: null,
        clones: 0,
        engine: "",
        hotFunction: "",
        maxFunctionCc: 0,
        maxNesting: 0,
        functionCount: 0,
      })
    );
    findings.forEach((fd) => {
      const e = map.get(fd.targetId);
      if (e) e.findings += 1;
    });
    symbols.forEach((s) => {
      const e = map.get(s.fileId);
      if (e) e.symbols += 1;
    });
    techDebt.forEach((d) => {
      const e = map.get(d.fileId);
      if (e) e.techDebt += 1;
    });
    metrics.forEach((m) => {
      const e = map.get(m.fileId);
      if (e) {
        e.complexity = m.cyclomaticComplexity;
        e.complexityLevel = m.complexityLevel;
        e.engine = m.engine;
        e.hotFunction = m.hotFunction;
        e.maxFunctionCc = m.maxFunctionCc;
        e.maxNesting = m.maxNesting;
        e.functionCount = m.functionCount;
      }
    });
    clones.forEach((c) => {
      const e = map.get(c.fileId);
      if (e) e.clones += 1;
    });
    return map;
  }, [files, findings, symbols, techDebt, metrics, clones]);

  // 目录树展开用：每个文件内部的符号（按类型区分展示；字段/参数过多则跳过）
  const symbolsByFile = useMemo(() => {
    const SHOWN = new Set(["class", "interface", "function", "method", "struct", "trait", "enum", "constant"]);
    const map = new Map<string, ProjectSymbol[]>();
    for (const s of symbols) {
      if (!SHOWN.has(s.kind)) continue;
      const arr = map.get(s.fileId);
      if (arr) arr.push(s);
      else map.set(s.fileId, [s]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.lineStart - b.lineStart);
    return map;
  }, [symbols]);

  // ─── 语言焦点过滤（插件联动：切换插件后只显示该语言文件）───
  //
  // 目录不能无条件保留 —— 那样过滤完会剩下一堆点开全是空的目录。
  // 正确做法是先筛出匹配的文件，再把它们的祖先目录逐级加回来。
  const visibleFiles = useMemo(() => {
    if (!focusLanguage) return files;
    const byId = new Map(files.map((f) => [f.id, f]));
    const keep = new Set<string>();

    for (const f of files) {
      if (f.isDirectory) continue;
      const l = (f.language || "unknown").toLowerCase();
      const hit =
        l === focusLanguage ||
        (focusLanguage === "typescript" && (l === "javascript" || l === "typescript"));
      if (!hit) continue;
      keep.add(f.id);
      // 逐级把祖先目录加回来（带深度上限，防父子关系成环时死循环）
      let pid = f.parentId;
      let guard = 0;
      while (pid && !keep.has(pid) && guard < 64) {
        keep.add(pid);
        pid = byId.get(pid)?.parentId ?? null;
        guard += 1;
      }
    }
    return files.filter((f) => keep.has(f.id));
  }, [files, focusLanguage]);

  // 构建目录树（基于过滤后的文件，保证空目录不显示）
  const tree = useMemo(() => buildFileTree(visibleFiles), [visibleFiles]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─── 点击文件：打开源码（主）+ 画布定位（附带）───
  //
  // 以前这里只做画布定位，画布没同步就只弹一句 warning，
  // 表现为"点了没反应"。现在无论画布状态如何都能看到代码本身。
  const handleFileClick = (file: ProjectFile) => {
    const r = navigateToSource(file.id, null, t("filesPanel.browseToast", { path: file.relPath }));
    if (!r.opened) showToast(r.message, "warning");
  };

  // 画布上是否已有对应实体：只影响提示文案，不再决定点击能否生效
  const hasCanvasFile = useMemo(
    () => files.some((f) => !f.isDirectory && findComponentForFile(f)),
    [files]
  );

  // ─── 反向联动：画布点选实体 → 左侧文件树自动展开祖先目录 + 平滑滚入视野 ───
  //
  // 左→右（点文件→画布定位）早已打通；右→左缺的就是「选中态变化时让对应行可见」。
  // 难点：文件树可折叠，父目录收起时目标行根本不在 DOM 里，既不显示高亮也滚不动。
  // 故选中变化时要先把祖先目录展开，再等重渲染后用 scrollIntoView 平滑滚入。
  // 反向联动选中的「节点路径」：文件/图片/符号实体取 config.filePath，
  // 文件夹实体取 config.dirPath —— 二者都对应文件树节点的 relPath。
  const selectedNodePath = useEditorStore((s) => {
    const sel = s.selection.selectedIds;
    if (sel.length === 0) return null;
    const comp = s.components.find((c) => c.id === sel[0]);
    if (!comp) return null;
    const fp = (comp.config as any)?.filePath;
    if (typeof fp === "string") return fp;
    const dp = (comp.config as any)?.dirPath;
    return typeof dp === "string" ? dp : null;
  });

  const listRef = useRef<HTMLDivElement>(null);
  const pendingScrollId = useRef<string | null>(null);
  const prevSelId = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedNodePath) {
      pendingScrollId.current = null;
      prevSelId.current = null;
      return;
    }
    // 展开祖先目录：让目标节点（文件或目录）渲染进 DOM（否则高亮/滚动都不可见）。
    // 文件实体按 filePath 命中，文件夹实体按 dirPath 命中 —— 二者都是文件树节点的 relPath。
    const target = files.find((f) => f.relPath === selectedNodePath);
    if (target) {
      const anc = new Set(expanded);
      let pid = target.parentId;
      let guard = 0;
      while (pid && guard < 64) {
        anc.add(pid);
        pid = files.find((x) => x.id === pid)?.parentId ?? null;
        guard += 1;
      }
      if (anc.size !== expanded.size) setExpanded(anc);
    }
    // 仅当选中实体真正变化时，才标记待滚动（避免用户手动折叠被抢滚动）
    if (selectedNodePath !== prevSelId.current) {
      pendingScrollId.current = target?.id ?? null;
      prevSelId.current = selectedNodePath;
    }
  }, [selectedNodePath, files, expanded]);

  useEffect(() => {
    const id = pendingScrollId.current;
    if (!id) return;
    // 等展开/选中重渲染完成后再滚动，确保目标行已在 DOM
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-file-id="${id}"]`);
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        pendingScrollId.current = null;
      }
    });
  }, [selectedNodePath, expanded]);

  if (files.length === 0) {    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          p: 3,
          gap: 1,
          color: "text.secondary",
          textAlign: "center",
        }}
      >
        <FolderIcon sx={{ fontSize: 40, opacity: 0.3 }} />
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {t("filesPanel.emptyTitle")}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.7, lineHeight: 1.5 }}>
          {t("filesPanel.emptyHint")}
        </Typography>
        {!activeAnalysisId && (
          <Typography variant="caption" sx={{ opacity: 0.7, mt: 1 }}>
            {t("filesPanel.noScopeHint")}
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        height: "100%",
        overflowY: "auto",
        fontSize: 12,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 0.5,
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
          {t("filesPanel.totalFiles", { n: files.filter((f) => !f.isDirectory).length })}
          {focusLanguage && t("filesPanel.focusLang", { lang: focusLanguage })}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {focusLanguage && (
          <Chip
            size="small"
            icon={<FilterAltIcon sx={{ fontSize: 11 }} />}
            label={t("filesPanel.onlyLang", { lang: focusLanguage })}
            onDelete={() => setFocusLanguage(null)}
            sx={{
              height: 18,
              fontSize: 9,
              bgcolor: `${languageColor(focusLanguage)}18`,
              color: languageColor(focusLanguage),
              "& .MuiChip-deleteIcon": { fontSize: 12, color: "inherit" },
            }}
          />
        )}
        <Button
          size="small"
          variant="text"
          onClick={() => setExpanded(new Set(tree.map((n) => n.id)))}
          sx={{ fontSize: 10, minWidth: 0, px: 1 }}
        >
          {t("filesPanel.expand")}
        </Button>
        <Button
          size="small"
          variant="text"
          onClick={() => setExpanded(new Set())}
          sx={{ fontSize: 10, minWidth: 0, px: 1 }}
        >
          {t("filesPanel.collapse")}
        </Button>
      </Box>

      {files.length > 0 && (
        <Box
          sx={{
            px: 1.5,
            py: 0.35,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "action.hover",
            flexShrink: 0,
          }}
        >
          <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary" }}>
            {t("filesPanel.viewSourceTip")}
            {hasCanvasFile && t("filesPanel.canvasSync")}
            {focusLanguage && t("filesPanel.langFocusing")}
          </Typography>
        </Box>
      )}

      <Box ref={listRef} sx={{ flex: 1, overflowY: "auto" }}>
        {tree.map((node) => (
          <FileTreeNode
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            stats={fileStats}
            onFileClick={handleFileClick}
            symbolsByFile={symbolsByFile}
            selectedRelPath={selectedNodePath}
            scrollRef={listRef}
          />
        ))}
      </Box>
    </Box>
  );
});

// 树构建已抽到共享工具（utils/fileTree.ts），文件 tab 与实体 tab 的 ProjectTree 共用同一棵目录树语义。
/** 符号类型 → 形状语言专属色（与画布实体形状语言一致） */
const SYMBOL_KIND_COLOR: Record<string, string> = {
  class: "#8B5CF6",
  interface: "#EC4899",
  function: "#10B981",
  method: "#10B981",
  struct: "#94A3B8",
  trait: "#8B5CF6",
  enum: "#FB923C",
  constant: "#64748B",
};

/** 符号类型 glyph（复用画布矢量图标，远看即可按形状认类型） */
function SymbolKindGlyph({ kind, color }: { kind: string; color: string }) {
  const size = 13;
  if (kind === "class" || kind === "trait") return <ClassGlyph color={color} size={size} />;
  if (kind === "interface") return <InterfaceGlyph color={color} size={size} />;
  if (kind === "function" || kind === "method") return <FunctionGlyph color={color} size={size} />;
  if (kind === "struct") return <ModuleGlyph color={color} size={size} />;
  return <DataObjectIcon sx={{ fontSize: size, color }} />;
}

/**
 * 目录树里的图片文件缩略图（16×16）。
 * 以前图片文件在目录树里只显示成 languageColor 的色点 —— 用户说的「目录树上有些元素
 * 没有被准确的画像」正是这个。现在直接取磁盘真实图片渲染成小缩略图，和画布 ImageRenderer
 * 同一套取图逻辑（imageAbsPath + useAssetImage：invoke 读文件 → blob，任意路径可用），
 * 加载失败回退格式感知方块 / ImageIcon。
 */
function ImageFileThumb({ relPath, name, rootRef }: { relPath: string; name: string; rootRef?: React.RefObject<HTMLDivElement | null> }) {
  const root = useProjectRoot();
  const [errored, setErrored] = useState(false);
  const [inView, setInView] = useState(false);
  const elRef = useRef<HTMLDivElement>(null);

  // 懒加载闸门：只有进入（或接近）文件树滚动视口时，才真正 invoke read_file_bytes 读图。
  // 展开一个含上百张图的目录时，不拦截会同时打上百次 IPC → 与画布 ImageRenderer 的
  // LOD 闸门是同一个病。observer root 取文件树自身的滚动容器（listRef），保证内层滚动
  // 正确判定可见性；rootMargin 预载 120px，滚动到点前先备好，避免露白。
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
            break;
          }
        }
      },
      { root: rootRef?.current ?? null, rootMargin: "120px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootRef]);

  const abs = useMemo(() => imageAbsPath({ filePath: relPath }, root), [relPath, root]);
  // 不在视口内 → 传 null，useAssetImage 直接跳过加载（与 ImageRenderer 同款 null 闸门）。
  const { url, errored: loadErrored } = useAssetImage(inView ? abs : null);

  const fallback = (() => {
    // 无法原生渲染（HEIC/TIFF/AVIF 等）：用格式感知方块替代误导性通用图标，
    // 让目录树的图片节点图标本身也是「准确画像」（与画布 ImageRenderer 同源）。
    const fmt = imageFormatLabel(name);
    if (fmt) {
      return (
        <div
          title={name}
          style={{
            width: 16,
            height: 16,
            borderRadius: 3,
            background: languageColor("image"),
            color: "#fff",
            fontSize: 7,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            lineHeight: 1,
          }}
        >
          {fmt.slice(0, 2)}
        </div>
      );
    }
    return <ImageIcon sx={{ fontSize: 14, color: "text.secondary", flexShrink: 0 }} />;
  })();

  return (
    <div ref={elRef} style={{ display: "flex", flexShrink: 0 }}>
      {!url || errored || loadErrored ? (
        fallback
      ) : (
        <img
          src={url}
          alt={name}
          onError={() => setErrored(true)}
          style={{
            width: 16,
            height: 16,
            borderRadius: 3,
            objectFit: "cover",
            flexShrink: 0,
            display: "block",
            background: "rgba(255,255,255,0.08)",
          }}
        />
      )}
    </div>
  );
}

const FileTreeNode = memo(function FileTreeNode({
  node,
  depth,
  expanded,
  onToggle,
  stats,
  onFileClick,
  symbolsByFile,
  selectedRelPath,
  scrollRef,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  stats: Map<string, FileRowStats>;
  onFileClick: (file: ProjectFile) => void;
  symbolsByFile: Map<string, ProjectSymbol[]>;
  /** 当前画布选中实体的 filePath（面板层统一算好下传，避免每节点各自跑 components.find） */
  selectedRelPath: string | null;
  /** 文件树滚动容器 ref：传给 ImageFileThumb 做懒加载可见性判定 */
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isOpen = expanded.has(node.id);
  const fileSymbols = node.isDirectory ? [] : symbolsByFile.get(node.id) ?? [];
  // 选中态由面板层统一算好（selectedRelPath）以 prop 传入：避免每个文件节点各自跑
  // `s.components.find` 选择器 —— 树节点上千时，每次画布选中都触发 N×M 级重算，正是卡顿源。
  const isSelected = node.relPath === selectedRelPath;

  const handleClick = () => {
    if (node.isDirectory) {
      onToggle(node.id);
      return;
    }
    // 图片文件：单点即「准确画像」——选中画布实体（右侧画像面板随即展示图片画像卡），
    // 无画布实体时（未同步到画布）直接弹图片详情框。不再走 navigateToSource 去开代码编辑器
    // （图片没有源码，开编辑器只会看到二进制乱码，正是用户说的「目录树图片没被准确画像」）。
    if (isImageFile(node.relPath || node.name)) {
      const root = getCachedProjectRoot();
      const data = buildImagePreviewData({ filePath: node.relPath, fileName: node.name }, root);
      const comp = useEditorStore.getState().components.find((c) => c.config?.filePath === node.relPath);
      if (comp) {
        useEditorStore.getState().focusComponent(comp.id); // 选中 → 画像面板联动
      } else {
        useEditorStore.getState().openImagePreview(data); // 画布未同步时直接弹详情框
      }
      return;
    }
    // 资源文件（字体/媒体/压缩/二进制）：无源码，单点选中画布实体联动画像；
    // 画布未同步时无预览可弹，保持树节点选中即可（不再走 navigateToSource 开代码编辑器）。
    if (isAssetFile(node.relPath || node.name)) {
      const comp = useEditorStore.getState().components.find((c) => c.config?.filePath === node.relPath);
      if (comp) useEditorStore.getState().focusComponent(comp.id);
      return;
    }
    // 通过 relPath 找到 ProjectFile 并联动画布
    const f = useProjectStore
      .getState()
      .files.find((x) => x.id === node.id || x.relPath === node.relPath);
    if (f) onFileClick(f);
  };

  // 双击图片文件 → 打开图片详情弹窗（与画布双击图片同款体验）
  const handleDoubleClick = () => {
    if (node.isDirectory) return;
    if (!isImageFile(node.relPath || node.name)) return;
    const root = getCachedProjectRoot();
    const data = buildImagePreviewData({ filePath: node.relPath, fileName: node.name }, root);
    useEditorStore.getState().openImagePreview(data);
  };

  const st = stats.get(node.id);

  // 图片节点画像：格式 + 体积（此前目录树里的图片只显示缩略图 + 文件名，无任何画像信息，
  // 正是用户说的「目录树上有些元素没有被准确的画像」——现在补齐格式/大小，与画布画像口径一致）。
  const isImgNode = !node.isDirectory && isImageFile(node.relPath || node.name);
  const imgFmt = isImgNode ? imageFormatLabel(node.name) : "";
  const imgSizeText = isImgNode ? formatImageSize(node.size) : "";
  // 资源节点画像：格式 + 体积（字体/媒体/压缩/二进制，与画布 AssetRenderer 同源）
  const isAssetNode = !node.isDirectory && isAssetFile(node.relPath || node.name);
  const assetFmt = isAssetNode ? assetFormatLabel(node.name) : "";
  const assetSizeText = isAssetNode ? formatImageSize(node.size) : "";

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 0.5,
          py: 0.3,
          pl: 0.5 + depth * 1.5,
          cursor: "pointer",
          borderRadius: 0.5,
          backgroundColor: isSelected ? "action.selected" : "transparent",
          outline: isSelected ? "1px solid" : "none",
          outlineColor: isSelected ? "primary.main" : "transparent",
          "&:hover": { backgroundColor: "action.hover" },
          // hover 行时显出文件级 AI 诊断按钮（.ai-diag-btn 默认 opacity:0）
          "&:hover .ai-diag-btn": { opacity: 1 },
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        data-file-id={node.id}
        title={
          node.isDirectory
            ? node.relPath
            : isImgNode
              ? [node.relPath, `${t("imagePreview.format")} ${imgFmt}`, imgSizeText !== "—" ? `${t("imagePreview.size")} ${imgSizeText}` : ""]
                  .filter(Boolean)
                  .join("\n")
              : isAssetNode
                ? [node.relPath, `${t("imagePreview.format")} ${assetFmt}`, assetSizeText !== "—" ? `${t("imagePreview.size")} ${assetSizeText}` : ""]
                    .filter(Boolean)
                    .join("\n")
                : t("filesPanel.nodeTip", {
                    path: node.relPath,
                    cc: st?.complexity ? t("filesPanel.nodeTipCc", { cc: st.complexity }) : "",
                  })
        }
      >
        {!node.isDirectory && fileSymbols.length > 0 && (
          <ChevronRightIcon
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            sx={{
              fontSize: 15,
              color: "text.secondary",
              flexShrink: 0,
              cursor: "pointer",
              transform: isOpen ? "rotate(90deg)" : "none",
              transition: "transform 0.12s",
            }}
          />
        )}
        {node.isDirectory ? (
          isOpen ? (
            <FolderOpenIcon sx={{ fontSize: 14, color: "primary.main", flexShrink: 0 }} />
          ) : (
            <FolderIcon sx={{ fontSize: 14, color: "primary.main", flexShrink: 0 }} />
          )
        ) : isImageFile(node.relPath || node.name) ? (
          <ImageFileThumb relPath={node.relPath} name={node.name} rootRef={scrollRef} />
        ) : isAssetNode ? (
          // 资源节点：格式小方块（暖橙底 + 格式缩写），让「这是什么资源」一眼可辨
          <Box
            sx={{
              width: 14,
              height: 14,
              borderRadius: 0.5,
              bgcolor: languageColor("asset"),
              color: "#fff",
              fontSize: 6.5,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              ml: 0.25,
              letterSpacing: "-0.2px",
              lineHeight: 1,
            }}
          >
            {assetFmt.slice(0, 3)}
          </Box>
        ) : node.language ? (
          <Box
            sx={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              bgcolor: languageColor(node.language),
              flexShrink: 0,
              ml: 0.25,
            }}
          />
        ) : (
          <InsertDriveFileIcon sx={{ fontSize: 13, color: "text.disabled", flexShrink: 0 }} />
        )}
        <Typography
          variant="caption"
          sx={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: node.isDirectory ? 500 : 400,
          }}
        >
          {node.name}
        </Typography>

        {/* 图片节点画像：格式 + 体积（与画布 ImageRenderer 信息条同源，避免「只显示缩略图、无画像」）*/}
        {isImgNode && (
          <Typography
            variant="caption"
            sx={{ fontSize: 8.5, lineHeight: 1, color: "info.main", flexShrink: 0, fontWeight: 600 }}
          >
            {imgFmt}
            {imgSizeText !== "—" ? ` · ${imgSizeText}` : ""}
          </Typography>
        )}

        {/* 资源节点画像：格式 + 体积（与画布 AssetRenderer 信息条同源） */}
        {isAssetNode && (
          <Typography
            variant="caption"
            sx={{ fontSize: 8.5, lineHeight: 1, color: "#ea580c", flexShrink: 0, fontWeight: 600 }}
          >
            {assetFmt}
            {assetSizeText !== "—" ? ` · ${assetSizeText}` : ""}
          </Typography>
        )}

        {/* 复杂度等级色点：只在 medium 以上显示，low 全标满屏都是点反而看不出重点
            AST 解析过的文件用实心方点区分（估算 vs 精确不能混着看），
            悬浮直接说出最复杂的那个函数 —— 把结论落到具体代码上。 */}
        {!node.isDirectory && st?.complexityLevel && st.complexityLevel !== "low" && (
          <Box
            sx={{
              width: 6,
              height: 6,
              borderRadius: st.engine === "ast" ? "1px" : "50%",
              flexShrink: 0,
              bgcolor: COMPLEXITY_COLOR[st.complexityLevel] ?? "#94a3b8",
            }}
            title={complexityTitle(st)}
          />
        )}

        {/* 重复代码块数 */}
        {!node.isDirectory && st && st.clones > 0 && (
          <Typography
            variant="caption"
            sx={{ fontSize: 9, lineHeight: 1, color: "secondary.main", flexShrink: 0 }}
            title={t("filesPanel.clonesTip", { n: st.clones })}
          >
            ⧉{st.clones}
          </Typography>
        )}

        {/* 符号计数 */}
        {!node.isDirectory && st && st.symbols > 0 && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.25,
              color: "info.main",
              flexShrink: 0,
            }}
            title={t("filesPanel.symbolsTip", { n: st.symbols })}
          >
            <DataObjectIcon sx={{ fontSize: 9 }} />
            <Typography variant="caption" sx={{ fontSize: 9, lineHeight: 1 }}>
              {st.symbols}
            </Typography>
          </Box>
        )}

        {/* 违规徽标 */}
        {!node.isDirectory && st && st.findings > 0 && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.25,
              color: "error.main",
              flexShrink: 0,
            }}
            title={t("filesPanel.findingsTip", { n: st.findings })}
          >
            <RuleIcon sx={{ fontSize: 9 }} />
            <Typography variant="caption" sx={{ fontSize: 9, lineHeight: 1 }}>
              {st.findings}
            </Typography>
          </Box>
        )}

        {/* 技术债徽标 */}
        {!node.isDirectory && st && st.techDebt > 0 && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.25,
              color: "warning.main",
              flexShrink: 0,
            }}
            title={t("filesPanel.techDebtTip", { n: st.techDebt })}
          >
            <BuildIcon sx={{ fontSize: 9 }} />
            <Typography variant="caption" sx={{ fontSize: 9, lineHeight: 1 }}>
              {st.techDebt}
            </Typography>
          </Box>
        )}

        {/* 行数 */}
        {!node.isDirectory && node.lineCount > 0 && (
          <Typography variant="caption" sx={{ fontSize: 10, color: "text.disabled", flexShrink: 0 }}>
            {node.lineCount}
          </Typography>
        )}

        {/* 文件级 AI 诊断入口：hover 行时显现，点击把该文件交给 AI（kind=file 整体审查，
            坐标化 prompt 由后端读取真实代码；不干扰原有的点击定位行为） */}
        {!node.isDirectory && (
          <IconButton
            size="small"
            className="ai-diag-btn"
            onClick={(e) => {
              e.stopPropagation();
              triggerDiagnosis({
                filePath: node.relPath,
                kind: "file",
                title: t("aiPanel.diagnoseFile"),
              });
            }}
            sx={{
              p: 0.2,
              ml: 0.25,
              flexShrink: 0,
              color: AI_COLOR,
              opacity: 0,
              transition: "opacity 0.12s",
              "&:hover": { bgcolor: "rgba(99,102,241,0.12)" },
            }}
            title={t("aiPanel.diagnoseFile")}
           aria-label={t("aiPanel.diagnoseFile")}>
            <AutoFixHighIcon sx={{ fontSize: 13 }} />
          </IconButton>
        )}
      </Box>
      {!node.isDirectory && isOpen && fileSymbols.length > 0 && (
        <Collapse in={isOpen}>
          {fileSymbols.map((sym) => {
            const sc = SYMBOL_KIND_COLOR[sym.kind] ?? "#64748B";
            return (
              <Box
                key={sym.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  px: 0.5,
                  py: 0.25,
                  pl: 0.5 + (depth + 1) * 1.5 + 1.5,
                  cursor: "pointer",
                  borderRadius: 0.5,
                  "&:hover": { backgroundColor: "action.hover" },
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  navigateToSource(node.id, sym.lineStart, t("filesPanel.browseToast", { path: `${node.relPath}:${sym.lineStart}` }));
                }}
                title={t("impact.symbolTip", { name: sym.name, kind: sym.kind, line: sym.lineStart })}
              >
                <SymbolKindGlyph kind={sym.kind} color={sc} />
                <Typography variant="caption" sx={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10.5 }}>
                  {sym.name}
                </Typography>
                <Typography variant="caption" sx={{ fontSize: 9, color: "text.disabled", flexShrink: 0 }}>
                  {sym.kind}
                </Typography>
              </Box>
            );
          })}
        </Collapse>
      )}
      {node.isDirectory && (
        <Collapse in={isOpen}>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              stats={stats}
              onFileClick={onFileClick}
              symbolsByFile={symbolsByFile}
              selectedRelPath={selectedRelPath}
              scrollRef={scrollRef}
            />
          ))}
        </Collapse>
      )}
    </Box>
  );
});
