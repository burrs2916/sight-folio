// 设定卡「修改历史」面板（批次③ 增-3 的收口）。
//
// 为什么单独成文件：写作台卡编辑面板本身已有数千行，再往里塞一段带状态、带确认弹窗、
// 带失败重试的 UI 只会让它更难读。这里把「历史」这件事的所有状态关在一个组件里，
// 外层只需给三样东西：当前卡、恢复前的落库动作、恢复成功的草稿重载回调。
//
// 数据来源：`update_character_card`（AI 改写）与 `restore_writing_setting_revision`（作者恢复）
// 都会先把**被替换掉的旧值**写进 `writing_setting_revisions`，所以这里的每一条都真实存在过。
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import {
  writingSettingRevisionsApi,
  type WritingSetting,
  type WritingSettingRevision,
} from '../../services/tauri';
import { useToastStore } from '../../store/toastStore';
import useI18n from '../../i18n';

function fmtTime(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 摘要截断：历史列表是"挑一条"的清单，不是全文阅读区 */
function clip(s: string, max = 72): string {
  const one = s.replace(/\s+/g, ' ').trim();
  if (!one) return '—';
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

interface SettingHistoryPanelProps {
  /**
   * 当前卡。**调用方必须以 `key={setting.id}` 渲染本组件**：组件内部不监听 setting.id
   * 变化去清缓存，换卡靠 React 重建来清零。少了 key 会把上一张卡的历史显示在这张卡下面，
   * 而那是会让作者照着错内容做判断的事故。
   */
  setting: WritingSetting;
  /**
   * 恢复之前必须做的事：把编辑框里**未防抖落库**的按键推下去。
   * 漏了这一步会有两种丢数据：恢复后 pending patch 一响把结果盖回去；
   * 或者作者刚敲的内容被恢复悄悄顶掉且无历史可查。
   */
  onBeforeRestore: () => Promise<void>;
  /** 恢复成功：外层用返回的卡重载编辑草稿（卡编辑面板只按 settingId 装载，不会自动重载） */
  onRestored: (next: WritingSetting) => void;
}

export function SettingHistoryPanel({
  setting,
  onBeforeRestore,
  onRestored,
}: SettingHistoryPanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // null = 未拉取；[] = 确认没有记录。两者必须能区分，否则空态会说谎。
  const [items, setItems] = useState<WritingSettingRevision[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<WritingSettingRevision | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      setItems(await writingSettingRevisionsApi.list(setting.id, 50));
    } catch {
      setItems(null);
      setLoadFailed(true);
    }
  }, [setting.id]);

  // 换卡的重置**不在这里做**：外层传 `key={setting.id}`，React 会直接重建组件，
  // 展开态与缓存天然清零。用 effect 手动同步"上一个 props"，既多写状态又违反
  // react-hooks/set-state-in-effect。组件契约见下方 props 注释。
  //
  // 懒加载：只在展开时拉。卡编辑面板打开得很频繁，历史却很少看。
  useEffect(() => {
    if (open && items === null && !loadFailed) void load();
  }, [open, items, loadFailed, load]);

  const runRestore = async (rev: WritingSettingRevision) => {
    setBusyId(rev.id);
    try {
      await onBeforeRestore();
      const next = await writingSettingRevisionsApi.restore(setting.id, rev.id);
      onRestored(next);
      useToastStore.getState().success(t('writing.settingHistoryRestored'));
      setConfirmTarget(null);
      await load();
    } catch (e) {
      // 失败必须可见并留在原地：绝不静默回滚界面让作者以为恢复成功了
      useToastStore.getState().error(`${t('writing.settingHistoryRestoreFailed')}: ${String(e)}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
      <Box
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault?.();
            setOpen((v) => !v);
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <Box sx={{ color: 'text.secondary', display: 'flex' }}>
          <HistoryRoundedIcon sx={{ fontSize: 17 }} />
        </Box>
        <Typography sx={{ fontSize: 13, fontWeight: 700, flex: 1 }}>
          {t('writing.settingHistoryTitle')}
        </Typography>
        {items !== null && items.length > 0 && (
          <Chip size="small" variant="outlined" label={items.length} />
        )}
        {/* 纯指示图标，不做成交互元素：整行已经是 role="button"，再嵌一个按钮会破坏无障碍树 */}
        <Box sx={{ color: 'text.secondary', display: 'flex' }}>
          {open ? (
            <ExpandMoreRoundedIcon sx={{ fontSize: 18 }} />
          ) : (
            <ChevronRightRoundedIcon sx={{ fontSize: 18 }} />
          )}
        </Box>
      </Box>

      {open && (
        <Box sx={{ mt: 1.25, display: 'grid', gap: 1 }}>
          {loadFailed && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontSize: 12, color: 'error.main' }}>
                {t('writing.settingHistoryLoadFailed')}
              </Typography>
              <Button size="small" onClick={() => void load()}>
                {t('ui.retry')}
              </Button>
            </Box>
          )}
          {!loadFailed && items === null && (
            <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>
              {t('writing.settingHistoryLoading')}
            </Typography>
          )}
          {!loadFailed && items !== null && items.length === 0 && (
            <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>
              {t('writing.settingHistoryEmpty')}
            </Typography>
          )}
          {items?.map((rev) => (
            <Box
              key={rev.id}
              data-testid={`setting-revision-${rev.id}`}
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1.5,
                px: 1.25,
                py: 1,
                display: 'grid',
                gap: 0.5,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip
                  size="small"
                  label={
                    rev.origin === 'restore'
                      ? t('writing.settingHistoryOriginRestore')
                      : t('writing.settingHistoryOriginAi')
                  }
                />
                <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>
                  {fmtTime(rev.createdAt)}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Tooltip title={t('writing.settingHistoryRestoreTip')}>
                  {/* disabled Button 不派发 hover 事件，故外面包 Box 供 Tooltip 接收 */}
                  <Box>
                    <Button
                      size="small"
                      startIcon={<RestartAltRoundedIcon />}
                      disabled={busyId !== null}
                      onClick={() => setConfirmTarget(rev)}
                      sx={{ textTransform: 'none', fontSize: 11.5 }}
                    >
                      {t('writing.settingHistoryRestore')}
                    </Button>
                  </Box>
                </Tooltip>
              </Box>
              {/* 被替换掉的旧值：作者靠这三行判断"是不是这一版" */}
              <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{clip(rev.name, 40)}</Typography>
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                {clip(rev.subtitle, 40)}
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>
                {clip(rev.description)}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      <Dialog open={confirmTarget !== null} onClose={() => setConfirmTarget(null)}>
        <DialogTitle>{t('writing.settingHistoryConfirmTitle')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            {t('writing.settingHistoryConfirmBody')}
          </Typography>
          {confirmTarget && (
            <Box sx={{ mt: 1, fontSize: 12.5, fontWeight: 600 }}>{clip(confirmTarget.name, 40)}</Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmTarget(null)}>{t('ui.cancel')}</Button>
          <Button
            variant="contained"
            disabled={busyId !== null}
            onClick={() => confirmTarget && void runRestore(confirmTarget)}
          >
            {t('writing.settingHistoryRestore')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
