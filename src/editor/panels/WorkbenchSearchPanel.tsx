/**
 * 项目内全文搜索面板（find-in-files）
 *
 * 对标 Zed `crates/search` 的 `ProjectSearchView`：在工作台内用一处入口
 * 搜索整个已扫描项目的代码内容，结果**按文件分组**、每行带行号与命中预览，
 * 键盘（↑/↓/Enter）在匹配间导航、Enter 直接跳到编辑器对应行（revealLine）。
 *
 * 设计取舍（与命令面板不同）：命令面板是「全屏 Dialog 覆盖」，而搜索面板
 * 用**非模态顶部覆盖层**——编辑器在下方保持可见，对齐 Zed「搜索面板 docked
 * 不遮挡编辑区」的哲学；点结果即行动（renderable≠useful）。
 *
 * 纯前端：复用既有后端 `searchCodeContent`（FTS5 + LIKE 兜底），零 Rust/契约改动。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import FindReplaceIcon from "@mui/icons-material/FindReplace";
import Button from "@mui/material/Button";
import { useTheme } from "@mui/material/styles";
import { t } from "../../i18n";
import { useProjectStore } from "../../store/projectStore";
import { projectScanApi, type CodeIndexEntry } from "../../services/tauri";
import { triggerDiagnosis } from "../../ai/triggerDiagnosis";
import { useToastStore } from "../../store/toastStore";

interface WorkbenchSearchPanelProps {
  open: boolean;
  onClose: () => void;
  /** 跳转到某条命中：父组件负责解析文件名/语言并 openTab 落到编辑器 revealLine */
  onJump: (fileId: string, lineNo: number) => void;
}

/** 过滤选项（对标 Zed `SearchOptions` 三位开关：CASE_SENSITIVE / WHOLE_WORD / REGEX） */
interface SearchFilterOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/**
 * 在内容片段里按当前过滤选项计算所有命中区间 [start,end)。
 * 对标 Zed `text_finder`：regex 走原生 RegExp；非 regex 把查询转义后按
 * wholeWord 包词边界、按 caseSensitive 决定 i 标志；后端 FTS 已返回候选行，
 * 这里只做客户端二次精筛（后端暂不接收这些选项）。
 */
function computeMatches(
  content: string,
  rawQuery: string,
  opts: SearchFilterOptions,
): Array<[number, number]> {
  const q = rawQuery.trim();
  if (!q) return [];
  const flags = opts.caseSensitive ? "g" : "gi";
  let re: RegExp;
  if (opts.regex) {
    try {
      re = new RegExp(q, flags);
    } catch {
      return [];
    }
  } else {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const body = opts.wholeWord ? `(?<![\\w$])${escaped}(?![\\w$])` : escaped;
    try {
      re = new RegExp(body, flags);
    } catch {
      return [];
    }
  }
  const out: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(content)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    out.push([m.index, m.index + m[0].length]);
    if (++guard > 5000) break;
  }
  return out;
}

/** 按命中区间渲染高亮（与搜索选项一致，不再是固定大小写不敏感） */
function highlight(content: string, matches: Array<[number, number]>, dark: boolean): React.ReactNode {
  if (!matches.length) return content;
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  for (const [s, e] of matches) {
    if (s > i) out.push(content.slice(i, s));
    out.push(
      <Box
        component="mark"
        key={key++}
        sx={{
          bgcolor: dark ? "rgba(239,159,39,0.32)" : "rgba(239,159,39,0.38)",
          color: "inherit",
          borderRadius: 1,
          px: 0.25,
        }}
      >
        {content.slice(s, e)}
      </Box>,
    );
    i = e;
  }
  if (i < content.length) out.push(content.slice(i));
  return out;
}

/**
 * 把替换文本应用到整篇内容（对标 Zed `SearchQuery::replacement_for` / `items::replace`）。
 * - 文本模式：转义查询，wholeWord 包词边界；替换串按字面量写入（用函数 replacer
 *   避免 `$1` 被当反向引用误解析）。
 * - 正则模式：按用户输入原样构造，支持 `$1` / `$<name>` 捕获组反向引用（与 Zed 一致）。
 * 返回替换后的内容与实际替换次数；无匹配或正则非法时原样返回。
 */
