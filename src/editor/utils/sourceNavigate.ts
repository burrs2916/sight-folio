/**
 * 左侧面板 → 源码 的统一跳转层
 *
 * 背景（本次修复的根因）：
 * 在此之前，左侧「实体 / 文件 / 插件」三个面板里每一次点击的唯一动作都是
 * `locateFileInCanvas` —— 在画布里找一个 config.filePath 匹配的实体并居中。
 * 但画布实体只有在用户手动点过「同步到画布 / 架构画像」之后才存在，
 * 所以刚扫描完项目的用户点任何一行，得到的都是一句
 * 「未同步到画布，请先执行架构画像」的 warning，看上去就是"点了没反应"。
 *
 * 这里把点击语义倒过来：
 *   主动作 = 打开源码并定位到那一行（永远可用，只依赖扫描结果）
 *   附带动作 = 如果画布上恰好有对应实体，顺手选中并居中（有则做，无则静默）
 *
 * 这样「分析结论 → 代码位置」这条链路才闭合：分析器算出
 * 「这个文件圈复杂度 42、第 87 行有个 FIXME」，用户点一下就能看到那一行代码。
 */

import { useProjectStore } from "../../store/projectStore";
import { useEditorStore } from "../../store/editorStore";
import { type SourceMark } from "../../store/sourceViewerStore";
import { findComponentForFile, findComponentForModule } from "./canvasLink";
import { L } from "../../ai/aiLang";
import { t } from "../../i18n";
import { parseFileMetricMeta, spawnCodeWorkbench, type ProjectFile } from "../../services/tauri";

/** 严重度 → 沟槽标记色档（与 SourceViewerDialog 的 MARK_COLOR 对齐） */
function severityToMark(sev: string): SourceMark["severity"] {
  const s = sev.toLowerCase();
  if (s === "critical" || s === "error") return "error";
  if (s === "warning" || s === "warn") return "warning";
  return "info";
}

/**
 * 汇总某个文件上所有"值得在沟槽里标一下"的行。
 *
 * 用户打开一个文件通常不是只想看某一行，而是想看"这个文件到底有多少问题"。
 * 把审查发现 / 技术债 / 死符号 / 重复代码块起始行一次性标出来，
 * 配合查看器的上下标记跳转按钮，就能在一个文件里连续巡检。
 *
 * 上限 400 条：再多沟槽也看不过来，而且 marks 会进 zustand 状态，
 * 大文件全量标记会让每次 open 都拷一个大数组。
 */
export function buildMarksForFile(fileId: string): SourceMark[] {
  const st = useProjectStore.getState();
  const marks: SourceMark[] = [];

  // 语法错误（R46）：tree-sitter ERROR/MISSING 节点行，最高优先级标红。
  // 数据在 FileMetric.metadata.errorLines；无该文件度量时跳过。
  const metric = st.metrics.find((m) => m.fileId === fileId);
  if (metric && metric.engine === "ast") {
    const meta = parseFileMetricMeta(metric);
    for (const line of meta.errorLines ?? []) {
      marks.push({
        line,
        label: t("sourceNav.syntaxError"),
        severity: "error",
      });
    }
  }

  for (const f of st.findings) {
    if (f.targetId !== fileId) continue;
    const line = readLineFromMetadata(f.metadata);
    if (line == null) continue;
    marks.push({ line, label: f.message, severity: severityToMark(f.severity) });
  }

  for (const d of st.techDebt) {
    if (d.fileId !== fileId) continue;
    marks.push({ line: d.lineNo, label: `${d.marker}: ${d.snippet.trim().slice(0, 80)}`, severity: "debt" });
  }

  for (const d of st.deadSymbols) {
    if (d.fileId !== fileId) continue;
    marks.push({ line: d.lineStart, label: t("editor.deadMark", { name: d.name, reason: d.reason }), severity: "warning" });
  }

  for (const c of st.clones) {
    if (c.fileId !== fileId) continue;
    marks.push({
      line: c.startLine,
      label: t("editor.cloneMark", { n: c.lineCount, m: c.groupSize }),
      severity: "info",
    });
  }

  return marks.sort((a, b) => a.line - b.line).slice(0, 400);
}

/**
 * 审查发现的行号藏在 metadata 里（后端规则引擎写入的 JSON 字符串）。
 * 规则引擎不同规则写的键名不统一（line / lineNo / line_no），这里都认。
 * 解析失败返回 null —— 没有行号的发现（如"整文件超长"）不该标在第 1 行误导人。
 */
export function readLineFromMetadata(metadata: string | null | undefined): number | null {
  if (!metadata) return null;
  try {
    const obj = JSON.parse(metadata) as Record<string, unknown>;
    for (const key of ["line", "lineNo", "line_no", "startLine", "start_line"]) {
      const v = obj[key];
      if (typeof v === "number" && v > 0) return v;
      if (typeof v === "string" && /^\d+$/.test(v) && Number(v) > 0) return Number(v);
    }
  } catch {
    /* metadata 不是 JSON（有的规则直接写纯文本），忽略 */
  }
  return null;
}

/** 附带动作：画布上有对应实体就选中并居中，没有就当无事发生 */
function tryFocusCanvasFile(file: ProjectFile | undefined): boolean {
  if (!file) return false;
  const comp = findComponentForFile(file);
  if (!comp) return false;
  useEditorStore.getState().focusComponent(comp.id);
  return true;
}

