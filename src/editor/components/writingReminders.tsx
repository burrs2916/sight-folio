// 章级提醒条组件（正文写作卡 / 写作台独立窗口共用，禁止第二份）
//
// 四类提醒条：伏笔待回收 / 灵感待分发 / 校对发现问题 / 统计离群。
// 视觉与文案与 WritingChapterEditor（chrome="paper"）原纸面卡实现一致；
// 跳转统一走 dispatchChapterJump：主窗口就地执行、写作台窗口 emit 事件
// 由主窗口接管（跨窗口精确联动，见 utils/writingDeskJump）。
import type { WritingForeshadowing } from '../../services/tauri';
import type { WritingChapter } from '../../services/writing';
import type { ProofreadIssue } from '../../utils/writingProofread';
import { beatEventText, beatImported } from '../../utils/writingTimeline';
import { computeWritingKpis, buildChapterWordRows } from '../../utils/writingStats';
import { dispatchChapterJump } from '../../utils/writingDeskJump';
import { t } from '../../i18n';
import { CV } from '../renderers/canvasTheme';

/** 伏笔回收提醒条：当前章有待回收（pending）伏笔时轻量提示，点击跳伏笔页签并选中该伏笔。 */
export function ForeshadowReminder({
  foreshadowings,
  genre,
}: {
  foreshadowings: WritingForeshadowing[];
  genre: string;
}) {
  if (foreshadowings.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        background: 'rgba(180,83,9,0.08)',
        borderBottom: '1px solid rgba(180,83,9,0.18)',
        borderLeft: '3px solid #b45309',
        flexShrink: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <span style={{ fontSize: 12, color: '#92400e', flexShrink: 0, fontWeight: 700 }}>&#9889;</span>
      <span style={{ fontSize: 11, color: '#92400e', flexShrink: 0, fontWeight: 600 }}>
        {t('writing.foreshadowPayableTitle')}
      </span>
      <div style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {foreshadowings.slice(0, 3).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => dispatchChapterJump({ genre, kind: 'foreshadowing', selectedId: f.id })}
            title={t('writing.foreshadowJumpDetail')}
            style={{
              fontSize: 10.5,
              padding: '1px 6px',
              borderRadius: 4,
              border: '1px solid rgba(180,83,9,0.35)',
              background: 'rgba(180,83,9,0.10)',
              color: '#92400e',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              lineHeight: 1.4,
            }}
          >
            &#12298;{f.title || t('writing.foreshadowUntitled')}&#12299;
          </button>
        ))}
        {foreshadowings.length > 3 && (
          <span style={{ fontSize: 10.5, color: '#92400e', flexShrink: 0, alignSelf: 'center' }}>
            +{foreshadowings.length - 3}
          </span>
        )}
      </div>
    </div>
  );
}

/** 灵感提醒条：当前章有关联且未分发的念头时轻量提示，点击跳灵感页签并选中该念头。 */
export function InspirationReminder({
  inspirations,
  genre,
}: {
  inspirations: { id: string; title?: string; summary?: string }[];
  genre: string;
}) {
  if (inspirations.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        background: 'rgba(132,204,22,0.08)',
        borderBottom: '1px solid rgba(132,204,22,0.18)',
        borderLeft: '3px solid #84cc16',
        flexShrink: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <span style={{ fontSize: 12, color: '#65a30d', flexShrink: 0, fontWeight: 700 }}>&#9734;</span>
      <span style={{ fontSize: 11, color: '#65a30d', flexShrink: 0, fontWeight: 600 }}>
        {t('writing.inspirationPayableTitle')}
      </span>
      <div style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {inspirations.slice(0, 3).map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => dispatchChapterJump({ genre, kind: 'inspiration', selectedId: b.id })}
            title={t('writing.inspirationJumpDetail')}
            style={{
              fontSize: 10.5,
              padding: '1px 6px',
              borderRadius: 4,
              border: '1px solid rgba(132,204,22,0.35)',
              background: 'rgba(132,204,22,0.10)',
              color: '#65a30d',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              lineHeight: 1.4,
            }}
          >
            &#12298;{b.title || b.summary || t('writing.inspirationUntitled')}&#12299;
          </button>
        ))}
        {inspirations.length > 3 && (
          <span style={{ fontSize: 10.5, color: '#65a30d', flexShrink: 0, alignSelf: 'center' }}>
            +{inspirations.length - 3}
          </span>
        )}
      </div>
    </div>
  );
}

/** 校对提醒条：当前章有文本发现（错别字/重复用词/敏感词/长段等）时轻量提示，
 *  点击跳校对页签并定位到该 issue（T5 proofreadFocusKey 精确联动）。 */
