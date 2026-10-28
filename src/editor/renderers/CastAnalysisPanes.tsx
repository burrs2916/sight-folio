// 人物设定分析视图（工作室 L2 'characters' 页签内的子模式）
//
// 从写作台（WritingPage 左栏 settings）迁移而来：热力图 / 矩阵本质是
// **统计分析视图**，不是图谱/画布 —— 工作室已废弃底层画布，这里用
// 纯 div/inline style（CV 主题）承载，数据直接读 writingStore 的倒排索引
// （characterChapterIndex / settingInboundIndex，O(1)）。
//
// 事件约定：
//   - 点击角色 -> selectSetting（右栏检视器，与 CastPane 列表 viewDetail 同一入口）
//   - 点击热力图格子 -> openChapterCarrierView（正文容器页签，与大纲/伏笔同一跳转通道）
//
// 零 Emotion：纯 div/canvas + inline style，与 writingPanes 同一套 CV 主题。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWritingStore } from '../../store/writingStore';
import { t } from '../../i18n';
import { CV } from './canvasTheme';
import type { WritingChapter, WritingSetting } from '../../services/tauri';

const CELL_W = 18;
const CELL_H = 22;
const HEADER_H = 24;
const LABEL_W = 140;
const GAP = 1;
const COLS_VISIBLE = 40; // 初始可见列数（滚动加载更多）

