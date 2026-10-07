/** CodeWorkbench 悬浮面板：QuickOpen / 定义选择 / Peek / 符号跳转。 */

import { useEffect, useMemo, useState, useRef, Fragment, CSSProperties } from "react";

import Dialog from "@mui/material/Dialog";

import Box from "@mui/material/Box";

import Typography from "@mui/material/Typography";

import Chip from "@mui/material/Chip";

import TextField from "@mui/material/TextField";

import InputAdornment from "@mui/material/InputAdornment";

import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";

import SearchIcon from "@mui/icons-material/Search";

import { type SplitDirection } from "../../store/codeWorkbenchStore";

import { useProjectStore } from "../../store/projectStore";

import { t } from "../../i18n";

import { projectScanApi, type ProjectFile, type ProjectSymbol } from "../../services/tauri";

import { LanguageIcon } from "../../utils/languageIcon";

import { fuzzyMatch, fuzzyScore, parsePathWithPosition } from "./CodeWorkbenchTree";

import { symbolKindColor, symbolKindLabel } from "./CodeWorkbenchOutline";

// 把文本按命中区间渲染为高亮片段（对标 Zed file_finder 的 HighlightedLabel）
export function HighlightedRelPath({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (ranges.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", fontSize: 10 }}>
        {text}
      </Typography>
    );
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([s, e], idx) => {
    if (s > cursor) parts.push(<span key={`p${idx}`}>{text.slice(cursor, s)}</span>);
    parts.push(
      <span
        key={`h${idx}`}
        style={{ fontWeight: 700, color: "#EF9F27" }}
      >
        {text.slice(s, e + 1)}
      </span>,
    );
    cursor = e + 1;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);
  return (
    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", fontSize: 10 }}>
      {parts}
    </Typography>
  );
}

// 快速打开文件（对标 Zed file_finder）：在既有模糊文件查找基础上补齐 Zed 的核心能力——
// ①「路径:行[:列]」后缀解析跳转（PathWithPosition）；② 命中字符高亮（HighlightedLabel）；
// ③ 空查询时按最近打开历史置顶（history items）；④ Cmd/Ctrl+Enter 在分屏打开（对标 Zed split open）。
export function QuickOpen({
  open,
  onClose,
  files,
  onPick,
  onPickSplit,
}: {
  open: boolean;
  onClose: () => void;
  files: ProjectFile[];
  onPick: (fileId: string, line?: number | null, column?: number | null) => void;
  onPickSplit: (
    fileId: string,
    line?: number | null,
    column?: number | null,
    dir?: SplitDirection
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // 最近打开文件历史（fileId，最新在前），组件常驻故跨次打开保留
  const recentRef = useRef<string[]>([]);
  // 分屏方向记忆（对标 Zed go_to_file_split_* 方向感知，而非写死 right）：
  // 首次=右；用户按住修饰键主动指定方向后，下次纯 Cmd/Ctrl+Enter 复用该方向。
  const lastSplitDirRef = useRef<SplitDirection>("right");
  // 与拖拽拆分同源的方向映射（Alt=上下/左右，Alt+Ctrl=上/左，其余默认右）
  const splitDirFromMods = (
    alt: boolean,
    ctrl: boolean,
    shift: boolean
  ): SplitDirection | null => {
    if (alt && ctrl) return shift ? "left" : "up";
    if (alt) return shift ? "down" : "right";
    return null;
  };

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  // 解析「:行[:列]」后缀
  const { search, line, col } = useMemo(() => parsePathWithPosition(query), [query]);

  const results = useMemo(() => {
    const q = search.trim();
    if (!q) {
      // 空查询：最近打开置顶，其余随后（对标 Zed file_finder 空查询展示 history）
      const recIds = recentRef.current;
      const rec = recIds
        .map((id) => files.find((f) => f.id === id))
        .filter((f): f is ProjectFile => !!f);
      const rest = files.filter((f) => !recIds.includes(f.id));
      return [...rec, ...rest].slice(0, 60).map((f) => ({ f, ranges: [] as [number, number][] }));
    }
    const scored = files
      .map((f) => {
        const m = fuzzyMatch(f.relPath, q);
        return m ? { f, score: m.score, ranges: m.ranges } : null;
      })
      .filter((x): x is { f: ProjectFile; score: number; ranges: [number, number][] } => x !== null);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 60).map((x) => ({ f: x.f, ranges: x.ranges }));
  }, [files, search]);

  useEffect(() => {
    if (sel >= results.length) setSel(Math.max(0, results.length - 1));
  }, [results.length, sel]);

  const pick = (
    item: { f: ProjectFile; ranges: [number, number][] },
    split = false,
    dir: SplitDirection = "right"
  ) => {
    const fid = item.f.id;
    recentRef.current = [fid, ...recentRef.current.filter((id) => id !== fid)].slice(0, 12);
    if (split) {
      lastSplitDirRef.current = dir;
      onPickSplit(fid, line, col, dir);
    } else onPick(fid, line, col);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(results.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl+Enter → 分屏打开（对标 Zed go_to_file_split_*：方向感知而非写死，记忆上次方向）
        if (results[sel]) {
          const dir =
            splitDirFromMods(e.altKey, e.ctrlKey, e.shiftKey) ?? lastSplitDirRef.current;
          pick(results[sel], true, dir);
        }
      } else if (results[sel]) {
        pick(results[sel], false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { mt: 10, mb: "auto" } } }}
    >
      <Box sx={{ p: 1 }}>
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          placeholder={t("workbench.quickOpenPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKeyDown}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment:
                line !== null ? (
                  <InputAdornment position="end">
                    <Chip
                      size="small"
                      color="primary"
                      label={
                        col !== null
                          ? t("workbench.quickOpenLineHint", { line, col })
                          : t("workbench.quickOpenLine", { line })
                      }
                      sx={{ height: 20, fontSize: 10 }}
                    />
                  </InputAdornment>
                ) : null,
            },
          }}
        />
      </Box>
      <Box sx={{ maxHeight: 360, overflow: "auto", pb: 1 }}>
        {results.length === 0 ? (
          <Typography variant="caption" color="text.disabled" sx={{ display: "block", px: 2, py: 2 }}>
            {t("workbench.noMatch")}
          </Typography>
        ) : (
          results.map((item, i) => (
            <Box
              key={item.f.id}
              onClick={() => pick(item, false)}
              onMouseEnter={() => setSel(i)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 2,
                py: 0.8,
                cursor: "pointer",
                bgcolor: i === sel ? "rgba(59,130,246,0.14)" : "transparent",
                "&:hover": { bgcolor: "rgba(59,130,246,0.08)" },
              }}
            >
              <LanguageIcon lang={item.f.language} size={15} />
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="caption"
                  noWrap
                  sx={{ fontWeight: i === sel ? 600 : 400, display: "block" }}
                >
                  {item.f.name}
                </Typography>
                <HighlightedRelPath text={item.f.relPath} ranges={item.ranges} />
              </Box>
            </Box>
          ))
        )}
      </Box>
      {search.trim() === "" && recentRef.current.length > 0 && (
        <Box sx={{ px: 2, py: 0.5, borderTop: "1px solid", borderColor: "divider" }}>
          <Typography variant="caption" color="text.disabled">
            {t("workbench.quickOpenRecent")}
          </Typography>
        </Box>
      )}
    </Dialog>
  );
}

