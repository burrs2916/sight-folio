// 版本导出弹窗（B4b，需求 §5.2 / D8「导出在成品页」）。
//
// 只做一件事：选格式（可多选）→ enqueue_export 入后台队列。
// 弹窗把「版本号 + 格式清单」交给后端就完事 —— 渲染取数、落盘、状态机全在服务端，
// 入队后页面照常写作（§9-7），进度由成品页任务面板轮询呈现。
import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { uiFontSize } from '../../theme/appearanceScales';
import { t } from '../../i18n';
import { logger } from '../../utils/logger';
import { useToastStore } from '../../store/toastStore';
import {
  workVersionApi,
  type ExportArtifact,
  type ExportArtifactFormat,
  type WorkVersion,
} from '../../services/workVersion';

// 与后端 EXPORT_FORMATS 白名单同一份清单（需求 §2）；backup 刻意不在列 —— 整库备份
// 是设置页职责，绝不进作品导出（§9-11）。改这里必须同步 Rust 侧。
// 不导出：本文件对外只暴露组件（react-refresh 口径），清单的对外锁定走结构测。
const EXPORTABLE_FORMATS: ExportArtifactFormat[] = ['epub', 'pdf', 'docx', 'html', 'md', 'txt'];

export default function ExportVersionDialog({
  version,
  onClose,
  onEnqueued,
}: {
  version: WorkVersion | null;
  onClose: () => void;
  onEnqueued: (jobs: ExportArtifact[]) => void;
}) {
  const showToast = useToastStore((s) => s.showToast);
  const [formats, setFormats] = useState<ExportArtifactFormat[]>(['epub']);
  const [busy, setBusy] = useState(false);

  const toggle = (f: ExportArtifactFormat) =>
    setFormats((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));

  const submit = async () => {
    if (!version || busy) return;
    if (formats.length === 0) {
      showToast(t('published.exportNeedFormat'), 'error');
      return;
    }
    setBusy(true);
    try {
      const jobs = await workVersionApi.enqueueExport(version.id, formats);
      onEnqueued(jobs);
      showToast(t('published.exportEnqueued', { formats: jobs.map((j) => j.format).join(' / ') }), 'success');
      setFormats(['epub']);
      onClose();
    } catch (e) {
      // 入队失败必须原文上屏：格式白名单/版本被删等原因只有后端知道
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('ExportVersionDialog', 'enqueue failed', { error: e, versionId: version.id });
      showToast(t('published.exportEnqueueFailed', { msg }), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(version)} onClose={() => !busy && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: uiFontSize(15.5), fontWeight: 650 }}>
        {t('published.exportDialogTitle', { n: version?.seq ?? '' })}
      </DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ fontSize: uiFontSize(12), mb: 1 }}>
          {t('published.exportFormatsHint')}
        </DialogContentText>
        <Typography sx={{ fontSize: uiFontSize(12), fontWeight: 650, mb: 0.5 }}>
          {t('published.exportFormatsLabel')}
        </Typography>
        <FormGroup row sx={{ flexWrap: 'wrap', gap: 0.5 }} data-testid="published-export-formats">
          {EXPORTABLE_FORMATS.map((f) => (
            <FormControlLabel
              key={f}
              // testid 挂在 label 上：原生 <label> 点选中文本框，jsdom 与浏览器行为一致
              data-testid={`published-export-fmt-${f}`}
              control={
                <Checkbox
                  size="small"
                  checked={formats.includes(f)}
                  onChange={() => toggle(f)}
                  slotProps={{ input: { 'aria-label': f } }}
                />
              }
              label={<Typography sx={{ fontSize: uiFontSize(12.5), textTransform: 'uppercase' }}>{f}</Typography>}
              sx={{ m: 0, mr: 1 }}
            />
          ))}
        </FormGroup>
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 2 }}>
        <Button size="small" onClick={onClose} disabled={busy}>
          {t('published.cancel')}
        </Button>
        <Button size="small" variant="contained" onClick={() => void submit()} disabled={busy} data-testid="published-export-submit">
          {busy ? <CircularProgress size={14} sx={{ mr: 0.75, color: 'inherit' }} /> : null}
          {t('published.exportSubmit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