export function ProofreadReminder({ issues, genre }: { issues: ProofreadIssue[]; genre: string }) {
  if (issues.length === 0) return null;
  const hasBlock = issues.some((i) => i.severity === 'block');
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        background: hasBlock ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
        borderBottom: `1px solid ${hasBlock ? 'rgba(239,68,68,0.18)' : 'rgba(245,158,11,0.18)'}`,
        borderLeft: `3px solid ${hasBlock ? '#ef4444' : '#f59e0b'}`,
        flexShrink: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <span style={{ fontSize: 12, color: hasBlock ? '#dc2626' : '#d97706', flexShrink: 0, fontWeight: 700 }}>
        &#9888;
      </span>
      <span style={{ fontSize: 11, color: hasBlock ? '#dc2626' : '#d97706', flexShrink: 0, fontWeight: 600 }}>
        {t('writing.proofreadPayableTitle')}
      </span>
      <div style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {issues.slice(0, 3).map((i) => {
          const isSensitive = i.messageKey.includes('Sensitive');
          const label = i.messageKey.includes('Typo')
            ? t('writing.proofreadTypo')
            : i.messageKey.includes('Repeat')
              ? t('writing.proofreadRepeat')
              : isSensitive
                ? t('writing.proofreadSensitive')
                : i.messageKey;
          return (
            <button
              key={i.key}
              type="button"
              onClick={() => dispatchChapterJump({ genre, kind: 'proofread', issueKey: i.key })}
              title={t('writing.proofreadJumpDetail')}
              style={{
                fontSize: 10.5,
                padding: '1px 6px',
                borderRadius: 4,
                border: `1px solid ${hasBlock ? 'rgba(239,68,68,0.35)' : 'rgba(245,158,11,0.35)'}`,
                background: hasBlock ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)',
                color: hasBlock ? '#dc2626' : '#d97706',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                lineHeight: 1.4,
              }}
            >
              {label}
              {isSensitive && i.severity === 'block' ? ' (block)' : ''}
            </button>
          );
        })}
        {issues.length > 3 && (
          <span style={{ fontSize: 10.5, color: hasBlock ? '#dc2626' : '#d97706', flexShrink: 0, alignSelf: 'center' }}>
            +{issues.length - 3}
          </span>
        )}
      </div>
    </div>
  );
}

/** 统计提醒条：当前章体量与占比 + 离群标注，点击跳统计页签并定位到当前章（S4 精确联动）。 */
export function StatsReminder({
  chapter,
  chapters,
  genre,
}: {
  chapter: WritingChapter | null;
  chapters: WritingChapter[];
  genre: string;
}) {
  if (!chapter) return null;
  const bookChapters = chapters.filter((c) => c.bookId === chapter.bookId);
  const totalWords = bookChapters.reduce((sum, c) => sum + (c.wordCount ?? 0), 0);
  const words = chapter.wordCount ?? 0;
  const share = totalWords > 0 ? Math.round((words / totalWords) * 100) : 0;
  const kpis = computeWritingKpis(bookChapters, []);
  void kpis;
  const row = buildChapterWordRows(bookChapters).find((r) => r.id === chapter.id);
  const outlier = row?.outlier ?? null;
  const barColor = outlier === 'long' ? '#b45309' : outlier === 'short' ? '#f59e0b' : '#2563eb';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 12px',
        background: 'rgba(37,99,235,0.06)',
        borderBottom: '1px solid rgba(37,99,235,0.15)',
        borderLeft: '3px solid #2563eb',
        flexShrink: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <span style={{ fontSize: 11, color: '#2563eb', flexShrink: 0, fontWeight: 700 }}>∑</span>
      <span style={{ fontSize: 11, color: '#1e40af', flexShrink: 0, fontWeight: 600 }}>
        {words.toLocaleString()}
        {' · '}
        {share}%
      </span>
      {/* 比例进度条 */}
      <div
        style={{
          flex: 1,
          minWidth: 40,
          height: 5,
          borderRadius: 3,
          background: 'rgba(37,99,235,0.18)',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${Math.max(1, share)}%`, height: '100%', borderRadius: 3, background: barColor }} />
      </div>
      {outlier && (
        <span
          style={{ fontSize: 10, fontWeight: 700, color: outlier === 'long' ? '#b45309' : '#d97706', flexShrink: 0 }}
        >
          {outlier === 'long' ? t('writing.statsOutlierLong') : t('writing.statsOutlierShort')}
        </span>
      )}
      <button
        type="button"
        onClick={() => dispatchChapterJump({ genre, kind: 'stats', chapterId: chapter.id })}
        title={t('writing.statsJumpChapter')}
        style={{
          fontSize: 10,
          color: '#2563eb',
          cursor: 'pointer',
          border: 'none',
          background: 'transparent',
          padding: '1px 6px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
          flexShrink: 0,
          lineHeight: 1.4,
        }}
      >
        {t('writing.viewKind.stats')}
      </button>
    </div>
  );
}