// ─── 热力图：人物 × 章节 出场密度 ───────────────────────────────────────
export function CastHeatmap({
  accent,
  bookId,
  onCharacterClick,
  onCellClick,
}: {
  accent: string;
  bookId?: string;
  onCharacterClick: (id: string) => void;
  onCellClick: (characterId: string, chapterId: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ col: number; row: number } | null>(null);
  const [colsCount, setColsCount] = useState(COLS_VISIBLE);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    chapter: WritingChapter;
    character: WritingSetting;
  } | null>(null);

  // T9: 直接从 store 倒排索引读取出场关系（O(1)）
  const characterChapterIndex = useWritingStore((s) => s.characterChapterIndex);
  const chapters = useWritingStore((s) => s.chapters);
  const settings = useWritingStore((s) => s.settings);

  // 按 bookId 过滤并按 sortOrder 排序的章节
  const bookChapters = useMemo(
    () =>
      chapters
        .filter((c) => (bookId ? c.bookId === bookId : true))
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [chapters, bookId],
  );

  // 该书人物（kind==='character', 按 sortOrder）
  const characters = useMemo(
    () =>
      settings
        .filter((x) => x.kind === 'character' && (bookId ? x.bookId === bookId : true))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [settings, bookId],
  );

  // 按出场频次降序排列的角色（出场多的在前）
  const sortedChars = useMemo(() => {
    return [...characters].sort((a, b) => {
      const pa = characterChapterIndex.get(a.id)?.size ?? 0;
      const pb = characterChapterIndex.get(b.id)?.size ?? 0;
      return pb - pa;
    });
  }, [characters, characterChapterIndex]);

  const visibleChapters = useMemo(() => bookChapters.slice(0, colsCount), [bookChapters, colsCount]);

  const totalW = LABEL_W + visibleChapters.length * (CELL_W + GAP) + 8;
  const totalH = HEADER_H + sortedChars.length * (CELL_H + GAP) + 8;

  // Canvas 绘制
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = totalW * dpr;
    canvas.height = totalH * dpr;
    canvas.style.width = `${totalW}px`;
    canvas.style.height = `${totalH}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, totalW, totalH);

    // 绘制列头（章节序号）
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let ci = 0; ci < visibleChapters.length; ci++) {
      const x = LABEL_W + ci * (CELL_W + GAP);
      const ch = visibleChapters[ci];
      ctx.fillStyle = CV.text3;
      ctx.fillText(String(ch.sortOrder ?? ci + 1), x + CELL_W / 2, HEADER_H / 2);
    }

    // 绘制行头（角色名）+ 数据格
    for (let ri = 0; ri < sortedChars.length; ri++) {
      const y = HEADER_H + ri * (CELL_H + GAP);
      const char = sortedChars[ri];

      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = CV.text2;
      const name = char.name || t('writingWorkbench.untitled');
      const maxNameW = LABEL_W - 12;
      let displayName = name;
      while (ctx.measureText(displayName).width > maxNameW && displayName.length > 1) {
        displayName = displayName.slice(0, -1);
      }
      if (displayName.length < name.length) displayName += '…';
      ctx.fillText(displayName, 8, y + CELL_H / 2);

      const charSet = characterChapterIndex.get(char.id);
      for (let ci = 0; ci < visibleChapters.length; ci++) {
        const x = LABEL_W + ci * (CELL_W + GAP);
        const chId = visibleChapters[ci].id;
        const has = charSet?.has(chId) ?? false;

        if (has) {
          ctx.fillStyle = accent;
          ctx.fillRect(x, y, CELL_W, CELL_H);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 0.5;
          ctx.strokeRect(x, y, CELL_W, CELL_H);
        } else {
          ctx.fillStyle = 'rgba(128,128,128,0.14)';
          ctx.fillRect(x, y, CELL_W, CELL_H);
        }
      }
    }

    // 高亮 hover
    if (hover) {
      const { col, row } = hover;
      if (col >= 0 && col < visibleChapters.length && row >= 0 && row < sortedChars.length) {
        const x = LABEL_W + col * (CELL_W + GAP);
        const y = HEADER_H + row * (CELL_H + GAP);
        ctx.strokeStyle = CV.error;
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 1, y - 1, CELL_W + 2, CELL_H + 2);
      }
    }
  }, [visibleChapters, sortedChars, characterChapterIndex, totalW, totalH, hover, accent]);

  // 鼠标交互
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (x < LABEL_W || y < HEADER_H) {
        setHover(null);
        setTooltip(null);
        return;
      }

      const col = Math.floor((x - LABEL_W) / (CELL_W + GAP));
      const row = Math.floor((y - HEADER_H) / (CELL_H + GAP));

      if (col >= 0 && col < visibleChapters.length && row >= 0 && row < sortedChars.length) {
        setHover({ col, row });
        setTooltip({
          x: e.clientX,
          y: e.clientY,
          chapter: visibleChapters[col],
          character: sortedChars[row],
        });
      } else {
        setHover(null);
        setTooltip(null);
      }
    },
    [visibleChapters, sortedChars],
  );

  const handleMouseLeave = useCallback(() => {
    setHover(null);
    setTooltip(null);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // 点击角色名列 → 右栏检视器
      if (x < LABEL_W && y >= HEADER_H) {
        const row = Math.floor((y - HEADER_H) / (CELL_H + GAP));
        if (row >= 0 && row < sortedChars.length) {
          onCharacterClick(sortedChars[row].id);
        }
        return;
      }

      // 点击数据格 → 打开该章正文
      if (x >= LABEL_W && y >= HEADER_H) {
        const col = Math.floor((x - LABEL_W) / (CELL_W + GAP));
        const row = Math.floor((y - HEADER_H) / (CELL_H + GAP));
        if (col >= 0 && col < visibleChapters.length && row >= 0 && row < sortedChars.length) {
          onCellClick(sortedChars[row].id, visibleChapters[col].id);
        }
      }
    },
    [visibleChapters, sortedChars, onCharacterClick, onCellClick],
  );

  // 滚动加载更多列
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const { scrollLeft, scrollWidth, clientWidth } = container;
    if (scrollLeft + clientWidth >= scrollWidth - 200) {
      setColsCount((prev) => Math.min(prev + COLS_VISIBLE, bookChapters.length));
    }
  }, [bookChapters.length]);

  if (sortedChars.length === 0 || bookChapters.length === 0) {
    return (
      <div style={{ padding: 12, textAlign: 'center', fontSize: 11, color: CV.text3 }}>
        {t('writing.emptySettings')}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 统计条 */}
      <div
        style={{
          padding: '5px 10px',
          borderBottom: `1px solid ${CV.divider}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10.5, color: CV.text2 }}>
          {t('writing.heatmapStats', {
            characters: sortedChars.length,
            chapters: bookChapters.length,
            visibleCols: visibleChapters.length,
          })}
        </span>
        <span style={{ fontSize: 10, color: CV.text3 }}>{t('writing.heatmapHint')}</span>
      </div>

      {/* Canvas 滚动区 */}
      <div ref={containerRef} onScroll={handleScroll} style={{ flex: 1, overflow: 'auto', cursor: 'crosshair' }}>
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          style={{ display: 'block' }}
        />
      </div>

      {/* Tooltip（fixed 浮层，pointer-events none） */}
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x + 12,
            top: tooltip.y - 8,
            zIndex: 1400,
            background: CV.paper,
            border: `1px solid ${CV.divider}`,
            borderRadius: 6,
            padding: '4px 8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            pointerEvents: 'none',
            fontSize: 11,
            maxWidth: 220,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 2 }}>
            {tooltip.character.name || t('writingWorkbench.untitled')}
          </div>
          <div style={{ fontSize: 10.5, color: CV.text2 }}>
            {t('writing.chapter')}: {tooltip.chapter.title || t('writingWorkbench.untitled')} (#
            {tooltip.chapter.sortOrder ?? '-'})
          </div>
          <div style={{ fontSize: 10, color: CV.text3, marginTop: 2 }}>{t('writing.heatmapClickHint')}</div>
        </div>
      )}
    </div>
  );
}

