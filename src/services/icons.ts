import { invoke } from './core';

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
