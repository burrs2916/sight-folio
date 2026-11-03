// 全局设置抽屉：外观预设 / 颜色模式 / 主题色彩 / 字体大小 / 圆角风格 / 布局与密度 / 正文默认排版
//
// 设计口径（第十八轮整修）：
//  ① 每一项都「即时生效 + 即时落盘」——store 的每个 action 内部 persist，面板不设保存按钮；
//     底部原「✓ 确认设置」是只弹假 chip、不写数据的死控件，已移除（见 SettingsDrawerAutoSave 锁）。
//  ② 每一项都必须「真的被渲染层读到」。历史上多处设置只有存储没有消费点（sidebarWidth /
//     sidebarPosition / navbarStyle 零消费、字号只改 unitless 不改 variant），表现为
//     「设置点了没反应」。各档位的取值与消费点由 theme/appearanceScales.ts 单一真源约束，
//     并由 src/theme/__tests__/appearanceScales.test.ts 锁住「渲染层确实读了这些字段」。
//  ③ 写作场景自有能力（正文排版）在此收口为「全局默认」，书级单独调过的排版仍然优先。
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Divider from '@mui/material/Divider';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Button from '@mui/material/Button';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Chip from '@mui/material/Chip';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import Switch from '@mui/material/Switch';
// 「连写作偏好一起存」勾选框（第二十七轮）：预设带不带禅模式由创作者勾，不替它决定
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import UndoIcon from '@mui/icons-material/Undo';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';
import ViewCompactIcon from '@mui/icons-material/ViewCompact';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import PublishedWithChangesRoundedIcon from '@mui/icons-material/PublishedWithChangesRounded';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import SyncProblemIcon from '@mui/icons-material/SyncProblem';
import SyncIcon from '@mui/icons-material/Sync';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import { useThemeStore, isThemeConfigDefault } from '../../store/themeStore';
import { useSettingsSyncStore, overallStatus } from '../../store/settingsSyncStore';
import { useToastStore } from '../../store/toastStore';
import { getPresetSwatch, resolvePreset } from '../../theme/themePresets';
// 色卡上的勾选前景按色块实际颜色挑（第二十七轮），不再写死 #fff
import { pickReadableText } from '../../theme/contrast';
import { useLayoutStore, isConfigMatchingPreset } from '../../store/layoutStore';
import { useAppearanceStore } from '../../store/appearanceStore';
import { useTypographyDefaultsStore, isTypographyDefault } from '../../store/typographyDefaultsStore';
// 书级排版覆盖（第三十轮 P1）：抽屉里看得见「哪几本书单独调过」并给出收回默认的出口
//（第 32 轮把「只报数量」补成「逐本点名」，出口也从「只有全部收回」补成可单本收回）
import { useBookTypographyStore } from '../../store/bookTypographyStore';
// 书名反查用：书级覆盖表里只有 bookId，不 join 写作库就念不出「是哪一本」
import { useWritingStore } from '../../store/writingStore';
import { useLanguageStore } from '../../store/languageStore';
import { useWritingPrefsStore, isWritingPrefsDefault } from '../../store/writingPrefsStore';
import type { DeskFocusMode, TypewriterScroll, SaveCadence } from '../../store/writingPrefsStore';
import type { AppearanceProfile } from '../../store/appearanceStore';
import type { ThemeMode, FontSize, MotionPreference, UiFontFamily } from '../../store/themeStore';
import type { LayoutPreset, ContentPadding, SidebarPosition, NavbarStyle, ContentWidth } from '../../store/layoutStore';
import {
  radiusBasePx,
  clampRadiusPx,
  RADIUS_CUSTOM_RANGE,
  CONTENT_PADDING_PX,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_WIDTH_RANGE,
} from '../../theme/appearanceScales';
import {
  getBorderRadiusOptions,
  getSectionIndex,
  matchesSectionQuery,
  type SettingsSectionId,
  getDeskFocusOptions,
  getFontSizeOptions,
  getMotionOptions,
  getContentWidthOptions,
  getSaveCadenceOptions,
  getThemePresets,
  getTypewriterOptions,
  getUiFontOptions,
  presetLabel,
} from './settingsOptions';
import SettingsBackupSection from './SettingsBackupSection';
import SettingsWorksLibrarySection from './SettingsWorksLibrarySection';
import SettingsHealthNotice from './SettingsHealthNotice';
import {
  FONT_FAMILY_OPTIONS,
  LATIN_FONT_OPTIONS,
  type FontFamilyKey,
  type LatinFontFamilyKey,
} from '../../utils/typography';
import { t, resolveFragments } from '../../i18n';
import type { Lang } from '../../i18n';
import {
  uiFontSize,
  codeFontSize,
  codeFontSizeWithZoom,
  CODE_FONT_ZOOM_MIN,
  CODE_FONT_ZOOM_MAX,
  CODE_FONT_ZOOM_DEFAULT,
} from '../../theme/appearanceScales';
import Tooltip from '@mui/material/Tooltip';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

/** 卡片配色层：该预设在其目标明暗下的「页面底色 + 主色 + 分割线」 */
interface ProfileSwatchLayer {
  mode: 'light' | 'dark';
  background: string;
  primary: string;
  divider: string;
}

/**
 * 从 preset 注册表派生卡片配色，取值与主题实际生效值同源（不另立色值）。
 * 深色预设给深色层（accent 取深色下的 primary.main，即真正会用在深底上的那支）；
 * system 预设同时给出浅色与深色两层，直观表达「跟随系统、明暗两态都覆盖」。
 */
function getProfileSwatchLayers(profile: AppearanceProfile): ProfileSwatchLayer[] {
  const def = resolvePreset(profile.theme.preset, profile.theme.customPrimary);
  const layerOf = (mode: 'light' | 'dark'): ProfileSwatchLayer => ({
    mode,
    background: def[mode].background.default,
    primary: def[mode].primary.main,
    divider: def[mode].divider,
  });

  if (profile.theme.mode === 'dark') return [layerOf('dark')];
  if (profile.theme.mode === 'light') return [layerOf('light')];
  return [layerOf('light'), layerOf('dark')];
}

interface SectionSearchValue {
  query: string;
  index: { id: SettingsSectionId; title: string; keywords: string[] }[];
  expanded: Partial<Record<SettingsSectionId, boolean>>;
  setExpanded: (id: SettingsSectionId, next: boolean) => void;
}

const SectionSearchContext = createContext<SectionSearchValue>({
  query: '',
  index: [],
  expanded: {},
  setExpanded: () => {},
});

/**
 * 章节外壳：统一「标题 + 内容」的折叠面板。
 * 第二十六轮加三项能力（都靠抽屉那份章节清单驱动，章节自己不再各写一份）：
 *  ① 标题按 id 从清单反查；
 *  ② 搜索态下只显示命中章节、且强制展开（找不到 = 等于没有，找到了还要人手点开也白费）；
 *  ③ `tuned` 在折叠标题上直接标「已微调」—— 此前只有「布局」「外观预设」两处有这类标记，
 *     其余章节改没改过一眼看不出来。
 * 展开态改为**受控**（见 expandedMap）：搜索命中要能程序化展开，非受控做不到。
 */
function Section(props: {
  id: SettingsSectionId;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  summaryTestId?: string;
  /** 本章节存在非默认值（判据由各域的 isXxxDefault / isConfigMatchingPreset 给出） */
  tuned?: boolean;
}) {
  const { id, children, defaultExpanded = true, summaryTestId, tuned } = props;
  const { query, index, expanded, setExpanded } = useContext(SectionSearchContext);
  const meta = index.find((s) => s.id === id);
  const searching = query.trim().length > 0;
  if (searching && !matchesSectionQuery(query, meta?.title ?? '', meta?.keywords ?? [])) return null;
  const open = searching ? true : (expanded[id] ?? defaultExpanded);
  return (
    <>
      <Accordion
        square
        disableGutters
        expanded={open}
        onChange={(_, next) => setExpanded(id, next)}
        sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}
      >
        <AccordionSummary
          data-testid={summaryTestId ?? `settings-section-${id}`}
          expandIcon={<ExpandMoreIcon />}
          sx={{ pr: 1.5 }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {meta?.title ?? id}
            </Typography>
            {tuned && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                data-testid={`settings-tuned-${id}`}
                label={t('settings.sectionTuned')}
                sx={{ height: 18, fontSize: uiFontSize(10) }}
              />
            )}
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>{children}</AccordionDetails>
      </Accordion>
      <Divider />
    </>
  );
}

/** 一行小标题（章节内的分组标签） */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25, mb: 0.5, fontWeight: 600 }}>
      {children}
    </Typography>
  );
}

