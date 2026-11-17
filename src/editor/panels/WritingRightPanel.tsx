import { useMemo } from "react";
// 大包导入改子路径（避免与 @mui/material/* 预构建双实例 split-brain，2026-09-14）
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import { t } from "../../i18n";
import PersonIcon from "@mui/icons-material/Person";
import PublicIcon from "@mui/icons-material/Public";
import HubIcon from "@mui/icons-material/Hub";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import type { ProjectFile } from "../../services/tauri";
import { parseWritingChapters, type ChapterRow } from "../../utils/bookOverview";
import { buildRelationBoard } from "../../utils/writingBoards";

interface Agg {
  id: string;
  name: string;
  kind: "character" | "worldbuilding";
  total: number;
  chapters: number;
  top: ChapterRow | null;
}

function aggregate(files: ProjectFile[], kindFilter: Agg["kind"] | null): Agg[] {
  const rows = parseWritingChapters(files);
  const map = new Map<string, Agg>();
  const topCount = new Map<string, number>();
  for (const ch of rows) {
    for (const a of ch.appearances) {
      const kind: Agg["kind"] = a.kind === "worldbuilding" ? "worldbuilding" : "character";
      if (kindFilter && kind !== kindFilter) continue;
      let acc = map.get(a.id);
      if (!acc) {
        acc = { id: a.id, name: a.name, kind, total: 0, chapters: 0, top: null };
        map.set(a.id, acc);
        topCount.set(a.id, 0);
      }
      acc.total += a.count;
      acc.chapters += 1;
      if (a.count > (topCount.get(a.id) ?? 0)) {
        topCount.set(a.id, a.count);
        acc.top = ch;
      }
    }
  }
  return [...map.values()].sort((x, y) => y.total - x.total || x.name.localeCompare(y.name));
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <Box sx={{ textAlign: "center", py: 3, color: "text.secondary" }}>
      <Box sx={{ fontSize: 36, opacity: 0.2, mb: 1 }}>{icon}</Box>
      <Typography variant="caption">{text || t("editor.writing.book.empty")}</Typography>
    </Box>
  );
}

export function WritingCharactersPanel({
  files,
  onOpenChapter,
}: {
  files: ProjectFile[];
  onOpenChapter: (fileId: string) => void;
}) {
  const list = useMemo(() => aggregate(files, "character"), [files]);
  if (list.length === 0) return <EmptyState icon={<PersonIcon />} text="" />;
  return (
    <List dense sx={{ p: 1 }}>
      {list.map((c) => (
        <ListItemButton key={c.id} onClick={() => c.top && onOpenChapter(c.top.file.id)} sx={{ borderRadius: 1, mb: 0.5 }}>
          <ListItemText
            primary={c.name}
            slotProps={{ secondary: { component: "div" } }}
            secondary={
              <Stack direction="row" spacing={1} sx={{ mt: 0.25, flexWrap: "wrap" }}>
                <span>{t("editor.writing.book.mentions", { n: c.total })}</span>
                <span>· {t("editor.writing.book.inChapters", { n: c.chapters })}</span>
                {c.top && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t("editor.writing.book.mainChapter", { name: c.top.file.name })}
                    sx={{ height: 18, fontSize: "0.65rem" }}
                  />
                )}
              </Stack>
            }
          />
        </ListItemButton>
      ))}
    </List>
  );
}