function applyReplacement(
  content: string,
  rawQuery: string,
  opts: SearchFilterOptions,
  replacement: string,
): { content: string; count: number } {
  const q = rawQuery.trim();
  if (!q) return { content, count: 0 };
  const flags = opts.caseSensitive ? "g" : "gi";
  let re: RegExp;
  if (opts.regex) {
    try {
      re = new RegExp(q, flags);
    } catch {
      return { content, count: 0 };
    }
  } else {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const body = opts.wholeWord ? `(?<![\\w$])${escaped}(?![\\w$])` : escaped;
    try {
      re = new RegExp(body, flags);
    } catch {
      return { content, count: 0 };
    }
  }
  // 计数（用独立副本，避免消耗 re 的 lastIndex）
  let count = 0;
  const reCount = new RegExp(re.source, re.flags);
  let m: RegExpExecArray | null;
  while ((m = reCount.exec(content)) !== null) {
    if (m[0].length === 0) {
      reCount.lastIndex += 1;
      continue;
    }
    count += 1;
  }
  if (count === 0) return { content, count: 0 };
  const newContent = opts.regex
    ? content.replace(re, replacement)
    : content.replace(re, () => replacement);
  return { content: newContent, count };
}

/** 搜索选项切换按钮（对标 Zed `SearchOption::as_button` 的 Toggleable 图标按钮，
 *  并复用 Zed `KeyBinding::for_action_in` 的做法——在按钮下方直接显示快捷键提示） */
function FilterToggle({
  active,
  label,
  tooltip,
  onClick,
  kbd,
}: {
  active: boolean;
  label: string;
  tooltip: string;
  onClick: () => void;
  kbd?: string;
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.25 }}>
      <Tooltip title={tooltip}>
        <IconButton
          size="small"
          onClick={onClick}
          aria-pressed={active}
          sx={{
            width: 30,
            height: 30,
            border: "1px solid",
            borderColor: active ? "#EF9F27" : "divider",
            bgcolor: active ? "rgba(239,159,39,0.16)" : "transparent",
            color: active ? "#EF9F27" : "text.secondary",
            "&:hover": { bgcolor: active ? "rgba(239,159,39,0.24)" : "rgba(255,255,255,0.06)" },
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 700, fontFamily: "monospace", lineHeight: 1 }}>
            {label}
          </Typography>
        </IconButton>
      </Tooltip>
      {kbd && (
        <Typography
          variant="caption"
          sx={{ fontSize: 8, lineHeight: 1, fontFamily: "monospace", color: "text.disabled", userSelect: "none" }}
        >
          {kbd}
        </Typography>
      )}
    </Box>
  );
}

