// sight-folio/sight-folio: 写作实体渲染器（H1 全书总览板）
//
// 章节卡（writing-chapter）/ 人物卡（writing-character）/ 卷头（writing-outline，
// 兼世界观 writing-worldview）的画布渲染。对齐 FileRenderer 的零 Emotion 约定：
// 纯 div/span + inline style + canvasTheme 助手，悬浮说明用原生 title。
//
// 双击跳转不在本渲染器内：章节卡 config.fileId 由 CanvasEntityNode 的
// 「带 fileId 实体双击跳源码」通用兜底接走 → read_source_file 的 writing:// 分支。
import {
  BODY_STYLE,
  CV,
  META_ROW_STYLE,
  shellStyle,
  stripeStyle,
  tintGradient,
  TITLE_ROW_STYLE,
  TITLE_STYLE,
  metaStyle,
  badgeStyle,
  ICON_STYLE,
} from "./canvasTheme";
import type { ComponentRendererProps } from "../../types/editor";
import type { CanvasLod } from "../utils/lod";
import { t, resolveFragments } from "../../i18n";

/** 四类写作实体的主题色（与 writingAnalyzer manifest 的 entityTypes 颜色一致） */
const COLOR_CHAPTER = "#8b5cf6";
const COLOR_CHARACTER = "#f59e0b";
const COLOR_OUTLINE = "#0ea5e9";
const COLOR_WORLDVIEW = "#10b981";

interface WritingProps extends ComponentRendererProps {
  type?: string;
  lod?: CanvasLod;
}

function readStr(config: Record<string, unknown>, key: string): string {
  const v = config[key];
  // 兜底解引用：旧数据（IA 修复前落库的壳卡）可能存着 i18n key
  // （如 analyzer.writing.entity.worldview.name），显示前解引用，纯文本原样放行
  return typeof v === "string" ? resolveFragments(v) : "";
}

function readNum(config: Record<string, unknown>, key: string): number {
  const v = config[key];
  return typeof v === "number" ? v : 0;
}

/** 卡片外框：主题色淡底渐变 + 左色条 */
function writingShell(color: string): React.CSSProperties {
  return shellStyle({
    background: tintGradient(color),
    borderColor: `${color}55`,
  });
}

