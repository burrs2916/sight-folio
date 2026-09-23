// 正文视图右栏「详情」栏卡片（2026-09-19 拍板）：
//
// 正文视图此前在 tab1 详情分派链里没有专属分支，无选中时兜底落到 BookMetaPanel
// （书属性卡）——与正文无关。本卡以 **当前激活章**（writingDocsStore.activeChapterByBook
// 会话态）为中心展示正文档案：面包屑 / 状态 / 字数 / 节拍 / 插图数，全部只读。
// 正文编辑收敛到写作台独立窗口（openWritingDesk），画布正文 = 只读审阅 + 设计联动。
// 口径复用 utils（chapterPath / beatForChapter），零第二份。
import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import { useWritingStore } from "../../store/writingStore";
import { useWritingDocsStore } from "../../store/writingDocsStore";
import { openWritingDesk } from "../../utils/writingDeskWindow";
import { t } from "../../i18n";
import { beatForChapter, chapterPath } from "../../utils/writingOutline";
import { beatEventText } from "../../utils/writingTimeline";

export function WritingDocsDetailCard({ bookId }: { bookId: string | null }) {
  const chapters = useWritingStore((s) => s.chapters);
  const outlines = useWritingStore((s) => s.outlines);
  const docsChapterId = useWritingDocsStore((s) => (bookId ? s.activeChapterByBook[bookId] : null));
  const chapter = useMemo(
    () => (bookId && docsChapterId ? chapters.find((c) => c.id === docsChapterId) ?? null : null),
    [bookId, docsChapterId, chapters],
  );

  const beat = useMemo(() => (chapter ? beatForChapter(outlines, chapter.id) : null), [outlines, chapter]);
  // 插图数：本章正文 html 内 <img> 出现次数（content 随章列表全量在手，零额外读盘）
  const illustrationCount = useMemo(() => chapter?.content.match(/<img\b/g)?.length ?? 0, [chapter]);
  const crumbs = useMemo(
    () => (chapter ? chapterPath(chapters, chapter.id).map((seg) => seg.title).filter(Boolean) : []),
    [chapters, chapter],
  );

  if (!bookId || !chapter) {
    return (
      <Box sx={{ p: 2, display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <Typography variant="caption" color="text.secondary">{t("writing.docsDetailEmpty")}</Typography>
      </Box>
    );
  }

  const rowSx = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 } as const;

  return (
    <Box sx={{ flex: 1, overflowY: "auto", minHeight: 0, p: 1.5 }}>
      {crumbs.length > 1 && (
        <Typography sx={{ fontSize: 10, color: "text.disabled", mb: 0.25 }} noWrap>
          {crumbs.slice(0, -1).join(" › ")}
        </Typography>
      )}
      <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.75 }} noWrap>{chapter.title}</Typography>

      <Box sx={rowSx}>
        <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{t("analyzer.writing.entity.chapter.prop.status")}</Typography>
        <Typography sx={{ fontSize: 11 }}>{t(chapter.status === "finished" ? "editor.writing.status.finished" : "editor.writing.status.draft")}</Typography>
      </Box>
      <Box sx={rowSx}>
        <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{t("writing.totalWords")}</Typography>
        <Typography sx={{ fontSize: 11 }}>{t("writing.words", { n: chapter.wordCount })}</Typography>
      </Box>
      <Box sx={rowSx}>
        <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{t("editor.writing.inspector.beat")}</Typography>
        <Typography noWrap sx={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", maxWidth: "60%" }}>
          {beat ? beatEventText(beat).slice(0, 40) || beat.title || t("editor.writing.inspector.beat") : t("editor.writing.inspector.unplanned")}
        </Typography>
      </Box>
      <Box sx={rowSx}>
        <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{t("writing.docsDetailIllustrations")}</Typography>
        <Typography sx={{ fontSize: 11 }}>{illustrationCount}</Typography>
      </Box>

      {/* 编辑动线唯一出口：写作台独立窗口（画布正文只读） */}
      <Button
        size="small"
        variant="outlined"
        fullWidth
        onClick={() => void openWritingDesk({ bookId, chapterId: chapter.id })}
        title={t("writing.openInWritingDesk")}
        sx={{ textTransform: "none", fontSize: 11, mt: 1.25, borderRadius: 2 }}
      >
        ⇢ {t("writing.openInWritingDesk")}
      </Button>
    </Box>
  );
}
