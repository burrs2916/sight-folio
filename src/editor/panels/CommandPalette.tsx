/**
 * CommandPalette — 对标 Zed command_palette 的「统一命令面板」。
 *
 * 设计严格参照 zed-main/crates/command_palette/src/command_palette.rs：
 *  1. 动作注册表驱动（action-registry driven）：命令列表由调用方以数据传入，非硬编码。
 *  2. 模糊匹配 + 命中字符下标（fuzzy_nucleo 的 `positions`）：用于高亮，对应 Zed 的 HighlightedLabel。
 *  3. 使用频次排序（Zed 的 hit_counts）：被面板调用最多的命令上浮到顶部。
 *  4. 查询历史（Zed 的 QueryHistory）：空查询框时 ↑/↓ 浏览历史查询，带前缀过滤。
 *  5. 每行右侧展示快捷键提示（Zed 的 KeyBinding::for_action_in）。
 *  6. 底部状态条（Zed 的 render_footer）：↑↓ 选择 / ↵ 运行 / Esc 关闭。
 *
 * 组件保持数据驱动、零业务耦合，可被任意页面（代码工作台 / 分析页）复用。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
// 2026-09-14：大包导入改子路径。@mui/material 大包与 @mui/material/* 子路径在 Vite
// 预构建里是两个 entry、各含一份组件内部实例（含 Tabs/Dialog 的 context），
// 混用会让同屏组件 split-brain（右栏 tabs 点击无效的根因之一）。
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import type { ReactNode } from 'react';
import { t } from '../../i18n';

export interface WorkbenchCommand {
  id: string;
  title: string;
  category: string;
  /** 额外搜索词（低权重，用于命中但不参与高亮） */
  keywords?: string;
  /** 右侧展示的快捷键提示，如 "Ctrl+`" */
  keybinding?: string;
  run: () => void;
}

interface FuzzyMatch {
  score: number;
  positions: number[];
}

// 命令面板强调色跟随主题主色（原硬编码 #3b82f6 蓝与品牌紫/预设主色不一致）
const ACCENT = 'var(--template-palette-primary-main)';
const USAGE_KEY = 'workbench.cmdpalette.usage';
const HISTORY_KEY = 'workbench.cmdpalette.history';

/**
 * 模糊匹配：子序列匹配并返回命中字符下标。
 * 分数融合：连续命中（streak）、词边界命中（boundary）、短串与更早首命中（LengthPenalty + 位置偏好），
 * 与 fuzzy_nucleo（Case::Smart / LengthPenalty::On）的排序直觉一致。
 */
function fuzzyMatch(text: string, rawQuery: string): FuzzyMatch | null {
  const t = text.toLowerCase();
  const q = rawQuery.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return { score: 0, positions: [] };
  let ti = 0;
  let score = 0;
  let streak = 0;
  const positions: number[] = [];
  for (let i = 0; i < q.length; i++) {
    const idx = t.indexOf(q[i], ti);
    if (idx === -1) return null;
    const boundary = idx === 0 || t[idx - 1] === ' ' || t[idx - 1] === '/' || t[idx - 1] === '.';
    streak = idx === ti ? streak + 1 : 0;
    score += 1 + streak * 2 + (boundary ? 4 : 0);
    positions.push(idx);
    ti = idx + 1;
  }
  score -= t.length * 0.05 + (positions[0] ?? 0) * 0.1;
  return { score, positions };
}