export default function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const themeConfig = useThemeStore((s) => s.config);
  const setMode = useThemeStore((s) => s.setMode);
  const setPreset = useThemeStore((s) => s.setPreset);
  const setFontSize = useThemeStore((s) => s.setFontSize);
  const setBorderRadius = useThemeStore((s) => s.setBorderRadius);
  const setBorderRadiusCustom = useThemeStore((s) => s.setBorderRadiusCustom);
  const setCustomPrimary = useThemeStore((s) => s.setCustomPrimary);
  const setMotion = useThemeStore((s) => s.setMotion);
  const setUiFont = useThemeStore((s) => s.setUiFont);
  const adjustCodeFontZoom = useThemeStore((s) => s.adjustCodeFontZoom);
  const setCodeFontZoom = useThemeStore((s) => s.setCodeFontZoom);
  // 代码编辑器字号（第三十六轮）：档位基准与微调步数都取自同一份 themeConfig，
  // 换算走 theme/appearanceScales 那唯一一处 —— 抽屉写的 px 与 Monaco 画的 px 因此不可能分家。
  const codeFontZoom = themeConfig.codeFontZoom ?? CODE_FONT_ZOOM_DEFAULT;
  const codeFontBasePx = codeFontSize('editor', themeConfig.fontSize);
  const codeFontPx = codeFontSizeWithZoom('editor', themeConfig.fontSize, codeFontZoom);

  const layoutConfig = useLayoutStore((s) => s.config);
  const applyLayoutPreset = useLayoutStore((s) => s.applyPreset);
  const setSidebarCollapsed = useLayoutStore((s) => s.setSidebarCollapsed);
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth);
  const setSidebarPosition = useLayoutStore((s) => s.setSidebarPosition);
  const setContentPadding = useLayoutStore((s) => s.setContentPadding);
  const setNavbarStyle = useLayoutStore((s) => s.setNavbarStyle);
  const setContentWidth = useLayoutStore((s) => s.setContentWidth);
  const setFullBleedFollowsLayout = useLayoutStore((s) => s.setFullBleedFollowsLayout);

  const profiles = useAppearanceStore((s) => s.profiles);
  const activeProfileId = useAppearanceStore((s) => s.activeProfileId);
  const baseProfileId = useAppearanceStore((s) => s.baseProfileId);
  const isModified = useAppearanceStore((s) => s.isModified);
  const applyProfile = useAppearanceStore((s) => s.applyProfile);
  const detectActiveProfile = useAppearanceStore((s) => s.detectActiveProfile);
  const saveCurrentAsProfile = useAppearanceStore((s) => s.saveCurrentAsProfile);
  const revertToBaseProfile = useAppearanceStore((s) => s.revertToBaseProfile);
  const deleteProfile = useAppearanceStore((s) => s.deleteProfile);
  const updateProfile = useAppearanceStore((s) => s.updateProfile);
  const overwriteProfileWithCurrent = useAppearanceStore((s) => s.overwriteProfileWithCurrent);
  const resetAll = useAppearanceStore((s) => s.resetAll);

  const typoConfig = useTypographyDefaultsStore((s) => s.config);
  const setTypoConfig = useTypographyDefaultsStore((s) => s.setConfig);

  // 书级排版覆盖（第三十轮 P1）：读的是同一份 store，抽屉、写作台、画布三处同源
  const bookTypoOverrides = useBookTypographyStore((s) => s.overrides);
  const clearAllBookTypography = useBookTypographyStore((s) => s.clearAllBookTypography);
  const clearOneBookTypography = useBookTypographyStore((s) => s.clearBookTypography);
  // 书名反查（第 32 轮，收第 31 轮待办 7①）：此前抽屉只报「N 本书单独调过」，
  // 而「是哪几本」只能回写作台一本本点开看 —— 看得见数量、看不见对象，等于没报告。
  const books = useWritingStore((s) => s.books);
  // 「全部收回跟随默认」是有代价的批量动作（会把每本书单独调过的排版抹掉），
  // 沿用「更新为当前状态」那条就地二次确认口径，不另造一套弹窗。
  const [confirmClearBooks, setConfirmClearBooks] = useState(false);

  // 写作偏好（第二十五轮）：抽屉、写作台、画布编辑器读的是同一个 store，
  // 即时生效 + 落设置库 + 跨窗口广播都在这条链路上（与主题各项同口径）。
  const writingPrefs = useWritingPrefsStore((s) => s.config);
  const setDeskFocusMode = useWritingPrefsStore((s) => s.setFocusMode);
  const setTypewriterScroll = useWritingPrefsStore((s) => s.setTypewriterScroll);
  const setSaveCadence = useWritingPrefsStore((s) => s.setSaveCadence);

  const lang = useLanguageStore((s) => s.lang);
  const setLanguage = useLanguageStore((s) => s.setLanguage);

  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  // 沉淀范围（第二十七轮，收第 25 轮待办 1）：默认**不带**写作偏好 —— 与内置预设同一口径，
  // 点一张预设只换外观，不该顺手把写作台切进禅模式（那会收起左右栏，是改变工作方式）。
  // 想「存一套完整夜读」的人勾上即可。刻意不持久化：这是这一次存卡的动作范围，不是一档设置。
  const [includeWritingInPreset, setIncludeWritingInPreset] = useState(false);
  // 预设改名（第二十轮）：一次只让一张卡处于编辑态，renamingId 即当前那张
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // 「更新为当前状态」的二次点击（第二十一轮）：覆盖是有代价的动作，但为一件日常动作
  // 弹整屏对话框太重 —— 让按钮就地变成「确认覆盖」，再点一次才动手，点别处即取消。
  const [overwritingId, setOverwritingId] = useState<string | null>(null);
  // 「恢复默认」确认弹窗（第二十一轮）：一键复位主题 / 布局 / 正文排版三个域，误点成本明显高于其它设置项
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  // ─── 搜索定位（第二十六轮）───
  // 抽屉已经 12 个章节，靠滚动找设置项对天天开同一扇门的人是负担（第 25 轮待办 3）。
  // 命中判定与标题都取自 getSectionIndex 那一份清单：章节自己不再各写一份文案。
  const [query, setQuery] = useState('');
  // 展开态改为受控：搜索命中要能自动展开（非受控做不到），用户手动折叠的记忆也留在这张表里。
  const [expandedMap, setExpandedMap] = useState<Partial<Record<SettingsSectionId, boolean>>>({});
  const setSectionExpanded = useCallback((id: SettingsSectionId, next: boolean) => {
    setExpandedMap((prev) => ({ ...prev, [id]: next }));
  }, []);
  // 关键词含 t() 结果 → 语言变了必须重算，否则英文界面下搜「typewriter」命不中中文关键词
  // lang 是**故意**进依赖的：关键词取的是 t() 结果，语言切了不重算就会出现
  // 「英文界面下搜 typewriter 命不中中文关键词」。exhaustive-deps 看不出这层耦合。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sectionIndex = useMemo(() => getSectionIndex(), [lang]);
  const hitCount = useMemo(
    () => sectionIndex.filter((sec) => matchesSectionQuery(query, sec.title, sec.keywords)).length,
    [sectionIndex, query],
  );
  const sectionSearchValue = useMemo(
    () => ({ query, index: sectionIndex, expanded: expandedMap, setExpanded: setSectionExpanded }),
    [query, sectionIndex, expandedMap, setSectionExpanded],
  );

  // 「恢复默认」确认弹窗要说实话：只列出**真的**偏离默认的那些域（第二十六轮）。
  const themeIsDefault = isThemeConfigDefault(themeConfig);
  const layoutIsDefault = isConfigMatchingPreset(layoutConfig);
  const typographyIsDefault = isTypographyDefault(typoConfig);
  const writingIsDefault = isWritingPrefsDefault(writingPrefs);
  /** 单独调过排版的书本数（第三十轮 P1）：这张表也是设置的一部分，抽屉要如实反映 */
  const bookOverrideCount = Object.keys(bookTypoOverrides).length;
  /**
   * 逐本点名（第三十二轮，收第 31 轮待办 7①）：把 bookId 反查成书名，让「哪几本调过」
   * 从一个数字变成一列能认出来的作品，并给每本一个收回默认的出口。
   * 覆盖表里可能存在**已经删掉的书**的残留 id（删书时没清这一域），所以按「查不到书名」
   * 如实标成「已删除的作品」并仍可收回 —— 而不是把它藏起来，让那个数字永远对不上。
   */
  const bookOverrideRows = useMemo(
    () =>
      Object.entries(bookTypoOverrides).map(([bookId, fields]) => {
        const names = Object.keys(fields ?? {});
        return {
          bookId,
          fieldCount: names.length,
          title: books.find((b) => b.id === bookId)?.title ?? '',
        };
      }),
    [bookTypoOverrides, books],
  );

  // 落盘真实读数（第二十轮）：逐个原子字段订阅，不在选择器里现拼对象 ——
  // zustand v5 用 useSyncExternalStore 比较引用，每次返回新对象会反复触发重渲染。
  const syncStatusMap = useSettingsSyncStore((s) => s.status);
  const lastSavedAt = useSettingsSyncStore((s) => s.lastSavedAt);
  const retryFailedWrites = useSettingsSyncStore((s) => s.retryFailed);
  const syncState = overallStatus(syncStatusMap, lastSavedAt);

  // 「当前生效的外观预设」由实际设置反查得出，而不是只靠 applyProfile 时写下的一次性标记：
  // 打开面板、或任意设置项变化时重新反查，保证高亮永远与真实状态一致
  // （重启后不再出现「有设置却无高亮」，单项微调后也不再残留旧高亮）。
  // typoConfig 也进依赖：自定义预设会连正文排版一起沉淀，排版调完要重新反查才知道还是不是那套。
  useEffect(() => {
    if (open) detectActiveProfile(themeConfig, layoutConfig);
  }, [open, themeConfig, layoutConfig, typoConfig, detectActiveProfile]);

  // 所有设置项（颜色模式 / 主题色 / 字号 / 圆角 / 布局 / 外观预设）在每个 action 内
  // 即时 persist 落盘——不存在「未保存」状态。底部原先那颗「✓ 确认设置」按钮
  // 只弹一个假「已保存 ✓」chip、并不写任何数据，是死控件：既误导创作者「不点保存不生效」，
  // 又和「重置」并列加重误解。本批移除它，改为诚实的「自动保存」提示 + 明确「关闭设置」出口。

  const handleModeChange = useCallback(
    (_: unknown, val: ThemeMode | null) => {
      if (val) setMode(val);
    },
    [setMode],
  );

  const commitPresetDraft = () => {
    saveCurrentAsProfile(presetName, { includeWriting: includeWritingInPreset });
    setPresetName('');
    setSavingPreset(false);
  };

  // 改名只在有非空文本时落盘：清空后回车不该把预设改成一个无名预设（列表里会看不出是哪套）
  const commitRename = () => {
    if (!renamingId) return;
    const next = renameDraft.trim();
    if (next) updateProfile(renamingId, { name: next });
    setRenamingId(null);
    setRenameDraft('');
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameDraft('');
  };

  /** 就地覆盖所选自定义预设（第二十一轮）：预设卡片右上那颗「更新」按钮 */
  const handleOverwriteProfile = (profile: AppearanceProfile) => {
    if (overwritingId !== profile.id) {
      setOverwritingId(profile.id);
      return;
    }
    setOverwritingId(null);
    // 走到这里只可能是自定义预设（按钮不画在内置卡上），store 里还有一道内置保护
    if (overwriteProfileWithCurrent(profile.id, { includeWriting: includeWritingInPreset })) {
      useToastStore.getState().info(t('settings.presetUpdated', { name: resolveFragments(profile.name) }));
    }
  };

  /** 确认恢复默认：三个域一起复位，并说明结果 —— 这句话与 resetAll 的真实覆盖面一致 */
  const handleResetConfirmed = () => {
    setResetConfirmOpen(false);
    resetAll();
    useToastStore.getState().info(t('settings.resetAllDone'));
  };

  /**
   * 全部书收回「跟随全局默认」（第三十轮 P1）。
   * 刻意**不**并进「恢复默认设置」那一键：书级覆盖是逐本书的偏好，属于用户一本一本调出来的
   * 资产，跟主题/布局这种全局口径不是一个性质；把它塞进那个按钮，等于让人一次点击丢掉
   * 几十本书的单独排版，而按钮文案只写了「含布局与正文排版」。这里单独出口 + 二次确认。
   */
  const handleClearAllBookTypography = () => {
    setConfirmClearBooks(false);
    clearAllBookTypography();
    useToastStore.getState().info(t('settings.bookTypographyCleared'));
  };

  /**
   * 单本收回「跟随全局默认」（第三十二轮，收第 31 轮待办 7①）。
   * 与「全部收回」刻意不同：那一键会冲掉每本书的资产，需要二次确认；这里只动抽屉上
   * 点名写出的那一本，代价一眼可见，就地一次点击即可，不再套一层确认（本仓口径：
   * 为一件小事弹整屏确认，比它要防的误点更扰人）。
   */
  const handleClearOneBookTypography = (bookId: string, title: string) => {
    clearOneBookTypography(bookId);
    useToastStore
      .getState()
      .info(t('settings.bookTypographyClearedOne', { name: title || t('settings.bookTypographyBookUnknown') }));
  };

  // 「已自动保存」要能核对：给出最近一次确实写进设置库的时间
  const savedTimeText = lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString() : '';

  const baseProfileName = baseProfileId ? profiles.find((p) => p.id === baseProfileId)?.name : undefined;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100%', sm: 480, md: 560 },
            maxWidth: '100vw',
            p: 0,
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      {/* 标题栏 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2.5,
          py: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t('settings.title')}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label={t('settings.close')}>
          <CloseIcon />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <SectionSearchContext.Provider value={sectionSearchValue}>
          {/* 搜索框（第二十六轮）：按章节标题 + 档位关键词过滤，命中即自动展开。
            刻意不做「下拉建议 / 高亮片段」—— 抽屉只有 12 章，能少一层交互就少一层。 */}
          <Box sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
            <TextField
              size="small"
              fullWidth
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('settings.search')}
              aria-label={t('settings.search')}
              slotProps={{
                // MUI v9：inputProps 已并入 slotProps.htmlInput（与 select / input 同一套 slot 口径）
                htmlInput: { 'data-testid': 'settings-search' },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon sx={{ fontSize: uiFontSize(16) }} />
                    </InputAdornment>
                  ),
                  endAdornment: query ? (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => setQuery('')}
                        aria-label={t('settings.searchClear')}
                        data-testid="settings-search-clear"
                      >
                        <CloseIcon sx={{ fontSize: uiFontSize(14) }} />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                },
              }}
            />
            {query.trim() !== '' && (
              <Typography
                variant="caption"
                color={hitCount === 0 ? 'warning.main' : 'text.secondary'}
                data-testid="settings-search-result"
                sx={{ display: 'block', mt: 0.75, lineHeight: 1.5 }}
              >
                {hitCount === 0 ? `${t('settings.searchEmpty')} · ${t('settings.searchEmptyHint')}` : `${hitCount}`}
              </Typography>
            )}
          </Box>

          {/* ─── 外观预设：默认收起，避免「12 张卡片全展开」把抽屉撑得过长 ─── */}
          <Section
            id="appearancePreset"
            defaultExpanded={false}
            tuned={isModified}
            summaryTestId="appearance-preset-summary"
          >
            {/* 入口放在展开后的首行，而不是折叠标题里：AccordionSummary 本身就是一个 button，
              再塞一颗 Button 是无效 DOM 嵌套（React 告警），键盘操作下点击还会连带展开/收起。 */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
              <Button
                size="small"
                onClick={() => setSavingPreset((v) => !v)}
                data-testid="appearance-save-preset"
                sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}
              >
                {t('settings.saveAsPreset')}
              </Button>
            </Box>

            {isModified && baseProfileId && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Chip
                  size="small"
                  color="warning"
                  variant="outlined"
                  label={t('settings.presetModified')}
                  sx={{ height: 20, fontSize: uiFontSize(10) }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }} noWrap>
                  {baseProfileName ? resolveFragments(baseProfileName) : ''}
                </Typography>
                <Button
                  size="small"
                  startIcon={<UndoIcon sx={{ fontSize: uiFontSize(14) }} />}
                  onClick={revertToBaseProfile}
                  sx={{ textTransform: 'none', fontSize: uiFontSize(11), ml: 'auto', flexShrink: 0 }}
                >
                  {t('settings.revertPreset')}
                </Button>
              </Box>
            )}

            {savingPreset && (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
                <TextField
                  size="small"
                  autoFocus
                  fullWidth
                  value={presetName}
                  placeholder={t('settings.presetNamePlaceholder')}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitPresetDraft();
                  }}
                  sx={{ '& .MuiOutlinedInput-input': { fontSize: uiFontSize(12) } }}
                />
                <Button
                  size="small"
                  variant="contained"
                  onClick={commitPresetDraft}
                  sx={{ textTransform: 'none', fontSize: uiFontSize(12) }}
                >
                  {t('settings.savePreset')}
                </Button>
              </Box>
            )}

            {/* 沉淀范围（第二十七轮）：勾上才把「专注模式 / 打字机滚动 / 保存节奏」写进这张卡。
                默认不勾 = 点预设只换外观（内置预设从不声明这一维，同一口径）。
                这行在「另存」与「更新为当前状态」两个动作上都生效，所以放在两处共用的卡片区顶部。 */}
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={includeWritingInPreset}
                  data-testid="preset-include-writing-checkbox"
                  onChange={(e) => setIncludeWritingInPreset(e.target.checked)}
                  sx={{ p: 0.5 }}
                />
              }
              label={
                <Typography variant="caption" color="text.secondary">
                  {t('settings.presetIncludeWriting')}
                </Typography>
              }
              sx={{ mt: 0.5, mb: 0.5, display: 'flex', alignItems: 'flex-start' }}
            />
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 1 }}>
              {t('settings.presetIncludeWritingHint')}
            </Typography>

            {profiles.length > 0 && (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1 }}>
                {profiles.map((profile) => {
                  const isActive = activeProfileId === profile.id;
                  const swatchLayers = getProfileSwatchLayers(profile);
                  return (
                    <Card
                      key={profile.id}
                      variant="outlined"
                      data-testid={`appearance-card-${profile.id}`}
                      sx={{
                        cursor: 'pointer',
                        borderColor: isActive ? 'primary.main' : 'divider',
                        bgcolor: isActive ? 'action.selected' : 'background.paper',
                        transition: 'all 0.15s',
                        '&:hover': { borderColor: 'primary.light' },
                        position: 'relative',
                      }}
                      onClick={() => applyProfile(profile.id)}
                    >
                      <CardActionArea sx={{ p: 1.25 }}>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                          {/* 配色预览：底色方块 + 主色圆点，取值来自 preset 注册表 */}
                          <Box
                            data-testid={`appearance-swatch-${profile.id}`}
                            sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}
                          >
                            {swatchLayers.map((layer) => (
                              <Box
                                key={layer.mode}
                                data-testid={`appearance-swatch-${profile.id}-${layer.mode}`}
                                data-primary={layer.primary}
                                data-background={layer.background}
                                style={{ background: layer.background, borderColor: layer.divider }}
                                sx={{
                                  width: 30,
                                  height: 30,
                                  borderRadius: 1,
                                  border: '1px solid',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <Box
                                  data-testid={`appearance-swatch-dot-${profile.id}-${layer.mode}`}
                                  style={{ background: layer.primary }}
                                  sx={{ width: 16, height: 16, borderRadius: '50%' }}
                                />
                              </Box>
                            ))}
                          </Box>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600, fontSize: uiFontSize(12) }}>
                                {resolveFragments(profile.name)}
                              </Typography>
                              {isActive && (
                                <CheckCircleIcon sx={{ fontSize: uiFontSize(14), color: 'primary.main', ml: 'auto' }} />
                              )}
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: uiFontSize(10) }}>
                              {resolveFragments(profile.description)}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75, flexWrap: 'wrap' }}>
                              <Chip
                                label={
                                  profile.theme.mode === 'dark'
                                    ? t('settings.profileDark')
                                    : profile.theme.mode === 'light'
                                      ? t('settings.profileLight')
                                      : t('settings.profileSystem')
                                }
                                size="small"
                                variant="outlined"
                                sx={{ height: 18, fontSize: uiFontSize(9) }}
                              />
                              <Chip
                                label={presetLabel(profile.theme.preset)}
                                size="small"
                                variant="outlined"
                                sx={{ height: 18, fontSize: uiFontSize(9) }}
                              />
                              {!profile.isBuiltIn && (
                                <Chip
                                  label={t('settings.customPresetTag')}
                                  size="small"
                                  variant="outlined"
                                  color="primary"
                                  sx={{ height: 18, fontSize: uiFontSize(9) }}
                                />
                              )}
                              {/* 声明了排版的预设（另存为预设那种）点一下就连正文一起切，卡片上说清楚 */}
                              {profile.typography && (
                                <Chip
                                  label={t('settings.presetWithTypography')}
                                  size="small"
                                  variant="outlined"
                                  data-testid={`appearance-typography-tag-${profile.id}`}
                                  sx={{ height: 18, fontSize: uiFontSize(9) }}
                                />
                              )}
                            </Box>
                          </Box>
                        </Box>
                      </CardActionArea>
                      {/* 改名编辑态放在 CardActionArea **之外**：CardActionArea 本身就是 button，
                         输入框套进 button 是无效 DOM 嵌套（第十九轮已因同类问题把按钮挪出过 summary）。
                         stopPropagation：在输入框里点击/输入不应连带触发卡片的「应用该预设」。 */}
                      {renamingId === profile.id && (
                        <Box
                          data-testid={`appearance-rename-${profile.id}`}
                          sx={{ display: 'flex', gap: 0.5, px: 1.25, pb: 1 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <TextField
                            size="small"
                            autoFocus
                            fullWidth
                            value={renameDraft}
                            placeholder={t('settings.presetNamePlaceholder')}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename();
                              if (e.key === 'Escape') cancelRename();
                            }}
                            sx={{ '& .MuiOutlinedInput-input': { fontSize: uiFontSize(11), py: 0.6 } }}
                          />
                          <Button
                            size="small"
                            variant="contained"
                            onClick={commitRename}
                            data-testid={`appearance-rename-commit-${profile.id}`}
                            sx={{ textTransform: 'none', fontSize: uiFontSize(11), flexShrink: 0 }}
                          >
                            {t('settings.savePreset')}
                          </Button>
                        </Box>
                      )}
                      {/* 覆盖确认条：图标按下去只是「我要覆盖」，再点确认才真动手。
                        和改名编辑态一样放在 CardActionArea 之外（那里本身是 button，不能再套交互元素）。 */}
                      {overwritingId === profile.id && (
                        <Box
                          data-testid={`appearance-update-confirm-${profile.id}`}
                          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, pb: 1 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Typography variant="caption" color="warning.main" sx={{ minWidth: 0 }}>
                            {t('settings.updatePresetConfirm')}
                          </Typography>
                          <Button
                            size="small"
                            variant="contained"
                            color="warning"
                            data-testid={`appearance-update-commit-${profile.id}`}
                            onClick={() => handleOverwriteProfile(profile)}
                            sx={{ textTransform: 'none', fontSize: uiFontSize(11), ml: 'auto' }}
                          >
                            {t('ui.confirm')}
                          </Button>
                          <Button
                            size="small"
                            data-testid={`appearance-update-cancel-${profile.id}`}
                            onClick={() => setOverwritingId(null)}
                            sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}
                          >
                            {t('ui.cancel')}
                          </Button>
                        </Box>
                      )}
                      {/* 更新为当前状态（第二十一轮）：微调后想就地沉淀进这张卡，
                        此前只能「另存为新预设」或删掉重建，列表越存越长。
                        内置预设不给覆盖：其定义在代码里，写库也会在下次启动被盖回，观感就是「改了没生效」。 */}
                      {!profile.isBuiltIn && (
                        <IconButton
                          size="small"
                          aria-label={t('settings.updatePreset')}
                          title={t('settings.updatePreset')}
                          data-testid={`appearance-update-${profile.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOverwriteProfile(profile);
                          }}
                          sx={{
                            position: 'absolute',
                            top: 2,
                            right: 50,
                            p: 0.25,
                            color: overwritingId === profile.id ? 'warning.main' : 'text.disabled',
                          }}
                        >
                          <PublishedWithChangesRoundedIcon sx={{ fontSize: uiFontSize(14) }} />
                        </IconButton>
                      )}
                      {/* 自定义预设可改名（内置不改：其 name 存的是 i18n key，改名会打断翻译解引用） */}
                      {!profile.isBuiltIn && (
                        <IconButton
                          size="small"
                          aria-label={t('settings.renamePreset')}
                          title={t('settings.renamePreset')}
                          data-testid={`appearance-rename-btn-${profile.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingId(profile.id);
                            setRenameDraft(resolveFragments(profile.name));
                          }}
                          sx={{ position: 'absolute', top: 2, right: 26, p: 0.25, color: 'text.disabled' }}
                        >
                          <EditRoundedIcon sx={{ fontSize: uiFontSize(14) }} />
                        </IconButton>
                      )}
                      {/* 自定义预设可删（内置不可删，删了下次启动又回来） */}
                      {!profile.isBuiltIn && (
                        <IconButton
                          size="small"
                          aria-label={t('settings.deletePreset')}
                          data-testid={`appearance-delete-${profile.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteProfile(profile.id);
                          }}
                          sx={{ position: 'absolute', top: 2, right: 2, p: 0.25, color: 'text.disabled' }}
                        >
                          <DeleteOutlineRoundedIcon sx={{ fontSize: uiFontSize(14) }} />
                        </IconButton>
                      )}
                    </Card>
                  );
                })}
              </Box>
            )}
          </Section>

          {/* ─── 界面语言：与顶栏那颗切换按钮同源同值，改完即落设置库 ─── */}
          <Section id="language" defaultExpanded>
            <ToggleButtonGroup
              value={lang}
              exclusive
              size="small"
              fullWidth
              onChange={(_: unknown, val: Lang | null) => val && setLanguage(val)}
            >
              <ToggleButton value="zh-CN" sx={{ textTransform: 'none' }}>
                {t('settings.langZh')}
              </ToggleButton>
              <ToggleButton value="en-US" sx={{ textTransform: 'none' }}>
                {t('settings.langEn')}
              </ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
              {t('settings.languageHint')}
            </Typography>
          </Section>

          {/* ─── 颜色模式 ─── */}
          <Section id="colorMode" defaultExpanded tuned={themeConfig.mode !== 'system'}>
            <ToggleButtonGroup value={themeConfig.mode} exclusive onChange={handleModeChange} size="small" fullWidth>
              <ToggleButton value="light" sx={{ textTransform: 'none', gap: 0.5 }}>
                <LightModeIcon sx={{ fontSize: uiFontSize(16) }} /> {t('settings.modeLight')}
              </ToggleButton>
              <ToggleButton value="dark" sx={{ textTransform: 'none', gap: 0.5 }}>
                <DarkModeIcon sx={{ fontSize: uiFontSize(16) }} /> {t('settings.modeDark')}
              </ToggleButton>
              <ToggleButton value="system" sx={{ textTransform: 'none', gap: 0.5 }}>
                <SettingsBrightnessIcon sx={{ fontSize: uiFontSize(16) }} /> {t('settings.modeSystem')}
              </ToggleButton>
            </ToggleButtonGroup>
          </Section>

          {/* ─── 主题色彩 ─── */}
          <Section id="themeColor" defaultExpanded tuned={themeConfig.preset !== 'default'}>
            {/* 色卡带文字标签：此前十个纯色块只靠 title 提示，创作者要逐个把鼠标停上去才知道
              哪块是哪一套（英文界面下更是全靠猜）。标签用本地化 label，与主题实际生效值同源。 */}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {getThemePresets(themeConfig.customPrimary).map((preset) => {
                const activePreset = themeConfig.preset === preset.id;
                return (
                  <Box
                    key={preset.id}
                    data-testid={`theme-preset-${preset.id}`}
                    onClick={() => setPreset(preset.id)}
                    title={preset.label}
                    sx={{
                      width: 44,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 0.25,
                      transition: 'all 0.15s',
                      '&:hover': { transform: 'scale(1.06)' },
                    }}
                  >
                    <Box
                      sx={{
                        width: 32,
                        height: 32,
                        background: preset.color,
                        borderRadius: 1.5,
                        border: '2px solid',
                        borderColor: activePreset ? 'primary.main' : 'divider',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                      }}
                    >
                      {activePreset && (
                        <CheckCircleIcon
                          sx={{
                            fontSize: uiFontSize(16),
                            // 勾选前景按色块实际颜色挑（第 26 轮待办 5）：此前写死 #fff，
                            // 而 9 套色板里「素纸 / 暖金 / 清透绿」这些浅底块上白勾几乎看不见 ——
                            // 用户点中的那一套反而没有对勾，读起来像「主题色选了没生效」。
                            color: pickReadableText(preset.color),
                            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
                          }}
                        />
                      )}
                    </Box>
                    <Typography
                      variant="caption"
                      align="center"
                      color={activePreset ? 'text.primary' : 'text.disabled'}
                      sx={{ fontSize: uiFontSize(9), lineHeight: 1.2, fontWeight: activePreset ? 700 : 400 }}
                    >
                      {preset.label}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
            {themeConfig.preset === 'custom' && (
              <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <input
                  type="color"
                  value={themeConfig.customPrimary || getPresetSwatch('default')}
                  onChange={(e) => setCustomPrimary(e.target.value)}
                  // 原生 color input 拿不到 MUI theme，圆角走本仓自己的档位变量
                  // --app-radius-base（AppTheme 按档位写进 :root，兜底 = medium 档 6px；
                  // 此前写死 4px，后又挂过 MUI 前缀变量（依赖其内部配置）；口径与理由见 appearanceScales 头部注释）
                  style={{
                    width: 32,
                    height: 32,
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: 'var(--app-radius-base, 6px)',
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  {t('settings.customPrimary')}
                </Typography>
              </Box>
            )}
          </Section>

          {/* ─── 字体大小：标注真实生效 px，避免「预览 13px / 实际 14px」的错位 ─── */}
          <Section
            id="fontSize"
            defaultExpanded
            tuned={themeConfig.fontSize !== 'medium' || codeFontZoom !== CODE_FONT_ZOOM_DEFAULT}
          >
            <ToggleButtonGroup
              value={themeConfig.fontSize}
              exclusive
              onChange={(_: unknown, val: FontSize | null) => val && setFontSize(val)}
              size="small"
              fullWidth
            >
              {getFontSizeOptions().map((opt) => (
                <ToggleButton
                  key={opt.id}
                  value={opt.id}
                  sx={{ textTransform: 'none' }}
                  data-testid={`font-size-${opt.id}`}
                >
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="caption" sx={{ display: 'block' }}>
                      {opt.label}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.disabled"
                      sx={{ display: 'block', fontSize: uiFontSize(10) }}
                    >
                      {opt.px}px
                    </Typography>
                  </Box>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            {/* ─── 代码编辑器字号（第三十六轮）────────────────────────────────
                这一维此前只能去代码工作台的状态栏调，而且只存 localStorage：设置界面看不见它、
                「恢复默认」管不到它、换设备导备份也带不走它。现在它与档位同处一屏、同一个库。
                读数显示的是**真正喂给 Monaco 的那个数**（档位基准 + 微调步数），不是又一处预览值。 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1.5, flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {t('settings.codeFontSize')}
              </Typography>
              <Typography variant="caption" color="text.secondary" data-testid="settings-code-font-px">
                {codeFontPx}px
              </Typography>
              <Tooltip title={t('settings.codeFontSizeMinus')} placement="top">
                <span>
                  <IconButton
                    size="small"
                    data-testid="code-font-zoom-minus"
                    disabled={codeFontZoom <= CODE_FONT_ZOOM_MIN}
                    onClick={() => adjustCodeFontZoom(-1)}
                    sx={{ fontSize: uiFontSize(13) }}
                  >
                    −
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('settings.codeFontSizePlus')} placement="top">
                <span>
                  <IconButton
                    size="small"
                    data-testid="code-font-zoom-plus"
                    disabled={codeFontZoom >= CODE_FONT_ZOOM_MAX}
                    onClick={() => adjustCodeFontZoom(1)}
                    sx={{ fontSize: uiFontSize(13) }}
                  >
                    +
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('settings.codeFontSizeReset')} placement="top">
                <span>
                  <IconButton
                    size="small"
                    data-testid="code-font-zoom-reset"
                    disabled={codeFontZoom === CODE_FONT_ZOOM_DEFAULT}
                    onClick={() => setCodeFontZoom(CODE_FONT_ZOOM_DEFAULT)}
                  >
                    <RestartAltIcon sx={{ fontSize: uiFontSize(13) }} />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.25 }}>
              {t('settings.codeFontSizeHint', {
                base: codeFontBasePx,
                steps: codeFontZoom > 0 ? `+${codeFontZoom}` : codeFontZoom,
              })}
            </Typography>
          </Section>

          {/* ─── 界面字体（第二十三轮新增设置项）：只管界面字族，写作台纸面仍走「正文默认排版」 ─── */}
          <Section id="uiFont" defaultExpanded tuned={(themeConfig.uiFont ?? 'system') !== 'system'}>
            <ToggleButtonGroup
              value={themeConfig.uiFont ?? 'system'}
              exclusive
              size="small"
              fullWidth
              onChange={(_: unknown, val: UiFontFamily | null) => val && setUiFont(val)}
            >
              {getUiFontOptions().map((opt) => (
                <ToggleButton
                  key={opt.id}
                  value={opt.id}
                  data-testid={`ui-font-${opt.id}`}
                  // 预览用该档真正注入的那条字体栈：所见即所得，不靠名字猜。
                  // 走 **inline style** 而不是 sx：sx 会被 Emotion 折成类名，元素上读不到那条栈
                  // （自动化无法核对「档位 = 注入值」，人也只能靠标签名猜字体）。这里注入的常量与
                  // AppTheme 写进 theme.typography.fontFamily 的是同一份 UI_FONT_STACKS，两处同源。
                  style={{ fontFamily: opt.stack }}
                  sx={{ textTransform: 'none', flexDirection: 'column', gap: 0.25, py: 0.5 }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    Aa 永字
                  </Typography>
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: uiFontSize(10) }}>
                    {opt.label}
                  </Typography>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
              {t('settings.uiFontHint')}
            </Typography>
          </Section>

          {/* ─── 圆角风格：Chip 上直接画出该档半径，所见即所得 ─── */}
          <Section id="borderRadius" defaultExpanded tuned={themeConfig.borderRadius !== 'medium'}>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {getBorderRadiusOptions().map((opt) => {
                const active = themeConfig.borderRadius === opt.id;
                return (
                  <Chip
                    key={opt.id}
                    data-testid={`radius-${opt.id}`}
                    icon={
                      <Box
                        component="span"
                        sx={{
                          width: 14,
                          height: 14,
                          ml: 0.75,
                          border: '1.5px solid',
                          borderColor: 'primary.main',
                          // 预览块 = 「选了它面板长什么样」的微缩样张：描边走主色、内部淡染，
                          // 直角档真方、圆角档肉眼可辨；深色档加深淡染保证不糊进 chip 底
                          bgcolor: (theme) =>
                            theme.palette.mode === 'dark'
                              ? 'rgb(var(--template-palette-primary-mainChannel) / 0.3)'
                              : 'rgb(var(--template-palette-primary-mainChannel) / 0.14)',
                          borderRadius: `${radiusBasePx({ borderRadius: opt.id, borderRadiusCustom: themeConfig.borderRadiusCustom })}px`,
                          display: 'inline-block',
                        }}
                      />
                    }
                    label={
                      opt.id === 'custom'
                        ? `${opt.label} ${clampRadiusPx(themeConfig.borderRadiusCustom)}px`
                        : `${opt.label} ${radiusBasePx({ borderRadius: opt.id })}px`
                    }
                    onClick={() => setBorderRadius(opt.id)}
                    color={active ? 'primary' : 'default'}
                    variant={active ? 'filled' : 'outlined'}
                    size="small"
                    sx={{
                      cursor: 'pointer',
                      height: 32,
                      fontWeight: 500,
                      // 未选中给一层极淡灰底，和白抽屉分出层级；选中分支的实心主色照旧覆盖它
                      bgcolor: (theme) =>
                        theme.palette.mode === 'dark'
                          ? 'rgb(var(--template-palette-text-primaryChannel) / 0.06)'
                          : 'rgb(var(--template-palette-text-primaryChannel) / 0.04)',
                      transition: 'background-color .16s, box-shadow .16s, color .16s',
                      ...(active
                        ? {
                            backgroundColor: 'primary.main',
                            color: 'primary.contrastText',
                            boxShadow: (theme) =>
                              theme.palette.mode === 'dark'
                                ? '0 0 0 1.5px rgb(var(--template-palette-primary-lightChannel) / 0.65)'
                                : '0 0 0 1.5px rgb(var(--template-palette-primary-mainChannel) / 0.35)',
                          }
                        : {}),
                    }}
                  />
                );
              })}
            </Box>
            {themeConfig.borderRadius === 'custom' && (
              <Box
                data-testid="radius-custom-slider"
                sx={{
                  mx: 0.5,
                  mt: 1.25,
                  px: 1.5,
                  pt: 0.75,
                  pb: 1,
                  border: 1,
                  borderColor: 'divider',
                  // 容器自身圆角挂档位乘数：切「直角」它当场变方 —— 设置页自己就是圆角的活预览
                  borderRadius: 1.5,
                  bgcolor: (theme) =>
                    theme.palette.mode === 'dark'
                      ? 'rgb(var(--template-palette-text-primaryChannel) / 0.05)'
                      : 'rgb(var(--template-palette-text-primaryChannel) / 0.02)',
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    {t('settings.radiusCustom')}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="primary.main"
                    sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {clampRadiusPx(themeConfig.borderRadiusCustom)}px
                  </Typography>
                </Box>
                <Slider
                  size="small"
                  aria-label={t('settings.radiusCustom')}
                  min={RADIUS_CUSTOM_RANGE.min}
                  max={RADIUS_CUSTOM_RANGE.max}
                  step={RADIUS_CUSTOM_RANGE.step}
                  value={clampRadiusPx(themeConfig.borderRadiusCustom)}
                  valueLabelFormat={(v: number) => `${v}px`}
                  onChange={(_: unknown, v: number | number[]) => setBorderRadiusCustom(Array.isArray(v) ? v[0] : v)}
                />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: -0.25 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {RADIUS_CUSTOM_RANGE.min}px
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {t('settings.radiusCustomHint')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {RADIUS_CUSTOM_RANGE.max}px
                  </Typography>
                </Box>
              </Box>
            )}
          </Section>

          {/* ─── 动效（第二十一轮新增设置项）：消费点 theme/AppTheme.tsx ─── */}
          <Section id="motion" defaultExpanded tuned={(themeConfig.motion ?? 'auto') !== 'auto'}>
            <ToggleButtonGroup
              value={themeConfig.motion ?? 'auto'}
              exclusive
              size="small"
              fullWidth
              onChange={(_: unknown, val: MotionPreference | null) => val && setMotion(val)}
            >
              {getMotionOptions().map((opt) => (
                <ToggleButton
                  key={opt.id}
                  value={opt.id}
                  data-testid={`motion-${opt.id}`}
                  sx={{ textTransform: 'none' }}
                >
                  {opt.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
              {t('settings.motionHint')}
            </Typography>
          </Section>

          {/* ─── 布局与密度：模板 + 四个单项（每个字段都有真实消费点，见 appearanceScales 测试锁） ─── */}
          <Section id="layoutDensity" defaultExpanded tuned={!layoutIsDefault}>
            <FieldLabel>{t('settings.layoutPreset')}</FieldLabel>
            {/* 说清「选模板 = 回到模板态」：不写这一句，用户把已微调的侧栏宽度被重置读成「设置又没记住」 */}
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 0.5 }}>
              {t('settings.layoutPresetHint')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {(
                [
                  { id: 'default' as LayoutPreset, icon: <ViewSidebarIcon />, label: t('settings.layoutStandard') },
                  { id: 'compact' as LayoutPreset, icon: <ViewCompactIcon />, label: t('settings.layoutCompact') },
                  { id: 'wide' as LayoutPreset, icon: <ViewColumnIcon />, label: t('settings.layoutWide') },
                ] as const
              ).map((opt) => (
                <Card
                  key={opt.id}
                  variant="outlined"
                  sx={{
                    flex: 1,
                    cursor: 'pointer',
                    borderColor: layoutConfig.preset === opt.id ? 'primary.main' : 'divider',
                    bgcolor: layoutConfig.preset === opt.id ? 'action.selected' : 'transparent',
                    transition: 'all 0.15s',
                    '&:hover': { borderColor: 'primary.light' },
                  }}
                  onClick={() => applyLayoutPreset(opt.id)}
                >
                  <CardActionArea sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {opt.icon}
                    <Typography variant="caption" sx={{ fontWeight: 500 }}>
                      {opt.label}
                    </Typography>
                  </CardActionArea>
                </Card>
              ))}
            </Box>
            {/* 选了模板后又单独调过某项：诚实说明，而不是把高亮偷偷改回「标准」 */}
            {!isConfigMatchingPreset(layoutConfig) && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label={t('settings.layoutModified')}
                sx={{ height: 20, fontSize: uiFontSize(10), mt: 0.75 }}
              />
            )}

            <FieldLabel>{t('settings.sidebarPosition')}</FieldLabel>
            <ToggleButtonGroup
              value={layoutConfig.sidebarPosition}
              exclusive
              size="small"
              fullWidth
              onChange={(_: unknown, val: SidebarPosition | null) => val && setSidebarPosition(val)}
            >
              <ToggleButton value="left" sx={{ textTransform: 'none' }}>
                {t('settings.sidebarLeft')}
              </ToggleButton>
              <ToggleButton value="right" sx={{ textTransform: 'none' }}>
                {t('settings.sidebarRight')}
              </ToggleButton>
            </ToggleButtonGroup>

            {/* 侧栏折叠开关（第二十轮补）：此前抽屉里只能调宽度，折叠要去抽屉外找按钮，
              而折叠态下宽度滑杆是禁用的 —— 用户被卡在「滑杆灰着却无处解开」这一章里不自洽。 */}
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={layoutConfig.sidebarCollapsed}
                  data-testid="sidebar-collapse-switch"
                  onChange={(e) => setSidebarCollapsed(e.target.checked)}
                />
              }
              label={<Typography variant="caption">{t('settings.sidebarCollapse')}</Typography>}
              sx={{ mt: 0.5, display: 'block' }}
            />
            {layoutConfig.sidebarCollapsed && (
              <Typography variant="caption" color="text.disabled" sx={{ display: 'block', fontSize: uiFontSize(10) }}>
                {t('settings.sidebarCollapseHint', { n: SIDEBAR_COLLAPSED_WIDTH })}
              </Typography>
            )}

            <FieldLabel>
              {t('settings.sidebarWidth')} {layoutConfig.sidebarWidth}px
            </FieldLabel>
            <Box sx={{ px: 1 }}>
              <Slider
                size="small"
                aria-label={t('settings.sidebarWidth')}
                min={SIDEBAR_WIDTH_RANGE.min}
                max={SIDEBAR_WIDTH_RANGE.max}
                step={SIDEBAR_WIDTH_RANGE.step}
                value={Math.min(SIDEBAR_WIDTH_RANGE.max, Math.max(SIDEBAR_WIDTH_RANGE.min, layoutConfig.sidebarWidth))}
                disabled={layoutConfig.sidebarCollapsed}
                valueLabelFormat={(v) => `${v}px`}
                onChange={(_: unknown, v: number | number[]) => setSidebarWidth(Array.isArray(v) ? v[0] : v)}
              />
              {layoutConfig.sidebarCollapsed && (
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center' }}>
                  {t('settings.sidebarWidthCollapsedHint')}
                </Typography>
              )}
            </Box>

            <FieldLabel>{t('settings.navbarStyle')}</FieldLabel>
            <ToggleButtonGroup
              value={layoutConfig.navbarStyle}
              exclusive
              size="small"
              fullWidth
              onChange={(_: unknown, val: NavbarStyle | null) => val && setNavbarStyle(val)}
            >
              <ToggleButton value="standard" sx={{ textTransform: 'none' }}>
                {t('settings.navbarStandard')}
              </ToggleButton>
              <ToggleButton value="slim" sx={{ textTransform: 'none' }}>
                {t('settings.navbarSlim')}
              </ToggleButton>
            </ToggleButtonGroup>

            <FieldLabel>{t('settings.contentPadding')}</FieldLabel>
            <ToggleButtonGroup
              value={layoutConfig.contentPadding}
              exclusive
              size="small"
              fullWidth
              onChange={(_: unknown, val: ContentPadding | null) => val && setContentPadding(val)}
            >
              {(['none', 'small', 'medium', 'large'] as ContentPadding[]).map((k) => (
                <ToggleButton key={k} value={k} sx={{ textTransform: 'none' }}>
                  {t(
                    k === 'none'
                      ? 'settings.padNone'
                      : k === 'small'
                        ? 'settings.padSmall'
                        : k === 'large'
                          ? 'settings.padLarge'
                          : 'settings.padMedium',
                  )}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
              {CONTENT_PADDING_PX[layoutConfig.contentPadding]} · {t('settings.contentPaddingHint')}
            </Typography>

            {/* 内容区宽度（第二十一轮新增设置项）：此前 1700px 上限写死在 App.tsx，
              宽屏想铺开只能改代码 —— 消费点 App.tsx 内容壳，档位表见 appearanceScales */}
            <FieldLabel>{t('settings.contentWidth')}</FieldLabel>
            <ToggleButtonGroup
              value={layoutConfig.contentWidth ?? 'default'}
              exclusive
              size="small"
              fullWidth
              onChange={(_: unknown, val: ContentWidth | null) => val && setContentWidth(val)}
            >
              {getContentWidthOptions().map((opt) => (
                <ToggleButton
                  key={opt.id}
                  value={opt.id}
                  data-testid={`content-width-${opt.id}`}
                  sx={{ textTransform: 'none', flexDirection: 'column', gap: 0.25, py: 0.5 }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 500 }}>
                    {opt.label}
                  </Typography>
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: uiFontSize(9) }}>
                    {opt.cap}
                  </Typography>
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
              {t('settings.contentWidthHint')}
            </Typography>

            {/* 全出血页是否遵循上面两档（第二十七轮，收第 26 轮待办 1）：工作室 / 语料库 / AI 助手
              三页此前**无条件**盖掉内容留白与内容宽度，切档位没反应 = 用户口中的「设置没生效」；
              但无边距是用户三次点名要来的既成事实，不能悄悄改回去。于是把例外摊开成一个开关，
              默认关（观感一字不变），开了三页一并跟随上面两档。消费点 App.tsx 内容壳。 */}
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={layoutConfig.fullBleedFollowsLayout === true}
                  data-testid="full-bleed-follows-layout-switch"
                  onChange={(e) => setFullBleedFollowsLayout(e.target.checked)}
                />
              }
              label={<Typography variant="caption">{t('settings.fullBleedFollowsLayout')}</Typography>}
              sx={{ mt: 1.5, display: 'block' }}
            />
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }}>
              {t('settings.fullBleedFollowsLayoutHint')}
            </Typography>
          </Section>

          {/* ─── 正文默认排版（写作场景）：书级单独调过者仍优先 ─── */}
          {/* tuned 要把书级覆盖算进来（第三十轮 P1）：这一章现在管的正是「默认 + 各书的偏离」，
            只调过某本书而默认没动过的人，折叠标题上也该看得见「本章有非默认值」。 */}
          <Section id="bodyTypography" defaultExpanded={false} tuned={!typographyIsDefault || bookOverrideCount > 0}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {t('settings.bodyTypographyHint')}
            </Typography>

            <FieldLabel>{t('writing.typography.fontSize', { n: typoConfig.fontSize })}</FieldLabel>
            <Box sx={{ px: 1 }}>
              <Slider
                size="small"
                aria-label={t('writing.typography.fontSize', { n: typoConfig.fontSize })}
                min={14}
                max={22}
                step={1}
                value={typoConfig.fontSize}
                valueLabelFormat={(v) => `${v}px`}
                onChange={(_: unknown, v: number | number[]) =>
                  setTypoConfig({ fontSize: Array.isArray(v) ? v[0] : v })
                }
              />
            </Box>

            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                select
                size="small"
                fullWidth
                label={t('writing.typography.fontFamily')}
                value={typoConfig.fontFamily}
                onChange={(e) => setTypoConfig({ fontFamily: e.target.value as FontFamilyKey })}
                slotProps={{ select: { MenuProps: { disableScrollLock: true } } }}
                sx={{ '& .MuiInputLabel-root': { fontSize: uiFontSize(12) } }}
              >
                {FONT_FAMILY_OPTIONS.map((o) => (
                  <MenuItem key={o.key} value={o.key} sx={{ fontSize: uiFontSize(12) }}>
                    {t(`writing.typography.font_${o.key}`)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                fullWidth
                label={t('writing.typography.latinFontFamily')}
                value={typoConfig.latinFontFamily}
                onChange={(e) => setTypoConfig({ latinFontFamily: e.target.value as LatinFontFamilyKey })}
                slotProps={{ select: { MenuProps: { disableScrollLock: true } } }}
                sx={{ '& .MuiInputLabel-root': { fontSize: uiFontSize(12) } }}
              >
                <MenuItem value="system" sx={{ fontSize: uiFontSize(12) }}>
                  {t('writing.typography.latinFont_system')}
                </MenuItem>
                {LATIN_FONT_OPTIONS.map((o) => (
                  <MenuItem key={o.key} value={o.key} sx={{ fontSize: uiFontSize(12) }}>
                    {o.label}
                    <Typography variant="caption" color="text.disabled" sx={{ ml: 0.75 }}>
                      {t(`writing.typography.latinGroup_${o.group}`)}
                    </Typography>
                  </MenuItem>
                ))}
              </TextField>
            </Box>

            <FieldLabel>
              {t('writing.typography.lineHeight')} {typoConfig.lineHeight}
            </FieldLabel>
            <ToggleButtonGroup
              value={typoConfig.lineHeight}
              exclusive
              size="small"
              fullWidth
              onChange={(_: unknown, v: number | null) => v !== null && setTypoConfig({ lineHeight: v })}
            >
              {[1.6, 1.9, 2.2].map((v) => (
                <ToggleButton key={v} value={v} sx={{ textTransform: 'none', fontSize: uiFontSize(12) }}>
                  {v}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <FieldLabel>
              {t('writing.typography.paraSpacing')} {typoConfig.paraSpacing}em
            </FieldLabel>
            <ToggleButtonGroup
              value={typoConfig.paraSpacing}
              exclusive
              size="small"
              fullWidth
              onChange={(_: unknown, v: number | null) => v !== null && setTypoConfig({ paraSpacing: v })}
            >
              {[
                { v: 0, label: t('writing.typography.paraNone') },
                { v: 0.5, label: t('writing.typography.paraSmall') },
                { v: 1, label: t('writing.typography.paraMedium') },
                { v: 1.5, label: t('writing.typography.paraLarge') },
              ].map((o) => (
                <ToggleButton key={o.v} value={o.v} sx={{ textTransform: 'none', fontSize: uiFontSize(12) }}>
                  {o.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <FieldLabel>{t('writing.typography.pageWidth')}</FieldLabel>
            <ToggleButtonGroup
              value={typoConfig.pageWidth}
              exclusive
              size="small"
              fullWidth
              onChange={(_: unknown, v: number | null) => v !== null && setTypoConfig({ pageWidth: v })}
            >
              {[
                { v: 620, label: t('writing.typography.widthNarrow') },
                { v: 760, label: t('writing.typography.widthMedium') },
                { v: 900, label: t('writing.typography.widthWide') },
              ].map((o) => (
                <ToggleButton key={o.v} value={o.v} sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}>
                  {o.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <FieldLabel>{t('writing.typography.paper')}</FieldLabel>
            <ToggleButtonGroup
              value={typoConfig.paper}
              exclusive
              size="small"
              fullWidth
              onChange={(_: unknown, v: 'default' | 'sepia' | 'green' | null) => v && setTypoConfig({ paper: v })}
            >
              <ToggleButton value="default" sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}>
                {t('writing.typography.paperDefault')}
              </ToggleButton>
              <ToggleButton value="sepia" sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}>
                {t('writing.typography.paperSepia')}
              </ToggleButton>
              <ToggleButton value="green" sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}>
                {t('writing.typography.paperGreen')}
              </ToggleButton>
            </ToggleButtonGroup>

            {/* 首行缩进（第二十轮修死控件）：此前只有 checked 没有 onChange —— 受控开关点下去
              纹丝不动（React 还会报 controlled/uncontrolled 警告），属于「设置里看得见但按不动」。 */}
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={typoConfig.indent}
                  data-testid="typography-indent-switch"
                  onChange={(e) => setTypoConfig({ indent: e.target.checked })}
                />
              }
              label={<Typography variant="caption">{t('writing.typography.indent')}</Typography>}
              sx={{ mt: 0.5 }}
            />

            {/* 书级覆盖（第三十轮 P1）：这一域此前根本不在设置库里，而是逐本躺在 localStorage，
              于是「导出备份」从来没有它、写作台调过的排版在设置里既看不见也清不掉。
              现在它与其余设置同一套持久化，抽屉也就必须有这一眼：哪些书单独调过、怎么一次性收回默认。 */}
            <Divider sx={{ my: 1.5 }} />
            <FieldLabel>{t('settings.bookTypographyOverrides')}</FieldLabel>
            <Typography
              variant="caption"
              color={bookOverrideCount > 0 ? 'primary.main' : 'text.disabled'}
              data-testid="settings-book-typography-count"
              sx={{ display: 'block' }}
            >
              {bookOverrideCount > 0
                ? t('settings.bookTypographyOverrideCount', { n: bookOverrideCount })
                : t('settings.bookTypographyNoOverride')}
            </Typography>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.25, lineHeight: 1.5 }}>
              {t('settings.bookTypographyOverrideHint')}
            </Typography>
            {/* 逐本点名（第 32 轮）：只报「N 本」等于没报 —— 作者认不出是哪一本，
                也就没法判断那本书的排版是不是自己有意调过的。 */}
            {bookOverrideRows.length > 0 && (
              <Box
                sx={{
                  mt: 0.75,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.25,
                  maxHeight: 168,
                  overflowY: 'auto',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 'var(--app-radius-base, 6px)',
                  px: 0.75,
                  py: 0.5,
                }}
                data-testid="settings-book-typography-list"
              >
                {bookOverrideRows.map((row) => (
                  <Box
                    key={row.bookId}
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}
                    data-testid={`settings-book-typography-item-${row.bookId}`}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: uiFontSize(11.5),
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={row.title || undefined}
                    >
                      {row.title || t('settings.bookTypographyBookUnknown')}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.disabled"
                      sx={{ flexShrink: 0, fontSize: uiFontSize(10.5) }}
                    >
                      {t('settings.bookTypographyBookFields', { n: row.fieldCount })}
                    </Typography>
                    <Button
                      size="small"
                      data-testid={`settings-book-typography-clear-one-${row.bookId}`}
                      onClick={() => handleClearOneBookTypography(row.bookId, row.title)}
                      sx={{ textTransform: 'none', fontSize: uiFontSize(10.5), minWidth: 0, px: 0.75, flexShrink: 0 }}
                    >
                      {t('settings.bookTypographyClearOne')}
                    </Button>
                  </Box>
                ))}
              </Box>
            )}
            {bookOverrideCount > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.75 }}>
                <Button
                  size="small"
                  color="warning"
                  variant={confirmClearBooks ? 'contained' : 'outlined'}
                  data-testid="settings-book-typography-clear"
                  onClick={() => (confirmClearBooks ? handleClearAllBookTypography() : setConfirmClearBooks(true))}
                  sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}
                >
                  {confirmClearBooks ? t('ui.confirm') : t('settings.bookTypographyClearAll')}
                </Button>
                {confirmClearBooks && (
                  <Button
                    size="small"
                    data-testid="settings-book-typography-clear-cancel"
                    onClick={() => setConfirmClearBooks(false)}
                    sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}
                  >
                    {t('ui.cancel')}
                  </Button>
                )}
              </Box>
            )}
            {confirmClearBooks && (
              <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
                {t('settings.bookTypographyClearAllConfirm')}
              </Typography>
            )}
          </Section>

          {/* ─── 写作偏好（第二十五轮）：写作台怎么替创作者干活 ───
            第 24 轮把这一域的 store、落盘、跨窗口链路都建好了，但抽屉里没有入口、消费点也没读它，
            等于一项「看不见也按不动」的设置。本轮补上入口，并把写作台的三处读数接到同一 store。 */}
          <Section
            id="writingPrefs"
            defaultExpanded={false}
            tuned={!writingIsDefault}
            summaryTestId="writing-prefs-summary"
          >
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {t('settings.writingPrefsHint')}
            </Typography>

            <FieldLabel>{t('settings.deskFocusMode')}</FieldLabel>
            <ToggleButtonGroup
              value={writingPrefs.focusMode}
              exclusive
              size="small"
              fullWidth
              aria-label={t('settings.deskFocusMode')}
              onChange={(_: unknown, v: DeskFocusMode | null) => v && setDeskFocusMode(v)}
            >
              {getDeskFocusOptions().map((o) => (
                <ToggleButton
                  key={o.id}
                  value={o.id}
                  data-testid={`settings-desk-focus-${o.id}`}
                  sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}
                >
                  {o.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
              {t('settings.deskFocusHint')}
            </Typography>

            <FieldLabel>{t('settings.typewriterScroll')}</FieldLabel>
            <ToggleButtonGroup
              value={writingPrefs.typewriterScroll}
              exclusive
              size="small"
              fullWidth
              aria-label={t('settings.typewriterScroll')}
              onChange={(_: unknown, v: TypewriterScroll | null) => v && setTypewriterScroll(v)}
            >
              {getTypewriterOptions().map((o) => (
                <ToggleButton
                  key={o.id}
                  value={o.id}
                  data-testid={`settings-typewriter-${o.id}`}
                  sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}
                >
                  {o.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
              {t('settings.typewriterHint')}
            </Typography>

            <FieldLabel>{t('settings.saveCadence')}</FieldLabel>
            <ToggleButtonGroup
              value={writingPrefs.saveCadence}
              exclusive
              size="small"
              fullWidth
              aria-label={t('settings.saveCadence')}
              onChange={(_: unknown, v: SaveCadence | null) => v && setSaveCadence(v)}
            >
              {getSaveCadenceOptions().map((o) => (
                <ToggleButton
                  key={o.id}
                  value={o.id}
                  data-testid={`settings-save-cadence-${o.id}`}
                  sx={{ textTransform: 'none', fontSize: uiFontSize(11) }}
                >
                  {o.label} · {o.ms}ms
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
              {t('settings.saveCadenceHint')}
            </Typography>
          </Section>

          {/* ─── 成品作品库根目录（完结作品重设计 B3）─── */}
          <Section id="worksLibrary" defaultExpanded={false}>
            <SettingsWorksLibrarySection />
          </Section>

          {/* ─── 设置备份与恢复（第二十一轮新增能力）─── */}
          <Section id="backup" defaultExpanded={false}>
            {<SettingsBackupSection />}
          </Section>

          {/* ─── 恢复默认：主题 + 布局 + 正文默认排版一起复位 ─── */}
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
            <Button
              variant="outlined"
              size="small"
              color="warning"
              startIcon={<RestartAltIcon sx={{ fontSize: uiFontSize(15) }} />}
              onClick={() => setResetConfirmOpen(true)}
              data-testid="settings-reset-all"
              sx={{ textTransform: 'none', fontSize: uiFontSize(12) }}
            >
              {t('settings.resetAll')}
            </Button>
          </Box>
        </SectionSearchContext.Provider>
      </Box>

      {/* 设置库健康提示（第二十一轮）：只在「可能记不住」时出现，正常时不占位 */}
      <SettingsHealthNotice />

      {/* 底部栏：即时生效说明（自动保存）+ 明确关闭出口（替代原假「确认设置」死控件） */}
      <Box
        sx={{
          p: 1.5,
          borderTop: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          flexShrink: 0,
        }}
      >
        {/* 落盘状态（第二十轮）：写库失败时那句「自动保存」是不诚实的提示 —— 换成真实读数：
            写入中 / 已保存到几点（可核对）/ 失败并给一次重放入口（重放最后一次想写的值）。
            idle = 本次启动还没改过任何设置，仍用原 autoSaveNote 说明「即时生效、无需手动保存」。 */}
        {syncState.status === 'failed' ? (
          <>
            <Typography
              variant="caption"
              color="warning.main"
              data-testid="settings-sync-status"
              sx={{ lineHeight: 1.4, minWidth: 0 }}
            >
              <SyncProblemIcon sx={{ fontSize: uiFontSize(14), verticalAlign: '-2px', mr: 0.5 }} />
              {t('settings.syncFailedNote')}
            </Typography>
            <Button
              size="small"
              onClick={retryFailedWrites}
              data-testid="settings-sync-retry"
              sx={{ textTransform: 'none', fontSize: uiFontSize(11), flexShrink: 0 }}
            >
              {t('settings.syncRetry')}
            </Button>
          </>
        ) : syncState.status === 'pending' ? (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="settings-sync-status"
            sx={{ lineHeight: 1.4 }}
          >
            <SyncIcon sx={{ fontSize: uiFontSize(14), verticalAlign: '-2px', mr: 0.5 }} />
            {t('settings.syncPendingNote')}
          </Typography>
        ) : syncState.status === 'saved' ? (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="settings-sync-status"
            sx={{ lineHeight: 1.4 }}
          >
            <CloudDoneIcon sx={{ fontSize: uiFontSize(14), verticalAlign: '-2px', mr: 0.5 }} />
            {t('settings.syncSavedNote', { time: savedTimeText })}
          </Typography>
        ) : (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="settings-sync-status"
            sx={{ lineHeight: 1.4 }}
          >
            <CheckCircleIcon sx={{ fontSize: uiFontSize(13), color: 'success.main', verticalAlign: '-2px', mr: 0.5 }} />
            {t('settings.autoSaveNote')}
          </Typography>
        )}
        <Button
          variant="contained"
          size="small"
          onClick={onClose}
          sx={{ textTransform: 'none', fontSize: uiFontSize(12), flexShrink: 0 }}
        >
          {t('settings.close')}
        </Button>
      </Box>
      {/* 恢复默认二次确认（第二十一轮）：一键复位三个域，误点成本明显高于其它设置项 */}
      <Dialog open={resetConfirmOpen} onClose={() => setResetConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: uiFontSize(15), fontWeight: 700 }}>{t('settings.resetConfirmTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t('settings.resetConfirmBody')}
          </Typography>
          <List dense sx={{ py: 0 }}>
            {[
              t('settings.resetConfirmTheme'),
              t('settings.resetConfirmLayout'),
              t('settings.resetConfirmTypography'),
              t('settings.resetConfirmWriting'),
            ].map((line) => (
              <ListItem key={line} disableGutters sx={{ display: 'flex', gap: 1, py: 0.25 }}>
                <ListItemIcon sx={{ minWidth: 0 }}>
                  <RestartAltIcon sx={{ fontSize: uiFontSize(14), color: 'warning.main' }} />
                </ListItemIcon>
                <ListItemText primary={<Typography variant="caption">{line}</Typography>} />
              </ListItem>
            ))}
          </List>
          {/* 四个域当前都还是默认值时说实话：点下去什么也不会变。
              判据与各章节「已微调」标记同源（各 store 的 isXxxDefault / isConfigMatchingPreset），
              不另写一份「看起来一样」的比较。 */}
          {/* 边界要说清（第三十轮 P1）：书级排版也是设置的一部分，但它是一本一本调出来的资产，
            不在这颗按钮的覆盖面里。不写这一句，用户会以为「恢复默认」把各本书的单独排版也清掉了
            （或反过来，清不掉时读成「这个按钮没生效」）。 */}
          <Typography
            variant="caption"
            color="text.disabled"
            data-testid="settings-reset-book-note"
            sx={{ display: 'block', mt: 1, lineHeight: 1.5 }}
          >
            {t('settings.resetConfirmBookNote')}
          </Typography>
          {themeIsDefault && layoutIsDefault && typographyIsDefault && writingIsDefault && (
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="settings-reset-nothing-tuned"
              sx={{ display: 'block', mt: 1 }}
            >
              {t('settings.resetNothingTuned')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            size="small"
            onClick={() => setResetConfirmOpen(false)}
            data-testid="settings-reset-cancel"
            sx={{ textTransform: 'none', fontSize: uiFontSize(12) }}
          >
            {t('ui.cancel')}
          </Button>
          <Button
            size="small"
            variant="contained"
            color="warning"
            onClick={handleResetConfirmed}
            data-testid="settings-reset-confirm"
            sx={{ textTransform: 'none', fontSize: uiFontSize(12) }}
          >
            {t('ui.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Drawer>
  );
}
