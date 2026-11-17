// 章级提醒条组件（正文写作卡 / 写作台独立窗口共用，禁止第二份）
//
// 四类提醒条：伏笔待回收 / 灵感待分发 / 校对发现问题 / 统计离群。
// 视觉与文案与 WritingChapterEditor（chrome="paper"）原纸面卡实现一致；
// 跳转统一走 dispatchChapterJump：主窗口就地执行、写作台窗口 emit 事件
// 由主窗口接管（跨窗口精确联动，见 utils/writingDeskJump）。
//
// ─── 颜色归属（T5：边框 / 描边 / 文字纳入主题链路，2026-11-02）───────────────
// 本组件此前把琥珀 / 草绿 / 红 / 蓝四族色值写死（'#b45309'、'rgba(245,158,11,0.18)'…），
// 只在浅色方案下挑过值，深色纸面上直接糊掉。这四族表达的是「这条提醒此刻是什么性质」，
// 属于语义色而非区域外壳色 —— 归属三分里的第 ③ 类：不再写死字面量，一律经
// useSemanticColors() 按「当前明暗 + 当前卡片底」派生，前景（文字 / 图标 / 左边条）与
// 它的淡底 / 描边同源，浅色与深色两套下都满足 4.5:1。
// 提醒条整行淡底用 wash 叠层、描边用 border 叠层、左边条用已校正前景色。
import type { WritingForeshadowing } from '../../services/tauri';
import type { WritingChapter } from '../../services/writing';
import type { ProofreadFinding } from '../../utils/writingProofread';
import { computeWritingKpis, buildChapterWordRows } from '../../utils/writingStats';
import { dispatchChapterJump } from '../../utils/writingDeskJump';
import { t } from '../../i18n';
import { useSemanticColors } from '../../theme/useSemanticColors';

/** 伏笔回收提醒条：当前章有待回收（pending）伏笔时轻量提示，点击跳伏笔页签并选中该伏笔。 */
export function ForeshadowReminder({
  foreshadowings,
  genre,
}: {
  foreshadowings: WritingForeshadowing[];
  genre: string;
}) {
  const c = useSemanticColors().tone.warning;
  if (foreshadowings.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        background: c.tint,
        borderBottom: `1px solid ${c.border}`,
        borderLeft: `3px solid ${c.color}`,
        flexShrink: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <span style={{ fontSize: 12, color: c.color, flexShrink: 0, fontWeight: 700 }}>&#9889;</span>
      <span style={{ fontSize: 11, color: c.color, flexShrink: 0, fontWeight: 600 }}>
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
              border: `1px solid ${c.border}`,
              background: c.bg,
              color: c.color,
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
          <span style={{ fontSize: 10.5, color: c.color, flexShrink: 0, alignSelf: 'center' }}>
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
  const c = useSemanticColors().tone.success;
  if (inspirations.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        background: c.tint,
        borderBottom: `1px solid ${c.border}`,
        borderLeft: `3px solid ${c.color}`,
        flexShrink: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <span style={{ fontSize: 12, color: c.color, flexShrink: 0, fontWeight: 700 }}>&#9734;</span>
      <span style={{ fontSize: 11, color: c.color, flexShrink: 0, fontWeight: 600 }}>
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
              border: `1px solid ${c.border}`,
              background: c.bg,
              color: c.color,
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
          <span style={{ fontSize: 10.5, color: c.color, flexShrink: 0, alignSelf: 'center' }}>
            +{inspirations.length - 3}
          </span>
        )}
      </div>
    </div>
  );
}

/** 校对提醒条：当前章有文本发现（错别字/重复用词/敏感词/长段等）时轻量提示，
 *  点击跳校对页签并定位到该 issue（T5 proofreadFocusKey 精确联动）。 */
export function ProofreadReminder({ issues, genre }: { issues: ProofreadFinding[]; genre: string }) {
  const T = useSemanticColors().tone;
  if (issues.length === 0) return null;
  const hasBlock = issues.some((i) => i.severity === 'block');
  const c = hasBlock ? T.danger : T.warning;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        background: c.tint,
        borderBottom: `1px solid ${c.border}`,
        borderLeft: `3px solid ${c.color}`,
        flexShrink: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <span style={{ fontSize: 12, color: c.color, flexShrink: 0, fontWeight: 700 }}>&#9888;</span>
      <span style={{ fontSize: 11, color: c.color, flexShrink: 0, fontWeight: 600 }}>
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
                border: `1px solid ${c.border}`,
                background: c.bg,
                color: c.color,
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
          <span style={{ fontSize: 10.5, color: c.color, flexShrink: 0, alignSelf: 'center' }}>
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
  const T = useSemanticColors().tone;
  if (!chapter) return null;
  const bookChapters = chapters.filter((c) => c.bookId === chapter.bookId);
  const totalWords = bookChapters.reduce((sum, c) => sum + (c.wordCount ?? 0), 0);
  const words = chapter.wordCount ?? 0;
  const share = totalWords > 0 ? Math.round((words / totalWords) * 100) : 0;
  const kpis = computeWritingKpis(bookChapters, []);
  void kpis;
  // genre 必须传下去：本组件早就拿到 genre（跳转用），但⑨ 之后 buildChapterWordRows 的
  // 离群判定改吃体裁时漏了这一处 —— 诗集底栏照样被贴「偏长/偏短」，而长短悬殊是诗集常态。
  const row = buildChapterWordRows(bookChapters, genre).find((r) => r.id === chapter.id);
  const outlier = row?.outlier ?? null;
  const info = T.info;
  // 离群（偏长 / 偏短）一律走 warning 族，靠标签文案区分，不再各配一个近似琥珀
  const barColor = outlier ? T.warning.color : info.color;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 12px',
        background: info.tint,
        borderBottom: `1px solid ${info.border}`,
        borderLeft: `3px solid ${info.color}`,
        flexShrink: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <span style={{ fontSize: 11, color: info.color, flexShrink: 0, fontWeight: 700 }}>∑</span>
      <span style={{ fontSize: 11, color: info.color, flexShrink: 0, fontWeight: 600 }}>
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
          background: info.bg,
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${Math.max(1, share)}%`, height: '100%', borderRadius: 3, background: barColor }} />
      </div>
      {outlier && (
        <span style={{ fontSize: 10, fontWeight: 700, color: T.warning.color, flexShrink: 0 }}>
          {outlier === 'long' ? t('writing.statsOutlierLong') : t('writing.statsOutlierShort')}
        </span>
      )}
      <button
        type="button"
        onClick={() => dispatchChapterJump({ genre, kind: 'stats', chapterId: chapter.id })}
        title={t('writing.statsJumpChapter')}
        style={{
          fontSize: 10,
          color: info.color,
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