export function WritingWorldSettingsPanel({
  files,
  onOpenChapter,
}: {
  files: ProjectFile[];
  onOpenChapter: (fileId: string) => void;
}) {
  const list = useMemo(() => aggregate(files, "worldbuilding"), [files]);
  if (list.length === 0) return <EmptyState icon={<PublicIcon />} text="" />;
  return (
    <List dense sx={{ p: 1 }}>
      {list.map((c) => (
        <ListItemButton key={c.id} onClick={() => c.top && onOpenChapter(c.top.file.id)} sx={{ borderRadius: 1, mb: 0.5 }}>
          <ListItemText
            primary={c.name}
            slotProps={{ secondary: { component: "div" } }}
            secondary={
              <Stack direction="row" spacing={1} sx={{ mt: 0.25, flexWrap: "wrap" }}>
                <span>{t("editor.writing.book.mentions", { n: c.total })}</span>
                <span>· {t("editor.writing.book.inChapters", { n: c.chapters })}</span>
                {c.top && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t("editor.writing.book.mainChapter", { name: c.top.file.name })}
                    sx={{ height: 18, fontSize: "0.65rem" }}
                  />
                )}
              </Stack>
            }
          />
        </ListItemButton>
      ))}
    </List>
  );
}

export function WritingRelationsPanel({ files }: { files: ProjectFile[] }) {
  const edges = useMemo(() => buildRelationBoard(files).edges, [files]);
  if (edges.length === 0) return <EmptyState icon={<HubIcon />} text="" />;
  return (
    <List dense sx={{ p: 1 }}>
      {edges.map((e) => (
        <ListItemButton key={`${e.a}|${e.b}`} sx={{ borderRadius: 1, mb: 0.5 }}>
          <ListItemText primary={`${e.aName} ⇄ ${e.bName}`} secondary={t("editor.writing.book.togetherChapters", { n: e.co })} />
        </ListItemButton>
      ))}
    </List>
  );
}

export function WritingOutlinePanel({
  files,
  onOpenChapter,
  onManageVolumes,
}: {
  files: ProjectFile[];
  onOpenChapter: (fileId: string) => void;
  onManageVolumes?: () => void;
}) {
  const volumes = useMemo(() => {
    const rows = parseWritingChapters(files);
    const groups = new Map<string, ChapterRow[]>();
    for (const r of rows) {
      const key = r.volume || t("editor.writing.book.noVolume");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return [...groups.entries()];
  }, [files]);

  if (volumes.length === 0) return <EmptyState icon={<MenuBookIcon />} text="" />;
  return (
    <Box sx={{ p: 1, overflowY: "auto" }}>
      {onManageVolumes && (
        <Button size="small" variant="outlined" startIcon={<MenuBookIcon sx={{ fontSize: 14 }} />} onClick={onManageVolumes} sx={{ mb: 1, textTransform: "none", fontSize: 11 }}>
          {t("panel.layers.bookTitle")}
        </Button>
      )}
      {volumes.map(([vol, rows], i) => (
        <Box key={vol} sx={{ mb: 1.5 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: "center" }}>
            <MenuBookIcon sx={{ fontSize: 14, color: "primary.main" }} />
            <Typography variant="subtitle2" sx={{ fontSize: 12, fontWeight: 600 }}>
              {vol}
            </Typography>
            <Chip size="small" label={t("editor.writing.book.chapterCount", { n: rows.length })} sx={{ height: 18, fontSize: "0.65rem" }} />
          </Stack>
          <List dense disablePadding>
            {rows.map((r) => (
              <ListItemButton key={r.file.id} onClick={() => onOpenChapter(r.file.id)} sx={{ borderRadius: 1, pl: 2 }}>
                <ListItemText
                  primary={r.file.name}
                  slotProps={{ secondary: { component: "div" } }}
                  secondary={
                    r.status ? (
                      <Chip
                        size="small"
                        variant="outlined"
                        color={r.status === "finished" ? "success" : "default"}
                        label={t(`editor.writing.status.${r.status === "finished" ? "finished" : "draft"}`)}
                        sx={{ height: 16, fontSize: "0.6rem", mt: 0.25 }}
                      />
                    ) : undefined
                  }
                />
              </ListItemButton>
            ))}
          </List>
          {i < volumes.length - 1 && <Divider sx={{ mt: 0.5 }} />}
        </Box>
      ))}
    </Box>
  );
}
