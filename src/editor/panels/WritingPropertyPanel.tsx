// 书场景（novel-zh）右栏「详情」Tab 的写作实体属性面板（P1 拖入后可编辑）。
//
// 背景：拖入画布的章节/人物/设定卡此前是「看得见改不动」——右栏 EntityPortraitPanel
// 是代码画像血统，写作实体进去只有画像没有编辑。本面板提供最小可编辑集：
//   - 实体名（comp.name）+ 业务字段（config，merge 式写入）
//   - 章节状态二值（draft/finished，与 WritingChapterRenderer 徽标口径一致）
// 字段清单按实体类型硬编码（与 writingAnalyzer manifest properties / 渲染器消费
// 字段三方对齐）；编辑走 updateComponent / updateComponentConfig 既有 API，
// config 侧自带 300ms 防抖历史，不新增 store 接口。

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import InputAdornment from "@mui/material/InputAdornment";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { useEditorStore } from "../../store/editorStore";
import { useWritingStore } from "../../store/writingStore";
import { t, resolveFragments } from "../../i18n";

/** 最小编辑入参：SceneEditor 的 selectedComponent 是窄化 pick（id/type/name/config），不依赖完整 SceneComponent */
interface PropertyEntity {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
}

type FieldKind = "text" | "number" | "status" | "longtext";

interface WritingField {
  key: string;
  labelKey: string;
  kind: FieldKind;
  /** 主字段：编辑后同步回实体名 comp.name（画布树/联动显示用） */
  primary?: boolean;
}

/** 各写作实体的可编辑字段（label 复用 analyzer.writing.entity.*.prop.* 既有 key） */
const WRITING_FIELDS: Record<string, WritingField[]> = {
  "writing-chapter": [
    { key: "title", labelKey: "analyzer.writing.entity.chapter.prop.title", kind: "text", primary: true },
    { key: "volume", labelKey: "analyzer.writing.entity.chapter.prop.volume", kind: "text" },
    { key: "wordCount", labelKey: "analyzer.writing.entity.chapter.prop.wordCount", kind: "number" },
    { key: "chapterStatus", labelKey: "analyzer.writing.entity.chapter.prop.status", kind: "status" },
  ],
  // 载体工作台卡：属性面板复用章节字段（title 编辑同步 comp.name；
  // 正文以卡内编辑器为准，落库走 saveChapterContent）
  "writing-workbench": [
    { key: "title", labelKey: "analyzer.writing.entity.chapter.prop.title", kind: "text", primary: true },
    { key: "wordCount", labelKey: "analyzer.writing.entity.chapter.prop.wordCount", kind: "number" },
    { key: "chapterStatus", labelKey: "analyzer.writing.entity.chapter.prop.status", kind: "status" },
  ],
  "writing-character": [
    { key: "name", labelKey: "analyzer.writing.entity.character.prop.name", kind: "text", primary: true },
    { key: "role", labelKey: "analyzer.writing.entity.character.prop.role", kind: "text" },
    { key: "appearances", labelKey: "analyzer.writing.entity.character.prop.appearances", kind: "number" },
  ],
  "writing-outline": [
    { key: "title", labelKey: "analyzer.writing.entity.outline.prop.title", kind: "text", primary: true },
    { key: "summary", labelKey: "analyzer.writing.entity.outline.prop.summary", kind: "number" },
  ],
  "writing-worldview": [
    { key: "name", labelKey: "analyzer.writing.entity.worldview.prop.name", kind: "text", primary: true },
    { key: "kind", labelKey: "analyzer.writing.entity.worldview.prop.kind", kind: "text" },
  ],
  // P2-a 文字便签：拖入画布后的自由写作块，全文在此编辑
  "annotation-text": [
    { key: "text", labelKey: "editor.writing.prop.noteText", kind: "longtext" },
  ],
};

const inputSx = { fontSize: 12.5 } as const;

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, fontWeight: 600, color: "text.secondary", mb: 0.25 }}>{label}</Typography>
      {children}
    </Box>
  );
}

/** 长文本（便签全文）：本地草稿，blur/Enter 提交一次 */
function LongTextField({
  label,
  initial,
  onCommit,
}: {
  label: string;
  initial: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => {
    setDraft(initial);
  }, [initial]);
  return (
    <FieldRow label={label}>
      <TextField
        size="small"
        fullWidth
        multiline
        minRows={3}
        maxRows={12}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          // Enter 换行是便签的正常输入，仅 Esc 放弃草稿
          if (e.key === "Escape") setDraft(initial);
        }}
        slotProps={{ input: { sx: inputSx } }}
      />
    </FieldRow>
  );
}

