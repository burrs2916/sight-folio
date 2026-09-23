// 素材库对话框（H2 插画链路）：写作插画的「选图 / 上传 / 删除 / 应用」入口。
//
// 与原项目 AssetPicker 的取舍：不做视频/字体/绑定检查等大而全能力，
// 只保留写作创作要的三件事 —— 上传图片、浏览缩略图、应用到画布。
// 后端零新增：save/list/thumbnail/delete 全部复用既有 asset.rs 命令。
// 存储分类固定 writing/illustrations（与代码项目资源隔离，删库互不影响）。
import { useCallback, useEffect, useRef, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import { assetApi, type AssetInfo } from "../../services/tauri";
import { useAssetPickerStore } from "../../store/assetPickerStore";
import { useToastStore } from "../../store/toastStore";
import { t } from "../../i18n";

/** 素材库固定分类：写作插画 */
const CATEGORY = "writing";
const SUBCATEGORY = "illustrations";

/** 单张缩略图（懒加载 data_url，失败回退占位块） */
function AssetThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    assetApi
      .thumbnail(path, 320)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [path]);
  if (failed || !url) {
    return <Box sx={{ width: "100%", height: "100%", bgcolor: "action.hover" }} />;
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
    />
  );
}

export function AssetLibraryDialog({ onPick }: { onPick: (asset: AssetInfo) => void }) {
  const open = useAssetPickerStore((s) => s.open);
  const replaceComponentId = useAssetPickerStore((s) => s.replaceComponentId);
  const chapterCoverSetter = useAssetPickerStore((s) => s.chapterCoverSetter);
  const closePicker = useAssetPickerStore((s) => s.closePicker);
  const showToast = useToastStore((s) => s.showToast);

  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AssetInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await assetApi.list(CATEGORY, SUBCATEGORY);
      setAssets(list);
    } catch (e) {
      console.error("[AssetLibraryDialog] list failed", e);
      showToast(t("studio.illustration.loadFailed"), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (open) {
      setSelected(null);
      void reload();
    }
  }, [open, reload]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const buf = new Uint8Array(await file.arrayBuffer());
        await assetApi.save(CATEGORY, SUBCATEGORY, file.name, buf);
      }
      await reload();
    } catch (e) {
      console.error("[AssetLibraryDialog] upload failed", e);
      showToast(t("studio.opFailed", { msg: String(e) }), "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (asset: AssetInfo) => {
    if (!window.confirm(t("studio.illustration.deleteConfirm"))) return;
    try {
      await assetApi.remove(asset.path);
      setSelected((cur) => (cur?.path === asset.path ? null : cur));
      await reload();
    } catch (e) {
      console.error("[AssetLibraryDialog] delete failed", e);
      showToast(t("studio.opFailed", { msg: String(e) }), "error");
    }
  };

  const handleConfirm = () => {
    if (!selected) return;
    onPick(selected);
    closePicker();
  };

  return (
    <Dialog open={open} onClose={closePicker} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 15, pb: 1 }}>
        {replaceComponentId
          ? t("studio.illustration.replaceTitle")
          : chapterCoverSetter
            ? t("studio.illustration.coverTitle")
            : t("studio.illustration.title")}
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {/* 上传条 */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
          <Button
            size="small"
            variant="contained"
            startIcon={uploading ? <CircularProgress size={13} color="inherit" /> : <UploadFileRoundedIcon sx={{ fontSize: 15 }} />}
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {t("studio.illustration.upload")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            multiple
            hidden
            onChange={(e) => void handleUpload(e.target.files)}
          />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {t("studio.illustration.hint")}
          </Typography>
        </Box>
        {/* 缩略图网格 */}
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={22} />
          </Box>
        ) : assets.length === 0 ? (
          <Box sx={{ py: 5, textAlign: "center", color: "text.secondary" }}>
            <Typography variant="body2">{t("studio.illustration.empty")}</Typography>
          </Box>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: 1,
              maxHeight: "52vh",
              overflowY: "auto",
              py: 0.5,
            }}
          >
            {assets.map((asset) => {
              const isSelected = selected?.path === asset.path;
              return (
                <Box
                  key={asset.path}
                  onClick={() => setSelected(asset)}
                  sx={{
                    position: "relative",
                    paddingTop: "72%",
                    borderRadius: 1.5,
                    overflow: "hidden",
                    cursor: "pointer",
                    border: 2,
                    borderColor: isSelected ? "primary.main" : "divider",
                    bgcolor: "action.hover",
                    transition: "border-color 0.15s",
                    "&:hover .asset-del": { opacity: 1 },
                  }}
                >
                  <Box sx={{ position: "absolute", inset: 0 }}>
                    <AssetThumb path={asset.path} />
                  </Box>
                  <IconButton
                    className="asset-del"
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(asset);
                    }}
                    sx={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      opacity: 0,
                      transition: "opacity 0.15s",
                      bgcolor: "rgba(0,0,0,0.45)",
                      color: "#fff",
                      "&:hover": { bgcolor: "rgba(0,0,0,0.65)" },
                      p: 0.4,
                    }}
                  >
                    <DeleteOutlineRoundedIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                  <Typography
                    noWrap
                    sx={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      px: 0.75,
                      py: 0.25,
                      fontSize: 9,
                      color: "#fff",
                      background: "linear-gradient(transparent, rgba(0,0,0,0.6))",
                    }}
                  >
                    {asset.name}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 1.5 }}>
        <Button size="small" onClick={closePicker}>
          {t("nav.cancel")}
        </Button>
        <Button size="small" variant="contained" disabled={!selected} onClick={handleConfirm}>
          {replaceComponentId
            ? t("studio.illustration.replace")
            : chapterCoverSetter
              ? t("studio.illustration.cover")
              : t("studio.illustration.insert")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
