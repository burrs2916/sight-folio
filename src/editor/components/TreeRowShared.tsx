// 树行共享几何基元（2026-09-22）
//
// 工作室左栏「目录树」(editor/panels/WritingTreeTab) 与写作台「章节」树
// (pages/ChapterTreePanel) 是同源几何的两棵树：缩进常量、竖向引导线 + elbow、
// 折叠尖角占位、层级徽章、尾注此前在两处逐字重复——本文件收拢为唯一事实源，
// 与大纲树 (writingPanes.NodeRow) 的视觉口径保持一致（INDENT_BASE=8 / STEP=20）。
//
// 只抽「几何与纯展示件」：行内容（状态点 / 标题 / 拖拽 / 行尾动作）两树诉求不同，
// 仍由各自 TreeRow 组合，避免为了合并把两套交互强行塞进一个组件。

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
// 缩进常量 / 行内边距公式与 buildTree 同源：utils/writingTree（本文件只导出组件，
// 避免 react-refresh 的「组件文件混导常量」告警）。
import { INDENT_BASE, INDENT_STEP, ROW_CENTER_Y } from '../../utils/writingTree';

/** 竖向树引导线：每个祖先层一条竖线贯穿整棵子树；末层再加一条横钩（elbow），
 *  把「子挂在父下」的从属关系画成看得见的分支。 */
export function TreeIndentGuides({ depth }: { depth: number }) {
  return (
    <>
      {Array.from({ length: depth }).map((_, i) => (
        <Box
          key={`v${i}`}
          sx={{
            position: 'absolute',
            left: INDENT_BASE + i * INDENT_STEP + INDENT_STEP / 2,
            top: 0,
            bottom: 0,
            width: '1px',
            bgcolor: 'divider',
            pointerEvents: 'none',
          }}
        />
      ))}
      {depth >= 1 && (
        <Box
          sx={{
            position: 'absolute',
            left: INDENT_BASE + (depth - 1) * INDENT_STEP + INDENT_STEP / 2,
            top: ROW_CENTER_Y,
            width: INDENT_STEP / 2,
            height: '1px',
            bgcolor: 'divider',
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  );
}

/** 折叠尖角**固定占位**：只有可折叠的行才画图形，否则留白——保证同层标题左缘对齐。 */
export function TreeChevron({
  expandable,
  expanded,
  onToggleExpand,
}: {
  expandable: boolean;
  expanded: boolean;
  onToggleExpand?: () => void;
}) {
  return (
    <Box
      onClick={(e) => {
        if (!expandable) return;
        e.stopPropagation();
        onToggleExpand?.();
      }}
      sx={{
        width: 14,
        height: 14,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: 'text.disabled',
      }}
    >
      {expandable && (expanded ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />)}
    </Box>
  );
}

/** 层级徽章（创作者自填的 kind：部/卷/章/节…）。 */
export function TreeKindBadge({ kind }: { kind: string }) {
  return (
    <Box
      sx={{
        fontSize: 9,
        lineHeight: 1,
        px: '5px',
        py: '2px',
        borderRadius: 999,
        border: '1px solid',
        borderColor: 'divider',
        color: 'text.secondary',
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}
    >
      {kind}
    </Box>
  );
}

/** 行尾注（N 章 / 字数）：不参与省略收缩。 */
export function TreeMetaText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Typography
      variant="caption"
      sx={{ fontSize: 9.5, color: 'text.disabled', flexShrink: 0, whiteSpace: 'nowrap' }}
    >
      {text}
    </Typography>
  );
}