export interface NavigateResult {
  /** 源码查看器是否成功拉起 */
  opened: boolean;
  /** 画布是否同时联动定位 */
  focusedCanvas: boolean;
  /** 供调用方 toast 的说明文案 */
  message: string;
}

/**
 * 核心入口：跳到某个文件的某一行。
 *
 * @param fileId    project_files.id（源码查看器按 id 读盘）
 * @param line      目标行号，null 表示从文件头开始看
 * @param reason    副标题，说明"为什么跳到这里"
 * @param extraMarks 额外沟槽标记；不传则自动汇总该文件的全部问题行
 */
export function navigateToSource(
  fileId: string | null | undefined,
  line: number | null = null,
  _reason: string | null = null,
  _extraMarks?: SourceMark[]
): NavigateResult {
  if (!fileId) {
    return { opened: false, focusedCanvas: false, message: L("该分析项没有关联到具体文件，无法打开源码", "This analysis item is not linked to a concrete file; cannot open source") };
  }
  const file = useProjectStore.getState().files.find((f) => f.id === fileId);
  if (!file) {
    return { opened: false, focusedCanvas: false, message: L("文件不在当前扫描结果中，请重新扫描项目", "File not in current scan results; re-scan the project") };
  }
  if (file.isDirectory) {
    // 目录没有源码可读，只做画布联动
    const focused = tryFocusCanvasFile(file);
    return {
      opened: false,
      focusedCanvas: focused,
      message: focused ? L(`已在画布定位目录 ${file.relPath}`, `Located directory ${file.relPath} on canvas`) : L(`${file.relPath} 是目录`, `${file.relPath} is a directory`),
    };
  }

  // 拉起独立原生代码工作台窗口（Rust 创建/复用单例 code-workbench 窗口）；
  // 主窗口保留画布联动（tryFocusCanvasFile）。analysisId 让新窗口自举加载项目数据。
  // analysisId 兜底：优先当前激活分析 → 文件自身归属的分析 → 文件监视分析，
  // 避免 activeAnalysisId 为空时独立窗口跳过 loadAll，导致目录树不加载（间歇性空树）。
  const analysisId =
    useProjectStore.getState().activeAnalysisId ??
    file?.analysisId ??
    useProjectStore.getState().watchAnalysisId ??
    null;
  void spawnCodeWorkbench(fileId, line, analysisId).catch((e) =>
    console.error("[sourceNavigate] spawn workbench window failed", e)
  );
  const focused = tryFocusCanvasFile(file);

  const lineText = line ? `:${line}` : "";
  return {
    opened: true,
    focusedCanvas: focused,
    message: `${file.relPath}${lineText}${focused ? L("（画布已同步定位）", " (canvas synced)") : ""}`,
  };
}

/** 按相对路径跳转（符号 / 引用点等只有 filePath 没有 fileId 的场景） */
export function navigateToSourceByPath(
  relPath: string,
  line: number | null = null,
  reason: string | null = null,
  extraMarks?: SourceMark[]
): NavigateResult {
  const file = useProjectStore.getState().files.find((f) => f.relPath === relPath);
  if (!file) {
    return { opened: false, focusedCanvas: false, message: L(`文件 ${relPath} 不在当前扫描结果中`, `File ${relPath} not in current scan results`) };
  }
  return navigateToSource(file.id, line, reason, extraMarks);
}

/**
 * 模块跳转：模块不是文件，没有源码可开。
 *
 * 退而求其次 —— 画布上有模块实体就定位过去；
 * 没有的话打开该模块下最"值得看"的文件（问题最多的那个），
 * 而不是像以前那样丢一句 warning 就结束。
 */
export function navigateToModule(moduleName: string): NavigateResult {
  const comp = findComponentForModule(moduleName);
  if (comp) {
    useEditorStore.getState().focusComponent(comp.id);
    return { opened: false, focusedCanvas: true, message: L(`已在画布定位模块「${moduleName}」`, `Located module "${moduleName}" on canvas`) };
  }

  const st = useProjectStore.getState();
  const modFiles = st.files.filter((f) => !f.isDirectory && f.relPath.split("/")[0] === moduleName);
  if (modFiles.length === 0) {
    return { opened: false, focusedCanvas: false, message: L(`模块「${moduleName}」下没有可打开的文件`, `Module "${moduleName}" has no openable files`) };
  }

  // "值得看"= 审查发现 + 技术债最多，并列时取行数最多的
  const score = new Map<string, number>();
  for (const f of modFiles) score.set(f.id, 0);
  for (const fd of st.findings) if (score.has(fd.targetId)) score.set(fd.targetId, score.get(fd.targetId)! + 2);
  for (const d of st.techDebt) if (score.has(d.fileId)) score.set(d.fileId, score.get(d.fileId)! + 1);

  const target = [...modFiles].sort(
    (a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || b.lineCount - a.lineCount
  )[0];

  const r = navigateToSource(target.id, null, t("editor.moduleWorstFile", { moduleName }));
  return { ...r, message: L(`模块「${moduleName}」未在画布上，已打开 ${target.relPath}`, `Module "${moduleName}" not on canvas; opened ${target.relPath}`) };
}
