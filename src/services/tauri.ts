import { invoke as _tInvoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logger } from '../utils/logger';
import type { Dashboard, LayoutItem, ComponentConfig } from '../store';
import type { MetricData } from '../store';
import type { DataSource, PersistedDataSource } from '../types/dataSource';
import type { DatabaseConnectionConfig } from '../types/database';
import type { SceneDSL, SceneCategory } from '../types/scene';
import { createDefaultScene } from '../types/scene';
import type { AiContextPack } from '../ai/contextTypes';

// ─── Tauri 环境守卫 ──────────────────────────────────────────────
// Tauri 2.x 在 webview 启动时才注入 `window.__TAURI_INTERNALS__`，
// 在纯浏览器（vite dev 直接打开 / dist 静态文件 / webview 还没初始化完）
// 环境下 `invoke` 函数内部会访问 `undefined.invoke` 抛 TypeError。
// 这里包一层守卫，浏览器模式下拒绝调用并给出明确提示，store 侧
// 仍按 reject 处理（不污染控制台），不影响 UI 渲染。
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const invoke = <T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  if (!isTauri()) {
    const msg = `[tauri] command "${cmd}" unavailable: not running inside Tauri webview. Use "npm run tauri dev" or "tauri dev".`;
    if (typeof window !== 'undefined') {
      console.warn(msg);
    }
    return Promise.reject(new Error(msg));
  }
  return _tInvoke<T>(cmd, args);
};

export type AuthPreset = 'keycloak' | 'auth0' | 'internal' | 'custom';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type ParamLocation = 'body' | 'query' | 'formData';

export type HeaderUsage = 'auth' | 'api' | 'both';

export interface AuthParam {
  id: string;
  key: string;
  label: string;
  value: string;
  location: ParamLocation;
  required: boolean;
  description?: string;
}

export interface ResponseMapping {
  sourcePath: string;
  targetKey: string;
  saveToCache: boolean;
  isExpirationTime?: boolean;
}

export type MenuIcon = 'login' | 'logout' | 'refresh' | 'verify' | 'userInfo' | 'settings' | 'key' | 'shield' | string; // 支持自定义图标 ID

export type EndpointType = 'login' | 'logout' | 'refresh' | 'other';

export interface ApiEndpoint {
  id: string;
  name: string;
  path: string;
  method: HttpMethod;
  responseMapping: ResponseMapping[];
  bindToMenu: boolean;
  menuIcon?: string;
  endpointType?: EndpointType;
}

export interface HeaderConfig {
  id: string;
  headerName: string;
  valueTemplate: string;
  usage: HeaderUsage;
}

export type UserDisplayType = 'none' | 'avatar' | 'name' | 'email' | 'tenant' | 'role' | 'custom';

export interface UserDisplayConfig {
  cacheKey: string;
  displayType: UserDisplayType;
  customLabel?: string;
}

export interface IconGroup {
  id: string;
  name: string;
  description?: string;
  parent_id?: string;
  updated_at: number;
}

export type IconFileType = 'svg' | 'png' | 'jpg';

export interface SystemIcon {
  id: string;
  name: string;
  description?: string;
  file_path: string;
  file_type: IconFileType;
  group_id: string;
  updated_at: number;
}

export interface AuthConfig {
  enabled: boolean;
  preset: AuthPreset;
  baseUrl: string;
  authParams: AuthParam[];
  endpoints: ApiEndpoint[];
  headerConfig: HeaderConfig[];
  userDisplayConfig: UserDisplayConfig[];
  timeout: number;
  tokenStorage: string;
  tokenKey?: string; // 已废弃，保留兼容旧配置
  tokenHeader: string;
  tokenPrefix: string;
  refreshEnabled: boolean;
  refreshThreshold: number;
  loginRedirectPath: string;
  loginRedirectParam: string;
  loginAutoRedirect: boolean;
  whitelist: string[];
}

export interface SuggestedParam {
  key: string;
  label: string;
  location: ParamLocation;
  required: boolean;
  description?: string;
}

export interface SuggestedEndpoint {
  name: string;
  path: string;
  method: HttpMethod;
  suggestedMappings: { sourcePath: string; targetKey: string }[];
  bindToMenu: boolean;
  menuIcon?: MenuIcon;
}

export interface SuggestedHeader {
  headerName: string;
  valueTemplate: string;
  label: string;
  description?: string;
  category?: string;
}

export const SUGGESTED_HEADERS: Record<string, SuggestedHeader> = {
  authorization: {
    headerName: 'Authorization',
    valueTemplate: 'Bearer ${auth_token}',
    label: '认证令牌',
    description: '自动添加认证令牌到请求头',
    category: '认证',
  },
  tenantId: {
    headerName: 'tenant-id',
    valueTemplate: '${tenant_id}',
    label: '租户ID',
    description: '多租户系统的租户标识',
    category: '租户',
  },
  visitTenantId: {
    headerName: 'visit-tenant-id',
    valueTemplate: '${visit_tenant_id}',
    label: '访问租户ID',
    description: '访问租户的标识',
    category: '租户',
  },
  cacheControl: {
    headerName: 'Cache-Control',
    valueTemplate: 'no-cache',
    label: '禁用缓存',
    description: '防止GET请求被缓存',
    category: '缓存',
  },
  pragma: {
    headerName: 'Pragma',
    valueTemplate: 'no-cache',
    label: 'Pragma',
    description: 'HTTP/1.0 缓存控制',
    category: '缓存',
  },
  contentType: {
    headerName: 'Content-Type',
    valueTemplate: 'application/json',
    label: 'JSON格式',
    description: '请求体为JSON格式',
    category: '内容类型',
  },
  formData: {
    headerName: 'Content-Type',
    valueTemplate: 'application/x-www-form-urlencoded',
    label: '表单数据',
    description: '请求体为表单数据',
    category: '内容类型',
  },
  apiKey: {
    headerName: 'X-API-Key',
    valueTemplate: '${api_key}',
    label: 'API Key',
    description: 'API密钥认证',
    category: '认证',
  },
};

export const AUTH_PRESETS: Record<
  AuthPreset,
  {
    label: string;
    description: string;
    suggestedParams: SuggestedParam[];
    suggestedEndpoints: SuggestedEndpoint[];
  }
> = {
  keycloak: {
    label: 'Keycloak',
    description: 'Keycloak 多租户认证',
    suggestedParams: [
      { key: 'tenant', label: '租户ID', location: 'body', required: true, description: '租户标识' },
      { key: 'client_id', label: '客户端ID', location: 'body', required: true },
      { key: 'client_secret', label: '客户端密钥', location: 'body', required: true },
      { key: 'username', label: '用户名', location: 'body', required: true },
      { key: 'password', label: '密码', location: 'body', required: true },
      { key: 'grant_type', label: '授权类型', location: 'body', required: true },
      { key: 'scope', label: '作用域', location: 'body', required: false },
    ],
    suggestedEndpoints: [
      {
        name: '登录接口',
        path: '/realms/{tenant}/protocol/openid-connect/token',
        method: 'POST',
        suggestedMappings: [
          { sourcePath: 'access_token', targetKey: 'accessToken' },
          { sourcePath: 'refresh_token', targetKey: 'refreshToken' },
          { sourcePath: 'expires_in', targetKey: 'expiresIn' },
        ],
        bindToMenu: true,
        menuIcon: 'login',
      },
      {
        name: '注销接口',
        path: '/realms/{tenant}/protocol/openid-connect/logout',
        method: 'POST',
        suggestedMappings: [],
        bindToMenu: true,
        menuIcon: 'logout',
      },
      {
        name: '验证接口',
        path: '/realms/{tenant}/protocol/openid-connect/userinfo',
        method: 'GET',
        suggestedMappings: [],
        bindToMenu: false,
        menuIcon: 'verify',
      },
      {
        name: '刷新接口',
        path: '/realms/{tenant}/protocol/openid-connect/token',
        method: 'POST',
        suggestedMappings: [],
        bindToMenu: true,
        menuIcon: 'refresh',
      },
      {
        name: '用户信息',
        path: '/realms/{tenant}/protocol/openid-connect/userinfo',
        method: 'GET',
        suggestedMappings: [],
        bindToMenu: true,
        menuIcon: 'userInfo',
      },
      {
        name: '租户信息',
        path: '/admin/realms',
        method: 'GET',
        suggestedMappings: [],
        bindToMenu: false,
        menuIcon: 'settings',
      },
    ],
  },
  auth0: {
    label: 'Auth0',
    description: 'Auth0 OAuth2 认证',
    suggestedParams: [
      { key: 'client_id', label: '客户端ID', location: 'body', required: true },
      { key: 'client_secret', label: '客户端密钥', location: 'body', required: true },
      { key: 'domain', label: '域名', location: 'body', required: true },
      { key: 'username', label: '用户名', location: 'body', required: true },
      { key: 'password', label: '密码', location: 'body', required: true },
      { key: 'grant_type', label: '授权类型', location: 'body', required: true },
      { key: 'scope', label: '作用域', location: 'body', required: false },
      { key: 'audience', label: '受众', location: 'body', required: false },
    ],
    suggestedEndpoints: [
      {
        name: '登录接口',
        path: '/oauth/token',
        method: 'POST',
        suggestedMappings: [
          { sourcePath: 'access_token', targetKey: 'accessToken' },
          { sourcePath: 'refresh_token', targetKey: 'refreshToken' },
          { sourcePath: 'expires_in', targetKey: 'expiresIn' },
        ],
        bindToMenu: true,
        menuIcon: 'login',
      },
      {
        name: '注销接口',
        path: '/v2/logout',
        method: 'GET',
        suggestedMappings: [],
        bindToMenu: true,
        menuIcon: 'logout',
      },
      {
        name: '验证接口',
        path: '/userinfo',
        method: 'GET',
        suggestedMappings: [],
        bindToMenu: false,
        menuIcon: 'verify',
      },
      {
        name: '刷新接口',
        path: '/oauth/token',
        method: 'POST',
        suggestedMappings: [],
        bindToMenu: true,
        menuIcon: 'refresh',
      },
      {
        name: '用户信息',
        path: '/userinfo',
        method: 'GET',
        suggestedMappings: [],
        bindToMenu: true,
        menuIcon: 'userInfo',
      },
    ],
  },
  internal: {
    label: '自定义认证',
    description: '通用自定义认证服务',
    suggestedParams: [
      { key: 'username', label: '用户名', location: 'body', required: true },
      { key: 'password', label: '密码', location: 'body', required: true },
      { key: 'tenantId', label: '租户ID', location: 'body', required: false, description: '多租户场景必填' },
      { key: 'email', label: '邮箱', location: 'body', required: false },
      { key: 'phone', label: '手机号', location: 'body', required: false },
    ],
    suggestedEndpoints: [
      {
        name: '登录接口',
        path: '/auth/login',
        method: 'POST',
        suggestedMappings: [
          { sourcePath: 'data.accessToken', targetKey: 'accessToken' },
          { sourcePath: 'data.refreshToken', targetKey: 'refreshToken' },
          { sourcePath: 'data.expiresIn', targetKey: 'expiresIn' },
          { sourcePath: 'data.userId', targetKey: 'userId' },
        ],
        bindToMenu: true,
        menuIcon: 'login',
      },
      {
        name: '注销接口',
        path: '/auth/logout',
        method: 'POST',
        suggestedMappings: [],
        bindToMenu: true,
        menuIcon: 'logout',
      },
      {
        name: '验证接口',
        path: '/auth/validate',
        method: 'GET',
        suggestedMappings: [],
        bindToMenu: false,
        menuIcon: 'verify',
      },
      {
        name: '刷新接口',
        path: '/auth/refresh',
        method: 'POST',
        suggestedMappings: [],
        bindToMenu: true,
        menuIcon: 'refresh',
      },
      {
        name: '用户信息',
        path: '/auth/userinfo',
        method: 'GET',
        suggestedMappings: [],
        bindToMenu: true,
        menuIcon: 'userInfo',
      },
    ],
  },
  custom: {
    label: '自定义',
    description: '自定义认证配置',
    suggestedParams: [
      { key: 'username', label: '用户名', location: 'body', required: true },
      { key: 'password', label: '密码', location: 'body', required: true },
      { key: 'email', label: '邮箱', location: 'body', required: false },
      { key: 'phone', label: '手机号', location: 'body', required: false },
      { key: 'api_key', label: 'API Key', location: 'body', required: false },
      { key: 'client_id', label: '客户端ID', location: 'body', required: false },
      { key: 'client_secret', label: '客户端密钥', location: 'body', required: false },
      { key: 'grant_type', label: '授权类型', location: 'body', required: false },
      { key: 'scope', label: '作用域', location: 'body', required: false },
    ],
    suggestedEndpoints: [
      {
        name: '登录接口',
        path: '/auth/login',
        method: 'POST',
        suggestedMappings: [{ sourcePath: 'token', targetKey: 'auth_token' }],
        bindToMenu: true,
        menuIcon: 'login',
      },
      {
        name: '注销接口',
        path: '/auth/logout',
        method: 'POST',
        suggestedMappings: [],
        bindToMenu: true,
        menuIcon: 'logout',
      },
      {
        name: '验证接口',
        path: '/auth/validate',
        method: 'GET',
        suggestedMappings: [],
        bindToMenu: false,
        menuIcon: 'verify',
      },
      {
        name: '刷新接口',
        path: '/auth/refresh',
        method: 'POST',
        suggestedMappings: [{ sourcePath: 'token', targetKey: 'auth_token' }],
        bindToMenu: true,
        menuIcon: 'refresh',
      },
    ],
  },
};

export const authApi = {
  async getConfig(): Promise<AuthConfig> {
    return invoke('get_auth_config');
  },

  async updateConfig(config: AuthConfig): Promise<void> {
    return invoke('update_auth_config', { config });
  },

  async resetConfig(): Promise<void> {
    return invoke('reset_auth_config');
  },

  async getPresetConfig(preset: string): Promise<AuthConfig | null> {
    return invoke('get_preset_config', { preset });
  },

  async savePresetConfig(preset: string, config: AuthConfig): Promise<void> {
    return invoke('save_preset_config', { preset, config });
  },

  async deletePresetConfig(preset: string): Promise<void> {
    return invoke('delete_preset_config', { preset });
  },
};

export const iconsApi = {
  async getAllGroups(): Promise<IconGroup[]> {
    return invoke('get_all_groups');
  },

  async getGroup(id: string): Promise<IconGroup | null> {
    return invoke('get_group', { id });
  },

  async saveGroup(group: IconGroup): Promise<void> {
    return invoke('save_group', { group });
  },

  async deleteGroup(id: string): Promise<void> {
    return invoke('delete_group', { id });
  },

  async getAllIcons(): Promise<SystemIcon[]> {
    return invoke('get_all_icons');
  },

  async getIconsByGroup(groupId: string): Promise<SystemIcon[]> {
    return invoke('get_icons_by_group', { groupId });
  },

  async getIcon(id: string): Promise<SystemIcon | null> {
    return invoke('get_icon', { id });
  },

  async getIconFileUrl(filePath: string): Promise<string> {
    return invoke('get_icon_file_url', { filePath });
  },

  async getIconFileUrls(): Promise<Record<string, string>> {
    return invoke('get_icon_file_urls');
  },

  async saveIcon(icon: SystemIcon): Promise<void> {
    return invoke('save_icon', { icon });
  },

  async deleteIcon(id: string): Promise<void> {
    return invoke('delete_icon', { id });
  },

  async uploadIcon(
    groupId: string,
    fileData: Uint8Array,
    fileName: string,
    name?: string,
    description?: string | null,
  ): Promise<string> {
    return invoke('upload_icon', { name: name ?? null, description: description ?? null, groupId, fileData, fileName });
  },
};

