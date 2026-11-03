// 成品作品库根目录（完结作品重设计 B3，需求 §4 + D4/D7）。
//
// 这一块的存在理由：导出产物从「每次弹另存为、事后被挪走就烂档」改为「必落作品库根」。
// 设置页是用户**唯一**能看见并更改这个根的地方 —— 所以它必须说真话：
//  · 读取即确保目录可用（后端不存在则创建）；创建失败在这里如实展示，
//    禁止任何「退回另存为」式的静默降级（§4 红线）；
//  · 更改位置只改配置不搬文件，界面上把这条口径写明白，不让用户以为会自动迁移；
//  · 换根失败时旧位置照常展示 —— 后端失败不落库，前端也不许把没生效的路径画上界面。
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { open as openDirectoryDialog } from '@tauri-apps/plugin-dialog';
import { workVersionApi, type WorksLibraryRootInfo } from '../../services/workVersion';
import { useToastStore } from '../../store/toastStore';
import { t } from '../../i18n';
import { logger } from '../../utils/logger';
import { uiFontSize } from '../../theme/appearanceScales';

export default function SettingsWorksLibrarySection() {
  const [info, setInfo] = useState<WorksLibraryRootInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  /** 核心读取：首个 setState 落在 await 之后（effect 里同步置态会被 React 判成级联渲染） */
  const load = useCallback(async () => {
    try {
      const info = await workVersionApi.getLibraryRoot();
      setInfo(info);
      setLoadError(null);
    } catch (error) {
      // 如实上报：这里没有可以展示的备用路径，编一个才是说谎
      const reason = String(error);
      logger.warn('SettingsWorksLibrary', '读取作品库根失败', { error: reason });
      setInfo(null);
      setLoadError(reason);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 手动重读（事件处理器里置 loading 是合法时机） */
  const reload = () => {
    setLoading(true);
    void load();
  };

  useEffect(() => {
    // 挂载首刷走宏任务（本仓既有口径，见 WritingTodayChip）：load 内 setState 全在 await 之后，
    // 移出 effect 同步调用链以避免级联渲染告警（react-hooks/set-state-in-effect）
    const kick = setTimeout(() => void load(), 0);
    return () => clearTimeout(kick);
  }, [load]);

  const handleChange = async () => {
    setBusy(true);
    try {
      const picked = await openDirectoryDialog({
        directory: true,
        defaultPath: info?.path,
      });
      if (!picked || Array.isArray(picked)) return; // 取消 / 非预期多选
      const next = await workVersionApi.setLibraryRoot(picked);
      setInfo(next);
      setLoadError(null);
      useToastStore.getState().info(t('settings.worksLibraryChanged', { path: next.path }));
    } catch (error) {
      const reason = String(error);
      logger.warn('SettingsWorksLibrary', '更改作品库根失败', { error: reason });
      useToastStore.getState().error(t('settings.worksLibraryChangeFailed', { reason }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {t('settings.worksLibraryHint')}
      </Typography>

      {loading && (
        <Typography variant="caption" color="text.disabled" data-testid="settings-works-library-loading">
          {t('settings.worksLibraryLoading')}
        </Typography>
      )}

      {!loading && loadError && (
        <Typography variant="caption" color="error.main" data-testid="settings-works-library-error" sx={{ display: 'block' }}>
          {t('settings.worksLibraryLoadFailed', { reason: loadError })}
        </Typography>
      )}

      {!loading && info && (
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="caption" color="text.secondary">
            {t('settings.worksLibraryCurrent')}
          </Typography>
          <Typography
            variant="caption"
            data-testid="settings-works-library-path"
            sx={{ fontFamily: 'monospace', fontSize: uiFontSize(10), wordBreak: 'break-all', minWidth: 0 }}
          >
            {info.path}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            data-testid="settings-works-library-tag"
            label={info.isDefault ? t('settings.worksLibraryDefaultTag') : t('settings.worksLibraryCustomTag')}
            sx={{ height: 18, fontSize: uiFontSize(10) }}
          />
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', mt: 1 }}>
        <Button
          size="small"
          variant="outlined"
          disabled={loading || busy}
          onClick={handleChange}
          data-testid="settings-works-library-change"
          sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}
        >
          {t('settings.worksLibraryChange')}
        </Button>
        <Button
          size="small"
          disabled={loading || busy}
          onClick={reload}
          data-testid="settings-works-library-reload"
          sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}
        >
          {t('settings.worksLibraryReload')}
        </Button>
      </Box>
    </Box>
  );
}
