// sight-folio: Show-not-Tell 顾问面板（写作方案 B3）
// 展示 detectShowTell 识别的情绪直述句：原句 + 直述原因 + 改写方向 + 示范改写，
// 每条可展开召回库内示范句（复用 C3 的 filterReferenceHits 过滤口径）；
// 点击卡片回调上层定位编辑器；交互范式对齐 AiFlavorPanel。
import { t } from '../../i18n';
import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Button from '@mui/material/Button';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import TouchAppRoundedIcon from '@mui/icons-material/TouchAppRounded';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import type { ShowTellIssue, ShowTellKind } from '../../utils/showTell';

export interface ShowTellExample {
  book: string;
  chapter: string;
  content: string;
}

export interface ShowTellPanelProps {
  open: boolean;
  onClose: () => void;
  issues: ShowTellIssue[];
  /** 当前已定位（高亮）issue 的字符串 key，可为空 */
  activeKey?: string;
  onLocate: (issue: ShowTellIssue) => void;
  /** 召回库内示范句（按情绪词检索，内部已过滤为可参考对照句）；返回空数组表示库内无示范 */
  onRecall: (issue: ShowTellIssue) => Promise<ShowTellExample[]>;
  labels: {
    title: string;
    empty: string;
    hint: string;
    told: string;
    directions: string;
    rewriteExample: string;
    recall: string;
    recalling: string;
    recalled: string;
    noRecall: string;
    locate: string;
    count: string;
  };
  kindLabels: Record<ShowTellKind, string>;
}

const KIND_COLORS: Record<ShowTellKind, string> = {
  joy: '#f9a825',
  sadness: '#5c6bc0',
  fear: '#8e24aa',
  anger: '#e53935',
  love: '#ec407a',
  calm: '#26a69a',
  tension: '#7c4dff',
  general: '#757575',
};

function segKey(i: ShowTellIssue): string {
  return `${i.start}:${i.end}`;
}

export function ShowTellPanel({
  open,
  onClose,
  issues,
  activeKey,
  onLocate,
  onRecall,
  labels,
  kindLabels,
}: ShowTellPanelProps) {
  // 每条的召回态：key → { loading } | { done, examples }
  const [recallState, setRecallState] = useState<
    Record<string, { loading: boolean; done: boolean; examples: ShowTellExample[] }>
  >({});

  const recallFor = async (issue: ShowTellIssue) => {
    const key = segKey(issue);
    setRecallState((prev) => ({ ...prev, [key]: { loading: true, done: false, examples: [] } }));
    try {
      const examples = await onRecall(issue);
      setRecallState((prev) => ({ ...prev, [key]: { loading: false, done: true, examples } }));
    } catch {
      setRecallState((prev) => ({ ...prev, [key]: { loading: false, done: true, examples: [] } }));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 1 }}>
        <VisibilityRoundedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>{labels.title}</Box>
        <IconButton size="small" onClick={onClose} aria-label={t('ui.close')}>
          <CloseRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 1.5, minHeight: 160, maxHeight: 460, overflowY: 'auto' }}>
        <Stack direction="row" spacing={0.75} sx={{ mb: 1.25, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip
            size="small"
            label={labels.count.replace('{n}', String(issues.length))}
            color={issues.length ? 'default' : 'success'}
            variant={issues.length ? 'outlined' : 'filled'}
          />
        </Stack>
        {issues.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CheckCircleOutlineRoundedIcon sx={{ fontSize: 34, color: 'success.main', mb: 1 }} />
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{labels.empty}</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 0.5 }}>{labels.hint}</Typography>
          </Box>
        ) : (
          <Stack spacing={1}>
            {issues.map((issue, idx) => {
              const key = segKey(issue);
              const active = key === activeKey;
              const st = recallState[key];
              return (
                <Box
                  key={`${key}-${idx}`}
                  data-testid="showtell-card"
                  onClick={() => onLocate(issue)}
                  sx={{
                    px: 1,
                    py: 0.75,
                    borderRadius: 1,
                    border: 1,
                    borderColor: active ? 'primary.main' : 'divider',
                    bgcolor: active ? 'action.selected' : 'background.paper',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 13, color: 'text.primary' }}>「{issue.excerpt}」</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25 }}>
                        <Typography
                          sx={{ fontSize: 11, fontWeight: 700, color: KIND_COLORS[issue.emotionKind], flexShrink: 0 }}
                        >
                          {kindLabels[issue.emotionKind]}
                        </Typography>
                        <Typography sx={{ fontSize: 11, color: 'text.disabled', minWidth: 0 }}>
                          {issue.short}
                        </Typography>
                      </Box>
                    </Box>
                    <Tooltip title={labels.locate}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          onLocate(issue);
                        }}
                        aria-label={labels.locate}
                      >
                        <TouchAppRoundedIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <Box sx={{ pt: 0.5 }}>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 700 }}>
                      {labels.directions}
                    </Typography>
                    {issue.directions.map((d) => (
                      <Typography key={d} sx={{ fontSize: 11.5, color: 'text.primary', mt: 0.25 }}>
                        · {d}
                      </Typography>
                    ))}
                    <Typography sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 700, mt: 0.75 }}>
                      {labels.rewriteExample}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'primary.main', mt: 0.25 }}>
                      {issue.rewriteExample}
                    </Typography>
                    <Box sx={{ mt: 0.75 }}>
                      {!st ? (
                        <Button
                          size="small"
                          variant="outlined"
                          color="inherit"
                          startIcon={<MenuBookRoundedIcon sx={{ fontSize: 15 }} />}
                          onClick={(e) => {
                            e.stopPropagation();
                            void recallFor(issue);
                          }}
                          aria-label={labels.recall}
                        >
                          {labels.recall}
                        </Button>
                      ) : st.loading ? (
                        <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>{labels.recalling}</Typography>
                      ) : (
                        <Box>
                          {st.examples.length > 0 ? (
                            <>
                              <Typography sx={{ fontSize: 11, color: 'text.disabled', mb: 0.25 }}>
                                {labels.recalled}
                              </Typography>
                              {st.examples.slice(0, 3).map((ex, i) => (
                                <Box
                                  key={`${ex.book}-${ex.chapter}-${i}`}
                                  sx={{
                                    border: 1,
                                    borderColor: 'divider',
                                    borderRadius: 1,
                                    px: 0.75,
                                    py: 0.5,
                                    mb: 0.5,
                                    bgcolor: 'action.hover',
                                  }}
                                >
                                  <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>
                                    {ex.book} · {ex.chapter}
                                  </Typography>
                                  <Typography sx={{ fontSize: 12, color: 'text.primary' }}>{ex.content}</Typography>
                                </Box>
                              ))}
                            </>
                          ) : (
                            <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>{labels.noRecall}</Typography>
                          )}
                        </Box>
                      )}
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
