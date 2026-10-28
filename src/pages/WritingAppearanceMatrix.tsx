// 人物出场图谱（F3）：设定卡 × 章节的出场热力矩阵。
//
// 数据来源（批次② 第二部分改造）：**全部为写作域自有数据的就地派生**——
//   章节 = writingStore.chapters（当前书，按 sortOrder）；
//   出场次数 = utils/writingProofread.computeSettingAppearances（正文命中 卡名 ∪ 别名）；
//   死设定 = 同一份派生里 total === 0 的行。
// 改造前这里读的是 F1/F2 扫描产物（project_files 的 writing:// 虚拟行 + metadata.appearances
// + findings ruleId=writing-dead-setting），于是产生一个绕不过去的坑：**没点「解析全书」
// 就是一张白图**。现在图谱与全书体检共用同一份计数，既不依赖扫描，也不会两边各说一套。
//
// 交互铁律（未变）：行头/单元格点击 → 跳写作台定位到该章正文（章节的正确工作面是写作台）。
// 注意与 writingOutline.chaptersOfSetting 的区别：那个是作者**显式挂到节拍**的出场（计划），
// 这里是**正文实际提及**（事实），两者本就该不一致，不一致正是要看的东西。

import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import { openWritingDesk } from "../utils/writingDeskWindow";
import { useWritingStore } from "../store/writingStore";
import { useToastStore } from "../store/toastStore";
import { computeSettingAppearances } from "../utils/writingProofread";
import { t } from "../i18n";

const PURPLE = "139,92,246"; // writing-analyzer 主题色（章节实体同色）

/** 图谱的一行表头 = 一张设定卡 */
interface MatrixColumn {
  id: string;
  name: string;
  total: number;
  /** 全书零提及（原「死设定」列，现在直接从同一份派生得到） */
  dead: boolean;
}

/**
 * 人物出场图谱。
 *
 * 无 props：数据全部就地派生自写作域，不再需要「先解析全书」的引导入口
 * （批次①曾为此加过 onScan 按钮，根因消除后一并撤掉）。
 */