// ─── 矩阵：角色戏份统计与失衡检测 ──────────────────────────────────────
type CharacterStatus = 'normal' | 'isolated' | 'bitPlayer' | 'overexposed';

interface CharacterStat {
  character: WritingSetting;
  appearances: number;
  inbound: number;
  lastSortOrder: number | null;
  status: CharacterStatus;
  statusLabel: string;
  statusColor: string; // CSS 颜色（CV）或自定
}

const STATUS_PRIORITY: Record<CharacterStatus, number> = { isolated: 0, bitPlayer: 1, overexposed: 2, normal: 3 };

export function CastMatrix({
  accent,
  bookId,
  onCharacterClick,
}: {
  accent: string;
  bookId?: string;
  onCharacterClick: (id: string) => void;
}) {
  const characterChapterIndex = useWritingStore((s) => s.characterChapterIndex);
  const settingInboundIndex = useWritingStore((s) => s.settingInboundIndex);
  const chapters = useWritingStore((s) => s.chapters);
  const settings = useWritingStore((s) => s.settings);

  const characters = useMemo(
    () =>
      settings
        .filter((x) => x.kind === 'character' && (bookId ? x.bookId === bookId : true))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [settings, bookId],
  );

  const bookChapters = useMemo(
    () =>
      chapters
        .filter((c) => (bookId ? c.bookId === bookId : true))
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [chapters, bookId],
  );

  const chapterById = useMemo(() => {
    const map = new Map<string, WritingChapter>();
    for (const c of bookChapters) map.set(c.id, c);
    return map;
  }, [bookChapters]);

  const totalChapters = bookChapters.length;

  const stats: CharacterStat[] = useMemo(() => {
    return characters.map((char) => {
      const ids = characterChapterIndex.get(char.id);
      const appearances = ids?.size ?? 0;
      const inbound = settingInboundIndex.get(char.id)?.size ?? 0;

      let lastSortOrder: number | null = null;
      if (ids) {
        for (const cid of ids) {
          const ch = chapterById.get(cid);
          if (ch && (lastSortOrder === null || (ch.sortOrder ?? 0) > lastSortOrder)) {
            lastSortOrder = ch.sortOrder ?? null;
          }
        }
      }

      let status: CharacterStatus = 'normal';
      let statusLabel = t('writing.statusNormal');
      let statusColor: string = CV.success;

      if (appearances === 0 && inbound === 0) {
        status = 'isolated';
        statusLabel = t('writing.statusIsolated');
        statusColor = CV.error;
      } else if (appearances < 3 && inbound < 2) {
        status = 'bitPlayer';
        statusLabel = t('writing.statusBitPlayer');
        statusColor = CV.warning;
      } else if (totalChapters > 0 && appearances > totalChapters * 0.5) {
        status = 'overexposed';
        statusLabel = t('writing.statusOverexposed');
        statusColor = CV.info;
      }

      return { character: char, appearances, inbound, lastSortOrder, status, statusLabel, statusColor };
    });
  }, [characters, characterChapterIndex, settingInboundIndex, chapterById, totalChapters]);

  // 按状态紧急程度 → 出场次数降序
  const sorted = useMemo(() => {
    return [...stats].sort((a, b) => {
      const pa = STATUS_PRIORITY[a.status];
      const pb = STATUS_PRIORITY[b.status];
      if (pa !== pb) return pa - pb;
      return b.appearances - a.appearances;
    });
  }, [stats]);

  if (characters.length === 0) {
    return (
      <div style={{ padding: 12, textAlign: 'center', fontSize: 11, color: CV.text3 }}>
        {t('writing.emptySettings')}
      </div>
    );
  }

  const headers: { key: string; label: string; width: number }[] = [
    { key: 'name', label: t('writing.character'), width: 160 },
    { key: 'appearances', label: t('writing.appearances'), width: 60 },
    { key: 'inbound', label: t('writing.inboundRelations'), width: 60 },
    { key: 'last', label: t('writing.lastAppear'), width: 70 },
    { key: 'status', label: t('writing.status'), width: 90 },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 统计条 */}
      <div
        style={{
          padding: '5px 10px',
          borderBottom: `1px solid ${CV.divider}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10.5, color: CV.text2 }}>
          {t('writing.matrixStats', {
            characters: characters.length,
            chapters: totalChapters,
            isolated: sorted.filter((s) => s.status === 'isolated').length,
            bitPlayer: sorted.filter((s) => s.status === 'bitPlayer').length,
            overexposed: sorted.filter((s) => s.status === 'overexposed').length,
          })}
        </span>
      </div>

      {/* 表头 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '3px 10px',
          borderBottom: `1px solid ${CV.divider}`,
          background: 'rgba(128,128,128,0.08)',
          flexShrink: 0,
        }}
      >
        {headers.map((h) => (
          <span
            key={h.key}
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: CV.text3,
              width: h.width,
              flexShrink: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {h.label}
          </span>
        ))}
      </div>

      {/* 数据行 */}
      <div style={{ flex: 1, overflowY: 'auto', scrollbarGutter: 'stable' }}>
        {sorted.map((s) => (
          <div
            key={s.character.id}
            role="button"
            tabIndex={0}
            onClick={() => onCharacterClick(s.character.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onCharacterClick(s.character.id);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '3px 10px',
              borderBottom: `1px solid ${CV.divider}`,
              cursor: 'pointer',
              minWidth: 0,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'rgba(128,128,128,0.12)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'transparent';
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                width: headers[0].width,
                flexShrink: 0,
                minWidth: 0,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent, flexShrink: 0 }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: CV.text,
                }}
              >
                {s.character.name || t('writingWorkbench.untitled')}
              </span>
            </span>
            <span style={{ fontSize: 11, width: headers[1].width, flexShrink: 0, color: CV.text2 }}>
              {s.appearances}
            </span>
            <span style={{ fontSize: 11, width: headers[2].width, flexShrink: 0, color: CV.text2 }}>{s.inbound}</span>
            <span style={{ fontSize: 11, width: headers[3].width, flexShrink: 0, color: CV.text2 }}>
              {s.lastSortOrder ?? '-'}
            </span>
            <span style={{ width: headers[4].width, flexShrink: 0 }}>
              <span
                style={{
                  display: 'inline-block',
                  fontSize: 9.5,
                  fontWeight: 700,
                  lineHeight: 1,
                  padding: '3px 8px',
                  borderRadius: 999,
                  color: '#fff',
                  background: s.statusColor,
                  whiteSpace: 'nowrap',
                }}
              >
                {s.statusLabel}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 导出 ─────────────────────────────────────────────────────────────
// CastPane（writingPanes.tsx）接线：点击角色 → useEditorStore.selectSetting
// （右栏检视器），点击热力图格子 → openChapterCarrierView（正文容器页签）。
export type { CharacterStat };
