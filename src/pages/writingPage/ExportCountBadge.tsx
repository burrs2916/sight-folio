import { useEffect, useState } from 'react';
import { Typography } from '@mui/material';
import { completedWorksApi } from '../../services/tauri';
import { t } from '../../i18n';

/** 导出菜单项右侧「已有 n 个」计数徽标（T3：写作台感知导出积累）。
 *  仅在该书该格式已有记录时渲染；失败静默（计数只是增益信息，不阻塞导出）。 */
export function ExportCountBadge({ bookId, format }: { bookId: string; format: string }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    completedWorksApi
      .count(bookId, format)
      .then((n) => {
        if (alive) setCount(n);
      })
      .catch(() => {
        if (alive) setCount(null);
      });
    return () => {
      alive = false;
    };
  }, [bookId, format]);

  if (count === null || count <= 0) return null;
  return (
    <Typography component="span" sx={{ ml: 1, fontSize: 11, color: 'text.disabled' }}>
      {t('writing.exportedCount', { n: count })}
    </Typography>
  );
}