export default function WritingAppearanceMatrix() {
  const chapters = useWritingStore((s) => s.chapters);
  const settings = useWritingStore((s) => s.settings);
  const activeBookId = useWritingStore((s) => s.activeBookId);

  const rows = useMemo(
    () => [...chapters].sort((a, b) => a.sortOrder - b.sortOrder),
    [chapters],
  );

  /** 每卡一行的提及账本；图谱热力格与 total/死设定判定同源 */
  const appearances = useMemo(() => computeSettingAppearances(rows, settings), [rows, settings]);

  // 列顺序 = characters 的排序（热度降序）。单元格必须按**同一个顺序**取数，
  // 否则表头与格子会错位——所以这里同时产出查数用的索引，渲染处只遍历 characters。
  const { characters, maxCount, countsOf } = useMemo(() => {
    const list: MatrixColumn[] = appearances
      .map((a) => ({ id: a.settingId, name: a.name, total: a.total, dead: a.total === 0 }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "zh-Hans-CN"));
    const index = new Map(appearances.map((a) => [a.settingId, a.countsByChapter]));
    let max = 0;
    for (const a of appearances) {
      for (const n of a.countsByChapter.values()) if (n > max) max = n;
    }
    return { characters: list, maxCount: max, countsOf: index };
  }, [appearances]);

  const openChapter = (chapterId: string) => {
    // 绝不静默：开不了窗要让人知道（沿用改造前的约定）
    openWritingDesk({ bookId: activeBookId, chapterId }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      useToastStore.getState().showToast(t("writing.appearanceMap.openFailed", { msg }), "error");
    });
  };

  // 两种空是不同的事，必须分开说：没写 = 去写；没建卡 = 去建卡。合成一句会把人指错方向。
  if (rows.length === 0) {
    return (
      <Typography variant="caption" color="text.disabled" sx={{ display: "block", p: 3, textAlign: "center", lineHeight: 1.7 }}>
        {t("writing.appearanceMap.noChapters")}
      </Typography>
    );
  }
  if (characters.length === 0) {
    return (
      <Typography variant="caption" color="text.disabled" sx={{ display: "block", p: 3, textAlign: "center", lineHeight: 1.7 }}>
        {t("writing.appearanceMap.noSettings")}
      </Typography>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {t("writing.appearanceMap.title")}
        </Typography>
        <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
          {t("writing.appearanceMap.hint", { chapters: rows.length, characters: characters.length })}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, ml: "auto" }}>
          <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
            {t("writing.appearanceMap.legendLow")}
          </Typography>
          {[0.12, 0.35, 0.6, 0.85].map((a) => (
            <Box key={a} sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: `rgba(${PURPLE},${a})` }} />
          ))}
          <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary" }}>
            {t("writing.appearanceMap.legendHigh")}
          </Typography>
        </Box>
      </Box>

      <Paper variant="outlined" sx={{ overflowX: "auto", borderRadius: 1.5 }}>
        <Box sx={{ display: "inline-flex", flexDirection: "column", minWidth: "100%" }}>
          {/* 表头：设定卡名竖排 */}
          <Box sx={{ display: "flex" }}>
            <Box sx={{ width: 200, flexShrink: 0, px: 1.25, py: 0.75 }} />
            {characters.map((c) => (
              <Tooltip key={c.id} title={c.dead ? t("writing.appearanceMap.deadTip", { name: c.name }) : `${c.name} · ${c.total}`}>
                <Box
                  data-testid={`appearance-col-${c.id}`}
                  sx={{
                    width: 40,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    py: 0.75,
                    borderBottom: 1,
                    borderColor: "divider",
                  }}
                >
                  <Typography
                    noWrap
                    title={c.name}
                    sx={{
                      fontSize: 10,
                      fontWeight: c.dead ? 400 : 600,
                      color: c.dead ? "warning.main" : "text.primary",
                      writingMode: "vertical-rl",
                      maxHeight: 88,
                      overflow: "hidden",
                    }}
                  >
                    {c.name}
                  </Typography>
                </Box>
              </Tooltip>
            ))}
          </Box>
          {/* 行：章节 × 提及次数热力格 */}
          {rows.map((ch) => (
            <Box key={ch.id} sx={{ display: "flex", borderTop: 1, borderColor: "divider", "&:hover": { bgcolor: "action.hover" } }}>
              <Tooltip title={ch.title}>
                <Box
                  onClick={() => openChapter(ch.id)}
                  sx={{
                    width: 200,
                    flexShrink: 0,
                    px: 1.25,
                    py: 0.5,
                    display: "flex",
                    alignItems: "center",
                    gap: 0.75,
                    cursor: "pointer",
                    overflow: "hidden",
                    "&:hover": { color: "primary.main" },
                  }}
                >
                  <Typography noWrap sx={{ fontSize: 11 }}>
                    {ch.title}
                  </Typography>
                </Box>
              </Tooltip>
              {characters.map((c) => {
                const n = countsOf.get(c.id)?.get(ch.id) ?? 0;
                const alpha = n === 0 ? 0 : 0.1 + (n / Math.max(maxCount, 1)) * 0.75;
                return (
                  <Tooltip key={c.id} title={`${c.name} × ${n}`}>
                    <Box
                      data-testid={`appearance-cell-${ch.id}-${c.id}`}
                      onClick={() => n > 0 && openChapter(ch.id)}
                      sx={{
                        width: 40,
                        flexShrink: 0,
                        height: 28,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: n > 0 ? "pointer" : "default",
                        borderLeft: 1,
                        borderColor: "divider",
                        bgcolor: alpha > 0 ? `rgba(${PURPLE},${alpha.toFixed(2)})` : "transparent",
                        "&:hover": n > 0 ? { outline: 1, outlineColor: "primary.main" } : undefined,
                      }}
                    >
                      {n > 0 && (
                        <Typography sx={{ fontSize: 10, fontWeight: 600, color: alpha > 0.5 ? "common.white" : "text.primary" }}>
                          {n}
                        </Typography>
                      )}
                    </Box>
                  </Tooltip>
                );
              })}
            </Box>
          ))}
        </Box>
      </Paper>
    </Box>
  );
}
