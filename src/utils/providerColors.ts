// sight-folio: Provider 标识颜色工具
// 提供预设色板 + 随机颜色生成，用于在 UI 上用不同颜色的小圆点区分各个 AI Provider。

// 预设色板：辨识度高、深浅适中的一组颜色
export const PROVIDER_COLORS = [
  "#6366f1", // 靛蓝
  "#8b5cf6", // 紫
  "#ec4899", // 粉
  "#ef4444", // 红
  "#f59e0b", // 橙
  "#10b981", // 绿
  "#06b6d4", // 青
  "#3b82f6", // 蓝
  "#14b8a6", // 蓝绿
  "#f43f5e", // 玫红
];

// HSL → HEX 转换（用于生成柔和、辨识度高的随机色）
// 注意：h 为 0-360，s/l 为 0-100 的百分比，必须转为 0-1 分数再计算，
// 否则 255*c 会超过 0xFF，toString(16) 产生多位十六进制、拼成非法颜色串。
function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = ln - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// 用户未选择颜色时，系统自动生成辨识度较高的随机颜色
export function randomProviderColor(): string {
  const hue = Math.floor(Math.random() * 360);
  return hslToHex(hue, 68, 56);
}

// 合法 hex 颜色（#RGB / #RRGGBB / #RRGGBBAA），用于校验存储值是否有效
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// 列表/图标显示用：基于 id 的确定性回退颜色
// - 若 color 合法则直接用（用户自选 / 合法随机色）
// - 若 color 为空或非法（如早期 randomProviderColor 生成的脏值），用 id 稳定选一个预设色
//   这样同一供应商刷新后颜色不变，且一定为合法色（圆点必可见）
export function colorForProvider(id: string, color?: string): string {
  if (color && HEX_RE.test(color)) return color;
  let h = 0;
  const sid = id || "";
  for (let i = 0; i < sid.length; i++) {
    h = (h * 31 + sid.charCodeAt(i)) >>> 0;
  }
  return PROVIDER_COLORS[h % PROVIDER_COLORS.length];
}
