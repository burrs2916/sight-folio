// 章详情面板（写作台右栏「章详情」tab 的内容）。
//
// 大纲 tab 的用途 = 每章的详情索引：点章 → 打开该章专有详情。
// 本面板聚合一章的独立要素（全部零后端字段变更）：
//   - 封面大图（章自身 extra.coverImage，可换/清除；无封面文字兜底）
//   - 章信息（面包屑 / 卷 / 状态 / 字数）
//   - 叙事节拍（本章节拍 title+summary + 状态徽章 + 导入时间线按钮）
//   - 人物 chips（castOfChapter 绑定，点 chip 即 toggle 进出本章）
//   - 本章时间线事件（展示 + 删除）
//   - 伏笔（本章埋设 / 计划回收，只读双归类）
// 数据口径与书场景右栏章卡（WritingInspectorPanel）同一份（utils/writingOutline 纯函数）。
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import Divider from '@mui/material/Divider';
import { t } from '../i18n';
import { useWritingStore } from '../store/writingStore';
import { useAssetPickerStore } from '../store/assetPickerStore';
import { useToastStore } from '../store/toastStore';
import { illustrationAssetRef } from '../editor/extensions/writingImage';
import { CoverThumb } from '../components/CoverThumb';
import { logger } from '../utils/logger';
import type { WritingBook, WritingChapter, WritingTimelineEvent } from '../services/writing';
import type { WritingOutline, WritingSetting } from '../services/writing';
import { beatsOfChapter, castOfChapter, chapterPath, importedBeatIdsOfChapter, parseChapterCover, toggleSettingOnChapter } from '../utils/writingOutline';
import { buildTree, chapterPathLabels } from '../utils/writingTree';
import { isComplete } from '../utils/writingTimeline';
import { foreshadowingsPlantedIn, foreshadowingsPayableIn, foreshadowStatusColor } from '../utils/writingForeshadowing';

export interface ChapterDetailsPanelProps {
  /** 当前要展示详情的章（null = 未选中，显示空态引导） */
  chapter: WritingChapter | null;
  book: WritingBook | null;
  chapters: WritingChapter[];
  outlines: WritingOutline[];
  settings: WritingSetting[];
  timelineEvents: WritingTimelineEvent[];
  /** 点击人物 chip 后跳人物档案（写作台右侧正文 tab 的设定卡编辑） */
  onOpenSetting?: (settingId: string) => void;
  /** 「管理本章人物…」入口：跳去左栏设定页专人管理（默认无 = 隐藏该按钮） */
  onManageCast?: () => void;
}

/** 人物 / 场景共用绑定 chip（与书场景章卡同口径：active = 已绑到本章） */
function ToggleChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <Box
      component="span"
      onClick={onClick}
      title={active ? t('writing.chapterDetailsUnbind') : t('writing.chapterDetailsBind')}
      sx={{
        px: 0.75,
        py: 0.25,
        borderRadius: 999,
        fontSize: 11,
        cursor: 'pointer',
        userSelect: 'none',
        fontWeight: active ? 700 : 400,
        color: active ? '#fff' : 'text.secondary',
        bgcolor: active ? 'primary.main' : 'action.hover',
        border: 1,
        borderColor: active ? 'primary.main' : 'divider',
        '&:hover': { opacity: 0.85 },
      }}
    >
      {label}
    </Box>
  );
}

