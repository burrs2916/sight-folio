// 全局危险动作确认弹窗（与 GlobalToast 同一条挂载路线：三处壳都挂，独立窗口也不例外）。
//
// 形状由这里定死：标题说清删什么 → 后果逐条列（不是拼成一行小字）→ 取消在左、
// 动作用 error 色在右。后果为空时仍会渲染标题与按钮，但 confirmStore 会留下 warn 痕迹。
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { useConfirmStore } from '../../store/confirmStore';
import { uiFontSize } from '../../theme/appearanceScales';

export default function GlobalConfirmDialog() {
  const pending = useConfirmStore((s) => s.pending);
  const settle = useConfirmStore((s) => s.settle);

  return (
    <Dialog
      open={pending !== null}
      onClose={() => settle(false)}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
    >
      {pending ? (
        <>
          <DialogTitle sx={{ fontSize: uiFontSize(16), pb: 0.5 }}>{pending.title}</DialogTitle>
          <DialogContent>
            <Box
              component="ul"
              sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.6 }}
            >
              {pending.impact.map((line, i) => (
                <Typography
                  key={`${i}-${line}`}
                  component="li"
                  data-testid="global-confirm-impact"
                  sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.65, color: 'text.secondary' }}
                >
                  · {line}
                </Typography>
              ))}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button size="small" onClick={() => settle(false)}>
              {pending.cancelLabel}
            </Button>
            {/* 动词按钮用 error 色：删除类动作不该长得像"继续" */}
            <Button
              size="small"
              variant="contained"
              color="error"
              data-testid="global-confirm-ok"
              onClick={() => settle(true)}
            >
              {pending.confirmLabel}
            </Button>
          </DialogActions>
        </>
      ) : null}
    </Dialog>
  );
}
