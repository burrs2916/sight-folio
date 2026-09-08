import { FolderGlyph } from "./glyphs";
import type { CanvasLod } from "../utils/lod";
import {
  BODY_STYLE,
  CV,
  META_ROW_STYLE,
  TITLE_BOLD_STYLE,
  TITLE_ROW_STYLE,
  insightBadgeStyle,
  metaStyle,
  shellStyle,
  stripeStyle,
  tintGradient,
} from "./canvasTheme";
import { lodStub } from "./lodStub";
import { ShapeDecorations } from "./shapeDecorations";
import { selectDirMark, useInsightOverlayStore } from "../../store/insightOverlayStore";
import { selectDirVerifyMark, useVerifyOverlayStore } from "../../store/verifyOverlayStore";
import { selectDirImpactMark, useImpactOverlayStore } from "../../store/impactOverlayStore";
import { SEVERITY_COLOR, severityLabel } from "../../ai/insightOverlay";
import { VERIFY_COLOR, verifyTooltip, verifyBadgeGlyph } from "../../ai/verifyOverlay";
import { t } from "../../i18n";
import { languageColor } from "../../utils/languageMeta";

/**
 * 目录实体渲染器
 *
 * 之前这里只画了名字和 childCount —— 因为 folder 实体从来没被任何画像创建过，
 * 没有数据可画。「目录结构画像」上线后，每个目录都带着规模 / 复杂度 / 欠账 /
 * 语言构成四类聚合指标，渲染器相应升级为：
 *   左侧复杂度色条 + 语言构成条 + 名称 + 规模文本 + 问题徽标
 * 与 FileRenderer 的信息密度对齐，保证「点开目录画像能直接看出问题在哪一块」。
 *
 * R37 改为零 Emotion + LOD（理由见 canvasTheme.ts / utils/lod.ts）。原实现整卡
 * 套在 MUI <Tooltip> 里，目录树一屏几十上百个节点就是同样数量的 Tooltip 实例；
 * 现在换成原生 title，多行说明照旧（\n 在 title 里天然换行）。
 */

interface LanguageShare {
  language: string;
  files: number;
  lines: number;
}

interface FolderRendererProps {
  config?: {
    name?: string;
    childCount?: number;
    depth?: number;
    dirPath?: string;
    directFiles?: number;
    childDirCount?: number;
    fileCount?: number;
    totalLines?: number;
    avgComplexity?: number;
    maxComplexity?: number;
    complexityLevel?: string;
    techDebtCount?: number;
    findingCount?: number;
    cloneCount?: number;
    dominantLanguage?: string | null;
    languageShare?: LanguageShare[];
    /** 目录内搜索反馈：true=命中高亮 / false=搜索模式下的上下文祖先（淡化） / undefined=无搜索 */
    searchMatched?: boolean;
    [key: string]: unknown;
  };
  /** 画布 LOD 档位（见 utils/lod.ts）；缺省按 full */
  lod?: CanvasLod;
}

/** 复杂度档位 → 颜色（与文件热力、左侧面板一致） */
const COMPLEXITY_COLOR: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  extreme: "#ef4444",
};

const COMPLEXITY_LABEL: Record<string, string> = {
  low: "canvasTip.cxLow",
  medium: "canvasTip.cxMid",
  high: "canvasTip.cxHigh",
  extreme: "canvasTip.cxExtreme",
};

/** 语言配色统一走 languageMeta（短码/别名/全名自动适配，与 FileRenderer 同源） */
const FOLDER_ORANGE = "#FB923C";

function langColor(lang?: string | null): string {
  return languageColor(lang);
}