export function WritingPropertyPanel({ entity }: { entity: PropertyEntity | null }) {
  const updateComponent = useEditorStore((s) => s.updateComponent);
  const updateComponentConfig = useEditorStore((s) => s.updateComponentConfig);
  const renameChapter = useWritingStore((s) => s.renameChapter);
  const updateSetting = useWritingStore((s) => s.updateSetting);

  const fields = entity ? WRITING_FIELDS[entity.type] : undefined;

  // 实体名本地草稿：blur/Enter 才提交（updateComponent 每次调用都进历史，
  // 逐字符提交会刷爆撤销栈；config 侧有防抖所以直接提交）。
  // resolveFragments 兜底：IA 修复前落库的壳卡 comp.name 可能是 i18n key
  const [nameDraft, setNameDraft] = useState(resolveFragments(entity?.name ?? ""));
  useEffect(() => {
    setNameDraft(resolveFragments(entity?.name ?? ""));
  }, [entity?.id, entity?.name]);

  if (!entity) {
    return (
      <Box sx={{ p: 2, textAlign: "center" }}>
        <EditOutlinedIcon sx={{ fontSize: 34, color: "text.disabled", mb: 1 }} />
        <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
          {t("editor.writing.prop.empty")}
        </Typography>
      </Box>
    );
  }

  if (!fields) {
    // 书场景里的非写作实体（file/image/folder 等）：无业务字段可编辑，明说而不是空白
    return (
      <Box sx={{ p: 2, textAlign: "center" }}>
        <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
          {t("editor.writing.prop.notEditable", { type: entity.type })}
        </Typography>
      </Box>
    );
  }

  // P2 画布→业务回写：卡片改名同步落到业务层（章节→renameChapter、人物/世界观→updateSetting），
  // 否则写作台列表仍是旧名，双工作面失联。业务层成功后由 writingStore 的回流逻辑反向刷卡。
  const commitBizName = (next: string) => {
    const cfg = entity.config ?? {};
    const chapterId = typeof cfg.chapterId === "string" ? (cfg.chapterId as string) : null;
    const settingId = typeof cfg.settingId === "string" ? (cfg.settingId as string) : null;
    if (chapterId) void renameChapter(chapterId, next);
    else if (settingId) void updateSetting(settingId, { name: next });
  };

  const commitName = () => {
    const next = nameDraft.trim();
    if (next && next !== entity.name) {
      updateComponent(entity.id, { name: next });
      commitBizName(next);
    } else setNameDraft(entity.name);
  };

  const setConfig = (key: string, value: unknown) => {
    updateComponentConfig(entity.id, { [key]: value });
  };

  return (
    <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1.25, overflow: "auto" }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary" }}>
        {t("editor.writing.prop.title")}
      </Typography>

      <FieldRow label={t("editor.writing.prop.name")}>
        <TextField
          size="small"
          fullWidth
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          slotProps={{ input: { sx: inputSx } }}
        />
      </FieldRow>

      {fields.map((f) => {
        const raw = entity.config?.[f.key];
        if (f.kind === "longtext") {
          // 便签全文：本地草稿 + blur 提交（updateComponentConfig merge + 防抖历史）
          return (
            <LongTextField
              key={f.key}
              label={t(f.labelKey)}
              initial={typeof raw === "string" ? raw : ""}
              onCommit={(next) => {
                if (next !== raw) setConfig(f.key, next);
              }}
            />
          );
        }
        if (f.kind === "number") {
          return (
            <FieldRow key={f.key} label={t(f.labelKey)}>
              <TextField
                size="small"
                fullWidth
                type="number"
                defaultValue={typeof raw === "number" ? raw : 0}
                onBlur={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isNaN(n) && n !== raw) setConfig(f.key, n);
                  else if (Number.isNaN(n)) e.target.value = String(typeof raw === "number" ? raw : 0);
                }}
                slotProps={{
                  input: {
                    sx: inputSx,
                    endAdornment: (
                      <InputAdornment position="end" sx={{ "& .MuiTypography-root": { fontSize: 10 } }}>
                        {t("editor.writing.prop.unitCount")}
                      </InputAdornment>
                    ),
                  },
                }}
              />
            </FieldRow>
          );
        }
        if (f.kind === "status") {
          const status = typeof raw === "string" && raw === "finished" ? "finished" : "draft";
          return (
            <FieldRow key={f.key} label={t(f.labelKey)}>
              <TextField
                size="small"
                fullWidth
                select
                value={status}
                onChange={(e) => {
                  if (e.target.value !== raw) setConfig(f.key, e.target.value);
                }}
                slotProps={{ input: { sx: inputSx } }}
              >
                <MenuItem value="draft" sx={{ fontSize: 12.5 }}>{t("editor.writing.status.draft")}</MenuItem>
                <MenuItem value="finished" sx={{ fontSize: 12.5 }}>{t("editor.writing.status.finished")}</MenuItem>
              </TextField>
            </FieldRow>
          );
        }
        return (
          <FieldRow key={f.key} label={t(f.labelKey)}>
            <TextField
              size="small"
              fullWidth
              defaultValue={typeof raw === "string" ? raw : ""}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next !== raw) {
                  setConfig(f.key, next);
                  // 主字段联动实体名（画布树/搜索/联动显示用）+ 业务层回写（P2）
                  if (f.primary && next) {
                    updateComponent(entity.id, { name: next });
                    commitBizName(next);
                  }
                }
              }}
              slotProps={{ input: { sx: inputSx } }}
            />
          </FieldRow>
        );
      })}
    </Box>
  );
}
