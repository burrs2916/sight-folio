// 共享「新建作品」对话框（羽化 P：消除「新建作品 N」丑默认名）。
//
// 设计：纯展示 + 受控。收集 作品名 + 体裁 + 载体，创建动作交给调用方传入的
// onCreate（落点由调用方决定 —— 书架/代码场景工具栏落工作室，写作台可复用落写作台），
// 不在本组件内耦合任何导航。体裁/载体选择复用共享的 GenreMediumFields（与
// 已有书体裁编辑、书架编辑同一口径，写第二份即回归）。
//
// 与 createBookAutoNamed 的关系：手势型入口（L1「＋」/ 拖载体）仍走自动命名 + 落工作室；
// 本对话框服务「用户显式点新建」的入口（书架/代码场景工具栏/工作室空态/写作台）。

import { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useWritingStore } from "../store/writingStore";
import { t } from "../i18n";
import { GenreMediumFields } from "./GenreMediumFields";

export interface NewBookResult {
  id: string;
  title: string;
}

interface NewBookDialogProps {
  open: boolean;
  /** 关闭（取消或创建成功后） */
  onClose: () => void;
  /** 创建实现：返回新书 id/title。调用方决定落点（工作室 / 写作台）。 */
  onCreate?: (name: string, genre: string, medium: string) => Promise<NewBookResult>;
  /** 创建成功后回调（toast / 聚焦等）。 */
  onCreated?: (book: NewBookResult) => void;
  /** 创建失败回调（toast）。对话框保持打开，允许重试。 */
  onError?: (err: unknown) => void;
}

export function NewBookDialog({ open, onClose, onCreate, onCreated, onError }: NewBookDialogProps) {
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("");
  const [medium, setMedium] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 打开时按当前书数回填默认名，体裁/载体每次从零开始（与向导语义一致）
  useEffect(() => {
    if (!open) return;
    const count = useWritingStore.getState().books.length;
    setName(t("writing.newBookName", { n: count + 1 }));
    setGenre("");
    setMedium("");
    setSubmitting(false);
  }, [open]);

  const handleConfirm = async () => {
    if (submitting) return;
    const finalName =
      name.trim() || t("writing.newBookName", { n: useWritingStore.getState().books.length + 1 });
    setSubmitting(true);
    try {
      const book = onCreate
        ? await onCreate(finalName, genre, medium)
        : { id: "", title: finalName };
      onCreated?.(book);
      onClose();
    } catch (e) {
      // 错误交给调用方 toast；不关闭，让用户重试
      console.error("[NewBookDialog] create failed", e);
      onError?.(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !submitting && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>{t("writing.newBook")}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label={t("writing.bookName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !submitting) void handleConfirm();
          }}
          sx={{ mt: 1 }}
        />
        <GenreMediumFields
          genre={genre}
          medium={medium}
          onGenreChange={setGenre}
          onMediumChange={setMedium}
        />
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose} disabled={submitting}>
          {t("nav.cancel")}
        </Button>
        <Button size="small" variant="contained" onClick={() => void handleConfirm()} disabled={submitting}>
          {t("nav.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
