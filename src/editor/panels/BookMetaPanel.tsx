// 书属性卡（右栏「详情」tab · 书场景无选中分支，2026-09-14）
//
// 封面是**书的属性**（一张图），不是画布对象、不是题材内容、更不是动作 ——
// 所以落属性面板：选中实体显示实体属性，无选中显示书属性（本组件），职责正交。
// 数据零迁移：素材库 assets/writing/covers-{bookId}/ 下存图，**有文件=有封面**，
// writing_books 表不加列（复用既有 asset.rs 命令，后端零新增）。
// 书名/简介这里只读展示（编辑仍归写作台的书设置弹窗），封面是本卡唯一可写项。
import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import MenuBookRoundedIcon from "@mui/icons-material/MenuBookRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import { assetApi, type AssetInfo } from "../../services/tauri";
import { useWritingStore } from "../../store/writingStore";
import { useToastStore } from "../../store/toastStore";
import Tooltip from "@mui/material/Tooltip";
import { t } from "../../i18n";
import logger from "../../utils/logger";

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

export function BookMetaPanel({ bookId, onReparse }: { bookId: string | null; onReparse?: () => void }) {
  const book = useWritingStore((s) => s.books.find((b) => b.id === bookId) ?? null);
  const showToast = useToastStore((s) => s.showToast);
  const [cover, setCover] = useState<AssetInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

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

  return (
    <Box sx={{ flex: 1, overflowY: "auto", minHeight: 0, p: 1.5 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary", mb: 1 }}>
        {t("studio.cover.meta")}
      </Typography>
      <Typography sx={{ fontSize: 14, fontWeight: 700, wordBreak: "break-word" }}>{book.title}</Typography>
      <Typography sx={{ fontSize: 11.5, color: "text.secondary", lineHeight: 1.7, mt: 0.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {book.description || t("studio.cover.noDesc")}
      </Typography>

      {/* 方案 A：解析全书从顶栏迁入书属性卡（书级动作归书属性位）。可选 prop，
          未接回调（如单测挂载）时不渲染，行为与此前完全一致 */}
      {onReparse && (
        <Tooltip title={t("editorPage.parseBookTip")}>
          <Button
            size="small"
            variant="outlined"
            fullWidth
            onClick={onReparse}
            sx={{ mt: 1, textTransform: "none", fontSize: 11 }}
          >
            {t("editorPage.parseBook")}
          </Button>
        </Tooltip>
      )}

      <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary", mt: 2, mb: 0.75 }}>
        {t("studio.cover.title")}
      </Typography>
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
    </Box>
  );
}
