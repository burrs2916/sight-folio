// sight-folio: 校对问题列表面板（批次③ T5）
// 展示 runProofread 的结果；点击条目回调上层将编辑器定位到对应文本区间。
import { t } from '../../i18n';
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
import LibraryBooksRoundedIcon from '@mui/icons-material/LibraryBooksRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SpellcheckRoundedIcon from '@mui/icons-material/SpellcheckRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import GppBadRoundedIcon from '@mui/icons-material/GppBadRounded';
import RepeatRoundedIcon from '@mui/icons-material/RepeatRounded';
import FormatQuoteRoundedIcon from '@mui/icons-material/FormatQuoteRounded';
import TipsAndUpdatesRoundedIcon from '@mui/icons-material/TipsAndUpdatesRounded';
import TouchAppRoundedIcon from '@mui/icons-material/TouchAppRounded';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import type { ProofreadIssue } from '../../editor/proofread/proofreadEngine';
import { uiFontSize } from '../../theme/appearanceScales';

export interface ProofreadPanelProps {
  open: boolean;
  onClose: () => void;
  issues: ProofreadIssue[];
  /** 当前已定位（高亮）的 issue 的字符串 key，可为空 */
  activeKey?: string;
  onLocate: (issue: ProofreadIssue) => void;
  /** 一键修复：仅带 fix 的条目提供；为空时不显示修复按钮 */
  onFix?: (issue: ProofreadIssue) => void;
  /**
   * 打开自定义词库。入口放在这里而不是全局设置，是因为作者最想要"这条别再报"
   * 的时刻，就是**正看着这条误报**的时刻。
   */
  onOpenLexicon?: () => void;
  /** 自定义词条数（>0 时入口带角标，让作者知道词库不是空的） */
  customEntryCount?: number;
  labels: {
    title: string;
    empty: string;
    hint: string;
    typo: string;
    repeat: string;
    sensitive: string;
    punct: string;
    redundant?: string;
    count: string;
    locate: string;
    fix?: string;
  };
}

function issueKey(i: ProofreadIssue): string {
  return `${i.kind}:${i.start}:${i.end}`;
}

/** 去掉 excerpt 两侧 padding，返回真正的命中片段 */
function rawExcerpt(i: ProofreadIssue, text?: string): string {
  if (text && i.start >= 0 && i.end > i.start && i.end <= text.length) {
    return text.slice(i.start, i.end);
  }
  return i.excerpt;
}

