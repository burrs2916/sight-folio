// 章统筹工作台（正文页签右栏内嵌 / 写作台「章详情」九维面板共用同一组件）：
//
// 以**当前激活章**为中心聚合八个维度的本章视角——出场人物 / 场景（世界观）/
// 时间线 / 剧情线 / 伏笔 / 灵感 / 校对 / 统计——每行可点即跳对应页签并选中，
// 结构动作（转时间线草稿）就地可用。**正文只读**（编辑收敛写作台），本面板只做
// 设计联动，不做正文编辑。
// 跳转一律走 writingDeskJump 的 dispatchChapterJump 协议：主窗口就地执行，
// 写作台独立窗口 emit 事件由主窗口接管并置前——两种挂载形态行为一致。
// 口径全部复用 utils（castOfChapter / scenesOfChapter /
// deriveLinesFromEvents / foreshadowingsPlantedIn·PayableIn / chapterTextIssues /
// chapterOutlier），与右栏本章上下文同一份算法，零第二份。
import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import { useWritingStore } from '../../store/writingStore';
import { dispatchChapterJump, type ChapterJumpPayload } from '../../utils/writingDeskJump';
import { t } from '../../i18n';
import { logger } from '../../utils/logger';
import { castOfChapter, scenesOfChapter, ideasOfChapter } from '../../utils/writingOutline';
import { isComplete, deriveLinesFromEvents, LANE_COLORS, hashStr } from '../../utils/writingTimeline';
import {
  foreshadowingsPlantedIn,
  foreshadowingsPayableIn,
  foreshadowStatusColor,
  foreshadowStatusLabelKey,
} from '../../utils/writingForeshadowing';
import { chapterTextIssues } from '../../utils/writingProofread';
import { chapterOutlier } from '../../utils/writingStats';

