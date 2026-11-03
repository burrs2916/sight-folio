import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useI18n } from '../../i18n';
import { useAgentStore } from '../../store/agentStore';

/**
 * 高危工具审批弹窗（human-in-the-loop），**挂在 App 层、全窗口共用**。
 *
 * 为什么必须在 App 层而不是某个 AI 面板里：审批闸门在 Rust 引擎侧（`engine.rs`
 * 的 `approval_mode`），它发出 `agent-tool-approval` 后最多等 5 分钟，超时一律按
 * 「拒绝」处理。所以只要某个 UI 表面漏挂弹窗，用户就永远看不到请求，而 AI 会回复
 * 「你没有批准这次操作」——功能表现为莫名其妙地失败，且没人知道为什么。
 *
 * 这个坑踩过一次：弹窗原先只存在于工作台 AI 面板（`WorkbenchAiPanel`），而写作侧的
 * AI 助手页（`/ai`）同样会下发 `write_chapter` / `update_character_card`，于是从那里
 * 发起的任何写入都会静默超时。挂到 App 层后，任何路由与窗口都不可能漏掉它。
 */
export function ToolApprovalDialog() {
  // 用 useI18n() 而不是裸 t：语言切换时本组件要跟着重渲染
  const { t } = useI18n();
  const pending = useAgentStore((s) => s.pendingToolApproval);
  const resolve = useAgentStore((s) => s.resolveToolApproval);

  const isCommand = pending?.tool === 'run_command';
  // 工具名复用工具目录里的现成译名（「写入正文（需审批）」这类），让作者一眼看出动的是
  // 什么，而不是看到 update_character_card 这种内部标识。本仓 t() 不支持默认值参数，
  // 缺键会回吐 key 本身，故据此回退到原始工具名。
  const toolKey = pending ? `agent.form.tools.${pending.tool}` : '';
  const toolLabel = pending
    ? (() => {
        const label = t(toolKey);
        return label === toolKey ? pending.tool : label;
      })()
    : '';

  return (
    <Dialog open={!!pending} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 1 }}>
        <WarningAmberIcon sx={{ fontSize: 18, color: 'warning.main' }} />
        {isCommand ? t('workbench.aiApproval.title') : t('workbench.aiApproval.titleWrite')}
      </DialogTitle>
      <DialogContent sx={{ fontSize: 12 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
          {isCommand ? t('workbench.aiApproval.warning') : t('workbench.aiApproval.warningWrite')}
        </Typography>
        {pending && (
          <>
            <Typography
              variant="overline"
              sx={{ color: 'text.secondary', display: 'block', mb: 0.5, letterSpacing: 0.6 }}
            >
              {toolLabel}
            </Typography>
            <Box
              sx={{
                bgcolor: (th) => (th.palette.mode === 'dark' ? 'rgb(var(--template-palette-text-primaryChannel) / 0.06)' : 'rgb(var(--template-palette-text-primaryChannel) / 0.04)'),
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.25,
                // 命令行用等宽；给作者看的写入摘要是自然语言，等宽反而难读
                fontFamily: isCommand ? 'monospace' : 'inherit',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.6,
              }}
            >
              {isCommand
                ? `${pending.cwd ? `$ ${pending.cwd}> ` : '$ '}${pending.command}`
                : pending.summary}
            </Box>
            <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 1 }}>
              {t('workbench.aiApproval.timeoutNote')}
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" color="error" variant="outlined" onClick={() => void resolve(false)}>
          {t('workbench.aiApproval.deny')}
        </Button>
        {pending?.sessionRememberable && (
          <Button size="small" variant="outlined" onClick={() => void resolve(true, true)}>
            {t('workbench.aiApproval.allowSession')}
          </Button>
        )}
        <Button size="small" variant="contained" onClick={() => void resolve(true)}>
          {t('workbench.aiApproval.allow')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ToolApprovalDialog;
