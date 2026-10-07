// 通用可搜索单选下拉（剧情线 / 设定等非章节实体选择：替换 <select> 下拉）
//
// 零 Emotion：纯 div/input/button + inline style + CV 主题。
// 与 ChapterPicker 同款交互：用 onMouseDown（非 onClick）避免 input onBlur 先于选择触发菜单关闭。
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { CV } from './canvasTheme';

const MAX_DROPDOWN_ITEMS = 8;

export default function EntityPicker({
  uniqueKey,
  items,
  placeholder,
  onSelect,
  compact,
  width,
  value,
  onClear,
}: {
  uniqueKey?: string;
  items: Array<{ id: string; name: string }>;
  placeholder: string;
  onSelect: (id: string) => void;
  compact?: boolean;
  width?: number | string;
  value?: string | null;
  onClear?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => {
    if (!value) return null;
    return items.find((it) => it.id === value) || null;
  }, [items, value]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, MAX_DROPDOWN_ITEMS);
    const q = query.toLowerCase();
    return items.filter((it) => it.name.toLowerCase().includes(q)).slice(0, MAX_DROPDOWN_ITEMS);
  }, [items, query]);

  const w = width ?? (compact ? '100%' : 180);
  const wStyle = w as CSSProperties['width'];

  return (
    <div style={{ position: 'relative', width: wStyle }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 2 : 4, width: '100%' }}>
        <input
          type="text"
          placeholder={selected ? selected.name : placeholder}
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
            color: selected ? CV.text : CV.text2,
            background: 'transparent',
            outline: 'none',
            width: '100%',
            cursor: 'pointer',
          }}
        />
        {selected && onClear && (
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
            title={placeholder}
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
          {filtered.map((it) => (
            <button
              key={it.id + (uniqueKey || '')}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(it.id);
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
              {it.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
