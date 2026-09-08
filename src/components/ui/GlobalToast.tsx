import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import { useToastStore } from "../../store/toastStore";

/**
 * 全局 Toast 通知渲染器
 * 读取 toastStore 的 toasts 列表，自动渲染所有活跃通知
 *
 * 2026-08-12 用户反馈：操作完成后的绿色成功提示（success）没必要 ——
 * 全局过滤 success 类型，只保留 error/warning/info 异常提示。
 * store 接口与业务调用不动，将来如需恢复成功提示，删除本行过滤即可。
 *
 * 2026-08-12 用户反馈：提示信息应该在显眼的顶部 —— anchorOrigin 改 top center，
 * 多条同时弹出时按索引纵向错开，避免顶部堆叠遮挡。
 */
export default function GlobalToast() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  const visible = toasts.filter((t) => t.severity !== "success");
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((t, idx) => (
        <Snackbar
          key={t.id}
          open
          autoHideDuration={t.duration ?? 4000}
          onClose={() => removeToast(t.id)}
          anchorOrigin={{ vertical: "top", horizontal: "center" }}
          sx={{ position: "fixed", zIndex: 1400, top: 16 + idx * 56 }}
          style={{ position: "fixed" }}
        >
          <Alert
            onClose={() => removeToast(t.id)}
            severity={t.severity}
            variant="filled"
            sx={{ width: "100%", minWidth: 280, maxWidth: 480 }}
          >
            {t.message}
          </Alert>
        </Snackbar>
      ))}
    </>
  );
}