export function ProofreadPanel({
  open,
  onClose,
  issues,
  activeKey,
  onLocate,
  onFix,
  labels,
  onOpenLexicon,
  customEntryCount = 0,
}: ProofreadPanelProps) {
  const typoCount = issues.filter((i) => i.kind === 'typo').length;
  const repeatCount = issues.filter((i) => i.kind === 'repeat').length;
  const sensitiveCount = issues.filter((i) => i.kind === 'sensitive').length;
  const punctCount = issues.filter((i) => i.kind === 'punct').length;
  const redundantCount = issues.filter((i) => i.kind === 'redundant').length;

  const kindMeta = (i: ProofreadIssue) => {
    if (i.kind === 'typo') {
      return {
        icon: <ErrorOutlineRoundedIcon sx={{ fontSize: uiFontSize(16), color: 'warning.main' }} />,
        label: labels.typo,
        color: 'warning.main' as const,
      };
    }
    if (i.kind === 'repeat') {
      return {
        icon: <RepeatRoundedIcon sx={{ fontSize: uiFontSize(16), color: 'info.main' }} />,
        label: labels.repeat,
        color: 'info.main' as const,
      };
    }
    if (i.kind === 'punct') {
      return {
        icon: <FormatQuoteRoundedIcon sx={{ fontSize: uiFontSize(16), color: 'success.main' }} />,
        label: labels.punct,
        color: 'success.main' as const,
      };
    }
    if (i.kind === 'redundant') {
      return {
        icon: <TipsAndUpdatesRoundedIcon sx={{ fontSize: uiFontSize(16), color: 'secondary.main' }} />,
        label: labels.redundant ?? '',
        color: 'secondary.main' as const,
      };
    }
    return {
      icon: (
        <GppBadRoundedIcon
          sx={{ fontSize: uiFontSize(16), color: i.severity === 'block' ? 'error.main' : 'secondary.main' }}
        />
      ),
      label: labels.sensitive,
      color: 'error.main' as const,
    };
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: uiFontSize(15), display: 'flex', alignItems: 'center', gap: 1 }}>
        <SpellcheckRoundedIcon sx={{ fontSize: uiFontSize(18), color: 'text.secondary' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>{labels.title}</Box>
        {onOpenLexicon && (
          <Tooltip title={t('writing.lexiconHint')}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Button
                size="small"
                startIcon={<LibraryBooksRoundedIcon sx={{ fontSize: uiFontSize(15) }} />}
                endIcon={
                  customEntryCount > 0 ? (
                    <Chip size="small" label={customEntryCount} sx={{ height: 16, fontSize: uiFontSize(11) }} />
                  ) : undefined
                }
                onClick={onOpenLexicon}
                sx={{ textTransform: 'none', fontSize: uiFontSize(12) }}
              >
                {t('writing.lexiconEntry')}
              </Button>
            </Box>
          </Tooltip>
        )}
        <IconButton size="small" onClick={onClose} aria-label={t('ui.close')}>
          <CloseRoundedIcon sx={{ fontSize: uiFontSize(18) }} />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 1.5, minHeight: 160, maxHeight: 420, overflowY: 'auto' }}>
        <Stack direction="row" spacing={0.75} sx={{ mb: 1.25, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip
            size="small"
            label={labels.count.replace('{n}', String(issues.length))}
            color={issues.length ? 'default' : 'success'}
            variant={issues.length ? 'outlined' : 'filled'}
          />
          {typoCount > 0 && (
            <Chip size="small" label={`${labels.typo} ${typoCount}`} color="warning" variant="outlined" />
          )}
          {repeatCount > 0 && (
            <Chip size="small" label={`${labels.repeat} ${repeatCount}`} color="info" variant="outlined" />
          )}
          {sensitiveCount > 0 && (
            <Chip size="small" label={`${labels.sensitive} ${sensitiveCount}`} color="error" variant="outlined" />
          )}
          {punctCount > 0 && (
            <Chip size="small" label={`${labels.punct} ${punctCount}`} color="success" variant="outlined" />
          )}
          {redundantCount > 0 && labels.redundant && (
            <Chip size="small" label={`${labels.redundant} ${redundantCount}`} color="secondary" variant="outlined" />
          )}
        </Stack>
        {issues.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <SpellcheckRoundedIcon sx={{ fontSize: uiFontSize(34), color: 'success.main', mb: 1 }} />
            <Typography sx={{ fontSize: uiFontSize(13), color: 'text.secondary' }}>{labels.empty}</Typography>
            <Typography sx={{ fontSize: uiFontSize(11), color: 'text.disabled', mt: 0.5 }}>{labels.hint}</Typography>
          </Box>
        ) : (
          <Stack spacing={0.75}>
            {issues.map((issue, idx) => {
              const meta = kindMeta(issue);
              const key = issueKey(issue);
              const active = key === activeKey;
              return (
                <Box
                  key={`${key}-${idx}`}
                  onClick={() => onLocate(issue)}
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1,
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
                  <Box sx={{ mt: 0.15, display: 'flex', alignItems: 'center' }}>{meta.icon}</Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Typography sx={{ fontSize: uiFontSize(11), fontWeight: 700, color: meta.color, flexShrink: 0 }}>
                        {meta.label}
                      </Typography>
                      {issue.severity === 'block' && (
                        <Chip
                          size="small"
                          label={t('writing.proofreadBlock')}
                          color="error"
                          sx={{ height: 16, fontSize: uiFontSize(10) }}
                        />
                      )}
                      {issue.suggestion && (
                        <Typography sx={{ fontSize: uiFontSize(11), color: 'text.secondary', minWidth: 0 }}>
                          {issue.suggestion}
                        </Typography>
                      )}
                    </Box>
                    <Typography
                      sx={{
                        fontSize: uiFontSize(12.5),
                        color: 'text.primary',
                        mt: 0.25,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      「{rawExcerpt(issue)}」
                    </Typography>
                  </Box>
                  <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    {issue.fix && onFix && (
                      <Tooltip title={labels.fix ?? ''}>
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            onFix(issue);
                          }}
                          aria-label={labels.fix ?? 'fix'}
                        >
                          <AutoFixHighRoundedIcon sx={{ fontSize: uiFontSize(15) }} />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title={labels.locate}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          onLocate(issue);
                        }}
                        aria-label={labels.locate}
                      >
                        <TouchAppRoundedIcon sx={{ fontSize: uiFontSize(15) }} />
                      </IconButton>
                    </Tooltip>
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
