// 时间线右侧栏面板（Direction A：右栏接事件编辑，2026-09-18）
//
// TimelineOverviewPanel —— 右栏「要素」tab · 时间线激活时的总览卡：
//   事件数 / 完整·待补全 / 锚定覆盖 / 冲突计数；待补全与冲突事件可直接点选进「详情」编辑。
// TimelineEventDetail —— 右栏「详情」tab · 选中事件的完整编辑器：
//   at / event / 绑章 / 来源设定 / 跳章跳设定 / 删除。
// 算法全部复用 utils/writingTimeline（与主视图同一份，禁止再写第二份）。
// 冲突计数取两种视图（全书/按章）检测的并集：advisory 软提示只报数，
// 逐事件标记仍归主视图按其当前视图口径。
import { useEffect, useMemo, useState } from 'react';
import { openWritingDesk } from '../../utils/writingDeskWindow';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useWritingStore } from '../../store/writingStore';
import { useEditorStore } from '../../store/editorStore';
import type { WritingChapter, WritingStoryline, WritingTimelineEvent } from '../../services/tauri';
import { openChapterCarrierView, openTypedCarrierView } from '../../utils/studioBook';
import { LANE_COLORS, hashStr, buildStorylineChapterMatrix } from '../../utils/writingTimeline';
import {
  foreshadowingsOfLine,
  sortForeshadowings,
  isOverdue,
  foreshadowStatusColor,
} from '../../utils/writingForeshadowing';
import { isComplete, computeCoverage, computeTimelineConflicts, compareByAt } from '../../utils/writingTimeline';
import { t } from '../../i18n';
import { DraftInput } from '../components/DraftInput';
import ChapterPicker from '../renderers/ChapterPicker';
import EntityPicker from '../renderers/EntityPicker';

const WARN = '#b45309'; // 琥珀（与主视图 CV.warning 同族；本文件不依赖 canvasTheme）

function unionConflictIds(events: WritingTimelineEvent[], chapters: WritingChapter[]): Set<string> {
  return new Set([
    ...computeTimelineConflicts(events, { view: 'book' }),
    ...computeTimelineConflicts(events, { view: 'chapter', chapters }),
  ]);
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

function StatRow({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 700, color: warn ? WARN : 'text.primary' }}>
        {value}
      </Typography>
    </Box>
  );
}

