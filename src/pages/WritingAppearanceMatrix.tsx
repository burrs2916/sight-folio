// 人物出场图谱（F3）：实体图鉴的写作业务专属画像。
//
// 数据来源全部是 F1/F2 扫描产物，零新后端命令：
// - 章节 = project_files 中 path 以 writing:// 开头的虚拟文件行；
// - 出场次数 = 章节 metadata.appearances（[{id,name,count}]，scan_writing_book 落库）；
// - 死设定 = findings 中 ruleId=writing-dead-setting 的条目，作为全零列并入矩阵
//   （图鉴语境下「从未出场」与「出场热度」是同一张图的两个读法）。
//
// 交互铁律：行头/单元格点击 → 跳写作台定位到该章正文（章节的正确工作面是写作台，
// 不是 CodeWorkbench；此前 spawnCodeWorkbench 打开的是虚拟 md 文件，属错位工作面）。

import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import { openWritingDesk } from "../utils/writingDeskWindow";
import { useProjectStore } from "../store/projectStore";
import { useToastStore } from "../store/toastStore";
import type { ProjectFile } from "../services/tauri";
import { t } from "../i18n";

interface AppearanceEntry {
  id: string;
  name: string;
  count: number;
}

interface ChapterMeta {
  appearances?: AppearanceEntry[];
  volume?: string;
}

function parseMeta(file: ProjectFile): ChapterMeta {
  try {
    return JSON.parse(file.metadata) as ChapterMeta;
  } catch {
    return {};
  }
}

const PURPLE = "139,92,246"; // writing-analyzer 主题色（章节实体同色）

export default function WritingAppearanceMatrix() {
  const files = useProjectStore((s) => s.files);
  const findings = useProjectStore((s) => s.findings);
  const showToast = useToastStore((s) => s.showToast);

  const chapters = useMemo(
    () =>
      files
        .filter((f) => !f.isDirectory && f.path.startsWith("writing://"))
        .sort((a, b) => a.relPath.localeCompare(b.relPath, "zh-Hans-CN", { numeric: true })),
    [files]
  );

  const { characters, maxCount } = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; total: number; dead: boolean }>();
    for (const ch of chapters) {
      for (const a of parseMeta(ch).appearances ?? []) {
        const cur = byId.get(a.id);
        if (cur) cur.total += a.count;
        else byId.set(a.id, { id: a.id, name: a.name, total: a.count, dead: false });
      }
    }
    // 死设定并入全零列（warning 尾标），让图谱同时是「死设定一览」
    for (const f of findings) {
      if (f.ruleId !== "writing-dead-setting") continue;
      if (byId.has(f.targetId)) continue;
      let name = f.targetId;
      try {
        const m = JSON.parse(f.metadata) as { settingName?: string };
        if (m.settingName) name = m.settingName;
      } catch { /* 保底用 targetId */ }
      byId.set(f.targetId, { id: f.targetId, name, total: 0, dead: true });
    }
    const list = Array.from(byId.values()).sort(
      (a, b) => b.total - a.total || a.name.localeCompare(b.name, "zh-Hans-CN")
    );
    let max = 0;
    for (const ch of chapters) {
      for (const a of parseMeta(ch).appearances ?? []) if (a.count > max) max = a.count;
    }
    return { characters: list, maxCount: max };
  }, [chapters, findings]);

  const openChapter = (ch: ProjectFile) => {
    // 确定性约定（writing.rs）：fileId = wfile_{chapter_id}，path = writing://{bookId}/{chapter_id}.md
    const chapterId = ch.id.startsWith("wfile_") ? ch.id.slice("wfile_".length) : null;
    const bookId = ch.path.match(/^writing:\/\/([^/]+)\//)?.[1] ?? null;
    if (!chapterId) {
      // 绝不静默：解不出业务 id 就明说
      showToast(t("writing.appearanceMap.openFailed", { msg: `unbound file ${ch.id}` }), "error");
      return;
    }
    void openWritingDesk({ bookId, chapterId });
  };

  if (chapters.length === 0) {
    return (
      <Typography variant="caption" color="text.disabled" sx={{ display: "block", p: 3, textAlign: "center" }}>
        {t("writing.appearanceMap.noChapters")}
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
          {t("writing.appearanceMap.hint", { chapters: chapters.length, characters: characters.length })}
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

      {characters.length === 0 ? (
        <Typography variant="caption" color="text.disabled" sx={{ p: 2, textAlign: "center" }}>
          {t("writing.appearanceMap.noData")}
        </Typography>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto", borderRadius: 1.5 }}>
          <Box sx={{ display: "inline-flex", flexDirection: "column", minWidth: "100%" }}>
            {/* 表头：人物名竖排 */}
            <Box sx={{ display: "flex" }}>
              <Box sx={{ width: 200, flexShrink: 0, px: 1.25, py: 0.75 }} />
              {characters.map((c) => (
                <Tooltip key={c.id} title={c.dead ? t("writing.appearanceMap.deadTip", { name: c.name }) : `${c.name} · ${c.total}`}>
                  <Box
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
            {/* 行：章节 × 出场次数热力格 */}
            {chapters.map((ch) => {
              const counts = new Map<string, number>();
              for (const a of parseMeta(ch).appearances ?? []) counts.set(a.id, a.count);
              return (
                <Box key={ch.id} sx={{ display: "flex", borderTop: 1, borderColor: "divider", "&:hover": { bgcolor: "action.hover" } }}>
                  <Tooltip title={ch.relPath}>
                    <Box
                      onClick={() => openChapter(ch)}
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
                        {ch.name}
                      </Typography>
                    </Box>
                  </Tooltip>
                  {characters.map((c) => {
                    const n = counts.get(c.id) ?? 0;
                    const alpha = n === 0 ? 0 : 0.1 + (n / Math.max(maxCount, 1)) * 0.75;
                    return (
                      <Tooltip key={c.id} title={`${c.name} × ${n}`}>
                        <Box
                          onClick={() => openChapter(ch)}
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
              );
            })}
          </Box>
        </Paper>
      )}
    </Box>
  );
}