export function ChapterOverviewPanel({ bookId, chapterId }: { bookId: string; chapterId: string | null }) {
  const chapters = useWritingStore((s) => s.chapters);
  const outlines = useWritingStore((s) => s.outlines);
  const settings = useWritingStore((s) => s.settings);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const storylines = useWritingStore((s) => s.storylines);
  const setChapterStoryline = useWritingStore((s) => s.setChapterStoryline);
  const books = useWritingStore((s) => s.books);
  const genre = books.find((b) => b.id === bookId)?.genre ?? '';

  const chapter = chapterId ? (chapters.find((c) => c.id === chapterId) ?? null) : null;

  // 跳转统一走 dispatchChapterJump 协议：主窗口就地执行（选中 + 切页签），
  // 写作台独立窗口由主窗口监听事件接管——与提醒条跳转同一通道。
  const jump = (p: Omit<ChapterJumpPayload, 'genre'>) => {
    try {
      dispatchChapterJump({ genre, ...p });
    } catch (e) {
      logger.warn('ChapterOverviewPanel', 'dispatchChapterJump failed', { p, error: String(e) });
    }
  };

  // ── 各维度的「本章视角」派生（口径与右栏本章上下文同一份 utils） ──
  const castIds = useMemo(() => (chapter ? castOfChapter(outlines, chapter.id) : []), [outlines, chapter]);
  const sceneIds = useMemo(() => (chapter ? scenesOfChapter(outlines, chapter.id) : []), [outlines, chapter]);
  const chapterEvents = useMemo(() => {
    if (!chapter) return [];
    const coll = new Intl.Collator('zh', { numeric: true });
    const bound = timelineEvents.filter((e) => e.chapterId === chapter.id);
    return [
      ...bound.filter(isComplete).sort((a, b) => coll.compare(a.at?.trim() || '', b.at?.trim() || '')),
      ...bound.filter((e) => !isComplete(e)),
    ];
  }, [timelineEvents, chapter]);
  const chapterLines = useMemo(
    () =>
      deriveLinesFromEvents(
        chapterEvents,
        storylines.filter((l) => l.bookId === bookId),
      ),
    [chapterEvents, storylines, bookId],
  );
  const bookStorylines = useMemo(() => storylines.filter((l) => l.bookId === bookId), [storylines, bookId]);
  const planted = useMemo(
    () => (chapter ? foreshadowingsPlantedIn(foreshadowings, chapter.id) : []),
    [foreshadowings, chapter],
  );
  const payable = useMemo(
    () => (chapter ? foreshadowingsPayableIn(foreshadowings, chapter.id) : []),
    [foreshadowings, chapter],
  );
  // ⑦ 灵感：念头池中与本章节拍挂载的出场人物/场景有交集的未落章拍，
  // 口径与灵感提醒条/灵感页签同源（ideasOfChapter，utils/writingOutline），
  // 计数不再硬编码为 0（2026-10-19 审计项）。
  const freshIdeas = useMemo(() => (chapter ? ideasOfChapter(outlines, chapter.id).length : 0), [outlines, chapter]);
  const proofreadIssues = useMemo(() => (chapter ? chapterTextIssues(chapter) : []), [chapter]);
  const kpi = useMemo(() => {
    const bookChapters = chapters.filter((c) => c.bookId === bookId);
    const avg =
      bookChapters.length > 0 ? bookChapters.reduce((s, c) => s + (c.wordCount || 0), 0) / bookChapters.length : 0;
    return {
      words: chapter?.wordCount ?? 0,
      outlier: chapter ? chapterOutlier(chapter.wordCount || 0, avg, bookChapters.length) : null,
      share: avg > 0 ? Math.round(((chapter?.wordCount || 0) / avg) * 100) : 0,
    };
  }, [chapters, bookId, chapter]);

  const nameOf = (id: string) => settings.find((s) => s.id === id)?.name ?? id;

  const GroupTitle = ({ label, count }: { label: string; count: number }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1.25, mb: 0.5 }}>
      <Typography
        sx={{
          fontSize: 10.5,
          fontWeight: 700,
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontSize: 9.5, color: count > 0 ? 'warning.main' : 'text.disabled', fontWeight: 700 }}>
        {count}
      </Typography>
    </Box>
  );

  const rowBtnSx = {
    textTransform: 'none',
    fontSize: 11.5,
    px: 0.5,
    py: 0,
    minWidth: 0,
    justifyContent: 'flex-start',
    overflow: 'hidden',
    maxWidth: '100%',
  } as const;

  if (!chapter) {
    return (
      <Box sx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('writing.chapterContextEmpty')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 1, overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
      {/* 章头：面包屑省略，直接状态 + 字数（与右栏本章上下文同口径） */}
      <Typography sx={{ fontSize: 12.5, fontWeight: 700 }} noWrap>
        {chapter.title}
      </Typography>
      <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>
        {t(chapter.status === 'finished' ? 'editor.writing.status.finished' : 'editor.writing.status.draft')} ·{' '}
        {t('writing.words', { n: chapter.wordCount })}
      </Typography>

      {/* ① 出场人物 / ② 场景（大纲挂载 → 人物/世界观设定） */}
      <GroupTitle label={t('editor.writing.inspector.tabCharacter')} count={castIds.length} />
      {castIds.length === 0 ? (
        <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>
          {t('editor.writing.inspector.unplanned')}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {castIds.map((id) => (
            <Button
              key={id}
              size="small"
              variant="outlined"
              onClick={() => jump({ kind: 'characters', settingId: id })}
              sx={{ ...rowBtnSx, height: 20, minHeight: 0, borderRadius: 3, fontSize: 10.5 }}
            >
              {nameOf(id)}
            </Button>
          ))}
        </Box>
      )}
      <GroupTitle label={t('writingDesign.pane.scenes')} count={sceneIds.length} />
      {sceneIds.length === 0 ? (
        <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>
          {t('editor.writing.inspector.unplanned')}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {sceneIds.map((id) => (
            <Button
              key={id}
              size="small"
              variant="outlined"
              onClick={() => jump({ kind: 'worldview', settingId: id })}
              sx={{ ...rowBtnSx, height: 20, minHeight: 0, borderRadius: 3, fontSize: 10.5 }}
            >
              {nameOf(id)}
            </Button>
          ))}
        </Box>
      )}

      {/* ④ 时间线（本章事件） */}
      <GroupTitle label={t('writing.chapterTimelineTitle')} count={chapterEvents.length} />
      {chapterEvents.length === 0 ? (
        <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>{t('writing.chapterTimelineEmpty')}</Typography>
      ) : (
        chapterEvents.map((ev) => (
          <Button
            key={ev.id}
            size="small"
            variant="text"
            onClick={() => jump({ kind: 'timeline', timelineView: 'chapter', eventId: ev.id })}
            title={t('writing.chapterTimelineOpen')}
            sx={rowBtnSx}
          >
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ev.at ? `${ev.at} · ` : ''}
              {ev.event || t('writing.timelineIncomplete')}
            </Box>
          </Button>
        ))
      )}

      {/* ⑤ 主剧情线（G1 章级直连）：选择器 = chip 组（本书全部线 + 未挂线），当前归属高亮，点击即挂/解绑 */}
      <GroupTitle label={t('writing.storylineMainTitle')} count={chapter.storylineId ? 1 : 0} />
      {bookStorylines.length === 0 ? (
        <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>{t('writing.storylineEmptyHint')}</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }} title={t('writing.storylineMainHint')}>
          <Button
            size="small"
            variant={!chapter.storylineId ? 'contained' : 'outlined'}
            onClick={() => void setChapterStoryline(chapter.id, null)}
            sx={{ ...rowBtnSx, height: 20, minHeight: 0, borderRadius: 3, fontSize: 10.5 }}
          >
            {t('writing.storylineUnbound')}
          </Button>
          {bookStorylines.map((sl) => {
            const active = chapter.storylineId === sl.id;
            const lineColor = sl.color || LANE_COLORS[hashStr(sl.id) % LANE_COLORS.length];
            return (
              <Button
                key={sl.id}
                size="small"
                variant={active ? 'contained' : 'outlined'}
                onClick={() => void setChapterStoryline(chapter.id, active ? null : sl.id)}
                sx={{ ...rowBtnSx, height: 20, minHeight: 0, borderRadius: 3, fontSize: 10.5 }}
              >
                <Box
                  component="span"
                  sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: lineColor, flexShrink: 0, mr: 0.75 }}
                />
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sl.name}
                </Box>
              </Button>
            );
          })}
        </Box>
      )}

      {/* ⑥ 剧情线（本章事件挂线去重） */}
      <GroupTitle label={t('writing.chapterLinesTitle')} count={chapterLines.length} />
      {chapterLines.length === 0 ? (
        <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>{t('writing.chapterLinesEmpty')}</Typography>
      ) : (
        chapterLines.map(({ storyline: sl, count }) => (
          <Button
            key={sl.id}
            size="small"
            variant="text"
            onClick={() => jump({ kind: 'timeline', timelineView: 'storyline', storylineId: sl.id })}
            title={t('writing.storylineSelect')}
            sx={rowBtnSx}
          >
            <Box
              component="span"
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: sl.color || LANE_COLORS[hashStr(sl.id) % LANE_COLORS.length],
                flexShrink: 0,
                mr: 0.75,
              }}
            />
            <Box
              component="span"
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}
            >
              {sl.name}
            </Box>
            <Box component="span" sx={{ fontSize: 9.5, color: 'text.disabled', ml: 0.5, flexShrink: 0 }}>
              {count}
            </Box>
          </Button>
        ))
      )}

      {/* ⑥ 伏笔（本章埋设 + 本章计划回收） */}
      <GroupTitle label={t('writing.chapterForeshadowTitle')} count={planted.length + payable.length} />
      {planted.length + payable.length === 0 ? (
        <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>{t('writing.chapterForeshadowEmpty')}</Typography>
      ) : (
        <>
          {planted.map((f) => (
            <Button
              key={f.id}
              size="small"
              variant="text"
              onClick={() => jump({ kind: 'foreshadowing', selectedId: f.id })}
              sx={rowBtnSx}
            >
              <Box
                component="span"
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  bgcolor: foreshadowStatusColor(f.status),
                  flexShrink: 0,
                  mr: 0.75,
                }}
              />
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.title}
              </Box>
              <Box component="span" sx={{ fontSize: 9, color: 'text.disabled', ml: 0.5, flexShrink: 0 }}>
                {t(foreshadowStatusLabelKey(f.status))}
              </Box>
            </Button>
          ))}
          {payable.map((f) => (
            <Button
              key={f.id}
              size="small"
              variant="text"
              onClick={() => jump({ kind: 'foreshadowing', selectedId: f.id })}
              sx={rowBtnSx}
            >
              <Box
                component="span"
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  bgcolor: foreshadowStatusColor(f.status),
                  flexShrink: 0,
                  mr: 0.75,
                }}
              />
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.title}
              </Box>
              <Box component="span" sx={{ fontSize: 9, color: 'text.disabled', ml: 0.5, flexShrink: 0 }}>
                {t('writing.chapterForeshadowPayHere')}
              </Box>
            </Button>
          ))}
        </>
      )}

      {/* ⑦ 灵感（念头池未分发计数 → 灵感页签速记/分发） */}
      <GroupTitle label={t('writing.viewKind.inspiration')} count={freshIdeas} />
      <Button size="small" variant="text" onClick={() => jump({ kind: 'inspiration' })} sx={rowBtnSx}>
        {freshIdeas > 0 ? t('writing.overviewIdeasFresh', { n: freshIdeas }) : t('writing.overviewIdeasClean')}
      </Button>

      {/* ⑧ 校对（本章五类文本发现，行点即定位校对页签对应发现） */}
      <GroupTitle label={t('writing.proofreadGroup.ChapterText')} count={proofreadIssues.length} />
      {proofreadIssues.length === 0 ? (
        <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>{t('writing.proofreadPaneEmpty')}</Typography>
      ) : (
        <>
          {proofreadIssues.map((iss) => (
            <Button
              key={iss.key}
              size="small"
              variant="text"
              onClick={() => {
                jump({ kind: 'proofread', issueKey: iss.key });
              }}
              title={t('writing.proofreadJumpDetail')}
              sx={{
                ...rowBtnSx,
                justifyContent: 'flex-start',
                textAlign: 'left',
                color:
                  iss.severity === 'block'
                    ? 'error.main'
                    : iss.severity === 'warning'
                      ? 'warning.main'
                      : 'text.primary',
              }}
            >
              ⚑ {t(`writing.proofreadIssue.${iss.messageKey}`, iss.args)}
            </Button>
          ))}
          <Button
            size="small"
            variant="text"
            onClick={() => jump({ kind: 'proofread' })}
            sx={{ ...rowBtnSx, color: 'primary.main' }}
          >
            ⇢ {t('writing.viewKind.proofread')}
          </Button>
        </>
      )}

      {/* ⑨ 统计（本章字数 vs 章均 + 离群标注） */}
      <GroupTitle label={t('writing.viewKind.stats')} count={kpi.outlier ? 1 : 0} />
      <Typography sx={{ fontSize: 10.5, color: 'text.primary' }}>
        {t('writing.words', { n: kpi.words })} · {t('writing.statsAvgShare', { n: kpi.share })}
      </Typography>
      {kpi.outlier && (
        <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: 'warning.main' }}>
          {kpi.outlier === 'long' ? t('writing.statsOutlierLong') : t('writing.statsOutlierShort')} ·{' '}
          {t('writing.statsOutlierLegend')}
        </Typography>
      )}
      <Button
        size="small"
        variant="text"
        onClick={() => {
          if (chapter) {
            jump({ kind: 'stats', chapterId: chapter.id });
          }
        }}
        sx={rowBtnSx}
      >
        ⇢ {t('writing.viewKind.stats')}
      </Button>
      <Button size="small" variant="text" onClick={() => jump({ kind: 'overview' })} sx={rowBtnSx}>
        ⇢ {t('writing.viewKind.overview')}
      </Button>

      <Divider sx={{ my: 1 }} />
      <Typography sx={{ fontSize: 9.5, color: 'text.disabled', pb: 1 }}>
        {t('writing.chapterOverviewFooter')}
      </Typography>
    </Box>
  );
}