// ─── 右栏未挂线事件列表（含搜索过滤 + 快捷挂线选择器）───
function StorylineUnlinedList({
  timelineEvents,
  storylines,
  selectTimelineEvent,
  updateTimelineEvent,
}: {
  timelineEvents: WritingTimelineEvent[];
  storylines: WritingStoryline[];
  selectTimelineEvent: (id: string) => void;
  updateTimelineEvent: (id: string, patch: Partial<WritingTimelineEvent>) => Promise<void>;
}) {
  const [unlinedQuery, setUnlinedQuery] = useState('');
  const unlined = useMemo(() => timelineEvents.filter((e) => !e.storylineId), [timelineEvents]);
  const filteredUnlined = useMemo(() => {
    if (!unlinedQuery.trim()) return unlined;
    const q = unlinedQuery.toLowerCase();
    return unlined.filter(
      (ev) => (ev.event ?? '').toLowerCase().includes(q) || (ev.at ?? '').toLowerCase().includes(q),
    );
  }, [unlined, unlinedQuery]);

  if (unlined.length === 0) {
    return (
      <Typography variant="caption" color="text.disabled">
        {t('writing.storylineUnlined')} · 0
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="caption" color="text.disabled">
          {t('writing.storylineUnlined')} · {unlined.length}
        </Typography>
        <input
          type="text"
          value={unlinedQuery}
          onChange={(e) => setUnlinedQuery(e.target.value)}
          placeholder={t('writing.timelineSearchPlaceholder')}
          style={{
            fontSize: 10,
            padding: '2px 6px',
            border: '1px solid rgba(128,128,128,0.35)',
            borderRadius: 5,
            background: 'transparent',
            color: 'inherit',
            outline: 'none',
            width: 90,
            flexShrink: 0,
          }}
        />
      </Box>
      {filteredUnlined.length === 0 && unlinedQuery.trim() ? (
        <Typography variant="caption" color="text.disabled">
          {t('writing.timelineSearchNoHits')}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, maxHeight: 168, overflowY: 'auto' }}>
          {filteredUnlined.map((ev) => (
            <Box key={ev.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <Typography
                variant="caption"
                onClick={() => selectTimelineEvent(ev.id)}
                title={t('writing.timelineDetailEmpty')}
                sx={{
                  cursor: 'pointer',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  minWidth: 0,
                  '&:hover': { color: 'text.primary' },
                }}
              >
                {ev.at ? `${ev.at} · ` : ''}
                {ev.event || t('writing.timelineIncomplete')}
              </Typography>
              <EntityPicker
                uniqueKey={ev.id + '-sl'}
                items={storylines.map((sl) => ({ id: sl.id, name: sl.name }))}
                placeholder={t('writing.storylineUnlined')}
                onSelect={(v: string) => void updateTimelineEvent(ev.id, { storylineId: v })}
                compact
                width={96}
                value={ev.storylineId}
                onClear={() => void updateTimelineEvent(ev.id, { storylineId: null })}
              />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ─── 要素 tab · 剧情线卡（P1 右栏）：线实体一览 + 挂线率，点行进线详情 ───
function StorylineOverviewCard() {
  const storylines = useWritingStore((s) => s.storylines);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const loadStorylines = useWritingStore((s) => s.loadStorylines);
  const createStoryline = useWritingStore((s) => s.createStoryline);
  const updateTimelineEvent = useWritingStore((s) => s.updateTimelineEvent);
  const selectStoryline = useEditorStore((s) => s.selectStoryline);
  const selectTimelineEvent = useEditorStore((s) => s.selectTimelineEvent);
  useEffect(() => {
    const ws = useWritingStore.getState();
    if (ws.activeBookId && ws.storylines.length === 0) void ws.loadStorylines().catch(() => {});
  }, [loadStorylines]);
  const linedCount = useMemo(() => timelineEvents.filter((e) => e.storylineId).length, [timelineEvents]);
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
          {t('writing.timelineViewStoryline')} · {storylines.length}
        </Typography>
        <Typography
          variant="caption"
          onClick={() => void createStoryline(t('writing.storylineDefaultName', { n: storylines.length + 1 }))}
          title={t('writing.storylineCreate')}
          sx={{ cursor: 'pointer', color: 'primary.main', fontWeight: 700, '&:hover': { textDecoration: 'underline' } }}
        >
          ＋ {t('writing.storylineCreate')}
        </Typography>
      </Box>
      {storylines.length === 0 ? (
        <Typography variant="caption" color="text.disabled">
          {t('writing.storylineEmptyHint')}
        </Typography>
      ) : (
        <>
          <StatRow
            label={t('writing.storylineCoverage', { a: linedCount, t: timelineEvents.length })}
            value={`${timelineEvents.length ? Math.round((linedCount / timelineEvents.length) * 100) : 0}%`}
          />
          <Box sx={{ height: 4, borderRadius: 2, bgcolor: 'action.hover', overflow: 'hidden' }}>
            <Box
              sx={{
                height: '100%',
                width: `${timelineEvents.length ? Math.round((linedCount / timelineEvents.length) * 100) : 0}%`,
                bgcolor: 'secondary.main',
                transition: 'width 120ms',
              }}
            />
          </Box>
          {storylines.map((sl) => {
            const color = sl.color || LANE_COLORS[hashStr(sl.id) % LANE_COLORS.length];
            const n = timelineEvents.filter((e) => e.storylineId === sl.id).length;
            return (
              <Box
                key={sl.id}
                onClick={() => selectStoryline(sl.id)}
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
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
                <Box
                  component="span"
                  sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                >
                  {sl.name}
                </Box>
                <Box component="span" sx={{ color: 'text.disabled', flexShrink: 0 }}>
                  {t('editor.writing.timelineEventCount', { n })}
                </Box>
              </Box>
            );
          })}
          <StorylineUnlinedList
            timelineEvents={timelineEvents}
            storylines={storylines}
            selectTimelineEvent={selectTimelineEvent}
            updateTimelineEvent={updateTimelineEvent}
          />
        </>
      )}
    </Box>
  );
}

// ─── 要素 tab · 时间线总览卡 ───
export function TimelineOverviewPanel({ bookId }: { bookId: string | null }) {
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const chapters = useWritingStore((s) => s.chapters);
  const loadTimelineEvents = useWritingStore((s) => s.loadTimelineEvents);
  const loadChapters = useWritingStore((s) => s.loadChapters);
  const loadSettings = useWritingStore((s) => s.loadSettings);
  const loadStorylines = useWritingStore((s) => s.loadStorylines);

  // 数据可能尚未 load（右栏不经过主 pane 的 mount effect）：按书补齐。
  useEffect(() => {
    if (!bookId) return;
    const ws = useWritingStore.getState();
    if (ws.timelineEvents.length === 0) void ws.loadTimelineEvents().catch(() => {});
    if (ws.settings.length === 0) void ws.loadSettings().catch(() => {});
    if (!ws.chapters.some((c) => c.bookId === bookId)) void ws.loadChapters(bookId).catch(() => {});
    if (ws.storylines.length === 0) void ws.loadStorylines().catch(() => {});
  }, [bookId, loadTimelineEvents, loadSettings, loadChapters, loadStorylines]);

  const bookChapters = useMemo(
    () => (bookId ? chapters.filter((c) => c.bookId === bookId).sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [chapters, bookId],
  );
  const completeEvents = useMemo(() => timelineEvents.filter(isComplete), [timelineEvents]);
  const incompleteEvents = useMemo(() => timelineEvents.filter((e) => !isComplete(e)), [timelineEvents]);
  const coverage = useMemo(() => computeCoverage(bookChapters, completeEvents), [bookChapters, completeEvents]);
  // 冲突按两视图分别计算：总数取并集（advisory 软提示只报数）；
  // 行点选时按「哪个视图口径能呈现该冲突」自动切换主 pane 的轴模式（P1-A）。
  const bookConflictIds = useMemo(() => computeTimelineConflicts(timelineEvents, { view: 'book' }), [timelineEvents]);
  const chapterConflictIds = useMemo(
    () => computeTimelineConflicts(timelineEvents, { view: 'chapter', chapters: bookChapters }),
    [timelineEvents, bookChapters],
  );
  const conflictIds = useMemo(
    () => new Set([...bookConflictIds, ...chapterConflictIds]),
    [bookConflictIds, chapterConflictIds],
  );

  const selectEvent = (id: string) => useEditorStore.getState().selectTimelineEvent(id);

  // 冲突行点选：若当前主 pane 口径看不见该冲突（如跨章倒挂只在按章轴），先切口径再选中。
  const selectConflict = (id: string) => {
    const cur = useEditorStore.getState().timelineViewMode;
    const target =
      cur === 'book' ? (bookConflictIds.has(id) ? 'book' : 'chapter') : chapterConflictIds.has(id) ? 'chapter' : 'book';
    if (target !== cur) useEditorStore.getState().setTimelineViewMode(target);
    selectEvent(id);
  };

  return (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25, overflowY: 'auto' }}>
      <Typography
        variant="caption"
        sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}
        color="text.secondary"
      >
        {t('writing.timelineOverview')}
      </Typography>
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
        <StatRow label={t('editor.writing.timelineEventCount', { n: timelineEvents.length })} value="" />
        <StatRow label={t('writing.timelineStatComplete')} value={completeEvents.length} />
        <StatRow
          label={t('writing.timelineIncomplete')}
          value={incompleteEvents.length}
          warn={incompleteEvents.length > 0}
        />
        <StatRow
          label={t('writing.timelineCoverage', { a: coverage.anchoredChapterCount, t: coverage.totalChapters })}
          value={`${coverage.totalChapters ? Math.round((coverage.anchoredChapterCount / coverage.totalChapters) * 100) : 0}%`}
        />
        <Box sx={{ height: 4, borderRadius: 2, bgcolor: 'action.hover', overflow: 'hidden' }}>
          <Box
            sx={{
              height: '100%',
              width: `${coverage.totalChapters ? Math.round((coverage.anchoredChapterCount / coverage.totalChapters) * 100) : 0}%`,
              bgcolor: 'primary.main',
              transition: 'width 120ms',
            }}
          />
        </Box>
        <StatRow label={t('writing.timelineStatConflict')} value={conflictIds.size} warn={conflictIds.size > 0} />
        {conflictIds.size > 0 && (
          <Typography variant="caption" sx={{ color: WARN }}>
            ⚠ {t('writing.timelineConflictHint')}
          </Typography>
        )}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t('writing.timelineOverviewHint')}
      </Typography>
      {/* 剧情线卡（P1 右栏）：线数/挂线率/未挂线 + 每线一行点选进详情 */}
      <StorylineOverviewCard />
      {conflictIds.size > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: WARN }}>
            ⚠ {t('writing.timelineConflict')}
          </Typography>
          {timelineEvents
            .filter((e) => conflictIds.has(e.id))
            .map((ev) => (
              <Box
                key={ev.id}
                onClick={() => selectConflict(ev.id)}
                sx={{
                  cursor: 'pointer',
                  fontSize: 11.5,
                  p: '3px 6px',
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                {ev.at ? `${ev.at} · ` : ''}
                {ev.event || t('writingWorkbench.untitled')}
              </Box>
            ))}
        </Box>
      )}
      {incompleteEvents.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: WARN }}>
            {t('writing.timelineIncomplete')}
          </Typography>
          {incompleteEvents.map((ev) => (
            <Box
              key={ev.id}
              onClick={() => selectEvent(ev.id)}
              sx={{
                cursor: 'pointer',
                fontSize: 11.5,
                p: '3px 6px',
                borderRadius: 1,
                border: 1,
                borderColor: 'divider',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              {ev.event || ev.at || t('writingWorkbench.untitled')}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ─── 详情 tab · 选中事件编辑器 ───
export function TimelineEventDetail({ event, bookId }: { event: WritingTimelineEvent; bookId: string | null }) {
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const storylines = useWritingStore((s) => s.storylines);
  const chapters = useWritingStore((s) => s.chapters);
  const settings = useWritingStore((s) => s.settings);
  const updateTimelineEvent = useWritingStore((s) => s.updateTimelineEvent);
  const updateOutline = useWritingStore((s) => s.updateOutline);
  const deleteTimelineEvent = useWritingStore((s) => s.deleteTimelineEvent);

  const bookChapters = useMemo(
    () => (bookId ? chapters.filter((c) => c.bookId === bookId).sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [chapters, bookId],
  );
  const bookSettings = useMemo(
    () => (bookId ? settings.filter((s) => s.bookId === bookId) : settings),
    [settings, bookId],
  );
  const isConflict = useMemo(
    () => unionConflictIds(timelineEvents, bookChapters).has(event.id),
    [timelineEvents, bookChapters, event.id],
  );

  const jump = () => {
    if (!bookId) return;
    if (event.chapterId) {
      const b = useWritingStore.getState().books.find((x) => x.id === bookId);
      openChapterCarrierView(event.chapterId, event.event || t('writingWorkbench.untitled'), b?.genre ?? '', bookId);
    } else if (event.settingId) {
      void openWritingDesk({ bookId, settingId: event.settingId });
    }
  };

  const canJump = !!(event.chapterId || event.settingId);

  return (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25, overflowY: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}
          color="text.secondary"
        >
          {t('writing.timelineDetailTitle')}
        </Typography>
        {isConflict && (
          <Typography variant="caption" title={t('writing.timelineConflictHint')} sx={{ color: WARN, fontWeight: 700 }}>
            ⚠ {t('writing.timelineConflict')}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.timelineAt')}
        </Typography>
        <DraftInput
          entityKey={event.id}
          value={event.at ?? ''}
          onCommit={(v) => updateTimelineEvent(event.id, { at: v })}
          placeholder={t('writing.timelineAtPh')}
          style={fieldStyle}
        />
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.timelineEvent')}
        </Typography>
        <DraftInput
          as="textarea"
          rows={4}
          entityKey={event.id}
          value={event.event ?? ''}
          onCommit={(v) => {
            updateTimelineEvent(event.id, { event: v });
            // 骨架关联同步（时间线→写作台）：如果该事件由 Beat 同步而来，反向同步 summary
            if (event.outlineId) {
              void updateOutline(event.outlineId, { summary: v });
            }
          }}
          placeholder={t('writing.timelineEventPh')}
          style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.4 }}
        />
      </Box>
      {bookChapters.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {t('writing.timelineChapter')}
          </Typography>
          <ChapterPicker
            uniqueKey={event.id}
            chapters={bookChapters}
            accent="#1976d2"
            onSelect={(chId: string) => void updateTimelineEvent(event.id, { chapterId: chId })}
            width="100%"
            value={event.chapterId}
            onClear={() => void updateTimelineEvent(event.id, { chapterId: null })}
          />
        </Box>
      )}
      {bookSettings.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {t('writing.timelineSource')}
          </Typography>
          <EntityPicker
            uniqueKey={event.id + '-setting'}
            items={bookSettings.map((s) => ({ id: s.id, name: s.name || t('writingWorkbench.untitled') }))}
            placeholder={t('writing.timelineBookLevel')}
            onSelect={(sid: string) => void updateTimelineEvent(event.id, { settingId: sid })}
            width="100%"
            value={event.settingId}
            onClear={() => void updateTimelineEvent(event.id, { settingId: null })}
          />
        </Box>
      )}
      {storylines.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {t('writing.timelineStoryline')}
          </Typography>
          <EntityPicker
            uniqueKey={event.id + '-storyline'}
            items={storylines.map((sl) => ({ id: sl.id, name: sl.name }))}
            placeholder={t('writing.storylineUnlined')}
            onSelect={(slId: string) => void updateTimelineEvent(event.id, { storylineId: slId })}
            width="100%"
            value={event.storylineId}
            onClear={() => void updateTimelineEvent(event.id, { storylineId: null })}
          />
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Box
          component="button"
          type="button"
          disabled={!canJump}
          onClick={jump}
          sx={{
            flex: 1,
            cursor: canJump ? 'pointer' : 'default',
            fontSize: 11.5,
            py: 0.5,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'transparent',
            color: canJump ? 'text.primary' : 'text.disabled',
            '&:hover': canJump ? { bgcolor: 'action.hover' } : {},
          }}
        >
          {event.chapterId
            ? t('writing.timelineJumpChapter')
            : event.settingId
              ? t('writingDesign.editProfile')
              : t('writing.timelineJump')}
        </Box>
        <Box
          component="button"
          type="button"
          onClick={() => {
            useEditorStore.getState().selectTimelineEvent(null);
            void deleteTimelineEvent(event.id);
          }}
          title={t('writing.timelineDeleteEvent')}
          sx={{
            cursor: 'pointer',
            fontSize: 11.5,
            px: 1.25,
            py: 0.5,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'transparent',
            color: 'error.main',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          ✕
        </Box>
      </Box>
    </Box>
  );
}

// ─── 详情 tab · 剧情线编辑器（P1 右栏）：选中线实体的名/色板/描述/线内事件 ───
export function StorylineDetail({
  storyline,
  bookId,
  onEventPick,
}: {
  storyline: WritingStoryline;
  bookId: string | null;
  /** 页签编辑面语境（StorylinesPane）内点事件行：就地接管，不触发全局互斥清线选中；右栏语境缺省＝切事件详情 */
  onEventPick?: (eventId: string) => void;
}) {
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const chapters = useWritingStore((s) => s.chapters);
  const settings = useWritingStore((s) => s.settings);
  const books = useWritingStore((s) => s.books);
  const updateStoryline = useWritingStore((s) => s.updateStoryline);
  const deleteStoryline = useWritingStore((s) => s.deleteStoryline);
  const selectTimelineEvent = useEditorStore((s) => s.selectTimelineEvent);
  const selectSetting = useEditorStore((s) => s.selectSetting);
  const selectStoryline = useEditorStore((s) => s.selectStoryline);

  const events = useMemo(
    () => timelineEvents.filter((e) => e.storylineId === storyline.id).sort((a, b) => compareByAt(a.at, b.at)),
    [timelineEvents, storyline.id],
  );

  // 剧情 P2-A · 本线伏笔（骨架互联补缺）：挂线伏笔按状态序（待回收前），点行跳伏笔页签
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const lineForeshadowings = useMemo(
    () => sortForeshadowings(foreshadowingsOfLine(storyline.id, foreshadowings), chapters),
    [storyline.id, foreshadowings, chapters],
  );

  // 联动派生（派生三刀·刀三）+ G1 章级直连：涉及章节 = 主线归属章（chapter.storylineId 直连，置顶）
  // ∪ 线内事件绑章（派生，去重）。主线章是「规划归属」，事件绑章是「实际出场」，两者互补一张清单。
  const lineChapters = useMemo(() => {
    const direct = chapters.filter((c) => c.storylineId === storyline.id).sort((a, b) => a.sortOrder - b.sortOrder);
    const directIds = new Set(direct.map((c) => c.id));
    const viaEvents = [...new Set(events.map((e) => e.chapterId).filter((v): v is string => !!v))]
      .map((id) => chapters.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c && !directIds.has(c.id));
    return [...direct, ...viaEvents];
  }, [events, chapters, storyline.id]);
  const lineSettings = useMemo(() => {
    const ids = [...new Set(events.map((e) => e.settingId).filter((v): v is string => !!v))];
    return ids.map((id) => settings.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
  }, [events, settings]);
  const genre = books.find((b) => b.id === bookId)?.genre ?? '';
  const openLineChapter = (chapterId: string) => {
    try {
      if (!bookId) return; // openChapterCarrierView 需要有效 bookId（ensureCarrierContainer 已加固早退 :323，此处守卫保留为双保险）
      const ch = chapters.find((c) => c.id === chapterId);
      openChapterCarrierView(chapterId, ch?.title ?? '', genre, bookId);
    } catch (e) {
      console.warn('StorylineDetail.openLineChapter failed', String(e));
    }
  };

  const color = storyline.color || LANE_COLORS[hashStr(storyline.id) % LANE_COLORS.length];

  const remove = async () => {
    // 删线不删事件（后端置 NULL）；先清选中再删，右栏回到时间线事件空态
    selectStoryline(null);
    await deleteStoryline(storyline.id);
  };

  const openLineOnTimeline = () => {
    const es = useEditorStore.getState();
    if (es.timelineViewMode !== 'storyline') es.setTimelineViewMode('storyline');
    // 页签编辑卡语境（本组件也被 StorylinesPane 复用）：确保真正跳到时间线视图
    try {
      const genre = books.find((b) => b.id === bookId)?.genre ?? '';
      openTypedCarrierView(genre, 'timeline');
    } catch (e) {
      console.warn('StorylineDetail.openLineOnTimeline failed', String(e));
    }
  };

  /** 点伏笔行 → 选中并跳伏笔页签（先选中再跳视图，与「相关伏笔」同款动线） */
  const openForeshadowing = (foreshadowingId: string) => {
    try {
      useEditorStore.getState().selectForeshadowing(foreshadowingId);
      openTypedCarrierView(genre, 'foreshadowing');
    } catch (e) {
      console.warn('StorylineDetail.openForeshadowing failed', String(e));
    }
  };

  return (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25, overflowY: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}
          color="text.secondary"
        >
          {t('writing.storylineDetailTitle')}
        </Typography>
        {/* 返回入口：清除剧情线选中，右栏回落该视图默认内容（大纲等其他视图的残留态退出详情） */}
        <Box
          component="button"
          type="button"
          onClick={() => selectStoryline(null)}
          title={t('writing.storylineDetailBack')}
          sx={{
            marginLeft: 'auto',
            cursor: 'pointer',
            fontSize: 11,
            py: 0.25,
            px: 0.75,
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'transparent',
            color: 'text.secondary',
            '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
          }}
        >
          ← {t('writing.storylineDetailBack')}
        </Box>
      </Box>
      {/* 线名（autoFocus：配合 key 重挂，新建/切线后直入改名，不打断创作者） */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.storylineName')}
        </Typography>
        <DraftInput
          autoFocus
          entityKey={storyline.id}
          value={storyline.name}
          onCommit={(v) => updateStoryline(storyline.id, { name: v })}
          style={fieldStyle}
        />
      </Box>
      {/* 颜色：预设十色板（与时间线轨道配色兜底同一份 LANE_COLORS） */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.storylineColor')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          {LANE_COLORS.map((c) => (
            <Box
              key={c}
              onClick={() => void updateStoryline(storyline.id, { color: c })}
              title={c}
              sx={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                bgcolor: c,
                cursor: 'pointer',
                outline: storyline.color === c ? `2px solid ${c}` : 'none',
                outlineOffset: 2,
              }}
            />
          ))}
        </Box>
      </Box>
      {/* 描述 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.storylineDesc')}
        </Typography>
        <DraftInput
          as="textarea"
          rows={3}
          entityKey={storyline.id}
          value={storyline.description ?? ''}
          onCommit={(v) => updateStoryline(storyline.id, { description: v })}
          placeholder={t('writing.storylineDescPh')}
          style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.4 }}
        />
      </Box>
      {/* 该线事件（点选进事件编辑器——互斥语义下右栏切到事件详情） */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" sx={{ fontWeight: 700 }} color="text.secondary">
            {t('editor.writing.timelineEventCount', { n: events.length })}
          </Typography>
          <Typography
            variant="caption"
            onClick={openLineOnTimeline}
            title={t('writing.chapterTimelineOpen')}
            sx={{ cursor: 'pointer', color: 'primary.main', '&:hover': { textDecoration: 'underline' } }}
          >
            {t('writing.chapterTimelineOpen')}
          </Typography>
        </Box>
        {events.length === 0 ? (
          <Typography variant="caption" color="text.disabled">
            {t('writing.storylineEmptyHint')}
          </Typography>
        ) : (
          events.map((ev) => {
            const evChapter = ev.chapterId ? chapters.find((c) => c.id === ev.chapterId) : null;
            const evSetting = ev.settingId ? settings.find((x) => x.id === ev.settingId) : null;
            const extra = evChapter || evSetting ? [evChapter?.title, evSetting?.name].filter(Boolean).join(' · ') : '';
            return (
              <Box
                key={ev.id}
                onClick={() => (onEventPick ? onEventPick(ev.id) : selectTimelineEvent(ev.id))}
                title={extra ? `${ev.at ?? ''} ${ev.event ?? ''}｜${extra}` : undefined}
                sx={{
                  cursor: 'pointer',
                  fontSize: 11.5,
                  p: '3px 6px',
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                {ev.at ? `${ev.at} · ` : ''}
                {ev.event || t('writing.timelineIncomplete')}
                {extra && <span style={{ color: 'rgba(128,128,128,0.7)', marginLeft: 4 }}>｜{extra}</span>}
              </Box>
            );
          })
        )}
      </Box>
      {/* 涉及章节（主线直连 ∪ 事件绑章派生）：主线章带「主归属」标识置顶，点行跳章 */}
      {lineChapters.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 700 }} color="text.secondary">
            {t('writing.storylineChapters')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {lineChapters.map((ch) => {
              const isDirect = ch.storylineId === storyline.id;
              return (
                <Box
                  key={ch.id}
                  component="button"
                  type="button"
                  onClick={() => openLineChapter(ch.id)}
                  title={
                    isDirect
                      ? `${t('writing.storylineLineMark')} · ${t('writing.timelineJumpChapter')}`
                      : t('writing.timelineJumpChapter')
                  }
                  sx={{
                    cursor: 'pointer',
                    fontSize: 11,
                    px: 1,
                    py: 0.25,
                    borderRadius: 2.5,
                    border: 1,
                    borderColor: isDirect ? color : 'divider',
                    bgcolor: isDirect ? `${color}14` : 'transparent',
                    color: 'text.secondary',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    maxWidth: 180,
                    '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                  }}
                >
                  {isDirect && (
                    <Box component="span" sx={{ fontSize: 9, color, fontWeight: 700, mr: 0.5, flexShrink: 0 }}>
                      ★
                    </Box>
                  )}
                  {ch.title || t('writingWorkbench.untitled')}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
      {/* 涉及人物/设定（联动派生）：线内事件来源设定去重，点行选中该设定（右栏切设定详情） */}
      {lineSettings.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 700 }} color="text.secondary">
            {t('writing.storylineCast')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {lineSettings.map((st) => (
              <Box
                key={st.id}
                component="button"
                type="button"
                onClick={() => selectSetting(st.id)}
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
                {st.name || t('writingWorkbench.untitled')}
              </Box>
            ))}
          </Box>
        </Box>
      )}
      {/* 本线伏笔（剧情 P2-A·骨架互联补缺）：挂线伏笔状态序（待回收前），点行跳伏笔页签。
          伏笔挂线（storylineId）与线视角此前断层——作者挂了承诺、线的视角却看不见。 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }} color="text.secondary">
          {t('writing.storylineForeshadows')} · {lineForeshadowings.length}
        </Typography>
        {lineForeshadowings.length === 0 ? (
          <Typography variant="caption" color="text.disabled">
            {t('writing.storylineForeshadowsEmpty')}
          </Typography>
        ) : (
          lineForeshadowings.map((f) => (
            <Box
              key={f.id}
              component="button"
              type="button"
              onClick={() => openForeshadowing(f.id)}
              title={t('writing.foreshadowDetailTitle')}
              sx={{
                cursor: 'pointer',
                fontSize: 11.5,
                p: '3px 6px',
                borderRadius: 1,
                border: 1,
                borderColor: 'divider',
                bgcolor: 'transparent',
                color: 'text.primary',
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                minWidth: 0,
                textAlign: 'left',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box
                sx={{
                  width: 7,
                  height: 7,
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
              {isOverdue(f, chapters) && (
                <Box component="span" sx={{ color: WARN, flexShrink: 0 }}>
                  ⚠
                </Box>
              )}
            </Box>
          ))
        )}
      </Box>
      {/* 删线（零强制：事件回「未挂线」） */}
      <Typography
        variant="caption"
        onClick={() => void remove()}
        title={t('writing.storylineDelete')}
        sx={{ cursor: 'pointer', color: 'text.disabled', '&:hover': { color: 'error.main' }, mt: 0.5 }}
      >
        {t('writing.storylineDelete')}
      </Typography>
    </Box>
  );
}

// ─── 剧情线 P2：线-事件叙事视角（2026-09-19 拍板 backlog） ───
//
// 单线纵向事件链：完整事件（at 齐备）按 at 排序在前、待补全草稿殿后（与本章时间线
// 同一 Intl.Collator 口径，禁止第二份）；相邻两个有绑章的完整事件章序跳跃 >1 时
// 插入「间隔 N 章」断档提示行；顶部统计行（事件 / 覆盖章 / 待补全）。
// **纯阅读视角**：点行跳时间线选中编辑，不新增编辑面（编辑面唯一铁律）；
// 数据全在事件三维交叉（storylineId×chapterId×settingId）派生，零新模型。
type NarrativeRow = { kind: 'event'; ev: WritingTimelineEvent } | { kind: 'gap'; count: number };

export function StorylineNarrativeView({ storyline, bookId }: { storyline: WritingStoryline; bookId: string | null }) {
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const chapters = useWritingStore((s) => s.chapters);
  const settings = useWritingStore((s) => s.settings);
  const books = useWritingStore((s) => s.books);
  const selectSetting = useEditorStore((s) => s.selectSetting);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const color = storyline.color || LANE_COLORS[hashStr(storyline.id) % LANE_COLORS.length];

  const events = useMemo(() => {
    const mine = timelineEvents.filter((e) => e.storylineId === storyline.id);
    return [...mine.filter(isComplete).sort((a, b) => compareByAt(a.at, b.at)), ...mine.filter((e) => !isComplete(e))];
  }, [timelineEvents, storyline.id]);

  const chapterOrder = useMemo(() => new Map(chapters.map((c) => [c.id, c.sortOrder])), [chapters]);
  const chapterTitle = useMemo(() => new Map(chapters.map((c) => [c.id, c.title])), [chapters]);

  // 事件行 + 断档行：相邻两个有绑章的完整事件，章序差 >1 → 中间插「间隔 N 章」
  const rows = useMemo<NarrativeRow[]>(() => {
    const out: NarrativeRow[] = [];
    let prevOrder: number | null = null;
    for (const ev of events) {
      if (isComplete(ev) && ev.chapterId) {
        const order = chapterOrder.get(ev.chapterId);
        if (order !== undefined) {
          if (prevOrder !== null && order - prevOrder > 1) out.push({ kind: 'gap', count: order - prevOrder - 1 });
          prevOrder = order;
        }
      }
      out.push({ kind: 'event', ev });
    }
    return out;
  }, [events, chapterOrder]);

  const stats = useMemo(() => {
    const coveredChapters = new Set(events.map((e) => e.chapterId).filter((v): v is string => !!v));
    return {
      total: events.length,
      covered: coveredChapters.size,
      drafts: events.filter((e) => !isComplete(e)).length,
      // 剧情 P2-A：本线伏笔计数（挂线承诺随线视角可见）
      fs: foreshadowings.filter((f) => f.storylineId === storyline.id).length,
    };
  }, [events, foreshadowings, storyline.id]);

  const genre = books.find((b) => b.id === bookId)?.genre ?? '';
  const jumpToTimeline = (eventId: string) => {
    try {
      const es = useEditorStore.getState();
      if (es.timelineViewMode !== 'storyline') es.setTimelineViewMode('storyline');
      es.selectTimelineEvent(eventId);
      openTypedCarrierView(genre, 'timeline');
    } catch (e) {
      console.warn('StorylineNarrativeView.jumpToTimeline failed', String(e));
    }
  };
  const openForeshadowing = (foreshadowingId: string) => {
    try {
      useEditorStore.getState().selectForeshadowing(foreshadowingId);
      openTypedCarrierView(genre, 'foreshadowing');
    } catch (e) {
      console.warn('StorylineNarrativeView.openForeshadowing failed', String(e));
    }
  };
  const jumpChapter = (chapterId: string) => {
    try {
      if (!bookId) return;
      const ch = chapters.find((c) => c.id === chapterId);
      openChapterCarrierView(chapterId, ch?.title ?? '', genre, bookId);
    } catch (e) {
      console.warn('StorylineNarrativeView.jumpChapter failed', String(e));
    }
  };

  return (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* 头部：线色点 + 线名 + 统计行 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 12.5 }} noWrap>
          {storyline.name || t('writingWorkbench.untitled')}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
        {t('editor.writing.timelineEventCount', { n: stats.total })} ·{' '}
        {t('writing.narrativeCoverage', { n: stats.covered })} · {t('writing.narrativeDrafts', { n: stats.drafts })} ·{' '}
        {stats.fs > 0 ? (
          <span
            onClick={() => {
              const first = foreshadowings.find((f) => f.storylineId === storyline.id);
              if (first) openForeshadowing(first.id);
            }}
            style={{ cursor: 'pointer', color: '#0f6e56' }}
            title={t('writing.storylineForeshadows')}
          >
            {t('writing.narrativeForeshadows', { n: stats.fs })}
          </span>
        ) : (
          t('writing.narrativeForeshadows', { n: stats.fs })
        )}
      </Typography>

      {events.length === 0 ? (
        <Typography variant="caption" color="text.disabled" sx={{ pt: 2 }}>
          {t('writing.narrativeEmpty')}
        </Typography>
      ) : (
        rows.map((row, i) =>
          row.kind === 'gap' ? (
            <Typography
              key={`gap-${i}`}
              variant="caption"
              sx={{ fontSize: 10, color: WARN, px: 1, py: 0.25, display: 'block' }}
            >
              {t('writing.narrativeGap', { n: row.count })}
            </Typography>
          ) : (
            <Box
              key={row.ev.id}
              onClick={() => jumpToTimeline(row.ev.id)}
              title={t('writing.chapterTimelineOpen')}
              sx={{
                cursor: 'pointer',
                p: '5px 8px',
                borderRadius: 1.5,
                border: 1,
                borderColor: 'divider',
                borderLeft: `3px solid ${color}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 0.25,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                <Box
                  component="span"
                  sx={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    px: 0.5,
                    borderRadius: 0.5,
                    flexShrink: 0,
                    bgcolor: isComplete(row.ev) ? 'rgba(139,92,246,0.10)' : 'rgba(180,83,9,0.12)',
                    color: isComplete(row.ev) ? 'text.secondary' : WARN,
                  }}
                >
                  {isComplete(row.ev) ? row.ev.at : t('writing.narrativeDraftTag')}
                </Box>
                {row.ev.chapterId && (
                  <Box
                    component="span"
                    onClick={(e) => {
                      e.stopPropagation();
                      jumpChapter(row.ev.chapterId!);
                    }}
                    title={t('writing.timelineJumpChapter')}
                    sx={{
                      fontSize: 9.5,
                      color: 'primary.main',
                      cursor: 'pointer',
                      flexShrink: 0,
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    {chapterTitle.get(row.ev.chapterId) || t('writingWorkbench.untitled')}
                  </Box>
                )}
              </Box>
              <Box sx={{ fontSize: 11.5, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {row.ev.event || t('writing.timelineIncomplete')}
              </Box>
              {row.ev.settingId && (
                <Box
                  component="span"
                  onClick={(e) => {
                    e.stopPropagation();
                    selectSetting(row.ev.settingId!);
                  }}
                  title={t('writingDesign.viewDetail')}
                  sx={{
                    fontSize: 9.5,
                    color: 'text.disabled',
                    cursor: 'pointer',
                    alignSelf: 'flex-start',
                    '&:hover': { color: 'text.secondary' },
                  }}
                >
                  ☺ {settings.find((x) => x.id === row.ev.settingId)?.name || row.ev.settingId}
                </Box>
              )}
            </Box>
          ),
        )
      )}
    </Box>
  );
}

// ─── 剧情 P2 · 线×章交织总览（2026-09-21）：StorylinesPane 第三视角（纯阅读，点格跳章） ───
//
// 行=剧情线（选中线高亮、其它线灰化对照）+ 未挂线行（非空才出现，置尾）；列=本书章（sortOrder 序）。
// 格内数字 = 该线绑章完整事件数，空格 = 该章该线没戏；行尾「未绑章」列只在该线有未绑事件时显数。
// 与已落地的单线纵向叙事视角（StorylineNarrativeView）互补：那边看一条线的叙事弧，
// 这边看所有线在章序列上的交织与空档。算法复用 utils/writingTimeline.buildStorylineChapterMatrix
// （同一份口径禁止第二份）；视角面板不做编辑（编辑面唯一铁律）。
export function StorylineMatrixView({ accent, bookId }: { accent: string; bookId: string | null }) {
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const storylines = useWritingStore((s) => s.storylines);
  const chapters = useWritingStore((s) => s.chapters);
  const books = useWritingStore((s) => s.books);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const selectedStorylineId = useEditorStore((s) => s.selectedStorylineId);

  const bookChapters = useMemo(
    () => (bookId ? chapters.filter((c) => c.bookId === bookId).sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [chapters, bookId],
  );
  const bookLines = useMemo(() => (bookId ? storylines.filter((l) => l.bookId === bookId) : []), [storylines, bookId]);
  const completeEvents = useMemo(
    () => (bookId ? timelineEvents.filter((e) => e.bookId === bookId).filter(isComplete) : []),
    [timelineEvents, bookId],
  );
  const matrix = useMemo(
    () => buildStorylineChapterMatrix(bookLines, completeEvents, bookChapters),
    [bookLines, completeEvents, bookChapters],
  );
  // 伏笔计数一次性分组（避免每行 filter O(行×伏笔)）
  const fsCountByLine = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const f of foreshadowings) m.set(f.storylineId ?? null, (m.get(f.storylineId ?? null) ?? 0) + 1);
    return m;
  }, [foreshadowings]);

  const genre = books.find((b) => b.id === bookId)?.genre ?? '';
  const jumpChapter = (chapterId: string) => {
    try {
      if (!bookId) return;
      const ch = bookChapters.find((c) => c.id === chapterId);
      openChapterCarrierView(chapterId, ch?.title ?? '', genre, bookId);
    } catch (e) {
      console.warn('StorylineMatrixView.jumpChapter failed', String(e));
    }
  };

  /** 点伏笔计数格 → 选线 + 选中本线首条伏笔并跳伏笔页签（与 StorylineDetail「相关伏笔」口径一致） */
  const openLineForeshadowing = (storylineId: string) => () => {
    try {
      const es = useEditorStore.getState();
      es.selectStoryline(storylineId);
      const first = foreshadowings.find((f) => f.storylineId === storylineId);
      if (first) es.selectForeshadowing(first.id);
      openTypedCarrierView(genre, 'foreshadowing');
    } catch (e) {
      console.warn('StorylineMatrixView.openLineForeshadowing failed', String(e));
    }
  };

  if (bookChapters.length === 0) {
    return (
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="caption" color="text.disabled" sx={{ pt: 2 }}>
          {t('writing.storylineMatrixNoChapters')}
        </Typography>
      </Box>
    );
  }

  const rowStyler = (storylineId: string | null) => {
    const active = storylineId !== null && storylineId === selectedStorylineId;
    return { active, opacity: storylineId === null || active ? 1 : 0.55 };
  };

  return (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
        {t('writing.storylineMatrixHint')}
      </Typography>
      {matrix.rows.length === 0 ? (
        <Typography variant="caption" color="text.disabled">
          {t('writing.storylineEmptyHint')}
        </Typography>
      ) : (
        <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: `96px repeat(${bookChapters.length}, 30px) 48px 44px`,
              minWidth: 'min-content',
            }}
          >
            {/* 表头：章序号（悬浮章名，点跳章）+ 未绑章列头 */}
            <Box
              sx={{
                position: 'sticky',
                left: 0,
                bgcolor: 'background.paper',
                px: 1,
                py: 0.5,
                fontSize: 9.5,
                color: 'text.disabled',
                borderBottom: 1,
                borderColor: 'divider',
                zIndex: 1,
              }}
            >
              {t('writing.viewKind.storylines')}
            </Box>
            {bookChapters.map((c, i) => (
              <Box
                key={c.id}
                onClick={() => jumpChapter(c.id)}
                title={c.title || t('writingWorkbench.untitled')}
                sx={{
                  cursor: 'pointer',
                  textAlign: 'center',
                  py: 0.5,
                  fontSize: 9,
                  color: 'text.disabled',
                  borderBottom: 1,
                  borderColor: 'divider',
                  '&:hover': { color: 'primary.main' },
                }}
              >
                {i + 1}
              </Box>
            ))}
            <Box
              sx={{ textAlign: 'center', py: 0.5, fontSize: 9, color: WARN, borderBottom: 1, borderColor: 'divider' }}
            >
              {t('writing.storylineMatrixUnbound')}
            </Box>
            <Box
              sx={{
                textAlign: 'center',
                py: 0.5,
                fontSize: 9,
                color: 'text.disabled',
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              {t('writing.storylineMatrixForeshadow')}
            </Box>
            {/* 数据行：线名（sticky）+ 章格 + 未绑章数 */}
            {matrix.rows.map((row) => {
              const line = row.storylineId ? bookLines.find((l) => l.id === row.storylineId) : null;
              const { active, opacity } = rowStyler(row.storylineId);
              const color = line?.color || LANE_COLORS[hashStr(row.storylineId ?? '__unlined__') % LANE_COLORS.length];
              // 剧情 P2-A：本线伏笔计数（含未挂线行的未挂线伏笔数），骨架互联补缺
              const fsCount = fsCountByLine.get(row.storylineId ?? null) ?? 0;
              return (
                <Box key={row.storylineId ?? '__unlined__'} sx={{ display: 'contents' }}>
                  <Box
                    sx={{
                      position: 'sticky',
                      left: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      px: 1,
                      minWidth: 0,
                      borderBottom: 1,
                      borderColor: 'divider',
                      opacity,
                      zIndex: 1,
                      bgcolor: active ? `${accent}14` : 'background.paper',
                    }}
                  >
                    <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
                    <Box
                      sx={{
                        fontSize: 10.5,
                        fontWeight: active ? 700 : 400,
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                        color: row.storylineId === null ? 'text.disabled' : 'text.primary',
                      }}
                    >
                      {line?.name || t('writing.storylineUnlined')}
                    </Box>
                  </Box>
                  {bookChapters.map((c) => {
                    const n = row.counts.get(c.id) ?? 0;
                    const evs = row.events.get(c.id);
                    return (
                      <Box
                        key={c.id}
                        onClick={n > 0 ? () => jumpChapter(c.id) : undefined}
                        title={
                          n > 0
                            ? `${c.title || t('writingWorkbench.untitled')} · ${evs?.map((e) => e.event || t('writing.timelineIncomplete')).join(' / ')}`
                            : undefined
                        }
                        sx={{
                          textAlign: 'center',
                          py: 0.5,
                          fontSize: 9.5,
                          borderBottom: 1,
                          borderColor: 'divider',
                          opacity,
                          cursor: n > 0 ? 'pointer' : 'default',
                          color: n > 0 ? color : 'transparent',
                          bgcolor: n > 0 && active ? `${accent}0a` : 'transparent',
                          '&:hover': n > 0 ? { bgcolor: 'action.hover' } : {},
                        }}
                      >
                        {n > 0 ? n : '·'}
                      </Box>
                    );
                  })}
                  <Box
                    sx={{
                      textAlign: 'center',
                      py: 0.5,
                      fontSize: 9.5,
                      borderBottom: 1,
                      borderColor: 'divider',
                      opacity,
                      color: row.unboundCount > 0 ? WARN : 'transparent',
                    }}
                  >
                    {row.unboundCount > 0 ? row.unboundCount : '·'}
                  </Box>
                  <Box
                    onClick={fsCount > 0 && row.storylineId ? openLineForeshadowing(row.storylineId) : undefined}
                    title={fsCount > 0 && row.storylineId ? t('writing.storylineForeshadows') : undefined}
                    sx={{
                      textAlign: 'center',
                      py: 0.5,
                      fontSize: 9.5,
                      borderBottom: 1,
                      borderColor: 'divider',
                      opacity,
                      cursor: fsCount > 0 && row.storylineId ? 'pointer' : 'default',
                      color: fsCount > 0 ? (row.storylineId ? '#0f6e56' : WARN) : 'transparent',
                      '&:hover': fsCount > 0 && row.storylineId ? { bgcolor: 'action.hover' } : {},
                    }}
                  >
                    {fsCount > 0 ? fsCount : '·'}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}
