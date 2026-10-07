import { useState, useCallback, useEffect, useMemo, startTransition, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined';
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined';
import MultilineChartOutlinedIcon from '@mui/icons-material/MultilineChartOutlined';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import SpellcheckOutlinedIcon from '@mui/icons-material/SpellcheckOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import { useEditorStore } from '../../store/editorStore';
import { useSceneStore } from '../../store/sceneStore';
import { useWritingStore } from '../../store/writingStore';
import { analyzerRegistry, useActiveAnalyzer, type ViewTemplateRegistration } from '../../editor/analyzer';
import { portraitForTemplate, runPortrait } from '../utils/portraits';
import { useToastStore } from '../../store/toastStore';
import { t, resolveFragments } from '../../i18n';
import { WRITING_GENRES, genreDef } from '../../utils/writingSchema';
import {
  createBookAutoNamed,
  deleteBookWithScene,
  openBookInStudio,
  openTypedCarrierView,
  parseBookIdFromRoot,
  reconcileStudioPaneView,
  type WritingViewKind,
} from '../../utils/studioBook';
import type { AnalysisView } from '../../types/scene';
import type { WritingBook } from '../../services/tauri';
import logger from '../../utils/logger';
import { openWritingDesk as openWritingDeskWindow } from '../../utils/writingDeskWindow';

/** L2 固定功能视图（全量分析定稿 + 全书总览）：设定群（大纲/人物/世界观）→
 * 结构群（时间线/剧情线/伏笔）→ 辅助群（灵感/校对/统计）→ 全书总览 → 正文。
 * 命中即切、缺省即建（openTypedCarrierView 幂等），打开后以 kind 高亮。
 * 「已建/未建」视觉区分（2026-09-28）：已有对应视图的页签正常显色（点击即切），
 * 尚未建过视图的淡显（点击将新建一个视图）——让「点击会新建」有预期。
 * 有现成 seed 布局器的是 catalog/characters/worldview，其余先落空画布，
 * 按「一个一个优化」节奏补 build*Board。overview 由 BookOverviewPanel 渲染。
 * 标签走 writing.viewKind.*（zh 值唯一）。 */
const KIND_TABS: { kind: WritingViewKind; Icon: typeof AccountTreeOutlinedIcon; labelKey: string }[] = [
  { kind: 'catalog', Icon: AccountTreeOutlinedIcon, labelKey: 'writing.viewKind.catalog' },
  { kind: 'characters', Icon: GroupsOutlinedIcon, labelKey: 'writing.viewKind.characters' },
  { kind: 'worldview', Icon: PublicOutlinedIcon, labelKey: 'writing.viewKind.worldview' },
  { kind: 'timeline', Icon: TimelineOutlinedIcon, labelKey: 'writing.viewKind.timeline' },
  { kind: 'storylines', Icon: MultilineChartOutlinedIcon, labelKey: 'writing.viewKind.storylines' },
  { kind: 'foreshadowing', Icon: FlagOutlinedIcon, labelKey: 'writing.viewKind.foreshadowing' },
  { kind: 'inspiration', Icon: LightbulbOutlinedIcon, labelKey: 'writing.viewKind.inspiration' },
  { kind: 'proofread', Icon: SpellcheckOutlinedIcon, labelKey: 'writing.viewKind.proofread' },
  { kind: 'stats', Icon: BarChartOutlinedIcon, labelKey: 'writing.viewKind.stats' },
  // 顺序 = 文件头注释：设定群 → 结构群 → 辅助群 → 全书总览 → 正文。
  // 曾把 writing 排在 overview 前（总览被挤到最后），2026-09-28 按注释归位。
  { kind: 'overview', Icon: DashboardOutlinedIcon, labelKey: 'writing.viewKind.overview' },
  { kind: 'writing', Icon: EditNoteOutlinedIcon, labelKey: 'writing.viewKind.writing' },
];

/** 插件视角模板 → 添加视图下拉 */
function ViewTemplateMenu({
  anchorEl,
  onClose,
  onSelect,
}: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onSelect: (template: ViewTemplateRegistration | null) => void;
}) {
  const active = useActiveAnalyzer();
  const templates = active ? analyzerRegistry.getViewTemplates(active.id) : [];
  const open = Boolean(anchorEl);

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: 280, mt: 0.5 } } }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      <Box sx={{ px: 2, py: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          {active ? t('viewTab.templateLabel', { name: resolveFragments(active.name) }) : t('viewTab.newView')}
        </Typography>
      </Box>
      <Divider />
      <MenuItem onClick={() => onSelect(null)} dense sx={{ py: 1 }}>
        <ListItemIcon>
          <AutoAwesomeOutlinedIcon sx={{ fontSize: 18 }} />
        </ListItemIcon>
        <ListItemText
          primary={<Typography variant="body2">{t('viewTab.customView')}</Typography>}
          secondary={
            <Typography variant="caption" color="text.secondary">
              {t('viewTab.customViewDesc')}
            </Typography>
          }
        />
      </MenuItem>
      {templates.length > 0 && <Divider />}
      {templates.map((t) => (
        <MenuItem key={t.type} onClick={() => onSelect(t)} dense sx={{ py: 1 }}>
          <ListItemIcon>
            <VisibilityOutlinedIcon sx={{ fontSize: 18 }} />
          </ListItemIcon>
          <ListItemText
            primary={<Typography variant="body2">{resolveFragments(t.name)}</Typography>}
            secondary={
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'normal' }}>
                {resolveFragments(t.description)}
              </Typography>
            }
          />
        </MenuItem>
      ))}
    </Menu>
  );
}

