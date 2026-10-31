// 书属性卡（右栏「详情」tab · 书场景无选中分支，2026-09-14；编辑面扩展 2026-10-31 第十四轮）
//
// 封面是**书的属性**（一张图），不是画布对象、不是题材内容、更不是动作 ——
// 所以落属性面板：选中实体显示实体属性，无选中显示书属性（本组件），职责正交。
// 数据零迁移：素材库 assets/writing/covers-{bookId}/ 下存图，**有文件=有封面**，
// writing_books 表不加列（复用既有 asset.rs 命令，后端零新增）。
//
// 第十四轮：从「近乎只读、仅封面可改」升级为创作者「规划本书」的完整编辑面。
// 立项一本书时最想随手调的元信息 —— 书名 / 简介 / 体裁·载体 / 连载·完结 / 日更目标 ——
// 此前在工作室一律改不动，得跳写作台书设置弹窗。本卡补齐就地编辑，但**不另造写逻辑**：
//   · 书名 → renameBook（与写作台/L1 页签改名同一 setter）
//   · 体裁·载体 → BookMetaDialog + setBookMeta（与书架 hover 同一共享对话框、同一 setter）
//   · 简介·状态 → setBookMeta（本轮扩展承载 description/status）
//   · 日更目标 → setDailyGoal（写作台同 setter）
// 全部单一权威 setter，工作室与写作台零口径漂移（前几轮反复踩的跨视图一致性坑）。
import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import MenuBookRoundedIcon from "@mui/icons-material/MenuBookRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { assetApi, type AssetInfo } from "../../services/tauri";
import { useWritingStore } from "../../store/writingStore";
import { useToastStore } from "../../store/toastStore";
import Tooltip from "@mui/material/Tooltip";
import { t } from "../../i18n";
import logger from "../../utils/logger";
import { genreLabelKey, mediumLabelKey } from "../../utils/writingSchema";
import { BookMetaDialog } from "../../pages/BookMetaDialog";

/** 素材库分类约定：插画走 writing/illustrations，封面走 writing/covers-{bookId}（一书一目录） */
const CATEGORY = "writing";
const coverSub = (bookId: string) => `covers-${bookId}`;

/** 封面预览（懒加载 data_url，失败回退占位块） */
function CoverPreview({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    assetApi
      .thumbnail(path, 480)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [path]);
  if (failed || !url) return <Box sx={{ width: "100%", height: "100%", bgcolor: "action.hover" }} />;
  return (
    <img
      src={url}
      alt={t("studio.cover.title")}
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
    />
  );
}

/** 小节标题（uppercase caption，与卡内既有「作品信息 / 作品封面」同一视觉语言） */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      sx={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        color: "text.secondary",
        mt: 2,
        mb: 0.75,
      }}
    >
      {children}
    </Typography>
  );
}

