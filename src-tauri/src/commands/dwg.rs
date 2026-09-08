// project-sight: DWG 元数据解析（v2.16）
//
// 真实世界的 CAD 资产是 AutoCAD 的 `.dwg` 文件（不是自造的 cadbin）。
// 用 acadrust（EdgeView 已验证的 DWG 解析库，Cargo.toml 已依赖）提取
// 项目分析用的元数据：实体总数 / 类型分布 / 图层数 / 包围盒 ——
// 供详情面板「CAD 资产」区块展示，为「项目含多少 CAD 资产」提供决策数据。
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::Cursor;

#[derive(Debug, Serialize)]
pub struct DwgBounds {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

#[derive(Debug, Serialize)]
pub struct DwgTypeCount {
    name: String,
    count: usize,
}

#[derive(Debug, Serialize)]
pub struct DwgFileInfo {
    path: String,
    format: String, // "dwg"
    entity_count: usize,
    layer_count: usize,
    /// 实体类型分布（top N，按数量降序）
    type_breakdown: Vec<DwgTypeCount>,
    bounds: Option<DwgBounds>,
}

/// 解析 DWG 文件为项目分析元数据。失败（损坏/非 DWG/读取错误）返回 None。
#[tauri::command]
pub fn parse_dwg_metadata(path: String) -> Result<Option<DwgFileInfo>, String> {
    let data = match std::fs::read(&path) {
        Ok(d) => d,
        Err(e) => return Err(format!("read failed: {e}")),
    };
    if data.len() < 64 {
        return Ok(None); // DWG 头部都放不下
    }

    let result = acadrust::DwgReader::from_stream(Cursor::new(data)).read();
    let doc = match result {
        Ok(d) => d,
        Err(_) => return Ok(None), // 非 DWG / 损坏 → 不报错，返回 None
    };

    let mut type_counts: HashMap<String, usize> = HashMap::new();
    let mut layer_set: HashSet<String> = HashSet::new();
    let mut total = 0usize;
    let mut min_x = f64::MAX;
    let mut max_x = f64::MIN;
    let mut min_y = f64::MAX;
    let mut max_y = f64::MIN;

    for entity in doc.entities() {
        total += 1;
        let common = entity.common();
        if !common.layer.is_empty() {
            layer_set.insert(common.layer.clone());
        }
        let name = entity_type_name(&entity);
        *type_counts.entry(name.to_string()).or_insert(0) += 1;
        update_bounds(&entity, &mut min_x, &mut max_x, &mut min_y, &mut max_y);
    }

    let mut breakdown: Vec<DwgTypeCount> = type_counts
        .into_iter()
        .map(|(name, count)| DwgTypeCount { name, count })
        .collect();
    breakdown.sort_by(|a, b| b.count.cmp(&a.count));
    breakdown.truncate(8);

    let bounds = if total > 0 && min_x.is_finite() && max_x.is_finite() {
        Some(DwgBounds { min_x, min_y, max_x, max_y })
    } else {
        None
    };

    Ok(Some(DwgFileInfo {
        path,
        format: "dwg".to_string(),
        entity_count: total,
        layer_count: layer_set.len(),
        type_breakdown: breakdown,
        bounds,
    }))
}

fn entity_type_name(e: &acadrust::EntityType) -> &'static str {
    use acadrust::EntityType::*;
    match e {
        Line(_) => "Line",
        Circle(_) => "Circle",
        Arc(_) => "Arc",
        LwPolyline(_) => "LwPolyline",
        Polyline(_) => "Polyline",
        Ellipse(_) => "Ellipse",
        Spline(_) => "Spline",
        Text(_) => "Text",
        MText(_) => "MText",
        Solid(_) => "Solid",
        Point(_) => "Point",
        Insert(_) => "Insert",
        Hatch(_) => "Hatch",
        Dimension(_) => "Dimension",
        _ => "Other",
    }
}

/// 取主要几何实体的坐标范围（Line/Circle/Point），其余类型只计数。
fn update_bounds(
    e: &acadrust::EntityType,
    min_x: &mut f64,
    max_x: &mut f64,
    min_y: &mut f64,
    max_y: &mut f64,
) {
    use acadrust::EntityType::*;
    let absorb =
        |x: f64, y: f64, min_x: &mut f64, max_x: &mut f64, min_y: &mut f64, max_y: &mut f64| {
            if x.is_finite() && y.is_finite() && x.abs() < 1e9 && y.abs() < 1e9 {
                *min_x = (*min_x).min(x);
                *max_x = (*max_x).max(x);
                *min_y = (*min_y).min(y);
                *max_y = (*max_y).max(y);
            }
        };
    match e {
        Line(l) => {
            absorb(l.start.x, l.start.y, min_x, max_x, min_y, max_y);
            absorb(l.end.x, l.end.y, min_x, max_x, min_y, max_y);
        }
        Circle(c) => {
            let r = c.radius;
            if r.is_finite() && r > 0.0 {
                absorb(c.center.x - r, c.center.y - r, min_x, max_x, min_y, max_y);
                absorb(c.center.x + r, c.center.y + r, min_x, max_x, min_y, max_y);
            }
        }
        Point(p) => absorb(p.location.x, p.location.y, min_x, max_x, min_y, max_y),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 本地实测：用真实 DWG 文件验证 acadrust 解析（EdgeView 测试图纸）。
    /// 默认忽略（依赖外部文件）；本地跑：cargo test parse_dwg -- --ignored --nocapture
    #[test]
    #[ignore]
    fn parses_real_dwg_metadata() {
        let path = "/Users/liwenchao/EdgeView/biosphere/biosphere-spatialdata-system/docs/需求分析/20260510/2022年5月26日通防图 (防尘喷雾布置）.dwg";
        let info = parse_dwg_metadata(path.to_string()).expect("command should not error");
        let info = info.expect("valid dwg should parse");
        println!("entities={} layers={} types={:?} bounds={:?}",
            info.entity_count, info.layer_count, info.type_breakdown, info.bounds);
        assert!(info.entity_count > 0);
        assert!(info.layer_count >= 0);
    }
}
