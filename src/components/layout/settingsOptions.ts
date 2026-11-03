// 设置档位表（第二十六轮从 SettingsDrawer 抽出为共享模块）
//
// 为什么抽出来：写作台独立窗口（desk=1）要补一个精简设置面板（第 25 轮待办 2），
// 它和主抽屉必须共用同一份「档位 → 标签 / 真实数值」定义 —— 否则两处会漂成
// 「抽屉能选三档、写作台只有两档」这种新的「设置不完整」。抽屉自己的章节搜索
// 也读这份表（关键词 = 档位标签），所以它同样是搜索命中的数据来源之一。
//
// 铁律沿用：含 t() 的数据定义一律放函数体内（模块级 const 会在加载时固化，切语言不刷新）。
import { t } from '../../i18n';
import { PRESET_ORDER, getPresetSwatch } from '../../theme/themePresets';
import {
  CONTENT_MAX_WIDTH_PX,
  CONTENT_WIDTH_OPTIONS,
  FONT_SIZE_BASE,
  MOTION_OPTIONS,
  UI_FONT_OPTIONS,
  UI_FONT_STACKS,
} from '../../theme/appearanceScales';
import {
  FOCUS_MODE_OPTIONS,
  SAVE_CADENCE_MS,
  SAVE_CADENCE_OPTIONS,
  TYPEWRITER_OPTIONS,
} from '../../store/writingPrefsStore';
import type { DeskFocusMode, SaveCadence, TypewriterScroll } from '../../store/writingPrefsStore';
import type { BorderRadius, FontSize, MotionPreference, ThemePreset, UiFontFamily } from '../../store/themeStore';
import type { ContentWidth } from '../../store/layoutStore';

/** 主题预设的 i18n label key（只存 key，不存 t() 结果 —— 见下方铁律说明） */
const PRESET_LABEL_KEYS: Record<ThemePreset, string> = {
  default: 'settings.presetDefault',
  blue: 'settings.presetBlue',
  green: 'settings.presetGreen',
  orange: 'settings.presetOrange',
  purple: 'settings.presetPurple',
  indigo: 'settings.presetIndigo',
  teal: 'settings.presetTeal',
  rose: 'settings.presetRose',
  slate: 'settings.presetSlate',
  custom: 'settings.presetCustom',
};

// 铁律：含 t() 的数据定义必须放函数体内/getter（模块级 const 会在加载时固化，切语言不刷新）。
// 色卡颜色从 preset 注册表（theme/themePresets.ts）派生，与主题实际生效值同源，
// 避免「色卡显示蓝色 #1976D2、实际生效品牌紫 #4a338f」的错位（历史 bug）。
export function getThemePresets(customPrimary?: string): { id: ThemePreset; label: string; color: string }[] {
  return PRESET_ORDER.map((id) => ({
    id,
    label: t(PRESET_LABEL_KEYS[id]),
    color: getPresetSwatch(id, customPrimary),
  }));
}

/** 字号档位：标签 + 真实生效基准 px（此前预览写 11/13/15px，与实际 13/14/16 不一致） */
export function getFontSizeOptions(): { id: FontSize; label: string; px: number }[] {
  return (['small', 'medium', 'large'] as FontSize[]).map((id) => ({
    id,
    label: t(id === 'small' ? 'settings.fontSmall' : id === 'large' ? 'settings.fontLarge' : 'settings.fontMedium'),
    px: FONT_SIZE_BASE[id],
  }));
}

export function getBorderRadiusOptions(): { id: BorderRadius; label: string }[] {
  // 2026-11-03 档位改版：撤「大圆 / 全圆」，增「自定义」（数值档，范围见 RADIUS_CUSTOM_RANGE）
  const keys: Record<BorderRadius, string> = {
    none: 'settings.radiusNone',
    small: 'settings.radiusSmall',
    medium: 'settings.radiusMedium',
    custom: 'settings.radiusCustom',
  };
  return (Object.keys(keys) as BorderRadius[]).map((id) => ({ id, label: t(keys[id]) }));
}

/** 动效档位（第二十一轮）：auto 跟随系统，reduce 应用内一律压缩非必要动效 */
export function getMotionOptions(): { id: MotionPreference; label: string }[] {
  const keys: Record<MotionPreference, string> = {
    auto: 'settings.motionAuto',
    reduce: 'settings.motionReduce',
  };
  return MOTION_OPTIONS.map((id) => ({ id, label: t(keys[id]) }));
}

/** 内容区宽度档位（第二十一轮）：标注真实上限，别让人猜「宽」到底是几像素 */
export function getContentWidthOptions(): { id: ContentWidth; label: string; cap: string }[] {
  const keys: Record<ContentWidth, string> = {
    narrow: 'settings.contentWidthNarrow',
    default: 'settings.contentWidthStandard',
    wide: 'settings.contentWidthWide',
    full: 'settings.contentWidthFull',
  };
  return CONTENT_WIDTH_OPTIONS.map((id) => ({
    id,
    label: t(keys[id]),
    cap: CONTENT_MAX_WIDTH_PX[id] === 'none' ? t('settings.contentWidthNoCap') : CONTENT_MAX_WIDTH_PX[id],
  }));
}

