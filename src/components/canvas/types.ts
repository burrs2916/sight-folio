import type { BaseWidgetProps } from "../../types/widget";

export interface DashboardCanvasProps extends BaseWidgetProps {
  layout: DashboardLayoutItem[];
  widgets: DashboardWidgetConfig[];
  onLayoutChange?: (layout: DashboardLayoutItem[]) => void;
  onWidgetAdd?: (widget: DashboardWidgetConfig) => void;
  onWidgetRemove?: (id: string) => void;
  onWidgetUpdate?: (id: string, updates: Partial<DashboardWidgetConfig>) => void;
  editable?: boolean;
}

export interface DashboardLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardWidgetConfig {
  id: string;
  type: string;
  title?: string;
  dataSourceId?: string;
  binding?: {
    sourceId: string;
    metricName: string;
    transform?: string;
  };
  config: Record<string, unknown>;
  layout: DashboardLayoutItem;
}
