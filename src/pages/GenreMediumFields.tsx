// 「体裁 × 载体」选择字段（受控单源）——建书向导 / 已有书体裁编辑 / 书架编辑共用一个口径。
//
// 设计：只负责渲染两个 Select（体裁 + 载体）+ `writing.metaHint`，值由调用方持有。
// 切体裁时内部联动把载体落到该体裁默认（defaultMediumForGenre），再回调 onMediumChange——
// 三处调用方都不必各自重复这段联动逻辑。
// 铁律：i18n key 只在渲染层 t()，模块级不调 t()。

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import { t } from "../i18n";
import { WRITING_GENRES, WRITING_MEDIUMS, defaultMediumForGenre } from "../utils/writingSchema";

interface GenreMediumFieldsProps {
  genre: string;
  medium: string;
  onGenreChange: (genre: string) => void;
  onMediumChange: (medium: string) => void;
}

export function GenreMediumFields({
  genre,
  medium,
  onGenreChange,
  onMediumChange,
}: GenreMediumFieldsProps) {
  // 载体选项 = 适配当前体裁的载体；未选体裁时禁用（避免 genre 空却带 medium 的不一致态）
  const mediumOptions = WRITING_MEDIUMS.filter(
    (m) => !genre || (m.fits as string[]).includes(genre)
  );

  return (
    <>
      <FormControl fullWidth size="small" sx={{ mt: 1 }}>
        <InputLabel>{t("writing.genre.title")}</InputLabel>
        <Select
          label={t("writing.genre.title")}
          value={genre}
          onChange={(e) => {
            const g = e.target.value;
            onGenreChange(g);
            // 切体裁联动载体：落到该体裁默认（不适配时回落空串，渲染层按小说·连载兜底）
            onMediumChange(defaultMediumForGenre(g));
          }}
        >
          {WRITING_GENRES.map((g) => (
            <MenuItem key={g.id} value={g.id} disabled={!g.ready}>
              {t(`writing.genre.${g.id}`)}
              {!g.ready ? `（${t("writing.genre.comingSoon")}）` : ""}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth size="small" sx={{ mt: 1.5 }} disabled={!genre}>
        <InputLabel>{t("writing.medium.title")}</InputLabel>
        <Select
          label={t("writing.medium.title")}
          value={medium}
          onChange={(e) => onMediumChange(e.target.value)}
        >
          {mediumOptions.map((m) => (
            <MenuItem key={m.id} value={m.id}>
              <Box sx={{ display: "flex", flexDirection: "column", py: 0.25 }}>
                <Typography sx={{ fontSize: 13 }}>{t(`writing.medium.${m.id}`)}</Typography>
                <Typography sx={{ fontSize: 11, color: "text.disabled" }}>
                  {t(`writing.medium.${m.id}Desc`)}
                </Typography>
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 1.5 }}>
        {t("writing.metaHint")}
      </Typography>
    </>
  );
}