/**
 * 界面字体档位（第二十三轮）：字体栈取自单一真源，预览直接用同一条栈 —— 所见即所得，
 * 不让人靠名字猜「sans 到底是哪支字」。
 */
export function getUiFontOptions(): { id: UiFontFamily; label: string; stack: string }[] {
  const keys: Record<UiFontFamily, string> = {
    system: 'settings.uiFontSystem',
    sans: 'settings.uiFontSans',
    serif: 'settings.uiFontSerif',
    mono: 'settings.uiFontMono',
  };
  return UI_FONT_OPTIONS.map((id) => ({ id, label: t(keys[id]), stack: UI_FONT_STACKS[id] }));
}

/**
 * 写作偏好三档（第二十五轮接通：抽屉里终于有了入口）。
 * 档位表取自 store 的单一真源（FOCUS_MODE_OPTIONS / TYPEWRITER_OPTIONS / SAVE_CADENCE_OPTIONS），
 * 抽屉能选的与归一化认的永远是同一份，不会再出现「这里能选、那边不认」的假生效。
 */
export function getDeskFocusOptions(): { id: DeskFocusMode; label: string }[] {
  const keys: Record<DeskFocusMode, string> = {
    normal: 'settings.deskFocusNormal',
    focus: 'settings.deskFocusFocus',
    zen: 'settings.deskFocusZen',
  };
  return FOCUS_MODE_OPTIONS.map((id) => ({ id, label: t(keys[id]) }));
}

export function getTypewriterOptions(): { id: TypewriterScroll; label: string }[] {
  const keys: Record<TypewriterScroll, string> = {
    off: 'settings.typewriterOff',
    zen: 'settings.typewriterZen',
    always: 'settings.typewriterAlways',
  };
  return TYPEWRITER_OPTIONS.map((id) => ({ id, label: t(keys[id]) }));
}

/** 保存节奏标注真实毫秒数：别让人猜「稳健」到底是多久 */
export function getSaveCadenceOptions(): { id: SaveCadence; label: string; ms: number }[] {
  const keys: Record<SaveCadence, string> = {
    fast: 'settings.saveCadenceFast',
    standard: 'settings.saveCadenceStandard',
    steady: 'settings.saveCadenceSteady',
  };
  return SAVE_CADENCE_OPTIONS.map((id) => ({ id, label: t(keys[id]), ms: SAVE_CADENCE_MS[id] }));
}

/** 主题预设 id → 本地化 label（Chip 展示 profile.theme.preset 用） */
export function presetLabel(id: string): string {
  const found = getThemePresets().find((p) => p.id === id);
  return found?.label ?? id;
}

/**
 * 抽屉章节的 id（第二十六轮）：搜索过滤、展开态、已微调标记都以它为键。
 * 顺序即抽屉里的展示顺序（见 getSectionIndex）。
 */
export type SettingsSectionId =
  | 'appearancePreset'
  | 'language'
  | 'colorMode'
  | 'themeColor'
  | 'fontSize'
  | 'uiFont'
  | 'borderRadius'
  | 'motion'
  | 'layoutDensity'
  | 'bodyTypography'
  | 'writingPrefs'
  | 'worksLibrary'
  | 'backup';

/**
 * 章节清单（第二十六轮）：抽屉已有 12 个章节，「搜索定位」与「哪一章被改过」都需要
 * 一份**唯一**的章节元数据。标题与关键词只在这里声明一次：
 *  - Section 按 id 反查标题来渲染标题（避免同一章节两处写文案，改一处漏一处）；
 *  - 搜索框按同一份关键词过滤，抽屉据此判断「一个都没命中」并给空态；
 *  - 「已微调」标记的判据由调用点传（各域的默认值口径不同，见各 store 的 isXxxDefault）。
 * 关键词刻意包含**档位名**（如「打字机」「米黄」「禅模式」），因为创作者搜的是概念，
 * 不是章节标题里那几个字 —— 只有标题可搜等于没得搜。
 * 含 t() 的取值一律在函数体内做（模块级 const 会在加载时固化，切语言不刷新）。
 */
