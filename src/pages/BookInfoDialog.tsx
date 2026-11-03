// 「作品信息」对话框（2026-11-03 插单七）：状态 + 体裁 × 载体 一次改完的**明示入口**。
//
// 为什么不是"点那枚小 chip"：插单 6 把状态做成了可点 chip + 菜单，李先生当场驳回——
// 「悬浮到连载中上面再去改，谁知道？谁都不知道该怎么改，还得到处找」。
// 可点性藏在样式里等于没有入口：入口必须是**一个写着它干什么的东西**。
// 所以这轮不删 chip（留着当快捷方式），而是补一个常驻文字按钮 → 打开本对话框：
// 状态四选一摆在最上面，每态带一句人话说明；体裁×载体沿用共享字段，一个弹窗改完。
//
// 写路径纪律：仍然只有 writingStore.setBookMeta 这一个 setter（与插单 6 三处入口同源），
// 本组件不自建 writingApi、不另开落库分支。
//
// 视觉纪律（李先生口径：只调颜色/布局/字号，不给控件发明新花样）：
// 可选卡片直接复用设置抽屉「外观预设」那套已验收词汇 —— 描边 divider→primary.main、
// 选中底 action.selected、hover primary.light，不引入新配色。
import { useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import type { WritingBook } from '../services/tauri';
import { t } from '../i18n';
import { BOOK_STATUSES, bookStatusDef } from '../utils/writingSchema';
import { GenreMediumFields } from './GenreMediumFields';
import { useWritingStore } from '../store/writingStore';
import { useToastStore } from '../store/toastStore';
import { uiFontSize } from '../theme/appearanceScales';

interface BookInfoDialogProps {
  /** 目标书。调用方**条件挂载**（`{book && <BookInfoDialog …/>}`，与素材库对话框同型）：
   *  草稿态因此天生就是「打开时的那本书」，不需要 useEffect 往 state 里回填 ——
   *  回填 effect 是本仓 eslint 的 set-state-in-effect 告警源，能不用就不用。 */
  book: WritingBook;
  onClose: () => void;
}

export function BookInfoDialog({ book, onClose }: BookInfoDialogProps) {
  const setBookMeta = useWritingStore((s) => s.setBookMeta);
  const showToast = useToastStore((s) => s.showToast);
  // 惰性初始化：status 走归一（旧书 'draft' → 选中「连载中」，而不是四张卡谁都不亮）
  const [status, setStatus] = useState(() => bookStatusDef(book.status).id);
  const [genre, setGenre] = useState(() => book.genre ?? '');
  const [medium, setMedium] = useState(() => book.medium ?? '');
  const [saving, setSaving] = useState(false);

  const currentStatus = bookStatusDef(book.status).id;
  const dirty = status !== currentStatus || genre !== (book.genre ?? '') || medium !== (book.medium ?? '');

  const handleSave = () => {
    if (saving || !dirty) return;
    setSaving(true);
    void setBookMeta(book.id, { status, genre, medium })
      .then(() => {
        showToast(t('writing.saved'), 'success');
        onClose();
      })
      .catch((e) => showToast(t('studio.opFailed', { msg: String(e) }), 'error'))
      .finally(() => setSaving(false));
  };

  return (
    <Dialog open onClose={() => !saving && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: uiFontSize(15) }}>{t('writing.bookInfo.title')}</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary', mb: 1 }}>
          {book.title} · {t('writing.bookInfo.hint')}
        </Typography>

        <Typography sx={{ fontSize: uiFontSize(12), fontWeight: 700, color: 'text.secondary', mt: 0.5 }}>
          {t('studio.bookMeta.status')}
        </Typography>
        <Box
          data-testid="book-info-status-grid"
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1, mt: 0.75 }}
        >
          {BOOK_STATUSES.map((s) => {
            const active = s.id === status;
            return (
              <Card
                key={s.id}
                variant="outlined"
                data-testid={`book-info-status-${s.id}`}
                onClick={() => setStatus(s.id)}
                sx={{
                  cursor: 'pointer',
                  position: 'relative',
                  borderColor: active ? 'primary.main' : 'divider',
                  bgcolor: active ? 'action.selected' : 'background.paper',
                  transition: 'all 0.15s',
                  '&:hover': { borderColor: 'primary.light' },
                }}
              >
                <CardActionArea sx={{ p: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography sx={{ fontSize: uiFontSize(13), fontWeight: active ? 700 : 600 }}>
                      {t(s.labelKey)}
                    </Typography>
                    {active && <CheckCircleIcon sx={{ fontSize: uiFontSize(15), color: 'primary.main' }} />}
                  </Box>
                  <Typography sx={{ fontSize: uiFontSize(11), color: 'text.secondary', mt: 0.25 }}>
                    {t(`writing.bookInfo.statusDesc.${s.id}`)}
                  </Typography>
                </CardActionArea>
              </Card>
            );
          })}
        </Box>

        <Divider sx={{ my: 1.5 }} />

        <GenreMediumFields genre={genre} medium={medium} onGenreChange={setGenre} onMediumChange={setMedium} />
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose} disabled={saving}>
          {t('nav.cancel')}
        </Button>
        <Button size="small" variant="contained" onClick={handleSave} disabled={saving || !dirty}>
          {t('nav.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
