// 章节可搜索选择器（CastPane 绑定入口 / 时间线事件绑章：替换 <select> 下拉）
//
// 零 Emotion：纯 div/input/button + inline style + CV 主题。
// 用 onMouseDown（非 onClick）避免 input onBlur 先于选择触发导致菜单关闭。
import { useMemo, useState } from 'react';
import { t } from '../../i18n';
import { CV } from './canvasTheme';

const MAX_DROPDOWN_ITEMS = 8;

export default function ChapterPicker({
  uniqueKey,
  chapters,
  accent: _accent,
  onSelect,
  compact,
  width,
  value,
  onClear,
}: {
  uniqueKey?: string;
  chapters: Array<{ id: string; title: string; volume?: string | null }>;
  accent: string;
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

  const filtered = useMemo(() => {
    if (!query.trim()) return chapters.slice(0, MAX_DROPDOWN_ITEMS);
    const q = query.toLowerCase();
    return chapters
      .filter((c) => c.title.toLowerCase().includes(q) || (c.volume ?? '').toLowerCase().includes(q))
      .slice(0, MAX_DROPDOWN_ITEMS);
  }, [chapters, query]);

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
                padding: compact ? '3px 8px' : '5px 10px',
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