/** 章节卡：卷标 + 标题 + 字数 / 状态（分镜板额外带镜头序号与本场人物） */
export function WritingChapterRenderer(props: WritingProps) {
  const cfg = props.config ?? {};
  const title = readStr(cfg, "title");
  const volume = readStr(cfg, "volume");
  const words = readNum(cfg, "wordCount");
  const status = readStr(cfg, "chapterStatus");
  // 分镜板专属：镜头序号（shotNo）与本场人物（cast）。全书总览不带这两个字段，
  // 走原来的紧凑外观 —— 同一实体两种读法，靠数据有无切换而不是加新类型。
  const shotNo = readNum(cfg, "shotNo");
  const cast: { name: string; count: number }[] = Array.isArray(cfg.cast)
    ? (cfg.cast as unknown[]).filter(
        (c): c is { name: string; count: number } => !!c && typeof (c as { name?: unknown }).name === "string"
      )
    : [];
  const castTotal = readNum(cfg, "castTotal");
  const compact = props.lod === "block" || props.lod === "compact";
  const tipCast = cast.length ? `${t("editor.writing.cast")}：${cast.map((c) => c.name).join("、")}` : "";
  const tip = [volume ? `${volume} · ${title}` : title, tipCast].filter(Boolean).join("\n");
  return (
    <div style={writingShell(COLOR_CHAPTER)} title={tip}>
      <div style={{ ...stripeStyle(COLOR_CHAPTER), position: "absolute" }} />
      <div style={ICON_STYLE}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            backgroundColor: `${COLOR_CHAPTER}2e`,
            border: `1px solid ${COLOR_CHAPTER}66`,
            color: COLOR_CHAPTER,
            fontSize: 11,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {shotNo > 0 ? shotNo : volume ? volume.slice(0, 1) : "章"}
        </div>
      </div>
      <div style={BODY_STYLE}>
        <div style={TITLE_ROW_STYLE}>
          <span style={TITLE_STYLE}>{title}</span>
        </div>
        {!compact && (
          <div style={META_ROW_STYLE}>
            <span style={metaStyle(COLOR_CHAPTER, 600)}>{t("nav.wordCount", { n: words })}</span>
            {volume && <span style={metaStyle()}>{volume}</span>}
            {status && (
              <span style={{ ...badgeStyle(`${COLOR_CHAPTER}33`, COLOR_CHAPTER) }}>
                {status === "finished" ? t("editor.writing.status.finished") : t("editor.writing.status.draft")}
              </span>
            )}
          </div>
        )}
        {/* 本场人物（分镜板）：谁在这一章出场，是分镜格唯一值得占三行的信息 */}
        {!compact && cast.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 4 }}>
            {cast.map((c) => (
              <span key={c.name} style={badgeStyle(`${COLOR_CHARACTER}26`, COLOR_CHARACTER)}>
                {c.name}
              </span>
            ))}
            {castTotal > cast.length && <span style={metaStyle()}>{`+${castTotal - cast.length}`}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** 人物卡：人名 + 出场次数 / 出现章数 */
export function WritingCharacterRenderer(props: WritingProps) {
  const cfg = props.config ?? {};
  const name = readStr(cfg, "name");
  const role = readStr(cfg, "role");
  const appearances = readNum(cfg, "appearances");
  const chapterCount = readNum(cfg, "chapterCount");
  const compact = props.lod === "block";
  // 主出场章节：既是卡片信息（他戏份最重的一章），也是双击跳转的落点
  const topChapter = readStr(cfg, "topChapter");
  const tip = [role ? `${name} · ${role}` : name, topChapter ? `${t("editor.writing.topChapter")}：${topChapter}` : "", t("editor.writing.openTopChapter")]
    .filter(Boolean)
    .join("\n");
  return (
    <div style={writingShell(COLOR_CHARACTER)} title={tip}>
      <div style={{ ...stripeStyle(COLOR_CHARACTER), position: "absolute" }} />
      <div style={ICON_STYLE}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            backgroundColor: `${COLOR_CHARACTER}2e`,
            border: `1px solid ${COLOR_CHARACTER}66`,
            color: COLOR_CHARACTER,
            fontSize: 12,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {name.slice(0, 1)}
        </div>
      </div>
      <div style={BODY_STYLE}>
        <div style={TITLE_ROW_STYLE}>
          <span style={TITLE_STYLE}>{name}</span>
        </div>
        {!compact && (
          <div style={META_ROW_STYLE}>
            <span style={metaStyle(COLOR_CHARACTER, 600)}>
              {t("editor.writing.appearances", { n: appearances })}
            </span>
            {chapterCount > 0 && <span style={metaStyle()}>{t("editor.writing.inChapters", { n: chapterCount })}</span>}
            {role && <span style={metaStyle()}>{role}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** 卷头 / 大纲条（writing-outline）与世界观念卡（writing-worldview）共用骨架 */
export function WritingOutlineRenderer(props: WritingProps) {
  const cfg = props.config ?? {};
  const kind = readStr(cfg, "kind");
  // 统计卡（L2 统计视图）：独立版式，走下面的 StatCard——
  // 放在最前面早退，volume / event 两条既有分支零改动。
  if (kind === "stat") {
    return <StatCard cfg={cfg} compact={props.lod === "block" || props.lod === "compact"} />;
  }
  // 时间线（event / event-track / timeline-axis / timeline-empty）已迁至 WritingStudioPane 的
  // TimelinePane（目的构建组件），不再在画布铺通用卡片。本渲染器现仅服务卷头（volume）与世界观念卡。
  const title = readStr(cfg, "title") || readStr(cfg, "name");
  const summary = readNum(cfg, "summary");
  const isVolume = kind === "volume";
  const color = isVolume ? COLOR_OUTLINE : COLOR_WORLDVIEW;
  return (
    <div style={writingShell(color)} title={title}>
      <div style={{ ...stripeStyle(color, 0.9, 4), position: "absolute" }} />
      <div style={BODY_STYLE}>
        <div style={TITLE_ROW_STYLE}>
          <span style={{ ...TITLE_STYLE, fontWeight: 700, color }}>{title}</span>
          {isVolume && (
            <span style={{ ...badgeStyle(`${color}2e`, color), flexShrink: 0 }}>
              {t("editor.writing.inChapters", { n: summary })}
            </span>
          )}
        </div>
      </div>
      {isVolume && (
        <span style={{ ...badgeStyle(`${color}2e`, color), flexShrink: 0 }}>
          {t("editor.writing.inChapters", { n: summary })}
        </span>
      )}
    </div>
  );
}

/** 世界观念卡：名称 + 类别（复用 outline 骨架，无卷徽标） */
export function WritingWorldviewRenderer(props: WritingProps) {
  return <WritingOutlineRenderer {...props} type={props.type} lod={props.lod} />;
}

// ─────────────────────────────────────────────────────────────
// 统计卡（L2 统计视图，kind="stat"）
//
// 三种版式由 config.shape 决定，都挂在 writing-outline 这一个实体类型下 ——
// 与时间线事件卡（kind="event"）同一做法：不新增实体类型，避免污染实体图鉴。
//   kpi     体量数字（总字数/章节数/卷数/设定数/平均章长）
//   volume  每卷体量 + 占比条
//   chapter 每章体量 + 占比条 + 完成状态
//
// 配色沿用大纲蓝（COLOR_OUTLINE）：统计与结构同属「量/骨架」读法，
// 换一个颜色会让人以为它和卷/大纲不是一家。
// ─────────────────────────────────────────────────────────────

const COLOR_STAT = COLOR_OUTLINE;

/** 占比条底槽：常驻展示，让「短条」也能读出与满格的差距 */
function statBar(color: string, height = 5): React.CSSProperties {
  return {
    position: "relative",
    width: "100%",
    height,
    borderRadius: height / 2,
    backgroundColor: `${color}22`,
    overflow: "hidden",
    flexShrink: 0,
  };
}

function statBarFill(pct: number, color: string): React.CSSProperties {
  const w = `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`;
  return {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: w,
    borderRadius: 999,
    backgroundColor: color,
  };
}

function StatCard({ cfg, compact }: { cfg: Record<string, unknown>; compact: boolean }) {
  const shape = readStr(cfg, "shape");
  const value = readStr(cfg, "value");
  const pct = readNum(cfg, "pct");
  const color = COLOR_STAT;

  // ── KPI：大数字 + 名称 + 口径小字（不上图标，数字本身才是主角）
  if (shape === "kpi") {
    const label = readStr(cfg, "label");
    const sub = readStr(cfg, "sub");
    return (
      <div style={writingShell(color)} title={[label, sub].filter(Boolean).join("\n")}>
        <div style={{ ...stripeStyle(color, 0.9, 4), position: "absolute" }} />
        <div style={{ ...BODY_STYLE, justifyContent: "center", display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color,
              lineHeight: 1.1,
              fontVariantNumeric: "tabular-nums",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {value}
          </div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: CV.text, ...(compact ? { display: "none" } : null) }}>{label}</div>
          {!compact && sub && <div style={{ fontSize: 9, color: CV.text2 }}>{sub}</div>}
        </div>
      </div>
    );
  }

  // ── 卷体量：卷名 + 字数/章数 + 占比条 + 完成度徽标
  if (shape === "volume") {
    const volumeName = readStr(cfg, "volumeName");
    const entries = readNum(cfg, "entries");
    const finished = readNum(cfg, "finished");
    const name = volumeName || t("editor.writing.book.noVolume");
    const tip = [
      name,
      `${t("nav.wordCount", { n: Number(value) || 0 })} · ${t("editor.writing.inChapters", { n: entries })}`,
      t("editor.writing.stats.finishedOf", { done: finished, total: entries }),
    ].join("\n");
    return (
      <div style={writingShell(color)} title={tip}>
        <div style={{ ...stripeStyle(color, 0.9, 4), position: "absolute" }} />
        <div style={{ ...BODY_STYLE, justifyContent: "center", display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ ...TITLE_ROW_STYLE }}>
            <span style={{ ...TITLE_STYLE, fontWeight: 700 }}>{name}</span>
            <span style={{ ...badgeStyle(`${color}2e`, color), flexShrink: 0 }}>
              {t("editor.writing.stats.finishedOf", { done: finished, total: entries })}
            </span>
          </div>
          {!compact && (
            <div style={META_ROW_STYLE}>
              <span style={metaStyle(color, 700)}>{t("nav.wordCount", { n: Number(value) || 0 })}</span>
              <span style={metaStyle()}>{t("editor.writing.inChapters", { n: entries })}</span>
            </div>
          )}
          <div style={statBar(color)}>
            <div style={statBarFill(pct, color)} />
          </div>
        </div>
      </div>
    );
  }

  // ── 章节体量：标题 + 字数 + 占比条 + 状态（章节卡同样带 fileId，双击可跳正文）
  const title = readStr(cfg, "title") || readStr(cfg, "name");
  const volume = readStr(cfg, "volume");
  const status = readStr(cfg, "chapterStatus");
  const tip = [volume ? `${volume} · ${title}` : title, t("nav.wordCount", { n: Number(value) || 0 })].join("\n");
  return (
    <div style={writingShell(color)} title={tip}>
      <div style={{ ...stripeStyle(color, 0.9, 3), position: "absolute" }} />
      <div style={{ ...BODY_STYLE, justifyContent: "center", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={TITLE_ROW_STYLE}>
          <span style={TITLE_STYLE}>{title}</span>
          {status && (
            <span style={{ ...badgeStyle(`${color}2e`, color), flexShrink: 0 }}>
              {status === "finished" ? t("editor.writing.status.finished") : t("editor.writing.status.draft")}
            </span>
          )}
        </div>
        {!compact && (
          <div style={META_ROW_STYLE}>
            <span style={metaStyle(color, 700)}>{t("nav.wordCount", { n: Number(value) || 0 })}</span>
          </div>
        )}
        <div style={statBar(color, 4)}>
          <div style={statBarFill(pct, color)} />
        </div>
      </div>
    </div>
  );
}
