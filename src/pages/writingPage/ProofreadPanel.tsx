// sight-folio: 校对问题列表面板（批次③ T5）
// 展示 runProofread 的结果；点击条目回调上层将编辑器定位到对应文本区间。
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SpellcheckRoundedIcon from '@mui/icons-material/SpellcheckRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import GppBadRoundedIcon from '@mui/icons-material/GppBadRounded';
import RepeatRoundedIcon from '@mui/icons-material/RepeatRounded';
import TouchAppRoundedIcon from '@mui/icons-material/TouchAppRounded';
import type { ProofreadIssue } from '../../editor/proofread/proofreadEngine';

export interface ProofreadPanelProps {
  open: boolean;
  onClose: () => void;
  issues: ProofreadIssue[];
  /** 当前已定位（高亮）的 issue 的字符串 key，可为空 */
  activeKey?: string;
  onLocate: (issue: ProofreadIssue) => void;
  labels: {
    title: string;
    empty: string;
    hint: string;
    typo: string;
    repeat: string;
    sensitive: string;
    count: string;
    locate: string;
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

export function ProofreadPanel({ open, onClose, issues, activeKey, onLocate, labels }: ProofreadPanelProps) {
  const typoCount = issues.filter((i) => i.kind === 'typo').length;
  const repeatCount = issues.filter((i) => i.kind === 'repeat').length;
  const sensitiveCount = issues.filter((i) => i.kind === 'sensitive').length;

  const kindMeta = (i: ProofreadIssue) => {
    if (i.kind === 'typo') {
      return {
        icon: <ErrorOutlineRoundedIcon sx={{ fontSize: 16, color: 'warning.main' }} />,
        label: labels.typo,
        color: 'warning.main' as const,
      };
    }
    if (i.kind === 'repeat') {
      return {
        icon: <RepeatRoundedIcon sx={{ fontSize: 16, color: 'info.main' }} />,
        label: labels.repeat,
        color: 'info.main' as const,
      };
    }
    return {
      icon: (
        <GppBadRoundedIcon sx={{ fontSize: 16, color: i.severity === 'block' ? 'error.main' : 'secondary.main' }} />
      ),
      label: labels.sensitive,
      color: 'error.main' as const,
    };
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 1 }}>
        <SpellcheckRoundedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>{labels.title}</Box>
        <IconButton size="small" onClick={onClose} aria-label="close">
          <CloseRoundedIcon sx={{ fontSize: 18 }} />
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
        </Stack>
        {issues.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <SpellcheckRoundedIcon sx={{ fontSize: 34, color: 'success.main', mb: 1 }} />
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{labels.empty}</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 0.5 }}>{labels.hint}</Typography>
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
                      <Typography sx={{ fontSize: 11, fontWeight: 700, color: meta.color, flexShrink: 0 }}>
                        {meta.label}
                      </Typography>
                      {issue.severity === 'block' && (
                        <Chip size="small" label="block" color="error" sx={{ height: 16, fontSize: 10 }} />
                      )}
                      {issue.suggestion && (
                        <Typography sx={{ fontSize: 11, color: 'text.secondary', minWidth: 0 }}>
                          {issue.suggestion}
                        </Typography>
                      )}
                    </Box>
                    <Typography
                      sx={{
                        fontSize: 12.5,
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
              );
            })}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