export const settingsApi = {
  async get(key: string): Promise<string | null> {
    return invoke('get_setting', { key });
  },

  async set(key: string, value: string): Promise<void> {
    return invoke('set_setting', { key, value });
  },

  async delete(key: string): Promise<void> {
    return invoke('delete_setting', { key });
  },
};

export const dashboardApi = {
  async list(): Promise<Dashboard[]> {
    return invoke('list_dashboards');
  },

  async get(id: string): Promise<Dashboard> {
    return invoke('get_dashboard', { id });
  },

  async create(data: { name: string; width: number; height: number; description?: string }): Promise<Dashboard> {
    return invoke('create_dashboard', data);
  },

  async update(
    id: string,
    data: Partial<{
      name: string;
      description: string;
      width: number;
      height: number;
      layout: LayoutItem[];
      components: ComponentConfig[];
      theme: string;
    }>,
  ): Promise<Dashboard> {
    return invoke('update_dashboard', { id, dashboard: data });
  },

  async delete(id: string): Promise<void> {
    return invoke('delete_dashboard', { id });
  },

  async export(id: string, format: 'json' | 'png' | 'pdf'): Promise<string> {
    return invoke('export_dashboard', { id, format });
  },
};

export const datasourceApi = {
  async list(): Promise<DataSource[]> {
    const result = await invoke<Record<string, unknown>[]>('get_all_datasources');
    return result.map((ds) => ({
      ...ds,
      createdAt: typeof ds.createdAt === 'number' ? new Date(ds.createdAt * 1000).toISOString() : String(ds.createdAt),
      updatedAt: typeof ds.updatedAt === 'number' ? new Date(ds.updatedAt * 1000).toISOString() : String(ds.updatedAt),
    })) as DataSource[];
  },

  async get(id: string): Promise<DataSource | null> {
    const result = await invoke<Record<string, unknown> | null>('get_datasource', { id });
    if (!result) return null;
    return {
      ...result,
      createdAt:
        typeof result.createdAt === 'number'
          ? new Date(result.createdAt * 1000).toISOString()
          : String(result.createdAt),
      updatedAt:
        typeof result.updatedAt === 'number'
          ? new Date(result.updatedAt * 1000).toISOString()
          : String(result.updatedAt),
    } as DataSource;
  },

  async save(ds: PersistedDataSource): Promise<void> {
    return invoke('save_datasource', { ds });
  },

  async delete(id: string): Promise<void> {
    return invoke('delete_datasource', { id });
  },
};

export const databaseApi = {
  async testConnection(
    config: DatabaseConnectionConfig,
    testQuery?: string,
  ): Promise<{ success: boolean; message: string; data?: unknown }> {
    return invoke('db_test_connection', { config, testQuery: testQuery || null });
  },

  async executeQuery(
    config: DatabaseConnectionConfig,
    query: string,
  ): Promise<{
    success: boolean;
    message: string;
    data?: unknown;
    rows?: Record<string, unknown>[];
    columns?: string[];
  }> {
    const result = await invoke<{ success: boolean; message: string; data?: unknown }>('db_execute_query', {
      config,
      query,
    });
    // 后端返回 { success, message, data: { rows, columns, rowsAffected } }
    // 提取 rows 和 columns 到顶层，方便调用方使用
    const data = result.data as Record<string, unknown> | undefined;
    return {
      ...result,
      rows:
        (data?.rows as Record<string, unknown>[]) ||
        (Array.isArray(data) ? (data as Record<string, unknown>[]) : undefined),
      columns: data?.columns as string[] | undefined,
    };
  },

  /** 获取数据库所有表列表 */
  async getTables(config: DatabaseConnectionConfig): Promise<string[]> {
    const dbType = config.dbType;
    // 不同数据库的表列表查询 SQL
    const tableQueries: Record<string, string> = {
      mysql: `SHOW TABLES`,
      postgresql: `SELECT tablename as name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      greptimedb: `SHOW TABLES`,
      clickhouse: `SHOW TABLES`,
      influxdb: `SHOW MEASUREMENTS`,
      mongodb: `SELECT name FROM system.collections`,
      redis: `SELECT 1`,
    };
    const query = tableQueries[dbType] || tableQueries.mysql;
    console.log('[getTables] dbType:', dbType, 'query:', query);
    const result = await this.executeQuery(config, query);
    console.log('[getTables] result:', JSON.stringify(result).slice(0, 500));
    if (!result.success) return [];

    // executeQuery 已将 rows 提取到顶层
    const rows = result.rows || [];
    console.log('[getTables] rows count:', rows.length, 'first row:', rows[0] ? JSON.stringify(rows[0]) : 'empty');

    return rows
      .map((row) => {
        // SHOW TABLES 返回格式：MySQL 返回 { "Tables_in_xxx": "tablename" }
        // 尝试所有可能的字段名
        const name =
          row.name ||
          row.TABLE_NAME ||
          row.tablename ||
          row.measurement ||
          row.Tables_in_database ||
          row[`Tables_in_${config.database}`] ||
          Object.values(row)[0];
        return String(name);
      })
      .filter(Boolean);
  },

  /** 获取表的所有字段列表 */
  async getColumns(config: DatabaseConnectionConfig, table: string): Promise<Array<{ name: string; type: string }>> {
    const dbType = config.dbType;
    const columnQueries: Record<string, string> = {
      mysql: `SHOW COLUMNS FROM \`${table}\``,
      postgresql: `SELECT column_name as name, data_type as type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' ORDER BY ordinal_position`,
      greptimedb: `DESC ${table}`,
      clickhouse: `DESC ${table}`,
      influxdb: `SHOW FIELD KEYS FROM ${table}`,
      mongodb: `SELECT * FROM ${table} LIMIT 1`,
      redis: `SELECT 1`,
    };
    const query = columnQueries[dbType] || columnQueries.mysql;
    console.log('[getColumns] dbType:', dbType, 'table:', table, 'query:', query);
    const result = await this.executeQuery(config, query);
    console.log('[getColumns] result:', JSON.stringify(result).slice(0, 500));
    if (!result.success) return [];

    // executeQuery 已将 rows 提取到顶层
    const rows = result.rows || [];
    console.log('[getColumns] rows count:', rows.length, 'first row:', rows[0] ? JSON.stringify(rows[0]) : 'empty');

    return rows
      .map((row) => {
        // SHOW COLUMNS FROM 返回：{ Field: "id", Type: "int(11)", ... }
        // INFORMATION_SCHEMA 返回：{ name: "id", type: "int" }
        const name = String(
          row.name || row.column_name || row.COLUMN_NAME || row.Field || row.field || Object.keys(row)[0] || '',
        );
        const type = String(row.type || row.data_type || row.DATA_TYPE || row.Type || 'unknown');
        return { name, type };
      })
      .filter((c) => c.name);
  },
};

export const metricApi = {
  async query(params: {
    sourceId: string;
    metricName: string;
    startTime: number;
    endTime: number;
    interval?: string;
  }): Promise<MetricData[]> {
    return invoke('query_metrics', params);
  },

  async getLatest(sourceId: string): Promise<Record<string, number>> {
    return invoke('get_latest_metrics', { sourceId });
  },

  async subscribe(params: { sourceId: string; metricNames: string[] }): Promise<void> {
    return invoke('subscribe_metrics', params);
  },
};

export const alertApi = {
  async listRules(): Promise<unknown[]> {
    return invoke('list_alert_rules');
  },

  async createRule(rule: {
    name: string;
    sourceId?: string;
    metricName: string;
    condition: string;
    severity: string;
  }): Promise<unknown> {
    return invoke('create_alert_rule', { rule });
  },

  async getHistory(params: { ruleId?: string; limit: number }): Promise<unknown[]> {
    return invoke('get_alert_history', params);
  },

  async acknowledge(alertId: number): Promise<void> {
    return invoke('acknowledge_alert', { alertId });
  },
};

export const systemApi = {
  async getSettings(): Promise<Record<string, unknown>> {
    return invoke('get_settings');
  },

  async updateSettings(settings: Record<string, unknown>): Promise<void> {
    return invoke('update_settings', { settings });
  },

  async getSystemInfo(): Promise<{
    version: string;
    platform: string;
    memory: number;
    cpu: number;
  }> {
    return invoke('get_system_info');
  },
};

interface PersistedScene {
  id: string;
  name: string;
  description?: string;
  coordinateSystem: string;
  camera: string;
  bounds?: string;
  layers: string;
  bindings: string;
  variables?: string;
  layout: string;
  editorComponents?: string;
  editorLayers?: string;
  canvasConfig?: string;
  globalComponents?: string;
  views?: string;
  activeViewId?: string;
  viewportSyncRules?: string;
  categoryId?: string;
  tags: string;
  thumbnail?: string;
  status: string;
  metadata: string;
  createdAt: number;
  updatedAt: number;
}

function toPersistedScene(scene: SceneDSL): PersistedScene {
  return {
    id: scene.id,
    name: scene.name,
    description: scene.description,
    coordinateSystem: scene.coordinateSystem,
    camera: JSON.stringify(scene.camera),
    bounds: scene.bounds ? JSON.stringify(scene.bounds) : undefined,
    layers: JSON.stringify(scene.layers),
    bindings: JSON.stringify(scene.bindings),
    variables: scene.variables ? JSON.stringify(scene.variables) : undefined,
    layout: JSON.stringify(scene.layout),
    editorComponents: scene.editorComponents ? JSON.stringify(scene.editorComponents) : undefined,
    editorLayers: scene.editorLayers ? JSON.stringify(scene.editorLayers) : undefined,
    canvasConfig: scene.canvasConfig ? JSON.stringify(scene.canvasConfig) : undefined,
    globalComponents: scene.globalComponents ? JSON.stringify(scene.globalComponents) : undefined,
    views: scene.views ? JSON.stringify(scene.views) : undefined,
    activeViewId: scene.activeViewId || undefined,
    viewportSyncRules: scene.viewportSyncRules ? JSON.stringify(scene.viewportSyncRules) : undefined,
    categoryId: scene.categoryId,
    tags: JSON.stringify(scene.tags),
    thumbnail: scene.thumbnail,
    status: scene.status,
    metadata: JSON.stringify(scene.metadata),
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
  };
}

function toSceneDSL(persisted: PersistedScene): SceneDSL {
  return {
    id: persisted.id,
    name: persisted.name,
    description: persisted.description,
    coordinateSystem: persisted.coordinateSystem as SceneDSL['coordinateSystem'],
    camera: JSON.parse(persisted.camera || '{}'),
    bounds: persisted.bounds ? JSON.parse(persisted.bounds) : undefined,
    layers: JSON.parse(persisted.layers || '[]'),
    bindings: JSON.parse(persisted.bindings || '[]'),
    variables: persisted.variables ? JSON.parse(persisted.variables) : undefined,
    layout: JSON.parse(persisted.layout || '[]'),
    editorComponents: persisted.editorComponents ? JSON.parse(persisted.editorComponents) : undefined,
    editorLayers: persisted.editorLayers ? JSON.parse(persisted.editorLayers) : undefined,
    canvasConfig: persisted.canvasConfig ? JSON.parse(persisted.canvasConfig) : undefined,
    globalComponents: persisted.globalComponents ? JSON.parse(persisted.globalComponents) : undefined,
    views: persisted.views ? JSON.parse(persisted.views) : undefined,
    activeViewId: persisted.activeViewId || undefined,
    viewportSyncRules: persisted.viewportSyncRules ? JSON.parse(persisted.viewportSyncRules) : undefined,
    categoryId: persisted.categoryId,
    tags: JSON.parse(persisted.tags || '[]'),
    thumbnail: persisted.thumbnail,
    status: (persisted.status || 'draft') as SceneDSL['status'],
    metadata: JSON.parse(persisted.metadata || '{}'),
    createdAt: persisted.createdAt,
    updatedAt: persisted.updatedAt,
  };
}

export const sceneApi = {
  async list(): Promise<SceneDSL[]> {
    const result = await invoke<PersistedScene[]>('get_all_scenes');
    return result.map(toSceneDSL);
  },

  async get(id: string): Promise<SceneDSL | null> {
    const result = await invoke<PersistedScene | null>('get_scene', { id });
    if (!result) return null;
    return toSceneDSL(result);
  },

  async listByCategory(categoryId: string): Promise<SceneDSL[]> {
    const result = await invoke<PersistedScene[]>('get_scenes_by_category', { categoryId });
    return result.map(toSceneDSL);
  },

  async create(scene: SceneDSL): Promise<void> {
    const persisted = toPersistedScene(scene);
    logger.info('SceneApi', 'Invoking create_scene', {
      id: persisted.id,
      name: persisted.name,
      thumbnail: persisted.thumbnail,
    });
    return invoke('create_scene', { scene: persisted });
  },

  async update(scene: SceneDSL): Promise<void> {
    const persisted = toPersistedScene(scene);
    logger.info('SceneApi', 'Invoking update_scene', {
      id: persisted.id,
      name: persisted.name,
      thumbnail: persisted.thumbnail,
    });
    return invoke('update_scene', { scene: persisted });
  },

  async delete(id: string): Promise<void> {
    logger.info('SceneApi', 'Invoking delete_scene', { id });
    return invoke('delete_scene', { id });
  },

  async listCategories(): Promise<SceneCategory[]> {
    return invoke('get_all_categories');
  },

  async getCategory(id: string): Promise<SceneCategory | null> {
    return invoke('get_category', { id });
  },

  async saveCategory(category: SceneCategory): Promise<void> {
    return invoke('save_category', { category });
  },

  async deleteCategory(id: string): Promise<void> {
    return invoke('delete_category', { id });
  },
};

// ═══════════════════════════════════════════════════════
// sight-folio 项目分析 API（分析器能力，叠加在参考实现之上）
// ═══════════════════════════════════════════════════════
import type { AnalysisDSL, AnalysisCategory } from '../types/scene';

interface PersistedAnalysis {
  id: string;
  name: string;
  description?: string;
  projectRoot: string;
  categoryId?: string;
  tags: string;
  status: string;
  metadata: string;
  scanStatus: string;
  scanProgress: number;
  lastScannedAt?: number;
  totalFiles: number;
  totalLines: number;
  primaryLanguage?: string;
  editorComponents?: string;
  editorLayers?: string;
  canvasConfig?: string;
  globalComponents?: string;
  views?: string;
  activeViewId?: string;
  viewportSyncRules?: string;
  createdAt: number;
  updatedAt: number;
}

