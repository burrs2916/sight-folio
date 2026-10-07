// 灵感右侧栏面板（对标 ForeshadowingPanels 范式，2026-09-18）：
//
// InspirationOverviewCard —— 右栏「要素」tab · 灵感激活时的总览卡：
//   念头池统计（待分发/已入时间线/已入伏笔，统计行可点跳对应页签）+ 每条念头可点行。
// InspirationDetail —— 右栏「详情」tab · 选中念头的编辑与分发器：
//   分发三动作（⇢转时间线草稿·可选挂线 / 挂章转正 / ⇢转伏笔草稿）
//   + 出场人物/关联场景挂载 chips（与大纲 BeatRow 同一数据通道：beat.extra.cast/scenes，
//     写口径收拢 utils/writingOutline.toggleBeatMount，禁写第二份）
//   + 标题 / 展开 / 删除。
// 数据口径 = loose beats（未落章 beat，utils/writingOutline.looseBeats）——零新表，
// 与大纲页签「记个念头」/散文 IdeasPane 同池不分裂；分发查重复用
// utils/writingTimeline（beatEventText/beatImported）与 utils/writingInspiration。
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useWritingStore } from '../../store/writingStore';
import { useEditorStore } from '../../store/editorStore';
import type { WritingOutline } from '../../services/tauri';
import { looseBeats, parseBeatExtra, toggleBeatMount } from '../../utils/writingOutline';
import { beatEventText, beatImported } from '../../utils/writingTimeline';
import {
  foreshadowingFromBeat,
  beatPlantedAsForeshadowing,
  inspirationStateColor,
  inspirationStateOf,
} from '../../utils/writingInspiration';
import { openTypedCarrierView } from '../../utils/studioBook';
import { clipSummary } from '../../utils/writingSearch';
import { t } from '../../i18n';
import { DraftInput } from '../components/DraftInput';
import ChapterPicker from '../renderers/ChapterPicker';