export function SceneTabBar({ bookToolbar }: { bookToolbar?: ReactNode }) {
  const views = useEditorStore((s) => s.views);
  const activeViewId = useEditorStore((s) => s.activeViewId);
  const previewMode = useEditorStore((s) => s.previewMode);
  const switchView = useEditorStore((s) => s.switchView);
  const addView = useEditorStore((s) => s.addView);
  const removeView = useEditorStore((s) => s.removeView);
  const renameView = useEditorStore((s) => s.renameView);

  // IA 收口（v2 书场景）：default 视图是代码场景「结构视图/目录树」遗留，
  // 书场景下业务画板（全书总览/分镜板/人物关系）才是工作区 —— default 空壳时
  // 直接从页签隐藏并自动切到第一个业务视图，消除「目录树」重名死节点。
  // 非空（用户往里拖过东西）则保留，绝不静默吞掉用户内容。
  const isBookScene = useSceneStore(
    (s) => s.scenes.find((sc) => sc.id === s.activeSceneId)?.primaryLanguage === 'novel-zh',
  );
  // 空态（V4）：书场景且画布上还没有任何载体视图时，整条 Tab 栏隐藏——
  // 居中引导由 SceneEditor 画布层显示，首个载体落下才出现 Tab。
  // 「载体」判定与 SceneEditor 同一口径（hasWritingCanvasCard），
  // 否则会出现「画布上有编辑面、页签栏却没有」的悬空态。
  //
  // 【2026-09-12 变更】该隐藏**已取消**：L1 改成作品（书）页签后，它是**导航**而不是内容，
  // 空画布上也必须能看见并切换作品 / 新建作品。载体判定移到 SceneEditor 画布层独占。
  const visibleViews = useMemo(() => {
    if (!isBookScene) return views;
    const others = views.filter((v) => v.id !== 'default');
    if (others.length === 0) return views;
    const def = views.find((v) => v.id === 'default');
    if (def && def.components.length === 0) return others;
    return views;
  }, [views, isBookScene]);

  // ─── L1 = 作品（书），不再是「题材分组」（用户拍板 2026-09-12）─────────────────
  // 书与场景一对一（bookSceneId = wscan_{bookId}），所以一个场景里的 views 全是同一本书的。
  // 因此 L1 栏必须换数据源：从「views 按 carrierType 分组」改成 **writingStore.books**，
  // 否则「再拖一次小说 = 新建一本书」永远表现为复用（题材只有固定四项）。
  const books = useWritingStore((s) => s.books);
  const chapters = useWritingStore((s) => s.chapters);
  const booksLoading = useWritingStore((s) => s.booksLoading);
  // 当前作品 id：**必须走订阅值**而不是 getState() —— 切换作品时 activeSceneId 变了，
  // 若在这里读快照，页签高亮不会跟着走（切完还停在旧作品上，看着像没切成功）。
  const currentBookRoot = useSceneStore((s) => s.scenes.find((sc) => sc.id === s.activeSceneId)?.projectRoot);
  const activeSceneId = useSceneStore((s) => s.activeSceneId);
  const activeBookId = useWritingStore((s) => s.activeBookId);
  const currentBookId = parseBookIdFromRoot(currentBookRoot) || activeBookId || '';
  const currentBook = books.find((b) => b.id === currentBookId);

  // MUI 硬约束：`Tabs` 的 value **必须命中某个子 Tab**，否则整个组件报
  // 「The `value` provided to the Tabs component is invalid」并让指示条乱跑。
  // currentBookId 取自**活动场景**的 projectRoot，books 取自**书库** —— 两者天然可能不同步：
  //   ① 启动竞态：场景先恢复、books 还没拉到（空数组）；
  //   ② 幽灵场景：活动场景指向的那本书已经不在书库里。
  // 所以必须按 books 校验一次，绝不能把 currentBookId 直接喂进去。
  const bookTabValue = useMemo(
    () => (books.some((b) => b.id === currentBookId) ? currentBookId : false),
    [books, currentBookId],
  );

  // 幽灵场景要留痕（绝不静默）：加载已结束、书库非空，却找不到活动场景指向的那本书。
  useEffect(() => {
    if (booksLoading || books.length === 0) return;
    if (!currentBookId || books.some((b) => b.id === currentBookId)) return;
    logger.warn('SceneTabBar', 'active scene points to a book missing from the shelf', {
      currentBookId,
      activeSceneId,
    });
    // 书不在架（书已删/没有作品）：回收全部作品级视图（2026-09-19 拍板）——
    // 中间区域不残留与作品关联的页签，只剩 L1 顶级页签 + 画布「拖载体入画布」提示。
    const es = useEditorStore.getState();
    for (const v of views) es.removeView(v.id, { allowEmpty: true });
  }, [booksLoading, books, currentBookId, activeSceneId, views]);

  // 书架懒加载：直接进工作室（应用重启）时 books 可能还是空数组，
  // 空 L1 栏会让「切换作品 / 新建作品」两个入口一起消失 —— 必须补一次加载。
  useEffect(() => {
    const ws = useWritingStore.getState();
    if (ws.books.length === 0 && !ws.booksLoading) void ws.loadBooks().catch(() => {});
  }, []);

  // L2 固定功能视图要落的题材 = 当前书的体裁。
  // 旧书 genre 可能为空（早于建书向导），此时回落「场景里已有视图的 carrierType」，
  // 再回落 novel —— 与 writingSchema「未设置回落小说集」的既有约定一致，老数据零回归。
  const bookGenre = useMemo(() => {
    if (currentBook?.genre) return currentBook.genre;
    const fromViews = visibleViews.find((v) => v.carrierType)?.carrierType;
    return fromViews ?? 'novel';
  }, [currentBook?.genre, visibleViews]);

  // 一个场景 = 一本书 = 一个题材组，所以 L2 的自定义页签就是本场景里所有「无 kind」的视图。
  const customViews = useMemo(() => visibleViews.filter((v) => !v.kind), [visibleViews]);

  // L2 键盘切换序列（2026-09-28）：已建视图按 L2 可视顺序排列 = KIND_TABS 已建项
  // （固定顺序）+ 自定义页签（出现顺序）。与 previewMode 同一语义——只切**已建**，
  // 绝不因按键触发「缺省即建」；未建的淡显页签不参与（新建是有副作用的显式操作）。
  const l2Switchable = useMemo(() => {
    if (!isBookScene) return [];
    const ids: string[] = [];
    for (const { kind } of KIND_TABS) {
      const v = visibleViews.find((x) => x.kind === kind);
      if (v) ids.push(v.id);
    }
    for (const v of customViews) ids.push(v.id);
    return ids;
  }, [isBookScene, visibleViews, customViews]);

  // 激活视图被隐藏（空壳 default）时自动切走，绝不显示无页签的悬空状态
  useEffect(() => {
    if (visibleViews.length > 0 && !visibleViews.some((v) => v.id === activeViewId)) {
      startTransition(() => switchView(visibleViews[0].id));
    }
  }, [visibleViews, activeViewId, switchView]);

  // 旧版视图清除（用户拍板「把旧的删掉」）：书场景内遗留一次性回收——
  //   1. 无 carrierType 的视图（pre-G2 载体视图 + default 结构壳「目录树」）。
  //   （kind="overview" 已是 L2 第一公民页签，由 openTypedCarrierView 管理，不再回收；
  //     旧数据里残留的 overview 视图有 carrierType，会被正常复用为总览编辑面。）
  // 【必须带 allowEmpty】书场景可删到 0 只（2026-09-19 拍板）。新书场景只有
  // default 壳这一只视图——不带 allowEmpty 会被「仅剩一只不可删」保护挡住
  // （editorStore.removeView），壳删不掉 → 「目录树」页签残留（2026-09-21 实测：
  // 书场景停用自动铺全书总览板后，没有第二只视图来解锁这次回收）。
  useEffect(() => {
    if (!isBookScene) return;
    const stale = views.filter((v) => !v.carrierType);
    if (stale.length === 0) return;
    const es = useEditorStore.getState();
    for (const v of stale) es.removeView(v.id, { allowEmpty: true });
  }, [views, isBookScene]);

  // 题材编辑视图（大纲/人物设定/世界观）的编辑面自愈：激活即校正。
  // 覆盖两条不依赖 L2 页签点击的路径：①重启后直接恢复某视图；
  // ②老视图里还铺着只读分析板。reconcileStudioPaneView 幂等且对非题材视图零副作用
  // （非此类 kind 直接返回），所以放在「激活视图变化」这一个点上收口最省。
  useEffect(() => {
    if (!isBookScene) return;
    reconcileStudioPaneView(activeViewId);
  }, [isBookScene, activeViewId]);

  // ─── 嵌套 Tab（书场景）：L1 作品（书） + L2 固定功能视图 + L3 章节页签 ───
  // L1 从「题材分组」换成「作品」后不再需要 viewGroups/activeGroup：
  // 书与场景一对一，所以一个场景的 views 就是这一本书的，L2 直接展示它们。
  // 旧的题材分组是渲染层概念（store 一直是平的），本次连渲染层也不再分组。

  // L1「＋」新建作品：选题材 → createBookAutoNamed(genre) → 新书 + 新支撑场景 + 新 L1 页签。
  // 与「拖载体进画布」是同一条链路（同一个 createBookAutoNamed），保证两个入口语义一致。
  const [bookMenuAnchor, setBookMenuAnchor] = useState<null | HTMLElement>(null);
  // 建书 / 切书都要跑一次书扫描（openBookInStudio 幂等），是有感的耗时 ——
  // 必须给可见的忙碌态，否则用户点完像没反应（静默是这套 UI 最不能接受的失败模式）。
  const [bookBusy, setBookBusy] = useState(false);

  const handleBookCreate = useCallback((genreId: string) => {
    setBookMenuAnchor(null);
    if (!genreDef(genreId)?.ready) return;
    setBookBusy(true);
    void createBookAutoNamed(genreId)
      .then((b) => {
        useToastStore.getState().showToast(t('studio.createdInStudio', { title: b.title }), 'success');
      })
      .catch((err) => {
        logger.warn('SceneTabBar', 'create book failed', { genreId, error: String(err) });
        useToastStore.getState().showToast(t('viewTab.bookOpFail'), 'error');
      })
      .finally(() => setBookBusy(false));
  }, []);

  const handleBookSwitch = useCallback(
    (bookId: string) => {
      if (!bookId || bookId === currentBookId || bookBusy) return;
      const b = useWritingStore.getState().books.find((x) => x.id === bookId);
      if (!b) return;
      setBookBusy(true);
      // 每个作品有自己的支撑场景与 views，切换 = 切场景，画布内容整体换掉。
      void openBookInStudio(b.id, b.title)
        .catch((err) => {
          logger.warn('SceneTabBar', 'open book failed', { bookId, error: String(err) });
          useToastStore.getState().showToast(t('viewTab.openBookFail', { title: b.title }), 'error');
        })
        .finally(() => setBookBusy(false));
    },
    [currentBookId, bookBusy],
  );

  // 作品重命名：与视图改名不同，**不查重名**（同一作者开两本同名草稿是合理的），只挡空串。
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [editingBookName, setEditingBookName] = useState('');
  const startBookEdit = useCallback((book: WritingBook, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingBookId(book.id);
    setEditingBookName(book.title);
  }, []);
  const confirmBookEdit = useCallback(() => {
    const id = editingBookId;
    const name = editingBookName.trim();
    setEditingBookId(null);
    if (!id || !name) return;
    void useWritingStore.getState().renameBook(id, name);
  }, [editingBookId, editingBookName]);

  // 删除作品 = 放弃这本书（含清支撑场景，见 studioBook.deleteBookWithScene）。
  // 只留一本时不给删（与「仅剩一只视图不可删」同一约定）：删掉最后一本会让 activeSceneId
  // 悬空成 null，画布进无场景态。
  const [deleteBookTarget, setDeleteBookTarget] = useState<string | null>(null);
  const confirmBookDelete = useCallback(() => {
    const id = deleteBookTarget;
    setDeleteBookTarget(null);
    if (!id) return;
    setBookBusy(true);
    void deleteBookWithScene(id)
      .catch((err) => {
        logger.warn('SceneTabBar', 'delete book failed', { bookId: id, error: String(err) });
        useToastStore.getState().showToast(t('viewTab.bookOpFail'), 'error');
      })
      .finally(() => setBookBusy(false));
  }, [deleteBookTarget]);

  // 方案 A（2026-09-14）：写作台入口从书场景顶栏迁 L1 书页签 —— 导航动作归导航位。
  // 与 SceneEditorPage.handleOpenWriting 同一链路：setActiveBook 自动装载章节/设定/大纲
  // （writingStore.ts:149），再跳 /writing。书页签上每本书都可直达，不必先切场景。
  const navigate = useNavigate();
  const openBookWriting = useCallback(
    (bookId: string) => {
      void useWritingStore
        .getState()
        .setActiveBook(bookId)
        .then(() => openWritingDeskWindow({ bookId }))
        .catch((err) => {
          logger.warn('SceneTabBar', 'open writing failed', { bookId, error: String(err) });
          useToastStore.getState().showToast(t('studio.opFailed', { msg: String(err) }), 'error');
        });
    },
    [navigate],
  );

  // L2 类型化单例入口：大纲 / 人物设定 / 世界观 / 正文。题材取**当前书的体裁**
  // （书与题材一一对应后，载体类型不再是用户可选的分组键）。
  const handlePinned = useCallback((genre: string, kind: WritingViewKind) => {
    if (!genre) return;
    openTypedCarrierView(genre, kind);
  }, []);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);

  const handleSwitch = useCallback(
    (_: React.SyntheticEvent, value: string) => {
      startTransition(() => {
        switchView(value);
      });
    },
    [switchView],
  );

  const handleAddClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setAddMenuAnchor(e.currentTarget);
  }, []);

  const handleAddMenuClose = useCallback(() => {
    setAddMenuAnchor(null);
  }, []);

  const handleAdd = useCallback(
    (template: ViewTemplateRegistration | null) => {
      setAddMenuAnchor(null);
      const idx = views.length + 1;
      if (template) {
        // 应用视角模板（§4.5）：defaultLayers → 新视图图层，layout → 缩放/平移/网格
        addView(template.name, {
          layers: template.defaultLayers.map((l) => ({ name: l.name, color: l.color })),
          layout: {
            scale: template.layout.scale,
            panX: template.layout.panX,
            panY: template.layout.panY,
            grid: template.layout.grid,
          },
        });
        // 视角模板 → 自动画像（§A 需求点）：模板名已暗示画像维度，
        // 创建完立即出图，避免"复杂度热力模板 → 空白画布"断链。
        // VIEW_TEMPLATE_PORTRAIT 已覆盖全部已注册模板 type，理论上不会落空；
        // 万一插件注册了未映射的新 type，这里给出明确提示而不是静默空白。
        const kind = portraitForTemplate(template.type);
        const sceneId = useSceneStore.getState().activeSceneId;
        // v2.30 修复：模板自动出图必须补传 projectRoot。重构四象限画像的 churn 维
        // 自愈（analyzeGitHistory）依赖 projectRoot，漏传时横轴（变更热度）永远全 0、
        // 散点塌成一条竖线 —— 用户观感即「不能用」。与菜单点击路径
        // （SceneEditorPage.tsx:994 已传 activeScene?.projectRoot）保持同一口径。
        const sceneRoot = useSceneStore.getState().getActiveScene()?.projectRoot ?? null;
        if (kind && sceneId) {
          void runPortrait(kind, sceneId, undefined, sceneRoot).then((o) =>
            useToastStore.getState().showToast(o.message, o.severity),
          );
        } else if (sceneId) {
          useToastStore
            .getState()
            .showToast(
              t('viewTab.noPortraitToast', { name: resolveFragments(template.name), type: template.type }),
              'info',
            );
        }
      } else {
        addView(t('viewTab.viewN', { n: idx }));
      }
    },
    [addView, views.length],
  );

  const handleRemove = useCallback(
    (viewId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setDeleteTarget(viewId);
    },
    [setDeleteTarget],
  );

  const confirmDelete = useCallback(() => {
    if (deleteTarget) {
      // 书场景 L2 页签全部可删（2026-09-19 拍板）：允许删到 0 只——
      // 删光 = 回到「拖载体入画布」空态（画布 V4 引导承接），不复活、不悬空崩溃。
      removeView(deleteTarget, { allowEmpty: true });
    }
    setDeleteTarget(null);
  }, [deleteTarget, removeView]);

  const startEdit = useCallback((viewId: string, name: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingId(viewId);
    setEditingName(resolveFragments(name));
  }, []);

  const confirmEdit = useCallback(() => {
    if (editingId && editingName.trim()) {
      const trimmed = editingName.trim();
      const duplicate = views.some((v) => v.id !== editingId && v.name === trimmed);
      if (duplicate) {
        return;
      }
      renameView(editingId, trimmed);
    }
    setEditingId(null);
  }, [editingId, editingName, renameView, views]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  useEffect(() => {
    if (!previewMode || views.length <= 1) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const currentIdx = views.findIndex((v) => v.id === activeViewId);
      if (e.key === 'ArrowLeft' && currentIdx > 0) {
        e.preventDefault();
        startTransition(() => {
          switchView(views[currentIdx - 1].id);
        });
      } else if (e.key === 'ArrowRight' && currentIdx < views.length - 1) {
        e.preventDefault();
        startTransition(() => {
          switchView(views[currentIdx + 1].id);
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewMode, views, activeViewId, switchView]);

  // 书场景 L2 键盘切换（2026-09-28）：与 previewMode 同一语义，但作用域是 L2 固定功能
  // 视图序列（l2Switchable，含自定义页签）。只在「已建」视图间左右切换，不触发缺省即建。
  // 冲突守卫（输入态不劫持）：
  //   ① 正文章页签的正文编辑是 contentEditable，箭头要移动光标——聚焦可编辑元素时跳过；
  //   ② 改名输入框（书名/视图名）同理，INPUT/TEXTAREA 跳过；
  //   ③ 带修饰键（Ctrl/⌘/Alt/Shift）的箭头组合让位给系统快捷键与编辑器动作；
  //   ④ 弹窗/菜单打开时不切（Dialog/Menu 落 body portal，写操作前应保持当前视图焦点）。
  // 判定顺序：先守卫后定位，保证「只在不该被劫持的语境外」消费箭头事件。
  useEffect(() => {
    if (!isBookScene || previewMode || l2Switchable.length <= 1) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      // contentEditable 判定兼容 jsdom（isContentEditable 不实现）与真实 DOM：
      // target 自身或任意祖先带 contenteditable 都视为正文编辑态（正文章页签编辑器）。
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable || Boolean(t.closest?.('[contenteditable]'))) {
        return;
      }
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const currentIdx = l2Switchable.indexOf(activeViewId);
      if (e.key === 'ArrowLeft' && currentIdx > 0) {
        e.preventDefault();
        startTransition(() => {
          switchView(l2Switchable[currentIdx - 1]);
        });
      } else if (e.key === 'ArrowRight' && currentIdx < l2Switchable.length - 1) {
        e.preventDefault();
        startTransition(() => {
          switchView(l2Switchable[currentIdx + 1]);
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBookScene, previewMode, l2Switchable, activeViewId, switchView]);

  // 【2026-09-12 变更】书场景「无载体就隐藏整条 Tab 栏」已取消 ——
  // L1 改成作品页签后它是**导航**：空画布上必须能看见当前作品、能切换作品、能新建作品
  // （用户拍板「L1 不是单开的，用户可以多开多个小说/散文」）。
  // 载体空态引导仍由 SceneEditor 画布层独占显示，两者不冲突。
  if (previewMode && views.length <= 1) {
    return null;
  }

  if (previewMode && views.length > 1) {
    return (
      <Box
        sx={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          backgroundColor: (theme) =>
            theme.palette.mode === 'dark' ? 'rgba(30,30,42,0.85)' : 'rgba(255,255,255,0.85)',
          borderRadius: 1.5,
          px: 0.5,
          py: 0.25,
          backdropFilter: 'blur(12px)',
          border: 1,
          borderColor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
          opacity: 0.4,
          transition: 'opacity 0.2s',
          '&:hover': { opacity: 1 },
          userSelect: 'none',
        }}
      >
        {views.map((view) => (
          <Box
            key={view.id}
            onClick={() => switchView(view.id)}
            sx={{
              px: 1.5,
              py: 0.5,
              fontSize: 12,
              cursor: 'pointer',
              borderRadius: 1,
              color: activeViewId === view.id ? 'primary.main' : 'text.secondary',
              backgroundColor:
                activeViewId === view.id
                  ? (theme) => (theme.palette.mode === 'dark' ? 'rgba(144,202,249,0.15)' : 'rgba(25,118,210,0.08)')
                  : 'transparent',
              fontWeight: activeViewId === view.id ? 600 : 400,
              transition: 'all 0.15s',
              '&:hover': {
                backgroundColor:
                  activeViewId === view.id
                    ? (theme) => (theme.palette.mode === 'dark' ? 'rgba(144,202,249,0.2)' : 'rgba(25,118,210,0.12)')
                    : (theme) => (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
              },
            }}
          >
            {resolveFragments(view.name)}
          </Box>
        ))}
      </Box>
    );
  }

  const isDuplicateName = editingId ? views.some((v) => v.id !== editingId && v.name === editingName.trim()) : false;

  // ─── 书场景嵌套 Tab（L1 作品 + L2 固定功能视图 + L3 章节页签）。代码场景不进此分支，
  // 走下方原渲染，零变化。 ───
  if (isBookScene) {
    // L2：固定功能视图（kind 命中高亮）+ 自定义页签（无 kind）。
    // 一个场景 = 一本书，所以自定义页签就是本场景里所有无 kind 的视图。
    const activeTyped = visibleViews.find((v) => v.id === activeViewId && v.kind);
    // 「已建/未建」区分：已建 = visibleViews 里有该 kind 的视图（点击只会切，不会新建）。
    const openedKinds = new Set<string>();
    for (const v of visibleViews) if (v.kind) openedKinds.add(v.kind);
    // 与 L1 同一个约束：`Tabs` 的 value 必须命中一个**已渲染**的子页签。
    // L2 有两个会失配的真实来源（都会在控制台刷同一条 MUI 警告）：
    //   ① 遗留数据里 `kind` 不在 KIND_TABS 固定 11 项内（旧版有过过渡 kind，
    //      清场 effect 要等一帧才把它回收掉，首帧就失配）；
    //   ② 激活视图是被剥掉的空壳 `default` —— 它不在 visibleViews 里，
    //      但 activeViewId 还指着它（切走也是等一帧的 effect）。
    const l2Value =
      activeTyped && KIND_TABS.some((k) => k.kind === activeTyped.kind)
        ? `kind:${activeTyped.kind}`
        : customViews.some((v) => v.id === activeViewId)
          ? activeViewId
          : false;
    const handleL2Change = (_: React.SyntheticEvent, value: string) => {
      if (value.startsWith('kind:')) {
        handlePinned(bookGenre, value.slice(5) as WritingViewKind);
        return;
      }
      startTransition(() => switchView(value));
    };

    // L1 作品页签标签：书名（可编辑）+ 体裁色点。与 L2 的视图页签同款交互
    // （双击改名 / ✎ 改名 / × 删除后确认），但删除的语义是**放弃这本书**。
    const renderBookLabel = (book: WritingBook) => (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {editingBookId === book.id ? (
          <TextField
            value={editingBookName}
            size="small"
            onChange={(e) => setEditingBookName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmBookEdit();
              if (e.key === 'Escape') setEditingBookId(null);
            }}
            onBlur={confirmBookEdit}
            autoFocus
            sx={{
              '& .MuiInputBase-input': { fontSize: 12, py: 0, px: 0.5, height: 20 },
              '& .MuiOutlinedInput-root': { py: 0 },
              width: 96,
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            {genreDef(book.genre) && (
              <Box
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: genreDef(book.genre)!.color,
                  flexShrink: 0,
                }}
              />
            )}
            <span
              onDoubleClick={(e) => {
                e.stopPropagation();
                startBookEdit(book);
              }}
              style={{ cursor: 'text' }}
            >
              {book.title}
            </span>
            <Box
              component="span"
              role="button"
              tabIndex={0}
              onClick={(e) => startBookEdit(book, e)}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                p: 0.15,
                opacity: 0.3,
                cursor: 'pointer',
                borderRadius: 0.5,
                '&:hover': { opacity: 1 },
              }}
            >
              <EditIcon sx={{ fontSize: 10 }} />
            </Box>
            <Tooltip title={t('studio.openWritingTip')}>
              <Box
                component="span"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  openBookWriting(book.id);
                }}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  p: 0.15,
                  opacity: 0.3,
                  cursor: 'pointer',
                  borderRadius: 0.5,
                  '&:hover': { opacity: 1 },
                }}
              >
                <EditNoteOutlinedIcon sx={{ fontSize: 11 }} />
              </Box>
            </Tooltip>
            {/* 删除 ×（2026-09-19 拍板）：任何作品都可删——含唯一一本。
                删到 0 本时 deleteBookWithScene 会清支撑场景，L1 栏只剩「＋」，
                中间区域回到「拖载体入画布」空态（与无作品态规范一致）。 */}
            <Tooltip title={t('viewTab.deleteBookHint')}>
              <Box
                component="span"
                role="button"
                tabIndex={0}
                data-book-delete={book.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteBookTarget(book.id);
                }}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  p: 0.15,
                  opacity: 0.3,
                  cursor: 'pointer',
                  borderRadius: 0.5,
                  '&:hover': { opacity: 1 },
                }}
              >
                <CloseIcon sx={{ fontSize: 10 }} />
              </Box>
            </Tooltip>
          </>
        )}
      </Box>
    );
    // 自定义页签始终可编辑/可关（固定功能视图不进 Tabs，无误关风险）
    const renderTabLabel = (view: AnalysisView, showControls: boolean) => (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {editingId === view.id ? (
          <TextField
            value={editingName}
            size="small"
            onChange={(e) => setEditingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isDuplicateName) confirmEdit();
              if (e.key === 'Escape') cancelEdit();
            }}
            onBlur={() => {
              if (!isDuplicateName) confirmEdit();
            }}
            autoFocus
            error={isDuplicateName}
            helperText={isDuplicateName ? t('viewTab.nameExists') : undefined}
            sx={{
              '& .MuiInputBase-input': { fontSize: 12, py: 0, px: 0.5, height: 20 },
              '& .MuiOutlinedInput-root': { py: 0 },
              '& .MuiFormHelperText-root': { fontSize: 9, mx: 0, mt: 0.5, lineHeight: 1 },
              width: isDuplicateName ? 100 : 80,
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <span
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (view.id !== 'default') startEdit(view.id, view.name);
              }}
              style={{ cursor: view.id === 'default' ? 'default' : 'text' }}
            >
              {resolveFragments(view.name)}
            </span>
            {showControls && view.id !== 'default' && (
              <>
                <Box
                  component="span"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => startEdit(view.id, view.name, e)}
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    p: 0.15,
                    opacity: 0.3,
                    cursor: 'pointer',
                    borderRadius: 0.5,
                    '&:hover': { opacity: 1 },
                  }}
                >
                  <EditIcon sx={{ fontSize: 10 }} />
                </Box>
                <Box
                  component="span"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => handleRemove(view.id, e)}
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    p: 0.15,
                    opacity: 0.3,
                    cursor: 'pointer',
                    borderRadius: 0.5,
                    '&:hover': { opacity: 1 },
                  }}
                >
                  <CloseIcon sx={{ fontSize: 10 }} />
                </Box>
              </>
            )}
          </>
        )}
      </Box>
    );

    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          userSelect: 'none',
        }}
      >
        {/* L1 作品 Tab：**一本书一个页签**（用户拍板 2026-09-12「L1 不是单开的，
            用户可以多开多个小说/散文」）。点页签 = 切到那本书的支撑场景；tab 名 = 书名，
            双击或 ✎ 改名，× 删除（确认后 = 放弃这本书）。 */}
        <Box sx={{ display: 'flex', alignItems: 'center', height: 30, minHeight: 30, px: 0.5 }}>
          <Tabs
            value={bookTabValue}
            onChange={(_, key: string) => handleBookSwitch(key)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              minHeight: 30,
              flex: 1,
              '& .MuiTabs-indicator': { height: 2 },
              '& .MuiTab-root': {
                minHeight: 30,
                px: 1.5,
                py: 0,
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'none',
                minWidth: 'auto',
              },
            }}
          >
            {books.map((book) => (
              <Tab key={book.id} value={book.id} label={renderBookLabel(book)} />
            ))}
          </Tabs>
          {bookBusy && <CircularProgress size={13} sx={{ mx: 0.75, flexShrink: 0 }} />}
          <Tooltip title={t('studio.newBook')}>
            <IconButton
              size="small"
              disabled={bookBusy}
              onClick={(e) => setBookMenuAnchor(e.currentTarget)}
              sx={{ mx: 0.5 }}
              aria-label={t('studio.newBook')}
            >
              <AddIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        </Box>

        {/* L2 功能视图条：固定语义视图（大纲/人物设定/世界观/正文），无「＋」——
            固定视图命中即切、缺省即建，不设自定义视图入口（自定义页签仅防御性渲染）。
            已建的视图正常显色（点击即切），未建过的淡显（点击将新建）——见 openedKinds。 */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            height: 34,
            minHeight: 34,
            px: 0.5,
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          <Tabs
            value={l2Value}
            onChange={handleL2Change}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              minHeight: 34,
              flex: 1,
              '& .MuiTabs-indicator': { height: 2 },
              '& .MuiTab-root': {
                minHeight: 34,
                px: 1.5,
                py: 0,
                fontSize: 12,
                textTransform: 'none',
                minWidth: 'auto',
              },
            }}
          >
            {KIND_TABS.map(({ kind, Icon, labelKey }) => {
              const opened = openedKinds.has(kind);
              return (
                <Tab
                  key={kind}
                  value={`kind:${kind}`}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                      <Icon sx={{ fontSize: 14, opacity: opened ? 1 : 0.45 }} />
                      <span style={{ opacity: opened ? 1 : 0.6 }}>{t(labelKey)}</span>
                    </Box>
                  }
                />
              );
            })}
            {customViews.map((view) => (
              <Tab key={view.id} value={view.id} label={renderTabLabel(view, true)} />
            ))}
          </Tabs>
          {/* P0 合并顶部行：书场景 36px 全宽顶栏隐藏后，undo/redo/save、
              左栏开关、导出下沉到 L2 行右侧（见 SceneEditor bookToolbarActions） */}
          {bookToolbar}
        </Box>

        {/* L1「＋」新建作品菜单：选题材即新建一本书（未实装置灰明示）。
            与「拖载体进画布」同一条链路（createBookAutoNamed），两个入口语义一致。 */}
        <Menu
          anchorEl={bookMenuAnchor}
          open={Boolean(bookMenuAnchor)}
          onClose={() => setBookMenuAnchor(null)}
          slotProps={{ paper: { sx: { width: 220, mt: 0.5 } } }}
        >
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              {t('studio.newBook')}
            </Typography>
          </Box>
          <Divider />
          {WRITING_GENRES.map((g) => (
            <MenuItem key={g.id} dense disabled={!g.ready} onClick={() => handleBookCreate(g.id)} sx={{ py: 0.75 }}>
              <ListItemIcon>
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: g.color,
                    opacity: g.ready ? 1 : 0.4,
                  }}
                />
              </ListItemIcon>
              <ListItemText primary={t(g.labelKey)} secondary={g.ready ? undefined : t('writing.genre.comingSoon')} />
            </MenuItem>
          ))}
        </Menu>

        {/* 删除作品（= 放弃这本书）确认框。文案复用书库那一套，且带上章节数
            ——「放弃」的分量必须让用户一眼看到。非当前作品拿不到章节数（chapters 只缓存
            当前书），退化成不带计数的文案，绝不编个数出来。 */}
        <Dialog open={deleteBookTarget !== null} onClose={() => setDeleteBookTarget(null)}>
          <DialogTitle>{t('writing.deleteBookTitle')}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {(() => {
                const b = books.find((x) => x.id === deleteBookTarget);
                if (!b) return null;
                return deleteBookTarget === currentBookId
                  ? t('writing.deleteBookConfirm', { title: b.title, n: chapters.length })
                  : t('writing.deleteBookConfirmNoCount', { title: b.title });
              })()}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteBookTarget(null)} size="small">
              {t('viewTab.cancel')}
            </Button>
            <Button onClick={confirmBookDelete} color="error" size="small" variant="contained">
              {t('viewTab.delete')}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
          <DialogTitle>{t('viewTab.deleteTitle')}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {t('viewTab.deleteConfirm', {
                name: resolveFragments(views.find((v) => v.id === deleteTarget)?.name ?? ''),
              })}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteTarget(null)} size="small">
              {t('viewTab.cancel')}
            </Button>
            <Button onClick={confirmDelete} color="error" size="small" variant="contained">
              {t('viewTab.delete')}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        height: 36,
        minHeight: 36,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        px: 0.5,
        userSelect: 'none',
      }}
    >
      {visibleViews.length === 1 ? (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, fontSize: 12, color: 'text.primary' }}>
            {editingId === visibleViews[0].id ? (
              <TextField
                value={editingName}
                size="small"
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isDuplicateName) confirmEdit();
                  if (e.key === 'Escape') cancelEdit();
                }}
                onBlur={() => {
                  if (!isDuplicateName) confirmEdit();
                }}
                autoFocus
                error={isDuplicateName}
                helperText={isDuplicateName ? t('viewTab.nameExists') : undefined}
                sx={{
                  '& .MuiInputBase-input': { fontSize: 12, py: 0, px: 0.5, height: 20 },
                  '& .MuiOutlinedInput-root': { py: 0 },
                  '& .MuiFormHelperText-root': { fontSize: 9, mx: 0, mt: 0.5, lineHeight: 1 },
                  width: isDuplicateName ? 100 : 80,
                }}
              />
            ) : visibleViews[0].id === 'default' ? (
              <span style={{ cursor: 'default' }}>{resolveFragments(visibleViews[0].name)}</span>
            ) : (
              <>
                <span
                  onDoubleClick={() => startEdit(visibleViews[0].id, visibleViews[0].name)}
                  style={{ cursor: 'text' }}
                >
                  {resolveFragments(visibleViews[0].name)}
                </span>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    startEdit(visibleViews[0].id, visibleViews[0].name);
                  }}
                  sx={{ p: 0.15, ml: 0.5, opacity: 0.3, '&:hover': { opacity: 1 } }}
                  aria-label={t('viewTab.rename')}
                >
                  <EditIcon sx={{ fontSize: 10 }} />
                </IconButton>
              </>
            )}
          </Box>
          <Box sx={{ flex: 1 }} />
          <Tooltip title={t('viewTab.addViewTip')}>
            <IconButton size="small" onClick={handleAddClick} sx={{ mx: 0.5 }} aria-label={t('viewTab.addViewTip')}>
              <AddIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </>
      ) : (
        <>
          <Tabs
            value={activeViewId}
            onChange={handleSwitch}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              minHeight: 36,
              flex: 1,
              '& .MuiTabs-indicator': { height: 2, bottom: 0 },
              '& .MuiTab-root': {
                minHeight: 36,
                px: 1.5,
                py: 0,
                fontSize: 12,
                textTransform: 'none',
                minWidth: 'auto',
              },
            }}
          >
            {visibleViews.map((view) => (
              <Tab
                key={view.id}
                value={view.id}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {editingId === view.id ? (
                      <TextField
                        value={editingName}
                        size="small"
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !isDuplicateName) confirmEdit();
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        onBlur={() => {
                          if (!isDuplicateName) confirmEdit();
                        }}
                        autoFocus
                        error={isDuplicateName}
                        helperText={isDuplicateName ? t('viewTab.nameExists') : undefined}
                        sx={{
                          '& .MuiInputBase-input': { fontSize: 12, py: 0, px: 0.5, height: 20 },
                          '& .MuiOutlinedInput-root': { py: 0 },
                          '& .MuiFormHelperText-root': { fontSize: 9, mx: 0, mt: 0.5, lineHeight: 1 },
                          width: isDuplicateName ? 100 : 80,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (view.id !== 'default') startEdit(view.id, view.name);
                          }}
                          style={{ cursor: view.id === 'default' ? 'default' : 'text' }}
                        >
                          {resolveFragments(view.name)}
                        </span>
                        {visibleViews.length > 1 && view.id !== 'default' && (
                          <>
                            <Box
                              component="span"
                              role="button"
                              tabIndex={0}
                              onClick={(e) => startEdit(view.id, view.name, e)}
                              sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                p: 0.15,
                                opacity: 0.3,
                                cursor: 'pointer',
                                borderRadius: 0.5,
                                '&:hover': { opacity: 1 },
                              }}
                            >
                              <EditIcon sx={{ fontSize: 10 }} />
                            </Box>
                            <Box
                              component="span"
                              role="button"
                              tabIndex={0}
                              onClick={(e) => handleRemove(view.id, e)}
                              sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                p: 0.15,
                                opacity: 0.3,
                                cursor: 'pointer',
                                borderRadius: 0.5,
                                '&:hover': { opacity: 1 },
                              }}
                            >
                              <CloseIcon sx={{ fontSize: 10 }} />
                            </Box>
                          </>
                        )}
                      </>
                    )}
                  </Box>
                }
              />
            ))}
          </Tabs>
          <Tooltip title={t('viewTab.addViewTip')}>
            <IconButton size="small" onClick={handleAddClick} sx={{ mx: 0.5 }} aria-label={t('viewTab.addViewTip')}>
              <AddIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </>
      )}

      <ViewTemplateMenu anchorEl={addMenuAnchor} onClose={handleAddMenuClose} onSelect={handleAdd} />

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>{t('viewTab.deleteTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('viewTab.deleteConfirm', {
              name: resolveFragments(views.find((v) => v.id === deleteTarget)?.name ?? ''),
            })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} size="small">
            {t('viewTab.cancel')}
          </Button>
          <Button onClick={confirmDelete} color="error" size="small" variant="contained">
            {t('viewTab.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
