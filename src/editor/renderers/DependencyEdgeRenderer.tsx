import type { CanvasLod } from "../utils/lod";
import { L } from "../../ai/aiLang";
import { useEditorStore } from "../../store/editorStore";

interface DependencyEdgeRendererProps {
  config?: {
    depType?: string;
    /** 符号级调用连线（depType="call"）：与 import 依赖用不同配色区分 */
    callEdge?: boolean;
    /** 跨文件调用（更能揭示模块耦合），用紫色强调 */
    crossFile?: boolean;
    /** 该调用被调用的次数（用于标签显示 ×N） */
    callCount?: number;
    isCircular?: boolean;
    fromX?: number;
    fromY?: number;
    toX?: number;
    toY?: number;
    fromW?: number;
    fromH?: number;
    toW?: number;
    toH?: number;
    /** 该依赖边涉及的具体符号名（符号级引用标注，来自 project_symbol_refs 聚合） */
    symbolNames?: string[];
    /**
     * 变更耦合边（时间维度）：两个文件「总是一起改」。
     * 与 import/call 连线的本质区别是**无方向** —— 共变是对称关系，
     * 因此不画箭头，改用两端圆点 + 中部 ⇄ 标记。
     */
    couplingEdge?: boolean;
    /** structural（有静态依赖）| hidden（无依赖却高共变 = 隐性耦合） */
    couplingKind?: string;
    /** 耦合度 0..1，决定线宽 */
    degree?: number;
    /** 共变次数 */
    coChanges?: number;
    /** low | medium | high | extreme */
    riskLevel?: string;
    /** 是否跨顶层模块（架构边界被绕过） */
    crossModule?: boolean;
    [key: string]: unknown;
  };
  width?: number;
  height?: number;
  /** 画布 LOD 档位（见 utils/lod.ts）；缺省按 full */
  lod?: CanvasLod;
  /** 边被点击（透明命中路径）时的回调：依赖画像里点连线 → 选中两端节点 + 展示符号 */
  onEdgeClick?: () => void;
}

/**
 * 依赖关系连线渲染器
 * 以 SVG 方式绘制带方向箭头的依赖连线
 * 循环依赖显示为红色高亮
 * 支持符号级引用标注：连线标签显示该边引用的具体符号名（如 import: {A, B}）
 *
 * ─── R37 性能改造 ────────────────────────────────────────────────────────
 * 依赖连线是画布上数量仅次于文件的实体（一个中型项目上千条）。原实现每条边
 * 外面套 <Box sx> + <Tooltip> + 内层 <Box sx>，代价 ×1000。现在：
 *   • 外壳与标签改成纯 div + inline style，说明走原生 title；
 *   • 接入 LOD —— 缩小后标签文字本就糊成一团，`compact` 起隐藏标签，
 *     `block` 档进一步退化为直线（省掉贝塞尔路径字符串与箭头三角计算）。
 * 连线的语义（颜色/虚实/线宽）在所有档位保持不变，因为那才是缩小后唯一
 * 还读得出来的信息。
 */
