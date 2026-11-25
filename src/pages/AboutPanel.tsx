// 关于面板（AI 助手设置 → 关于 段）。2026-11-25 李先生口径：
// 版本信息**不放在用户一眼可见的地方**（窗口标题栏、主界面）——不想了解版本的人
// 不该被它打扰；想了解的人来设置页的「关于」专门入口看。
//
// 这里是全应用唯一的版本展示点：版本号取自 Tauri 运行时（tauri.conf.json 的 version），
// 不从 bundle 硬拷，保证桌面端各平台读到的都是真值。
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import { getVersion } from '@tauri-apps/api/app';
import { t } from '../i18n';
import { uiFontSize } from '../theme/appearanceScales';

/** 拿不到版本就显示 —，不编一个数冒充测量值 */
function useAppVersion(): string {
  const [version, setVersion] = useState('');
  useEffect(() => {
    let alive = true;
    getVersion()
      .then((v) => {
        if (alive) setVersion(v);
      })
      .catch(() => {
        if (alive) setVersion('');
      });
    return () => {
      alive = false;
    };
  }, []);
  return version || '—';
}

export default function AboutPanel() {
  const version = useAppVersion();

  const rows: Array<{ label: string; value: string }> = [
    { label: t('agent.about.appName'), value: 'Sight Folio' },
    { label: t('agent.about.appVersion'), value: version },
  ];

  return (
    <Box>
      {rows.map((row) => (
        <Box key={row.label}>
          <Divider sx={{ my: 1 }} />
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, py: 0.5 }}>
            <Typography sx={{ fontSize: uiFontSize(13), color: 'text.secondary', width: 160, flexShrink: 0 }}>
              {row.label}
            </Typography>
            <Typography sx={{ fontSize: uiFontSize(13), color: 'text.primary' }}>{row.value}</Typography>
          </Box>
        </Box>
      ))}
      <Divider sx={{ my: 1 }} />
    </Box>
  );
}
