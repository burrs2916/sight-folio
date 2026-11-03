// 章节可搜索选择器（灵感挂章 / CastPane 绑定入口 / 时间线事件绑章 / 伏笔埋设·回收：替换 <select> 下拉）
//
// 树形口径：与笔记弹窗下拉、大纲树、写作台章节树共用 buildTree + treeRowIndent，
// 不是各画各的树（见 src/utils/writingTree.ts 文件头注释）。
// 零 Emotion：纯 div/input/button + inline style + CV 主题。
// 用 onMouseDown（非 onClick）避免 input onBlur 先于选择触发导致菜单关闭。
import { useMemo, useState } from 'react';
import { t } from '../../i18n';
import { CV } from './canvasTheme';
import { buildTree, treeRowIndent, type TreeNode } from '../../utils/writingTree';
import type { WritingChapter } from '../../services/writing';

export default function ChapterPicker({
  uniqueKey,
  chapters,
  onSelect,
  compact,
  width,
  value,
  onClear,
}: {
  uniqueKey?: string;
  chapters: WritingChapter[];
  onSelect: (chapterId: string) => void;
  compact?: boolean;
  width?: number | string;
  value?: string | null;
  onClear?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selectedChapter = useMemo(() => {
    if (!value) return null;
    return chapters.find((c) => c.id === value) || null;
  }, [chapters, value]);

  // 树形展平：buildTree 按 sortOrder 升序建树，深度行走得到 {id,title,volume,depth}[]；
  // 行缩进统一用 treeRowIndent(depth)，与左侧章节树、写作台绑定下拉同一口径。
  const treeRows = useMemo(() => {
    const out: { id: string; title: string; volume: string; depth: number }[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        out.push({ id: n.node.id, title: n.node.title, volume: n.node.volume, depth: n.depth });
        walk(n.children);
      }
    };
    walk(buildTree(chapters));
    return out;
  }, [chapters]);

  // 无关键字：完整树（列表有滚动容器兜底，不再截断前 8 条）；
  // 有关键字：按 title/volume 过滤，仍保留真实层级 depth 缩进。
  const filtered = useMemo(() => {
    if (!query.trim()) return treeRows;
    const q = query.toLowerCase();
    return treeRows.filter((c) => c.title.toLowerCase().includes(q) || (c.volume ?? '').toLowerCase().includes(q));
  }, [treeRows, query]);

  const w = width ?? (compact ? '100%' : 180);

  return (
    <div style={{ position: 'relative', width: w as React.CSSProperties['width'] }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 2 : 4, width: '100%' }}>
        <input
          type="text"
          placeholder={selectedChapter ? `${selectedChapter.title}` : t('writingDesign.bindChapter')}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          style={{
            fontSize: compact ? 9.5 : 11,
            padding: compact ? '2px 6px' : '3px 8px',
            border: `1px solid ${CV.divider}`,
            borderRadius: compact ? 4 : 6,
            color: selectedChapter ? CV.text : CV.text2,
            background: 'transparent',
            outline: 'none',
            width: '100%',
            cursor: 'pointer',
          }}
        />
        {selectedChapter && onClear && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onClear();
            }}
            style={{
              fontSize: compact ? 10 : 12,
              color: CV.text3,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
              flexShrink: 0,
            }}
            title={t('writing.timelineUnbound')}
          >
            ×
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 1200,
            background: CV.paper,
            border: `1px solid ${CV.divider}`,
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            maxHeight: 200,
            overflowY: 'auto',
            minWidth: '100%',
            width: '100%',
          }}
        >
          {filtered.map((c) => (
            <button
              key={c.id + (uniqueKey || '')}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(c.id);
                setQuery('');
                setOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: compact ? '3px 0' : '5px 0',
                paddingLeft: treeRowIndent(c.depth),
                paddingRight: 10,
                fontSize: compact ? 10 : 11,
                border: 'none',
                background: 'transparent',
                color: CV.text,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(128,128,128,0.12)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              {c.title || t('writingWorkbench.untitled')}
              {c.volume && <span style={{ fontSize: 9, color: CV.text3, marginLeft: 6 }}>{c.volume}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
