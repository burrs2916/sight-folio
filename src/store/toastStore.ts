import { create } from "zustand";
import type { AlertProps } from "@mui/material/Alert";

export interface ToastMessage {
  id: string;
  message: string;
  severity: AlertProps["severity"];
  duration?: number;
}

interface ToastStore {
  toasts: ToastMessage[];
  /** 添加一条 toast 通知 */
  showToast: (message: string, severity?: AlertProps["severity"], duration?: number) => void;
  /** 主动移除一条 toast */
  removeToast: (id: string) => void;
  /** 便捷方法 */
  success: (msg: string) => void;
  error: (msg: string) => void;
  warning: (msg: string) => void;
  info: (msg: string) => void;
}

let counter = 0;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  showToast: (message, severity = "info", duration = 4000) => {
    const id = `toast_${Date.now()}_${counter++}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, severity, duration }] }));
    // 自动移除
    setTimeout(() => {
      get().removeToast(id);
    }, duration);
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  success: (msg) => get().showToast(msg, "success"),
  error: (msg) => get().showToast(msg, "error"),
  warning: (msg) => get().showToast(msg, "warning"),
  info: (msg) => get().showToast(msg, "info"),
}));
