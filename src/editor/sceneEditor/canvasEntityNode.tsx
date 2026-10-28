// 画布实体节点（业务联动 + 性能）：React.memo 节点 + 调用链展开会话态
import { useRef, memo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { openWritingDesk } from '../../utils/writingDeskWindow';
import { useSceneStore } from '../../store/sceneStore';
import { useWritingStore } from '../../store/writingStore';
import { type CanvasLod } from '../utils/lod';
import { CV, SHADOW_1 } from '../renderers/canvasTheme';
import { chainDepthStyle, CHAIN_SIDE_COLOR, type ChainSide } from '../utils/impactChain';
import { useToastStore } from '../../store/toastStore';
import { navigateToSource, navigateToSourceByPath } from '../utils/sourceNavigate';
import { openDirectorySubtree, runPortrait, expandCallChain } from '../utils/portraits';
import type { SceneComponent } from '../../types/editor';
import { t, resolveFragments } from '../../i18n';
import { RENDERERS, UnknownTypeFallback } from './renderers';
import type { CanvasEmphasis } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// 画布实体节点（业务联动 + 性能）
//
// 性能：这是「卡顿」的关键修复。此前 components.map 里内联渲染每个实体，
// 任何一次 store 更新（选中/拖动/平移/缩放）都会把几百个实体全部重渲染，
// 同步几百个文件后画布帧率掉到个位数。
// 现在每个实体是一个 React.memo 节点 —— 组件对象（immer 复用未改对象）与
// 选中态/强调态不变时直接跳过渲染，平移缩放只动 CSS transform，接近 60fps。
//
// 联动：选中一个文件实体后，画布会高亮它的依赖/被依赖邻居、点亮相关依赖线，
// 淡化无关实体 —— 这就是「画布实体与业务数据联动」的视觉表达；
// 双击文件实体直接打开源码（沟槽自动标记问题行）。
// ─────────────────────────────────────────────────────────────────────────────

// 调用链画像：记录已展开（多跳下钻）的符号 → 其增量创建的组件 id，
// 再次单击同一符号时据此收起（removeComponentsBulk）。会话态，不进 store。
const expandedCallChains = new Map<string, string[]>();

export const CanvasEntityNode = memo(function CanvasEntityNode({
  comp,
  isSelected,
  emphasis,
  layerColor,
  chainDepth,
  chainSide,
  lod,
  onSelect,
  onDragStart,
  drillState,
  onToggleDrill,
  onEdgeClick,
}: {
  comp: SceneComponent;
  isSelected: boolean;
  emphasis: CanvasEmphasis;
  layerColor: string;
  /** 画布 LOD 档位：缩小后省略徽标/文字，节点数从 ~23 降到 ~2（见 utils/lod.ts） */
  lod: CanvasLod;
  /** 影响链跳数（null = 未启用/未命中）；1 跳最亮，越深越淡 */
  chainDepth: number | null;
  /** 影响链方向：upstream=会被我波及 / downstream=我所依赖 / both=环 */
  chainSide: ChainSide | null;
  onSelect: (id: string, multi?: boolean) => void;
  onDragStart: (e: React.MouseEvent, comp: SceneComponent) => void;
  /** null = 不可下钻；true = 已展开；false = 可展开 */
  drillState: boolean | null;
  onToggleDrill: (comp: SceneComponent) => void;
  /** 依赖边被点击（透明命中路径）：选中两端节点 + 展示符号；仅依赖画像的边会下发 */
  onEdgeClick?: (comp: SceneComponent) => void;
}) {
  const Renderer = RENDERERS[comp.type] ?? UnknownTypeFallback;
  const isEdge = comp.type === 'dependency-edge';
  // 重构四象限背景分区（v2.29）：与边同权处理——命中测试 none（在渲染器内已设）、
  // 不可拖拽、不进入选中/聚焦逻辑，纯装饰层。
  const isQuadrantBg = comp.type === 'quadrant-zone-bg';
  // 缩小档位下角标只剩几像素，画了也看不清，却每个都是一个 DOM 节点 —— 全览
  // 时几百实体乘以三四个角标就是几千个白花花的节点。LOD 一并把它们剪掉。
  const showAdornments = lod === 'full';
  // 下钻子图外框：纯装饰，不能吃掉框内文件实体的点击/拖拽
  const isDrillFrame = !!(comp.config as any)?.drillFrame;

  // 影响链命中：按方向取色、按跳数取强度（1 跳最实，3 跳最虚）
  const chainStyle =
    chainDepth !== null && chainDepth > 0 && chainSide
      ? { color: CHAIN_SIDE_COLOR[chainSide], strength: chainDepthStyle(chainDepth).opacity }
      : null;

  // 选中文件实体时：无关联的实体/连线淡化（连线更淡），关联子图保持高亮
  // 影响链启用时，命中节点的整体不透明度也随跳数衰减 —— 远端影响本就更弱
  const opacity =
    emphasis === 'dim'
      ? isEdge
        ? 0.12
        : 0.32
      : chainStyle && emphasis !== 'self'
        ? 0.45 + chainStyle.strength * 0.55
        : 1;

  // 描边优先级：选中 > 影响链梯度（方向色 + 跳数强度）> 依赖邻居 > 无。
  // 写成 CSS 变量而非 outline 本身，否则 inline 会盖掉 :hover（见 canvasEntity.css）。
  const outlineVar = isSelected
    ? `2px solid ${CV.primary}`
    : emphasis === 'related'
      ? chainStyle
        ? `${chainDepth === 1 ? 2 : 1.5}px solid ${chainStyle.color}`
        : `1.5px solid ${CV.primaryLight}`
      : undefined;
  // 影响链 1 跳额外加一圈柔光，让「直接受影响」在一屏里跳出来
  const glow = chainStyle && chainDepth === 1 && !isSelected ? `0 0 0 3px ${chainStyle.color}22` : undefined;
  // 关联邻居时把卡片边框也染成链路色（描边在外、边框在内，双层更醒目）
  const borderColor = layerColor
    ? `${layerColor}44`
    : emphasis === 'related' && chainStyle
      ? chainStyle.color
      : undefined;

  // 单击/双击分流（与项目树目录行同约定「单击展开，双击定位」）：
  // - 可下钻实体（目录/模块）单点延迟 180ms 执行展开/收起，让双击优先取消，
  //   避免双击时先触发的单点把已展开子图误折叠；
  // - 不可下钻实体（文件/图片/符号等）单点立即选中，无展开/定位冲突；
  // - 双击统一只做「定位到左侧目录树节点」（selectComponent 选中 → 反向联动滚动+高亮），
  //   不打开源码、不居中画布视口，纯粹把对应节点呈现在文件树里让用户找到。
  const singleTimer = useRef<number | null>(null);
  const lastClick = useRef<{ id: string; t: number } | null>(null);

  // treemap-cell 是紧凑铺满色块（squarify 布局），自身渲染器已画 zone 底色+白边+选中，
  // 不需要 shell 外壳的透明底/边框/蓝边 outline —— 否则 canvasEntity.css 按
  // --ps-outline 画的选中蓝边会破坏紧凑色块视觉，与图鉴预览（同渲染器）不一致。
  const isTreemap = comp.type === 'treemap-cell';
  const shell: React.CSSProperties & Record<string, string | number | undefined> = {
    left: comp.transform.x,
    top: comp.transform.y,
    width: comp.transform.width,
    height: comp.transform.height,
    cursor: isEdge || isQuadrantBg ? 'default' : 'pointer',
    opacity,
    zIndex: emphasis === 'self' ? 3 : emphasis === 'related' ? 2 : isDrillFrame ? 0 : 1,
    // 分层背景色。原实现按明暗主题取 22/18 两档 alpha，差异 4/255 肉眼不可辨，
    // 换成固定 20 以摆脱 JS 侧 theme 访问（每实体一次调色板查表的代价没必要付）。
    backgroundColor: isTreemap ? 'transparent' : layerColor ? `${layerColor}20` : 'transparent',
    border: isTreemap ? 'none' : borderColor ? `1px solid ${borderColor}` : 'none',
    boxShadow: isTreemap ? undefined : glow,
    '--ps-outline': isTreemap ? undefined : outlineVar,
    '--ps-outline-hover': isTreemap ? undefined : isSelected ? `2px solid ${CV.primary}` : undefined,
    // 边的 shell 整包围盒吃掉点击 → 命中下层的实体卡片，
    // 「依赖关系把实体遮住选不上」的根因。边内部 SVG 路径 stroke 仍捕获事件
    // （pointer-events 仅影响命中测试，不阻断事件冒泡），故边上仍可点选连线。
    pointerEvents: isEdge || isQuadrantBg ? 'none' : 'auto',
  };

  return (
    <div
      className={
        isDrillFrame
          ? 'ps-entity ps-entity--frame'
          : isTreemap
            ? 'ps-entity ps-entity--treemap'
            : isSelected
              ? 'ps-entity ps-entity--selected'
              : 'ps-entity'
      }
      data-component-id={comp.id}
      onClick={(e) => {
        e.stopPropagation();
        const cfg0 = (comp.config ?? {}) as Record<string, unknown>;
        // v2.28 重构四象限聚焦：点击象限区域标签（layer-marker + quadrantZone）即高亮该象限
        // 全部文件、淡化其余（再次点击同一象限=复位）。不进入双击/选中逻辑，标签不可拖拽。
        if (comp.type === 'layer-marker' && typeof cfg0.quadrantZone === 'string') {
          const zone = cfg0.quadrantZone as 'refactorFirst' | 'legacyStable' | 'activeSimple' | 'healthy';
          const cur = useEditorStore.getState().quadrantFocusZone;
          useEditorStore.getState().setQuadrantFocusZone(cur === zone ? null : zone);
          useToastStore
            .getState()
            .showToast(
              cur === zone ? t('editor.quadFocusReset') : t('editor.quadFocus', { zone: t(`insight.quad.${zone}`) }),
              'info',
            );
          return;
        }
        const now = Date.now();
        const last = lastClick.current;
        // 双击 = 定位到目录树节点（手动判定，不依赖原生 dblclick）：
        // 原生 dblclick 在「拖拽 mousedown 的 preventDefault + 单点 180ms 延迟」组合下
        // 常被吞掉 → 双击退化成两次单点 → 文件夹退化到 openDirectorySubtree（无子节点
        // 时静默 no-op，观感就是「双击文件夹没反应」）。改在 click 内按 300ms 同实体
        // 二次点击判定双击，确保双击一定定位到文件树节点，覆盖 folder/模块/文件/图片/符号/未知。
        if (last && last.id === comp.id && now - last.t < 300) {
          lastClick.current = null;
          if (singleTimer.current) {
            window.clearTimeout(singleTimer.current);
            singleTimer.current = null;
          }
          const cfg = (comp.config ?? {}) as Record<string, unknown>;
          if (
            (cfg.portraitMode === 'moduleGraph' ||
              cfg.portraitMode === 'architecture' ||
              cfg.portraitMode === 'layering' ||
              comp.type === 'treemap-cell') &&
            typeof cfg.moduleName === 'string'
          ) {
            // v2.4 模块图节点双击：下钻该模块的目录子树视图（宏观→微观完整链路）
            const analysisId = useSceneStore.getState().activeSceneId;
            if (analysisId) {
              void openDirectorySubtree(cfg.moduleName as string, analysisId).then((res) =>
                useToastStore.getState().showToast(res.message, res.severity),
              );
            }
          } else if (cfg.expandableFile === true && typeof cfg.symbolDrillFile === 'string') {
            // v2.14 目录树符号展开：双击文件展开/收起其符号卡（代码结构画像）
            const analysisId = useSceneStore.getState().activeSceneId;
            useEditorStore.getState().toggleSymbolFile(cfg.symbolDrillFile as string);
            if (analysisId) {
              void runPortrait('symbols', analysisId).then((res) =>
                useToastStore.getState().showToast(res.message, res.severity),
              );
            }
          } else if (cfg.portraitMode === 'symbols' && typeof cfg.fileId === 'string') {
            // v2.3 符号双击：直接打开代码工作台定位定义行（一步到位，不绕文件树）
            const fid = cfg.fileId as string;
            const line = typeof cfg.lineStart === 'number' ? (cfg.lineStart as number) : null;
            const kind = typeof cfg.symbolKind === 'string' ? (cfg.symbolKind as string) : 'symbol';
            const res = navigateToSource(fid, line, t('panel.menu.toastOpenSymbol', { name: comp.name, kind }));
            if (!res.opened) useToastStore.getState().showToast(res.message, 'warning');
          } else if (cfg.portraitMode === 'dependency' && typeof cfg.fileId === 'string') {
            // v2.17 依赖画像文件节点双击：直接拉起代码工作台定位到该文件，
            // 与 symbols 画像双击开源码一致（依赖节点也带 fileId）。单点仍只做
            // 选中+就地高亮（保留全图），双击才跳源码，避免误触。
            const fid = cfg.fileId as string;
            const line = typeof cfg.lineStart === 'number' ? (cfg.lineStart as number) : null;
            const res = navigateToSource(fid, line);
            if (!res.opened) useToastStore.getState().showToast(res.message, 'warning');
            else useToastStore.getState().showToast(res.message, 'success');
          } else if (
            cfg.portraitMode === 'patterns' &&
            (typeof cfg.fileId === 'string' || typeof cfg.filePath === 'string')
          ) {
            // v2.20 设计模式节点双击：跳到命中符号所在的源码行（与 symbols/dependency 同款行动力）。
            // 单点仍只做选中+就地高亮（保留全图），双击才跳源码，避免误触。
            const fid = typeof cfg.fileId === 'string' ? (cfg.fileId as string) : null;
            const fpath = typeof cfg.filePath === 'string' ? (cfg.filePath as string) : null;
            const line = typeof cfg.line === 'number' ? (cfg.line as number) : null;
            const reason = t('panel.menu.toastOpenSymbol', { name: comp.name, kind: t('entityProj.patternNode.name') });
            const res =
              fid !== null
                ? navigateToSource(fid, line, reason)
                : fpath !== null
                  ? navigateToSourceByPath(fpath, line, reason)
                  : { opened: false, focusedCanvas: false, message: t('editor.patternNoFile') };
            if (!res.opened) useToastStore.getState().showToast(res.message, 'warning');
            else useToastStore.getState().showToast(res.message, 'success');
          } else if (
            comp.type === 'writing-chapter' ||
            comp.type === 'writing-workbench' ||
            comp.type === 'writing-character' ||
            comp.type === 'writing-worldview'
          ) {
            // P1 跳转语义（「卡即入口」承诺）：写作实体卡双击不进 CodeWorkbench ——
            // 章节的正确工作面是写作台正文（虚拟 md 文件对用户毫无意义），人物/世界观
            // 的正确工作面是设定卡编辑。带定位 state 跳 /writing，由 WritingPage 挂载
            // effect 消费（切书/切 Tab/激活目标）。解析不出业务 id 的旧壳卡降级为选中，
            // toast 明说，绝不静默 no-op。
            const ws = useWritingStore.getState();
            const cfgBook =
              // 预置板卡片直接携带 bookId（H1/H5/H6）：设定卡节点可能没有 filePath
              // （无主出场章时不写），路径反解兜不住，回退 activeBookId 会开错窗口
              typeof cfg.bookId === 'string' && (cfg.bookId as string)
                ? (cfg.bookId as string)
                : typeof cfg.filePath === 'string'
                  ? (cfg.filePath.match(/^writing:\/\/([^/]+)\//)?.[1] ?? null)
                  : null;
            const bookId = cfgBook ?? ws.activeBookId;
            if (comp.type === 'writing-chapter' || comp.type === 'writing-workbench') {
              let chapterId: string | null =
                typeof cfg.chapterId === 'string' && cfg.chapterId ? (cfg.chapterId as string) : null;
              if (!chapterId && typeof cfg.fileId === 'string' && (cfg.fileId as string).startsWith('wfile_')) {
                // 确定性约定：writing.rs fileId = wfile_{chapter_id}
                chapterId = (cfg.fileId as string).slice('wfile_'.length);
              }
              if (!chapterId && typeof cfg.filePath === 'string') {
                const m = (cfg.filePath as string).match(/^writing:\/\/[^/]+\/(.+)\.md$/);
                if (m) chapterId = m[1];
              }
              if (chapterId) {
                void openWritingDesk({ bookId, chapterId });
                return;
              }
              if (comp.type === 'writing-workbench' && cfgBook) {
                // 设计视图卡（书级绑定，无章节）：双击只选中，不打「未绑定」警告——
                // 它绑定的是书本身，不是丢失绑定的壳卡
                useEditorStore.getState().selectComponent(comp.id, false);
                return;
              }
            } else {
              let settingId: string | null =
                typeof cfg.settingId === 'string' && cfg.settingId ? (cfg.settingId as string) : null;
              if (!settingId) {
                // 重扫生成的卡只有名字：按名匹配业务层设定（resolveFragments 解 i18n key 壳卡）
                const nm = resolveFragments(comp.name);
                const hit = ws.settings.find((x) => x.name === nm);
                if (hit) settingId = hit.id;
              }
              if (settingId) {
                void openWritingDesk({ bookId, settingId });
                return;
              }
            }
            useToastStore.getState().showToast(t('editor.writingCardNoBinding', { name: comp.name }), 'warning');
            useEditorStore.getState().selectComponent(comp.id, false);
          } else if (typeof cfg.fileId === 'string' || typeof cfg.filePath === 'string') {
            // v2.19 通用兜底：任何带 fileId/filePath 的实体（网格类/象限/影响链/函数热点/数据流/
            // 架构·分层文件节点…）双击即跳源码——把"看得到问题文件"直接变成"摸得着去修"。
            // 复用 symbols/dependency 同款 navigateToSource，非侵入；上方分支已 return，不重复触发。
            const line =
              typeof cfg.lineStart === 'number'
                ? (cfg.lineStart as number)
                : typeof cfg.line === 'number'
                  ? (cfg.line as number)
                  : null;
            const reason = t('panel.menu.toastOpenEntity', { name: comp.name });
            const res =
              typeof cfg.fileId === 'string'
                ? navigateToSource(cfg.fileId as string, line, reason)
                : navigateToSourceByPath(cfg.filePath as string, line, reason);
            if (!res.opened) useToastStore.getState().showToast(res.message, 'warning');
            else useToastStore.getState().showToast(res.message, 'success');
          } else {
            useEditorStore.getState().selectComponent(comp.id, false);
          }
          return;
        }
        lastClick.current = { id: comp.id, t: now };
        // 单击 = 展开（与项目树「单击展开」同约定）：
        // - 可下钻模块：延迟 180ms 执行 drill 展开/收起 + 选中；
        // - 文件夹：延迟 180ms 打开其目录子树视图（openDirectorySubtree = 展开看内容）；
        // - 调用链画像的符号节点：单击沿调用图多跳展开（A→B→C→D），再次单击收起；
        // - 其余（文件/图片/符号等）：单点即选中，无需延迟。
        // 延迟在上面的双击分支被取消，故双击只走定位、不会误折叠/重复打开。

        // 调用链画像 function 节点：单击多跳展开 / 收起（双击仍走下方通用兜底跳源码）
        const callGraphCfg = (comp.config ?? {}) as Record<string, unknown>;
        if (callGraphCfg.portraitMode === 'callGraph' && comp.type === 'function') {
          if (singleTimer.current) window.clearTimeout(singleTimer.current);
          singleTimer.current = window.setTimeout(() => {
            singleTimer.current = null;
            const symId = (callGraphCfg.symbolId as string) ?? null;
            if (!symId) {
              onSelect(comp.id, false);
              return;
            }
            const existing = expandedCallChains.get(symId);
            const analysisId = useSceneStore.getState().activeSceneId;
            if (existing) {
              // 收起：移除增量创建的组件
              useEditorStore.getState().removeComponentsBulk(existing);
              expandedCallChains.delete(symId);
              useToastStore.getState().showToast(t('editor.callChainCollapsed', { name: comp.name }), 'info');
            } else if (analysisId) {
              // 展开：从节点当前坐标向右下增量追加多跳邻居
              const ox = comp.transform.x;
              const oy = comp.transform.y;
              const res = expandCallChain(analysisId, symId, { x: ox, y: oy }, 2);
              if (res.count > 0) {
                const ids = [...res.nodeIds, ...res.edgeIds];
                expandedCallChains.set(symId, ids);
                useToastStore
                  .getState()
                  .showToast(t('editor.callChainExpanded', { name: comp.name, n: res.count }), 'success');
              } else {
                useToastStore.getState().showToast(t('editor.callChainNoMore', { name: comp.name }), 'info');
              }
            }
            onSelect(comp.id, false);
          }, 180);
          return;
        }

        if (drillState !== null || comp.type === 'folder') {
          if (singleTimer.current) window.clearTimeout(singleTimer.current);
          singleTimer.current = window.setTimeout(() => {
            singleTimer.current = null;
            if (drillState !== null) {
              onToggleDrill(comp);
            } else if (comp.type === 'folder' && (comp.config as any)?.portraitMode !== 'symbols') {
              // 代码结构画像（v2.14 目录树）里目录树已全量绘制，单击不再展开子树
              const dirPath = typeof (comp.config as any)?.dirPath === 'string' ? (comp.config as any).dirPath : '';
              const analysisId = useSceneStore.getState().activeSceneId;
              if (analysisId && dirPath) {
                void openDirectorySubtree(dirPath, analysisId).then((res) =>
                  useToastStore.getState().showToast(res.message, res.severity),
                );
              }
            }
            onSelect(comp.id, false);
          }, 180);
          return;
        }
        onSelect(comp.id, false);
      }}
      onMouseDown={(e) => onDragStart(e, comp)}
      style={shell}
    >
      {/* 分层颜色标记（左上角小圆点） */}
      {showAdornments && layerColor && (
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: 2,
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: layerColor,
            zIndex: 1,
          }}
        />
      )}
      {/* 影响链跳数徽标：一眼读出「这个文件离我几跳、是我影响它还是它被我依赖」。
          只在非连线实体上出现，避免把依赖线也糊上标签。 */}
      {showAdornments && chainStyle && !isEdge && chainDepth !== null && chainDepth > 0 && (
        <div
          title={t('editor.chainJump', { label: t('editor.chainSide.' + chainSide!), depth: chainDepth })}
          style={{
            position: 'absolute',
            bottom: -7,
            left: -7,
            minWidth: 14,
            height: 14,
            padding: '0 2px',
            boxSizing: 'border-box',
            borderRadius: 7,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            fontWeight: 700,
            lineHeight: 1,
            color: '#fff',
            backgroundColor: chainStyle.color,
            boxShadow: SHADOW_1,
            pointerEvents: 'none',
            zIndex: 4,
          }}
        >
          {chainSide === 'upstream' ? '↑' : chainSide === 'downstream' ? '↓' : '↕'}
          {chainDepth}
        </div>
      )}
      {/* 模块下钻角标：点开 = 在右侧展开该模块的内部文件子图，再点 = 折叠。
          这是「实体不只是画像，能真正走进业务」的入口。 */}
      {showAdornments && drillState !== null && (
        <div
          className="ps-drill"
          role="button"
          title={drillState ? t('editor.drillFold') : t('editor.drillExpand')}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleDrill(comp);
          }}
          style={{ backgroundColor: drillState ? CV.warning : CV.primary, boxShadow: SHADOW_1 }}
        >
          {drillState ? '−' : '+'}
        </div>
      )}
      <Renderer
        type={comp.type}
        config={comp.config}
        componentId={comp.id}
        width={comp.transform.width}
        height={comp.transform.height}
        editorSelected={isSelected}
        lod={lod}
        onEdgeClick={onEdgeClick ? () => onEdgeClick(comp) : undefined}
      />
    </div>
  );
});
