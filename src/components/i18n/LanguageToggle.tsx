import { useI18n, t } from "../../i18n";
import TranslateRoundedIcon from "@mui/icons-material/TranslateRounded";
import Box from "@mui/material/Box";

/**
 * 语言切换按钮（右上角中英文切换）。
 * 风格遵循本项目 MUI 主题（bordered pill + 主色），位置参考 snap-craft 的右上角按钮。
 * 文字显示「将要切换到的语言」，点击即在 中/英 间切换并持久化到 localStorage。
 */
export default function LanguageToggle() {
  const { lang, toggleLang } = useI18n();
  const isZh = lang === "zh-CN";
  const nextLabel = isZh ? t("lang.en") : t("lang.zh");
  const title = isZh ? t("lang.toggleToEn") : t("lang.toggleToZh");

  return (
    <Box
      component="button"
      onClick={toggleLang}
      title={title}
      aria-label={title}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        height: 32,
        px: 1,
        minWidth: 64,
        whiteSpace: "nowrap",
        borderRadius: 1.5,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        color: "text.secondary",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
        transition: "all 0.15s",
        "&:hover": { borderColor: "primary.main", color: "primary.main", bgcolor: "action.hover" },
      }}
    >
      <TranslateRoundedIcon sx={{ fontSize: 16 }} />
      <span>{nextLabel}</span>
    </Box>
  );
}