export function WorkbenchSearchPanel({ open, onClose, onJump }: WorkbenchSearchPanelProps) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const activeAnalysisId = useProjectStore((s) => s.activeAnalysisId);
  const codeIndexed = useProjectStore((s) => s.codeIndexed);
  const indexCode = useProjectStore((s) => s.indexCode);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CodeIndexEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  // 替换模式（对标 Zed ToggleReplace / ReplaceAll / ReplaceNext）
  const [replaceMode, setReplaceMode] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const [replacing, setReplacing] = useState(false);
  // 替换批次 AI 诊断进行态（独立于 replacing，避免阻塞替换按钮）
  const [diagnosing, setDiagnosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // 打开时聚焦输入框 + 自动建索引（若尚未建立，复用分析页已验证的通道）
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    setActiveIdx(0);
    if (activeAnalysisId && !codeIndexed) {
      indexCode(activeAnalysisId).catch(() => {});
    }
    return () => window.clearTimeout(id);
  }, [open, activeAnalysisId, codeIndexed, indexCode]);

  // 实时防抖搜索（抽成可复用函数，替换写盘后用来刷新命中集）
  const runSearch = useCallback(
    async (rawQuery: string) => {
      const q = rawQuery.trim();
      if (!q || !activeAnalysisId) {
        setResults([]);
        setLoading(false);
        setError(null);
        rowRefs.current.clear();
        return;
      }
      setLoading(true);
      try {
        const r = await projectScanApi.searchCodeContent(activeAnalysisId, q, 100);
        setResults(r);
        setError(null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setResults([]);
        setError(msg);
      } finally {
        setLoading(false);
        setActiveIdx(0);
        rowRefs.current.clear();
      }
    },
    [activeAnalysisId],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runSearch(query);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, runSearch]);

  // 客户端正则有效性（避免无效正则崩坏渲染，对标 Zed 解析失败静默）
  const regexValid = useMemo(() => {
    if (!regex || !query.trim()) return true;
    try {
      new RegExp(query, caseSensitive ? "g" : "gi");
      return true;
    } catch {
      return false;
    }
  }, [regex, query, caseSensitive]);

  // 后端 FTS 结果按搜索选项做客户端二次精筛（对标 Zed search_options 三位开关）
  const filtered = useMemo(() => {
    if (!regexValid) return [];
    const q = query.trim();
    if (!q) return results;
    if (!caseSensitive && !wholeWord && !regex) return results;
    const opts: SearchFilterOptions = { caseSensitive, wholeWord, regex };
    return results.filter((r) => computeMatches(r.content, q, opts).length > 0);
  }, [results, query, caseSensitive, wholeWord, regex, regexValid]);

  // 按文件分组（保留文件顺序 + 组内行序），并展开成可导航的扁平序列
  const groups = useMemo(() => {
    const map = new Map<string, CodeIndexEntry[]>();
    const order: string[] = [];
    for (const r of filtered) {
      if (!map.has(r.fileId)) {
        map.set(r.fileId, []);
        order.push(r.fileId);
      }
      map.get(r.fileId)!.push(r);
    }
    return order.map((fid) => ({
      fileId: fid,
      filePath: map.get(fid)![0].filePath,
      entries: map.get(fid)!,
    }));
  }, [filtered]);

  const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);

  // 过滤结果变化（查询/选项切换）时重置激活项为首项，避免越界高亮
  useEffect(() => {
    setActiveIdx(0);
  }, [filtered]);

  // 激活项自动滚入可视区（对标 Zed SelectNext/PrevMatch）
  useEffect(() => {
    if (!open) return;
    rowRefs.current.get(activeIdx)?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open, flat.length]);

  if (!open) return null;

  const jumpTo = (idx: number) => {
    const e = flat[idx];
    if (e) onJump(e.fileId, e.lineNo);
  };

  // 对单条搜索命中发起 AI 诊断（差异化增强：把 Zed「可行动的命中锚点」接到我们 triggerDiagnosis 通道）
  const diagnoseMatch = (entry: CodeIndexEntry) => {
    void triggerDiagnosis({
      filePath: entry.filePath,
      kind: "generic",
      title: t("workbench.search.diagnoseTitle", { query: query.trim() }),
      lineRange: [entry.lineNo, entry.lineNo],
    });
  };

  // 跨文件替换全部匹配（对标 Zed ReplaceAll：作用在结果集全部文件）。
  // 复用 readSourceFile 读全量 + writeSourceFile 写回——写回会自动 .bak 备份并登记改动台账，
  // 因此我们的替换是「可撤销」的（改动评审面板可逐条 revert），这是相对 Zed 缓冲区写回的差异化增强。
  const replaceAll = async () => {
    if (replacing) return;
    const q = query.trim();
    if (!q || groups.length === 0) {
      useToastStore.getState().info(t("workbench.search.replaceNone"));
      setConfirmAll(false);
      return;
    }
    // 首次点击进入二次确认（跨文件写盘是破坏性操作）
    if (!confirmAll) {
      setConfirmAll(true);
      return;
    }
    setConfirmAll(false);
    setReplacing(true);
    const opts: SearchFilterOptions = { caseSensitive, wholeWord, regex };
    let total = 0;
    let filesChanged = 0;
    let readFails = 0;
    for (const g of groups) {
      try {
        const src = await projectScanApi.readSourceFile(g.fileId);
        // 安全守门：截断(>6000行)或二进制/读取失败的文件不能写回，否则会丢内容
        if (src.truncated || src.skippedReason) {
          readFails += 1;
          continue;
        }
        const content = src.lines.join("\n");
        const { content: next, count } = applyReplacement(content, q, opts, replacement);
        if (count > 0) {
          await projectScanApi.writeSourceFile(g.fileId, next, {
            origin: "user",
            reason: t("workbench.search.replaceLedgerReason", { query: q, replacement }),
          });
          total += count;
          filesChanged += 1;
        }
      } catch {
        readFails += 1;
      }
    }
    setReplacing(false);
    // 写盘触发 file-changes → 增量重扫 → FTS 更新，刷新命中集（已替换的不再出现）
    await runSearch(q);
    if (total > 0) {
      useToastStore.getState().success(
        t("workbench.search.replaceDone", { count: total, files: filesChanged }),
      );
    } else {
      useToastStore.getState().info(t("workbench.search.replaceNone"));
    }
    if (readFails > 0) {
      useToastStore.getState().warning(t("workbench.search.replaceSkipped", { n: readFails }));
    }
  };

  // 替换当前激活命中所在行的全部匹配（对标 Zed ReplaceNext：替换当前匹配并前进）。
  // 行级粒度保证「当前行无残留」，写盘后刷新命中集，光标自然落到下一处剩余匹配。
  const replaceNext = async () => {
    if (replacing) return;
    const q = query.trim();
    const entry = flat[activeIdx];
    if (!q || !entry) {
      useToastStore.getState().info(t("workbench.search.replaceNone"));
      return;
    }
    setReplacing(true);
    try {
      const src = await projectScanApi.readSourceFile(entry.fileId);
      // 安全守门：截断或无法读取的文件跳过，避免写回时丢内容
      if (src.truncated || src.skippedReason) {
        useToastStore
          .getState()
          .warning(
            t("workbench.search.replaceReadFail", {
              file: entry.filePath.split("/").pop() ?? entry.filePath,
            }),
          );
        return;
      }
      const lines = src.lines.slice();
      const lineIdx = entry.lineNo - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) {
        useToastStore.getState().info(t("workbench.search.replaceNone"));
        return;
      }
      const opts: SearchFilterOptions = { caseSensitive, wholeWord, regex };
      const { content: newLine, count } = applyReplacement(lines[lineIdx], q, opts, replacement);
      if (count > 0) {
        lines[lineIdx] = newLine;
        await projectScanApi.writeSourceFile(entry.fileId, lines.join("\n"), {
          origin: "user",
          reason: t("workbench.search.replaceLedgerReason", { query: q, replacement }),
        });
        useToastStore.getState().success(t("workbench.search.replaceDoneLine"));
      } else {
        useToastStore.getState().info(t("workbench.search.replaceNone"));
      }
    } catch {
      useToastStore
        .getState()
        .warning(
          t("workbench.search.replaceReadFail", {
            file: entry.filePath.split("/").pop() ?? entry.filePath,
          }),
        );
    } finally {
      setReplacing(false);
    }
    // 刷新命中集（已替换行不再匹配），光标落到下一处剩余匹配
    await runSearch(q);
  };

  // 替换批次一键 AI 诊断（差异化增强：Zed 无 AI；把「跨文件替换」与「AI 验证」闭环）。
  // 对当前替换作用域（结果集每文件按命中行区间）逐一发起 triggerDiagnosis，
  // 让 AI 读真实代码确认替换是否引入语义问题。并发发起（每文件一个独立会话）。
  const diagnoseBatch = async () => {
    if (diagnosing || replacing) return;
    const q = query.trim();
    if (!q || groups.length === 0) {
      useToastStore.getState().info(t("workbench.search.diagnoseBatchNone"));
      return;
    }
    // 按命中数降序取前 BATCH_CAP 个文件，避免超大规模结果集刷爆 AI 会话
    const BATCH_CAP = 10;
    const scoped = [...groups]
      .sort((a, b) => b.entries.length - a.entries.length)
      .slice(0, BATCH_CAP);
    setDiagnosing(true);
    try {
      await Promise.all(
        scoped.map((g) => {
          const fileName = g.filePath.split("/").pop() ?? g.filePath;
          const lines = g.entries.map((e) => e.lineNo);
          const min = Math.min(...lines);
          const max = Math.max(...lines);
          return triggerDiagnosis({
            filePath: g.filePath,
            kind: "file",
            title: t("workbench.search.diagnoseBatchTitle", { file: fileName, count: g.entries.length }),
            lineRange: [min, max],
          });
        }),
      );
      if (groups.length > BATCH_CAP) {
        useToastStore.getState().info(t("workbench.search.diagnoseBatchCap", { n: BATCH_CAP }));
      }
      useToastStore.getState().success(t("workbench.search.diagnoseBatchToast", { n: scoped.length }));
    } finally {
      setDiagnosing(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    // 切换替换模式（对标 Zed cmd-shift-h）
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "H" || e.key === "h")) {
      e.preventDefault();
      setReplaceMode((v) => !v);
      setConfirmAll(false);
      return;
    }
    // 搜索选项快捷键（对标 Zed ⌘⌥C / ⌘⌥W / ⌘⌥X，scoped 到面板聚焦）。
    // 注意：macOS 下 ⌘⌥ 会产生组合字符（如 ç/∑/≈），故用物理键 e.code 判定，跨平台一致。
    if ((e.metaKey || e.ctrlKey) && e.altKey) {
      if (e.code === "KeyC") {
        e.preventDefault();
        e.stopPropagation();
        setCaseSensitive((v) => !v);
        setConfirmAll(false);
        return;
      }
      if (e.code === "KeyW") {
        e.preventDefault();
        e.stopPropagation();
        setWholeWord((v) => !v);
        setConfirmAll(false);
        return;
      }
      if (e.code === "KeyX") {
        e.preventDefault();
        e.stopPropagation();
        setRegex((v) => !v);
        setConfirmAll(false);
        return;
      }
    }
    // 替换模式下 Enter / ⌘Enter 走替换通道（分别对标 Zed ReplaceNext / ReplaceAll）
    if (replaceMode && query.trim()) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) void replaceAll();
        else void replaceNext();
        return;
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat.length) jumpTo(activeIdx);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (flat.length ? (i + 1) % flat.length : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
      return;
    }
    // D：对当前激活命中发起 AI 诊断（无修饰键，避免与系统快捷键冲突）
    if ((e.key === "d" || e.key === "D") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const cur = flat[activeIdx];
      if (cur) diagnoseMatch(cur);
    }
  };

  let flatCursor = -1;

  return (
    <>
      {/* 半透明背景：点击关闭（编辑器在下方仍可见） */}
      <Box
        onClick={onClose}
        sx={{
          position: "absolute",
          inset: 0,
          zIndex: 40,
          bgcolor: dark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.16)",
        }}
      />
      <Box
        onKeyDown={onKeyDown}
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 41,
          mx: "auto",
          maxWidth: 920,
          bgcolor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
          boxShadow: dark
            ? "0 8px 28px rgba(0,0,0,0.5)"
            : "0 8px 28px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "60%",
        }}
      >
        {/* 搜索栏 */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            py: 1,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <SearchIcon fontSize="small" color="action" />
          <TextField
            inputRef={inputRef}
            size="small"
            fullWidth
            variant="standard"
            placeholder={t("workbench.search.placeholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setConfirmAll(false);
            }}
            slotProps={{ input: { disableUnderline: true } }}
          />
          {/* 搜索选项切换（对标 Zed CaseSensitive / WholeWord / Regex），kbd 显示快捷键（⌘⌥C/W/X） */}
          <FilterToggle
            active={caseSensitive}
            label="Aa"
            kbd="⌘⌥C"
            tooltip={t("workbench.search.caseSensitiveHint")}
            onClick={() => {
              setCaseSensitive((v) => !v);
              setConfirmAll(false);
            }}
          />
          <FilterToggle
            active={wholeWord}
            label="W"
            kbd="⌘⌥W"
            tooltip={t("workbench.search.wholeWordHint")}
            onClick={() => {
              setWholeWord((v) => !v);
              setConfirmAll(false);
            }}
          />
          <FilterToggle
            active={regex}
            label=".*"
            kbd="⌘⌥X"
            tooltip={t("workbench.search.regexHint")}
            onClick={() => {
              setRegex((v) => !v);
              setConfirmAll(false);
            }}
          />
          {/* 替换模式开关（对标 Zed ToggleReplace，⌘⇧H 亦可切换） */}
          <Tooltip title={t("workbench.search.replaceToggleHint")}>
            <IconButton
              size="small"
              onClick={() => {
                setReplaceMode((v) => !v);
                setConfirmAll(false);
              }}
              aria-pressed={replaceMode}
              sx={{
                width: 30,
                height: 30,
                color: replaceMode ? "#EF9F27" : "text.secondary",
                "&:hover": { bgcolor: "rgba(255,255,255,0.06)" },
              }}
            >
              <FindReplaceIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {loading && <CircularProgress size={16} />}
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
            {flat.length > 0
              ? `${flat.length} ${t("workbench.search.matches")} · ${groups.length} ${t("workbench.search.files")}`
              : ""}
          </Typography>
          <IconButton size="small" onClick={onClose} aria-label={t("workbench.close")}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* 替换工具条（对标 Zed ToggleReplace 后的替换输入 + Replace Next / Replace All） */}
        {replaceMode && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 1.5,
              py: 0.75,
              borderBottom: 1,
              borderColor: "divider",
              bgcolor: dark ? "rgba(239,159,39,0.06)" : "rgba(239,159,39,0.05)",
            }}
          >
            <FindReplaceIcon fontSize="small" color="action" />
            <TextField
              size="small"
              fullWidth
              variant="standard"
              placeholder={t("workbench.search.replacePlaceholder")}
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              slotProps={{ input: { disableUnderline: true } }}
            />
            <Button
              size="small"
              variant="outlined"
              disabled={!query.trim() || replacing}
              onClick={() => void replaceNext()}
            >
              {t("workbench.search.replaceNext")}
            </Button>
            {confirmAll ? (
              <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                <Typography variant="caption" color="warning.main" sx={{ whiteSpace: "nowrap" }}>
                  {t("workbench.search.replaceConfirm", { count: flat.length, files: groups.length })}
                </Typography>
                <Button
                  size="small"
                  color="warning"
                  variant="contained"
                  disabled={replacing}
                  onClick={() => void replaceAll()}
                >
                  {t("workbench.search.replaceConfirmYes")}
                </Button>
                <Button size="small" onClick={() => setConfirmAll(false)}>
                  {t("workbench.search.replaceConfirmNo")}
                </Button>
              </Box>
            ) : (
              <Button
                size="small"
                variant="contained"
                disabled={!query.trim() || replacing}
                onClick={() => void replaceAll()}
                sx={{
                  bgcolor: "#EF9F27",
                  color: "#1a1206",
                  "&:hover": { bgcolor: "#d98f1f" },
                  "&.Mui-disabled": { bgcolor: "rgba(239,159,39,0.3)", color: "rgba(26,18,6,0.5)" },
                }}
              >
                {replacing ? <CircularProgress size={14} sx={{ color: "#1a1206" }} /> : t("workbench.search.replaceAll")}
              </Button>
            )}
            {/* 替换批次一键 AI 诊断（差异化增强：对当前替换作用域逐文件发起 triggerDiagnosis） */}
            <Button
              size="small"
              variant="outlined"
              startIcon={<AutoAwesomeIcon />}
              disabled={!query.trim() || groups.length === 0 || diagnosing || replacing}
              onClick={() => void diagnoseBatch()}
              sx={{
                color: "#EF9F27",
                borderColor: "#EF9F27",
                whiteSpace: "nowrap",
                "&:hover": { bgcolor: "rgba(239,159,39,0.12)", borderColor: "#EF9F27" },
                "&.Mui-disabled": { color: "rgba(239,159,39,0.4)", borderColor: "rgba(239,159,39,0.3)" },
              }}
            >
              {diagnosing ? (
                <CircularProgress size={14} sx={{ color: "#EF9F27" }} />
              ) : (
                t("workbench.search.diagnoseBatch")
              )}
            </Button>
          </Box>
        )}

        {/* 结果列表（按文件分组 + 命中高亮） */}
        <Box sx={{ overflow: "auto", flex: 1, py: 0.5 }}>
          {!query.trim() && (
            <Box sx={{ p: 2, color: "text.secondary", fontSize: 13 }}>{t("workbench.search.noQuery")}</Box>
          )}
          {query.trim() && !loading && flat.length === 0 && !error && regexValid && (
            <Box sx={{ p: 2, color: "text.secondary", fontSize: 13 }}>
              {t("workbench.search.noResults", { query: query.trim() })}
            </Box>
          )}
          {error && (
            <Box sx={{ p: 2, color: "error.main", fontSize: 13 }}>
              {t("workbench.search.error", { error })}
            </Box>
          )}
          {!regexValid && (
            <Box sx={{ p: 2, color: "error.main", fontSize: 13 }}>
              {t("workbench.search.regexInvalid")}
            </Box>
          )}
          {groups.map((g) => {
            const fileName = g.filePath.split("/").pop() ?? g.filePath;
            return (
              <Box key={g.fileId} sx={{ mb: 0.5 }}>
                <Box
                  sx={{
                    px: 1.5,
                    py: 0.25,
                    bgcolor: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>
                    {fileName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {g.entries.length}
                  </Typography>
                </Box>
                {g.entries.map((e) => {
                  flatCursor += 1;
                  const idx = flatCursor;
                  const isActive = idx === activeIdx;
                  return (
                    <Box
                      key={`${e.fileId}:${e.lineNo}`}
                      ref={(el) => {
                        if (el) rowRefs.current.set(idx, el as HTMLDivElement);
                        else rowRefs.current.delete(idx);
                      }}
                      onClick={() => {
                        setActiveIdx(idx);
                        jumpTo(idx);
                      }}
                      onMouseEnter={() => setActiveIdx(idx)}
                      sx={{
                        px: 1.5,
                        py: 0.5,
                        display: "flex",
                        gap: 1,
                        cursor: "pointer",
                        bgcolor: isActive
                          ? dark
                            ? "rgba(239,159,39,0.16)"
                            : "rgba(239,159,39,0.20)"
                          : "transparent",
                        borderLeft: isActive ? "3px solid #EF9F27" : "3px solid transparent",
                        "&:hover .diagBtn": { opacity: 1 },
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{ color: "text.secondary", minWidth: 40, textAlign: "right", userSelect: "none" }}
                      >
                        {e.lineNo}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          fontFamily: "monospace",
                          fontSize: 11.5,
                          lineHeight: 1.4,
                          flex: 1,
                          minWidth: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {highlight(
                          e.content,
                          computeMatches(e.content, query, { caseSensitive, wholeWord, regex }),
                          dark,
                        )}
                      </Typography>
                      <Tooltip title={t("workbench.search.diagnoseHint")}>
                        <IconButton
                          className="diagBtn"
                          size="small"
                          aria-label={t("workbench.search.diagnose")}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            diagnoseMatch(e);
                          }}
                          sx={{
                            flexShrink: 0,
                            alignSelf: "center",
                            opacity: isActive ? 1 : 0,
                            transition: "opacity .12s",
                            color: "#EF9F27",
                            "&:hover": { bgcolor: "rgba(239,159,39,0.16)" },
                          }}
                        >
                          <AutoAwesomeIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>

        {/* 底部状态条 */}
        <Box
          sx={{
            px: 1.5,
            py: 0.5,
            borderTop: 1,
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {replaceMode && query.trim()
              ? `${t("workbench.search.replaceAllHint")} · ${t("workbench.search.replaceNextHint")}`
              : t("workbench.search.hint")}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" color="text.secondary">
            {t("workbench.search.title")}
          </Typography>
        </Box>
      </Box>
    </>
  );
}
