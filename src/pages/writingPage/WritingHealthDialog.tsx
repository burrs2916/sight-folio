// 全书体检（批次② 增-1）：写作台内的七组体检发现清单。
//
// 为什么要有这个面板：七组全书体检此前**只存在于场景画布**（校对页签 + 右栏要素卡），
// 而作者绝大多数时间在写作台。更糟的是写作台工具栏上那个「校对」按钮打开的是
// **当前章**的错字/重复/敏感词面板（ProofreadPanel），同名不同物，作者以为全书体检就是它。
//
// 本面板只做一件事：把同一份 buildProofreadReport 摊在写作台里，并能跳过去处理。
// 算法零复制（口径禁止第二份），排序/过滤/严重度配色全部复用 utils/writingProofread。
import { useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import DialogActions from '@mui/material/DialogActions';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { useWritingStore } from '../../store/writingStore';
import { useToastStore } from '../../store/toastStore';
import { logger } from '../../utils/logger';
import { saveTextFile } from '../../services/writing';
import { buildHealthReportHtml, buildHealthReportMarkdown, type HealthReportInput } from '../../utils/writingHealthReport';
import {
  buildProofreadReport,
  filterProofreadIssues,
  proofreadGroupLabelKey,
  proofreadSeverityColor,
  sortProofreadIssues,
  PROOFREAD_GROUPS,
  type ProofreadGroup,
  type ProofreadFinding,
  type ProofreadSeverityFilter,
  type ProofreadSortMode,
} from '../../utils/writingProofread';
import { dispatchChapterJump, type ChapterJumpKind } from '../../utils/writingDeskJump';
import { t } from '../../i18n';

export interface WritingHealthDialogProps {
  open: boolean;
  onClose: () => void;
  /** 跳到某一章正文（写作台内可做，作者不用切界面） */
  onJumpChapter: (chapterId: string) => void;
  /** 打开某张设定卡（一致性发现的落点：要改的就是这张卡） */
  onOpenSetting: (settingId: string) => void;
}

const SEVERITY_FILTERS: { value: ProofreadSeverityFilter; labelKey: string }[] = [
  { value: 'all', labelKey: 'writing.healthFilterAll' },
  { value: 'block', labelKey: 'writing.proofreadSeverityBlock' },
  { value: 'warning', labelKey: 'writing.proofreadSeverityWarning' },
];

const SORT_MODES: { value: ProofreadSortMode; labelKey: string }[] = [
  { value: 'severity', labelKey: 'writing.proofreadSortSeverity' },
  { value: 'chapter', labelKey: 'writing.proofreadSortChapter' },
  { value: 'default', labelKey: 'writing.proofreadSortDefault' },
];

/**
 * 页签类发现（只说「这一组有问题」、不指向具体对象）的去向。
 *
 * 单独列成表是为了让「新增一类页签目标」必须在这里表态，而不是静默落到 undefined 上。
 * `storylines` 走跳转协议的剧情线页签（timeline 只是它的另一种视角，不是同一个页签）。
 */
const HEALTH_VIEW_KIND: Record<
  'timeline' | 'storylines' | 'inspiration' | 'foreshadowing' | 'characters',
  ChapterJumpKind
> = {
  timeline: 'timeline',
  storylines: 'storylines',
  inspiration: 'inspiration',
  foreshadowing: 'foreshadowing',
  characters: 'characters',
};

export function WritingHealthDialog({ open, onClose, onJumpChapter, onOpenSetting }: WritingHealthDialogProps) {
  const chapters = useWritingStore((s) => s.chapters);
  const outlines = useWritingStore((s) => s.outlines);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const storylines = useWritingStore((s) => s.storylines);
  const settings = useWritingStore((s) => s.settings);
  const books = useWritingStore((s) => s.books);
  const activeBookId = useWritingStore((s) => s.activeBookId);

  const [group, setGroup] = useState<ProofreadGroup | 'all'>('all');
  const [severity, setSeverity] = useState<ProofreadSeverityFilter>('all');
  const [sort, setSort] = useState<ProofreadSortMode>('severity');

  const report = useMemo(
    () => buildProofreadReport(chapters, outlines, timelineEvents, foreshadowings, storylines, settings),
    [chapters, outlines, timelineEvents, foreshadowings, storylines, settings],
  );

  const chapterOrder = useMemo(() => [...chapters].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => c.id), [chapters]);
  const chapterTitle = useMemo(() => new Map(chapters.map((c) => [c.id, c.title])), [chapters]);

  const rows = useMemo(() => {
    const byGroup = group === 'all' ? report.issues : report.issues.filter((i) => i.group === group);
    return sortProofreadIssues(filterProofreadIssues(byGroup, severity), sort, chapterOrder);
  }, [report.issues, group, severity, sort, chapterOrder]);

  // 跳转协议的入参：页签按载体类型（genre）定位，缺它就只能落到别的书上
  const genre = books.find((b) => b.id === activeBookId)?.genre ?? '';

  const act = (issue: ProofreadFinding) => {
    const tg = issue.target;
    if (!tg) return;
    if (tg.type === 'chapter') {
      onJumpChapter(tg.id);
      onClose();
      return;
    }
    if (tg.type === 'setting') {
      onOpenSetting(tg.id);
      onClose();
      return;
    }
    // 其余目标的落点在主窗口 L2 页签。跨窗口由跳转协议自己分发（写作台 emit、主窗口
    // 接管并置前），所以这里一律代跳。此前这些行整行不可点、只提示「请到画布中处理」，
    // 等于体检报告只能看不能修——而作者绝大多数时间就在写作台这个窗口里。
    if (tg.type === 'foreshadowing') {
      dispatchChapterJump({ genre, kind: 'foreshadowing', selectedId: tg.id });
    } else if (tg.type === 'idea') {
      dispatchChapterJump({ genre, kind: 'inspiration', selectedId: tg.id });
    } else if (tg.type === 'timeline-event') {
      dispatchChapterJump({ genre, kind: 'timeline', timelineView: 'chapter', eventId: tg.id });
    } else if (tg.type === 'storyline') {
      dispatchChapterJump({ genre, kind: 'storylines', storylineId: tg.id });
    } else {
      dispatchChapterJump({ genre, kind: HEALTH_VIEW_KIND[tg.id] });
    }
    onClose();
  };

  /**
   * 导出一页体检报告（Markdown / 自包含 HTML）。
   *
   * 口径直接取本页已算好的 `report`，**不重算**——屏幕上看到什么就导出什么。
   * 落盘走 plugin-dialog 选路径 + save_text_file，与既有六格式导出同一套约定：
   * 用户取消静默返回（不是失败），真失败必须给 toast。
   */
  const handleExport = async (kind: 'md' | 'html') => {
    const book = books.find((b) => b.id === activeBookId) ?? null;
    const bookTitle = book?.title?.trim() || t('writing.healthReportUntitledBook');
    try {
      const input: HealthReportInput = {
        bookTitle,
        generatedAt: new Date(),
        chapters,
        settingCount: settings.length,
        report,
        chapterTitle: (id: string) => chapterTitle.get(id) ?? '',
      };
      const isMd = kind === 'md';
      const content = isMd ? buildHealthReportMarkdown(input) : buildHealthReportHtml(input);
      const path = await saveDialog({
        defaultPath: `${bookTitle}-${t('writing.healthDialog')}.${kind}`,
        filters: isMd
          ? [{ name: 'Markdown', extensions: ['md'] }]
          : [{ name: 'HTML', extensions: ['html'] }],
      });
      if (!path) return; // 取消不是失败，别报红
      await saveTextFile(path, content);
      useToastStore.getState().success(t('writing.healthExported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingHealthDialog', 'export health report failed', { error: e });
      useToastStore.getState().error(t('writing.healthExportFailed', { msg }));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>
        {t('writing.healthDialog')}
        <Typography component="span" sx={{ ml: 1, fontSize: 12 }} color="text.secondary">
          {t('writing.proofreadCount', { n: report.issues.length })}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          {/* 左：七组维度 + 计数（与画布校对页签同一分组口径） */}
          <Box sx={{ width: 150, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {(['all', ...PROOFREAD_GROUPS] as const).map((g) => {
              const n = g === 'all' ? report.issues.length : (report.counts[g] ?? 0);
              const active = group === g;
              return (
                <Box
                  key={g}
                  onClick={() => setGroup(g)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1,
                    py: 0.5,
                    borderRadius: 1,
                    cursor: 'pointer',
                    fontSize: 12,
                    bgcolor: active ? 'action.selected' : 'transparent',
                    color: n > 0 ? 'text.primary' : 'text.disabled',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {g === 'all' ? t('writing.healthFilterAll') : t(proofreadGroupLabelKey(g))}
                  </Box>
                  <Box sx={{ fontWeight: 700, color: n > 0 ? 'warning.main' : 'text.disabled' }}>{n}</Box>
                </Box>
              );
            })}
          </Box>

          {/* 右：发现清单 */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
              {SEVERITY_FILTERS.map((f) => (
                <Button key={f.value} size="small" variant={severity === f.value ? 'contained' : 'text'} onClick={() => setSeverity(f.value)}>
                  {t(f.labelKey)}
                </Button>
              ))}
              <Box sx={{ flex: 1 }} />
              {SORT_MODES.map((m) => (
                <Button key={m.value} size="small" color="inherit" variant={sort === m.value ? 'outlined' : 'text'} onClick={() => setSort(m.value)}>
                  {t(m.labelKey)}
                </Button>
              ))}
            </Box>

            {rows.length === 0 ? (
              <Typography sx={{ fontSize: 12.5, py: 3, textAlign: 'center' }} color="text.disabled">
                {t('writing.healthEmpty')}
              </Typography>
            ) : (
              <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
                {rows.map((issue) => {
                  const color = proofreadSeverityColor(issue.severity);
                  const tg = issue.target;
                  // 有目标就能跳：章节/设定卡在写作台就地打开，其余由跳转协议送到主窗口页签
                  const local = !!tg && (tg.type === 'chapter' || tg.type === 'setting');
                  const jumpable = !!tg;
                  const chapterName = tg?.type === 'chapter' ? (chapterTitle.get(tg.id) ?? '') : '';
                  return (
                    <Tooltip
                      key={issue.key}
                      title={
                        !tg ? '' : local ? t('writing.proofreadJump') : t('writing.healthJumpInView')
                      }
                    >
                      <Box
                        data-testid={`health-row-${issue.key}`}
                        data-jumpable={jumpable ? '1' : '0'}
                        onClick={() => act(issue)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          px: 1,
                          py: 0.75,
                          borderRadius: 1,
                          cursor: local ? 'pointer' : 'default',
                          '&:hover': local ? { bgcolor: 'action.hover' } : {},
                        }}
                      >
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            flexShrink: 0,
                            bgcolor: color,
                            boxShadow: `0 0 0 2px ${color}33`,
                          }}
                        />
                        <Box sx={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                          {t(`writing.proofreadIssue.${issue.messageKey}`, issue.args)}
                        </Box>
                        <Box sx={{ fontSize: 11, color: 'text.disabled', flexShrink: 0 }}>
                          {t(proofreadGroupLabelKey(issue.group))}
                        </Box>
                        {chapterName && (
                          <Box
                            sx={{
                              fontSize: 11,
                              fontWeight: 600,
                              flexShrink: 0,
                              maxWidth: 160,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: 'primary.main',
                              bgcolor: 'action.selected',
                              borderRadius: 1,
                              px: 0.6,
                            }}
                          >
                            {chapterName}
                          </Box>
                        )}
                      </Box>
                    </Tooltip>
                  );
                })}
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ gap: 0.5 }}>
        {/* 这一页报告是整套一致性能力唯一"能拿给别人看"的产出，所以放主操作位而不是塞进菜单 */}
        <Button size="small" onClick={() => void handleExport('md')}>
          {t('writing.healthExportMd')}
        </Button>
        <Button size="small" onClick={() => void handleExport('html')}>
          {t('writing.healthExportHtml')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
