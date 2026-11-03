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
  Typography,
} from '@mui/material';
import { t } from '../../i18n';
import type { AiAgent } from '../../services/agent';
import type { SettingCardKind } from '../../ai/writingAssistant';
import { uiFontSize } from '../../theme/appearanceScales';

export interface SettingAiResult {
  kind: SettingCardKind;
  fields: { key: string; value: string }[];
}

export interface SettingAiCompleteDialogProps {
  open: boolean;
  onClose: () => void;
  agents: AiAgent[];
  agentId: string;
  onAgentChange: (id: string) => void;
  onGoSettings: () => void;
  running: boolean;
  streamText: string;
  /** 解析出的字段建议（null = 尚未出结果） */
  result: SettingAiResult | null;
  /** 发射补全 */
  onRun: () => void;
  /** 将全部字段建议回填到卡片 */
  onApply: () => void;
}

/** 字段英文键 → i18n 键（写作台设定卡的既有本地化标签） */
const FIELD_LABEL_KEYS: Record<string, string> = {
  appearance: 'writing.appearance',
  personality: 'writing.personality',
  motivation: 'writing.motivation',
  catchphrase: 'writing.catchphrase',
  notes: 'writing.notes',
  type: 'writing.wbType',
  rules: 'writing.wbRules',
  exceptions: 'writing.wbExceptions',
  linkedTo: 'writing.wbLinkedTo',
};

/**
 * 设定卡 AI 补全对话框（P0）：选择 Agent → 生成 → 字段建议列表 → 确认回填。
 * 与内联 AI 对话框同风格（Agent 单选 + 流式预览），回填由父组件一次性写入草稿。
 */
export function SettingAiCompleteDialog({
  open,
  onClose,
  agents,
  agentId,
  onAgentChange,
  onGoSettings,
  running,
  streamText,
  result,
  onRun,
  onApply,
}: SettingAiCompleteDialogProps) {
  const fields = result?.fields ?? [];
  const hasFields = fields.length > 0;
  return (
    <Dialog open={open} onClose={running ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: uiFontSize(15) }}>{t('writing.settingAiTitle')}</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', mt: 0.5, mb: 1 }}>
          {t('writing.settingAiHint')}
        </Typography>
        {!hasFields ? (
          <>
            <FormControl fullWidth>
              <FormLabel sx={{ fontSize: uiFontSize(13) }}>{t('writing.aiAgent')}</FormLabel>
              {agents.length === 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
                  <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.secondary' }}>
                    {t('writing.aiNoAgent')}
                  </Typography>
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
                      label={<Typography sx={{ fontSize: uiFontSize(13.5) }}>{agent.name}</Typography>}
                    />
                  ))}
                </RadioGroup>
              )}
            </FormControl>
            {/* 未解析出字段但已有流式原文：展开原文供复制（本次补全不写回） */}
            {!running && streamText && !fields.length && (
              <Box
                sx={{
                  maxHeight: 200,
                  overflowY: 'auto',
                  bgcolor: 'action.hover',
                  borderRadius: 1.5,
                  p: 1.25,
                  mt: 1.5,
                }}
              >
                <Typography sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                  {streamText}
                </Typography>
                <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary', mt: 0.5 }}>
                  {t('writing.settingAiUnparsed')}
                </Typography>
              </Box>
            )}
          </>
        ) : (
          // 字段建议列表：每条（标签 + 内容）预览，确认后一并回填
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {fields.map((f) => (
              <Box key={f.key} sx={{ bgcolor: 'action.hover', borderRadius: 1.5, p: 1.25 }}>
                <Typography sx={{ fontSize: uiFontSize(12), fontWeight: 700, color: 'primary.main', mb: 0.25 }}>
                  {t(FIELD_LABEL_KEYS[f.key] ?? f.key)}
                </Typography>
                <Typography sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                  {f.value}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
        {/* 运行中：流式预览 + 停止 */}
        {running && (
          <Box sx={{ mt: 1.5 }}>
            {streamText ? (
              <Box sx={{ maxHeight: 200, overflowY: 'auto', bgcolor: 'action.hover', borderRadius: 1.5, p: 1.25 }}>
                <Typography sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                  {streamText}
                </Typography>
              </Box>
            ) : (
              <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', textAlign: 'center', py: 1 }}>
                {t('writing.inlineStreamingHint')}
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {!hasFields ? (
          <>
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
              {running ? t('writing.inlineRunning') : t('writing.settingAiRun')}
            </Button>
          </>
        ) : (
          <>
            <Button size="small" onClick={onClose}>
              {t('writing.discard')}
            </Button>
            <Button size="small" variant="contained" onClick={onApply}>
              {t('writing.settingAiApply', { n: fields.length })}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
