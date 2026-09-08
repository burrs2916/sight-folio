import { PATTERN_CATEGORY_COLORS, PATTERN_CATEGORY_LABEL_KEY, patternColorOf } from "../utils/fileInsights";
import { t, resolveFragments } from "../../i18n";
import type { CanvasLod } from "../utils/lod";
import { lodStub } from "./lodStub";
import { CV } from "./canvasTheme";

/**
 * 设计模式实体渲染器
 *
 * 画布上一个「模式命中」长什么样，决定了用户能不能一眼判断该不该相信它。
 * 这里刻意把**置信度**做成视觉主角而不是一行小字：
 *
 * - 左侧色条 = 模式分类（创建型/结构型/行为型/架构角色），同类颜色一致，
 *   于是同一条带里的节点扫一眼就知道是不是一伙的。
 * - 右上角环形进度 = 置信度百分比。识别模式本质是启发式推断，
 *   把「85%」和「62%」画成同样的实心徽章是在骗人；环的缺口越大，越该点开看证据。
 * - 边框透明度随置信度衰减：低置信节点在视觉上自然后退，不抢注意力。
 *
 * 悬浮显示引擎给出的完整证据链（signals），用户可以自己判断这条推断站不站得住。
 *
 * R37：改为零 Emotion + LOD。原实现整卡套 MUI <Tooltip>，且 tip 内容是一棵
 * 由 5~10 个 <Typography sx> 组成的 JSX 树 —— **哪怕从没悬浮过也会在每次
 * 渲染时构建出来**。设计模式画像一屏常有上百个命中，这棵树就白建上百次。
 * 现在证据链拼成纯文本走原生 title（\n 天然换行），构建成本只剩一次 join。
 */

interface PatternNodeRendererProps {
  config?: {
    /** 模式 id，如 singleton */
    patternId?: string;
    /** 模式中文名 */
    patternName?: string;
    /** 分类：creational / structural / behavioral / architectural */
    patternCategory?: string;
    /** 命中的符号名（类名/结构体名） */
    symbolName?: string;
    /** 所在文件相对路径 */
    filePath?: string;
    /** 行号 */
    line?: number;
    /** 置信度 0..1 */
    confidence?: number;
    /** 判定依据 */
    signals?: string[];
  };
  selected?: boolean;
  /** 画布 LOD 档位（见 utils/lod.ts）；缺省按 full */
  lod?: CanvasLod;
}

/** 置信度 → 语义分级（阈值取自后端 CONFIDENCE_THRESHOLD=0.6 之上的三档） */
function confidenceTier(c: number): { label: string; color: string } {
  if (c >= 0.85) return { label: t("entityProj.conf.high"), color: "#22c55e" };
  if (c >= 0.7) return { label: t("entityProj.conf.medium"), color: "#eab308" };
  return { label: t("entityProj.conf.low"), color: "#f97316" };
}

export function PatternNodeRenderer(props: PatternNodeRendererProps) {
  const _config = props?.config;
  const selected = props?.selected;
  const lod = props?.lod ?? "full";
  const config = _config ?? {};
  const {
    patternName = "",
    patternCategory = "behavioral",
    symbolName = "",
    filePath = "",
    line = 0,
    confidence = 0.5,
    signals = [],
  } = config;

  const catColor = PATTERN_CATEGORY_COLORS[patternCategory] ?? "#8b5cf6";
  // 按「模式种类」取色：同一模式的全部命中共享一个颜色，画布上天然成簇、可扫读；
  // 分类色仅作兜底（无 patternId 的极旧数据）。
  const patternColor = typeof config.patternId === "string" && config.patternId ? patternColorOf(config.patternId) : catColor;
  const catLabel = t(PATTERN_CATEGORY_LABEL_KEY[patternCategory] ?? "entityProj.cat.behavioral");
  const tier = confidenceTier(confidence);
  const pct = Math.round(confidence * 100);

  // 环形进度：R=11 的圆，用 strokeDasharray 表现百分比
  const R = 11;
  const CIRC = 2 * Math.PI * R;

  const tip = [
    resolveFragments(`${resolveFragments(patternName) || t("entityProj.unknownPattern")} · ${catLabel} · ${t("entityProj.confidenceTip", { pct })}（${tier.label}）`),
    `${symbolName} — ${filePath}${line > 0 ? `:${line}` : ""}`,
    ...(signals.length > 0 ? signals.map((s) => `• ${s}`) : [t("entityProj.oldDataSignals")]),
  ].join("\n");

  // 低置信节点视觉后退，避免与高置信命中平起平坐
  const opacity = 0.55 + confidence * 0.45;

  // ─── LOD 降级：缩小后置信度环与三行文字都不可读，退化为分类色块 ───
  // 置信度信息不丢 —— 交给风险点的颜色（tier.color）承载。
  const stub = lodStub(lod, {
    name: symbolName || patternName,
    accent: patternColor,
    background: CV.paper,
    borderColor: selected ? CV.primary : patternColor,
    borderWidth: selected ? 2 : 1,
    title: tip,
    subtitle: `${patternName} · ${filePath}${line > 0 ? `:${line}` : ""}`,
    riskColor: tier.color,
    opacity,
  });
  if (stub) return stub;

  return (
    <div
      title={tip}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "stretch",
        boxSizing: "border-box",
        borderRadius: 8,
        overflow: "hidden",
        background: CV.paper,
        border: selected ? `2px solid ${CV.primary}` : `1px solid ${patternColor}`,
        opacity,
        boxShadow: selected ? "0 0 0 3px rgba(56,189,248,0.25)" : "0 1px 4px rgba(0,0,0,0.3)",
      }}
    >
      {/* 左侧分类色条（按模式种类着色） */}
      <div style={{ width: 4, backgroundColor: patternColor, flexShrink: 0 }} />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: "5px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span
            style={{
              padding: "0 5px",
              borderRadius: 4,
              backgroundColor: patternColor,
              color: "#0f172a",
              fontSize: 9,
              fontWeight: 800,
              lineHeight: "14px",
              flexShrink: 0,
            }}
          >
            {resolveFragments(patternName) || t("entityProj.unknownPattern")}
          </span>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              color: CV.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {symbolName}
          </span>
        </div>
        <div
          style={{
            fontSize: 9.5,
            color: CV.text2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {filePath}
          {line > 0 ? `:${line}` : ""}
        </div>
        {signals.length > 0 && (
          <div
            style={{
              fontSize: 9,
              color: CV.text3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {signals[0]}
          </div>
        )}
      </div>

      {/* 右侧置信度环 */}
      <div style={{ width: 34, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <svg width={28} height={28} viewBox="0 0 28 28">
          <circle cx={14} cy={14} r={R} fill="none" stroke="rgba(148,163,184,0.25)" strokeWidth={3} />
          <circle
            cx={14}
            cy={14}
            r={R}
            fill="none"
            stroke={tier.color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${CIRC * confidence} ${CIRC}`}
            transform="rotate(-90 14 14)"
          />
          <text x={14} y={17.5} textAnchor="middle" fontSize={8.5} fontWeight={700} fill={tier.color}>
            {pct}
          </text>
        </svg>
      </div>
    </div>
  );
}
