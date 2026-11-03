// 作品状态徽章（2026-11-03 插单六）：可点的状态 Chip + 四选菜单。
//
// 为什么要有这个组件：改造前全项目只有画布工作台右栏「书属性卡」一处能改状态，
// 而书架卡片与两处顶栏都是只读三元式；李先生反馈「一直停在连载中、改不动」。
// 现在书架书卡 / 写作台当前作品行 / 工作台顶栏三处共用本控件，形态与判读口径同源。
//
// 写路径纪律：**只走 useWritingStore.setBookMeta**（与简介/体裁/日更目标同一个 setter，
// 落库后由它广播 writing-book-meta-changed 给其它窗口），本组件不碰 writingApi、不自造 setter。
//
// 形态纪律（李先生审美口径：只调颜色/布局/字号，不给控件发明新花样）：
// 外观就是各页原本那枚状态 Chip，只是加上 onClick 与菜单；配色一律取
// BOOK_STATUSES 的语义色名（default/success/warning/error），不出现具体色值。
import { useState } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Chip from '@mui/material/Chip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded';
import { t } from '../i18n';
import { BOOK_STATUSES, bookStatusDef } from '../utils/writingSchema';
import { useWritingStore } from '../store/writingStore';
import { useToastStore } from '../store/toastStore';

interface BookStatusChipProps {
  bookId: string;
  /** 库里的原始值（可能是旧口径 '' / 'draft'），判读一律交给 bookStatusDef 归一 */
  status: string | null | undefined;
  /** 各页视觉尺寸差异（书架 17/9、顶栏 20/11、写作台行 16/9）由调用方传，控件本身不写死 */
  chipSx?: SxProps<Theme>;
}

export function BookStatusChip({ bookId, status, chipSx }: BookStatusChipProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const setBookMeta = useWritingStore((s) => s.setBookMeta);
  const showToast = useToastStore((s) => s.showToast);
  const current = bookStatusDef(status);

  const commit = (next: string, nextLabel: string) => {
    setAnchor(null);
    // 与归一后的当前值比对，而不是库里的原始串：否则旧书（status='draft'）点「连载中」
    // 会因 'ongoing' !== 'draft' 触发一次纯无谓的落库 + 跨窗口广播。
    if (next === current.id) return;
    // 成功提示挂在 then 上：setBookMeta 是「先落库再改态」，落库失败时不能先报「已改为已完结」
    void setBookMeta(bookId, { status: next })
      .then(() => showToast(t('dashboard.statusChangedToast', { label: nextLabel }), 'success'))
      .catch((e) => showToast(t('studio.opFailed', { msg: String(e) }), 'error'));
  };

  return (
    <>
      <Tooltip title={t('dashboard.statusChangeTip')} placement="top">
        <Chip
          size="small"
          // 下拉箭头：插单六那枚纯 badge 被驳回过一次「看着不像能点」。MUI v9 的 Chip
          // 没有 endIcon（只有前置 icon 与 deleteIcon），所以把箭头并进 label，保住
          // 「箭头跟在文字后面」这个 picker 观感。真正的明示入口另有其人（作品信息文字按钮），
          // 这枚只当快捷方式。
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.125 }}>
              {t(current.labelKey)}
              <ArrowDropDownRoundedIcon sx={{ fontSize: 'inherit', opacity: 0.7 }} />
            </Box>
          }
          color={current.chipColor}
          variant={current.terminal ? 'filled' : 'outlined'}
          onClick={(e) => {
            // 书架整卡可点（点开工作室）、写作台整行可点（开切书菜单）——
            // 状态 chip 的点击必须吃掉冒泡，否则改个状态顺手把书打开/弹出别的菜单。
            e.stopPropagation();
            setAnchor(e.currentTarget);
          }}
          sx={{ cursor: 'pointer', ...chipSx }}
        />
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {BOOK_STATUSES.map((s) => (
          <MenuItem key={s.id} selected={s.id === current.id} onClick={() => commit(s.id, t(s.labelKey))}>
            {t(s.labelKey)}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