export function getSectionIndex(): { id: SettingsSectionId; title: string; keywords: string[] }[] {
  return [
    {
      id: 'appearancePreset',
      title: t('settings.appearancePreset'),
      keywords: [
        t('settings.saveAsPreset'),
        t('settings.updatePreset'),
        t('settings.renamePreset'),
        t('settings.deletePreset'),
        t('settings.revertPreset'),
        t('settings.presetModified'),
        t('settings.customPresetTag'),
        t('settings.presetWithTypography'),
      ],
    },
    {
      id: 'language',
      title: t('settings.language'),
      keywords: [t('settings.langZh'), t('settings.langEn'), t('settings.languageHint'), '中文', 'English'],
    },
    {
      id: 'colorMode',
      title: t('settings.colorMode'),
      keywords: [t('settings.modeLight'), t('settings.modeDark'), t('settings.modeSystem'), 'light', 'dark', 'system'],
    },
    {
      id: 'themeColor',
      title: t('settings.themeColor'),
      keywords: [t('settings.customPrimary'), ...getThemePresets().map((p) => p.label)],
    },
    {
      id: 'fontSize',
      title: t('settings.fontSize'),
      keywords: [
        t('settings.fontSmall'),
        t('settings.fontMedium'),
        t('settings.fontLarge'),
        // 代码编辑器字号（第三十六轮）住在这一章里：搜「代码 / code」要能翻到它，
        // 否则这一维在搜索上等于不存在（用户只会以为设置里没有）
        t('settings.codeFontSize'),
        t('settings.codeFontSizeHint'),
        t('settings.codeFontSizeReset'),
        'small',
        'medium',
        'large',
        'code',
      ],
    },
    {
      id: 'uiFont',
      title: t('settings.uiFont'),
      keywords: [t('settings.uiFontHint'), ...getUiFontOptions().map((o) => o.id)],
    },
    {
      id: 'borderRadius',
      title: t('settings.borderRadius'),
      keywords: [
        t('settings.radiusNone'),
        t('settings.radiusSmall'),
        t('settings.radiusMedium'),
        t('settings.radiusCustom'),
      ],
    },
    {
      id: 'motion',
      title: t('settings.motion'),
      keywords: [t('settings.motionAuto'), t('settings.motionReduce'), t('settings.motionHint')],
    },
    {
      id: 'layoutDensity',
      title: t('settings.layoutDensity'),
      keywords: [
        t('settings.layoutStandard'),
        t('settings.layoutCompact'),
        t('settings.layoutWide'),
        t('settings.sidebarPosition'),
        t('settings.sidebarLeft'),
        t('settings.sidebarRight'),
        t('settings.sidebarWidth'),
        t('settings.sidebarCollapse'),
        t('settings.navbarStyle'),
        t('settings.navbarStandard'),
        t('settings.navbarSlim'),
        t('settings.contentPadding'),
        t('settings.contentWidth'),
        t('settings.layoutModified'),
      ],
    },
    {
      id: 'bodyTypography',
      title: t('settings.bodyTypography'),
      keywords: [
        t('settings.bodyTypographyHint'),
        // 书级覆盖（第三十轮 P1）：搜「书级 / 覆盖 / 单独调过」要能找到这一章里的清空白口
        t('settings.bookTypographyOverrides'),
        t('settings.bookTypographyClearAll'),
        t('settings.bookTypographyOverrideHint'),
        t('writing.typography.overrideOn', { n: 1 }),
        t('writing.typography.followDefaultNow'),
        t('writing.typography.fontSize'),
        t('writing.typography.lineHeight'),
        t('writing.typography.paraSpacing'),
        t('writing.typography.fontFamily'),
        t('writing.typography.latinFontFamily'),
        t('writing.typography.indent'),
        t('writing.typography.pageWidth'),
        t('writing.typography.paper'),
        t('writing.typography.paperSepia'),
        t('writing.typography.paperGreen'),
      ],
    },
    {
      id: 'writingPrefs',
      title: t('settings.writingPrefs'),
      keywords: [
        t('settings.writingPrefsHint'),
        t('settings.deskFocusMode'),
        t('settings.deskFocusNormal'),
        t('settings.deskFocusFocus'),
        t('settings.deskFocusZen'),
        t('settings.typewriterScroll'),
        t('settings.typewriterOff'),
        t('settings.typewriterZen'),
        t('settings.typewriterAlways'),
        t('settings.saveCadence'),
        t('settings.saveCadenceFast'),
        t('settings.saveCadenceStandard'),
        t('settings.saveCadenceSteady'),
        // 语言中立的档位 id 一并进关键词：中文界面下搜「zen」也该找得到这一章
        ...FOCUS_MODE_OPTIONS,
        ...TYPEWRITER_OPTIONS,
        ...SAVE_CADENCE_OPTIONS,
      ],
    },
    {
      id: 'worksLibrary',
      title: t('settings.worksLibrary'),
      keywords: [
        t('settings.worksLibraryHint'),
        t('settings.worksLibraryChange'),
        t('settings.worksLibraryCurrent'),
        t('settings.worksLibraryDefaultTag'),
      ],
    },
    {
      id: 'backup',
      title: t('settings.backup'),
      keywords: [t('settings.backupHint'), t('settings.backupExport'), t('settings.backupImportFile')],
    },
  ];
}

/** 搜索命中判定：标题或任一关键词包含即算命中（大小写不敏感、首尾空白忽略） */
export function matchesSectionQuery(query: string, title: string, keywords: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [title, ...keywords].some((text) => text.toLowerCase().includes(q));
}
