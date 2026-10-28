//! 解析器能力查询命令（R45：前后端能力联动）
//!
//! 前端激活分析器插件时不再依赖自己声明的 capabilities（历史：vue 声明
//! dependencyAnalysis:true 但后端无实现），而是向本命令查询后端 ParserRegistry
//! 的真实能力矩阵，按「后端实际支持」对齐激活与展示。
//!
//! 单一事实源：后端 parser 注册表（parser::registry()）的能力声明。
//! 前端 manifest 仅提供展示名/图标/规则等 UI 元数据，能力以这里为准。

use crate::parser::{registry, ParserCapabilities};

/// 后端真实能力矩阵（JSON 序列化结构）
#[derive(serde::Serialize)]
pub struct LanguageCapability {
    /// 语言 id（小写）
    pub language: String,
    pub symbols: bool,
    pub deps: bool,
    pub symbol_refs: bool,
    pub ast: bool,
}

impl From<(&'static str, ParserCapabilities)> for LanguageCapability {
    fn from((lang, caps): (&'static str, ParserCapabilities)) -> Self {
        Self {
            language: lang.to_string(),
            symbols: caps.symbols,
            deps: caps.deps,
            symbol_refs: caps.symbol_refs,
            ast: caps.ast,
        }
    }
}

/// 查询后端全部语言解析器的真实能力矩阵。
/// 前端在插件激活 / PluginSelector 展示时调用，按此对齐能力声明。
#[tauri::command]
pub fn list_parser_capabilities(_app: tauri::AppHandle) -> Vec<LanguageCapability> {
    let r = registry();
    r.language_ids()
        .into_iter()
        .filter_map(|lang| r.capabilities_of(lang).map(|caps| (lang, caps)))
        .map(LanguageCapability::from)
        .collect()
}

/// 查询指定语言的后端能力（前端激活单个插件前校验用）。
#[tauri::command]
pub fn parser_capability_for(language: String) -> Option<LanguageCapability> {
    let r = registry();
    let caps = r.capabilities_of(&language)?;
    // capabilities_of 能取到说明 get 必然命中（同一 lookup 逻辑）
    let id = r.get(&language)?.id(); // &'static str，无生命周期问题
    Some(LanguageCapability::from((id, caps)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_roundtrip() {
        let caps = ParserCapabilities {
            symbols: true,
            deps: true,
            symbol_refs: true,
            ast: true,
        };
        let lc: LanguageCapability = ("typescript", caps).into();
        assert!(lc.symbols && lc.deps && lc.symbol_refs && lc.ast);
        assert_eq!(lc.language, "typescript");
    }
}
