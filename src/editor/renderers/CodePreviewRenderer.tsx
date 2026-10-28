import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { t } from "../../i18n";


interface CodePreviewRendererProps {
  config?: {
    content?: string;
    language?: string;
    [key: string]: unknown;
  };
}

export function CodePreviewRenderer(props: CodePreviewRendererProps) {
  const _config = props?.config;
  const config = _config ?? {};
  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "grey.900",
        color: "grey.100",
        borderRadius: 1,
        overflow: "hidden",
        fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
        fontSize: 11,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, bgcolor: "grey.800" }}>
        <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 7l-5 5 5 5" /><path d="M15 7l5 5-5 5" />
              </svg>
        <Typography variant="caption" sx={{ fontSize: 10, color: "grey.400" }}>
          {config.language || "code"}
        </Typography>
      </Box>
      <Box
        component="pre"
        sx={{
          flex: 1,
          m: 0,
          p: 1,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        {config.content || t("editor.codePreviewPlaceholder")}
      </Box>
    </Box>
  );
}
