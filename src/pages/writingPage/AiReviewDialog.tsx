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
import type { AiAnalysisPreset } from '../../ai/contextTypes';
import { pickLang, t } from '../../i18n';
import type { AiAgent } from '../../services/agent';

export interface AiReviewDialogProps {
  open: boolean;
  onClose: () => void;
  presetKey: string;
  onPresetChange: (key: string) => void;
  writingPresets: AiAnalysisPreset[];
  agentId: string;
  onAgentChange: (id: string) => void;
  agents: AiAgent[];
  /** 无 Agent 时跳转设置页 */
  onGoSettings: () => void;
  /** 发射 AI 审视 */
  onLaunch: () => void;
  launching: boolean;
  /** 是否有当前书（决定「查看历史审阅」可用性） */
  bookAvailable: boolean;
  /** 打开历史审阅结论面板 */
  onViewInsights: () => void;
}

/**
 * AI 审视对话框（P7·A-2 闭环）：预设 + Agent 均由用户选择，
 * 不发射也能随时翻看历史审阅结论。状态由 useAiActions hook 持有。
 */
export function AiReviewDialog({
  open,
  onClose,
  presetKey,
  onPresetChange,
  writingPresets,
  agentId,
  onAgentChange,
  agents,
  onGoSettings,
  onLaunch,
  launching,
  bookAvailable,
  onViewInsights,
}: AiReviewDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>{t('writing.aiReview')}</DialogTitle>
      <DialogContent>
        <FormControl fullWidth sx={{ mt: 1 }}>
          <FormLabel sx={{ fontSize: 13 }}>{t('writing.aiPreset')}</FormLabel>
          <RadioGroup value={presetKey} onChange={(e) => onPresetChange(e.target.value)}>
            {writingPresets.map((p) => (
              <FormControlLabel
                key={p.key}
                value={p.key}
                control={<Radio size="small" />}
                label={
                  <Box>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{pickLang(p.title)}</Typography>
                    <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{pickLang(p.description)}</Typography>
                  </Box>
                }
              />
            ))}
          </RadioGroup>
        </FormControl>
        <FormControl fullWidth sx={{ mt: 1.5 }}>
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
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          {t('nav.cancel')}
        </Button>
        {/* A-2 闭环：不发射也能随时翻看历史审阅结论 */}
        <Button size="small" disabled={!bookAvailable} onClick={onViewInsights}>
          {t('writing.insightView')}
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!presetKey || !agentId || launching || agents.length === 0}
          onClick={() => void onLaunch()}
          startIcon={launching ? <CircularProgress size={14} /> : undefined}
        >
          {t('writing.aiLaunch')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