// ─── 要素 tab · 灵感总览卡 ───
export function InspirationOverviewCard() {
  const outlines = useWritingStore((s) => s.outlines);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const books = useWritingStore((s) => s.books);
  const activeBookId = useWritingStore((s) => s.activeBookId);
  const createOutline = useWritingStore((s) => s.createOutline);
  const selectInspiration = useEditorStore((s) => s.selectInspiration);

  const loose = useMemo(() => looseBeats(outlines), [outlines]);
  const inTimelineCount = useMemo(
    () => loose.filter((b) => beatImported(timelineEvents, beatEventText(b))).length,
    [loose, timelineEvents],
  );
  const inForeshadowCount = useMemo(
    () => loose.filter((b) => beatPlantedAsForeshadowing(foreshadowings, b)).length,
    [loose, foreshadowings],
  );
  const genre = books.find((b) => b.id === activeBookId)?.genre ?? '';
  // 反向出口（联动刀三）：统计行可点——直接跳到分发去向页签，分发结果一眼可达。
  const jumpTo = (kind: 'timeline' | 'foreshadowing') => {
    try {
      if (genre) openTypedCarrierView(genre, kind);
    } catch (e) {
      console.warn('InspirationOverviewCard.jumpTo failed', String(e));
    }
  };

  const handleCreate = async () => {
    const item = await createOutline(t('writingDesign.captureIdea'));
    if (item) useEditorStore.getState().selectInspiration(item.id);
  };

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
          {t('writing.viewKind.inspiration')} · {loose.length}
        </Typography>
        <Typography
          variant="caption"
          onClick={() => void handleCreate()}
          title={t('writingDesign.captureIdea')}
          sx={{ cursor: 'pointer', color: 'primary.main', fontWeight: 700, '&:hover': { textDecoration: 'underline' } }}
        >
          ＋ {t('writingDesign.captureIdea')}
        </Typography>
      </Box>
      {loose.length === 0 ? (
        <Typography variant="caption" color="text.disabled">
          {t('writing.inspirationEmptyHint')}
        </Typography>
      ) : (
        <>
          <Typography
            variant="caption"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}
            color="text.secondary"
          >
            <Box
              component="span"
              onClick={() => jumpTo('timeline')}
              title={t('writing.inspirationOverviewJump')}
              sx={{
                cursor: inTimelineCount > 0 ? 'pointer' : 'default',
                '&:hover': inTimelineCount > 0 ? { color: 'text.primary' } : {},
              }}
            >
              {t('writing.inspirationStatTimeline', { n: inTimelineCount })}
            </Box>
            {' · '}
            <Box
              component="span"
              onClick={() => jumpTo('foreshadowing')}
              title={t('writing.inspirationOverviewJump')}
              sx={{
                cursor: inForeshadowCount > 0 ? 'pointer' : 'default',
                '&:hover': inForeshadowCount > 0 ? { color: 'text.primary' } : {},
              }}
            >
              {t('writing.inspirationStatForeshadow', { n: inForeshadowCount })}
            </Box>
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {loose.map((b) => {
              const state = inspirationStateOf(b, timelineEvents, foreshadowings);
              const stateColor = inspirationStateColor(state);
              return (
                <Box
                  key={b.id}
                  onClick={() => selectInspiration(b.id)}
                  title={b.summary && b.summary.trim() ? clipSummary(b.summary, 80) : t('writing.inspirationSelect')}
                  sx={{
                    cursor: 'pointer',
                    fontSize: 11.5,
                    p: '3px 6px',
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'divider',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    minWidth: 0,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box component="span" sx={{ color: 'primary.main', flexShrink: 0, fontSize: 10 }}>
                    ◆
                  </Box>
                  <Box
                    component="span"
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      color: state === 'dispatched' ? 'text.disabled' : 'text.primary',
                    }}
                  >
                    {b.title || b.summary || t('writing.inspirationUntitled')}
                  </Box>
                  <Box
                    component="span"
                    sx={{
                      fontSize: 9,
                      lineHeight: 1,
                      px: 0.75,
                      py: 0.35,
                      borderRadius: 999,
                      border: 1,
                      borderColor: `${stateColor}66`,
                      color: stateColor,
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t(
                      state === 'draft'
                        ? 'writing.inspirationStateDraft'
                        : state === 'refined'
                          ? 'writing.inspirationStateRefined'
                          : 'writing.inspirationStateDispatched',
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </>
      )}
    </Box>
  );
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid rgba(128,128,128,0.35)',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  padding: '4px 6px',
  fontSize: 12,
  outline: 'none',
};

const dispatchBtnSx = {
  cursor: 'pointer',
  fontSize: 11,
  px: 1,
  py: 0.25,
  borderRadius: 2.5,
  border: 1,
  borderColor: 'divider',
  bgcolor: 'transparent',
  color: 'text.secondary',
  '&:hover:not(:disabled)': { bgcolor: 'action.hover', color: 'text.primary' },
} as const;

// 挂载 chip（人物紫 / 场景灰，与大纲 BeatRow 的 tagStyle 色一致；字面 rgba——CV.* 是 var() 禁拼 alpha）
const CAST_COLOR = '#4A338F';
const SCENE_COLOR = '#64748b';
const mountChipSx = (active: boolean, color: string, bg: string) =>
  ({
    fontSize: 10,
    lineHeight: 1.2,
    px: 0.75,
    py: 0.4,
    borderRadius: 999,
    cursor: 'pointer',
    flexShrink: 0,
    border: 1,
    borderColor: active ? color : 'divider',
    bgcolor: active ? bg : 'transparent',
    color: active ? color : 'text.secondary',
    whiteSpace: 'nowrap',
  }) as const;

// ─── 详情 tab · 念头编辑与分发器 ───
export function InspirationDetail({ beat }: { beat: WritingOutline }) {
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const chapters = useWritingStore((s) => s.chapters);
  const settings = useWritingStore((s) => s.settings);
  const storylines = useWritingStore((s) => s.storylines);
  const loadStorylines = useWritingStore((s) => s.loadStorylines);
  const updateOutline = useWritingStore((s) => s.updateOutline);
  const deleteOutline = useWritingStore((s) => s.deleteOutline);
  const createTimelineEvent = useWritingStore((s) => s.createTimelineEvent);
  const createForeshadowing = useWritingStore((s) => s.createForeshadowing);
  const updateForeshadowing = useWritingStore((s) => s.updateForeshadowing);
  const selectInspiration = useEditorStore((s) => s.selectInspiration);
  // 转时间线时可选挂线（联动刀二）：转完即挂线，剧情线轴/线轨/章联动全自动接上。
  const [tlLineId, setTlLineId] = useState('');

  useEffect(() => {
    const ws = useWritingStore.getState();
    if (ws.activeBookId && ws.storylines.length === 0) void ws.loadStorylines().catch(() => {});
  }, [loadStorylines]);

  const characters = useMemo(() => settings.filter((s) => s.kind === 'character'), [settings]);
  const scenes = useMemo(() => settings.filter((s) => s.kind === 'worldbuilding'), [settings]);
  const extra = useMemo(() => parseBeatExtra(beat.extra), [beat.extra]);

  const beatText = beatEventText(beat);
  const inTimeline = beatImported(timelineEvents, beatText);
  const fsDraft = foreshadowingFromBeat(beat);
  const inForeshadow = beatPlantedAsForeshadowing(foreshadowings, beat);
  const state = inspirationStateOf(beat, timelineEvents, foreshadowings);
  const stateColor = inspirationStateColor(state);
  const bookChapters = useMemo(() => [...chapters].sort((a, b) => a.sortOrder - b.sortOrder), [chapters]);

  const toTimeline = () => {
    if (!inTimeline && beatText) {
      void createTimelineEvent({
        chapterId: beat.chapterId,
        settingId: null,
        at: '',
        event: beatText,
        storylineId: tlLineId || null,
      });
    }
  };
  const toForeshadow = async () => {
    if (inForeshadow || !fsDraft.title) return;
    const item = await createForeshadowing(fsDraft.title);
    if (item && fsDraft.description) await updateForeshadowing(item.id, { description: fsDraft.description });
  };
  // 挂章 = 转正：beat 落进该章大纲、离开念头池 → 选中态一并清掉（分发即归位）。
  const bindChapter = (chapterId: string) => {
    void updateOutline(beat.id, { chapterId });
    if (chapterId) selectInspiration(null);
  };
  // 挂载 toggle：写口径收拢 utils/writingOutline.toggleBeatMount（与大纲 BeatRow 同一份）
  const toggleMount = (key: 'cast' | 'scenes', settingId: string) => {
    void updateOutline(beat.id, { extra: toggleBeatMount(beat.extra, key, settingId) });
  };

  const mountRow = (
    label: string,
    list: { id: string; name: string }[],
    key: 'cast' | 'scenes',
    color: string,
    bg: string,
  ) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
      <Typography variant="caption" sx={{ flexShrink: 0 }} color="text.secondary">
        {label}
      </Typography>
      {list.length === 0 && (
        <Typography variant="caption" color="text.disabled">
          {t('writingDesign.mountEmpty')}
        </Typography>
      )}
      {list.map((s) => (
        <Box
          key={s.id}
          component="span"
          onClick={() => toggleMount(key, s.id)}
          title={t('writing.inspirationMountToggle')}
          sx={mountChipSx((extra[key] ?? []).includes(s.id), color, bg)}
        >
          {s.name}
        </Box>
      ))}
    </Box>
  );

  return (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25, overflowY: 'auto' }}>
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
        title={beat.summary && beat.summary.trim() ? clipSummary(beat.summary, 80) : undefined}
      >
        <Box component="span" sx={{ color: 'primary.main', fontSize: 10 }}>
          ◆
        </Box>
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}
          color="text.secondary"
        >
          {t('writing.inspirationDetailTitle')}
        </Typography>
        {/* 轻量状态维度（草稿/已完善/已分发）：一眼看出还差哪步，替代单纯 ✓/✦ */}
        <Box
          component="span"
          title={
            state === 'draft'
              ? t('writing.inspirationStateDraftHint')
              : state === 'refined'
                ? t('writing.inspirationStateRefinedHint')
                : t('writing.inspirationStateDispatchedHint')
          }
          sx={{
            fontSize: 9,
            lineHeight: 1,
            px: 0.75,
            py: 0.35,
            borderRadius: 999,
            border: 1,
            borderColor: `${stateColor}66`,
            color: stateColor,
            flexShrink: 0,
            whiteSpace: 'nowrap',
            ml: 1,
          }}
        >
          {t(
            state === 'draft'
              ? 'writing.inspirationStateDraft'
              : state === 'refined'
                ? 'writing.inspirationStateRefined'
                : 'writing.inspirationStateDispatched',
          )}
        </Box>
      </Box>
      {/* 分发区：⇢转时间线（可选挂线）/ ⇢转伏笔——分发不是删除，转完念头保留在池里（advisory） */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
        <Box
          component="button"
          type="button"
          onClick={toTimeline}
          disabled={inTimeline || !beatText}
          title={
            inTimeline
              ? t('writing.inspirationToTimelineDone')
              : beatText
                ? t('writing.inspirationToTimeline')
                : t('writing.inspirationToEmpty')
          }
          sx={{
            ...dispatchBtnSx,
            opacity: inTimeline || !beatText ? 0.55 : 1,
            cursor: inTimeline || !beatText ? 'default' : 'pointer',
          }}
        >
          {inTimeline ? `✓ ${t('writing.inspirationToTimelineDone')}` : `⇢ ${t('writing.inspirationToTimeline')}`}
        </Box>
        <Box
          component="button"
          type="button"
          onClick={() => void toForeshadow()}
          disabled={inForeshadow || !fsDraft.title}
          title={
            inForeshadow
              ? t('writing.inspirationToForeshadowDone')
              : fsDraft.title
                ? t('writing.inspirationToForeshadow')
                : t('writing.inspirationToEmpty')
          }
          sx={{
            ...dispatchBtnSx,
            opacity: inForeshadow || !fsDraft.title ? 0.55 : 1,
            cursor: inForeshadow || !fsDraft.title ? 'default' : 'pointer',
          }}
        >
          {inForeshadow ? `✓ ${t('writing.inspirationToForeshadowDone')}` : `⇢ ${t('writing.inspirationToForeshadow')}`}
        </Box>
      </Box>
      {/* 转时间线时可选挂线（联动刀二）：createTimelineEvent({ storylineId })，转完即挂线 */}
      {!inTimeline && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography variant="caption" sx={{ flexShrink: 0 }} color="text.secondary">
            {t('writing.inspirationTimelineLine')}
          </Typography>
          <Box
            component="select"
            value={tlLineId}
            onChange={(e) => setTlLineId(e.target.value)}
            style={{ ...fieldStyle, width: 'auto', flex: 1, cursor: 'pointer', padding: '2px 4px', fontSize: 11 }}
          >
            <option value="">{t('writing.inspirationTimelineNoLine')}</option>
            {storylines.map((sl) => (
              <option key={sl.id} value={sl.id}>
                {sl.name}
              </option>
            ))}
          </Box>
        </Box>
      )}
      <Typography variant="caption" color="text.disabled">
        {t('writing.inspirationBindHint')}
      </Typography>
      {/* 挂章（转正）：挂上即离开念头池 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.inspirationBindChapter')}
        </Typography>
        <ChapterPicker
          uniqueKey={beat.id}
          chapters={bookChapters}
          accent="#1976d2"
          onSelect={(v: string) => bindChapter(v)}
          width="100%"
          value={beat.chapterId}
          onClear={() => bindChapter('')}
        />
      </Box>
      {/* 挂载（联动刀一）：出场人物 / 关联场景——与大纲 BeatRow 同一数据通道（beat.extra），挂了即可在人物/世界观右栏「相关念头」看到 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {mountRow(
          t('writingDesign.mountCast'),
          characters.map((c) => ({ id: c.id, name: c.name })),
          'cast',
          CAST_COLOR,
          'rgba(74,51,143,0.12)',
        )}
        {mountRow(
          t('writingDesign.mountScenes'),
          scenes.map((sc) => ({ id: sc.id, name: sc.name })),
          'scenes',
          SCENE_COLOR,
          'rgba(100,116,139,0.12)',
        )}
      </Box>
      {/* 标题 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.inspirationTitle')}
        </Typography>
        <DraftInput
          autoFocus
          entityKey={beat.id}
          value={beat.title}
          onCommit={(v) => updateOutline(beat.id, { title: v })}
          placeholder={t('writing.inspirationTitlePh')}
          style={fieldStyle}
        />
      </Box>
      {/* 展开 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.inspirationSummary')}
        </Typography>
        <DraftInput
          as="textarea"
          rows={4}
          entityKey={beat.id}
          value={beat.summary}
          onCommit={(v) => updateOutline(beat.id, { summary: v })}
          placeholder={t('writing.inspirationSummaryPh')}
          style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.4 }}
        />
      </Box>
      {/* 删除 */}
      <Typography
        variant="caption"
        onClick={() => {
          selectInspiration(null);
          void deleteOutline(beat.id);
        }}
        title={t('writing.inspirationDelete')}
        sx={{ cursor: 'pointer', color: 'text.disabled', '&:hover': { color: 'error.main' }, mt: 0.5 }}
      >
        {t('writing.inspirationDelete')}
      </Typography>
    </Box>
  );
}
