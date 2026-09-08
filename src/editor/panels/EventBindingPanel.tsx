// project-sight: 事件绑定配置面板
// 显示当前选中实体的事件绑定（作为触发源 + 作为目标），支持添加/编辑/删除
import { useState, useMemo, useCallback } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Collapse from "@mui/material/Collapse";
import AddIcon from "@mui/icons-material/Add";
import BoltIcon from "@mui/icons-material/Bolt";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CloseIcon from "@mui/icons-material/Close";
import CheckIcon from "@mui/icons-material/Check";
import FlashOnIcon from "@mui/icons-material/FlashOn";
import { useEditorStore } from "../../store/editorStore";
import type { EventBinding, SceneComponent } from "../../types/editor";
import { t } from "../../i18n";

interface EventBindingPanelProps {
  componentId: string;
}

const EVENT_OPTIONS = [
  { value: "onClick", group: "interaction" },
  { value: "onDblClick", group: "interaction" },
  { value: "onMouseEnter", group: "interaction" },
  { value: "onMouseLeave", group: "interaction" },
  { value: "onScanComplete", group: "analysis" },
  { value: "onReviewComplete", group: "analysis" },
  { value: "onFileChange", group: "analysis" },
  { value: "onLayerChange", group: "analysis" },
  { value: "onDependencyUpdate", group: "analysis" },
];

const ACTION_OPTIONS = [
  { value: "highlight", group: "display" },
  { value: "hide", group: "display" },
  { value: "show", group: "display" },
  { value: "toggleVisible", group: "display" },
  { value: "switchView", group: "navigation" },
  { value: "setVariable", group: "data" },
  { value: "navigate", group: "navigation" },
  { value: "setData", group: "data" },
  { value: "reScan", group: "analysis" },
  { value: "reReview", group: "analysis" },
  { value: "updateDependencies", group: "analysis" },
  { value: "exportReport", group: "analysis" },
  { value: "notify", group: "analysis" },
];

