// sight-folio: 主题配置（仅 localStorage 持久化）
import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";
export type ThemePreset = "default" | "blue" | "green" | "orange" | "purple" | "custom";
export type FontSize = "small" | "medium" | "large";
export type BorderRadius = "none" | "small" | "medium" | "large" | "round";

export interface ThemeConfig {
  mode: ThemeMode;
  preset: ThemePreset;
  customPrimary?: string;
  fontSize: FontSize;
  borderRadius: BorderRadius;
}

const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: "system",
  preset: "default",
  fontSize: "medium",
  borderRadius: "medium",
};

const STORAGE_KEY = "project-sight.theme";

function loadConfig(): ThemeConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<ThemeConfig>;
      return { ...DEFAULT_THEME_CONFIG, ...parsed };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_THEME_CONFIG };
}

function persist(config: ThemeConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.error("[ThemeStore] 持久化失败:", err);
  }
}

interface ThemeState {
  config: ThemeConfig;
  initialized: boolean;

  init: () => Promise<void>;
  setMode: (mode: ThemeMode) => void;
  setPreset: (preset: ThemePreset) => void;
  setCustomPrimary: (color: string) => void;
  setFontSize: (fontSize: FontSize) => void;
  setBorderRadius: (borderRadius: BorderRadius) => void;
  setConfig: (config: Partial<ThemeConfig>) => void;
  resetConfig: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  config: loadConfig(),
  initialized: false,

  init: async () => {
    set({ initialized: true });
  },

  setMode: (mode) => {
    const config = { ...get().config, mode };
    set({ config });
    persist(config);
  },

  setPreset: (preset) => {
    const config = { ...get().config, preset };
    set({ config });
    persist(config);
  },

  setCustomPrimary: (color) => {
    const config: ThemeConfig = { ...get().config, customPrimary: color, preset: "custom" };
    set({ config });
    persist(config);
  },

  setFontSize: (fontSize) => {
    const config = { ...get().config, fontSize };
    set({ config });
    persist(config);
  },

  setBorderRadius: (borderRadius) => {
    const config = { ...get().config, borderRadius };
    set({ config });
    persist(config);
  },

  setConfig: (partial) => {
    const config = { ...get().config, ...partial };
    set({ config });
    persist(config);
  },

  resetConfig: () => {
    set({ config: { ...DEFAULT_THEME_CONFIG } });
    persist(DEFAULT_THEME_CONFIG);
  },
}));
