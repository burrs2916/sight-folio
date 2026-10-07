import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import type { InlineWritingKind, PolishStyle } from '../../ai/writingAssistant';
import { t } from '../../i18n';
import type { AiAgent } from '../../services/agent';

export interface InlineAiDialogProps {
  open: boolean;
  onClose: () => void;
  kind: InlineWritingKind;
  onKindChange: (k: InlineWritingKind) => void;
  /** 打开时已选中文本的字符数（润色模式明示只改选区） */
  selChars: number;
  agents: AiAgent[];
  agentId: string;
  onAgentChange: (id: string) => void;
  onGoSettings: () => void;
  words: string;
  onWordsChange: (v: string) => void;
  directive: string;
  onDirectiveChange: (v: string) => void;
  style: PolishStyle;
  onStyleChange: (v: PolishStyle) => void;
  running: boolean;
  streamText: string;
  /** 流式预览容器的滚动引用（auto-scroll 由调用方 effect 驱动） */
  streamPreviewRef: React.RefObject<HTMLDivElement | null>;
  /** 停止生成 */
  onStop: () => void;
  /** 发射 */
  onRun: () => void;
}

/**
 * 内联 AI 写作对话框（P7）：模式（续写/润色）+ Agent 均由用户选择；
 * 运行中显示流式预览（auto-scroll 跟底），可中途停止。状态由 useAiActions hook 持有。
 */
export function InlineAiDialog({
  open,
  onClose,
  kind,
  onKindChange,
  selChars,
  agents,
  agentId,
  onAgentChange,
  onGoSettings,
  words,
  onWordsChange,
  directive,
  onDirectiveChange,
  style,
  onStyleChange,
  running,
  streamText,
  streamPreviewRef,
  onStop,
  onRun,
}: InlineAiDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>{t('writing.inlineAi')}</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5, mb: 1 }}>
          {t('writing.inlineHint')}
        </Typography>
        {/* B 选区级润色：打开时已选中文本 → 明示本次只改选区 */}
        {kind === 'polish' && selChars > 0 && (
          <Typography sx={{ fontSize: 12, color: 'primary.main', mb: 1 }}>
            {t('writing.inlineSelectionHint', { n: selChars })}
          </Typography>
        )}
        <FormControl fullWidth sx={{ mb: 1.5 }}>
          <FormLabel sx={{ fontSize: 13 }}>{t('writing.inlineMode')}</FormLabel>
          <RadioGroup row value={kind} onChange={(e) => onKindChange(e.target.value as InlineWritingKind)}>
            <FormControlLabel value="continue" control={<Radio size="small" />} label={t('writing.inlineContinue')} />
            <FormControlLabel value="polish" control={<Radio size="small" />} label={t('writing.inlinePolish')} />
          </RadioGroup>
        </FormControl>
        <FormControl fullWidth>
          <FormLabel sx={{ fontSize: 13 }}>{t('writing.aiAgent')}</FormLabel>
          {agents.length === 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{t('writing.aiNoAgent')}</Typography>
              <Button size="small" variant="outlined" onClick={onGoSettings}>
                {t('writing.aiGoConfigure')}
              </Button>
            </Box>
          ) : (
            <RadioGroup value={agentId} onChange={(e) => onAgentChange(e.target.value)}>
              {agents.map((agent: AiAgent) => (
                <FormControlLabel
                  key={agent.id}
                  value={agent.id}
                  control={<Radio size="small" />}
                  label={<Typography sx={{ fontSize: 13.5 }}>{agent.name}</Typography>}
                />
              ))}
            </RadioGroup>
          )}
        </FormControl>
        {/* P8 参数化：续写 → 字数/走向；润色 → 风格档 */}
        {kind === 'continue' ? (
          <>
            <TextField
              fullWidth
              size="small"
              type="number"
              label={t('writing.continueWords')}
              value={words}
              onChange={(e) => onWordsChange(e.target.value)}
              sx={{ mt: 1.5, '& .MuiInputBase-input': { fontSize: 12.5 } }}
            />
            <TextField
              fullWidth
              size="small"
              multiline
              minRows={2}
              maxRows={4}
              label={t('writing.continueDirective')}
              placeholder={t('writing.continueDirectivePh')}
              value={directive}
              onChange={(e) => onDirectiveChange(e.target.value)}
              sx={{ mt: 1.5, '& .MuiInputBase-input': { fontSize: 12.5 } }}
            />
          </>
        ) : (
          <FormControl fullWidth sx={{ mt: 1.5 }}>
            <FormLabel sx={{ fontSize: 13 }}>{t('writing.polishStyle')}</FormLabel>
            <RadioGroup row value={style} onChange={(e) => onStyleChange(e.target.value as PolishStyle)}>
              <FormControlLabel
                value="default"
                control={<Radio size="small" />}
                label={<Typography sx={{ fontSize: 12.5 }}>{t('writing.styleDefault')}</Typography>}
              />
              <FormControlLabel
                value="refine"
                control={<Radio size="small" />}
                label={<Typography sx={{ fontSize: 12.5 }}>{t('writing.styleRefine')}</Typography>}
              />
              <FormControlLabel
                value="vivid"
                control={<Radio size="small" />}
                label={<Typography sx={{ fontSize: 12.5 }}>{t('writing.styleVivid')}</Typography>}
              />
              <FormControlLabel
                value="plain"
                control={<Radio size="small" />}
                label={<Typography sx={{ fontSize: 12.5 }}>{t('writing.stylePlain')}</Typography>}
              />
            </RadioGroup>
          </FormControl>
        )}
      </DialogContent>
      {/* C 流式预览：运行中边生成边看（auto-scroll 跟底），可中途停止 */}
      {running && (
        <Box sx={{ px: 2, pb: 0.5 }}>
          {streamText ? (
            <Box
              ref={streamPreviewRef}
              sx={{
                maxHeight: 220,
                overflowY: 'auto',
                bgcolor: 'action.hover',
                borderRadius: 1.5,
                p: 1.25,
              }}
            >
              <Typography sx={{ fontSize: 12.5, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{streamText}</Typography>
            </Box>
          ) : (
            <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'center', py: 1 }}>
              {t('writing.inlineStreamingHint')}
            </Typography>
          )}
          <Button size="small" fullWidth color="error" sx={{ mt: 0.5 }} onClick={onStop}>
            {t('writing.inlineStop')}
          </Button>
        </Box>
      )}
      <DialogActions>
        <Button size="small" disabled={running} onClick={onClose}>
          {t('nav.cancel')}
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!agentId || running || agents.length === 0}
          onClick={() => void onRun()}
          startIcon={running ? <CircularProgress size={14} /> : undefined}
        >
          {running ? t('writing.inlineRunning') : t('nav.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
