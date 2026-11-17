// 伏笔右侧栏面板（对标 TimelineSidePanels 范式，2026-09-18）：
//
// ForeshadowingOverviewCard —— 右栏「要素」tab · 伏笔激活时的总览卡：
//   三态统计（待回收/已回收/已弃置）+ 跨章预警数 + 每条伏笔可点行。
// ForeshadowingDetail —— 右栏「详情」tab · 选中伏笔的完整编辑器：
//   标题 / 描述 / 埋设章 / 计划回收章 / 状态三态 / 挂剧情线 / 预警 / 删除。
// 排序与预警算法复用 utils/writingForeshadowing（与页签编辑面同一份，禁止再写第二份）。
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import { useWritingStore } from '../../store/writingStore';
import { useEditorStore } from '../../store/editorStore';
import type { WritingForeshadowing } from '../../services/tauri';
import {
  isOverdue,
  sortForeshadowings,
  sortForeshadowingsByPayoff,
  FORESHADOW_STATUSES,
  foreshadowStatusColor,
  foreshadowStatusLabelKey,
  foreshadowingCastOf,
} from '../../utils/writingForeshadowing';
import { openChapterCarrierView } from '../../utils/studioBook';
import { clipSummary } from '../../utils/writingSearch';
import { t } from '../../i18n';
import { DraftInput } from '../components/DraftInput';
import ChapterPicker from '../renderers/ChapterPicker';

/**
 * 伏笔 P2 · 牵涉人物区（编辑卡内嵌，2026-09-19）：
 * 数据全在 outlines（节拍 cast）× settings 派生，零新模型；点 chip 选中设定。
 */
