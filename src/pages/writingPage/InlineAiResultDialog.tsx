import { useRef, useState } from 'react';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import type { InlineWritingKind } from '../../ai/writingAssistant';
import { parseReviewEntries, type ReviewEntry } from '../../ai/writingAssistant';
import { t } from '../../i18n';
import { uiFontSize } from '../../theme/appearanceScales';

export interface InlineAiResult {
  kind: InlineWritingKind;
  text: string;
  selectionChars?: number;
}

export interface InlineAiResultDialogProps {
  result: InlineAiResult | null;
  onClose: () => void;
  onApply: () => void;
  /** 逐句审校专用：逐条确认后应用（替换正文中的原句）；缺省时审校结果保持只读预览 */
  onApplyReviewEntry?: (entry: ReviewEntry) => void;
}

const KIND_TITLES: Record<InlineWritingKind, string> = {
  continue: 'writing.resultContinueTitle',
  polish: 'writing.resultPolishTitle',
  rewrite: 'writing.resultRewriteTitle',
  summarize: 'writing.resultSummarizeTitle',
  review: 'writing.resultReviewTitle',
};

/** 内联 AI 结果预览：用户确认后才动正文，绝无静默改写 */
export function InlineAiResultDialog({ result, onClose, onApply, onApplyReviewEntry }: InlineAiResultDialogProps) {
  const kind = result?.kind;
  // 选区级任务（改写/润色）且带选区信息 → 附加替换提示；总结不写回，无应用按钮
  const appliesToSelection = kind === 'polish' || kind === 'rewrite';
  // 逐句审校：解析出条目就逐条呈现（每条可确认应用）；解析不出（如「未发现明显语法问题」）退回纯文本预览
  const reviewEntries = kind === 'review' && result ? parseReviewEntries(result.text) : [];
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());
  // 同步防重：state 在两次连续点击之间尚未重渲染，用 ref 同步拦截，杜绝重复应用改写
  const appliedRef = useRef<Set<string>>(new Set());

  const entryKey = (e: ReviewEntry) => `${e.index}|${e.original}|${e.suggestion}`;

  const applyEntry = (entry: ReviewEntry) => {
    const key = entryKey(entry);
    if (appliedRef.current.has(key)) return;
    appliedRef.current.add(key);
    setAppliedKeys(new Set(appliedRef.current));
    onApplyReviewEntry?.(entry);
  };

  return (
    <Dialog open={result !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: uiFontSize(15) }}>
        {kind ? t(KIND_TITLES[kind]) : ''}
        {appliesToSelection && result?.selectionChars != null && (
          <Typography
            component="span"
            sx={{ fontSize: uiFontSize(12), fontWeight: 400, color: 'text.secondary', ml: 1 }}
          >
            {t('writing.resultReplaceSelection', { n: result.selectionChars })}
          </Typography>
        )}
        {/* 润色/改写发起时无选区 → AI 走「整章润色」，应用即 setContent 替换整章正文。
            旧版只在有选区时给「替换 N 字」提示，无选区时不加任何警示，用户易误以为只改
            当前段。这里补一条醒目的「将替换整章」警示，避免误覆盖原稿（数据丢失体验风险）。 */}
        {appliesToSelection && result?.selectionChars == null && (
          <Typography component="span" sx={{ fontSize: uiFontSize(12), fontWeight: 500, color: 'warning.main', ml: 1 }}>
            {t('writing.resultReplaceWholeChapter')}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent>
        {kind === 'review' && reviewEntries.length > 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 440, overflowY: 'auto' }}>
            <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary' }}>
              {t('writing.resultReviewListHint')}
            </Typography>
            {reviewEntries.map((entry, idx) => {
              const key = entryKey(entry);
              const applied = appliedKeys.has(key);
              return (
                <Box
                  key={`${key}-${idx}`}
                  sx={{
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    p: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.5,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Chip
                      size="small"
                      label={t('writing.corpusSentenceSeq', { n: entry.index })}
                      color="secondary"
                      variant="outlined"
                      sx={{ height: 18, fontSize: uiFontSize(10.5) }}
                    />
                    {entry.issue && (
                      <Chip
                        size="small"
                        label={entry.issue}
                        color="default"
                        variant="outlined"
                        sx={{ height: 18, fontSize: uiFontSize(10.5) }}
                      />
                    )}
                    <Box sx={{ flex: 1 }} />
                    {onApplyReviewEntry && (
                      <Button
                        size="small"
                        variant={applied ? 'outlined' : 'contained'}
                        color="primary"
                        disabled={applied}
                        onClick={() => applyEntry(entry)}
                      >
                        {applied ? t('writing.resultReviewApplied') : t('writing.resultReviewApply')}
                      </Button>
                    )}
                  </Box>
                  <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.primary', lineHeight: 1.7 }}>
                    <Box component="span" sx={{ color: 'text.disabled', mr: 0.5 }}>
                      原句
                    </Box>
                    {entry.original}
                  </Typography>
                  <Typography sx={{ fontSize: uiFontSize(12.5), color: 'success.main', lineHeight: 1.7 }}>
                    <Box component="span" sx={{ color: 'text.disabled', mr: 0.5 }}>
                      建议
                    </Box>
                    {entry.suggestion}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        ) : (
          <Box sx={{ maxHeight: 420, overflowY: 'auto', bgcolor: 'action.hover', borderRadius: 1.5, p: 1.5 }}>
            <Typography sx={{ fontSize: uiFontSize(13.5), lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>
              {result?.text}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          {t('writing.discard')}
        </Button>
        {kind !== 'summarize' && kind !== 'review' && (
          <Button size="small" variant="contained" onClick={onApply}>
            {kind === 'continue' ? t('writing.insertToChapter') : t('writing.applyToChapter')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