/** 千分位 + k 缩写：目录动辄几万行，全展开会把这一行撑爆 */
function shortNum(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function FolderRenderer(props: FolderRendererProps) {
  const _config = props?.config;
  const lod = props?.lod ?? "full";
  const config = _config ?? {};
  const {
    childCount,
    depth = 0,
    fileCount,
    totalLines = 0,
    avgComplexity = 0,
    maxComplexity = 0,
    complexityLevel,
    techDebtCount = 0,
    findingCount = 0,
    cloneCount = 0,
    dominantLanguage,
    languageShare = [],
    dirPath,
  } = config;

  // 有聚合数据 = 来自目录结构画像；否则退回旧的极简样式（手动拖进画布的空目录实体）
  const enriched = fileCount !== undefined;
  const heat = complexityLevel ? COMPLEXITY_COLOR[complexityLevel] ?? "#94a3b8" : null;
  const issues = techDebtCount + findingCount;
  const name = config.name || "untitled";
  // 目录内搜索反馈：true=命中高亮，false=搜索模式下作为上下文的祖先（淡化），undefined=无搜索
  const searchMatched = config.searchMatched as boolean | undefined;
  const dimmed = searchMatched === false;
  const highlighted = searchMatched === true;

  const totalLangFiles = languageShare.reduce((a, l) => a + l.files, 0);

  // ─── AI 洞察投射（子树聚合）───────────────────────────────────────────
  // 目录角标回答的是「往这里钻还是别钻」：子树内只要有文件被 Agent 点名，
  // 目录上就带最高严重度的药丸。没有它，全览档折叠着的目录会把问题整片藏住。
  const insightMark = useInsightOverlayStore(selectDirMark(dirPath));
  const insightColor = insightMark ? SEVERITY_COLOR[insightMark.severity] : null;
  const insightTitle = insightMark
    ? [
        t("canvasTip.aiDir", {
          n: insightMark.count,
          sev: severityLabel(insightMark.severity),
          files: insightMark.fileCount > 0 ? t("canvasTip.aiDirFiles", { n: insightMark.fileCount }) : "",
        }),
        ...insightMark.titles.map((t) => `· ${t}`),
      ].join("\n")
    : null;

  // ─── 验证结论投射（子树聚合）───────────────────────────────────────────
  // 与 insight 投射同源：目录取子树内「最坏 verdict」的聚合标记（bubbleDirVerifyMarks
  // 在 store 内已算好 dirMarks，这里 O(1) 查表）。AI 改坏某目录下的文件时，整条目录链
  // 标红 AI!——这是 VS Code 没有的「AI 改动即时验证」可视化收口的目录级呈现。
  const verifyMark = useVerifyOverlayStore(selectDirVerifyMark(dirPath));
  const verifyColor = verifyMark ? VERIFY_COLOR[verifyMark.verdict] : null;
  const verifyTitle = verifyMark ? verifyTooltip(verifyMark) : null;

  // ─── 影响面（爆炸半径）投射（R18）─────────────────────────────────────
  // 与洞察/验证同源：O(1) 查表，无波及子树时取到 false。子树内任一文件落在当前焦点的
  // 爆炸半径内 → 整条祖先目录链点亮靛蓝（store 内已沿路径冒泡算好 dirPaths）。
  const impactDirMark = useImpactOverlayStore(selectDirImpactMark(dirPath));
  const IMPACT_COLOR = "#6366f1";
  const impactDirTitle = impactDirMark
    ? t("workbench.aiImpact.canvasDirTip", { dir: dirPath || name })
    : null;

  const tooltip = enriched
    ? [
        dirPath || "/",
        t("canvasTip.dirFilesLines", { n: fileCount, lines: totalLines.toLocaleString() }),
        t("canvasTip.dirDirect", { n: config.directFiles ?? 0, d: config.childDirCount ?? 0, depth }),
        avgComplexity > 0
          ? t("canvasTip.dirComplexity", { avg: avgComplexity, lv: t(COMPLEXITY_LABEL[complexityLevel ?? ""] ?? "") || "-", max: maxComplexity })
          : t("canvasTip.noComplexity"),
        t("canvasTip.dirDebt", { debt: techDebtCount, f: findingCount, c: cloneCount }),
        languageShare.length > 0
          ? t("canvasTip.dirLang", { langs: languageShare.map((l) => `${l.language} ${l.files}`).join(" / ") })
          : "",
        t("canvasTip.dirDblClick"),
      ]
        .filter(Boolean)
        .join("\n")
    : dirPath || name;

  // AI 结论单独空一行接在后面：与上面那些扫描算出来的聚合数值区分开
  const fullTooltip = insightTitle ? `${tooltip}\n\n${insightTitle}` : tooltip;

  const accent = heat ?? FOLDER_ORANGE;
  // R38 提亮：底色从 8% 提到 12%~16% 渐变，边框 40% → 60% 透明度
  const cardBackground = heat
    ? tintGradient(heat, 0x22, 0x0c)
    : `linear-gradient(135deg, ${FOLDER_ORANGE}22 0%, ${FOLDER_ORANGE}0C 60%, transparent 100%)`;
  const cardBorder = heat ? `${heat}99` : `${FOLDER_ORANGE}99`;

  const stub = lodStub(lod, {
    name,
    accent,
    background: cardBackground,
    borderColor: impactDirMark ? IMPACT_COLOR : insightColor ?? cardBorder,
    title: fullTooltip,
    // R39：compact 档也要能看到完整路径 —— 全览时同名的 src/utils/components 到处都是
    subtitle: dirPath || undefined,
    // 缩略档只有一个风险点可画：AI 判定优先于静态计数 —— 静态计数（技术债/审查
    // 发现）几乎每个目录都非零，铺满画布后失去指示作用；被 Agent 点名的目录才是
    // 少数，那个点亮起来才有信息量。
    riskColor: insightColor ?? (issues > 0 ? (findingCount > 0 ? CV.error : CV.warning) : null),
  });
  if (stub) return stub;

  return (
    <div
      title={fullTooltip}
      style={{
        ...shellStyle({
          background: highlighted
            ? `linear-gradient(135deg, #f59e0b33 0%, ${FOLDER_ORANGE}14 60%, transparent 100%)`
            : cardBackground,
          borderColor: highlighted ? "#f59e0b" : impactDirMark ? IMPACT_COLOR : cardBorder,
          shape: "folder",
          extra: { gap: 5, paddingLeft: 10 },
        }),
        opacity: dimmed ? 0.4 : 1,
        boxShadow: highlighted
          ? "0 0 0 2px rgba(245,158,11,0.45)"
          : impactDirMark
            ? `0 0 0 2px ${IMPACT_COLOR}, 0 0 8px ${IMPACT_COLOR}55`
            : "none",
      }}
    >
      <ShapeDecorations shape="folder" color={accent} />
      {/* 左侧色条：有复杂度数据时表示复杂度档位，否则退回深度指示 */}
      <div style={stripeStyle(accent, 1, 4)} />

      <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
        <FolderGlyph color={dominantLanguage ? langColor(dominantLanguage) : FOLDER_ORANGE} size={14} />
      </div>

      <div style={BODY_STYLE}>
        <div style={TITLE_ROW_STYLE}>
          {/* AI 洞察药丸：数字是子树内命中的洞察条数，颜色是最高严重度 */}
          {insightColor && (
            <span style={insightBadgeStyle(insightColor)} title={insightTitle ?? undefined}>
              AI{insightMark && insightMark.count > 1 ? ` ${insightMark.count}` : ""}
            </span>
          )}
          {/* 验证结论药丸：子树内 AI 改动让文件变好(AI✓绿)/变坏(AI!红)。与洞察药丸同形，
              靠「✓ / !」与绿/红区分——VS Code 没有的「AI 改完即时验证」目录级收口。 */}
          {verifyColor && (
            <span style={insightBadgeStyle(verifyColor)} title={verifyTitle ?? undefined}>
              {verifyBadgeGlyph(verifyMark!.verdict)}
            </span>
          )}
          {/* 影响面药丸（R18）：该目录子树内有文件在「当前焦点的爆炸半径」内 */}
          {impactDirMark && (
            <span style={insightBadgeStyle(IMPACT_COLOR)} title={impactDirTitle ?? undefined}>
              {t("workbench.aiImpact.canvasBadge")}
            </span>
          )}
          <div style={{ ...TITLE_BOLD_STYLE, lineHeight: 1.25 }}>{name}</div>
        </div>

        {/* 完整目录路径（R38 新增；R39 加大到 9.5px、text2）：树形布局里同名的
            src / utils / components 到处都是，只写目录名根本分不清是第几层哪个 */}
        {dirPath && (
          <div
            style={{
              fontSize: 9.5,
              lineHeight: 1.3,
              color: CV.text2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 1,
            }}
          >
            {dirPath}
          </div>
        )}

        {enriched ? (
          <div style={{ ...META_ROW_STYLE, gap: 5, marginTop: 1 }}>
            <span style={{ ...metaStyle(CV.text2), flexShrink: 0 }}>
              {t("canvasTip.dirFilesLines", { n: fileCount, lines: shortNum(totalLines) })}
            </span>
            {/* 语言构成条：按文件数占比铺色，一眼看出这个目录是什么语言写的 */}
            {totalLangFiles > 0 && (
              <span
                style={{ display: "flex", height: 3, flex: 1, minWidth: 20, borderRadius: 2, overflow: "hidden" }}
              >
                {languageShare.map((l) => (
                  <span
                    key={l.language}
                    style={{
                      width: `${(l.files / totalLangFiles) * 100}%`,
                      backgroundColor: langColor(l.language),
                    }}
                  />
                ))}
              </span>
            )}
          </div>
        ) : (
          childCount !== undefined && <span style={metaStyle(CV.text2)}>{t("canvasTip.items", { n: childCount })}</span>
        )}
      </div>

      {/* 右侧徽标：平均复杂度 + 问题计数，只在有值时出现 */}
      {enriched && avgComplexity > 0 && (
        <span style={{ ...metaStyle(heat ?? CV.text2, 700), flexShrink: 0 }}>{avgComplexity}</span>
      )}
      {enriched && issues > 0 && (
        <span
          style={{
            flexShrink: 0,
            padding: "0 4px",
            borderRadius: 4,
            backgroundColor: findingCount > 0 ? CV.error : CV.warning,
            color: CV.white,
            fontSize: 8.5,
            fontWeight: 700,
            lineHeight: "14px",
          }}
        >
          {issues}
        </span>
      )}
      {enriched && cloneCount > 0 && (
        <span style={{ ...metaStyle("#9c27b0"), flexShrink: 0 }}>⧉{cloneCount}</span>
      )}
      {/* 下钻角标：提示此目录可双击在旁开独立子树视图（提升可发现性，原仅靠 tooltip） */}
      {enriched && (
        <span
          style={{
            flexShrink: 0,
            fontSize: 12,
            lineHeight: 1,
            color: "#64748b",
            opacity: 0.7,
          }}
          title={t("canvasTip.dirDblClick")}
        >
          ⤵
        </span>
      )}
    </div>
  );
}
