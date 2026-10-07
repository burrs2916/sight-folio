//! 语料库统一分类与标签清单（后端白名单单一事实源）。
//!
//! 与前端 `src/utils/librarySchema.ts` 保持双端一致，改动必须同步。
//! - 分类为单选枚举（30 项，可留空 = 未分类）；
//! - 标签为多选枚举（28 项四组，0~N 项）；
//! - 枚举值即存储值：分类写入 `corpus_books.category` 镜像（顿号串），标签写入
//!   `corpus_book_tags` 真源表；不引入额外映射编码，检索 / FTS / 统计口径零变化。
//! - 分类集合与标签集合互不相交，可正交组合（下方单测断言）。
//!
//! 校验策略：导入 / 更新命令入口对分类与标签做白名单校验，超集值**拒绝**并返回
//! 明确错误（不静默改写、不归并兜底），保证「枚举值即存储值」不被绕过 UI 的手写值破坏。

use crate::error::{AppError, AppResult};

/// 统一分类清单（30 项，单选，顺序 = 展示顺序）。
pub const CORPUS_CATEGORIES: [&str; 30] = [
    "玄幻",
    "奇幻",
    "仙侠",
    "武侠",
    "都市",
    "历史",
    "科幻",
    "悬疑推理",
    "恐怖灵异",
    "言情",
    "军事",
    "竞技游戏",
    "轻小说",
    "现实",
    "散文随笔",
    "诗歌",
    "同人衍生",
    "纯文学",
    "童书绘本",
    "漫画图像",
    "戏剧影视",
    "传记纪实",
    "商业经管",
    "科普新知",
    "社科人文",
    "艺术设计",
    "教育参考",
    "生活健康",
    "法律政治",
    "其他",
];

/// 统一标签清单（28 项，多选，按四组拍平：风格基调 7 / 叙事元素 7 / 题材元素 7 / 参考维度 7）。
pub const CORPUS_TAGS: [&str; 28] = [
    // 风格基调
    "热血",
    "爽文",
    "轻松",
    "治愈",
    "沉重",
    "黑暗",
    "文艺",
    // 叙事元素
    "系统流",
    "无限流",
    "重生",
    "穿越",
    "种田",
    "群像",
    "单元剧",
    // 题材元素
    "末世",
    "科幻机甲",
    "魔法学院",
    "权谋宫廷",
    "商战职场",
    "校园青春",
    "民俗怪谈",
    // 参考维度
    "文笔",
    "节奏",
    "人设",
    "世界观",
    "对话",
    "战斗",
    "情感范本",
];

/// 分类白名单校验：空串 = 未分类（允许）；非空必须命中 30 项枚举，否则拒绝。
pub fn validate_category(category: &str) -> AppResult<()> {
    if !category.is_empty() && !CORPUS_CATEGORIES.contains(&category) {
        return Err(AppError::Validation(format!(
            "invalid corpus category: {category:?} (allowed: one of {} predefined categories)",
            CORPUS_CATEGORIES.len()
        )));
    }
    Ok(())
}

/// 标签白名单校验：逐项必须命中 28 项枚举，否则拒绝（不静默改写、不归并兜底）。
pub fn validate_tags(tags: &[String]) -> AppResult<()> {
    if let Some(bad) = tags.iter().find(|t| !CORPUS_TAGS.contains(&t.as_str())) {
        return Err(AppError::Validation(format!(
            "invalid corpus tag: {bad:?} (allowed: one of {} predefined tags)",
            CORPUS_TAGS.len()
        )));
    }
    Ok(())
}

/// 合并分类（单选，可空）与标签（多选）为入库顿号串，分类在前。
/// 与仓储层 `split_tags` / `join_tags` 的格式化口径一致，双写路径不变。
pub fn merge_category_tags(category: &str, tags: &[String]) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(tags.len() + 1);
    if !category.is_empty() {
        parts.push(category.to_owned());
    }
    parts.extend(tags.iter().cloned());
    parts.join("、")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_and_tag_enums_are_disjoint() {
        // 分类与标签必须互不相交，前端 chip 单选/多选才能正交组合、回填不歧义。
        let cats: std::collections::HashSet<&str> = CORPUS_CATEGORIES.iter().copied().collect();
        assert_eq!(cats.len(), CORPUS_CATEGORIES.len(), "categories must be unique");
        for tag in CORPUS_TAGS {
            assert!(
                !cats.contains(tag),
                "tag {tag:?} collides with a category; enums must stay disjoint"
            );
        }
    }

    #[test]
    fn enum_sizes_are_stable() {
        assert_eq!(CORPUS_CATEGORIES.len(), 30);
        assert_eq!(CORPUS_TAGS.len(), 28);
        // 按四组 7×7×7×7 定义拍平（组序：风格基调/叙事元素/题材元素/参考维度）。
        assert_eq!(&CORPUS_TAGS[0..7], &["热血", "爽文", "轻松", "治愈", "沉重", "黑暗", "文艺"]);
        assert_eq!(CORPUS_TAGS[7], "系统流");
        assert_eq!(CORPUS_TAGS[14], "末世");
        assert_eq!(CORPUS_TAGS[21], "文笔");
    }

    #[test]
    fn validate_category_accepts_only_empty_or_enum() {
        assert!(validate_category("").is_ok());
        assert!(validate_category("玄幻").is_ok());
        assert!(validate_category("其他").is_ok());
        let err = validate_category("玄幻小说").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err.to_string().contains("invalid corpus category"));
    }

    #[test]
    fn validate_tags_accepts_only_enum_members() {
        assert!(validate_tags(&[]).is_ok());
        assert!(validate_tags(&["热血".to_string(), "群像".to_string()]).is_ok());
        let err = validate_tags(&["热血".to_string(), "自定义标签".to_string()]).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err.to_string().contains("invalid corpus tag"));
    }

    #[test]
    fn merge_puts_category_first_with_dun_separators() {
        assert_eq!(merge_category_tags("", &[]), "");
        assert_eq!(merge_category_tags("玄幻", &[]), "玄幻");
        assert_eq!(merge_category_tags("", &["热血".to_string()]), "热血");
        assert_eq!(
            merge_category_tags("玄幻", &["热血".to_string(), "群像".to_string()]),
            "玄幻、热血、群像"
        );
    }
}