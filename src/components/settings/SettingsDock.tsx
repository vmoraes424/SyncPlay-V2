import { useState } from 'react';
import { SETTINGS_MENUS, findSettingsMenu } from '../../settings/menuCatalog';
import { useAppSettings } from '../../settings/useAppSettings';
import type { SettingsMenuId } from '../../settings/types';
import { SettingsModal } from './SettingsModal';
import './settings.css';
import settingsIcon from '../../assets/prisma.png';

export function SettingsDock() {
  const [isOpen, setIsOpen] = useState(false);
  const { settings, loading, error, updateSettings } = useAppSettings();
  const activeMenu = findSettingsMenu(settings.ui.settings.activeMenuId);

  const openSettings = () => {
    setIsOpen(current => !current);
    updateSettings(current => ({
      ...current,
      ui: {
        ...current.ui,
        settings: {
          ...current.ui.settings,
          activeMenuId: null,
        },
      },
    }));
  };

  const selectMenu = (menuId: SettingsMenuId) => {
    updateSettings(current => ({
      ...current,
      ui: {
        ...current.ui,
        settings: {
          ...current.ui.settings,
          activeMenuId: menuId,
        },
      },
    }));
  };

  const clearActiveMenu = () => {
    updateSettings(current => ({
      ...current,
      ui: {
        ...current.ui,
        settings: {
          ...current.ui.settings,
          activeMenuId: null,
        },
      },
    }));
  };

  return (
    <>
      <div className="settings-taskbar">
        <button className="cursor-pointer hover:opacity-80 transition-opacity duration-200" type="button" onClick={openSettings}>
          <img src={settingsIcon} alt="" className="w-8 h-6" />
        </button>
        {error && <span className="settings-taskbar__error">Erro ao salvar configurações</span>}
      </div>

      {isOpen && (
        <SettingsModal
          menus={SETTINGS_MENUS}
          activeMenu={activeMenu}
          loading={loading}
          onSelectMenu={selectMenu}
          onBack={clearActiveMenu}
          onClose={() => {
            setIsOpen(false);
            clearActiveMenu();
          }}
        />
      )}
    </>
  );
}