/** 转到符号（项目级，Ctrl/Cmd+Shift+O）：对标 Zed `Go to Symbol in Project` —— 模态选择器列出
 *  全项目符号索引，按名称模糊匹配（文件路径辅助），↑↓ 选择、⏎ 跳到定义行、Esc 关闭。
 *  与 QuickOpen(文件)/GotoLine(行) 互为兄弟导航入口，补全工作台「键盘优先」导航三件套（文件/行/符号）。 */
// 转到定义：多定义候选选择器（对标 Zed navigate_to_hover_links：num_locations>1 时弹 Definitions 浮层让用户选，
// 而非静默跳到 matches[0]）。单定义时外壳已直接跳转、不进此浮层；本浮层只负责「多义性消解」。
// 命中词高亮：在代码摘录中高亮光标词/筛选词（case-insensitive + 词边界），对标 Zed Definitions 多缓冲的 query/term 高亮。
export function highlightCode(text: string, term: string) {
  const t = term.trim();
  if (!t) return text;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w$])(${esc})(?![\\w$])`, "gi");
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <Box component="span" key={i} sx={{ bgcolor: "#EF9F27", color: "#1a1a1a", borderRadius: 0.5, px: "1px" }}>
        {p}
      </Box>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    )
  );
}

export function DefinitionPicker({
  open,
  onClose,
  word,
  candidates,
  files,
  onPick,
  onPickSplit,
}: {
  open: boolean;
  onClose: () => void;
  word: string;
  candidates: ProjectSymbol[];
  files: ProjectFile[];
  onPick: (fileId: string, relPath: string, name: string, language: string | null, line: number) => void;
  onPickSplit: (
    fileId: string,
    relPath: string,
    name: string,
    language: string | null,
    line: number,
    dir: SplitDirection
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [altHeld, setAltHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 定义预览：对标 Zed navigation.rs「Definitions」多缓冲展示真实代码（excerpt_context_lines）。
  // 按 fileId 分组懒加载（每文件只读一次），封顶 24 个文件避免超大项目卡顿；行级摘要在各候选下方渲染。
  const [excerpts, setExcerpts] = useState<Record<string, string[]>>({});
  // 跨文件定义组折叠（对标 Zed Definitions 按 buffer 分组）：记录被折叠的 fileId；默认全展开，用户可逐文件折叠。
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setExcerpts({});
      return;
    }
    let cancelled = false;
    const fileIds = Array.from(new Set(candidates.map((c) => c.fileId))).slice(0, 24);
    (async () => {
      const map: Record<string, string[]> = {};
      for (const fid of fileIds) {
        try {
          const src = await projectScanApi.readSourceFile(fid);
          if (!src.skippedReason) map[fid] = src.lines;
        } catch {
          /* 读取失败（二进制/过大/越权）：静默跳过，绝不阻断选择器 */
        }
      }
      if (!cancelled) setExcerpts(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, candidates]);

  const fileMap = useMemo(() => {
    const m = new Map<string, ProjectFile>();
    for (const f of files) m.set(f.id, f);
    return m;
  }, [files]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return candidates;
    return candidates
      .map((s) => {
        const nameScore = fuzzyScore(s.name, q) ?? 0;
        const pathScore = fuzzyScore(s.filePath, q) ?? 0;
        const score = nameScore > 0 ? nameScore : pathScore > 0 ? pathScore * 0.6 : 0;
        return { s, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.s);
  }, [candidates, query]);

  // 按 fileId 分组（保持首次出现顺序），对标 Zed Definitions 按 buffer 分组呈现。
  // visibleResults = 折叠组之外的可见候选，键盘导航/选择只在其上操作；visibleIndexMap 把候选映射到可见索引用于高亮。
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, ProjectSymbol[]>();
    for (const s of results) {
      if (!map.has(s.fileId)) {
        map.set(s.fileId, []);
        order.push(s.fileId);
      }
      map.get(s.fileId)!.push(s);
    }
    return order.map((fid) => ({ fileId: fid, file: fileMap.get(fid), items: map.get(fid)! }));
  }, [results, fileMap]);

  const visibleResults = useMemo(
    () => groups.flatMap((g) => (collapsedFiles.has(g.fileId) ? [] : g.items)),
    [groups, collapsedFiles]
  );

  const visibleIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    visibleResults.forEach((s, idx) => m.set(`${s.fileId}:${s.lineStart}`, idx));
    return m;
  }, [visibleResults]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      const tm = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(tm);
    }
  }, [open]);

  useEffect(() => {
    if (sel >= visibleResults.length) setSel(Math.max(0, visibleResults.length - 1));
  }, [visibleResults.length, sel]);

  const splitDirFromMods = (
    alt: boolean,
    ctrl: boolean,
    shift: boolean
  ): SplitDirection | null => {
    if (alt && ctrl) return shift ? "left" : "up";
    if (alt) return shift ? "down" : "right";
    return null;
  };
  const splitPreviewDir = splitDirFromMods(altHeld, ctrlHeld, shiftHeld);
  const dirLabel = (d: SplitDirection) =>
    d === "right"
      ? t("workbench.gotoSymbolSplitRight")
      : d === "down"
      ? t("workbench.gotoSymbolSplitDown")
      : d === "up"
      ? t("workbench.gotoSymbolSplitUp")
      : t("workbench.gotoSymbolSplitLeft");

  const pick = (s: ProjectSymbol) => {
    const f = fileMap.get(s.fileId);
    onPick(s.fileId, f?.relPath ?? s.filePath, s.name, f?.language ?? null, s.lineStart);
    onClose();
  };
  const pickSplit = (s: ProjectSymbol, dir: SplitDirection) => {
    const f = fileMap.get(s.fileId);
    onPickSplit(s.fileId, f?.relPath ?? s.filePath, s.name, f?.language ?? null, s.lineStart, dir);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Alt") setAltHeld(true);
    if (e.key === "Shift") setShiftHeld(true);
    if (e.key === "Control") setCtrlHeld(true);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((v) => Math.min(visibleResults.length - 1, v + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((v) => Math.max(0, v - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (visibleResults[sel]) {
        const dir = splitDirFromMods(e.altKey, e.ctrlKey, e.shiftKey);
        if (dir) pickSplit(visibleResults[sel], dir);
        else pick(visibleResults[sel]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === "Alt") setAltHeld(false);
    if (e.key === "Shift") setShiftHeld(false);
    if (e.key === "Control") setCtrlHeld(false);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { mt: 10, mb: "auto" } } }}
    >
      <Box sx={{ p: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, px: 0.5, mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {t("workbench.defPickerTitle", { name: word })}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("workbench.defPickerCount", { n: candidates.length })}
          </Typography>
        </Box>
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          placeholder={t("workbench.defPickerPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Box sx={{ mt: 1, maxHeight: 320, overflowY: "auto" }}>
          {visibleResults.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
              {t("workbench.defPickerEmpty")}
            </Typography>
          ) : (
            groups.map((g) => {
              const rel = g.file?.relPath ?? g.items[0]?.filePath ?? "";
              const isCollapsed = collapsedFiles.has(g.fileId);
              return (
                <Box key={g.fileId} sx={{ mb: 0.5 }}>
                  <Box
                    role="button"
                    aria-label={t("workbench.defPickerToggleGroup")}
                    onClick={() =>
                      setCollapsedFiles((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.fileId)) next.delete(g.fileId);
                        else next.add(g.fileId);
                        return next;
                      })
                    }
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                      px: 1,
                      py: 0.5,
                      cursor: "pointer",
                      borderRadius: 1,
                      userSelect: "none",
                      bgcolor: "rgba(0,0,0,0.04)",
                      "&:hover": { bgcolor: "rgba(0,0,0,0.08)" },
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        transform: isCollapsed ? "rotate(-90deg)" : "none",
                        transition: "transform 120ms ease",
                        fontSize: 10,
                        lineHeight: 1,
                        color: "text.secondary",
                      }}
                    >
                      ▾
                    </Box>
                    <Typography
                      component="span"
                      sx={{
                        fontFamily: "monospace",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "text.secondary",
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {rel}
                    </Typography>
                    <Typography component="span" sx={{ fontSize: 11, color: "text.disabled", ml: "auto", whiteSpace: "nowrap" }}>
                      {g.items.length}
                    </Typography>
                  </Box>
                  {!isCollapsed &&
                    g.items.map((s) => {
                      const f = fileMap.get(s.fileId);
                      const rel2 = f?.relPath ?? s.filePath;
                      const lang = f?.language ?? null;
                      const i = visibleIndexMap.get(`${s.fileId}:${s.lineStart}`)!;
                      const active = i === sel;
                      const lineArr = excerpts[s.fileId];
                      // 多行上下文：对标 Zed EXCERPT_CONTEXT_LINES 默认 2（定义行 ±2 行）；聚焦条目展开 5 行带行号 + 命中词高亮，非聚焦条目保持单行摘要。
                      const CTX = 2;
                      const term = query.trim() || word;
                      let excerptBlock: React.ReactNode = null;
                      if (lineArr) {
                      if (active) {
                        const defNo = s.lineStart;
                        const ctxStart = Math.max(1, defNo - CTX);
                        const ctxEnd = Math.min(lineArr.length, defNo + CTX);
                        const rows: React.ReactNode[] = [];
                        for (let ln = ctxStart; ln <= ctxEnd; ln++) {
                          const isDef = ln === defNo;
                          const code = lineArr[ln - 1] ?? "";
                          rows.push(
                            <Box
                              key={ln}
                              title={t("workbench.defPickerJumpLine", { line: ln })}
                              onClick={(e) => {
                                // 对标 Zed Definitions 多缓冲：摘录的每一行都是可导航的真实位置，点击直跳该行。
                                // 整行 onClick 已跳定义行，此处 stopPropagation 避免重复触发；renderable≠useful·可行动。
                                e.stopPropagation();
                                onPick(s.fileId, rel2, s.name, lang, ln);
                                onClose();
                              }}
                              sx={{
                                position: "relative",
                                display: "flex",
                                fontFamily: "monospace",
                                fontSize: 11,
                                lineHeight: 1.45,
                                px: 1,
                                cursor: "pointer",
                                bgcolor: isDef ? "rgba(239,159,39,0.16)" : "transparent",
                                color: isDef ? "text.primary" : "text.secondary",
                                "&:hover": {
                                  bgcolor: isDef ? "rgba(239,159,39,0.24)" : "rgba(59,130,246,0.10)",
                                },
                              }}
                            >
                              <Box
                                component="span"
                                sx={{ flex: "0 0 30px", width: 30, textAlign: "right", pr: 1, color: "text.disabled", userSelect: "none" }}
                              >
                                {ln}
                              </Box>
                              <Box
                                component="span"
                                sx={{ minWidth: 0, flex: 1, whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis" }}
                              >
                                {highlightCode(code, term)}
                              </Box>
                            </Box>
                          );
                        }
                        excerptBlock = (
                          <Box sx={{ ml: 2.5, mt: 0.25, borderLeft: "2px solid #EF9F27", pl: 0.5 }}>{rows}</Box>
                        );
                      } else {
                        const defLine = lineArr[Math.max(0, s.lineStart - 1)];
                        if (defLine != null) {
                          excerptBlock = (
                            <Box
                              component="pre"
                              sx={{
                                m: 0,
                                mt: 0.25,
                                ml: 2.5,
                                pl: 1,
                                fontFamily: "monospace",
                                fontSize: 11,
                                lineHeight: 1.5,
                                whiteSpace: "pre",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                color: "text.secondary",
                                borderLeft: "2px solid",
                                borderColor: "divider",
                              }}
                            >
                              {highlightCode(defLine, term)}
                            </Box>
                          );
                        }
                      }
                      }
                      return (
                        <Box
                          key={`${s.fileId}:${s.lineStart}`}
                          onClick={() => pick(s)}
                          onMouseEnter={() => setSel(i)}
                          sx={{
                            px: 1,
                            py: 0.5,
                            borderRadius: 1,
                            cursor: "pointer",
                            bgcolor: active ? "rgba(59,130,246,0.14)" : "transparent",
                            "&:hover": { bgcolor: "rgba(59,130,246,0.08)" },
                          }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                              py: 0.25,
                            }}
                          >
                            <Box
                              component="span"
                              sx={{
                                fontSize: 10,
                                fontWeight: 700,
                                px: 0.5,
                                borderRadius: 0.5,
                                color: "#fff",
                                bgcolor: symbolKindColor(s.kind),
                                whiteSpace: "nowrap",
                              }}
                            >
                              {symbolKindLabel(s.kind)}
                            </Box>
                            <Typography component="span" sx={{ fontFamily: "monospace", fontWeight: 600, fontSize: 13 }}>
                              {s.name}
                            </Typography>
                            <Typography
                              component="span"
                              sx={{ fontSize: 12, color: "text.secondary", ml: "auto", whiteSpace: "nowrap" }}
                            >
                              {rel2}:{s.lineStart}
                            </Typography>
                          </Box>
                          {excerptBlock}
                        </Box>
                      );
                    })}
                </Box>
              );
            })
          )}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, px: 0.5 }}>
          {t("workbench.gotoSymbolFooter")}
          {splitPreviewDir && (
            <Box component="span" sx={{ color: "#EF9F27", ml: 0.5 }}>
              {dirLabel(splitPreviewDir)}
            </Box>
          )}
        </Typography>
      </Box>
    </Dialog>
  );
}

// 内联 Peek 定义预览浮层（对标 VS Code Peek Definition；Zed 无此能力，我们自建）。
// 单定义场景：原地悬浮预览目标源码（定义行上下各 CONTEXT 行上下文 + 定义行高亮），用户不离开当前位置即可 glance 定义；
// Esc 关闭返回、Enter/点击任意行在分屏打开（复用分屏方向记忆 lastSplitDirRef）。补齐 goto-family「不想跳转只看一眼」的弱项，
// 让单定义导航从「必跳转离开」升级为「原地可预览、可行动」（renderable AND useful）。浮层自取源码 excerpt，纯前端零新依赖。
export function PeekPanel({
  word,
  fileId,
  relPath,
  name,
  language,
  line,
  anchor,
  onClose,
  onOpen,
}: {
  word: string;
  fileId: string;
  relPath: string;
  name: string;
  language: string | null;
  line: number;
  anchor: { x: number; y: number } | null;
  onClose: () => void;
  onOpen: (fid: string, relPath: string, name: string, language: string | null, line: number) => void;
}) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "err">("loading");
  const rootRef = useRef<HTMLDivElement>(null);
  const CONTEXT = 7; // 定义行上下各 7 行上下文

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const src = await projectScanApi.readSourceFile(fileId);
        if (cancelled) return;
        if (src.skippedReason) {
          setStatus("err");
          return;
        }
        setLines(src.lines);
        setStatus("ok");
      } catch {
        if (!cancelled) setStatus("err");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  // Esc 关闭 / Enter 在分屏打开定义行（capture 阶段拦截，避免冒泡到编辑器命令）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onOpen(fileId, relPath, name, language, line);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    rootRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, relPath, name, language, line]);

  // 浮层定位：以光标锚点为基准，限制在视口内不溢出（右侧/下方空间不足则翻到另一侧）。
  const W = 560;
  const H = 360;
  const style: CSSProperties = (() => {
    const base: React.CSSProperties = { position: "fixed", zIndex: 1400, width: W, maxWidth: "92vw" };
    if (anchor) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = anchor.x + 8;
      let top = anchor.y + 6;
      if (left + W > vw - 12) left = Math.max(12, anchor.x - W - 8);
      if (top + H > vh - 12) top = Math.max(12, anchor.y - H - 6);
      left = Math.min(Math.max(12, left), vw - W - 12);
      top = Math.min(Math.max(12, top), vh - H - 12);
      base.left = left;
      base.top = top;
    } else {
      base.left = "50%";
      base.top = "42%";
      base.transform = "translate(-50%, -50%)";
    }
    return base;
  })();

  const start = Math.max(0, line - 1 - CONTEXT);
  const end = lines ? Math.min(lines.length, line + CONTEXT) : 0;
  const shortPath = relPath.split("/").slice(-2).join("/");

  return (
    <Box
      ref={rootRef}
      tabIndex={-1}
      sx={{
        ...style,
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1.5,
        boxShadow: 8,
        outline: "none",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 头部：符号名 + 文件名:行 + 操作提示 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.25,
          py: 0.75,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "action.hover",
        }}
      >
        <AutoAwesomeIcon sx={{ fontSize: 15, color: "#EF9F27" }} />
        <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{t("workbench.peekTitle", { name: word })}</Typography>
        <Typography
          sx={{
            fontSize: 11,
            color: "text.secondary",
            ml: "auto",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 220,
          }}
        >
          {shortPath}:{line}
        </Typography>
      </Box>
      {/* 源码预览（只读；定义行高亮，单击任意行在分屏打开该行） */}
      <Box sx={{ flex: 1, overflow: "auto", fontFamily: "monospace", fontSize: 12, lineHeight: 1.5, py: 0.5 }}>
        {status === "loading" && (
          <Typography sx={{ p: 1.5, color: "text.secondary" }}>{t("workbench.peekLoading")}</Typography>
        )}
        {status === "err" && (
          <Typography sx={{ p: 1.5, color: "text.secondary" }}>{t("workbench.peekReadError")}</Typography>
        )}
        {status === "ok" &&
          lines &&
          Array.from({ length: end - start }, (_, i) => {
            const ln = start + i;
            const code = lines[ln];
            const isDef = ln + 1 === line;
            return (
              <Box
                key={ln}
                onClick={() => {
                  onOpen(fileId, relPath, name, language, ln + 1);
                  onClose();
                }}
                sx={{
                  display: "flex",
                  gap: 1,
                  px: 1,
                  cursor: "pointer",
                  bgcolor: isDef ? "rgba(239,159,39,0.16)" : "transparent",
                  borderLeft: isDef ? "3px solid #EF9F27" : "3px solid transparent",
                  "&:hover": { bgcolor: isDef ? "rgba(239,159,39,0.24)" : "action.hover" },
                }}
              >
                <Box
                  component="span"
                  sx={{ width: 38, textAlign: "right", color: "text.disabled", userSelect: "none", flexShrink: 0 }}
                >
                  {ln + 1}
                </Box>
                <Box
                  component="span"
                  sx={{ whiteSpace: "pre", color: isDef ? "text.primary" : "text.secondary" }}
                >
                  {isDef ? highlightCode(code, word) : code}
                </Box>
              </Box>
            );
          })}
      </Box>
      {/* 底部操作提示 */}
      <Box
        sx={{
          px: 1.25,
          py: 0.5,
          borderTop: "1px solid",
          borderColor: "divider",
          fontSize: 11,
          color: "text.secondary",
          display: "flex",
          gap: 1,
        }}
      >
        <span>{t("workbench.peekOpenHint")}</span>
        <Box component="span" sx={{ ml: "auto", color: "#EF9F27" }}>
          {t("workbench.peekGotoDef")}
        </Box>
      </Box>
    </Box>
  );
}

export function GoToSymbol({
  open,
  onClose,
  symbols,
  files,
  onPick,
  onPickSplit,
}: {
  open: boolean;
  onClose: () => void;
  symbols: ProjectSymbol[];
  files: ProjectFile[];
  onPick: (fileId: string, relPath: string, name: string, language: string | null, line: number) => void;
  /** 拆分窗格打开（对标 Zed `go_to_file_split_*`）：Alt+⏎→右分屏 / Alt+Shift+⏎→下分屏；dir 指定生长方向 */
  onPickSplit: (
    fileId: string,
    relPath: string,
    name: string,
    language: string | null,
    line: number,
    dir: SplitDirection
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [altHeld, setAltHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时若符号索引为空，惰性加载（分析未预载符号时也能用，零新依赖）
  useEffect(() => {
    if (open && symbols.length === 0) {
      const id = useProjectStore.getState().activeAnalysisId;
      if (id) void useProjectStore.getState().loadSymbols(id);
    }
  }, [open, symbols.length]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      const tm = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(tm);
    }
  }, [open]);

  const fileMap = useMemo(() => {
    const m = new Map<string, ProjectFile>();
    for (const f of files) m.set(f.id, f);
    return m;
  }, [files]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) {
      // 空查询：按文件 + 行号排序，展示项目符号全景（截断避免超长列表）
      return symbols
        .slice()
        .sort((a, b) =>
          a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : a.lineStart - b.lineStart
        )
        .slice(0, 200);
    }
    return symbols
      .map((s) => {
        const nameScore = fuzzyScore(s.name, q) ?? 0;
        const pathScore = fuzzyScore(s.filePath, q) ?? 0;
        const score = nameScore > 0 ? nameScore : pathScore > 0 ? pathScore * 0.6 : 0;
        return { s, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 80)
      .map((x) => x.s);
  }, [symbols, query]);

  useEffect(() => {
    if (sel >= results.length) setSel(Math.max(0, results.length - 1));
  }, [results.length, sel]);

  const pick = (s: ProjectSymbol) => {
    const f = fileMap.get(s.fileId);
    onPick(s.fileId, f?.relPath ?? s.filePath, s.name, f?.language ?? null, s.lineStart);
    onClose();
  };

  // 拆分窗格打开：在激活窗格旁按 dir 方向生长新分屏并打开符号所在文件（对标 Zed go_to_file_split_*）
  const pickSplit = (s: ProjectSymbol, dir: SplitDirection) => {
    const f = fileMap.get(s.fileId);
    onPickSplit(s.fileId, f?.relPath ?? s.filePath, s.name, f?.language ?? null, s.lineStart, dir);
    onClose();
  };

  // 由修饰键推导拆分方向（对标 Zed go_to_file_split_{left,right,up,down}）：
  // Alt(+Shift) → 右/下；Ctrl+Alt(+Shift) → 上/左
  const splitDirFromMods = (
    alt: boolean,
    ctrl: boolean,
    shift: boolean
  ): SplitDirection | null => {
    if (alt && ctrl) return shift ? "left" : "up";
    if (alt) return shift ? "down" : "right";
    return null;
  };
  const splitPreviewDir: SplitDirection | null = splitDirFromMods(altHeld, ctrlHeld, shiftHeld);
  const splitPreviewKbd = ctrlHeld && altHeld ? "⌃⌥" : "⌥";
  const dirLabel = (d: SplitDirection) =>
    d === "right"
      ? t("workbench.gotoSymbolSplitRight")
      : d === "down"
      ? t("workbench.gotoSymbolSplitDown")
      : d === "up"
      ? t("workbench.gotoSymbolSplitUp")
      : t("workbench.gotoSymbolSplitLeft");

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Alt") setAltHeld(true);
    if (e.key === "Shift") setShiftHeld(true);
    if (e.key === "Control") setCtrlHeld(true);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((v) => Math.min(results.length - 1, v + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((v) => Math.max(0, v - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[sel]) {
        const dir = splitDirFromMods(e.altKey, e.ctrlKey, e.shiftKey);
        if (dir) pickSplit(results[sel], dir);
        else pick(results[sel]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === "Alt") setAltHeld(false);
    if (e.key === "Shift") setShiftHeld(false);
    if (e.key === "Control") setCtrlHeld(false);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { mt: 10, mb: "auto" } } }}
    >
      <Box sx={{ p: 1 }}>
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          placeholder={t("workbench.gotoSymbolPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>
      <Box sx={{ maxHeight: 360, overflow: "auto", pb: 1 }}>
        {results.length === 0 ? (
          <Typography variant="caption" color="text.disabled" sx={{ display: "block", px: 2, py: 2 }}>
            {t("workbench.noMatchSymbol")}
          </Typography>
        ) : (
          results.map((s, i) => {
            const f = fileMap.get(s.fileId);
            return (
              <Box
                key={s.id}
                onClick={(e) => {
                  const dir = splitDirFromMods(e.altKey, e.ctrlKey, e.shiftKey);
                  if (dir) pickSplit(s, dir);
                  else pick(s);
                }}
                onMouseEnter={() => setSel(i)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  px: 2,
                  py: 0.8,
                  cursor: "pointer",
                  bgcolor: i === sel ? "rgba(59,130,246,0.14)" : "transparent",
                  "&:hover": { bgcolor: "rgba(59,130,246,0.08)" },
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    flexShrink: 0,
                    width: 34,
                    fontSize: 9,
                    textTransform: "uppercase",
                    fontWeight: 600,
                    color: symbolKindColor(s.kind),
                  }}
                  noWrap
                >
                  {symbolKindLabel(s.kind)}
                </Typography>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="caption" noWrap sx={{ fontWeight: i === sel ? 600 : 400, display: "block" }}>
                    {s.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", fontSize: 10 }}>
                    {f?.relPath ?? s.filePath}:{s.lineStart}
                  </Typography>
                </Box>
                {i === sel && splitPreviewDir && (
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{
                      flexShrink: 0,
                      ml: "auto",
                      pl: 1,
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#EF9F27",
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                    }}
                  >
                    {splitPreviewKbd}{shiftHeld ? "⇧ " : " "}
                    {dirLabel(splitPreviewDir)}
                  </Typography>
                )}
              </Box>
            );
          })
        )}
      </Box>
      <Box
        sx={{
          px: 2,
          py: 0.6,
          borderTop: "1px solid",
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
          {t("workbench.gotoSymbolFooter")}
        </Typography>
        {splitPreviewDir && (
          <Typography
            variant="caption"
            noWrap
            sx={{ fontSize: 10, fontWeight: 600, color: "#EF9F27", ml: "auto" }}
          >
            {splitPreviewKbd}{shiftHeld ? "⇧ " : " "}
            {dirLabel(splitPreviewDir)}
          </Typography>
        )}
      </Box>
    </Dialog>
  );
}