function toPersistedAnalysis(analysis: AnalysisDSL): PersistedAnalysis {
  return {
    id: analysis.id,
    name: analysis.name,
    description: analysis.description,
    projectRoot: analysis.projectRoot,
    categoryId: analysis.categoryId,
    tags: JSON.stringify(analysis.tags || []),
    status: analysis.status,
    metadata: JSON.stringify(analysis.metadata || {}),
    scanStatus: analysis.scanStatus,
    scanProgress: analysis.scanProgress,
    lastScannedAt: analysis.lastScannedAt,
    totalFiles: analysis.totalFiles,
    totalLines: analysis.totalLines,
    primaryLanguage: analysis.primaryLanguage,
    editorComponents: analysis.editorComponents ? JSON.stringify(analysis.editorComponents) : undefined,
    editorLayers: analysis.editorLayers ? JSON.stringify(analysis.editorLayers) : undefined,
    canvasConfig: analysis.canvasConfig ? JSON.stringify(analysis.canvasConfig) : undefined,
    globalComponents: analysis.globalComponents ? JSON.stringify(analysis.globalComponents) : undefined,
    views: analysis.views ? JSON.stringify(analysis.views) : undefined,
    activeViewId: analysis.activeViewId,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
  };
}

function toAnalysisDSL(p: PersistedAnalysis): AnalysisDSL {
  const base = createDefaultScene();
  return {
    ...base,
    id: p.id,
    name: p.name,
    description: p.description,
    projectRoot: p.projectRoot || '',
    categoryId: p.categoryId,
    tags: JSON.parse(p.tags || '[]'),
    status: (p.status || 'draft') as AnalysisDSL['status'],
    metadata: JSON.parse(p.metadata || '{}'),
    scanStatus: (p.scanStatus || 'pending') as AnalysisDSL['scanStatus'],
    scanProgress: p.scanProgress || 0,
    lastScannedAt: p.lastScannedAt,
    totalFiles: p.totalFiles || 0,
    totalLines: p.totalLines || 0,
    primaryLanguage: p.primaryLanguage,
    editorComponents: p.editorComponents ? JSON.parse(p.editorComponents) : undefined,
    editorLayers: p.editorLayers ? JSON.parse(p.editorLayers) : undefined,
    canvasConfig: p.canvasConfig ? JSON.parse(p.canvasConfig) : undefined,
    globalComponents: p.globalComponents ? JSON.parse(p.globalComponents) : undefined,
    views: p.views ? JSON.parse(p.views) : undefined,
    activeViewId: p.activeViewId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export const analysisApi = {
  async list(): Promise<AnalysisDSL[]> {
    const result = await invoke<PersistedAnalysis[]>('get_all_analyses');
    return result.map(toAnalysisDSL);
  },
  async get(id: string): Promise<AnalysisDSL | null> {
    const result = await invoke<PersistedAnalysis | null>('get_analysis', { id });
    if (!result) return null;
    return toAnalysisDSL(result);
  },
  async listByCategory(categoryId: string): Promise<AnalysisDSL[]> {
    const result = await invoke<PersistedAnalysis[]>('get_analyses_by_category', { categoryId });
    return result.map(toAnalysisDSL);
  },
  async create(analysis: AnalysisDSL): Promise<void> {
    const persisted = toPersistedAnalysis(analysis);
    logger.info('AnalysisApi', 'Creating analysis', { id: persisted.id, name: persisted.name });
    return invoke('create_analysis', { analysis: persisted });
  },
  async update(analysis: AnalysisDSL): Promise<void> {
    const persisted = toPersistedAnalysis(analysis);
    logger.info('AnalysisApi', 'Updating analysis', { id: persisted.id, name: persisted.name });
    return invoke('update_analysis', { analysis: persisted });
  },
  async delete(id: string): Promise<void> {
    logger.info('AnalysisApi', 'Deleting analysis', { id });
    return invoke('delete_analysis', { id });
  },
  async listCategories(): Promise<AnalysisCategory[]> {
    return invoke('get_all_analysis_categories');
  },
  async getCategory(id: string): Promise<AnalysisCategory | null> {
    return invoke('get_analysis_category', { id });
  },
  async saveCategory(category: AnalysisCategory): Promise<void> {
    return invoke('save_analysis_category', { category });
  },
  async deleteCategory(id: string): Promise<void> {
    return invoke('delete_analysis_category', { id });
  },
};

export interface ScanJob {
  id: string;
  analysisId: string;
  status: string;
  progress: number;
  filesScanned: number;
  totalFiles: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  config: string;
  createdAt: number;
}
export interface ProjectFile {
  id: string;
  analysisId: string;
  path: string;
  relPath: string;
  name: string;
  extension: string | null;
  language: string | null;
  size: number;
  lineCount: number;
  contentHash: string | null;
  parentId: string | null;
  isDirectory: boolean;
  layerId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  metadata: string;
  scannedAt: number;
}
/** 扫描新鲜度体检结果（对应后端 check_scan_freshness） */
export interface ScanFreshness {
  stale: boolean;
  lastScannedAt: number | null;
  scannedFileCount: number;
  currentFileCount: number;
  added: string[];
  removed: string[];
  modified: string[];
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
}
export interface ProjectModule {
  id: string;
  analysisId: string;
  name: string;
  description: string | null;
  layerId: string | null;
  fileCount: number;
  depCount: number;
  beDepCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  metadata: string;
  createdAt: number;
  updatedAt: number;
}
export interface ProjectDependency {
  id: string;
  analysisId: string;
  fromId: string;
  fromType: string;
  toId: string;
  toType: string;
  kind: string;
  lineNo: number | null;
  isCircular: boolean;
  weight: number;
  metadata: string;
  detectedAt: number;
}
export interface ProjectLayer {
  id: string;
  analysisId: string;
  name: string;
  color: string;
  sortOrder: number;
  yPosition: number;
  description: string | null;
  rulePattern: string | null;
  metadata: string;
  createdAt: number;
  updatedAt: number;
}
export interface ReviewRule {
  id: string;
  name: string;
  description: string | null;
  ruleType: string;
  targetType: string;
  ruleBody: string;
  severity: string;
  enabled: boolean;
  scope: string;
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 后端解析器真实能力矩阵（R45，来自 parser::ParserCapabilities）。
 * 前端激活/展示插件时以此为准，避免「前端声明了、后端没实现」的脱节
 * （历史：vue 声明 dependencyAnalysis:true 但后端无 vue 依赖解析）。
 */
export interface ParserCapability {
  language: string;
  symbols: boolean;
  deps: boolean;
  symbolRefs: boolean;
  ast: boolean;
}
export interface ReviewFinding {
  id: string;
  analysisId: string;
  ruleId: string | null;
  targetId: string;
  targetType: string;
  severity: string;
  message: string;
  suggestion: string | null;
  status: string;
  foundAt: number;
  fixedAt: number | null;
  metadata: string;
}

// ─── 代码结构索引（analyze_code_structure）───
export interface ProjectSymbol {
  id: string;
  analysisId: string;
  fileId: string;
  filePath: string;
  name: string;
  kind: string;
  lineStart: number;
  lineEnd: number;
  signature: string;
  doc: string | null;
  modifiers: string;
  patterns: string;
  metadata: string;
  createdAt: number;
}
export interface PatternHit {
  pattern: string;
  name: string;
  symbolName: string;
  filePath: string;
  line: number;
  evidence: string;
  /**
   * 置信度 0..1（后端证据加权得分）
   *
   * 设计模式识别本质是启发式推断。旧引擎只给布尔命中，把猜测当事实输出，
   * 实测误报率极高（本项目前端 138 处「建造者模式」命中全部是把
   * `return this.state` 当成了链式返回）。新引擎按证据加权打分并把分数带到前端，
   * 命中阈值 0.6，而最强的命名信号只有 0.55 —— 仅靠类名永远无法单独命中。
   * 旧扫描数据无此字段，后端反序列化时补 0.5。
   */
  confidence: number;
  /** 判定依据清单（前端悬浮展示，让用户自己判断这条推断站不站得住） */
  signals: string[];
  /** 分类：creational / structural / behavioral / architectural */
  category: string;
}
export interface StructureSummary {
  totalSymbols: number;
  filesWithSymbols: number;
  byKind: Record<string, number>;
  patterns: PatternHit[];
}

// ─── 符号级引用索引（analyze_symbol_references）───
export interface ProjectSymbolRef {
  id: string;
  analysisId: string;
  fromFileId: string;
  fromFilePath: string;
  toSymbolId: string | null;
  toFileId: string;
  toFilePath: string;
  symbolName: string;
  refLine: number;
  refText: string;
  kind: string;
  createdAt: number;
}

// ─── 文件级度量（analyze_file_metrics，复杂度热力图数据源）───
export interface FileMetric {
  id: string;
  analysisId: string;
  fileId: string;
  filePath: string;
  totalLines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  cyclomaticComplexity: number;
  /** 复杂度等级：low | medium | high | extreme */
  complexityLevel: string;
  metadata: string;
  createdAt: number;
  /**
   * 度量引擎：`ast`（tree-sitter 精确解析）| `heuristic`（行级关键字估算）。
   * 两种精度必须在 UI 上区分展示，否则用户会把估算值当成事实。
   */
  engine: string;
  /** 全文件最大控制流嵌套深度（AST 独有，heuristic 时为 0） */
  maxNesting: number;
  /** 函数/方法数量（AST 独有） */
  functionCount: number;
  /** 单函数最高圈复杂度（AST 独有）——比文件总 CC 更能指认难维护的代码 */
  maxFunctionCc: number;
  /** 最复杂函数名（AST 独有） */
  hotFunction: string;
  /** 阈值型魔法数字个数（AST 独有） */
  magicNumberCount: number;
}

/** AST 解析出的单个函数度量（存放于 FileMetric.metadata.functions） */
export interface AstFunctionMetric {
  name: string;
  line: number;
  endLine: number;
  lines: number;
  cc: number;
  params: number;
  maxNesting: number;
}

/** AST 解析出的阈值魔法数字（存放于 FileMetric.metadata.magicNumbers） */
export interface AstMagicNumber {
  line: number;
  value: string;
  snippet: string;
}

/** FileMetric.metadata 的解析结果 */
export interface FileMetricMeta {
  language?: string;
  engine?: string;
  hasError?: boolean;
  /** 语法错误所在行号（1 起；R46 起由 tree-sitter ERROR/MISSING 节点提取） */
  errorLines?: number[];
  functions?: AstFunctionMetric[];
  magicNumbers?: AstMagicNumber[];
}

/**
 * 安全解析 FileMetric.metadata。
 *
 * metadata 是 TEXT 列，历史数据里可能是 `{"language":"rust"}` 这种旧格式。
 * 解析失败一律返回空对象——绝不让一条脏数据把整张热力图打崩。
 */
export function parseFileMetricMeta(metric: Pick<FileMetric, 'metadata'>): FileMetricMeta {
  try {
    const raw = JSON.parse(metric.metadata || '{}');
    if (!raw || typeof raw !== 'object') return {};
    return raw as FileMetricMeta;
  } catch {
    return {};
  }
}

// ─── 技术债标记（scan_tech_debt，TODO/FIXME/HACK/XXX/OPTIMIZE/DEPRECATED）───
export interface TechDebtItem {
  id: string;
  analysisId: string;
  fileId: string;
  filePath: string;
  lineNo: number;
  /** 标记类型：TODO | FIXME | HACK | XXX | OPTIMIZE | DEPRECATED */
  marker: string;
  /** 严重度：info | warning | critical */
  severity: string;
  /** 该行原文（截断） */
  snippet: string;
  createdAt: number;
}

// ─── 代码克隆 / 重复代码（detect_code_clones，winnowing 指纹）───
/**
 * 一条记录 = 一段重复代码的一个「出现位置」。
 * 同一 groupId 的多条记录构成一个「克隆组」（同一段代码出现了 groupSize 次）。
 */
export interface CodeClone {
  id: string;
  analysisId: string;
  /** 克隆组标识：同段代码的所有实例共享 */
  groupId: string;
  fileId: string;
  filePath: string;
  /** 片段起止行号（1 起始，含） */
  startLine: number;
  endLine: number;
  /** 参与比对的有效行数 */
  lineCount: number;
  /** 该克隆组的实例总数 */
  groupSize: number;
  /** 片段首行原文（截断） */
  snippet: string;
  language: string;
  /** 克隆类型：type1 = 逐字重复；type2 = 参数化克隆（标识符重命名后结构相同） */
  cloneType: string;
  createdAt: number;
}

// ─── 代码全文索引（index_code_content / search_code_content）───
export interface CodeIndexEntry {
  id: string;
  analysisId: string;
  fileId: string;
  filePath: string;
  lineNo: number;
  content: string;
  createdAt: number;
}

// ─── 死代码检测（detect_dead_symbols）───
export interface DeadSymbol {
  symbolId: string;
  analysisId: string;
  fileId: string;
  filePath: string;
  name: string;
  kind: string;
  lineStart: number;
  lineEnd: number;
  /** exported | internal */
  visibility: string;
  /** high | medium | low */
  confidence: string;
  /** 判定说明 */
  reason: string;
}

// ─── Git 变更热点（analyze_git_history）───
export interface GitChurn {
  id: string;
  analysisId: string;
  fileId: string;
  filePath: string;
  commitCount: number;
  addedLines: number;
  deletedLines: number;
  authorCount: number;
  lastCommitAt: number;
  firstCommitAt: number;
  churnScore: number;
  /** low | medium | high | extreme */
  hotspotLevel: string;
  createdAt: number;
}

// ─── 变更耦合（analyze_change_coupling）───
/**
 * 一对「总是一起改」的文件。
 *
 * 依赖分析回答「谁 import 谁」（显性耦合），本结构回答「谁总和谁一起改」。
 * `couplingKind === "hidden"` 表示两者之间**没有任何静态依赖**却高度共变
 * —— 前后端契约、多处复制的常量、抽象泄漏都属此类，是静态工具永远发现不了
 * 的隐性架构风险。
 */
export interface ChangeCoupling {
  id: string;
  analysisId: string;
  fileAId: string;
  fileAPath: string;
  fileBId: string;
  fileBPath: string;
  /** 共同出现的提交数 */
  coChanges: number;
  commitsA: number;
  commitsB: number;
  /** 耦合度 co / min(a,b)，0..1 */
  degree: number;
  /** Jaccard co / (a+b-co)，0..1，用于识别单侧高频的伪耦合 */
  jaccard: number;
  /** 是否存在静态依赖（任一方向） */
  isStructural: boolean;
  /** 是否跨顶层模块 */
  crossModule: boolean;
  /** structural | hidden */
  couplingKind: string;
  /** low | medium | high | extreme */
  riskLevel: string;
  lastCoChangeAt: number;
  createdAt: number;
}

// ─── 过程间数据流摘要（analyze_data_flow）───
/**
 * 一个函数的 def-use 摘要（IFDS 意义上的 function summary）。
 *
 * 调用图回答「A 调了 B」，本结构回答「**B 会不会把收到的数据再传出去**」：
 * - `propagates === false` → 污染终止点（只打日志/只落库），影响链到此不再向上游扩散
 * - `sinks` 非空 → 该函数把入参写进了外部状态，改动会波及共享状态的所有读取方
 */
export interface DataFlowFact {
  id: string;
  analysisId: string;
  fileId: string;
  filePath: string;
  functionName: string;
  lineNo: number;
  /** 形参列表，逗号分隔 */
  params: string;
  /** 流向返回值的形参，逗号分隔 */
  paramToReturn: string;
  /** 是否透传（输入变化会传导到输出） */
  propagates: boolean;
  returnsCallResult: boolean;
  /** 形参 → 下游实参，JSON 数组字符串 */
  callFlows: string;
  /** 写入的外部状态，JSON 数组字符串 */
  sinks: string;
  createdAt: number;
}

export interface DataFlowHotspot {
  functionName: string;
  filePath: string;
  lineNo: number;
  count: number;
  detail: string;
}

export interface DataFlowSummary {
  analyzedFiles: number;
  functions: number;
  /** 透传函数数（污染放行） */
  propagating: number;
  /** 阻断函数数（污染终止 —— 影响链剪枝依据） */
  blocking: number;
  sinkFunctions: number;
  paramFlows: number;
  topSinks: DataFlowHotspot[];
}

// ─── 源码内容（read_source_file）───
export interface SourceFileContent {
  fileId: string;
  path: string;
  relPath: string;
  name: string;
  language: string;
  /** 按行切好的源码（下标 0 = 第 1 行） */
  lines: string[];
  totalLines: number;
  /** 超过 6000 行被截断 */
  truncated: boolean;
  /** 二进制/过大/读取失败时的说明，非 null 时 lines 为空 */
  skippedReason: string | null;
}

// ─── 函数调用图（analyze_call_graph）───
export interface CallEdge {
  id: string;
  analysisId: string;
  callerSymbolId: string;
  callerName: string;
  callerFileId: string;
  callerFilePath: string;
  calleeSymbolId: string;
  calleeName: string;
  calleeFileId: string;
  calleeFilePath: string;
  lineNo: number;
  /** internal | cross-file */
  kind: string;
  /** 被调方接收者根标识符（如 `obj.method()` → "obj"；裸调用为空串）；用于区分同名 sink */
  calleeReceiver?: string;
  /** 被调方解析到的接收者声明类型名（如 `ClassA.foo()` → "ClassA"；裸函数/未锁定为空串）。
   *  对标 joern：joern 动态分派超近似丢失接收者类型，这里给出精确类型名，影响面画像按类型区分同名方法。 */
  receiverTarget?: string;
  createdAt: number;
}

export interface CallHotspot {
  symbolId: string;
  name: string;
  filePath: string;
  count: number;
}

export interface CallGraphSummary {
  totalEdges: number;
  crossFileEdges: number;
  functions: number;
  topCallers: CallHotspot[];
  topCallees: CallHotspot[];
}

export const projectScanApi = {
  async scan(
    analysisId: string,
    projectRoot: string,
    opts?: { excludeDirs?: string[]; excludeResources?: boolean },
  ): Promise<ScanJob> {
    return invoke('scan_project', {
      analysisId,
      projectRoot,
      excludeDirs: opts?.excludeDirs ?? undefined,
      excludeResources: opts?.excludeResources ?? undefined,
    });
  },
  /** 项目根是否存在 .gitignore（有 → 扫描按它过滤；无 → 提示可手动过滤） */
  async checkGitignore(projectRoot: string): Promise<boolean> {
    return invoke('check_gitignore', { projectRoot });
  },
  /** 扫描新鲜度体检：对比上次扫描快照与当前磁盘，判断数据是否过时 */
  async checkScanFreshness(
    analysisId: string,
    projectRoot: string,
    opts?: { excludeDirs?: string[]; excludeResources?: boolean },
  ): Promise<ScanFreshness> {
    return invoke('check_scan_freshness', {
      analysisId,
      projectRoot,
      excludeDirs: opts?.excludeDirs ?? undefined,
      excludeResources: opts?.excludeResources ?? undefined,
    });
  },
  /** 保存扫描排除配置（手动排除目录 + 是否排除非代码资源）到 analysis metadata */
  async saveScanExcludes(analysisId: string, excludeDirs: string[], excludeResources: boolean): Promise<void> {
    return invoke('save_scan_excludes', {
      analysisId,
      excludeDirs,
      excludeResources,
    });
  },
  async cancel(jobId: string): Promise<void> {
    return invoke('cancel_scan_job', { jobId });
  },
  /** 取消深度分析阶段（结构/符号/度量/技术债/克隆/审查），与 cancel 共同覆盖整条扫描流水线 */
  async cancelAnalysis(analysisId: string): Promise<void> {
    return invoke('cancel_analysis', { analysisId });
  },
  /** 复位深度分析取消标志（新扫描开始时调用，避免上次取消残留） */
  async resetAnalysisCancel(analysisId: string): Promise<void> {
    return invoke('reset_analysis_cancel', { analysisId });
  },
  async latestJob(analysisId: string): Promise<ScanJob | null> {
    return invoke('get_latest_scan_job', { analysisId });
  },
  /**
   * 增量差异：本轮扫描中内容哈希变化（或新增）的文件相对路径。
   *
   * 两态语义不可退化成空数组：
   * - `null`  —— 无基线（首扫 / 快照缺失）→ 调用方走全量重算
   * - `[]`    —— 有基线且**零文件变更**（重复扫描同一份代码），增量收益最大的场景
   */
  async getScanDelta(analysisId: string): Promise<string[] | null> {
    return invoke('get_scan_delta', { analysisId });
  },
  async listFiles(analysisId: string): Promise<ProjectFile[]> {
    return invoke('list_project_files', { analysisId });
  },
  async listModules(analysisId: string): Promise<ProjectModule[]> {
    return invoke('list_project_modules', { analysisId });
  },
  async listDependencies(analysisId: string): Promise<ProjectDependency[]> {
    return invoke('list_project_dependencies', { analysisId });
  },
  async listLayers(analysisId: string): Promise<ProjectLayer[]> {
    return invoke('list_project_layers', { analysisId });
  },
  async listRules(): Promise<ReviewRule[]> {
    return invoke('list_review_rules');
  },
  async listFindings(analysisId: string): Promise<ReviewFinding[]> {
    return invoke('list_review_findings', { analysisId });
  },
  async countBySeverity(analysisId: string): Promise<Record<string, number>> {
    return invoke('count_findings_by_severity', { analysisId });
  },
  async runReviewRules(analysisId: string): Promise<ReviewFinding[]> {
    return invoke('run_review_rules', { analysisId });
  },
  /** 同步前端分析器插件声明的规则到后端规则引擎（§4.2 RuleRegistry ↔ 引擎）。返回新增数量 */
  async syncAnalyzerRules(rules: ReviewRule[]): Promise<number> {
    return invoke('sync_analyzer_rules', { rules });
  },
  async detectDependencies(analysisId: string, projectRoot: string): Promise<ProjectDependency[]> {
    return invoke('detect_dependencies', { analysisId, projectRoot });
  },
  /** 后端解析器能力矩阵（R45 前后端能力联动：前端按真实能力对齐） */
  async listParserCapabilities(): Promise<ParserCapability[]> {
    return invoke('list_parser_capabilities');
  },
  /** 查询指定语言的后端能力（激活插件前校验） */
  async parserCapabilityFor(language: string): Promise<ParserCapability | null> {
    return invoke('parser_capability_for', { language });
  },
  async saveLayer(layer: ProjectLayer): Promise<void> {
    return invoke('save_project_layer', { layer });
  },
  async deleteLayer(id: string): Promise<void> {
    return invoke('delete_project_layer', { id });
  },
  async syncFilesToCanvas(analysisId: string, projectRoot: string): Promise<void> {
    return invoke('sync_files_to_canvas', { analysisId, projectRoot });
  },
  // ─── 代码结构索引 ───
  /** 分析代码结构（提取类/函数/接口等符号 + 检测设计模式），返回摘要 */
  async analyzeCodeStructure(analysisId: string, changedRelPaths?: string[]): Promise<StructureSummary> {
    return invoke('analyze_code_structure', {
      analysisId,
      changedRelPaths: changedRelPaths ?? null,
    });
  },
  async listSymbols(analysisId: string): Promise<ProjectSymbol[]> {
    return invoke('list_project_symbols', { analysisId });
  },
  async countSymbolsByKind(analysisId: string): Promise<Record<string, number>> {
    return invoke('count_symbols_by_kind', { analysisId });
  },
  async listDesignPatterns(analysisId: string): Promise<PatternHit[]> {
    return invoke('list_design_patterns', { analysisId });
  },
  /** 对既有分析重新检测设计模式（从源码重算，无需整库重扫），写回符号表并返回命中 */
  async redetectDesignPatterns(analysisId: string, projectRoot: string): Promise<PatternHit[]> {
    return invoke('redetect_design_patterns', { analysisId, projectRoot });
  },
  // ─── 符号级引用分析 + 符号索引搜索 ───
  /** 分析符号级引用（import 语句 → 目标符号匹配），返回引用边列表 */
  async analyzeSymbolReferences(analysisId: string, changedRelPaths?: string[]): Promise<ProjectSymbolRef[]> {
    return invoke('analyze_symbol_references', {
      analysisId,
      changedRelPaths: changedRelPaths ?? null,
    });
  },
  async listSymbolRefs(analysisId: string): Promise<ProjectSymbolRef[]> {
    return invoke('list_symbol_refs', { analysisId });
  },
  /** 符号索引搜索（name/file_path 模糊匹配，kind 权重排序） */
  async searchSymbols(analysisId: string, query: string, limit?: number): Promise<ProjectSymbol[]> {
    return invoke('search_project_symbols', { analysisId, query, limit: limit ?? 8 });
  },
  // ─── 文件度量分析（复杂度热力图）───
  /**
   * 分析全部文件的度量指标（行数/注释/圈复杂度），写入并返回。
   * 传入 changedRelPaths（增量差异）时只重算变更文件，其余按路径携带既有结果。
   */
  async analyzeFileMetrics(analysisId: string, changedRelPaths?: string[]): Promise<FileMetric[]> {
    return invoke('analyze_file_metrics', { analysisId, changedRelPaths: changedRelPaths ?? null });
  },
  async listFileMetrics(analysisId: string): Promise<FileMetric[]> {
    return invoke('list_file_metrics', { analysisId });
  },
  // ─── 技术债扫描（TODO/FIXME/HACK 等标记）───
  /**
   * 扫描全部源码文件的技术债标记（TODO/FIXME/HACK/XXX/OPTIMIZE/DEPRECATED），写入并返回。
   * 传入 changedRelPaths 时只重扫变更文件，其余按路径携带既有结果。
   */
  async scanTechDebt(analysisId: string, changedRelPaths?: string[]): Promise<TechDebtItem[]> {
    return invoke('scan_tech_debt', { analysisId, changedRelPaths: changedRelPaths ?? null });
  },
  async listTechDebt(analysisId: string): Promise<TechDebtItem[]> {
    return invoke('list_tech_debt', { analysisId });
  },
  // ─── 代码克隆检测（重复率，winnowing 指纹）───
  /** 检测项目中的重复代码块，写入并返回全部克隆实例 */
  async detectCodeClones(analysisId: string): Promise<CodeClone[]> {
    return invoke('detect_code_clones', { analysisId });
  },
  async listCodeClones(analysisId: string): Promise<CodeClone[]> {
    return invoke('list_code_clones', { analysisId });
  },
  // ─── 代码全文索引（search_code_content 检索跳转）───
  /**
   * 为分析的全部源码文件建立代码行索引，返回索引行数。
   * 传入 changedRelPaths 时只重建变更文件的索引，其余按路径携带既有条目。
   */
  async indexCodeContent(analysisId: string, changedRelPaths?: string[]): Promise<number> {
    return invoke('index_code_content', { analysisId, changedRelPaths: changedRelPaths ?? null });
  },
  /** 按内容片段全文检索当前分析的代码索引 */
  async searchCodeContent(analysisId: string, query: string, limit?: number): Promise<CodeIndexEntry[]> {
    return invoke('search_code_content', { analysisId, query, limit: limit ?? 12 });
  },
  /** 当前分析的代码索引行数（判断是否需要建索引） */
  async countCodeIndex(analysisId: string): Promise<number> {
    return invoke('count_code_index', { analysisId });
  },
  // ─── 死代码检测（零引用符号）───
  /** 检测死代码并写入 review_findings（需在符号引用与调用图之后执行） */
  async detectDeadSymbols(analysisId: string): Promise<DeadSymbol[]> {
    return invoke('detect_dead_symbols', { analysisId });
  },
  /** 只读列出死代码候选（不写审查结果） */
  async listDeadSymbols(analysisId: string): Promise<DeadSymbol[]> {
    return invoke('list_dead_symbols', { analysisId });
  },
  // ─── Git 变更热点 ───
  /** 目录是否在 git 工作区内 */
  async isGitRepo(projectRoot: string): Promise<boolean> {
    return invoke('is_git_repo', { projectRoot });
  },
  /** 采集 git 变更热点；sinceDays 传 undefined 表示全量历史 */
  async analyzeGitHistory(analysisId: string, projectRoot: string, sinceDays?: number): Promise<GitChurn[]> {
    return invoke('analyze_git_history', { analysisId, projectRoot, sinceDays: sinceDays ?? null });
  },
  async listGitChurn(analysisId: string): Promise<GitChurn[]> {
    return invoke('list_git_churn', { analysisId });
  },
  // ─── 变更耦合（时间维度耦合 / 隐性架构耦合）───
  /**
   * 分析「总是一起改」的文件对。
   *
   * 参数全部可选，默认值已按降噪需要调过：
   * - sinceDays 365（老仓库全量会把五年前的一次性协作算成当前耦合）
   * - minCoChanges 3（少于 3 次共变是巧合）
   * - minDegree 0.35
   * - maxCommitSize 30（超过则视为批量格式化/重命名，整体丢弃）
   * - topN 400
   */
  async analyzeChangeCoupling(
    analysisId: string,
    projectRoot: string,
    opts?: {
      sinceDays?: number | null;
      minCoChanges?: number;
      minDegree?: number;
      maxCommitSize?: number;
      topN?: number;
    },
  ): Promise<ChangeCoupling[]> {
    // v2.18 默认值 ?? 365 → ?? null：让「不传参 = 真全量」（Rust 跳过 --since）。
    // 历史 ?? 365 把 null 偷偷变 365 天窗口，导致 UI「全量」按钮与 store 默认行为都不真。
    // 配合 store.analyzeChangeCoupling 同步修复（projectStore.ts:756）。
    return invoke('analyze_change_coupling', {
      analysisId,
      projectRoot,
      sinceDays: opts?.sinceDays ?? null,
      minCoChanges: opts?.minCoChanges ?? null,
      minDegree: opts?.minDegree ?? null,
      maxCommitSize: opts?.maxCommitSize ?? null,
      topN: opts?.topN ?? null,
    });
  },
  async listChangeCoupling(analysisId: string): Promise<ChangeCoupling[]> {
    return invoke('list_change_coupling', { analysisId });
  },
  // ─── 函数调用图 ───
  /** 构建函数调用图，返回摘要（边数据用 listCallEdges 拉取） */
  async analyzeCallGraph(analysisId: string, changedRelPaths?: string[]): Promise<CallGraphSummary> {
    return invoke('analyze_call_graph', {
      analysisId,
      changedRelPaths: changedRelPaths ?? null,
    });
  },
  async listCallEdges(analysisId: string): Promise<CallEdge[]> {
    return invoke('list_call_edges', { analysisId });
  },
  // ─── 过程间数据流（函数级 def-use 摘要）───
  /**
   * 构建函数级数据流摘要，返回统计（明细用 listDataFlow 拉取）。
   * 只有 AST 支持的方言（TS/TSX/JS/Rust/Python）会产出摘要，其余语言静默跳过。
   */
  async analyzeDataFlow(analysisId: string, changedRelPaths?: string[]): Promise<DataFlowSummary> {
    return invoke('analyze_data_flow', { analysisId, changedRelPaths: changedRelPaths ?? null });
  },
  async listDataFlow(analysisId: string): Promise<DataFlowFact[]> {
    return invoke('list_data_flow', { analysisId });
  },
  // ─── 源码查看（画布实体 → 代码行）───
  /**
   * 读取已扫描文件的源码内容。
   * 只接受 fileId：后端从 project_files 反查路径，前端无法读取项目外的文件。
   */
  async readSourceFile(fileId: string): Promise<SourceFileContent> {
    return invoke('read_source_file', { fileId });
  },
  /**
   * 读取文件原始字节（v2.15 按需 CAD 解析用；v2.24 工作台图片/SVG 预览复用）。
   * 传入绝对路径（项目内文件）；Rust 端以 tauri::ipc::Response 返回原始二进制，
   * Tauri v2 的 invoke 已将其解码为 ArrayBuffer 直接交付（不走 asset 协议、不受 scope 约束）。
   * 个别 Tauri 构建可能返回 Uint8Array，此处归一化为 ArrayBuffer 以满足 Blob 契约。
   */
  async readFileBytes(path: string): Promise<ArrayBuffer> {
    const data = await invoke<ArrayBuffer | Uint8Array>('read_file_bytes', { path });
    if (data instanceof Uint8Array) {
      // 防御：个别 Tauri 构建可能直接返回 Uint8Array，归一化为独立 ArrayBuffer
      const ab = new ArrayBuffer(data.byteLength);
      new Uint8Array(ab).set(data);
      return ab;
    }
    return data;
  },
  /**
   * 受控写回源码文件（R46 P1）。
   * 安全模型在后端：只能写被扫描进项目内的文件；写前自动备份 .bak。
   * 写盘成功会经 file_watcher 触发增量重扫（metrics/结构/引用/技术债全链路刷新）。
   */
  async writeSourceFile(
    fileId: string,
    content: string,
    /**
     * 台账元信息（R47 P2-A）。**只在「AI 提议 → 用户点应用」时传**：
     * 带上它这次写入才会记入改动评审列表（可撤销）。编辑器自动保存不传，
     * 否则用户自己敲的每一次保存都会灌进评审列表，把 AI 的改动淹掉。
     */
    ledger?: {
      reason?: string;
      origin?: 'ai-apply' | 'user';
      /** 被替换的原文片段（有则支持片段级撤销，不必依赖整文快照） */
      oldText?: string;
      newText?: string;
      conversationId?: string;
    },
  ): Promise<WriteFileResult> {
    return invoke('write_file', {
      fileId,
      content,
      reason: ledger?.reason ?? null,
      origin: ledger?.origin ?? null,
      oldText: ledger?.oldText ?? null,
      newText: ledger?.newText ?? null,
      conversationId: ledger?.conversationId ?? null,
    });
  },
};

/** 写回结果（R46 P1，与后端 WriteFileResult 对齐） */
export interface WriteFileResult {
  path: string;
  relPath: string;
  backupPath: string | null;
  oldLines: number | null;
  newLines: number;
  deltaLines: number;
  /** 台账记录 id（null = 本次写入未登记，见 writeSourceFile 的 ledger 参数） */
  changeId: string | null;
}

// ─── AI 改动评审台账（R47 P2-A）───
//
// 形态与 VS Code 的 Agent 编辑一致：**先落盘、再评审**。
// 落盘是必须的——本项目的验证链路（file_watcher → 增量重扫 → metrics/引用/技术债刷新）
// 全都建立在磁盘之上，改动不落盘，AI 读不到自己的修改，「改完自动验证」的闭环就断了。
// 代价是撤销必须可靠，判定逻辑全在后端（能读到磁盘真实内容的一侧）。

/** 一条 AI 改动记录（与后端 CodeChangeRow 对齐） */
export interface CodeChangeRow {
  id: string;
  analysisId: string;
  fileId: string;
  relPath: string;
  /** patch = 锚点补丁（片段替换）| full = 整文写入 */
  mode: string;
  /** agent = AI 自己写盘 | ai-apply = 用户在面板点应用 | user = 手工保存 */
  origin: string;
  reason: string;
  oldText: string;
  newText: string;
  /** 是否留有改动前全文快照（决定撤销能力强弱） */
  hasSnapshot: boolean;
  beforeLines: number;
  afterLines: number;
  deltaLines: number;
  startLine: number;
  endLine: number;
  /** 锚点是经「行尾空白归一化」后命中的，替换边界为推断值 */
  approx: boolean;
  conversationId: string;
  /** pending = 待审 | kept = 已保留 | reverted = 已撤销 */
  status: string;
  createdAt: number;
  resolvedAt: number | null;
}

/** 撤销结果：strategy 区分整文回滚与片段回滚（措辞不同，UI 需要区分） */
export interface RevertOutcome {
  id: string;
  relPath: string;
  absPath: string;
  strategy: 'snapshot' | 'fragment';
  newLines: number;
}

export const codeChangeApi = {
  /** 列出改动。status 省略=全部；"pending" 只看待审 */
  async list(analysisId: string, status?: string, limit?: number): Promise<CodeChangeRow[]> {
    return invoke('list_code_changes', {
      analysisId,
      status: status ?? null,
      limit: limit ?? null,
    });
  },
  /** 待审条数（面板徽标：不为一个数字拉全量记录） */
  async countPending(analysisId: string): Promise<number> {
    return invoke('count_pending_code_changes', { analysisId });
  },
  /** 保留（从待审移出，仍可撤销）。changeId 传空串 + analysisId = 全部保留 */
  async keep(changeId: string, analysisId?: string): Promise<number> {
    return invoke('keep_code_change', { changeId, analysisId: analysisId ?? null });
  },
  /** 撤销（后端三档降级：整文快照 → 片段反向补丁 → 拒绝并说明原因） */
  async revert(changeId: string): Promise<RevertOutcome> {
    return invoke('revert_code_change', { changeId });
  },
  /** 回退某次会话产生的全部 AI 改动（「回退本会话全部改动」；逐条三档降级，逆序保证同文件锚点正确） */
  async revertByConversation(conversationId: string): Promise<string[]> {
    return invoke('revert_code_changes_by_conversation', { conversationId });
  },
};

// ─── AI Agent 系统 ───
export interface AiProvider {
  id: string;
  name: string;
  apiKey: string;
  color: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AiEndpoint {
  id: string;
  providerId: string;
  name: string;
  apiType: string;
  baseUrl: string;
  authType: string;
  customAuthHeader: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AiModel {
  id: string;
  name: string;
  refKey: string;
  endpointId: string;
  reasoning: boolean;
  inputTypes: string[];
  contextWindow: number;
  maxTokens: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AiAgent {
  id: string;
  name: string;
  description: string;
  modelId: string;
  systemPrompt: string;
  temperature: number;
  maxIterations: number;
  toolIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AiConversation {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface AiMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls: string | null;
  createdAt: number;
}

/**
 * 单次工具调用的一次状态推送。
 * 后端 engine.rs::ToolCallEvent 序列化后嵌在 `agent-tool-call` 事件的 `toolCall` 字段里，
 * 同一次调用会推两次：status="running"（arguments 有值、result 为 null）
 * 与 status="done"|"error"（result 有值、arguments 为 null）。
 */
export interface ToolCallEvent {
  toolName: string;
  arguments: unknown;
  result: string | null;
  success: boolean | null;
  status: 'running' | 'done' | 'error' | 'denied';
}

/** `agent-tool-call` 事件的完整 payload（工具事件被包了一层） */
export interface AgentToolCallEvent {
  conversationId: string;
  toolCall: ToolCallEvent;
}

/** `agent-tool-approval` 事件的 payload：引擎在即将执行高危工具（run_command）前推送，等用户确认 */
export interface AgentToolApprovalEvent {
  conversationId: string;
  runId: string;
  toolCallId: string;
  tool: string;
  command: string;
  cwd: string;
}

export interface AgentChunkEvent {
  conversationId: string;
  chunk: string;
}

export interface AgentDoneEvent {
  conversationId: string;
  response: string;
}

export interface AgentErrorEvent {
  conversationId: string;
  error: string;
}

export const agentApi = {
  // Provider CRUD
  async listProviders(): Promise<AiProvider[]> {
    return invoke('list_providers');
  },
  async saveProvider(provider: AiProvider): Promise<void> {
    return invoke('save_provider', { provider });
  },
  async deleteProvider(id: string): Promise<void> {
    return invoke('delete_provider', { id });
  },

  // Endpoint CRUD
  async listEndpoints(): Promise<AiEndpoint[]> {
    return invoke('list_endpoints');
  },
  async listEndpointsByProvider(providerId: string): Promise<AiEndpoint[]> {
    return invoke('list_endpoints_by_provider', { providerId });
  },
  async saveEndpoint(endpoint: AiEndpoint): Promise<void> {
    return invoke('save_endpoint', { endpoint });
  },
  async deleteEndpoint(id: string): Promise<void> {
    return invoke('delete_endpoint', { id });
  },
  async testEndpointConnection(endpointId: string): Promise<string> {
    return invoke('test_endpoint_connection', { endpointId });
  },

  // Model CRUD
  async listModels(): Promise<AiModel[]> {
    return invoke('list_models');
  },
  async listModelsByEndpoint(endpointId: string): Promise<AiModel[]> {
    return invoke('list_models_by_endpoint', { endpointId });
  },
  async saveModel(model: AiModel): Promise<void> {
    return invoke('save_model', { model });
  },
  async deleteModel(id: string): Promise<void> {
    return invoke('delete_model', { id });
  },
  async testModelChat(modelId: string): Promise<string> {
    return invoke('test_model_chat', { modelId });
  },

  // Agent CRUD
  async listAgents(): Promise<AiAgent[]> {
    return invoke('list_agents');
  },
  async saveAgent(agent: AiAgent): Promise<void> {
    return invoke('save_agent', { agent });
  },
  async deleteAgent(id: string): Promise<void> {
    return invoke('delete_agent', { id });
  },

  // Conversation CRUD
  async listConversations(agentId: string): Promise<AiConversation[]> {
    return invoke('list_conversations', { agentId });
  },
  async createConversation(agentId: string, title: string): Promise<AiConversation> {
    return invoke('create_conversation', { agentId, title });
  },
  async deleteConversation(id: string): Promise<void> {
    return invoke('delete_conversation', { id });
  },

  // Message CRUD
  async listMessages(conversationId: string): Promise<AiMessage[]> {
    return invoke('list_messages', { conversationId });
  },
  async saveMessage(message: AiMessage): Promise<void> {
    return invoke('save_message', { message });
  },
  /**
   * 批量删除消息（按 id）。
   *
   * 面板「重试 / 编辑重发」用：两者都要先抹掉旧的那一轮再重跑，否则同一次请求会在会话里
   * 留两份，下一轮模型看到的是重复对话。只按显式 id 删（不按时间戳），避免同毫秒的相邻行被误连坐。
   */
  async deleteMessages(ids: string[]): Promise<number> {
    return invoke('delete_messages', { ids });
  },

  /**
   * 运行 Agent（流式 + 工具调用）。
   *
   * 参数名必须与后端 `run_agent(agent_id, message, conversation_id)` 逐字对齐：
   * Tauri 按 camelCase 键名映射 snake_case 形参，少一个必填形参就是运行时 400。
   * 事件字段同理 —— 后端 emit 的是 `chunk` / `response` / `toolCall`（嵌套一层），
   * 不是 `content` / `fullContent` / 扁平工具字段。
   */
  async runAgent(
    agentId: string,
    message: string,
    conversationId: string,
    onChunk?: (chunk: string) => void,
    onToolCall?: (toolCall: ToolCallEvent) => void,
    onDone?: (fullContent: string) => void,
    onError?: (error: string) => void,
    /** 前端下发的单次运行 id，用于 cancel_agent_run 精准取消（坐标系与后端取消令牌表一致） */
    runId?: string,
    /** 单次调用工具白名单（与 Agent 配置取交集；省略=不限制） */
    allowedTools?: string[] | null,
    /** 模型覆盖（对标 VS Code 的模型选择器）：显式选了某模型则覆盖 Agent 配置绑定的模型；省略=跟随 Agent 默认 */
    modelId?: string | null,
  ): Promise<string> {
    // 监听流式事件
    const unlisteners: Promise<UnlistenFn>[] = [];

    if (onChunk) {
      unlisteners.push(
        listen<AgentChunkEvent>('agent-chunk', (event) => {
          if (event.payload.conversationId === conversationId) {
            onChunk(event.payload.chunk);
          }
        }),
      );
    }

    if (onToolCall) {
      unlisteners.push(
        listen<AgentToolCallEvent>('agent-tool-call', (event) => {
          if (event.payload.conversationId === conversationId) {
            onToolCall(event.payload.toolCall);
          }
        }),
      );
    }

    if (onDone) {
      unlisteners.push(
        listen<AgentDoneEvent>('agent-done', (event) => {
          if (event.payload.conversationId === conversationId) {
            onDone(event.payload.response);
          }
        }),
      );
    }

    if (onError) {
      unlisteners.push(
        listen<AgentErrorEvent>('agent-error', (event) => {
          if (event.payload.conversationId === conversationId) {
            onError(event.payload.error);
          }
        }),
      );
    }

    try {
      return await invoke<string>('run_agent', {
        agentId,
        message,
        conversationId,
        allowedTools: allowedTools ?? null,
        runId: runId ?? null,
        modelId: modelId ?? null,
      });
    } finally {
      // 清理所有监听器
      const unlistenFns = await Promise.all(unlisteners);
      unlistenFns.forEach((fn) => fn());
    }
  },

  /**
   * 取消一次正在运行的 `run_agent`（按前端下发的 runId 精准命中单次运行）。
   * 幂等：未知 / 已结束的 runId 也返回成功，可重复点击停止。
   */
  async cancelAgentRun(runId: string): Promise<void> {
    await invoke('cancel_agent_run', { runId });
  },

  /**
   * 落定一次待审批的高危工具调用（run_command 的 human-in-the-loop 确认）。
   * 引擎在审批闸门里 await 此结果；超时 / 取消一律按拒绝处理。
   */
  async resolveToolApproval(runId: string, toolCallId: string, approved: boolean): Promise<boolean> {
    return invoke<boolean>('resolve_tool_approval', {
      runId,
      toolCallId,
      approved,
    });
  },
};

// ─── 文件变更监视服务 ───
export interface FileChangeEvent {
  analysisId: string;
  path: string;
  kind: 'created' | 'modified' | 'removed';
  timestamp: number;
}

export const fileWatcherApi = {
  async startWatching(analysisId: string, projectRoot: string): Promise<string> {
    return invoke('start_watching', { analysisId, projectRoot });
  },
  async stopWatching(analysisId: string): Promise<void> {
    return invoke('stop_watching', { analysisId });
  },
  async getWatchStatus(analysisId: string): Promise<boolean> {
    return invoke('get_watch_status', { analysisId });
  },
};

// ─── AI 上下文包持久化 ───
// 前端模块供给者（scanContextProvider）构建好 AiContextPack 后落库，供 Rust Agent 工具 project_context 按需读取。
export const aiContextApi = {
  /** 保存一个上下文包（pack_id 由 scope+module 推导，重存即覆盖）。返回 pack_id。 */
  async saveAiContextPack(pack: AiContextPack): Promise<string> {
    return invoke<string>('save_ai_context_pack', { pack });
  },
  /**
   * 分节级增量保存：只重写 changedKeys 指定的分节，其余分节在库里原封不动。
   * sections 传变化子集，sectionKeys 必须传**全集**（否则包元信息会漏节）。
   * 返回实际写入的分节数。
   */
  async saveAiContextSections(pack: AiContextPack, changedKeys: string[]): Promise<number> {
    const changed = new Set(changedKeys);
    const payload = {
      ...pack,
      sections: pack.sections.filter((s) => changed.has(s.key)),
      sectionKeys: pack.sections.map((s) => s.key),
      changedSections: changedKeys,
    };
    return invoke<number>('save_ai_context_sections', { pack: payload });
  },
  /** 取分节戳（无正文）：用于水合增量状态，重启应用后仍能接着增量而不是整包重写 */
  async listAiContextSectionStamps(packId: string): Promise<AiContextSectionStamp[]> {
    return invoke<AiContextSectionStamp[]>('list_ai_context_section_stamps', { packId });
  },
  async listAiContextPacks(scopeId?: string): Promise<AiContextPackSummary[]> {
    return invoke<AiContextPackSummary[]>('list_ai_context_packs', { scopeId: scopeId ?? null });
  },
  async getAiContextPack(packId: string): Promise<AiContextPackDetail | null> {
    return invoke<AiContextPackDetail | null>('get_ai_context_pack', { packId });
  },
  async getAiContextSection(packId: string, sectionKey: string): Promise<AiContextSectionDto | null> {
    return invoke<AiContextSectionDto | null>('get_ai_context_section', { packId, sectionKey });
  },
  async deleteAiContextPack(packId: string): Promise<void> {
    return invoke('delete_ai_context_pack', { packId });
  },
  async saveAiInsight(insight: AiInsightInput): Promise<void> {
    return invoke('save_ai_insight', { insight });
  },
  async listAiInsights(analysisId: string): Promise<AiInsightDto[]> {
    return invoke<AiInsightDto[]>('list_ai_insights', { analysisId });
  },
  /**
   * 人工收口一条结论。理由必填（后端强校验）——面板上一键关掉但说不出为什么，
   * 等于把问题扫到地毯下面，下一轮 Agent 还会原样再报一遍。
   */
  async resolveAiInsight(analysisId: string, insightId: string, reason: string, resolvedBy = 'user'): Promise<string> {
    return invoke<string>('resolve_ai_insight', {
      analysisId,
      insightId,
      reason,
      resolvedBy,
    });
  },
  /**
   * G4 回扫验证闭环：AI 写回代码增量重扫后，后端自动复核本次诊断产出的洞察是否已解决。
   * 返回被自动收口的洞察数。
   */
  async verifyDiagnosisInsights(analysisId: string, paths: string[]): Promise<number> {
    return invoke<number>('verify_diagnosis_insights', { analysisId, paths });
  },

  // ─── 自动分析编排 ───
  /** 列出规则（传 moduleId 只取该模块的，避免无关规则参与判定） */
  async listAutoAnalysisRules(moduleId?: string): Promise<AiAutoAnalysisRule[]> {
    return invoke<AiAutoAnalysisRule[]>('list_ai_auto_analysis_rules', {
      moduleId: moduleId ?? null,
    });
  },
  async saveAutoAnalysisRule(rule: AiAutoAnalysisRuleInput): Promise<void> {
    return invoke('save_ai_auto_analysis_rule', { rule });
  },
  async deleteAutoAnalysisRule(ruleId: string): Promise<void> {
    return invoke('delete_ai_auto_analysis_rule', { ruleId });
  },
  /** 记录一次真实触发：推进冷却起点与去重指纹 */
  async markAutoAnalysisRun(ruleId: string, digest: string, conversationId?: string | null): Promise<void> {
    return invoke('mark_ai_auto_analysis_run', {
      ruleId,
      digest,
      conversationId: conversationId ?? null,
    });
  },
  /** 写运行轨迹（触发/跳过/失败都写，跳过必须带原因） */
  async recordAutoAnalysisRun(run: AiAutoAnalysisRunInput): Promise<void> {
    return invoke('record_ai_auto_analysis_run', { run });
  },
  async listAutoAnalysisRuns(limit = 30): Promise<AiAutoAnalysisRun[]> {
    return invoke<AiAutoAnalysisRun[]>('list_ai_auto_analysis_runs', { limit });
  },
  /**
   * 每个分析维度最近一次真正跑过的记录（覆盖台账原料）。
   * 分组取最新必须在 SQL 里做——从 listAutoAnalysisRuns 的最近 N 条里筛，
   * 久未分析的维度会因为被挤出窗口而被误报成「从未分析」。
   */
  async listAnalysisCoverage(moduleId: string, scopeId: string): Promise<AiAutoAnalysisRun[]> {
    return invoke<AiAutoAnalysisRun[]>('list_ai_analysis_coverage', { moduleId, scopeId });
  },
  /**
   * 回执：一轮分析真正结束后回填结局与产出条数。
   *
   * 发起与结束分两次写，是因为发起时 Agent 还没开口，等它答完会把扫描收尾挂住几十秒。
   * 但只写发起不写结束，「已发起」就会被当成「已分析」——模型报错那一轮照样点绿灯。
   */
  async finishAutoAnalysisRun(runId: string, outcome: AiAnalysisOutcome, insightCount = 0, detail = ''): Promise<void> {
    return invoke('finish_ai_auto_analysis_run', { runId, outcome, insightCount, detail });
  },
  /**
   * 清算中断轮次：把长期停在 pending 的轨迹落定为 interrupted，
   * 并在同一事务里退回它那一轮点名的焦点目标。返回被清算的轮次数。
   *
   * 回执写在 sendMessage 的回调里，进程还活着才写得成。应用被随手关掉时，
   * 那一轮既没 completed 也没 error，永远停在 pending —— 覆盖台账据此点绿灯、
   * 派单台账据此当已落实，而这一轮实际上一条结论都没有。
   */
  async reapStalePendingRuns(moduleId: string, scopeId: string, olderThanSec: number): Promise<number> {
    return invoke<number>('reap_stale_analysis_runs', { moduleId, scopeId, olderThanSec });
  },
  /** 每条规则在该作用域下的最近一条轨迹 —— 补跑调度的判据 */
  async listLatestRunPerRule(moduleId: string, scopeId: string): Promise<AiAutoAnalysisRun[]> {
    return invoke<AiAutoAnalysisRun[]>('list_ai_auto_analysis_latest_per_rule', {
      moduleId,
      scopeId,
    });
  },

  // ─── 焦点目标巡查派单 ───
  /**
   * 登记一轮派单：本轮点名交给 Agent 巡查的文件。
   *
   * 「派单即销账」是这张台账唯一正确的口径：用「有没有洞察」反推会让
   * 「Agent 看过、判定没问题」的文件被永久重复点名，变成不收敛的烧钱循环。
   */
  async recordFocusAssignments(input: {
    moduleId: string;
    scopeId: string;
    runId?: string;
    presetKey?: string;
    contextDigest?: string;
    targets: Array<{
      filePath: string;
      resonance?: number;
      note?: string;
      /** 复核派单专用：该文件当下的证据现状指纹，用于下一轮判断「这次变化派过单没有」 */
      evidenceDigest?: string;
      /**
       * 回归追责专用：该文件「本轮相对上一次扫描变坏了什么」的指纹。
       *
       * 与 contextDigest（整包变没变）、evidenceDigest（已知结论变没变）三分天下：
       * 三本账各记各的，任何一本都不能替另一本销账，否则一次派单会顺手抹掉
       * 另外两个维度的欠账，让对应档位永久静默。
       */
      regressionDigest?: string;
    }>;
  }): Promise<number> {
    return invoke<number>('record_ai_focus_assignments', {
      moduleId: input.moduleId,
      scopeId: input.scopeId,
      runId: input.runId ?? null,
      presetKey: input.presetKey ?? null,
      contextDigest: input.contextDigest ?? null,
      targets: input.targets.map((t) => ({
        filePath: t.filePath,
        resonance: t.resonance ?? 0,
        note: t.note ?? '',
        evidenceDigest: t.evidenceDigest ?? '',
        regressionDigest: t.regressionDigest ?? '',
      })),
    });
  },
  /** 某作用域下的派单记录（每个文件一行，取最近一次） */
  async listFocusAssignments(moduleId: string, scopeId: string): Promise<AiFocusAssignmentDto[]> {
    return invoke<AiFocusAssignmentDto[]>('list_ai_focus_assignments', { moduleId, scopeId });
  },
  /**
   * 核销一轮派单：这一轮点名到底落实了没有。
   *
   * 「派单即销账」堵住了「判定没问题不写洞察 → 永远重复点名」的循环，
   * 却顺手开了反向的洞——**发起了、对话却失败**的那一轮同样销了账，
   * 于是一次网络抖动就能让共振榜第一名永久沉默。只有 error 会让派单作废重排。
   */
  async settleFocusAssignments(runId: string, outcome: string): Promise<number> {
    return invoke<number>('settle_ai_focus_assignments', { runId, outcome });
  },

  // ─── 指标快照：项目形态的历史基线 ───
  /**
   * 记录一次指标切面。返回 [行 id, 是否新增点]。
   *
   * 后端**不解析** metricsJson —— 指标定义是模块知识，公共层只负责存取，
   * 否则每接一个新模块都要回头改 Rust。
   */
  async recordMetricSnapshot(input: {
    moduleId: string;
    scopeId: string;
    digest: string;
    metricsJson: string;
    coverageJson?: string;
    triggerKind?: string;
    takenAt?: number;
  }): Promise<[string, boolean]> {
    return invoke<[string, boolean]>('record_ai_metric_snapshot', {
      id: null,
      moduleId: input.moduleId,
      scopeId: input.scopeId,
      digest: input.digest,
      triggerKind: input.triggerKind ?? null,
      metricsJson: input.metricsJson,
      coverageJson: input.coverageJson ?? null,
      takenAt: input.takenAt ?? null,
    });
  },
  /** 指标时间轴（由新到旧） */
  async listMetricSnapshots(moduleId: string, scopeId: string, limit?: number): Promise<AiMetricSnapshotDto[]> {
    return invoke<AiMetricSnapshotDto[]>('list_ai_metric_snapshots', {
      moduleId,
      scopeId,
      limit: limit ?? null,
    });
  },

  // ─── 实体快照：哪个文件在变坏 ───
  /**
   * 记录一张实体榜单。返回 [行 id, 是否新增点]。
   *
   * total / cutoff / survivedJson 三个字段看着像统计装饰，实际是回归判定的地基：
   * 没有门槛分数就分不清「修好了」和「被挤下榜」，没有存活名单就会把
   * 「删掉遗留模块」当成质量改善。
   */
  async recordEntitySnapshot(input: {
    moduleId: string;
    scopeId: string;
    digest: string;
    entitiesJson: string;
    entityLabel?: string;
    coverageJson?: string;
    dimensionsJson?: string;
    survivedJson?: string;
    total?: number;
    cutoff?: number;
    triggerKind?: string;
    takenAt?: number;
  }): Promise<[string, boolean]> {
    return invoke<[string, boolean]>('record_ai_entity_snapshot', {
      id: null,
      moduleId: input.moduleId,
      scopeId: input.scopeId,
      digest: input.digest,
      triggerKind: input.triggerKind ?? null,
      entityLabel: input.entityLabel ?? null,
      entitiesJson: input.entitiesJson,
      coverageJson: input.coverageJson ?? null,
      dimensionsJson: input.dimensionsJson ?? null,
      survivedJson: input.survivedJson ?? null,
      total: input.total ?? null,
      cutoff: input.cutoff ?? null,
      takenAt: input.takenAt ?? null,
    });
  },
  /** 实体榜单序列（由新到旧）。回归只对照上一个点，默认取头几个 */
  async listEntitySnapshots(moduleId: string, scopeId: string, limit?: number): Promise<AiEntitySnapshotDto[]> {
    return invoke<AiEntitySnapshotDto[]>('list_ai_entity_snapshots', {
      moduleId,
      scopeId,
      limit: limit ?? null,
    });
  },
};

/** 库内一条实体榜单快照。JSON 字段由模块自己定义结构，后端原样存取 */
export interface AiEntitySnapshotDto {
  id: string;
  moduleId: string;
  scopeId: string;
  digest: string;
  triggerKind: string;
  entityLabel: string;
  entitiesJson: string;
  coverageJson: string;
  dimensionsJson: string;
  /** 上一批榜单实体中此刻仍存在的 id */
  survivedJson: string;
  /** 参与打分的实体总数（截断之前） */
  total: number;
  /** 榜单门槛：末位实体的分数 */
  cutoff: number;
  firstAt: number;
  lastAt: number;
  seenCount: number;
}

/** 库内一条指标快照。metricsJson / coverageJson 由模块自己定义结构，后端原样存取 */
export interface AiMetricSnapshotDto {
  id: string;
  moduleId: string;
  scopeId: string;
  digest: string;
  triggerKind: string;
  metricsJson: string;
  coverageJson: string;
  /** 该组指标首次出现时间（秒） */
  firstAt: number;
  /** 最近一次仍观测到该组指标的时间（秒） */
  lastAt: number;
  /** 连续观测次数：「保持了多久」本身就是信息 */
  seenCount: number;
}

/** 一条焦点目标派单记录：这个文件最近一次被点名巡查是什么时候、基于哪份数据 */
export interface AiFocusAssignmentDto {
  moduleId: string;
  scopeId: string;
  filePath: string;
  /** 派单所属轨迹 id，便于从文件跳回那一轮会话 */
  runId: string;
  presetKey: string;
  /** 派单当时的上下文指纹：与当前指纹不同 = 数据已变，值得复巡 */
  contextDigest: string;
  resonance: number;
  note: string;
  /** 累计被点名次数（点名多次仍无结论是需要人工介入的信号） */
  assignCount: number;
  /** 最近一次派单时间（秒） */
  assignedAt: number;
  /**
   * 核销状态：''=已发出待回执，其余同轨迹表（completed / no-output / error）。
   *
   * 只有 error 表示这次点名没有真的发生过（对话失败），读侧据此把它退回队列。
   * 历史行为空串，一律按「已落实」处理，与本列上线前的行为一致。
   */
  outcome?: string;
  /**
   * 派单时该文件的「证据现状」指纹（复核派单才有值）。
   *
   * contextDigest 是整包指纹，任何文件改动都会让它翻新，只能粗粒度回答「数据变了没有」；
   * 这一列精确到本文件的证据，用于判断「上次派出去的那次复核，针对的是不是同一次变化」。
   * 没有它，Agent 复核后若判定「结论仍成立」而不写任何东西，这个文件会被每轮重复点名。
   */
  evidenceDigest?: string;
  /**
   * 派单时该文件「本轮相对上一次扫描变坏了什么」的指纹（回归追责派单才有值）。
   *
   * 第三本账。回归信号与另外两者的关键差别是**它会过期**：再扫一次，这次的劣化
   * 就滚进了新基线，从此无从追问。所以它既不能靠 contextDigest 销账（整包指纹
   * 每次扫描都变，等于从不销账），也不能靠 evidenceDigest 销账（那记的是已知结论，
   * 一个刚变坏、还没有任何结论的文件在那本账上永远是空的）。
   */
  regressionDigest?: string;
}

/** 自动分析规则：「某模块上下文更新后，让哪个已配置 Agent 用什么预设去分析」 */
export interface AiAutoAnalysisRule {
  id: string;
  enabled: boolean;
  /** 监听哪个模块的上下文产出（当前唯一供给者 project-scan，未来任意模块复用） */
  moduleId: string;
  /** null = 该模块下所有作用域通用；填值则只对某个分析生效 */
  scopeId: string | null;
  /** 用户在 UI 选定的已配置 Agent，永不由代码写死 */
  agentId: string;
  presetKey: string;
  /** "full-scan" 仅全量扫描后 / "any-scan" 含 watch 增量重扫 */
  triggerOn: string;
  /** 冷却窗口（分钟）：距上次触发不足则跳过 */
  cooldownMinutes: number;
  /** 内容指纹未变化时跳过 */
  skipIfUnchanged: boolean;
  lastRunAt: number;
  lastDigest: string;
  lastConversationId: string | null;
}

export type AiAutoAnalysisRuleInput = Omit<AiAutoAnalysisRule, 'lastRunAt' | 'lastDigest' | 'lastConversationId'>;

/** 一次编排的审计记录 */
export interface AiAutoAnalysisRun {
  id: string;
  ruleId: string;
  moduleId: string;
  scopeId: string;
  agentId: string;
  presetKey: string;
  packId: string | null;
  conversationId: string | null;
  triggerKind: string;
  /** "triggered" | "skipped" | "failed" */
  status: string;
  detail: string;
  /**
   * 本次分析所基于的上下文内容指纹（只有 triggered 才有值）。
   * 覆盖台账靠它区分「久没分析」与「数据变了、结论已经对不上」——
   * 时间只能说明久，说明不了变。
   */
  contextDigest?: string;
  /**
   * 机器可读的判定原因：ok / rotate-gap / cooling / busy / unchanged / agent-missing …
   *
   * detail 是给人看的中文句子，会随文案调整而变。补跑要判断的是「这次跳过是不是
   * 可恢复的」，拿自然语言当协议，改一个字调度就失灵。
   */
  reason?: string;
  /** 发起之后的归宿；空串 = 早于回执特性的历史记录，按「无法判断」处理 */
  outcome?: AiAnalysisOutcome | '';
  /** 本轮实际沉淀的洞察条数（回执时回填） */
  insightCount?: number;
  /** 回执落点时间（秒）；0 = 尚未回执 */
  finishedAt?: number;
  createdAt: number;
}

/**
 * 一轮分析发起之后的归宿。
 *
 * · pending     —— 消息已发出，Agent 还在跑
 * · completed   —— 正常结束且有结论沉淀
 * · no-output   —— 正常结束但一条结论都没保存（合法：认真看过、确实没问题）
 * · error       —— 对话失败，这一轮等于没跑
 * · interrupted —— 长时间没等到回执，判定为中断（几乎总是「应用被关掉了」）
 *
 * 为什么 interrupted 要与 error 分开：两者对台账的效力完全相同（都不算覆盖、
 * 都要退回派单），但死法不同。合成一个值，用户在轨迹上只会看到「对话失败」，
 * 于是去查模型和密钥——而真正发生的事只是他关了窗口。
 */
export type AiAnalysisOutcome = 'pending' | 'completed' | 'no-output' | 'error' | 'interrupted';

export type AiAutoAnalysisRunInput = Omit<AiAutoAnalysisRun, 'createdAt' | 'insightCount' | 'finishedAt'>;

export interface AiInsightInput {
  id: string;
  packId?: string | null;
  analysisId: string;
  agentId?: string | null;
  kind: string;
  title: string;
  body: string;
  severity: string;
  refs?: string[];
}

export interface AiInsightDto {
  id: string;
  packId: string | null;
  analysisId: string;
  agentId: string | null;
  kind: string;
  title: string;
  body: string;
  severity: string;
  refs: string[];
  /** 同一结论被不同分析轮次确认的次数（去重累加），>1 说明结论稳定可复用 */
  seenCount?: number;
  /** 首次记录 / 最近确认时间戳（秒） */
  firstSeen?: number;
  lastSeen?: number;
  /**
   * 结论时效：拿本次扫描的文件内容哈希，回头比对结论产出当时冻结的证据快照。
   * 没有它，沉淀只会单调增长——改完的问题继续挂着误导人，Agent 每轮还要重读一遍。
   */
  freshness?: InsightFreshness;
  /** 证据内容已变的路径（这条结论需要复核） */
  changedRefs?: string[];
  /** 证据文件已不存在的路径 */
  missingRefs?: string[];
  /**
   * 证据**现状**指纹：各证据路径此刻的内容哈希聚合（与冻结在 evidence 里的旧哈希不同）。
   *
   * freshness 回答「变了没有」，这一份回答「现在长什么样」。复核派单靠它收敛：
   * Agent 复核后什么都不写时它不变（已派过单 → 不再点名），文件被再次改动时它必然变
   * （→ 重新排队）。判据落在客观代码上，不落在模型愿不愿意写字上。
   */
  evidenceDigest?: string;
  /**
   * 生命周期状态：`open` 仍占用注意力，`resolved` 已复核收口。
   * 时效判定只回答「证据还是不是那份」，收口才回答「这事还要不要管」——
   * 少了后者，判得越准，面板上的旧账反而越厚。
   */
  status?: 'open' | 'resolved';
  resolvedAt?: number;
  resolvedReason?: string | null;
  resolvedBy?: string | null;
}

/**
 * · current    证据仍在且内容未变，结论继续成立
 * · stale      至少一处证据变了 / 少了 —— 需复核
 * · orphaned   全部证据文件已不存在 —— 可能已修复，也可能只是搬了家
 * · unanchored 结论没写可用 refs，永远无法验证
 * · unknown    无从比对（没扫过，或是没有证据快照的历史数据）
 */
export type InsightFreshness = 'current' | 'stale' | 'orphaned' | 'unanchored' | 'unknown';

export interface AiContextPackSummary {
  id: string;
  scopeId: string;
  moduleId: string;
  scopeLabel: string;
  schemaVersion: number;
  generatedAt: number;
  tokenEstimate: number;
  digest: string;
  truncatedSections: string[];
  sectionKeys: string[];
  sectionCount: number;
}

export interface AiContextSectionDto {
  key: string;
  title: string;
  summary: string;
  content: string;
  tokenEstimate: number;
  priority: number;
  facts: unknown | null;
  /** 数据可信度（AiSectionDataQuality）；历史数据为 null 时按「可信」处理 */
  dataQuality: unknown | null;
  digest: string;
  updatedAt: number;
}

/** 分节戳：指纹 + 更新时间，**不含正文**。用于增量判定与新鲜度展示 */
export interface AiContextSectionStamp {
  sectionKey: string;
  digest: string;
  updatedAt: number;
  tokenEstimate: number;
}

export interface AiContextPackDetail {
  id: string;
  scopeId: string;
  moduleId: string;
  scopeLabel: string;
  schemaVersion: number;
  generatedAt: number;
  tokenEstimate: number;
  digest: string;
  truncatedSections: string[];
  sections: AiContextSectionDto[];
}

// ─── 目录与 Git 命令 ───
export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  extension: string | null;
}

export interface GitRepoInfo {
  url: string;
  branch: string | null;
  lastCommit: string | null;
  lastCommitMessage: string | null;
  isRepo: boolean;
}

export const fsApi = {
  async readDirectory(path: string): Promise<DirEntry[]> {
    return invoke('read_directory', { path });
  },
  async getGitRepoInfo(path: string): Promise<GitRepoInfo> {
    return invoke('get_git_repo_info', { path });
  },
};

/** 拉起独立原生「代码工作台」窗口（Rust 创建/复用单例 code-workbench 窗口）。 */
export async function spawnCodeWorkbench(
  fileId: string,
  line: number | null,
  analysisId: string | null,
): Promise<void> {
  // Tauri v2 默认把 camelCase 参数自动映射为 Rust 的 snake_case（项目内 scan_project 等高频命令均用 camelCase 调用），
  // 故这里用 fileId / analysisId 即可，无需手动写 file_id / analysis_id。
  await invoke('spawn_code_workbench', { fileId, line, analysisId });
}

// ═══════════════════════════════════════════════════════
// 代码工作台集成终端（IDE 标准可交互 shell：portable_pty + 前端 xterm.js）
// ═══════════════════════════════════════════════════════
export const terminalApi = {
  /** 起一个终端会话（cwd = 项目根目录），返回 session_id。 */
  async spawn(cwd: string, cols: number, rows: number): Promise<string> {
    return invoke('spawn_terminal', { cwd, cols, rows });
  },
  /** 重放首屏输出（监听器就绪后调用，避免竞态丢提示符导致终端空白）。 */
  async replay(sessionId: string): Promise<void> {
    return invoke('terminal_replay', { sessionId });
  },
  /** 把前端按键写回 PTY 的 stdin。 */
  async write(sessionId: string, data: string): Promise<void> {
    return invoke('terminal_write', { sessionId, data });
  },
  /** 调整 PTY 尺寸。 */
  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    return invoke('terminal_resize', { sessionId, cols, rows });
  },
  /** 结束会话（杀掉子进程）。 */
  async kill(sessionId: string): Promise<void> {
    return invoke('terminal_kill', { sessionId });
  },
};

// ─── ACP Host WebSocket 桥（P0.1）───
export const acpWsApi = {
  /** 启动本地 WebSocket 服务，监听 127.0.0.1:{port}，供外部 ACP Agent 连接。 */
  async startServer(port: number): Promise<void> {
    return invoke('start_acp_ws_server', { port });
  },
  /** 前端 host 把出站 ACP 消息经此发回 WS（connId 指定连接，null=广播全部）。 */
  async send(message: string, connId?: string | null): Promise<void> {
    return invoke('send_acp_ws', { connId: connId ?? null, message });
  },
  /** 停止 WS 服务并清空连接槽。 */
  async stopServer(): Promise<void> {
    return invoke('stop_acp_ws_server');
  },
};

// ─── 写作域（Sight Folio）：书籍与章节 ───

export interface WritingBook {
  id: string;
  title: string;
  description: string | null;
  genre: string;
  /** 载体：serial（连载）/ standalone（单本）/ collection（篇目集）。'' = 未指定（旧书兼容） */
  medium: string;
  status: string;
  coverColor: string;
  /** 日更目标（字数/天，0 = 未设）。P6 写作目标。 */
  dailyGoal: number;
  createdAt: number;
  updatedAt: number;
}

export interface WritingChapter {
  id: string;
  bookId: string;
  title: string;
  content: string;
  sortOrder: number;
  wordCount: number;
  status: string;
  /** 卷/分组名（'' = 未分卷）。旧模型遗留字段；新结构树由 parentId + kind 表达。 */
  volume: string;
  /** 结构树父节点 id（null = 根）。创作者自定义的任意层级都由它串成树。 */
  parentId?: string | null;
  /** 层级名（创作者自填：部/卷/章/节/幕/场/回/篇…，系统不预定义）。 */
  kind: string;
  /** 章头图等 P2 扩展（JSON 透传）。章头图引用存 `coverImage`：相对引用 `assets/writing/illustrations/<name>` */
  extra: string;
  createdAt: number;
  updatedAt: number;
}

export const writingApi = {
  async listBooks(): Promise<WritingBook[]> {
    return invoke<WritingBook[]>('list_writing_books');
  },

  async saveBook(book: WritingBook): Promise<void> {
    return invoke('save_writing_book', { book });
  },

  async deleteBook(bookId: string): Promise<void> {
    return invoke('delete_writing_book', { bookId });
  },

  async listChapters(bookId: string): Promise<WritingChapter[]> {
    return invoke<WritingChapter[]>('list_writing_chapters', { bookId });
  },

  async saveChapter(chapter: WritingChapter): Promise<void> {
    return invoke('save_writing_chapter', { chapter });
  },

  /** 改名 title-only：只更新 title 列，不整行覆写 content（防旧正文回滚）。 */
  async renameChapter(chapterId: string, title: string): Promise<void> {
    return invoke('rename_writing_chapter', { chapterId, title });
  },

  /** 正文保存 content-only：只更新 content/word_count（自动保存高频通道，防字段回滚）。 */
  async saveChapterContent(chapterId: string, content: string, wordCount: number): Promise<void> {
    return invoke('save_writing_chapter_content', { chapterId, content, wordCount });
  },

  async deleteChapter(chapterId: string): Promise<void> {
    return invoke('delete_writing_chapter', { chapterId });
  },
};

// ─── 章节版本快照（批次④）：切章自动存 + 手动存，每章保留最近 20 份 ───

export interface WritingChapterSnapshot {
  id: string;
  chapterId: string;
  bookId: string;
  content: string;
  wordCount: number;
  /** auto（切章自动存）/ manual（手动存） */
  origin: string;
  createdAt: number;
}

export const writingSnapshotsApi = {
  async list(chapterId: string): Promise<WritingChapterSnapshot[]> {
    return invoke<WritingChapterSnapshot[]>('list_writing_chapter_snapshots', { chapterId });
  },

  async save(snapshot: WritingChapterSnapshot): Promise<void> {
    return invoke('save_writing_chapter_snapshot', { snapshot });
  },
};

// ─── 写作域 P1：创作设定库（人设卡 / 世界观）+ 导出写盘 ───

export type WritingSettingKind = 'character' | 'worldbuilding';

export interface WritingSetting {
  id: string;
  bookId: string;
  kind: WritingSettingKind;
  name: string;
  subtitle: string;
  description: string;
  extra: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export const writingSettingsApi = {
  async list(bookId: string, kind: WritingSettingKind): Promise<WritingSetting[]> {
    return invoke<WritingSetting[]>('list_writing_settings', { bookId, kind });
  },

  async save(setting: WritingSetting): Promise<void> {
    return invoke('save_writing_setting', { setting });
  },

  async delete(settingId: string): Promise<void> {
    return invoke('delete_writing_setting', { settingId });
  },
};

/** 把文本写到用户经对话框选定的路径（配合 plugin-dialog 的 save()）。 */
export async function saveTextFile(path: string, contents: string): Promise<void> {
  return invoke('save_text_file', { path, contents });
}

// ─── 写作域 P4：写作统计 + 设定卡结构化扩展 ───

export interface WritingDailyStat {
  day: string;
  wordCount: number;
}

export const writingStatsApi = {
  /** 最近 N 天的每日全书总字数快照（缺记录的日期由调用方补零）。 */
  async listDailyStats(bookId: string, days = 30): Promise<WritingDailyStat[]> {
    return invoke<WritingDailyStat[]>('list_writing_daily_stats', { bookId, days });
  },
};

/** 设定卡 extra JSON 的结构化字段（P1 预留的透传空间，从这里开始消费）。 */
export interface WritingRelation {
  /** 关联设定 id（连 id，新增；与自由文本 target 并存，target 作为展示名） */
  targetId?: string;
  /** 展示名（自由文本，兼容旧数据；连 id 时自动同步为被关联设定名） */
  target: string;
  type: string;
}

/**
 * 全书级时间线事件实体（D）：独立表 writing_timeline_events，独立于设定卡 extra.timeline。
 * setting_id 可空（null = 纯书级事件，不挂在某个设定上）；createdAt/updatedAt 为 Unix 秒。
 */
export interface WritingTimelineEvent {
  id: string;
  bookId: string;
  settingId: string | null;
  /** 时间点标签，自由文本（「第3年」「2024」「第12章」等），仅作展示与数字序排序 */
  at: string;
  /** 事件描述 */
  event: string;
  /** 绑定章节（可选，null = 未绑章）：双击优先跳该章 */
  chapterId: string | null;
  /** 所属剧情线（可选，null = 未挂线）：多线叙事维度，与 settingId/chapterId 正交 */
  storylineId: string | null;
  /** 轨道内排序（同 at 时的稳定序） */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** 剧情线（多线叙事实体）：事件通过 storylineId 挂线；删线不删事件（后端置 NULL） */
export interface WritingStoryline {
  id: string;
  bookId: string;
  name: string;
  /** 轨道配色（hex），空串 = 前端按 id 哈希兜底 */
  color: string;
  description: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface WritingSettingProfile {
  /** 外貌 */
  appearance?: string;
  /** 性格 */
  personality?: string;
  /** 动机 */
  motivation?: string;
  /** 口头禅 */
  catchphrase?: string;
  /** 笔记 */
  notes?: string;
}

/** 世界观档案（结构化字段，零迁移，落 extra.worldbuildingProfile，与人物 profile 并列） */
export interface WritingWorldbuildingProfile {
  /** 类型 / 分类，如 地理 / 种族 / 魔法体系 / 社会制度 */
  type?: string;
  /** 核心规则 */
  rules?: string;
  /** 例外 / 破例 */
  exceptions?: string;
  /** 关联条目（人物 / 其他设定，自由文本） */
  linkedTo?: string;
  /** 笔记 */
  notes?: string;
}

/** 世界观子类型枚举（受控 Select 与左栏筛选共用，单一事实源；落 worldbuildingProfile.type，零迁移） */
export const WORLDBUILDING_TYPE_KEYS = ['location', 'faction', 'magic', 'history', 'item', 'culture', 'other'] as const;
export type WorldbuildingType = (typeof WORLDBUILDING_TYPE_KEYS)[number];

export interface WritingSettingExtra {
  relations?: WritingRelation[];
  /** 人设档案（结构化字段，零迁移，落 extra JSON） */
  profile?: WritingSettingProfile;
  /** 世界观档案（结构化字段，零迁移，落 extra JSON，与人物 profile 并列） */
  worldbuildingProfile?: WritingWorldbuildingProfile;
  [key: string]: unknown;
}

/** 解析 extra JSON；坏数据一律当空对象，绝不让人设卡因脏数据渲染崩 */
export function parseSettingExtra(extra: string): WritingSettingExtra {
  try {
    const parsed = JSON.parse(extra);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

// ─── 写作域 P5：大纲（与章节可双向关联） ───

export interface WritingOutline {
  id: string;
  bookId: string;
  title: string;
  summary: string;
  /** 绑定章节 id；null = 该节拍尚未落章 */
  chapterId: string | null;
  /** JSON 透传（设计视图节拍挂载：{ cast: settingId[], scenes: settingId[] }）；旧数据缺省 "{}" */
  extra: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export const writingOutlinesApi = {
  async list(bookId: string): Promise<WritingOutline[]> {
    return invoke<WritingOutline[]>('list_writing_outlines', { bookId });
  },

  async save(outline: WritingOutline): Promise<void> {
    return invoke('save_writing_outline', { outline });
  },

  async delete(outlineId: string): Promise<void> {
    return invoke('delete_writing_outline', { outlineId });
  },
};

/** 时间线事件（D）：独立表 writing_timeline_events，settingId 可空（null = 全书级） */
export const writingTimelineApi = {
  async list(bookId: string): Promise<WritingTimelineEvent[]> {
    return invoke<WritingTimelineEvent[]>('list_writing_timeline_events', { bookId });
  },

  async save(event: WritingTimelineEvent): Promise<void> {
    return invoke('save_writing_timeline_event', { event });
  },

  async delete(eventId: string): Promise<void> {
    return invoke('delete_writing_timeline_event', { eventId });
  },
};

export const writingStorylinesApi = {
  async list(bookId: string): Promise<WritingStoryline[]> {
    return invoke<WritingStoryline[]>('list_writing_storylines', { bookId });
  },

  async save(storyline: WritingStoryline): Promise<void> {
    return invoke('save_writing_storyline', { storyline });
  },

  async delete(storylineId: string): Promise<void> {
    return invoke('delete_writing_storyline', { storylineId });
  },
};

/** 伏笔（「埋设 → 回收」承诺）：status 三态 pending/paidoff/abandoned；回收章可空。 */
export interface WritingForeshadowing {
  id: string;
  bookId: string;
  title: string;
  description: string;
  /** 埋设章 */
  plantChapterId: string | null;
  /** 计划回收章（可空 = 还没想好收在哪） */
  payoffChapterId: string | null;
  /** pending | paidoff | abandoned */
  status: string;
  /** 可选挂剧情线（删线置 NULL 零强制） */
  storylineId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export const writingForeshadowingsApi = {
  async list(bookId: string): Promise<WritingForeshadowing[]> {
    return invoke<WritingForeshadowing[]>('list_writing_foreshadowings', { bookId });
  },

  async save(item: WritingForeshadowing): Promise<void> {
    return invoke('save_writing_foreshadowing', { item });
  },

  async delete(foreshadowingId: string): Promise<void> {
    return invoke('delete_writing_foreshadowing', { foreshadowingId });
  },
};

/** EPUB 导出载荷（章节顺序 = 传参顺序 = spine 顺序） */
export interface EpubChapterInput {
  title: string;
  content: string;
  /** 章头图相对引用（批次 2 存于章 extra.coverImage）；无则省略（创作者主权） */
  cover?: string | null;
}

export async function saveWritingEpub(
  title: string,
  description: string | null,
  chapters: EpubChapterInput[],
  path: string,
): Promise<void> {
  return invoke('save_writing_epub', { title, description, chapters, path });
}

// ─── 写作扫描（F1 分析器融合）：书 → analyses，章节 → project_files ───

export interface WritingScanSummary {
  analysisId: string;
  fileCount: number;
  totalWords: number;
  /** 写作发现条数（死设定 + 未落地节拍），已落 review_findings */
  findingCount: number;
}

export interface WritingImportSummary {
  bookId: string;
  title: string;
  chapterCount: number;
  totalWords: number;
  /** 章节切分策略：heading（按标题行）/ single（全书单章） */
  strategy: 'heading' | 'single';
}

export const writingScanApi = {
  scanBook: (bookId: string): Promise<WritingScanSummary> => invoke('scan_writing_book', { bookId }),
  /** 导入 txt/md 作品：按章节标题行切分入库（工作室「导入作品」入口） */
  importBook: (filePath: string): Promise<WritingImportSummary> => invoke('import_writing_book', { filePath }),
};

/** 素材信息（对应 Rust asset.rs 的 AssetInfo） */
export interface AssetInfo {
  /** 落盘文件名（带时间戳前缀防重名） */
  name: string;
  /** 绝对路径 —— 画布 ImageRenderer 直接吃这个 */
  path: string;
  size: number;
  modified: string;
  mimeType: string;
  thumbnail: string | null;
}

/** 素材库 API（H2 插画链路）：后端命令全部为 Result<_, String>，错误为字符串 */
export const assetApi = {
  list: (category: string, subcategory: string): Promise<AssetInfo[]> =>
    invoke('list_assets', { category, subcategory }),
  /** data 传字节数组；Rust 侧 Vec<u8> */
  save: (category: string, subcategory: string, fileName: string, data: Uint8Array): Promise<AssetInfo> =>
    invoke('save_asset', { category, subcategory, fileName, data: Array.from(data) }),
  remove: (filePath: string): Promise<boolean> => invoke('delete_asset', { filePath }),
  thumbnail: (filePath: string, maxSize: number): Promise<string> =>
    invoke('get_asset_thumbnail', { filePath, maxSize }),
  /** 相对引用 assets/<cat>/<sub>/<name> → 磁盘绝对路径（正文插画渲染/导出定位用） */
  resolveAssetRef: (rel: string): Promise<string> => invoke('resolve_asset_ref', { rel }),
};

// ─── 语料库（Sight Folio「语料库」）：外部参考书籍导入 + FTS5 全文检索 ───

/** 语料书（对应 Rust domain/corpus CorpusBook） */
export interface CorpusBook {
  id: number;
  title: string;
  author: string;
  language: string;
  source: string;
  /** 分类标签（导入后可编辑；检索时与书名/作者一并匹配）。空串 = 未分类 */
  category: string;
  /** 导入时的源文件路径（重建索引据此重读原文件；旧数据为空串） */
  sourcePath: string;
  wordCount: number;
  chunkCount: number;
  createdAt: number;
}

/** 语料库检索结果：书命中（书名/作者/分类匹配，置顶展示）+ 句子命中 */
export interface CorpusSearchResult {
  books: CorpusBook[];
  hits: CorpusSearchHit[];
}

/** 语料库可用性（对应 Rust CorpusStatus）：corpus.db 初始化失败时降级为不可用 */
export interface CorpusStatus {
  available: boolean;
  /** 不可用原因（可用时为空串） */
  error: string;
}

/** 检索命中的一条「出现位置」（重复句合并后展开用） */
export interface CorpusHitOccurrence {
  chunkId: number;
  bookId: number;
  bookTitle: string;
  seq: number;
  chapterTitle: string;
}

/** 检索命中（句子级 KWIC：句子原文 + 书/章归属）。
 *  重复句在**检索时**合并（非破坏，库里不删行）：同句只出一条代表 +
 *  occurrenceCount / occurrences；按书过滤时统计范围限该书（不做跨书合并）。 */
export interface CorpusSearchHit {
  chunkId: number;
  bookId: number;
  bookTitle: string;
  seq: number;
  kind: string;
  chapterTitle: string;
  content: string;
  /** 该句在本次检索范围内的出现次数（未合并场景为 1） */
  occurrenceCount: number;
  /** 该句的出现位置（上限 20；occurrenceCount === 1 时为空） */
  occurrences: CorpusHitOccurrence[];
}

/** 重建索引的单本结果（对应 Rust RebuildItem） */
export interface RebuildItem {
  bookId: number;
  title: string;
  /** rebuilt | skipped | failed */
  status: string;
  /** 跳过/失败原因（rebuilt 时为空） */
  reason: string;
  /** 重建后的句子总数（仅 rebuilt 有值） */
  chunkCount: number;
}

/** 重建索引汇总（对应 Rust RebuildReport） */
export interface RebuildReport {
  rebuilt: number;
  skipped: number;
  failed: number;
  items: RebuildItem[];
}

/** 导入前查重的命中项（对应 Rust DuplicateHit）；只提示不阻断 */
export interface DuplicateHit {
  /** exact_path（同一文件）| exact_content（去空白全文一致）| similar（高度相似）| same_meta（同名同作者） */
  kind: string;
  bookId: number;
  title: string;
  /** 相似度百分比（exact_* 为 100，same_meta 为 0） */
  similarity: number;
  createdAt: number;
}

/** 查重报告中的书本引用 */
export interface DuplicateBookRef {
  id: number;
  title: string;
  author: string;
  chunkCount: number;
  createdAt: number;
}

/** 一组重复的书 */
export interface DuplicateBookGroup {
  /** content_hash（内容完全相同）| source_path（同一文件）| simhash（高度相似） */
  reason: string;
  similarity: number;
  books: DuplicateBookRef[];
}

/** 一组跨书重复的句子 */
export interface SentenceDupGroup {
  sample: string;
  bookCount: number;
  chunkCount: number;
  books: string[];
}

/** 全库查重报告（对应 Rust DuplicateReport） */
export interface DuplicateReport {
  exactGroups: DuplicateBookGroup[];
  similarGroups: DuplicateBookGroup[];
  sentenceGroups: SentenceDupGroup[];
  /** 重复语句组总数（≥ sentenceGroups.length） */
  sentenceGroupTotal: number;
  bookTotal: number;
}

/** 语料库 API：检索 ≥3 字符走 FTS5 MATCH（BM25 排序），<3 字符自动 LIKE 回退（后端分流） */
export const corpusApi = {
  /** 可用性探针：不可用时前端显示横幅并禁用导入/重建/检索入口 */
  status: (): Promise<CorpusStatus> => invoke('corpus_status'),
  listBooks: (): Promise<CorpusBook[]> => invoke('list_corpus_books'),
  importFile: (filePath: string, title: string, author: string, language: string): Promise<CorpusBook> =>
    invoke('import_corpus_file', { filePath, title, author, language }),
  deleteBook: (bookId: number): Promise<void> => invoke('delete_corpus_book', { bookId }),
  /** 编辑元数据：书名/作者/语言/分类（专用 UPDATE，只碰这四列） */
  updateBook: (
    bookId: number,
    title: string,
    author: string,
    language: string,
    category: string,
  ): Promise<CorpusBook> => invoke('update_corpus_book', { bookId, title, author, language, category }),
  search: (query: string, bookId: number | null, limit = 30, offset = 0): Promise<CorpusSearchResult> =>
    invoke('search_corpus', { query, bookId, limit, offset }),
  /** 重建索引：重读源文件并重新切分（bookId 省略则重建全部作品） */
  rebuild: (bookId: number | null = null): Promise<RebuildReport> =>
    invoke('rebuild_corpus_index', { bookId }),
  /** 导入前查重：提示已存在的相同/近似作品（不阻断导入） */
  checkDuplicate: (filePath: string, title: string, author: string): Promise<DuplicateHit[]> =>
    invoke('check_corpus_duplicate', { filePath, title, author }),
  /** 全库查重报告（维护用，只读） */
  scanDuplicates: (): Promise<DuplicateReport> => invoke('scan_corpus_duplicates'),
};