export function DependencyEdgeRenderer({
  config: _config,
  width = 200,
  height = 40,
  lod = "full",
  onEdgeClick,
}: DependencyEdgeRendererProps = {}) {
  const config = _config ?? {};
  const depType = config.depType || (config.callEdge ? "call" : "import");
  const isCircular = config.isCircular === true;
  // 选中文件 → 区分「出边/入边」方向高亮（依赖画像可读性增强 v2.18）
  const selectedFileId = useEditorStore((s) => {
    const id = s.selection.selectedIds[0];
    if (!id) return null;
    const c = s.components.find((x) => x.id === id);
    const cfg = (c?.config ?? {}) as Record<string, unknown>;
    return typeof cfg.fileId === "string" ? cfg.fileId : typeof cfg.filePath === "string" ? cfg.filePath : null;
  });

  const callEdge = config.callEdge === true;
  const crossFile = config.crossFile === true;
  // v2.17 依赖画像跨模块边：两端顶层目录不同 → 深色加粗（架构边界被绕过）
  // crossModule 定义在耦合边区块（config.crossModule === true），此处复用
  const callCount = config.callCount ?? 0;
  const symbolNames = config.symbolNames ?? [];

  // ─── 目录树引导线（tree-guide）：一个实体承载整棵树的直角连线 ───
  // config.segments 是相对包围盒左上角的扁平坐标数组 [x1,y1,x2,y2, …]，
  // 由 portraits.buildTreeGuide 计算（父节点竖干 + 每个子节点横枝）。
  // 只画直角折线，不用贝塞尔：引导线要的是「谁是谁的孩子」一眼可读，
  // 曲线反而会让层级关系变得暧昧。block 档省绘制（全览时引导线是次要信息）。
  if (depType === "tree-guide") {
    const raw = config.segments;
    const seg: number[] = Array.isArray(raw) ? (raw as number[]) : [];
    if (seg.length < 4) return null;
    if (lod === "block") return null;
    return (
      <svg
        width="100%"
        height="100%"
        style={{ position: "absolute", top: 0, left: 0, overflow: "visible", pointerEvents: "none" }}
      >
        <g
          stroke="rgba(120,145,180,0.55)"
          strokeWidth={1.25}
          strokeLinecap="round"
          shapeRendering="crispEdges"
        >
          {(() => {
            const lines: JSX.Element[] = [];
            for (let i = 0; i + 3 < seg.length; i += 4) {
              lines.push(<line key={i} x1={seg[i]} y1={seg[i + 1]} x2={seg[i + 2]} y2={seg[i + 3]} />);
            }
            return lines;
          })()}
        </g>
      </svg>
    );
  }

  // ─── 写作：设定卡共现边（cooccur）────────────────────────────────────
  // 两张设定卡在同一章被提及 = 一条共现关系（人物关系板 H5）。不复用 couplingEdge：
  // 共变的 tooltip 写死「共同修改 N 次」，用在这里是说谎 —— 语义是「一起出现」不是「一起改」。
  // 共现同样是对称关系 → 不画箭头，改用两端圆点；琥珀 #f59e0b 与人物卡同色系，
  // 与 import 灰 / call 绿 / 结构蓝 / 共变青 区分开。线宽随共现章数。
  if (depType === "cooccur") {
    const fx = config.fromX ?? 0;
    const fy = config.fromY ?? height / 2;
    const tx = config.toX ?? width;
    const ty = config.toY ?? height / 2;
    const coChapters = typeof config.coChanges === "number" ? config.coChanges : 0;
    const degree = typeof config.degree === "number" ? Math.max(0, Math.min(1, config.degree)) : 0;
    const w = 1.5 + degree * 3.5;
    const fromName = typeof config.fromName === "string" ? config.fromName : "";
    const toName = typeof config.toName === "string" ? config.toName : "";
    const tip = L(
      `「${fromName}」与「${toName}」在 ${coChapters} 章同场出现（共现度 ${(degree * 100).toFixed(0)}%）`,
      `"${fromName}" and "${toName}" appear together in ${coChapters} chapter(s) (co-occurrence ${(degree * 100).toFixed(0)}%)`,
    );
    if (lod === "block") {
      return (
        <svg width="100%" height="100%" style={{ position: "absolute", top: 0, left: 0, overflow: "visible", pointerEvents: "none" }}>
          <line x1={fx} y1={fy} x2={tx} y2={ty} stroke="#f59e0b" strokeWidth={w} opacity={0.9} />
        </svg>
      );
    }
    return (
      <div style={{ width: "100%", height: "100%", position: "relative", overflow: "visible", pointerEvents: "none" }}>
        <svg width="100%" height="100%" style={{ position: "absolute", top: 0, left: 0, overflow: "visible" }}>
          <line x1={fx} y1={fy} x2={tx} y2={ty} stroke="#f59e0b" strokeWidth={w} opacity={0.9} />
          <circle cx={fx} cy={fy} r={w * 0.9} fill="#f59e0b" opacity={0.95} />
          <circle cx={tx} cy={ty} r={w * 0.9} fill="#f59e0b" opacity={0.95} />
        </svg>
        {lod === "full" && (
          <div
            title={tip}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex",
              alignItems: "center",
              fontSize: 9,
              color: "#f59e0b",
              backgroundColor: "rgba(0,0,0,0.4)",
              padding: "2px 4px",
              borderRadius: 4,
              lineHeight: 1,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            <span>{L(`同场 ${coChapters} 章`, `together ${coChapters} ch.`)}</span>
          </div>
        )}
      </div>
    );
  }

  // ─── 树形结构边（父子引导线）：ECharts 风格三次贝塞尔 + 端点圆 ───
  // ECharts TreeView.getEdgeShape() 的 LR 布局公式：
  //   cpx1 = x1 + (x2-x1) * curveness,  cpy1 = y1
  //   cpx2 = x2 + (x1-x2) * curveness,  cpy2 = y2
  // curveness=0.5 时控制点在水平方向各走一半，形成平滑 S 曲线。
  if (depType === "structure") {
    const fromX = config.fromX ?? 0;
    const fromY = config.fromY ?? height / 2;
    const toX = config.toX ?? width;
    const toY = config.toY ?? height / 2;
    const curveness = 0.5;
    const dx = toX - fromX;
    const cpx1 = fromX + dx * curveness;
    const cpy1 = fromY;
    const cpx2 = toX - dx * curveness;
    const cpy2 = toY;
    const pathD = `M ${fromX},${fromY} C ${cpx1},${cpy1} ${cpx2},${cpy2} ${toX},${toY}`;
    // R39 加深：结构边 0.55 透明度 + 1.5px 在浅色画布上几乎看不见 —— 提到 0.9 / 2px
    const edgeColor = "rgba(96,165,250,0.9)";
    return (
      <svg
        width="100%"
        height="100%"
        style={{ position: "absolute", top: 0, left: 0, overflow: "visible", pointerEvents: "none" }}
      >
        <path d={pathD} fill="none" stroke={edgeColor} strokeWidth={2} />
        <circle cx={fromX} cy={fromY} r={3} fill={edgeColor} />
        <circle cx={toX} cy={toY} r={3} fill={edgeColor} />
      </svg>
    );
  }

  // ─── 跨语言派发边（invoke）：前端 invoke('cmd') → 后端 #[tauri::command] ───
  // 静态调用图看不见字符串派发（call_graph 跳过字面量），这条边由执行流画像补出，
  // 是「前端事件 → 后端」唯一可见的连线。琥珀 #f59e0b 虚线 = 运行时派发，非编译期静态调用，
  // 与调用绿 / import 灰 / 结构蓝 / 继承紫 区分开。
  if (depType === "invoke") {
    const fromX = config.fromX ?? 0;
    const fromY = config.fromY ?? height / 2;
    const toX = config.toX ?? width;
    const toY = config.toY ?? height / 2;
    const midX = (fromX + toX) / 2;
    const pathD = `M ${fromX},${fromY} Q ${midX},${fromY} ${midX},${(fromY + toY) / 2} Q ${midX},${toY} ${toX},${toY}`;
    const color = "#f59e0b";
    const arrowSize = 6;
    const angle = Math.atan2(toY - (fromY + toY) / 2, toX - midX);
    const arrowP1 = `${toX - arrowSize * Math.cos(angle - Math.PI / 6)},${toY - arrowSize * Math.sin(angle - Math.PI / 6)}`;
    const arrowP2 = `${toX - arrowSize * Math.cos(angle + Math.PI / 6)},${toY - arrowSize * Math.sin(angle + Math.PI / 6)}`;
    return (
      <div style={{ width: "100%", height: "100%", position: "relative", overflow: "visible", pointerEvents: "none" }}>
        <svg
          width="100%"
          height="100%"
          style={{ position: "absolute", top: 0, left: 0, overflow: "visible" }}
        >
          <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeDasharray="6 4" />
          <polygon points={`${toX},${toY} ${arrowP1} ${arrowP2}`} fill={color} />
        </svg>
      </div>
    );
  }

  // ─── 组件渲染主干（render）：应用入口 → 页面 → 组件 → 发起 invoke 的函数 ───
  // React 靠 JSX 渲染（<App/>），不是函数调用，调用图里没有这条主干，
  // 执行流画像改用导入关系（含被误判为 external 的修复 + 动态 import）补出。
  // 青 #06b6d4 虚线 = 组件引用/渲染链，与调用绿、invoke 琥珀都不同族。
  if (depType === "render") {
    const fromX = config.fromX ?? 0;
    const fromY = config.fromY ?? height / 2;
    const toX = config.toX ?? width;
    const toY = config.toY ?? height / 2;
    const midX = (fromX + toX) / 2;
    const pathD = `M ${fromX},${fromY} Q ${midX},${fromY} ${midX},${(fromY + toY) / 2} Q ${midX},${toY} ${toX},${toY}`;
    const color = "#06b6d4";
    const arrowSize = 6;
    const angle = Math.atan2(toY - (fromY + toY) / 2, toX - midX);
    const arrowP1 = `${toX - arrowSize * Math.cos(angle - Math.PI / 6)},${toY - arrowSize * Math.sin(angle - Math.PI / 6)}`;
    const arrowP2 = `${toX - arrowSize * Math.cos(angle + Math.PI / 6)},${toY - arrowSize * Math.sin(angle + Math.PI / 6)}`;
    return (
      <div style={{ width: "100%", height: "100%", position: "relative", overflow: "visible", pointerEvents: "none" }}>
        <svg
          width="100%"
          height="100%"
          style={{ position: "absolute", top: 0, left: 0, overflow: "visible" }}
        >
          <path d={pathD} fill="none" stroke={color} strokeWidth={1.75} strokeDasharray="3 3" />
          <polygon points={`${toX},${toY} ${arrowP1} ${arrowP2}`} fill={color} />
        </svg>
      </div>
    );
  }

  // ─── 继承连线（v2.2 代码结构画像）：子类 → 父类的 UML 式关系 ───
  // extends = 实线继承、implements = 虚线实现（UML 语义：继承实线三角、
  // 实现虚线三角）。紫色 #8B5CF6 与调用绿/紫、import 灰、耦合青都不同族，
  // 一眼可辨「这是类型层级关系不是运行时调用」。
  if (depType === "inherits") {
    const fromX = config.fromX ?? 0;
    const fromY = config.fromY ?? height / 2;
    const toX = config.toX ?? width;
    const toY = config.toY ?? height / 2;
    const midX = (fromX + toX) / 2;
    const pathD = `M ${fromX},${fromY} Q ${midX},${fromY} ${midX},${(fromY + toY) / 2} Q ${midX},${toY} ${toX},${toY}`;
    const color = "#8B5CF6";
    const isImplements = config.kind === "implements";
    const arrowSize = 6;
    const angle = Math.atan2(toY - (fromY + toY) / 2, toX - midX);
    const arrowP1 = `${toX - arrowSize * Math.cos(angle - Math.PI / 6)},${toY - arrowSize * Math.sin(angle - Math.PI / 6)}`;
    const arrowP2 = `${toX - arrowSize * Math.cos(angle + Math.PI / 6)},${toY - arrowSize * Math.sin(angle + Math.PI / 6)}`;
    return (
      <div style={{ width: "100%", height: "100%", position: "relative", overflow: "visible", pointerEvents: "none" }}>
        <svg
          width="100%"
          height="100%"
          style={{ position: "absolute", top: 0, left: 0, overflow: "visible" }}
        >
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray={isImplements ? "4,3" : "none"}
            opacity={0.9}
          />
          <polygon points={`${toX},${toY} ${arrowP1} ${arrowP2}`} fill={color} opacity={0.85} />
        </svg>
        {lod === "full" && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              fontSize: 9,
              color,
              fontWeight: 600,
              backgroundColor: "rgba(0,0,0,0.4)",
              padding: "2px 4px",
              borderRadius: 4,
              lineHeight: 1,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {isImplements ? "implements" : "extends"}
          </div>
        )}
      </div>
    );
  }

  // ─── 变更耦合边（无方向，线宽随耦合度）───
  const couplingEdge = config.couplingEdge === true;
  const hiddenCoupling = couplingEdge && config.couplingKind === "hidden";
  const degree = typeof config.degree === "number" ? config.degree : 0;
  const coChanges = config.coChanges ?? 0;
  const riskLevel = config.riskLevel ?? "low";
  const crossModule = config.crossModule === true;
  // 线宽 1.5 ~ 5：耦合度 0.35（下限阈值）起步，1.0 封顶
  const couplingWidth = 1.5 + Math.max(0, Math.min(1, (degree - 0.3) / 0.7)) * 3.5;

  // 连线起止点（从两侧边缘中点出发）
  const fromX = config.fromX ?? 0;
  const fromY = config.fromY ?? height / 2;
  const toX = config.toX ?? width;
  const toY = config.toY ?? height / 2;

  // 预览区检测：调用方未传坐标时（fromX=0,toX=width 为默认自动值），
  // 视为卡片预览场景，用更高对比度的"演示模式"配色 —— 深色预览底上 #475569 几乎不可见。
  const isPreview = !("fromX" in config) && !("toX" in config);

  // 变更耦合配色：隐性耦合按风险升温（琥珀→橙→红），结构性耦合用低调青色
  // —— 语义是「红色 = 架构上本不该相关，实际却被拴死，需要人看」
  const couplingColor = hiddenCoupling
    ? riskLevel === "extreme"
      ? "#EF4444"
      : riskLevel === "high"
        ? "#F97316"
        : "#F59E0B"
    : "#0EA5E9";

  // 选中文件时，直接连着它的依赖边按方向取高亮色（v2.18 依赖画像可读性增强）：
  // 出边=青蓝（它调用谁）、入边=橙（谁调用它）。非方向边/耦合边（对称无方向）保持原配色。
  const outRole = selectedFileId != null && !couplingEdge && config.fromFileId === selectedFileId;
  const inRole = selectedFileId != null && !couplingEdge && config.toFileId === selectedFileId;
  // 颜色优先级：选中方向边(出/入) > 耦合边 > 循环依赖(红) > 调用连线(跨文件紫 / 同文件绿) > 普通 import 依赖(灰)
  // R39 整体加深一档：旧值 #94A3B8(slate-400)+0.6 opacity 在浅色画布上发虚，
  // import 边是最常见的线，必须能一眼看穿。
  const lineColor = outRole
    ? "#06B6D4"
    : inRole
      ? "#F97316"
      : couplingEdge
        ? couplingColor
        : isCircular
          ? "#EF4444"
          : callEdge
            ? crossFile ? "#7C3AED" : "#16A34A"
            : isPreview
              ? "#60A5FA"   // 预览区：蓝灰 → 天蓝（深色底可见）
              : crossModule
                ? "#334155" // 跨模块：深石墨 —— 架构边界被绕过，需要人看
                : "#64748b"; // 模块内：石板灰 —— 弱化但不发虚（R39 之后基准 #475569）
  const arrowColor = outRole
    ? "#0891B2"
    : inRole
      ? "#EA580C"
      : isCircular
        ? "#DC2626"
        : callEdge
          ? crossFile ? "#6D28D9" : "#15803D"
          : isPreview
            ? "#3B82F6"     // 预览区箭头同步提亮
            : crossModule
              ? "#334155"
              : "#64748b";
  const labelColor = outRole
    ? "#06B6D4"
    : inRole
      ? "#F97316"
      : couplingEdge
        ? couplingColor
        : isCircular
          ? "#EF4444"
          : callEdge
            ? crossFile ? "#7C3AED" : "#16A34A"
            : isPreview
              ? "#93C5FD"     // 预览区标签：可读亮蓝
              : crossModule
                ? "#334155"
                : "#64748b";

  // v2.4 权重分级（模块依赖图）：weightRatio 0..1（调用量/最大调用量），
  // 低权重边淡且细、高权重边粗且实 —— 主依赖链一眼可辨。
  // 只有画像显式传了 weightRatio 才分级；普通调用/import 边保持原 2px/0.9 不变。
  const hasWeightRatio = typeof config.weightRatio === "number";
  const weightRatio = hasWeightRatio ? Math.max(0, Math.min(1, config.weightRatio as number)) : 1;
  // v2.18 cluster 模式：跨模块边进一步加粗加深（让「绕过模块边界」的隐性耦合一眼可见）。
