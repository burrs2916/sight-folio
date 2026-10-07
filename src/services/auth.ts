import { invoke } from './core';

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
