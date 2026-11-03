// 设置备份与恢复（第二十一轮新增章节）
//
// 为什么放在设置抽屉里而不是「某个工具的导入导出」：这五个键合起来就是「用户在这款软件里的样子」
// —— 明暗、主色、字号、圆角、布局、正文排版、语言、自己存的预设。它们此前只能存在本机设置库里，
// 换设备 / 重装 / 踩到内存库退路时全部无从找回。备份能力属于设置本身，就该在设置里。
//
// 三条不可退让的口径：
//  ① 导入前先把「这份备份会改哪几项」列出来，不让用户盲点一下就把现值覆盖掉；
//  ② 只有真写进设置库的项才算「已恢复」，写失败的项按项报出来（走可信层的可等待写入）；
//  ③ 非 Tauri 环境（纯浏览器预览 / 写库不可用）不装作能保存：导出退化为「查看 + 复制 JSON」。
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { save as saveDialog, open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { projectScanApi, saveTextFile } from '../../services/tauri';
import { useToastStore } from '../../store/toastStore';
import { t } from '../../i18n';
import {
  collectSettingsSnapshot,
  serializeSettingsSnapshot,
  parseSettingsSnapshot,
  snapshotKeys,
  applySettingsSnapshot,
  snapshotFileName,
  type SettingsSnapshot,
  type SnapshotParseError,
} from '../../utils/settingsBackup';
import { logger } from '../../utils/logger';
import { uiFontSize } from '../../theme/appearanceScales';

/** 解析失败原因 → 界面文案 key（每种原因给一句话，而不是统一一句「格式不对」） */
const PARSE_ERROR_KEYS: Record<SnapshotParseError, string> = {
  empty: 'settings.backupErrEmpty',
  invalid_json: 'settings.backupErrInvalidJson',
  not_settings: 'settings.backupErrNotSettings',
  no_items: 'settings.backupErrNoItems',
};

export default function SettingsBackupSection() {
  const [busy, setBusy] = useState(false);
  /** 「查看 JSON」展开态 + 最近一次导出的内容（也是复制的来源，保证看到的=拿到的） */
  const [showText, setShowText] = useState(false);
  const [exportText, setExportText] = useState('');
  /** 待恢复的快照（校验通过后才填，界面据此列出会影响哪几项） */
  const [pending, setPending] = useState<SettingsSnapshot | null>(null);
  const [pasteDraft, setPasteDraft] = useState('');
  const [parseError, setParseError] = useState<SnapshotParseError | null>(null);

  /** 取一份当前设置的快照文本（导出与「查看」共用，避免两条路取到不同内容） */
  const buildSnapshotText = async (): Promise<string> => {
    const snapshot = await collectSettingsSnapshot();
    return serializeSettingsSnapshot(snapshot);
  };

  const handlePreview = async () => {
    if (showText) {
      setShowText(false);
      return;
    }
    setBusy(true);
    try {
      setExportText(await buildSnapshotText());
      setShowText(true);
    } finally {
      setBusy(false);
    }
  };

  const handleExportFile = async () => {
    setBusy(true);
    try {
      const text = exportText || (await buildSnapshotText());
      const fileName = snapshotFileName();
      const target = await saveDialog({
        defaultPath: fileName,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!target) return; // 用户取消
      await saveTextFile(target, text);
      setExportText(text);
      useToastStore.getState().info(t('settings.backupSaved', { name: fileName }));
    } catch (error) {
      logger.warn('SettingsBackup', '导出设置备份失败', { error: String(error) });
      useToastStore.getState().warning(t('settings.backupSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    const text = exportText || (await buildSnapshotText());
    setExportText(text);
    try {
      await navigator.clipboard.writeText(text);
      useToastStore.getState().info(t('settings.backupCopied'));
    } catch {
      // 剪贴板不可用（非安全上下文 / WebView 未授权）：内容已经在下面的文本框里，
      // 用户可以手动全选复制，这里只说明为什么没自动复制，不谎称成功。
      setShowText(true);
      useToastStore.getState().warning(t('settings.backupCopyUnavailable'));
    }
  };

  /** 校验 + 只列出影响项，不落库：真正的写入留给「恢复」按钮（覆盖是有代价的动作） */
  const stageSnapshotText = (text: string) => {
    const result = parseSettingsSnapshot(text);
    if (!result.ok) {
      setPending(null);
      setParseError(result.error);
      return;
    }
    setParseError(null);
    setPending(result.snapshot);
  };

  const handleImportFile = async () => {
    setBusy(true);
    try {
      const picked = await openFileDialog({ multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!picked) return;
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;
      const buf = await projectScanApi.readFileBytes(path);
      stageSnapshotText(new TextDecoder('utf-8').decode(buf));
    } catch (error) {
      logger.warn('SettingsBackup', '读取设置备份失败', { error: String(error) });
      setParseError('invalid_json');
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await applySettingsSnapshot(pending);
      if (result.applied.length > 0) {
        useToastStore.getState().info(t('settings.backupApplied', { n: result.applied.length }));
      }
      if (result.failed.length > 0) {
        // 说清是哪几项没进去：只报「恢复失败」会让人以为整套都被回滚了
        useToastStore.getState().warning(t('settings.backupPartialFailed', { keys: result.failed.join(' / ') }));
      }
      setPending(null);
      setPasteDraft('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {t('settings.backupHint')}
      </Typography>

      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="small" variant="outlined" disabled={busy} onClick={handleExportFile} data-testid="settings-backup-export" sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}>
          {t('settings.backupExport')}
        </Button>
        <Button size="small" onClick={handlePreview} data-testid="settings-backup-preview" sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}>
          {showText ? t('settings.backupHide') : t('settings.backupView')}
        </Button>
        <Button size="small" onClick={handleCopy} data-testid="settings-backup-copy" sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}>
          {t('settings.backupCopy')}
        </Button>
      </Box>

      {showText && (
        <TextField
          data-testid="settings-backup-text"
          value={exportText}
          fullWidth
          multiline
          minRows={4}
          maxRows={10}
          slotProps={{ input: { readOnly: true } }}
          onChange={() => undefined}
          sx={{ mt: 1, '& .MuiOutlinedInput-input': { fontSize: uiFontSize(10), fontFamily: 'monospace' } }}
        />
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, mb: 0.5, fontWeight: 600 }}>
        {t('settings.backupImportTitle')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
        <Button size="small" variant="outlined" disabled={busy} onClick={handleImportFile} data-testid="settings-backup-import-file" sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}>
          {t('settings.backupImportFile')}
        </Button>
        <Typography variant="caption" color="text.disabled" sx={{ minWidth: 0 }}>
          {t('settings.backupImportPasteHint')}
        </Typography>
      </Box>
      <TextField
        data-testid="settings-backup-paste"
        value={pasteDraft}
        fullWidth
        multiline
        minRows={2}
        maxRows={6}
        placeholder='{ "kind": "sight-folio-settings", ... }'
        onChange={(e) => setPasteDraft(e.target.value)}
        sx={{ mt: 0.75, '& .MuiOutlinedInput-input': { fontSize: uiFontSize(10), fontFamily: 'monospace' } }}
      />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
        <Button
          size="small"
          disabled={busy || !pasteDraft.trim()}
          onClick={() => stageSnapshotText(pasteDraft)}
          data-testid="settings-backup-parse-paste"
          sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}
        >
          {t('settings.backupCheck')}
        </Button>
      </Box>

      {parseError && (
        <Typography variant="caption" color="warning.main" data-testid="settings-backup-error" sx={{ display: 'block', mt: 0.75 }}>
          {t(PARSE_ERROR_KEYS[parseError])}
        </Typography>
      )}

      {pending && (
        <Box data-testid="settings-backup-preview" sx={{ mt: 1, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>
            {t('settings.backupContains')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
            {snapshotKeys(pending).map((item) => (
              <Chip key={item.key} size="small" variant="outlined" label={t(item.labelKey)} sx={{ height: 18, fontSize: uiFontSize(10) }} />
            ))}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', mt: 1 }}>
            <Button
              size="small"
              variant="contained"
              color="warning"
              disabled={busy}
              onClick={handleApply}
              data-testid="settings-backup-apply"
              sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}
            >
              {t('settings.backupApply')}
            </Button>
            <Button size="small" disabled={busy} onClick={() => setPending(null)} data-testid="settings-backup-cancel" sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}>
              {t('ui.cancel')}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