// 同模块边正常，避免在一片簇内过分强调。
  // 这只是「相对自己」的倍率（force 模式跨模块边仍是 couplingWidth），
  // 让 cluster 视图下跨模块坏味道从「背景噪声」升级到「必须处理的」。
  const clusterMode = config.clusterMode === true;
  const clusterCrossBoost = clusterMode && crossModule ? 1.6 : 1;
  const strokeWidth = couplingEdge
    ? couplingWidth * clusterCrossBoost
    : hasWeightRatio
      ? 1 + 2 * weightRatio
      : depType === "import" && crossModule
        ? 2.5 // 跨模块 import：加粗强调
        : depType === "import" && config.crossModule === false
          ? 1.25 // 模块内 import：弱化
          : 2;
  const strokeDasharray = couplingEdge
    ? hiddenCoupling
      ? "none" // 隐性耦合用实线加粗，是「真实存在但没写在代码里」的关系
      : "4,4" // 结构性耦合已有 import 表达，虚线弱化
    : isCircular
      ? "5,3"
      : callEdge && crossFile
        ? "6,3"
        : "none";
  // 权重分级透明度：低权重边淡出（模块图主依赖链突出）；非模块图默认 0.9 不变
  // v2.18 cluster 模式：跨模块边透明度再上调一档（0.95），与线宽一起强化
  const clusterCrossOpacity = clusterMode && crossModule ? 0.95 : 0;
  const strokeOpacity = couplingEdge
    ? Math.min(1, (hiddenCoupling ? 0.95 : 0.75) + clusterCrossOpacity * 0.2)
    : isCircular
      ? 1
      : hasWeightRatio
        ? 0.3 + 0.6 * weightRatio
        : depType === "import" && crossModule
          ? 0.95
          : depType === "import" && config.crossModule === false
            ? 0.55
            : 0.9;

  // ─── block 档：只留一条直线 ───────────────────────────────────────────
  // 全览时一条边在屏幕上往往不足 20px，贝塞尔的弯曲、箭头三角、环形警示图标
  // 全都退化成一两个像素的糊点，却要付出路径字符串拼接 + 三角函数的代价。
  // 直接画直线：颜色/虚实/线宽这三个真正能读出来的语义一个不少。
  if (lod === "block") {
    return (
      <svg
        width="100%"
        height="100%"
        style={{ position: "absolute", top: 0, left: 0, overflow: "visible", pointerEvents: "none" }}
      >
        <line
          x1={fromX}
          y1={fromY}
          x2={toX}
          y2={toY}
          stroke={lineColor}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          opacity={strokeOpacity}
        />
      </svg>
    );
  }

  // 贝塞尔曲线：水平方向用二次曲线
  const midX = (fromX + toX) / 2;
  const pathD = `M ${fromX},${fromY} Q ${midX},${fromY} ${midX},${(fromY + toY) / 2} Q ${midX},${toY} ${toX},${toY}`;

  // 箭头 (在终点处)
  const arrowSize = 6;
  const angle = Math.atan2(toY - (fromY + toY) / 2, toX - midX);
  const arrowP1 = `${toX - arrowSize * Math.cos(angle - Math.PI / 6)},${toY - arrowSize * Math.sin(angle - Math.PI / 6)}`;
  const arrowP2 = `${toX - arrowSize * Math.cos(angle + Math.PI / 6)},${toY - arrowSize * Math.sin(angle + Math.PI / 6)}`;

  // 符号名标注文本（最多显示 3 个，超出补 +N）
  const symbolLabel =
    symbolNames.length > 0
      ? symbolNames.slice(0, 3).join(", ") + (symbolNames.length > 3 ? ` +${symbolNames.length - 3}` : "")
      : "";

  const tip = couplingEdge
    ? L(
        `${hiddenCoupling ? "隐性耦合" : "结构性耦合"}：共同修改 ${coChanges} 次，耦合度 ${(degree * 100).toFixed(0)}%${crossModule ? "；跨模块（架构边界被绕过）" : ""}${hiddenCoupling ? " —— 两者之间没有任何 import 关系，却总是一起改，改动其一时极易漏改另一个" : " —— 已有静态依赖，共变属正常"}`,
        `${hiddenCoupling ? "Hidden coupling" : "Structural coupling"}: co-modified ${coChanges} time(s), coupling ${(degree * 100).toFixed(0)}%${crossModule ? "; cross-module (architecture boundary bypassed)" : ""}${hiddenCoupling ? " — no import relationship between the two, yet they always change together; changing one easily misses the other" : " — has static dependency; co-change is expected"}`,
      )
    : symbolLabel
      ? L(`依赖类型: ${depType}${symbolNames.length > 3 ? `；引用符号: ${symbolNames.join(", ")}` : ""}`, `Dep type: ${depType}${symbolNames.length > 3 ? `; referenced symbols: ${symbolNames.join(", ")}` : ""}`)
      : callEdge
        ? L(`调用关系${crossFile ? "（跨文件）" : "（同文件）"}：调用 ${callCount} 次`, `Call relation${crossFile ? " (cross-file)" : " (same file)"}: ${callCount} call(s)`)
        : L(`依赖类型: ${depType}`, `Dep type: ${depType}`);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "visible", pointerEvents: "none" }}>
      <svg
        width="100%"
        height="100%"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          overflow: "visible",
        }}
      >
        {/* 线条（循环依赖虚线+红色，普通依赖实线；耦合边线宽随耦合度） */}
        <path
          d={pathD}
          fill="none"
          stroke={lineColor}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          opacity={strokeOpacity}
          pointerEvents="none"
        />

        {/* v2.17 边可点：透明加粗命中路径（仅描边像素捕获事件），让细依赖线也能点中；
            外层 shell 仍是 pointerEvents:none，空白处照常穿透到下层节点，不抢节点点击。 */}
        {onEdgeClick ? (
          <path
            d={pathD}
            fill="none"
            stroke="transparent"
            strokeWidth={12}
            style={{ pointerEvents: "visiblePainted", cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              onEdgeClick();
            }}
          />
        ) : null}

        {/* 箭头（耦合是对称关系，不画方向；改用两端圆点） */}
        {couplingEdge ? (
          <>
            <circle cx={fromX} cy={fromY} r={couplingWidth * 0.9} fill={lineColor} opacity={0.95} />
            <circle cx={toX} cy={toY} r={couplingWidth * 0.9} fill={lineColor} opacity={0.95} />
          </>
        ) : (
          <polygon
            points={`${toX},${toY} ${arrowP1} ${arrowP2}`}
            fill={arrowColor}
            opacity={isCircular ? 1 : 0.6}
          />
        )}

        {/* 跨模块隐性耦合：架构边界已被绕过，额外加感叹标记 */}
        {couplingEdge && hiddenCoupling && crossModule && (
          <>
            <circle cx={midX} cy={(fromY + toY) / 2 - 15} r={9} fill="#FEF3C7" />
            <text
              x={midX}
              y={(fromY + toY) / 2 - 10}
              textAnchor="middle"
              fill="#B45309"
              fontSize={11}
              fontWeight="bold"
            >
              !
            </text>
          </>
        )}

        {/* 循环依赖标记 */}
        {isCircular && (
          <>
            <circle cx={midX} cy={(fromY + toY) / 2 - 14} r={10} fill="#FEE2E2" />
            <text
              x={midX}
              y={(fromY + toY) / 2 - 9}
              textAnchor="middle"
              fill="#DC2626"
              fontSize={12}
              fontWeight="bold"
            >
              ⚠
            </text>
          </>
        )}
      </svg>

      {/* 类型标签 + 符号名标注（compact 档起隐藏 —— 9px 的字缩到 0.5 倍已不可读，
          留着只是给合成器添堵） */}
      {lod === "full" && (
        <div
          title={tip}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            display: "flex",
            alignItems: "center",
            gap: 3,
            fontSize: 9,
            color: labelColor,
            fontWeight: isCircular || hiddenCoupling ? 700 : 400,
            backgroundColor: "rgba(0,0,0,0.4)",
            padding: "2px 4px",
            borderRadius: 4,
            lineHeight: 1,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          <span>
            {couplingEdge
              ? L(`⇄ ${hiddenCoupling ? "隐性" : "共变"} ${coChanges}次 · ${(degree * 100).toFixed(0)}%`, `⇄ ${hiddenCoupling ? "Hidden" : "Co-change"} ${coChanges}× · ${(degree * 100).toFixed(0)}%`)
              : isCircular
                ? L(`循环依赖: ${depType}`, `Circular dep: ${depType}`)
                : callEdge
                  ? L(`${crossFile ? "↻ " : ""}调用×${callCount}`, `${crossFile ? "↻ " : ""}calls×${callCount}`)
                  : isPreview
                    ? L("import 依赖", "import dep")
                    : depType}
          </span>
          {symbolLabel && (
            <span
              style={{
                color: isCircular ? "#FCA5A5" : "#A5B4FC",
                fontWeight: 600,
              }}
            >
              {"{" + symbolLabel + "}"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
