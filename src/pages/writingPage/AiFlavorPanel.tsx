// sight-folio: AI 味检测结果面板（写作方案 A2 · 统计层）
// 展示 detectAiFlavor 的结果；点击条目回调上层将编辑器定位到对应文本区间。
// 交互范式对齐 ProofreadPanel（问题列表 + 定位 + 维度计数 chip 汇总）。
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
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import HorizontalRuleRoundedIcon from '@mui/icons-material/HorizontalRuleRounded';
import FormatQuoteRoundedIcon from '@mui/icons-material/FormatQuoteRounded';
import TouchAppRoundedIcon from '@mui/icons-material/TouchAppRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CompareArrowsRoundedIcon from '@mui/icons-material/CompareArrowsRounded';
import type { AiFlavorIssue } from '../../editor/proofread/aiFlavorEngine';
import { uiFontSize } from '../../theme/appearanceScales';

export interface AiFlavorPanelProps {
  open: boolean;
  onClose: () => void;
  issues: AiFlavorIssue[];
  /** 当前已定位（高亮）的 issue 的字符串 key，可为空 */
  activeKey?: string;
  onLocate: (issue: AiFlavorIssue) => void;
  /** 请求打开 AI 审视对话框做深度语义审校（LLM 层） */
  onDeepReview: () => void;
  /** C3：把该问题句送入写法对照工作台（召回库内优质句对照改写）；未提供时隐藏入口 */
  onCompare?: (issue: AiFlavorIssue) => void;
  labels: {
    title: string;
    empty: string;
    hint: string;
    template: string;
    rhythm: string;
    punctuation: string;
    vague: string;
    count: string;
    locate: string;
    deepReview: string;
    /** C3 对照改写入口标题（onCompare 未提供时忽略） */
    compare?: string;
  };
}

function issueKey(i: AiFlavorIssue): string {
  return `${i.kind}:${i.start}:${i.end}`;
}

export function AiFlavorPanel({
  open,
  onClose,
  issues,
  activeKey,
  onLocate,
  onDeepReview,
  onCompare,
  labels,
}: AiFlavorPanelProps) {
  const templateCount = issues.filter((i) => i.kind === 'template').length;
  const rhythmCount = issues.filter((i) => i.kind === 'rhythm').length;
  const punctuationCount = issues.filter((i) => i.kind === 'punctuation').length;
  const vagueCount = issues.filter((i) => i.kind === 'vague').length;

  const kindMeta = (i: AiFlavorIssue) => {
    if (i.kind === 'template') {
      return {
        icon: <AutoAwesomeRoundedIcon sx={{ fontSize: uiFontSize(16), color: 'error.main' }} />,
        label: labels.template,
        color: 'error.main' as const,
      };
    }
    if (i.kind === 'rhythm') {
      return {
        icon: <SyncRoundedIcon sx={{ fontSize: uiFontSize(16), color: 'info.main' }} />,
        label: labels.rhythm,
        color: 'info.main' as const,
      };
    }
    if (i.kind === 'punctuation') {
      return {
        icon: <HorizontalRuleRoundedIcon sx={{ fontSize: uiFontSize(16), color: 'secondary.main' }} />,
        label: labels.punctuation,
        color: 'secondary.main' as const,
      };
    }
    return {
      icon: <FormatQuoteRoundedIcon sx={{ fontSize: uiFontSize(16), color: 'warning.main' }} />,
      label: labels.vague,
      color: 'warning.main' as const,
    };
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: uiFontSize(15), display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoAwesomeRoundedIcon sx={{ fontSize: uiFontSize(18), color: 'text.secondary' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>{labels.title}</Box>
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
          {templateCount > 0 && (
            <Chip size="small" label={`${labels.template} ${templateCount}`} color="error" variant="outlined" />
          )}
          {vagueCount > 0 && (
            <Chip size="small" label={`${labels.vague} ${vagueCount}`} color="warning" variant="outlined" />
          )}
          {rhythmCount > 0 && (
            <Chip size="small" label={`${labels.rhythm} ${rhythmCount}`} color="info" variant="outlined" />
          )}
          {punctuationCount > 0 && (
            <Chip
              size="small"
              label={`${labels.punctuation} ${punctuationCount}`}
              color="secondary"
              variant="outlined"
            />
          )}
        </Stack>
        {issues.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <AutoAwesomeRoundedIcon sx={{ fontSize: uiFontSize(34), color: 'success.main', mb: 1 }} />
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
                      「{issue.excerpt}」
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
                      <TouchAppRoundedIcon sx={{ fontSize: uiFontSize(15) }} />
                    </IconButton>
                  </Tooltip>
                  {onCompare && (
                    <Tooltip title={labels.compare ?? ''}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCompare(issue);
                        }}
                        aria-label={labels.compare}
                      >
                        <CompareArrowsRoundedIcon sx={{ fontSize: uiFontSize(15) }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.25 }}>
          <Button size="small" variant="text" color="primary" onClick={onDeepReview} aria-label={labels.deepReview}>
            {labels.deepReview}
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