export function ChapterDetailsPanel({
  chapter,
  book,
  chapters,
  outlines,
  settings,
  timelineEvents,
  onOpenSetting,
  onManageCast,
}: ChapterDetailsPanelProps) {
  // 伏笔数据懒加载（与书场景章卡同款：首次进入详情时补齐）
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const loadForeshadowings = useWritingStore((s) => s.loadForeshadowings);
  useEffect(() => {
    if (book && foreshadowings.length === 0) {
      void loadForeshadowings().catch((err) => {
        logger.warn('ChapterDetailsPanel', 'load foreshadowings failed', { error: err });
      });
    }
  }, [book, foreshadowings.length, loadForeshadowings]);

  const forest = useMemo(() => buildTree(chapters), [chapters]);

  // 本章时间线事件（完整事件按 at 排前、草稿殿后——与书场景章卡同一排序）
  const chapterTimelineEvents = useMemo(() => {
    const bound = timelineEvents.filter((e) => e.chapterId === chapter?.id);
    const coll = new Intl.Collator('zh', { numeric: true });
    const comp = bound.filter(isComplete).sort((a, b) => coll.compare(a.at?.trim() || '', b.at?.trim() || ''));
    const drafts = bound.filter((e) => !isComplete(e));
    return [...comp, ...drafts];
  }, [timelineEvents, chapter?.id]);

  // 本章节拍清单（导出口径 beatsOfChapter，与书场景/灵感同表；按 sortOrder 排展示序）
  const chapterBeats = useMemo(() => {
    if (!chapter) return [];
    return beatsOfChapter(outlines, chapter.id).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  }, [outlines, chapter]);
  // 已导入节拍：数据即真相——本章时间线里已有同 outlineId 的事件即视为导过，不另设持久态，
  // 避免「本地记了已导入但事件被别处删掉」的两张皮，也天然扛面板卸载重挂。
  const importedBeatIds = useMemo(
    () => importedBeatIdsOfChapter(timelineEvents, chapter?.id ?? ''),
    [timelineEvents, chapter?.id],
  );

  const [importingBeatId, setImportingBeatId] = useState<string | null>(null);
  const importBeatToTimeline = async (beatId: string) => {
    if (!chapter || importingBeatId) return;
    const beat = chapterBeats.find((b) => b.id === beatId);
    if (!beat) return;
    setImportingBeatId(beatId);
    try {
      // 建「草稿事件」：at 留空=草稿，绑定本章与该节拍；用户去时间线补齐时点即为正式事件
      // （接上体检「待补全草稿事件」工作台，形成 节拍→草稿→补时点 的连续任务链）。
      await useWritingStore.getState().createTimelineEvent({
        chapterId: chapter.id,
        outlineId: beat.id,
        event: (beat.summary || beat.title).trim(),
        at: '',
      });
      useToastStore.getState().success(t('writing.chapterBeatImportDone'));
    } catch (err) {
      logger.warn('ChapterDetailsPanel', 'import beat to timeline failed', { error: err });
      useToastStore.getState().error(t('writing.chapterBeatImportFail'));
    } finally {
      setImportingBeatId(null);
    }
  };

  // 空态：未选中章
  if (!chapter) {
    return (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          p: 3,
        }}
      >
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{t('writing.chapterDetailsEmpty')}</Typography>
        <Typography sx={{ fontSize: 11.5, color: 'text.disabled', textAlign: 'center', lineHeight: 1.7 }}>
          {t('writing.chapterDetailsEmptyHint')}
        </Typography>
      </Box>
    );
  }

  const cover = parseChapterCover(chapter.extra);
  const path = chapterPath(chapters, chapter.id);
  const labels = chapterPathLabels(forest, chapter.id);
  const castIds = castOfChapter(outlines, chapter.id);
  const characters = settings.filter((s) => s.bookId === chapter.bookId && s.kind === 'character');

  const setCover = (assetRef: string | null) => {
    void useWritingStore
      .getState()
      .setChapterCover(chapter.id, assetRef)
      .catch((err) => {
        logger.warn('ChapterDetailsPanel', 'set chapter cover failed', { error: err });
        useToastStore.getState().error(String(err));
      });
  };
  const openCoverPicker = () => {
    useAssetPickerStore.getState().openPicker({
      coverSetter: {
        kind: 'chapter',
        title: chapter.title,
        hasCover: !!cover,
        clear: () => setCover(null),
        apply: (a) => setCover(illustrationAssetRef(a.name)),
      },
    });
  };

  const toggleCast = async (settingId: string) => {
    try {
      const ws = useWritingStore.getState();
      await toggleSettingOnChapter(
        { outlines: ws.outlines, createOutline: ws.createOutline, updateOutline: ws.updateOutline },
        chapter.id,
        'cast',
        settingId,
        chapter.title || t('editor.writing.inspector.beat'),
      );
    } catch (err) {
      logger.warn('ChapterDetailsPanel', 'toggle cast failed', { error: err });
      useToastStore.getState().error(String(err));
    }
  };

  const plantedHere = foreshadowingsPlantedIn(foreshadowings, chapter.id);
  const payableHere = foreshadowingsPayableIn(foreshadowings, chapter.id);

  const foreshadowRow = (fs: (typeof foreshadowings)[number]) => (
    <Box key={fs.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, fontSize: 11.5 }}>
      <Box
        component="span"
        sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: foreshadowStatusColor(fs.status) }}
      />
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {fs.title || t('writing.foreshadowUntitled')}
      </Box>
    </Box>
  );

  // 布局说明：本面板不自带滚动（原 `flex:1 + overflowY:auto` 会与右栏「九维统筹」卡的
  // 独立滚动区上下争高、各自出滚动条，短窗口下正文被挤成窄条——即用户反馈的「切到
  // 章详情布局就乱」。改为 flex:none 的内容流，滚动权交给外层 details 容器的单一滚动区，
  // 与 activeSetting（设定卡）分支同一范式。
  return (
    <Box sx={{ flex: 'none', px: { xs: 2, md: 4 }, pt: 1, pb: 3 }}>
      <Box sx={{ maxWidth: 760, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* 顶部行：封面大图 + 章信息 */}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <Box component="span" onClick={openCoverPicker} sx={{ lineHeight: 0, cursor: 'pointer', flexShrink: 0 }}>
            <CoverThumb
              rel={cover}
              width={120}
              height={156}
              fallback={{
                bookTitle: book?.title,
                pathLabel: labels ?? undefined,
                color: book?.coverColor,
              }}
            />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 10, color: 'text.disabled', mb: 0.25 }} noWrap>
              {path
                .map((seg) => seg.kind)
                .filter(Boolean)
                .join(' › ') || t('editor.writing.book.noVolume')}
            </Typography>
            <Typography sx={{ fontSize: 17, fontWeight: 700, mb: 0.5 }}>{chapter.title}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
              {chapter.volume && (
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{chapter.volume}</Typography>
              )}
              <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>
                {t('writing.words', { n: chapter.wordCount })}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, mt: 1 }}>
              <Button
                size="small"
                variant="outlined"
                sx={{ fontSize: 11, textTransform: 'none' }}
                onClick={openCoverPicker}
              >
                {cover ? t('writing.coverReplace') : t('writing.coverSet')}
              </Button>
              {cover && (
                <Button
                  size="small"
                  variant="text"
                  color="inherit"
                  sx={{ fontSize: 11, textTransform: 'none' }}
                  onClick={() => setCover(null)}
                >
                  {t('writing.coverClear')}
                </Button>
              )}
            </Box>
          </Box>
        </Box>

        <Divider />

        {/* 人物：本章 cast 绑定 chips（toggle 进出章节人物） */}
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
            {t('editor.writing.inspector.cast')}
          </Typography>
          {characters.length === 0 ? (
            <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>
              {t('editor.writing.inspector.noCastSettings')}
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {characters.map((s) => (
                <ToggleChip
                  key={s.id}
                  active={castIds.includes(s.id)}
                  label={s.name || t('writingWorkbench.untitled')}
                  onClick={() => {
                    if (onOpenSetting) onOpenSetting(s.id);
                    else void toggleCast(s.id);
                  }}
                />
              ))}
            </Box>
          )}
          {onManageCast && (
            <Box sx={{ display: 'flex', gap: 0.75, mt: 0.75 }}>
              <Button
                size="small"
                variant="text"
                color="primary"
                sx={{ fontSize: 11, textTransform: 'none', px: 0.5 }}
                onClick={onManageCast}
              >
                {t('writing.chapterDetailsManageCast')}
              </Button>
            </Box>
          )}
        </Box>

        <Divider />

        {/* 叙事节拍：本章挂的节拍清单（与头注释承诺对齐，此前欠账未渲染）。
            每条可「导入时间线」→ 建草稿事件（at 空=草稿），接上体检「待补全草稿事件」
            工作台补齐时点，形成 节拍→草稿→正式事件 的连续任务链。已导入与否读数据
            （本章时间线里有同 outlineId 事件即已导），不另设本地态。 */}
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
            {t('writing.chapterBeatsTitle')}
          </Typography>
          {chapterBeats.length === 0 ? (
            <Typography sx={{ fontSize: 11.5, color: 'text.disabled', lineHeight: 1.7 }}>
              {t('writing.chapterBeatsEmpty')}
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {chapterBeats.map((b) => {
                const imported = importedBeatIds.has(b.id);
                return (
                  <Box
                    key={b.id}
                    sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, minWidth: 0 }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 600 }} noWrap title={b.title}>
                        {b.title || t('writingWorkbench.untitled')}
                      </Typography>
                      {b.summary && (
                        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.6 }}>
                          {b.summary}
                        </Typography>
                      )}
                    </Box>
                    <Button
                      size="small"
                      variant={imported ? 'text' : 'outlined'}
                      color={imported ? 'inherit' : 'primary'}
                      disabled={imported || importingBeatId !== null}
                      onClick={() => void importBeatToTimeline(b.id)}
                      sx={{ fontSize: 11, textTransform: 'none', flexShrink: 0, px: 0.75, minWidth: 0 }}
                      data-testid={`beat-import-${b.id}`}
                    >
                      {imported ? t('writing.chapterBeatImported') : t('writing.chapterBeatImport')}
                    </Button>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>

        <Divider />

        {/* 本章时间线事件 */}
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
            {t('writing.chapterTimelineTitle')}
          </Typography>
          {chapterTimelineEvents.length === 0 ? (
            <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>{t('writing.chapterTimelineEmpty')}</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.25 }}>
              {chapterTimelineEvents.map((ev) => (
                <Box key={ev.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                  <Box
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 11.5,
                    }}
                  >
                    {ev.at ? `${ev.at} · ` : ''}
                    {ev.event || t('writing.timelineIncomplete')}
                  </Box>
                  <IconButton
                    size="small"
                    onClick={() => {
                      void useWritingStore
                        .getState()
                        .deleteTimelineEvent(ev.id)
                        .catch((err) => {
                          logger.warn('ChapterDetailsPanel', 'delete timeline event failed', { error: err });
                          useToastStore.getState().error(String(err));
                        });
                    }}
                    title={t('writingDesign.deleteIdea')}
                    sx={{
                      minWidth: 0,
                      minHeight: 0,
                      p: 0.25,
                      color: 'text.disabled',
                      '&:hover': { color: 'error.main' },
                    }}
                  >
                    <CloseRoundedIcon sx={{ fontSize: 13 }} />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        {plantedHere.length + payableHere.length > 0 && (
          <>
            <Divider />
            <Box>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
                {t('writing.chapterForeshadowTitle')}
              </Typography>
              {plantedHere.length > 0 && (
                <>
                  <Typography variant="caption" sx={{ fontWeight: 700 }} color="text.disabled">
                    {t('writing.foreshadowPlantedHere')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mt: 0.25 }}>
                    {plantedHere.map(foreshadowRow)}
                  </Box>
                </>
              )}
              {payableHere.length > 0 && (
                <>
                  <Typography variant="caption" sx={{ fontWeight: 700, mt: 0.5 }} color="text.disabled">
                    {t('writing.foreshadowPayableHere')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mt: 0.25 }}>
                    {payableHere.map(foreshadowRow)}
                  </Box>
                </>
              )}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
