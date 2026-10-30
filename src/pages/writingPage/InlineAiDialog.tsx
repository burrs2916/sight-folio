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
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { InlineWritingKind, PolishStyle } from '../../ai/writingAssistant';
import { t } from '../../i18n';
import type { AiAgent } from '../../services/agent';

/** 模式清单与文案键：既用于渲染，也用于 running 时统一禁用（漏一项就是漏锁） */
const INLINE_KINDS: InlineWritingKind[] = ['continue', 'polish', 'rewrite', 'summarize', 'review'];
const KIND_LABEL_KEYS: Record<InlineWritingKind, string> = {
  continue: 'writing.inlineContinue',
  polish: 'writing.inlinePolish',
  rewrite: 'writing.inlineRewrite',
  summarize: 'writing.inlineSummarize',
  review: 'writing.inlineReview',
};
const POLISH_STYLES: PolishStyle[] = ['default', 'refine', 'vivid', 'plain'];
const STYLE_LABEL_KEYS: Record<PolishStyle, string> = {
  default: 'writing.styleDefault',
  refine: 'writing.styleRefine',
  vivid: 'writing.styleVivid',
  plain: 'writing.stylePlain',
};

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
  /** 文风一致性开关（P0）：开启时生成类任务注入文风指纹 */
  styleConsistency: boolean;
  onStyleConsistencyChange: (v: boolean) => void;
  /** 当前书样本是否足够生成文风指纹（不足时开关禁用并提示） */
  styleFingerprintAvailable: boolean;
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
  styleConsistency,
  onStyleConsistencyChange,
  styleFingerprintAvailable,
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
        {/* B 选区级任务：打开时已选中文本 → 明示本次只作用于选区（改写/润色） */}
        {(kind === 'polish' || kind === 'rewrite') && selChars > 0 && (
          <Typography sx={{ fontSize: 12, color: 'primary.main', mb: 1 }}>
            {t('writing.inlineSelectionHint', { n: selChars })}
          </Typography>
        )}
        {/* 需求缺口③：改写/润色在无选区时走「整章处理」，应用即替换整章正文。
            旧版只在有选区时给提示、无选区时一片空白，用户易误以为仍只改当前段。
            这里补一条发起前就看得见的整章警示（纯文案，不改行为——无选区润色=整章
            替换是刻意设计：见 buildPolishMessage 走「整章润色」）。 */}
        {(kind === 'polish' || kind === 'rewrite') && selChars === 0 && (
          <Typography sx={{ fontSize: 12, color: 'warning.main', mb: 1 }}>
            {t('writing.inlineWholeChapterHint')}
          </Typography>
        )}
        <FormControl fullWidth sx={{ mb: 1.5 }}>
          <FormLabel sx={{ fontSize: 13 }}>{t('writing.inlineMode')}</FormLabel>
          <RadioGroup
            row
            sx={{ flexWrap: 'wrap' }}
            value={kind}
            onChange={(e) => onKindChange(e.target.value as InlineWritingKind)}
          >
            {INLINE_KINDS.map((k) => (
              <FormControlLabel
                key={k}
                value={k}
                control={<Radio size="small" disabled={running} />}
                label={t(KIND_LABEL_KEYS[k])}
              />
            ))}
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
                  control={<Radio size="small" disabled={running} />}
                  label={<Typography sx={{ fontSize: 13.5 }}>{agent.name}</Typography>}
                />
              ))}
            </RadioGroup>
          )}
        </FormControl>
        {/* P8 参数化：续写 → 字数/走向；改写/润色 → 风格档；总结 → 无参数 */}
        {kind === 'continue' ? (
          <>
            <TextField
              fullWidth
              size="small"
              type="number"
              label={t('writing.continueWords')}
              value={words}
              disabled={running}
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
              disabled={running}
              onChange={(e) => onDirectiveChange(e.target.value)}
              sx={{ mt: 1.5, '& .MuiInputBase-input': { fontSize: 12.5 } }}
            />
          </>
        ) : kind === 'polish' || kind === 'rewrite' ? (
          <FormControl fullWidth sx={{ mt: 1.5 }}>
            <FormLabel sx={{ fontSize: 13 }}>{t('writing.polishStyle')}</FormLabel>
            <RadioGroup row value={style} onChange={(e) => onStyleChange(e.target.value as PolishStyle)}>
              {POLISH_STYLES.map((st) => (
                <FormControlLabel
                  key={st}
                  value={st}
                  control={<Radio size="small" disabled={running} />}
                  label={<Typography sx={{ fontSize: 12.5 }}>{t(STYLE_LABEL_KEYS[st])}</Typography>}
                />
              ))}
            </RadioGroup>
          </FormControl>
        ) : kind === 'summarize' ? (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.5 }}>
            {t('writing.inlineSummarizeHint')}
          </Typography>
        ) : (
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.5 }}>
            {t('writing.inlineReviewHint')}
          </Typography>
        )}
        {/* P0 文风一致性：生成类任务（续写/润色/改写）可开启，让输出贴近已写章节的语言风格 */}
        {(kind === 'continue' || kind === 'polish' || kind === 'rewrite') && (
          <FormControl fullWidth sx={{ mt: 1.5 }}>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={styleConsistency}
                  disabled={!styleFingerprintAvailable || running}
                  onChange={(e) => onStyleConsistencyChange(e.target.checked)}
                />
              }
              label={
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  <Typography sx={{ fontSize: 12.5 }}>{t('writing.styleConsistencyLabel')}</Typography>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.5 }}>
                    {styleFingerprintAvailable
                      ? t('writing.styleConsistencyHint')
                      : t('writing.styleConsistencyUnavailable')}
                  </Typography>
                </Box>
              }
              sx={{ alignItems: 'flex-start', ml: 0 }}
            />
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
          <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mt: 0.5, textAlign: 'center' }}>
            {t('writing.inlineLockedHint')}
          </Typography>
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
