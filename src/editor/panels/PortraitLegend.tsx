// project-sight: 画像图例浮层（v2.5）
//
// 代码结构画像叠了一堆徽标（横带 →N←M / ⚙枢纽 / ⚠上帝类 / 内聚 / 环）和
// 连线语义（import 灰 / 调用绿紫 / 继承紫 / 循环红虚线），没有图例新手根本
// 看不懂。这里用画布右下角一个小按钮 + Popover 列出全部语义，
// 一次讲清「这张图的颜色和符号都代表什么」。
import { useState } from "react";
import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import LegendToggleIcon from "@mui/icons-material/LegendToggle";
import { t } from "../../i18n";

function Row({ color, text }: { color?: string; text: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.3 }}>
      <Box
        sx={{
          width: 14,
          height: 8,
          borderRadius: 0.5,
          flexShrink: 0,
          backgroundColor: color ?? "transparent",
          border: color ? "none" : "1px dashed #94a3b8",
        }}
      />
      <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary", lineHeight: 1.3 }}>
        {text}
      </Typography>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 1 }}>
      <Typography
        variant="caption"
        sx={{ fontSize: 10, fontWeight: 700, color: "text.primary", letterSpacing: 0.4, display: "block", mb: 0.25 }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** 画像图例：说明横带颜色 / 符号徽标 / 连线语义（画布右下角按钮 + Popover） */
export function PortraitLegend() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = Boolean(anchor);

  return (
    <>
      <Tooltip title={t("legend.title")} placement="left">
        <IconButton
          size="small"
          onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
          sx={{
            position: "absolute",
            right: 52,
            bottom: 12,
            zIndex: 11,
            backgroundColor: (th) =>
              th.palette.mode === "dark" ? "rgba(30,30,40,0.85)" : "rgba(255,255,255,0.9)",
            border: 1,
            borderColor: "divider",
            backdropFilter: "blur(8px)",
            "&:hover": { backgroundColor: (th) => (th.palette.mode === "dark" ? "rgba(40,40,55,0.95)" : "#fff") },
          }}
        >
          <LegendToggleIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
        slotProps={{ paper: { sx: { p: 1.5, minWidth: 260, maxWidth: 320 } } }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 12, display: "block", mb: 1 }}>
          {t("legend.title")}
        </Typography>
        <Section title={t("legend.bandTitle")}>
          <Row color="#38bdf8" text={t("legend.bandDir")} />
          <Row color="#94a3b8" text={t("legend.bandFile")} />
          <Row color="#ef4444" text={t("legend.bandCycle")} />
          <Row color="#f97316" text={t("legend.bandCohesion")} />
          <Row text={t("legend.bandDeps")} />
        </Section>
        <Section title={t("legend.badgeTitle")}>
          <Row text={t("legend.badgeHub")} />
          <Row text={t("legend.badgeGod")} />
          <Row text={t("legend.badgeCycle")} />
          <Row text={t("legend.badgeDepDeg")} />
        </Section>
        <Section title={t("legend.edgeTitle")}>
          <Row color="#64748b" text={t("legend.edgeImportInner")} />
          <Row color="#334155" text={t("legend.edgeImportCross")} />
          <Row color="#16A34A" text={t("legend.edgeCall")} />
          <Row color="#8B5CF6" text={t("legend.edgeInherit")} />
          <Row color="#EF4444" text={t("legend.edgeCircular")} />
          <Row text={t("legend.edgeWeight")} />
        </Section>
      </Popover>
    </>
  );
}