function loadUsage(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(USAGE_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveUsage(u: Record<string, number>) {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(u));
  } catch {
    /* localStorage 不可用时静默降级 */
  }
}
function loadHistory(): string[] {
  try {
    const a = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

/** 把标题按命中位置渲染为高亮片段（对应 Zed 的 HighlightedLabel）。 */
function renderTitle(title: string, positions: number[]): ReactNode {
  if (!positions.length) return title;
  const hit = new Set(positions);
  const parts: ReactNode[] = [];
  let buf = '';
  let bufMatched = false;
  const flush = (matched: boolean) => {
    if (!buf) return;
    parts.push(
      <span key={parts.length} style={matched ? { fontWeight: 700, color: ACCENT } : undefined}>
        {buf}
      </span>,
    );
    buf = '';
    bufMatched = false;
  };
  for (let i = 0; i < title.length; i++) {
    const matched = hit.has(i);
    if (matched !== bufMatched) flush(bufMatched);
    buf += title[i];
    bufMatched = matched;
  }
  flush(bufMatched);
  return parts;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  placeholder,
  emptyText,
  title,
}: {
  open: boolean;
  onClose: () => void;
  commands: WorkbenchCommand[];
  placeholder?: string;
  emptyText?: string;
  title?: string;
}) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [histCursor, setHistCursor] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSel(0);
      setHistCursor(null);
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  const history = useMemo(() => loadHistory(), []);

  // 使用频次排序（镜像 Zed hit_counts）：被面板调用越多越靠前，其次按标题字典序。
  const ranked = useMemo(() => {
    const usage = loadUsage();
    return [...commands].sort((a, b) => {
      const ua = usage[a.id] ?? 0;
      const ub = usage[b.id] ?? 0;
      if (ub !== ua) return ub - ua;
      return a.title.localeCompare(b.title);
    });
  }, [commands]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return ranked.map((c) => ({ c, positions: [] as number[] }));
    const scored = ranked
      .map((c) => {
        const m = fuzzyMatch(c.title, q);
        if (m) return { c, score: m.score, positions: m.positions };
        if (c.keywords) {
          const km = fuzzyMatch(c.keywords, q);
          if (km) return { c, score: km.score * 0.6, positions: [] as number[] };
        }
        return null;
      })
      .filter(Boolean) as { c: WorkbenchCommand; score: number; positions: number[] }[];
    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => ({ c: x.c, positions: x.positions }));
  }, [ranked, query]);

  useEffect(() => {
    if (sel >= results.length) setSel(Math.max(0, results.length - 1));
  }, [results.length, sel]);

  const runCommand = (c: WorkbenchCommand) => {
    const usage = loadUsage();
    usage[c.id] = (usage[c.id] ?? 0) + 1;
    saveUsage(usage);
    const q = query.trim();
    if (q) {
      const h = loadHistory().filter((x) => x !== q);
      h.push(q);
      if (h.length > 30) h.splice(0, h.length - 30);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
      } catch {
        /* 忽略持久化失败 */
      }
    }
    onClose();
    c.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // 空查询框时浏览历史查询（带前缀过滤），与 Zed QueryHistory 语义一致。
      if (query.trim() === '' && history.length > 0) {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const start = histCursor === null ? (step < 0 ? history.length : -1) : histCursor;
        const next = start + step;
        if (next < 0 || next >= history.length) {
          setHistCursor(null);
          setQuery('');
          setSel(0);
          return;
        }
        setHistCursor(next);
        setQuery(history[next]);
        setSel(0);
        return;
      }
      e.preventDefault();
      setSel((s) => (e.key === 'ArrowDown' ? Math.min(results.length - 1, s + 1) : Math.max(0, s - 1)));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (results[sel]) runCommand(results[sel].c);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { mt: 10, mb: 'auto' } } }}>
      <Box sx={{ p: 1 }}>
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          placeholder={placeholder ?? t('editor.cmdPlaceholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHistCursor(null);
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
            },
          }}
        />
      </Box>
      <Box sx={{ maxHeight: 380, overflow: 'auto', pb: 1 }}>
        {results.length === 0 ? (
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 2, py: 2 }}>
            {emptyText ?? t('editor.cmdEmpty')}
          </Typography>
        ) : (
          results.map((r, i) => (
            <Box
              key={r.c.id}
              onClick={() => runCommand(r.c)}
              onMouseEnter={() => setSel(i)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 0.8,
                cursor: 'pointer',
                bgcolor: i === sel ? 'rgb(var(--template-palette-primary-mainChannel) / 0.14)' : 'transparent',
                '&:hover': { bgcolor: 'rgb(var(--template-palette-primary-mainChannel) / 0.08)' },
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="caption" noWrap sx={{ fontWeight: i === sel ? 600 : 400, display: 'block' }}>
                  {renderTitle(r.c.title, r.positions)}
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                {r.c.category}
              </Typography>
              {r.c.keybinding && (
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: 10,
                    color: 'text.secondary',
                    fontFamily: 'monospace',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.c.keybinding}
                </Typography>
              )}
            </Box>
          ))
        )}
      </Box>
      <Box
        sx={{
          px: 2,
          py: 0.75,
          borderTop: 1,
          borderColor: 'divider',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 1.5,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {title ?? t('editor.cmdTitle')}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          ↑↓ 选择
        </Typography>
        <Typography variant="caption" color="text.secondary">
          ↵ 运行
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Esc 关闭
        </Typography>
      </Box>
    </Dialog>
  );
}