export function BookMetaPanel({ bookId, onReparse }: { bookId: string | null; onReparse?: () => void }) {
  const book = useWritingStore((s) => s.books.find((b) => b.id === bookId) ?? null);
  const showToast = useToastStore((s) => s.showToast);
  const [cover, setCover] = useState<AssetInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 体裁·载体编辑对话框（复用书架同款 BookMetaDialog，单一 setBookMeta 写路径）
  const [metaDialogOpen, setMetaDialogOpen] = useState(false);

  // 就地编辑草稿：书名 / 简介 / 日更目标。bookId 切换即从活 book 记录重新回填，
  // 外部改名（L1 页签 / 写作台）落库后 books[].* 变化也经此同步（草稿仅在未编辑时跟随）。
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftGoal, setDraftGoal] = useState("0");
  useEffect(() => {
    if (!book) return;
    setDraftTitle(book.title ?? "");
    setDraftDesc(book.description ?? "");
    setDraftGoal(String(book.dailyGoal ?? 0));
    // 仅在切书时重置草稿；同书内用户正在输入不被外部刷新打断。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // 书接线：从场景直开时 writingStore 可能还没拉书目（与「要素」面板同一模式）
  useEffect(() => {
    if (!bookId) return;
    if (useWritingStore.getState().books.length === 0) {
      void useWritingStore.getState().loadBooks().catch(() => {});
    }
  }, [bookId]);

  const reload = useCallback(async () => {
    if (!bookId) return;
    setLoading(true);
    try {
      const list = await assetApi.list(CATEGORY, coverSub(bookId));
      setCover(list[0] ?? null);
    } catch (e) {
      logger.warn("BookMetaPanel", "list cover failed", { error: String(e) });
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ─── 提交：书名（与 L1 页签 / 写作台同 setter）───
  const commitTitle = useCallback(() => {
    if (!book) return;
    const next = draftTitle.trim();
    if (!next || next === book.title) {
      setDraftTitle(book.title); // 空/未变 → 回退原值
      return;
    }
    void useWritingStore
      .getState()
      .renameBook(book.id, next)
      .catch((e) => showToast(t("studio.opFailed", { msg: String(e) }), "error"));
  }, [book, draftTitle, showToast]);

  // ─── 提交：简介（setBookMeta.description；trim 后与原值同则跳过落库）───
  const commitDesc = useCallback(() => {
    if (!book) return;
    const next = draftDesc.trim();
    if (next === (book.description ?? "")) return;
    void useWritingStore
      .getState()
      .setBookMeta(book.id, { description: next })
      .catch((e) => showToast(t("studio.opFailed", { msg: String(e) }), "error"));
  }, [book, draftDesc, showToast]);

  // ─── 提交：日更目标（setDailyGoal，0 = 未设）───
  const commitGoal = useCallback(() => {
    if (!book) return;
    const n = Math.max(0, Math.min(1_000_000, Math.round(Number(draftGoal) || 0)));
    if (n === (book.dailyGoal ?? 0)) {
      setDraftGoal(String(n));
      return;
    }
    void useWritingStore
      .getState()
      .setDailyGoal(book.id, n)
      .then(() => setDraftGoal(String(n)))
      .catch((e) => showToast(t("studio.opFailed", { msg: String(e) }), "error"));
  }, [book, draftGoal, showToast]);

  // ─── 即时切换：连载 / 完结（setBookMeta.status，'' / draft 视为连载中）───
  const commitStatus = useCallback(
    (next: string) => {
      if (!book || next === book.status) return;
      void useWritingStore
        .getState()
        .setBookMeta(book.id, { status: next })
        .catch((e) => showToast(t("studio.opFailed", { msg: String(e) }), "error"));
    },
    [book, showToast],
  );

  const handleUpload = async (files: FileList | null) => {
    if (!bookId || !files || files.length === 0) return;
    setUploading(true);
    try {
      const file = files[0];
      const buf = new Uint8Array(await file.arrayBuffer());
      const saved = await assetApi.save(CATEGORY, coverSub(bookId), file.name, buf);
      // 一书一封面：新图落盘成功后再清旧图，失败不影响新封面生效
      if (cover && cover.path !== saved.path) {
        await assetApi.remove(cover.path).catch(() => {});
      }
      setCover(saved);
      showToast(t("studio.cover.saved"), "success");
    } catch (e) {
      logger.warn("BookMetaPanel", "save cover failed", { error: String(e) });
      showToast(t("studio.opFailed", { msg: String(e) }), "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleClear = async () => {
    if (!cover) return;
    if (!window.confirm(t("studio.cover.clearConfirm"))) return;
    try {
      await assetApi.remove(cover.path);
      setCover(null);
      showToast(t("studio.cover.cleared"), "success");
    } catch (e) {
      logger.warn("BookMetaPanel", "clear cover failed", { error: String(e) });
      showToast(t("studio.opFailed", { msg: String(e) }), "error");
    }
  };

  if (!bookId || !book) return null;

  const ongoingValue = book.status === "finished" ? "finished" : "ongoing";

  return (
    <Box sx={{ flex: 1, overflowY: "auto", minHeight: 0, p: 1.5 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary", mb: 1 }}>
        {t("studio.cover.meta")}
      </Typography>

      {/* 书名：就地编辑（与 L1 页签改名 / 写作台 renameBook 同一 setter） */}
      <TextField
        size="small"
        fullWidth
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder={t("studio.bookMeta.title")}
        slotProps={{
          input: {
            startAdornment: <MenuBookRoundedIcon sx={{ fontSize: 16, color: "text.disabled", mr: 0.75 }} />,
          },
        }}
        sx={{ "& .MuiInputBase-input": { fontSize: 14, fontWeight: 700 } }}
      />

      {/* 体裁 · 载体：显示当前值 + 就地编辑（复用 BookMetaDialog + setBookMeta） */}
      <SectionLabel>{t("studio.bookMeta.genreMedium")}</SectionLabel>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 12.5, color: "text.primary" }}>
          {t(genreLabelKey(book.genre))} · {t(mediumLabelKey(book.medium))}
        </Typography>
        <Tooltip title={t("studio.bookMeta.edit")}>
          <IconButton size="small" onClick={() => setMetaDialogOpen(true)} aria-label={t("studio.bookMeta.edit")}>
            <EditOutlinedIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* 创作状态：连载中 / 完结（setBookMeta.status） */}
      <SectionLabel>{t("studio.bookMeta.status")}</SectionLabel>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={ongoingValue}
        onChange={(_e, v) => {
          if (v === "ongoing" || v === "finished") commitStatus(v === "finished" ? "finished" : "draft");
        }}
        sx={{ "& .MuiToggleButton-root": { fontSize: 11, px: 1.5, textTransform: "none" } }}
      >
        <ToggleButton value="ongoing">{t("dashboard.statusOngoing")}</ToggleButton>
        <ToggleButton value="finished">{t("dashboard.statusFinished")}</ToggleButton>
      </ToggleButtonGroup>

      {/* 简介：多行就地编辑（setBookMeta.description） */}
      <SectionLabel>{t("studio.bookMeta.description")}</SectionLabel>
      <TextField
        size="small"
        fullWidth
        multiline
        minRows={3}
        maxRows={8}
        value={draftDesc}
        onChange={(e) => setDraftDesc(e.target.value)}
        onBlur={commitDesc}
        placeholder={t("studio.cover.noDesc")}
        sx={{ "& .MuiInputBase-input": { fontSize: 12.5, lineHeight: 1.7 } }}
      />

      {/* 日更目标：数字（setDailyGoal，0 = 未设） */}
      <SectionLabel>{t("studio.bookMeta.dailyGoal")}</SectionLabel>
      <TextField
        size="small"
        type="number"
        value={draftGoal}
        onChange={(e) => setDraftGoal(e.target.value)}
        onBlur={commitGoal}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        slotProps={{ htmlInput: { min: 0, max: 1000000, step: 100 } }}
        sx={{ width: 140, "& .MuiInputBase-input": { fontSize: 12.5 } }}
      />

      {/* 方案 A：解析全书从顶栏迁入书属性卡（书级动作归书属性位）。可选 prop，
          未接回调（如单测挂载）时不渲染，行为与此前完全一致 */}
      {onReparse && (
        <Tooltip title={t("editorPage.parseBookTip")}>
          <Button
            size="small"
            variant="outlined"
            fullWidth
            onClick={onReparse}
            sx={{ mt: 2, textTransform: "none", fontSize: 11 }}
          >
            {t("editorPage.parseBook")}
          </Button>
        </Tooltip>
      )}

      <SectionLabel>{t("studio.cover.title")}</SectionLabel>
      <Box
        sx={{
          width: 132,
          height: 176,
          borderRadius: 1.5,
          overflow: "hidden",
          border: 1,
          borderColor: "divider",
          bgcolor: "action.hover",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {loading ? (
          <CircularProgress size={20} />
        ) : cover ? (
          <CoverPreview path={cover.path} />
        ) : (
          <Box sx={{ textAlign: "center", color: "text.disabled", px: 1 }}>
            <MenuBookRoundedIcon sx={{ fontSize: 30, opacity: 0.4 }} />
            <Typography sx={{ fontSize: 10.5, mt: 0.5 }}>{t("studio.cover.empty")}</Typography>
          </Box>
        )}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
        <Button
          size="small"
          variant={cover ? "outlined" : "contained"}
          startIcon={uploading ? <CircularProgress size={12} color="inherit" /> : <UploadFileRoundedIcon sx={{ fontSize: 14 }} />}
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          sx={{ textTransform: "none", fontSize: 11 }}
        >
          {cover ? t("studio.cover.replace") : t("studio.cover.set")}
        </Button>
        {cover && (
          <Button
            size="small"
            color="inherit"
            startIcon={<DeleteOutlineRoundedIcon sx={{ fontSize: 14 }} />}
            onClick={() => void handleClear()}
            sx={{ textTransform: "none", fontSize: 11 }}
          >
            {t("studio.cover.clear")}
          </Button>
        )}
      </Box>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        hidden
        onChange={(e) => void handleUpload(e.target.files)}
      />

      {/* 体裁·载体对话框：与书架同一组件、同一 setBookMeta 写路径 */}
      <BookMetaDialog
        open={metaDialogOpen}
        initialGenre={book.genre}
        initialMedium={book.medium}
        onClose={() => setMetaDialogOpen(false)}
        onSave={(genre, medium) => useWritingStore.getState().setBookMeta(book.id, { genre, medium })}
        onSaved={() => showToast(t("studio.bookMeta.saved"), "success")}
        onError={(e) => showToast(t("studio.opFailed", { msg: String(e) }), "error")}
      />
    </Box>
  );
}
