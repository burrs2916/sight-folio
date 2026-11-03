// P2 多选对齐/分布工具条：框选/加选 ≥2 个可移动实体时，画布顶部居中浮现
import {useMemo} from "react";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import AlignHorizontalLeftRoundedIcon from "@mui/icons-material/AlignHorizontalLeftRounded";
import AlignHorizontalCenterRoundedIcon from "@mui/icons-material/AlignHorizontalCenterRounded";
import AlignHorizontalRightRoundedIcon from "@mui/icons-material/AlignHorizontalRightRounded";
import AlignVerticalTopRoundedIcon from "@mui/icons-material/AlignVerticalTopRounded";
import AlignVerticalCenterRoundedIcon from "@mui/icons-material/AlignVerticalCenterRounded";
import AlignVerticalBottomRoundedIcon from "@mui/icons-material/AlignVerticalBottomRounded";
import {useEditorStore} from "../../store/editorStore";
import {t} from "../../i18n";

// ─── P2 多选对齐/分布工具条：框选/加选 ≥2 个可移动实体时，画布顶部居中浮现 ───
// 对齐基准 = 全部选中（未锁定）实体的包围盒；分布要求 ≥3 个。只调 transform，
// 走 updateComponentTransform 的防抖历史（一批操作一条撤销记录）。
const ALIGN_IGNORE_TYPES = new Set(["dependency-edge", "quadrant-zone-bg"]);

export function AlignToolbar({ selectedIds }: { selectedIds: string[] }) {
  const components = useEditorStore((s) => s.components);
  const updateComponentTransform = useEditorStore((s) => s.updateComponentTransform);
  const movable = useMemo(
    () =>
      components.filter(
        (c) => selectedIds.includes(c.id) && !c.locked && c.visible && !ALIGN_IGNORE_TYPES.has(c.type)
      ),
    [components, selectedIds]
  );

  const align = (axis: "x" | "y", mode: "min" | "center" | "max") => {
    if (movable.length < 2) return;
    const sizeOf = (c: (typeof movable)[number]) => (axis === "x" ? c.transform.width : c.transform.height);
    const posOf = (c: (typeof movable)[number]) => (axis === "x" ? c.transform.x : c.transform.y);
    const min = Math.min(...movable.map(posOf));
    const max = Math.max(...movable.map((c) => posOf(c) + sizeOf(c)));
    const mid = (min + max) / 2;
    for (const c of movable) {
      // 各物体按自身尺寸回退：左/顶贴 min，右/底贴 max，中线居中
      const p = mode === "min" ? min : mode === "max" ? max - sizeOf(c) : mid - sizeOf(c) / 2;
      updateComponentTransform(c.id, axis === "x" ? { x: Math.max(0, p) } : { y: Math.max(0, p) });
    }
  };

  const distribute = (axis: "x" | "y") => {
    if (movable.length < 3) return;
    const sizeOf = (c: (typeof movable)[number]) => (axis === "x" ? c.transform.width : c.transform.height);
    const posOf = (c: (typeof movable)[number]) => (axis === "x" ? c.transform.x : c.transform.y);
    const sorted = [...movable].sort((a, b) => posOf(a) - posOf(b));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = posOf(last) + sizeOf(last) - posOf(first) - sorted.reduce((sum, c) => sum + sizeOf(c), 0);
    const gap = span / (sorted.length - 1);
    let cursor = posOf(first);
    for (const c of sorted) {
      updateComponentTransform(c.id, axis === "x" ? { x: Math.max(0, cursor) } : { y: Math.max(0, cursor) });
      cursor += sizeOf(c) + gap;
    }
  };

  if (movable.length < 2) return null;

  const btnSx = {
    minWidth: 26,
    height: 24,
    px: 0.5,
    fontSize: 11,
    lineHeight: 1,
    color: "text.secondary",
    "&:hover": { color: "text.primary", backgroundColor: "action.hover" },
  } as const;

  const canDistribute = movable.length >= 3;

  return (
    <Box
      sx={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: 0.25,
        backgroundColor: "rgb(var(--template-palette-background-paperChannel) / 0.88)",
        backdropFilter: "blur(8px)",
        borderRadius: 1.5,
        border: 1,
        borderColor: "divider",
        px: 0.75,
        py: 0.4,
      }}
    >
      <Tooltip title={t("editor.align.left")}><IconButton size="small" sx={btnSx} onClick={() => align("x", "min")} aria-label={t("editor.align.left")}><AlignHorizontalLeftRoundedIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip>
      <Tooltip title={t("editor.align.centerX")}><IconButton size="small" sx={btnSx} onClick={() => align("x", "center")} aria-label={t("editor.align.centerX")}><AlignHorizontalCenterRoundedIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip>
      <Tooltip title={t("editor.align.right")}><IconButton size="small" sx={btnSx} onClick={() => align("x", "max")} aria-label={t("editor.align.right")}><AlignHorizontalRightRoundedIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip>
      <Tooltip title={t("editor.align.top")}><IconButton size="small" sx={btnSx} onClick={() => align("y", "min")} aria-label={t("editor.align.top")}><AlignVerticalTopRoundedIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip>
      <Tooltip title={t("editor.align.centerY")}><IconButton size="small" sx={btnSx} onClick={() => align("y", "center")} aria-label={t("editor.align.centerY")}><AlignVerticalCenterRoundedIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip>
      <Tooltip title={t("editor.align.bottom")}><IconButton size="small" sx={btnSx} onClick={() => align("y", "max")} aria-label={t("editor.align.bottom")}><AlignVerticalBottomRoundedIcon sx={{ fontSize: 15 }} /></IconButton></Tooltip>
      <Box sx={{ width: 1, height: 14, mx: 0.25, borderRight: 1, borderColor: "divider" }} />
      <Tooltip title={t("editor.align.distX")}><Box component="button" onClick={() => distribute("x")} sx={{ ...btnSx, border: "none", cursor: canDistribute ? "pointer" : "not-allowed", opacity: canDistribute ? 1 : 0.4 }}>{t("editor.align.distXShort")}</Box></Tooltip>
      <Tooltip title={t("editor.align.distY")}><Box component="button" onClick={() => distribute("y")} sx={{ ...btnSx, border: "none", cursor: canDistribute ? "pointer" : "not-allowed", opacity: canDistribute ? 1 : 0.4 }}>{t("editor.align.distYShort")}</Box></Tooltip>
    </Box>
  );
}