function ForeshadowingCastSection({ item, bookId: _bookId }: { item: WritingForeshadowing; bookId: string | null }) {
  const outlines = useWritingStore((s) => s.outlines);
  const settings = useWritingStore((s) => s.settings);
  const selectSetting = useEditorStore((s) => s.selectSetting);
  const cast = useMemo(() => foreshadowingCastOf(item, outlines, settings), [item, outlines, settings]);
  const hasChapterBound = !!(item.plantChapterId || item.payoffChapterId);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {t('writing.foreshadowCastTitle')}
      </Typography>
      {cast.length === 0 ? (
        <Typography variant="caption" color="text.disabled">
          {hasChapterBound ? t('writing.foreshadowCastNoBeat') : t('writing.foreshadowCastEmpty')}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {cast.map((c) => (
            <Box
              key={c.id}
              component="button"
              type="button"
              onClick={() => selectSetting(c.id)}
              title={t('writingDesign.viewDetail')}
              sx={{
                cursor: 'pointer',
                fontSize: 11,
                px: 1,
                py: 0.25,
                borderRadius: 2.5,
                border: 1,
                borderColor: 'divider',
                bgcolor: 'transparent',
                color: 'text.secondary',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                maxWidth: 180,
                '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
              }}
            >
              {c.name}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** 状态选择器（总览卡/编辑卡共用）：三态 select。 */
export function ForeshadowStatusSelect({ item, compact }: { item: WritingForeshadowing; compact?: boolean }) {
  const updateForeshadowing = useWritingStore((s) => s.updateForeshadowing);
  return (
    <Box
      component="select"
      value={item.status}
      onChange={(e) => void updateForeshadowing(item.id, { status: e.target.value })}
      title={t('writing.foreshadowStatusTitle')}
      sx={{
        flexShrink: 0,
        fontSize: compact ? 10.5 : 12,
        maxWidth: compact ? 88 : 120,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'transparent',
        color: foreshadowStatusColor(item.status),
        py: 0.1,
      }}
    >
      {FORESHADOW_STATUSES.map((st) => (
        <option key={st} value={st}>
          {t(foreshadowStatusLabelKey(st))}
        </option>
      ))}
    </Box>
  );
}

// ─── 要素 tab · 伏笔总览卡 ───
export function ForeshadowingOverviewCard() {
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const chapters = useWritingStore((s) => s.chapters);
  const storylines = useWritingStore((s) => s.storylines);
  const loadForeshadowings = useWritingStore((s) => s.loadForeshadowings);
  const selectForeshadowing = useEditorStore((s) => s.selectForeshadowing);

  // 数据可能尚未 load（右栏不经过主 pane 的 mount effect）：补齐。
  useEffect(() => {
    const ws = useWritingStore.getState();
    if (ws.activeBookId && ws.foreshadowings.length === 0) void ws.loadForeshadowings().catch(() => {});
  }, [loadForeshadowings]);

  const [sortBy, setSortBy] = useState<'status' | 'payoff'>('status');
  const sorted = useMemo(
    () =>
      sortBy === 'status'
        ? sortForeshadowings(foreshadowings, chapters)
        : sortForeshadowingsByPayoff(foreshadowings, chapters),
    [sortBy, foreshadowings, chapters],
  );
  const pendingCount = foreshadowings.filter((f) => f.status === 'pending').length;
  const paidoffCount = foreshadowings.filter((f) => f.status === 'paidoff').length;
  const abandonedCount = foreshadowings.filter((f) => f.status === 'abandoned').length;
  const overdueCount = sorted.filter((f) => isOverdue(f, chapters)).length;
  const unlinedCount = foreshadowings.filter((f) => !f.storylineId).length;

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1.5,
        p: 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }} color="text.secondary">
          {t('writing.viewKind.foreshadowing')} · {foreshadowings.length}
        </Typography>
        {foreshadowings.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {(
              [
                ['status', t('writing.foreshadowSortStatus')],
                ['payoff', t('writing.foreshadowSortPayoff')],
              ] as const
            ).map(([mode, label]) => (
              <Box
                key={mode}
                component="button"
                type="button"
                onClick={() => setSortBy(mode)}
                title={label}
                sx={{
                  fontSize: 9,
                  py: 0.1,
                  px: 0.6,
                  borderRadius: 0.75,
                  border: 1,
                  borderColor: sortBy === mode ? 'primary.main' : 'divider',
                  bgcolor: sortBy === mode ? 'rgb(var(--template-palette-primary-mainChannel) / 0.08)' : 'transparent',
                  color: sortBy === mode ? 'primary.main' : 'text.secondary',
                  fontWeight: sortBy === mode ? 700 : 400,
                  cursor: 'pointer',
                  minWidth: 0,
                }}
              >
                {label}
              </Box>
            ))}
          </Box>
        )}
        <Typography
          variant="caption"
          onClick={() => {
            const es = useEditorStore.getState();
            void useWritingStore
              .getState()
              .createForeshadowing(t('writing.foreshadowDefaultName', { n: foreshadowings.length + 1 }))
              .then((item) => {
                if (item) es.selectForeshadowing(item.id);
              });
          }}
          title={t('writing.foreshadowCreate')}
          sx={{ cursor: 'pointer', color: 'primary.main', fontWeight: 700, '&:hover': { textDecoration: 'underline' } }}
        >
          ＋ {t('writing.foreshadowCreate')}
        </Typography>
      </Box>
      {foreshadowings.length === 0 ? (
        <Typography variant="caption" color="text.disabled">
          {t('writing.foreshadowEmptyHint')}
        </Typography>
      ) : (
        <>
          <Typography variant="caption" color="text.secondary">
            {t('writing.foreshadowStatusPending', { n: pendingCount })} ·{' '}
            {t('writing.foreshadowStatusPaidoff', { n: paidoffCount })}
            {abandonedCount > 0 ? ` · ${t('writing.foreshadowStatusAbandoned', { n: abandonedCount })}` : ''}
          </Typography>
          {overdueCount > 0 && (
            <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 700 }}>
              ⚠ {t('writing.foreshadowOverdue', { n: overdueCount })}
            </Typography>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {sorted.map((f) => {
              const overdue = isOverdue(f, chapters);
              const line = f.storylineId ? storylines.find((sl) => sl.id === f.storylineId) : null;
              const payoffCh = f.payoffChapterId ? chapters.find((c) => c.id === f.payoffChapterId) : null;
              return (
                <Box
                  key={f.id}
                  onClick={() => selectForeshadowing(f.id)}
                  sx={{
                    cursor: 'pointer',
                    fontSize: 11.5,
                    p: '3px 6px',
                    borderRadius: 1,
                    border: 1,
                    borderColor: overdue ? 'rgba(180,83,9,0.45)' : 'divider',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    minWidth: 0,
                    bgcolor: overdue ? 'rgba(180,83,9,0.06)' : 'transparent',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      bgcolor: foreshadowStatusColor(f.status),
                      flexShrink: 0,
                    }}
                  />
                  <Box
                    component="span"
                    sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                  >
                    {f.title || t('writing.foreshadowUntitled')}
                  </Box>
                  {sortBy === 'payoff' ? (
                    <Box
                      component="span"
                      sx={{
                        color: 'text.disabled',
                        flexShrink: 0,
                        fontSize: 9.5,
                        maxWidth: 76,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {payoffCh?.title || t('writing.foreshadowNoChapter')}
                    </Box>
                  ) : (
                    line && (
                      <Box component="span" sx={{ color: 'text.disabled', flexShrink: 0, fontSize: 10 }}>
                        {line.name}
                      </Box>
                    )
                  )}
                  {overdue && (
                    <Box component="span" sx={{ color: '#b45309', flexShrink: 0 }}>
                      ⚠
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
          {unlinedCount > 0 && (
            <Typography variant="caption" color="text.disabled">
              {t('writing.foreshadowUnlined')} · {unlinedCount}
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid var(--template-palette-divider, rgba(128,128,128,0.35))',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  padding: '4px 6px',
  fontSize: 12,
  outline: 'none',
};

// ─── 详情 tab · 伏笔编辑器 ───
export function ForeshadowingDetail({ item, bookId }: { item: WritingForeshadowing; bookId: string | null }) {
  const chapters = useWritingStore((s) => s.chapters);
  const storylines = useWritingStore((s) => s.storylines);
  const updateForeshadowing = useWritingStore((s) => s.updateForeshadowing);
  const deleteForeshadowing = useWritingStore((s) => s.deleteForeshadowing);
  const selectForeshadowing = useEditorStore((s) => s.selectForeshadowing);
  const books = useWritingStore((s) => s.books);
  const genre = books.find((b) => b.id === bookId)?.genre ?? '';
  const jumpChapter = (chapterId: string) => {
    try {
      if (!bookId) return; // openChapterCarrierView 需要有效 bookId
      const ch = bookChapters.find((c) => c.id === chapterId);
      openChapterCarrierView(chapterId, ch?.title ?? '', genre, bookId);
    } catch (e) {
      console.warn('ForeshadowingDetail.jumpChapter failed', String(e));
    }
  };

  const bookChapters = useMemo(
    () => (bookId ? chapters.filter((c) => c.bookId === bookId).sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [chapters, bookId],
  );
  const overdue = isOverdue(item, chapters);
  const plant = item.plantChapterId ? bookChapters.find((c) => c.id === item.plantChapterId) : null;
  const payoff = item.payoffChapterId ? bookChapters.find((c) => c.id === item.payoffChapterId) : null;

  return (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25, overflowY: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            bgcolor: foreshadowStatusColor(item.status),
            flexShrink: 0,
          }}
        />
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}
          color="text.secondary"
        >
          {t('writing.foreshadowDetailTitle')}
        </Typography>
      </Box>
      {/* 跨章预警（advisory 软提示）：回收点已到/已过但仍是待回收 */}
      {overdue && (
        <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 700 }}>
          ⚠{' '}
          {t('writing.foreshadowOverdueHint', {
            plant: plant?.title ?? t('writingWorkbench.untitled'),
            payoff: payoff?.title ?? t('writingWorkbench.untitled'),
          })}
        </Typography>
      )}
      {/* 标题 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.foreshadowTitle')}
        </Typography>
        <DraftInput
          autoFocus
          entityKey={item.id}
          value={item.title}
          onCommit={(v) => updateForeshadowing(item.id, { title: v })}
          placeholder={t('writing.foreshadowTitlePh')}
          style={fieldStyle}
        />
      </Box>
      {/* 描述 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.foreshadowDesc')}
        </Typography>
        <DraftInput
          as="textarea"
          rows={3}
          entityKey={item.id}
          value={item.description}
          onCommit={(v) => updateForeshadowing(item.id, { description: v })}
          placeholder={t('writing.foreshadowDescPh')}
          style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.4 }}
        />
      </Box>
      {/* 状态三态 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.foreshadowStatus')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {FORESHADOW_STATUSES.map((st) => {
            const active = item.status === st;
            const color = foreshadowStatusColor(st);
            return (
              <Box
                key={st}
                component="button"
                type="button"
                onClick={() => void updateForeshadowing(item.id, { status: st })}
                sx={{
                  cursor: 'pointer',
                  fontSize: 11,
                  px: 1,
                  py: 0.25,
                  borderRadius: 2.5,
                  border: 1,
                  borderColor: active ? color : 'divider',
                  bgcolor: active ? `${color}1a` : 'transparent',
                  color: active ? color : 'text.secondary',
                }}
              >
                {t(foreshadowStatusLabelKey(st))}
              </Box>
            );
          })}
        </Box>
      </Box>
      {/* 埋设章 / 回收章 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.foreshadowPlantChapter')}
        </Typography>
        <ChapterPicker
          uniqueKey={item.id + '-plant'}
          chapters={bookChapters}
          onSelect={(v: string) => void updateForeshadowing(item.id, { plantChapterId: v })}
          width="100%"
          value={item.plantChapterId}
          onClear={() => void updateForeshadowing(item.id, { plantChapterId: null })}
        />
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.foreshadowPayoffChapter')}
        </Typography>
        <ChapterPicker
          uniqueKey={item.id + '-payoff'}
          chapters={bookChapters}
          onSelect={(v: string) => void updateForeshadowing(item.id, { payoffChapterId: v })}
          width="100%"
          value={item.payoffChapterId}
          onClear={() => void updateForeshadowing(item.id, { payoffChapterId: null })}
        />
      </Box>
      {/* 挂剧情线（可选、零强制） */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.timelineStoryline')}
        </Typography>
        <Box
          component="select"
          value={item.storylineId ?? ''}
          onChange={(e) => void updateForeshadowing(item.id, { storylineId: e.target.value || null })}
          style={{ ...fieldStyle, cursor: 'pointer' }}
        >
          <option value="">{t('writing.storylineUnlined')}</option>
          {storylines.map((sl) => (
            <option key={sl.id} value={sl.id}>
              {sl.name}
            </option>
          ))}
        </Box>
      </Box>
      {/* 牵涉人物（伏笔 P2 · 零模型派生）：埋设/回收两章出场节拍 cast 并集，
          advisory 展示；点 chip 选中该设定（右栏切设定详情）。无绑定章 → 派生引导。 */}
      <ForeshadowingCastSection item={item} bookId={bookId} />
      {/* 章跳转（G1 增强·正文 hover 预览）：悬停展示该章正文前 80 字摘要，不跳页回忆 */}
      {(plant || payoff) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {plant && (
            <Tooltip
              placement="top"
              arrow
              title={
                <Box sx={{ p: 0.5, maxWidth: 220 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#fff' }}>
                    {t('writing.foreshadowJumpPlant')}：{plant.title || t('writingWorkbench.untitled')}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', mt: 0.25, color: 'rgba(255,255,255,0.85)', fontSize: '11px' }}
                  >
                    {clipSummary(plant.content) || t('writing.emptyChapterTitle')}
                  </Typography>
                </Box>
              }
              slotProps={{
                tooltip: { sx: { bgcolor: 'rgba(15,23,42,0.92)', borderRadius: 1.5, maxWidth: 260 } },
              }}
            >
              <Box
                component="button"
                type="button"
                onClick={() => jumpChapter(plant.id)}
                title={t('writing.chapterTimelineOpen')}
                sx={{
                  cursor: 'pointer',
                  fontSize: 11,
                  px: 1,
                  py: 0.25,
                  borderRadius: 2.5,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'transparent',
                  color: 'text.secondary',
                  '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                }}
              >
                {t('writing.foreshadowJumpPlant')}：{plant.title || t('writingWorkbench.untitled')}
              </Box>
            </Tooltip>
          )}
          {payoff && (
            <Tooltip
              placement="top"
              arrow
              title={
                <Box sx={{ p: 0.5, maxWidth: 220 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#fff' }}>
                    {t('writing.foreshadowJumpPayoff')}：{payoff.title || t('writingWorkbench.untitled')}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', mt: 0.25, color: 'rgba(255,255,255,0.85)', fontSize: '11px' }}
                  >
                    {clipSummary(payoff.content) || t('writing.emptyChapterTitle')}
                  </Typography>
                </Box>
              }
              slotProps={{
                tooltip: { sx: { bgcolor: 'rgba(15,23,42,0.92)', borderRadius: 1.5, maxWidth: 260 } },
              }}
            >
              <Box
                component="button"
                type="button"
                onClick={() => jumpChapter(payoff.id)}
                title={t('writing.chapterTimelineOpen')}
                sx={{
                  cursor: 'pointer',
                  fontSize: 11,
                  px: 1,
                  py: 0.25,
                  borderRadius: 2.5,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'transparent',
                  color: 'text.secondary',
                  '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                }}
              >
                {t('writing.foreshadowJumpPayoff')}：{payoff.title || t('writingWorkbench.untitled')}
              </Box>
            </Tooltip>
          )}
        </Box>
      )}
      {/* 删除 */}
      <Typography
        variant="caption"
        onClick={() => {
          selectForeshadowing(null);
          void deleteForeshadowing(item.id);
        }}
        title={t('writing.foreshadowDelete')}
        sx={{ cursor: 'pointer', color: 'text.disabled', '&:hover': { color: 'error.main' }, mt: 0.5 }}
      >
        {t('writing.foreshadowDelete')}
      </Typography>
    </Box>
  );
}
