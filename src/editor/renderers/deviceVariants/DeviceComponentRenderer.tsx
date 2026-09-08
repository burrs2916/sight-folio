/**
 * DeviceComponentRenderer — 设备组件渲染器统一入口（适配 ComponentRendererProps）
 *
 * V2 简化：只保留 2 个变体
 * - "control-panel"：默认变体，产品真实外壳（喷雾集控器=红色控制面板，传感器=仪表盘）
 * - "pin"：地图/CAD 标记用
 *
 * 动态数据：通过 useDeviceStore 订阅，状态/数值变化自动重渲染
 */
import Box from "@mui/material/Box";
import type { ComponentRendererProps } from "../../../types/editor";
import { useDeviceStore } from "../../../store/deviceStore";
import { ANIMATION_DEFAULTS } from "../decorationAnimation";
import { PinVariantRenderer } from "./PinVariantRenderer";
import { ControlPanelRenderer } from "./CardVariantRenderer";

/** V2 允许的变体集合（用于用户配置校验） */
export const ALLOWED_VARIANTS = new Set(["control-panel", "pin"]);
/** 兼容旧值的映射：旧变体 → 新变体 */
const VARIANT_LEGACY_MAP: Record<string, "control-panel" | "pin"> = {
  "card": "control-panel",
  "gauge": "control-panel",
  "sensor-gauge": "control-panel",
  "mini-status": "control-panel",
  "control-panel": "control-panel",
  "pin": "pin",
};

