// 设置库健康提示（第二十一轮 / 第二十三轮补「库落点」）
//
// 只在「设置可能记不住」时出现告警，正常时不占位。理由：底部那句「已自动保存」说的是
// **这一次写没写进去**，而这里说的是**这台机器的设置库能不能跨启动留住东西** ——
// 两个层次的事实，不能揉成一句。内存库（Rust 侧打开 config.db 失败时的退路）正是
// 前者一路成功、后者永远不成立的那种情况；没有这段提示，用户只能靠重启自己发现。
//
// 第二十三轮：后端补了 get_database_status，这里于是能说出「设置究竟存在哪个文件」。
// 「怕记不住」从一句警告变成可核对、可手动备份搬迁的具体路径。
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useSettingsHealthStore } from '../../store/settingsHealthStore';
import { BACKUPABLE_SETTINGS_KEYS } from '../../utils/settingsBackup';
import { t } from '../../i18n';
import { uiFontSize } from '../../theme/appearanceScales';
import type { SettingsScope } from '../../store/settingsSyncStore';

/**
 * scope → 界面显示名。反查 `BACKUPABLE_SETTINGS_KEYS` 这一份真源：它就是「这一域在设置里叫什么」
 * 唯一登记处（导出备份那张清单用的也是它）。再写一份名字表 = 迟早和备份区分家，
 * 于是健康条说「主题色彩」而备份区说「主题」，用户以为是两样东西。
 */
function scopeLabel(scope: SettingsScope): string {
  const entry = BACKUPABLE_SETTINGS_KEYS.find((item) => item.scope === scope);
  // 反查不到（新增 scope 忘了进备份清单）也要报名字，不能报一个空白：
  // 宁可退化成英文 scope 让用户能对上号，也不要出现「（）」这种看起来像坏掉的读数。
  return entry ? t(entry.labelKey) : scope;
}

export default function SettingsHealthNotice() {
  const status = useSettingsHealthStore((s) => s.status);
  const reprobe = useSettingsHealthStore((s) => s.probe);
  const dbLocation = useSettingsHealthStore((s) => s.dbLocation);
  const lateReadbacks = useSettingsHealthStore((s) => s.lateReadbacks);
  const degraded = status === 'unavailable' || status === 'not_persisted';
  const lateCount = lateReadbacks.count;
  // 一切正常、后端没给出路径、本次启动也没有读回迟到：无话可说，不占位
  if (!degraded && !dbLocation && lateCount === 0) return null;

  const message = status === 'unavailable' ? t('settings.healthUnavailable') : t('settings.healthNotPersisted');

  return (
    <>
      <Divider />
      <Box data-testid="settings-health-notice" data-status={status} sx={{ p: 2, pt: 1.25 }}>
        {degraded && (
          <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start' }}>
            <ErrorOutlineRoundedIcon sx={{ fontSize: uiFontSize(18), color: 'warning.main', mt: 0.25 }} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="caption" color="warning.main" sx={{ display: 'block', lineHeight: 1.5 }}>
                {message}
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.25 }}>
                {t('settings.healthHint')}
              </Typography>
              <Button
                size="small"
                onClick={() => void reprobe()}
                data-testid="settings-health-reprobe"
                sx={{ textTransform: 'none', fontSize: uiFontSize(11), mt: 0.5, px: 0 }}
              >
                {t('settings.healthReprobe')}
              </Button>
            </Box>
          </Box>
        )}
        {/* 读回迟到（第三十五轮）：中性说明，不是告警。数据没丢，但这件事发生过，
            而用户当时看到的正是「我点了它没跳回去」—— 不写一句，下一轮还是会被当成回归报上来。 */}
        {lateCount > 0 && (
          <Box
            data-testid="settings-late-readback"
            sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', mt: degraded ? 1 : 0 }}
          >
            <InfoOutlinedIcon sx={{ fontSize: uiFontSize(18), color: 'text.secondary', mt: 0.25 }} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.5 }}>
                {t('settings.healthLateReadback', {
                  count: lateCount,
                  scopes: lateReadbacks.scopes.map(scopeLabel).join(t('settings.healthLateReadbackJoin')),
                })}
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.25 }}>
                {t('settings.healthLateReadbackHint')}
              </Typography>
            </Box>
          </Box>
        )}
        {/* 落点：无论正常还是降级都说一句。用户要核对「到底存没存」，最直接的证据就是这个文件 */}
        {dbLocation && (
          <Typography
            variant="caption"
            color="text.disabled"
            data-testid="settings-db-location"
            sx={{
              display: 'flex',
              gap: 0.5,
              alignItems: 'flex-start',
              mt: degraded || lateCount > 0 ? 1 : 0,
              lineHeight: 1.4,
            }}
          >
            <FolderOpenRoundedIcon sx={{ fontSize: uiFontSize(13), flexShrink: 0, mt: 0.1 }} />
            <Box component="span" sx={{ wordBreak: 'break-all' }}>
              {t('settings.healthDbPath', { path: dbLocation })}
            </Box>
          </Typography>
        )}
      </Box>
    </>
  );
}
