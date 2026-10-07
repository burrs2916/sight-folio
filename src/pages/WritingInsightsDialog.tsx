// 写作台 AI 审阅结果面板（A-2：审阅闭环「最后一公里」）
//
// 背景：handleLaunchAi 发射 AI 审阅后，agent 通过 context_insight 工具把结论沉淀进
// insights 体系（analysisId = scopeId = bookId，见 analysisRunner.ts），但写作台窗口内
// 原本没有任何查看入口——发射完只能切回主窗口找结果，闭环断在最后一公里。
// 本面板按 bookId 拉取该书全部审阅结论：待处理(open)优先、已收口(resolved)淡化，
// 支持用户就地「收口」（resolveAiInsight resolvedBy="user"）。
// 发射动线：handleLaunchAi 成功（launchModuleAnalysis await 到 agent 跑完、结果已落库）
// → 直接打开本面板，即时看到本轮产出。
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import { aiContextApi, type AiInsightDto } from '../services/tauri';
import { useToastStore } from '../store/toastStore';
import { t } from '../i18n';
import { logger } from '../utils/logger';

export interface WritingInsightsDialogProps {
  open: boolean;
  /** 书籍 id = 审阅洞察的 analysisId（writing-book 模块 scopeId） */
  bookId: string | null;
  onClose: () => void;
}

/** severity → 指示点颜色（error/warning 之外一律 info 蓝） */
function severityColor(severity: string): string {
  if (severity === 'error') return 'error.main';
  if (severity === 'warning') return 'warning.main';
  return 'info.main';
}

function fmtTime(sec?: number): string {
  if (!sec) return '';
  return new Date(sec * 1000).toLocaleString();
}

export function WritingInsightsDialog({ open, bookId, onClose }: WritingInsightsDialogProps) {
  const [insights, setInsights] = useState<AiInsightDto[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!bookId) return;
    try {
      const rows = await aiContextApi.listAiInsights(bookId);
      // 待处理优先，其次按最近确认时间倒序
      const sorted = [...rows].sort((a, b) => {
        const ao = a.status === 'resolved' ? 1 : 0;
        const bo = b.status === 'resolved' ? 1 : 0;
        if (ao !== bo) return ao - bo;
        return (b.lastSeen ?? b.firstSeen ?? 0) - (a.lastSeen ?? a.firstSeen ?? 0);
      });
      setInsights(sorted);
    } catch (e) {
      logger.warn('WritingPage', 'list insights failed', { error: e });
      useToastStore.getState().error(String(e));
      setInsights([]);
    }
  }, [bookId]);

  useEffect(() => {
    if (!open || !bookId) return;
    setInsights(null);
    setExpandedId(null);
    void reload();
  }, [open, bookId, reload]);

  const handleResolve = useCallback(
    async (id: string) => {
      if (!bookId) return;
      setResolvingId(id);
      try {
        await aiContextApi.resolveAiInsight(bookId, id, t('writing.insightResolvedByUser'), 'user');
        await reload();
      } catch (e) {
        logger.warn('WritingPage', 'resolve insight failed', { error: e });
        useToastStore.getState().error(String(e));
      } finally {
        setResolvingId(null);
      }
    },
    [bookId, reload],
  );

  const openCount = (insights ?? []).filter((i) => i.status !== 'resolved').length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1.5 }}>
        <Typography component="span" sx={{ fontSize: 15, fontWeight: 700 }}>
          {t('writing.insightResults')}
          {insights !== null && openCount > 0 && (
            <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 1 }}>
              {t('writing.insightPending', { n: openCount })}
            </Typography>
          )}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label={t("workbench.close")}>
          <CloseRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 1.5, pt: 0.5 }}>
        {insights === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={22} />
          </Box>
        ) : insights.length === 0 ? (
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', textAlign: 'center', py: 4 }}>
            {t('writing.insightEmpty')}
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {insights.map((it) => {
              const resolved = it.status === 'resolved';
              const expanded = expandedId === it.id;
              return (
                <Box
                  key={it.id}
                  onClick={() => setExpandedId(expanded ? null : it.id)}
                  sx={{
                    px: 1.25,
                    py: 1,
                    borderRadius: 1.5,
                    cursor: 'pointer',
                    bgcolor: 'action.hover',
                    opacity: resolved ? 0.55 : 1,
                    '&:hover': { bgcolor: 'action.selected' },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        flexShrink: 0,
                        bgcolor: severityColor(it.severity),
                      }}
                    />
                    <Typography
                      noWrap
                      sx={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}
                    >
                      {it.title}
                    </Typography>
                    {(it.seenCount ?? 0) > 1 && (
                      <Chip label={t('writing.insightSeenCount', { n: it.seenCount ?? 0 })} size="small" sx={{ height: 18, fontSize: 10.5 }} />
                    )}
                    {resolved ? (
                      <Typography sx={{ fontSize: 10.5, color: 'text.disabled', flexShrink: 0 }}>
                        {t('writing.insightResolvedTag')}
                      </Typography>
                    ) : (
                      <IconButton
                        size="small"
                        color="primary"
                        aria-label={t('writing.insightResolve')}
                        data-testid={`insight-resolve-${it.id}`}
                        disabled={resolvingId === it.id}
                        onClick={(e) => {
                          // 收口是行内动作，不触发行展开
                          e.stopPropagation();
                          void handleResolve(it.id);
                        }}
                      >
                        <CheckCircleRoundedIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    )}
                  </Box>
                  {(expanded || it.title.length <= 30) && (
                    <Typography
                      sx={{
                        fontSize: 12,
                        color: 'text.secondary',
                        mt: 0.5,
                        whiteSpace: 'pre-wrap',
                        display: expanded ? 'block' : '-webkit-box',
                        WebkitLineClamp: expanded ? 'none' : 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {it.body}
                    </Typography>
                  )}
                  <Typography sx={{ fontSize: 10.5, color: 'text.disabled', mt: 0.5 }}>
                    {fmtTime(it.lastSeen ?? it.firstSeen)}
                  </Typography>
                </Box>
              );
            })}
            {insights.some((i) => i.status === 'resolved') && (
              <Button size="small" sx={{ alignSelf: 'center', mt: 0.5 }} onClick={() => void reload()}>
                {t('writing.insightReload')}
              </Button>
            )}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