export function DeviceComponentRenderer(props: ComponentRendererProps) {
  const config = props?.config ?? {};
  const width = props?.width ?? 40;
  const height = props?.height ?? 40;
  const mode = props?.mode ?? "edit";
  const {
    deviceId, productCode, variant, _thumbnail,
    bodyColor, screenColor, borderColor,
    // ─── 通用动画 / 线条效果（与边框装饰组对齐，由 ANIMATION_SCHEMA 自动合并）───
    animation, animationDuration,
    lineEffect, lineEffectColor, lineEffectIntensity,
    lineEffectSpeed, lineEffectWidth,
    // ─── 内容展示：用户从后端 tags 列表中选出来的 ───
    faceContent, screenContent,
  } = (config ?? {}) as {
    deviceId?: string;
    productCode?: string;
    variant?: string;
    _thumbnail?: boolean;
    bodyColor?: string;
    screenColor?: string;
    borderColor?: string;
    animation?: string;
    animationDuration?: number;
    lineEffect?: string;
    lineEffectColor?: string;
    lineEffectIntensity?: number;
    lineEffectSpeed?: number;
    lineEffectWidth?: number;
    faceContent?: string[] | string;
    screenContent?: string[] | string;
  };

  const device = useDeviceStore((s) => (deviceId ? s.devices[deviceId] : undefined));
  const productMap = useDeviceStore((s) => s.products);
  const product = productCode
    ? productMap[productCode]
    : device
    ? productMap[device.productCode]
    : undefined;
  // 订阅 store 加载状态：用于区分"还没加载完（pending）"和"加载完但真没找到（offline）"
  const storeIsLoading = useDeviceStore((s) => s.isLoading);
  const storeLastLoadedAt = useDeviceStore((s) => s.lastLoadedAt);
  // deviceId 已绑 + store 还没加载完 + 该设备未在 store 中 → 等待加载完成（黄点脉冲）
  const isPending = !!deviceId && !device && (storeIsLoading || storeLastLoadedAt === null);

  // 从 productCode 推断 category（当 product 不存在时使用，如预览窗口中 deviceStore 为空）
  const inferCategory = (code: string): "main" | "sub" | "sensor" | "auxiliary" => {
    if (code.includes("-Sub")) return "sub";
    if (code.includes("-Main") || code.includes("-Spray-")) return "main";
    if (code.includes("-Sensor-") || code.includes("-Alarm-")) return "sensor";
    return "auxiliary";
  };

  // 产品拖到画布上 = 一个真实存在的产品
  // - deviceId 已绑 + device 在 store 中 → 真实设备
  // - deviceId 已绑 + device 不在 store + store 还在加载 → 仍用真实 deviceId（pending 视觉）
  // - deviceId 已绑 + device 不在 store + store 加载完 → offline 虚拟设备
  // - productCode 有值但 deviceId 为空（产品未绑实例）→ offline 虚拟设备
  // category 解析：productCode 能明确推断时以推断为准，否则用 product.category
  // 防止后端 discovery 返回的 frontendCategory 缺失导致 category 被默认为 auxiliary
  const resolvedCategory = (() => {
    const inferred = inferCategory(productCode ?? "");
    // 推断出明确分类（非 auxiliary）时优先使用
    if (inferred !== "auxiliary") return inferred;
    // 推断不出时回退到 product.category
    return product?.category ?? "auxiliary";
  })();

  const effectiveDevice = device ?? (productCode
    ? {
        deviceId: deviceId || "",
        productCode,
        productName: product?.productName ?? productCode,
        category: resolvedCategory,
        sensorSubType: product?.sensorSubType,
        online: false,
        metadata: {} as Record<string, unknown>,
      }
    : undefined);

  if (!effectiveDevice) {
    // 真正缺数据：productCode 也没传。这种情况几乎不会出现（组件拖出来一定有 productCode），
    // 渲染一个极简提示框作为最后兜底，不再使用"未绑定设备"文案。
    return (
      <Box
        sx={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "text.secondary",
          fontSize: 10,
          bgcolor: "action.hover",
          borderRadius: 0.5,
          textAlign: "center",
          p: 0.5,
          border: 1,
          borderColor: "divider",
          borderStyle: "dashed",
        }}
      >
        加载中…
      </Box>
    );
  }

  // V2 变体路由：兼容旧值，统一映射到 "control-panel" 或 "pin"
  const mapVariant = (v: string | undefined): "control-panel" | "pin" => {
    if (v && VARIANT_LEGACY_MAP[v]) return VARIANT_LEGACY_MAP[v];
    return "control-panel";
  };
  const effectiveVariant: "control-panel" | "pin" =
    _thumbnail ? "control-panel" :  // 缩略图截图始终用卡片视图（不用标记）
    mapVariant(variant) ?? mapVariant(product?.defaultVariant);

  const commonProps = {
    device: effectiveDevice,
    product,
    width,
    height,
    mode: (mode === "preview" ? "preview" : "edit") as "edit" | "preview" | "live",
  };

  // 颜色配置：config 有值用 config，否则按 category 提供正确默认色
  // 防止旧组件存了集控器红色或 config 缺失时用错颜色
  const CATEGORY_DEFAULT_COLORS: Record<string, { bodyColor: string; screenColor: string; borderColor: string }> = {
    main: { bodyColor: "#D93A3A", screenColor: "#5A9ED6", borderColor: "#B82F2F" },
    sub: { bodyColor: "#D8DCDE", screenColor: "#1A1F24", borderColor: "#989CA0" },
    sensor: { bodyColor: "#607D8B", screenColor: "#5A9ED6", borderColor: "#455A64" },
  };
  const defaultColors = CATEGORY_DEFAULT_COLORS[resolvedCategory] ?? CATEGORY_DEFAULT_COLORS.sensor;
  const styleConfig = {
    bodyColor: bodyColor || defaultColors.bodyColor,
    screenColor: screenColor || defaultColors.screenColor,
    borderColor: borderColor || defaultColors.borderColor,
  };

  // 通用动画/线条效果配置（与边框装饰组件组 ANIMATION_SCHEMA 字段一一对应）
  // 用 ANIMATION_DEFAULTS 兜底，避免 undefined 报错
  const animationConfig = {
    ...ANIMATION_DEFAULTS,
    ...(animation !== undefined ? { animation: animation as any } : {}),
    ...(animationDuration !== undefined ? { animationDuration } : {}),
    ...(lineEffect !== undefined ? { lineEffect: lineEffect as any } : {}),
    ...(lineEffectColor !== undefined ? { lineEffectColor } : {}),
    ...(lineEffectIntensity !== undefined ? { lineEffectIntensity } : {}),
    ...(lineEffectSpeed !== undefined ? { lineEffectSpeed } : {}),
    ...(lineEffectWidth !== undefined ? { lineEffectWidth } : {}),
  };

  // 内容展示配置：用户从后端 tags 中选出来的 + 排列方式
  // 解析字符串/数组两种形态（编辑器里多选用数组，单选用字符串）
  const toArray = (v: string[] | string | undefined): string[] | undefined => {
    if (v === undefined || v === null) return undefined;
    if (Array.isArray(v)) return v;
    if (v === "" || v === "__default__") return undefined; // 视为自动
    // 逗号分隔字符串（序列化/反序列化后可能出现）
    if (typeof v === "string" && v.includes(",")) return v.split(",").filter(Boolean);
    return [v];
  };
  const contentConfig = {
    faceTags: toArray(faceContent),
    screenTags: toArray(screenContent),
  };

  if (effectiveVariant === "pin") {
    return <PinVariantRenderer {...commonProps} styleConfig={styleConfig} animationConfig={animationConfig} contentConfig={contentConfig} />;
  }
  // isTemplate：设备组件以"产品模板/产品演示"形态渲染（红色控制面板 + 绿点）
  //   - deviceId 为空 + productCode 有值 → 产品模板（截图、画布上未绑实例）
  //   - deviceId 有值 → 真实设备形态（按 online/offline/alarm/pending 决定）
  const isTemplate = !deviceId && !!productCode;
  // hideScreenContent：缩略图截图时只显示纯外壳，不显示屏幕内的状态点/文字
  const hideScreenContent = !!_thumbnail;
  return (
    <ControlPanelRenderer
      {...commonProps}
      isPending={isPending}
      isTemplate={isTemplate}
      hideScreenContent={hideScreenContent}
      styleConfig={styleConfig}
      animationConfig={animationConfig}
      contentConfig={contentConfig}
    />
  );
}

export default DeviceComponentRenderer;