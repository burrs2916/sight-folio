// sight-folio: 扫描入口空态引导（P0 UX 痛点）
// 用户曾反馈"选文件夹点导入无效"——根目录选择器只是工具栏里一个小图标，
// 扫描按钮在没有根目录时一直是禁用态，新用户完全不知道下一步该点哪。
// 这里在编辑区放一张醒目的引导卡：未选根目录时主按钮直接"选择项目根目录"，
// 已选根目录但还没扫描时主按钮变成"开始扫描项目"，把两步流程讲清楚。

import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import SearchIcon from "@mui/icons-material/Search";
import AutoAwesomeMosaicIcon from "@mui/icons-material/AutoAwesomeMosaic";
import { t } from "../i18n";

const float = keyframes`
  0%   { transform: translateY(0) rotate(-1deg); }
  50%  { transform: translateY(-10px) rotate(1deg); }
  100% { transform: translateY(0) rotate(-1deg); }
`;

const shimmer = keyframes`
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`;

interface ScanEmptyStateProps {
  /** 已设置的项目根目录（可能为 null） */
  projectRoot: string | null;
  /** 扫描完成后文件数（用于区分"未选根目录"与"已选但未扫描"） */
  filesCount: number;
  /** 是否正在扫描（扫描中不展示空态） */
  scanning: boolean;
  /** 点击"选择项目根目录" */
  onSelectRoot: () => void;
  /** 点击"开始扫描项目" */
  onScan: () => void;
}

export function ScanEmptyState({
  projectRoot,
  filesCount,
  scanning,
  onSelectRoot,
  onScan,
}: ScanEmptyStateProps) {
  const hasRoot = !!projectRoot && filesCount === 0;
  // 未选根目录 → 主按钮引导选目录；已选目录但未扫描 → 主按钮引导扫描
  const ctaLabel = hasRoot ? t("scan.startScan") : t("scan.selectRoot");
  const ctaIcon = hasRoot ? <SearchIcon /> : <FolderOpenIcon />;
  const ctaAction = hasRoot ? onScan : onSelectRoot;

  const title = hasRoot ? t("scan.readyTitle") : t("scan.startTitle");
  const desc = hasRoot ? t("scan.readyDesc") : t("scan.startDesc");

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 背景柔光 */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          background: (t) =>
            `radial-gradient(60% 60% at 50% 30%, ${t.palette.primary.main}14, transparent 70%)`,
          pointerEvents: "none",
        }}
      />

      <Box
        sx={{
          position: "relative",
          maxWidth: 520,
          width: "100%",
          textAlign: "center",
          p: { xs: 3, sm: 5 },
          borderRadius: 4,
          background: (t) =>
            t.palette.mode === "dark"
              ? "rgba(255,255,255,0.04)"
              : "rgba(255,255,255,0.7)",
          backdropFilter: "blur(24px) saturate(160%)",
          border: (t) =>
            `1px solid ${t.palette.mode === "dark" ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.08)"}`,
          boxShadow: (t) =>
            t.palette.mode === "dark"
              ? "0 30px 80px -30px rgba(0,0,0,0.6)"
              : "0 30px 80px -30px rgba(15,23,42,0.25)",
        }}
      >
        {/* 漂浮的主图标 */}
        <Box
          sx={{
            width: 84,
            height: 84,
            mx: "auto",
            mb: 2.5,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: (t) =>
              `linear-gradient(120deg, ${t.palette.primary.main}, ${t.palette.secondary.main}, ${t.palette.primary.main})`,
            backgroundSize: "200% 200%",
            animation: `${shimmer} 6s ease infinite, ${float} 5s ease-in-out infinite`,
            color: "common.white",
            boxShadow: (t) => `0 14px 40px -10px ${t.palette.primary.main}99`,
          }}
        >
          <AutoAwesomeMosaicIcon sx={{ fontSize: 40 }} />
        </Box>

        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
          {title}
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: "text.secondary", lineHeight: 1.7, mb: 3 }}
        >
          {desc}
        </Typography>

        {/* 两步流程提示 */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 1.5,
            mb: 3,
            flexWrap: "wrap",
          }}
        >
          <StepBadge
            index={1}
            label={t("scan.step1")}
            done={hasRoot}
          />
          <Box
            sx={{
              width: 28,
              height: 2,
              borderRadius: 1,
              background: (th) => (hasRoot ? th.palette.primary.main : "divider"),
            }}
          />
          <StepBadge
            index={2}
            label={t("scan.step2")}
            done={false}
            active={hasRoot}
          />
        </Box>

        {projectRoot && (
          <Tooltip title={projectRoot}>
            <Chip
              icon={<FolderOpenIcon />}
              label={projectRoot}
              size="small"
              variant="outlined"
              sx={{
                maxWidth: "100%",
                mb: 3,
                fontFamily: "monospace",
                "& .MuiChip-label": {
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                },
              }}
            />
          </Tooltip>
        )}

        <Box sx={{ display: "flex", justifyContent: "center" }}>
          <Button
            variant="contained"
            size="large"
            disableElevation
            startIcon={ctaIcon}
            onClick={ctaAction}
            disabled={scanning}
            sx={{
              borderRadius: 999,
              px: 4,
              py: 1.25,
              textTransform: "none",
              fontWeight: 600,
              fontSize: 15,
              background: (t) =>
                `linear-gradient(120deg, ${t.palette.primary.main}, ${t.palette.secondary.main})`,
              "&:hover": {
                transform: "translateY(-2px)",
                boxShadow: (t) => `0 16px 36px -12px ${t.palette.primary.main}cc`,
              },
              transition: "transform .25s cubic-bezier(.16,1,.3,1), box-shadow .25s",
            }}
          >
            {scanning ? t("scan.scanning") : ctaLabel}
          </Button>
        </Box>

        {!hasRoot && (
          <Typography
            variant="caption"
            sx={{ display: "block", mt: 2, color: "text.disabled" }}
          >
            {t("scan.toolbarHint")}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function StepBadge({
  index,
  label,
  done,
  active,
}: {
  index: number;
  label: string;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Box
        sx={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 700,
          color: done || active ? "common.white" : "text.secondary",
          background: (t) =>
            done
              ? t.palette.success.main
              : active
              ? t.palette.primary.main
              : t.palette.mode === "dark"
              ? "rgba(255,255,255,0.08)"
              : "rgba(15,23,42,0.06)",
          border: (t) =>
            `1px solid ${
              done
                ? t.palette.success.main
                : active
                ? t.palette.primary.main
                : "transparent"
            }`,
        }}
      >
        {done ? "✓" : index}
      </Box>
      <Typography
        variant="body2"
        sx={{
          color: done || active ? "text.primary" : "text.secondary",
          fontWeight: done || active ? 600 : 400,
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}