/** 生成唯一 ID */
function makeId(): string {
  return `eb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function BindingListItem({
  binding,
  sourceName,
  targetName,
  sourceEvent,
  targetAction,
  onEdit,
  onDelete,
  onToggle,
}: {
  binding: EventBinding;
  sourceName: string;
  targetName: string;
  sourceEvent: string;
  targetAction: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const isEnabled = binding.enabled !== false;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        py: 0.6,
        px: 0.75,
        borderRadius: 1,
        border: 1,
        borderColor: "divider",
        opacity: isEnabled ? 1 : 0.5,
        bgcolor: "action.hover",
        "&:hover": { bgcolor: "action.selected" },
      }}
    >
      <BoltIcon sx={{ fontSize: 13, color: isEnabled ? "primary.main" : "text.disabled", flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" sx={{ display: "block", lineHeight: 1.3, fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          <Box component="span" sx={{ color: "text.secondary" }}>{sourceName}</Box>
          {"."}
          <Box component="span" sx={{ color: "warning.main" }}>{t(`panel.eventLabel.${sourceEvent}`)}</Box>
          {" → "}
          <Box component="span" sx={{ color: "text.secondary" }}>{targetName}</Box>
          {"."}
          <Box component="span" sx={{ color: "primary.main" }}>{t(`panel.eventLabel.${targetAction}`)}</Box>
        </Typography>
      </Box>
      <Switch size="small" checked={isEnabled} onChange={onToggle} sx={{ transform: "scale(0.6)" }} />
      <Tooltip title={t("panel.events.edit")}>
        <IconButton size="small" onClick={onEdit} sx={{ p: 0.15 }}>
          <EditIcon sx={{ fontSize: 12 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title={t("panel.events.delete")}>
        <IconButton size="small" onClick={onDelete} sx={{ p: 0.15 }}>
          <DeleteIcon sx={{ fontSize: 12 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function BindingEditor({
  binding,
  components,
  onSave,
  onCancel,
}: {
  binding: EventBinding;
  components: SceneComponent[];
  onSave: (b: EventBinding) => void;
  onCancel: () => void;
}) {
  const [sourceEvent, setSourceEvent] = useState(binding.sourceEvent);
  const [targetComponentId, setTargetComponentId] = useState(binding.targetComponentId);
  const [targetAction, setTargetAction] = useState(binding.targetAction);
  const [condition, setCondition] = useState(binding.condition ?? "");

  const canSave = sourceEvent && targetComponentId && targetAction;

  // 按 group 分组渲染 MenuItem
  const renderGroupedMenuItems = (
    options: { value: string; group: string }[],
    currentValue: string,
    onChange: (val: string) => void
  ) => {
    const groups = new Map<string, { value: string }[]>();
    options.forEach((o) => {
      const arr = groups.get(o.group) || [];
      arr.push(o);
      groups.set(o.group, arr);
    });
    return Array.from(groups.entries()).map(([groupName, items], gi) => [
      gi > 0 && (
        <MenuItem disabled key={`sep-${groupName}`} sx={{ fontSize: 10, opacity: 0.5, minHeight: 24 }}>
          {t(`panel.eventGroup.${groupName}`)}
        </MenuItem>
      ),
      ...items.map((o) => (
        <MenuItem key={o.value} value={o.value} sx={{ fontSize: 12 }}>
          {currentValue === o.value && "✓ "}{t(`panel.eventLabel.${o.value}`)}
        </MenuItem>
      )),
    ]);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "action.hover" }}>
      <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 10, color: "text.secondary" }}>
        {t("panel.events.title")}
      </Typography>

      <TextField
        select
        size="small"
        label={t("panel.events.triggerEvent")}
        value={sourceEvent}
        onChange={(e) => setSourceEvent(e.target.value)}
        sx={{ "& .MuiInputBase-root": { fontSize: 11 } }}
      >
        {renderGroupedMenuItems(EVENT_OPTIONS, sourceEvent, setSourceEvent)}
      </TextField>

      <TextField
        select
        size="small"
        label={t("panel.events.targetEntity")}
        value={targetComponentId}
        onChange={(e) => setTargetComponentId(e.target.value)}
        sx={{ "& .MuiInputBase-root": { fontSize: 11 } }}
      >
        {components
          .filter((c) => c.id !== binding.sourceComponentId)
          .map((c) => (
            <MenuItem key={c.id} value={c.id} sx={{ fontSize: 12 }}>{c.name || c.type}</MenuItem>
          ))}
      </TextField>

      <TextField
        select
        size="small"
        label={t("panel.events.action")}
        value={targetAction}
        onChange={(e) => setTargetAction(e.target.value)}
        sx={{ "& .MuiInputBase-root": { fontSize: 11 } }}
      >
        {renderGroupedMenuItems(ACTION_OPTIONS, targetAction, setTargetAction)}
      </TextField>

      <TextField
        size="small"
        label={t("panel.events.condition")}
        value={condition}
        onChange={(e) => setCondition(e.target.value)}
        placeholder={t("panel.events.conditionPlaceholder")}
        sx={{ "& .MuiInputBase-root": { fontSize: 11 } }}
      />

      <Box sx={{ display: "flex", gap: 0.5, justifyContent: "flex-end", mt: 0.5 }}>
        <Button size="small" variant="outlined" onClick={onCancel} sx={{ textTransform: "none", fontSize: 10, minHeight: 22 }}>
          {t("panel.events.cancel")}
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!canSave}
          startIcon={<CheckIcon sx={{ fontSize: 12 }} />}
          onClick={() => onSave({ ...binding, sourceEvent, targetComponentId, targetAction, condition: condition || undefined })}
          sx={{ textTransform: "none", fontSize: 10, minHeight: 22 }}
        >
          {t("panel.events.save")}
        </Button>
      </Box>
    </Box>
  );
}

export function EventBindingPanel({ componentId }: EventBindingPanelProps) {
  const eventBindings = useEditorStore((s) => s.eventBindings);
  const addEventBinding = useEditorStore((s) => s.addEventBinding);
  const removeEventBinding = useEditorStore((s) => s.removeEventBinding);
  const updateEventBinding = useEditorStore((s) => s.updateEventBinding);
  const components = useEditorStore((s) => s.components);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const currentComp = components.find((c) => c.id === componentId);
  const currentName = currentComp?.name || currentComp?.type || componentId;

  // 该实体作为触发源 的绑定
  const sourceBindings = useMemo(
    () => eventBindings.filter((b: EventBinding) => b.sourceComponentId === componentId),
    [eventBindings, componentId]
  );

  // 该实体作为目标 的绑定
  const targetBindings = useMemo(
    () => eventBindings.filter((b: EventBinding) => b.targetComponentId === componentId && b.sourceComponentId !== componentId),
    [eventBindings, componentId]
  );

  const getCompName = useCallback(
    (id: string) => {
      const c = components.find((c) => c.id === id);
      return c?.name || c?.type || id;
    },
    [components]
  );

  const handleAdd = useCallback(() => {
    setShowAdd(true);
    setEditingId(null);
  }, []);

  const handleSaveNew = useCallback(
    (binding: EventBinding) => {
      addEventBinding(binding);
      setShowAdd(false);
    },
    [addEventBinding]
  );

  const handleEdit = useCallback((binding: EventBinding) => {
    setEditingId(binding.id);
    setShowAdd(false);
  }, []);

  const handleSaveEdit = useCallback(
    (binding: EventBinding) => {
      updateEventBinding(binding.id, binding);
      setEditingId(null);
    },
    [updateEventBinding]
  );

  const handleDelete = useCallback(
    (id: string) => {
      removeEventBinding(id);
      if (editingId === id) setEditingId(null);
    },
    [removeEventBinding, editingId]
  );

  const handleToggle = useCallback(
    (binding: EventBinding) => {
      updateEventBinding(binding.id, { enabled: binding.enabled === false ? true : false });
    },
    [updateEventBinding]
  );

  if (!currentComp) {
    return (
      <Box sx={{ p: 1.5, textAlign: "center", color: "text.secondary" }}>
        <FlashOnIcon sx={{ fontSize: 32, opacity: 0.2, mb: 0.5 }} />
        <Typography variant="caption" sx={{ display: "block" }}>
          {t("panel.events.selectHint")}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box sx={{ flex: 1, overflow: "auto", p: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        {/* ── 添加新绑定 ── */}
        {showAdd && (
          <BindingEditor
            binding={{
              id: makeId(),
              sourceComponentId: componentId,
              sourceEvent: "onClick",
              targetComponentId: "",
              targetAction: "",
            }}
            components={components}
            onSave={handleSaveNew}
            onCancel={() => setShowAdd(false)}
          />
        )}

        {/* ── 作为触发源 ── */}
        <Box>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 10, color: "text.secondary" }}>
              {t("panel.events.asSource", { n: sourceBindings.length })}
            </Typography>
            <Button
              size="small"
              startIcon={<AddIcon sx={{ fontSize: 12 }} />}
              onClick={handleAdd}
              sx={{ textTransform: "none", fontSize: 10, minHeight: 20, p: 0.25 }}
            >
              {t("panel.events.add")}
            </Button>
          </Box>
          {sourceBindings.length === 0 && !showAdd && (
            <Typography variant="caption" sx={{ color: "text.disabled", fontSize: 10, display: "block", textAlign: "center", py: 1 }}>
              {t("panel.events.noBindings")}
            </Typography>
          )}
          {sourceBindings.map((b: EventBinding) =>
            editingId === b.id ? (
              <BindingEditor
                key={b.id}
                binding={b}
                components={components}
                onSave={handleSaveEdit}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <BindingListItem
                key={b.id}
                binding={b}
                sourceName={currentName}
                targetName={getCompName(b.targetComponentId)}
                sourceEvent={b.sourceEvent}
                targetAction={b.targetAction}
                onEdit={() => handleEdit(b)}
                onDelete={() => handleDelete(b.id)}
                onToggle={() => handleToggle(b)}
              />
            )
          )}
        </Box>

        {/* ── 作为目标 ── */}
        {targetBindings.length > 0 && (
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 10, color: "text.secondary", mb: 0.5, display: "block" }}>
              {t("panel.events.asTarget", { n: targetBindings.length })}
            </Typography>
            {targetBindings.map((b: EventBinding) => (
              <BindingListItem
                key={b.id}
                binding={b}
                sourceName={getCompName(b.sourceComponentId)}
                targetName={currentName}
                sourceEvent={b.sourceEvent}
                targetAction={b.targetAction}
                onEdit={() => handleEdit(b)}
                onDelete={() => handleDelete(b.id)}
                onToggle={() => handleToggle(b)}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
