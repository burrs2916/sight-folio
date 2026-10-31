import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Box, IconButton, Tooltip, Paper } from '@mui/material';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import NotesRoundedIcon from '@mui/icons-material/NotesRounded';
import RateReviewRoundedIcon from '@mui/icons-material/RateReviewRounded';
import SpellcheckRoundedIcon from '@mui/icons-material/SpellcheckRounded';
import SubjectRoundedIcon from '@mui/icons-material/SubjectRounded';
import type { Editor } from '@tiptap/react';
import { t } from '../../i18n';
import type { InlineWritingKind } from '../../ai/writingAssistant';

interface AiSelectionMenuProps {
  editor: Editor | null;
  /** 编辑器滚动容器（写正文的滚动层），用于滚动时重算浮层位置 */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** 点击某个能力：改写 / 续写 / 润色 / 总结 */
  onPick: (kind: InlineWritingKind) => void;
}

const MENU_ITEMS: Array<{ kind: InlineWritingKind; icon: ReactNode; labelKey: string }> = [
  { kind: 'rewrite', icon: <RateReviewRoundedIcon sx={{ fontSize: 17 }} />, labelKey: 'writing.inlineRewrite' },
  { kind: 'continue', icon: <NotesRoundedIcon sx={{ fontSize: 17 }} />, labelKey: 'writing.inlineContinue' },
  { kind: 'polish', icon: <AutoFixHighRoundedIcon sx={{ fontSize: 17 }} />, labelKey: 'writing.inlinePolish' },
  { kind: 'summarize', icon: <SubjectRoundedIcon sx={{ fontSize: 17 }} />, labelKey: 'writing.inlineSummarize' },
  { kind: 'review', icon: <SpellcheckRoundedIcon sx={{ fontSize: 17 }} />, labelKey: 'writing.inlineReview' },
];

/**
 * 选中文本悬浮 AI 菜单（P0）：编辑器中选中正文非空时，在选区上方显示
 * 改写 / 续写 / 润色 / 总结 四个入口，点击即以该 kind 打开内联 AI 对话框。
 *
 * 自实现而非注册 @tiptap/extension-bubble-menu：不引入新的菜单扩展依赖，
 * 直接在已有编辑器滚动容器内用视口坐标定位（coordsAtPos），
 * 与项目现有的 MUI 轻量浮层风格一致，zen/专注模式同样可用。
 */
export function AiSelectionMenu({ editor, scrollRef, onPick }: AiSelectionMenuProps) {
  const [pos, setPos] = useState<{ top: number; left: number; below: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // 上一帧菜单高度，用于上/下切换避免跳动（首帧用估计值）
  const menuHRef = useRef(38);

  const computePos = useCallback(() => {
    if (!editor) {
      setPos(null);
      return;
    }
    const sel = editor.state.selection;
    if (sel.empty || !editor.isFocused) {
      setPos(null);
      return;
    }
    const fromCoord = editor.view.coordsAtPos(sel.from);
    const toCoord = editor.view.coordsAtPos(sel.to);
    // 选区两端的视口纵坐标：跨行选区取较小者（顶部）
    const top = Math.min(fromCoord.top, toCoord.top);
    // 水平位置取选区起始点；避免菜单跑到视口外
    const left = Math.min(Math.max(fromCoord.left, 4), window.innerWidth - 190);
    const rect = menuRef.current?.getBoundingClientRect();
    const menuH = rect?.height ?? menuHRef.current;
    menuHRef.current = menuH;
    const above = top - menuH - 10;
    if (above > 4) {
      setPos({ top: above, left, below: false });
    } else {
      setPos({ top: Math.max(fromCoord.bottom + 10, 4), left, below: true });
    }
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const update = () => computePos();
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    editor.on('focus', update);
    // blur 必须与其余事件同一命名引用：on/off 各写一个新建箭头函数时，
    // 两者引用不同 → off 永远注销不掉 on 的注册，effect 每次重跑（StrictMode
    // 双挂载/editor 重建）都累积一个泄漏监听器（第十三轮批④，回归锁
    // AiSelectionMenuListenerLeak 对旧形态实测失败、对修复后形态通过）。
    const onBlur = () => setPos(null);
    editor.on('blur', onBlur);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
      editor.off('focus', update);
      editor.off('blur', onBlur);
    };
  }, [editor, computePos]);

  // 滚动时选区视口坐标变化：editor 不广播 scroll，需监听滚动容器手动重算
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      // 滚动会改变选区字符相对视口的位置，但不改变选区本身
      window.requestAnimationFrame(computePos);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef, computePos]);

  if (!pos) return null;

  return (
    <Box
      sx={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 1300 }}
      onMouseDown={(e) => {
        // 阻止 mousedown 抢走编辑器焦点：选区一旦清空菜单即消失，按钮就无法触发
        e.preventDefault();
      }}
    >
      <Paper
        ref={menuRef}
        elevation={3}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          px: 0.5,
          py: 0.25,
          borderRadius: '18px',
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
        }}
      >
        {MENU_ITEMS.map((item) => (
          <Tooltip key={item.kind} title={t(item.labelKey)} placement="top">
            <IconButton
              size="small"
              aria-label={t(item.labelKey)}
              onClick={() => {
                setPos(null);
                onPick(item.kind);
              }}
            >
              {item.icon}
            </IconButton>
          </Tooltip>
        ))}
      </Paper>
    </Box>
  );
}
