// 右栏「创作组件」面板（L2 语境化拖源）
//
// 右栏第 1 栏：**创作时往编辑区拖的组件**，随当前 L2 视图给该层的积木
// （大纲→章/概要条；人物→人物卡；世界观→世界观卡；通用→便签）。
// 它不是业务数据列表 —— 数据由画布与其它栏呈现，这里只负责「能放什么」。
//
// 拖出即走与左栏载体库同一套协议（writingDrag），落点语义见 SceneEditor.finishDrop。
// 面板不做任何写库动作：建档/落卡全部由落点决定，失败由落点 toast。

import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import { t } from "../../i18n";
import { paletteFor, type PaletteItem } from "../../utils/writingPalette";
import { writeEntityDragPayload, setDragGhost } from "./writingDrag";

const groupLabelSx = {
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "text.secondary",
  px: 0.25,
  mb: 0.5,
} as const;

function PaletteRow({ item }: { item: PaletteItem }) {
  const label = t(item.labelKey);
  return (
    <Box
      draggable
      onDragStart={(e) => {
        // 建档类条目把 payload 交给落点（__blank → createBlankWritingEntity）；
        // 纯画布卡只带 config，落点直接 addComponent + merge
        writeEntityDragPayload(e, item.entityType, label, item.config);
        setDragGhost(e, label, item.color);
      }}
      title={t("writingLeft.genreChipDragHint")}
      sx={(theme) => ({
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1.25,
        py: 1,
        mb: 0.75,
        borderRadius: 1.5,
        border: 1,
        borderColor: "divider",
        cursor: "grab",
        userSelect: "none",
        backgroundColor: theme.palette.mode === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
        "&:hover": { borderColor: item.color, backgroundColor: `${item.color}14` },
        "&:active": { cursor: "grabbing" },
      })}
    >
      <Box
        sx={{
          width: 24,
          height: 24,
          borderRadius: 1,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${item.color}22`,
          border: `1px solid ${item.color}55`,
        }}
      >
        <DragIndicatorIcon sx={{ fontSize: 14, color: item.color }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.3, color: "text.primary" }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: 10, color: "text.disabled", lineHeight: 1.4 }}>
          {t(item.descKey)}
        </Typography>
      </Box>
    </Box>
  );
}

export function WritingPalettePanel({
  genre,
  kind,
  onManageVolumes,
}: {
  genre: string;
  kind?: string;
  /** 卷部管理入口：原在「大纲」栏，该栏随冗余页签一并撤除 —— 入口挪到本栏底部，功能不丢 */
  onManageVolumes?: () => void;
}) {
  const { groups, hintKey } = useMemo(() => paletteFor(genre, kind), [genre, kind]);

  return (
    <Box sx={{ flex: 1, overflowY: "auto", minHeight: 0, p: 1 }}>
      <Typography sx={groupLabelSx}>{t("writingLeft.palette")}</Typography>

      {groups.map((g) => (
        <Box key={g.key} sx={{ mb: 1.5 }}>
          <Typography sx={groupLabelSx}>{t(g.labelKey)}</Typography>
          {g.items.map((it) => (
            <PaletteRow key={it.id} item={it} />
          ))}
        </Box>
      ))}

      {hintKey && (
        <Typography sx={{ fontSize: 10.5, color: "text.disabled", lineHeight: 1.7, px: 0.25, py: 0.5 }}>
          {t(hintKey)}
        </Typography>
      )}

      {onManageVolumes && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<MenuBookIcon sx={{ fontSize: 13 }} />}
          onClick={onManageVolumes}
          sx={{ mt: 1, textTransform: "none", fontSize: 11 }}
        >
          {t("panel.layers.bookTitle")}
        </Button>
      )}
    </Box>
  );
}
