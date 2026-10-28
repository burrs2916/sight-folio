// 世界观分析视图（工作室 L2 'worldview' 页签内的子模式）
//
// 与人物设定分析视图（CastAnalysisPanes）并列：
//   - 人物关注：出场频次、孤立/酱油/过度出场
//   - 世界观关注：类型分布、关联章节覆盖度
//
// 零 Emotion：纯 div + inline style + CV 主题，数据直接读 writingStore 倒排索引。
import { useMemo } from 'react';
import { useWritingStore } from '../../store/writingStore';
import { t } from '../../i18n';
import { CV } from './canvasTheme';
import { WORLDBUILDING_TYPE_KEYS, parseSettingExtra } from '../../services/tauri';
import type { WritingSetting, WritingChapter } from '../../services/tauri';

// ─── 矩阵：世界观条目统计与覆盖度 ──────────────────────────────────────
export interface WorldbuildingStat {
  setting: WritingSetting;
  type: string;
  appearances: number; // 关联章节数（通过 scenes 键）
  lastSortOrder: number | null;
}

export function WorldbuildingMatrix({
  accent,
  bookId,
  onSettingClick,
}: {
  accent: string;
  bookId?: string;
  onSettingClick: (id: string) => void;
}) {
  const characterChapterIndex = useWritingStore((s) => s.characterChapterIndex);
  const chapters = useWritingStore((s) => s.chapters);
  const settings = useWritingStore((s) => s.settings);

  const list = useMemo(
    () =>
      settings
        .filter((x) => x.kind === 'worldbuilding' && (bookId ? x.bookId === bookId : true))
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

  const stats: WorldbuildingStat[] = useMemo(() => {
    return list.map((s) => {
      const ids = characterChapterIndex.get(s.id);
      const appearances = ids?.size ?? 0;

      let lastSortOrder: number | null = null;
      if (ids) {
        for (const cid of ids) {
          const ch = chapterById.get(cid);
          if (ch && (lastSortOrder === null || (ch.sortOrder ?? 0) > lastSortOrder)) {
            lastSortOrder = ch.sortOrder ?? null;
          }
        }
      }

      const type = parseSettingExtra(s.extra).worldbuildingProfile?.type ?? '';
      return { setting: s, type, appearances, lastSortOrder };
    });
  }, [list, characterChapterIndex, chapterById]);

  // 按类型 → 出场数降序
  const sorted = useMemo(() => {
    return [...stats].sort((a, b) => {
      const ta = WORLDBUILDING_TYPE_KEYS.indexOf(a.type as (typeof WORLDBUILDING_TYPE_KEYS)[number]);
      const tb = WORLDBUILDING_TYPE_KEYS.indexOf(b.type as (typeof WORLDBUILDING_TYPE_KEYS)[number]);
      if (ta !== tb) return ta - tb;
      return b.appearances - a.appearances;
    });
  }, [stats]);

  if (list.length === 0) {
    return (
      <div style={{ padding: 12, textAlign: 'center', fontSize: 11, color: CV.text3 }}>
        {t('writing.emptySettings')}
      </div>
    );
  }

  const headers: { key: string; label: string; width: number }[] = [
    { key: 'name', label: t('writing.settingName'), width: 160 },
    { key: 'type', label: t('writing.settingCategory'), width: 80 },
    { key: 'appearances', label: t('writing.appearances'), width: 60 },
    { key: 'last', label: t('writing.lastAppear'), width: 70 },
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
          {t('writing.wbMatrixStats', { entries: list.length, chapters: bookChapters.length })}
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
            key={s.setting.id}
            role="button"
            tabIndex={0}
            onClick={() => onSettingClick(s.setting.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSettingClick(s.setting.id);
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
                {s.setting.name || t('writingWorkbench.untitled')}
              </span>
            </span>
            <span
              style={{
                fontSize: 10,
                width: headers[1].width,
                flexShrink: 0,
                color: s.type ? CV.text2 : CV.text3,
                fontStyle: s.type ? 'normal' : 'italic',
              }}
            >
              {s.type ? t(`writing.wbTypeOptions.${s.type}`) : t('writing.wbFilterAll')}
            </span>
            <span style={{ fontSize: 11, width: headers[2].width, flexShrink: 0, color: CV.text2 }}>
              {s.appearances}
            </span>
            <span style={{ fontSize: 11, width: headers[3].width, flexShrink: 0, color: CV.text2 }}>
              {s.lastSortOrder ?? '-'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
