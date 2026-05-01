export type SettingsMenuId =
  | 'general'
  | 'updates'
  | 'playlist'
  | 'audio'
  | 'trigger'
  | 'folders'
  | 'rds'
  | 'registration'
  | 'ai'
  | 'shortcuts'
  | 'mixer';

export interface SettingsSubmenu {
  id: string;
  title: string;
  description: string;
}

export type SettingsControlType =
  | 'toggle'
  | 'select'
  | 'text'
  | 'number'
  | 'range'
  | 'textarea'
  | 'checkbox'
  | 'button'
  | 'readonly'
  | 'table'
  | 'status';

export type SettingsStorageTarget =
  | 'configs.json'
  | 'monitorSchedule.json'
  | 'reloadFixedSchedule.json'
  | 'directoriesConfig.json'
  | 'directoriesManualConfig.json'
  | 'localStorage'
  | 'ui';

export interface SettingsItem {
  id: string;
  label: string;
  control: SettingsControlType;
  config?: string;
  target?: SettingsStorageTarget;
  note?: string;
  options?: string[];
}

export interface SettingsSection {
  id: string;
  title: string;
  level?: 4 | 5 | 6;
  items?: SettingsItem[];
  sections?: SettingsSection[];
}

export interface SettingsMenuContent {
  menuId: SettingsMenuId;
  templateId: string;
  title: string;
  sections: SettingsSection[];
}

export interface SettingsMenu {
  id: SettingsMenuId;
  title: string;
  iconLabel: string;
  iconSrc?: string;
  accent: string;
  submenus: SettingsSubmenu[];
}

export interface AppSettings {
  version: number;
  ui: {
    settings: {
      activeMenuId: SettingsMenuId | null;
    };
  };
  modules: Record<string, Record<string, unknown>>;
}
