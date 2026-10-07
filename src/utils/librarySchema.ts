// 语料库统一分类与标签清单（前端单一事实源）
//
// 铁律合规：
// - 枚举值即存储值：分类写入 corpus_books.category 镜像（顿号串），标签写入
//   corpus_book_tags 真源表；不引入额外映射编码，保证检索（category LIKE）、
//   FTS 与存量统计口径零变化。
// - 分类为单选枚举（30 项，可留空 = 未分类）；标签为多选枚举（28 项四组，0~N 项）。
// - 与后端 src-tauri/src/domain/corpus/schema.rs 保持双端一致，改动必须同步。
// - 分类集合与标签集合互不相交，可正交组合（由 __tests__/librarySchema.test.ts 断言）。

/** 统一分类清单（30 项，单选，顺序 = 展示顺序）。 */
export const CORPUS_CATEGORIES: string[] = [
  '玄幻',
  '奇幻',
  '仙侠',
  '武侠',
  '都市',
  '历史',
  '科幻',
  '悬疑推理',
  '恐怖灵异',
  '言情',
  '军事',
  '竞技游戏',
  '轻小说',
  '现实',
  '散文随笔',
  '诗歌',
  '同人衍生',
  '纯文学',
  '童书绘本',
  '漫画图像',
  '戏剧影视',
  '传记纪实',
  '商业经管',
  '科普新知',
  '社科人文',
  '艺术设计',
  '教育参考',
  '生活健康',
  '法律政治',
  '其他',
];

export interface CorpusTagGroupDef {
  /** 分组稳定标识（用于渲染 key） */
  key: string;
  /** 分组标题的 i18n key（组件内 t(labelKey) 渲染） */
  labelKey: string;
  tags: string[];
}

/** 统一标签清单（28 项，多选，四组各 7 项）。 */
export const CORPUS_TAG_GROUPS: CorpusTagGroupDef[] = [
  { key: 'tone', labelKey: 'library.tagGroupTone', tags: ['热血', '爽文', '轻松', '治愈', '沉重', '黑暗', '文艺'] },
  {
    key: 'narrative',
    labelKey: 'library.tagGroupNarrative',
    tags: ['系统流', '无限流', '重生', '穿越', '种田', '群像', '单元剧'],
  },
  {
    key: 'theme',
    labelKey: 'library.tagGroupTheme',
    tags: ['末世', '科幻机甲', '魔法学院', '权谋宫廷', '商战职场', '校园青春', '民俗怪谈'],
  },
  {
    key: 'reference',
    labelKey: 'library.tagGroupReference',
    tags: ['文笔', '节奏', '人设', '世界观', '对话', '战斗', '情感范本'],
  },
];

/** 全部标签（28 项，拍平，后端白名单与前端 chip 渲染共用此集合）。 */
export const CORPUS_ALL_TAGS: string[] = CORPUS_TAG_GROUPS.flatMap((g) => g.tags);

const CORPUS_CATEGORY_SET: ReadonlySet<string> = new Set(CORPUS_CATEGORIES);
const CORPUS_TAG_SET: ReadonlySet<string> = new Set(CORPUS_ALL_TAGS);

/** 是否属于统一分类枚举（单选域）。 */
export function isCorpusCategory(value: string): boolean {
  return CORPUS_CATEGORY_SET.has(value);
}

/** 是否属于统一标签枚举（多选域）。 */
export function isCorpusTag(value: string): boolean {
  return CORPUS_TAG_SET.has(value);
}
