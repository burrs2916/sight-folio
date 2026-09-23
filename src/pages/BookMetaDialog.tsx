// 共享「编辑体裁与载体」对话框 —— 给已有书改 genre/medium。
//
// 场景：书架卡片 hover / 任何需要就地改体裁载体、而不必进写作台的地方。
// 与 NewBookDialog 同源：体裁/载体选择都走共享 GenreMediumFields，口径唯一。
// 纯展示 + 受控：初值由调用方给，保存动作交给 onSave（调用方决定落到哪个 store 方法）。

import { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import { t } from "../i18n";
import { GenreMediumFields } from "./GenreMediumFields";

interface BookMetaDialogProps {
  open: boolean;
  /** 打开时回填的当前值 */
  initialGenre: string;
  initialMedium: string;
  onClose: () => void;
  /** 保存实现（如 setBookMeta）。抛出即视为失败。 */
  onSave?: (genre: string, medium: string) => Promise<void> | void;
  /** 保存成功后回调（toast 等）。 */
  onSaved?: (genre: string, medium: string) => void;
  /** 保存失败回调（toast）。对话框保持打开，允许重试。 */
  onError?: (err: unknown) => void;
}

export function BookMetaDialog({
  open,
  initialGenre,
  initialMedium,
  onClose,
  onSave,
  onSaved,
  onError,
}: BookMetaDialogProps) {
  const [genre, setGenre] = useState("");
  const [medium, setMedium] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setGenre(initialGenre || "");
    setMedium(initialMedium || "");
    setSaving(false);
  }, [open, initialGenre, initialMedium]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave?.(genre, medium);
      onSaved?.(genre, medium);
      onClose();
    } catch (e) {
      console.error("[BookMetaDialog] save failed", e);
      onError?.(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>{t("writing.editBookMeta")}</DialogTitle>
      <DialogContent>
        <GenreMediumFields
          genre={genre}
          medium={medium}
          onGenreChange={setGenre}
          onMediumChange={setMedium}
        />
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose} disabled={saving}>
          {t("nav.cancel")}
        </Button>
        <Button size="small" variant="contained" onClick={() => void handleSave()} disabled={saving}>
          {t("nav.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
