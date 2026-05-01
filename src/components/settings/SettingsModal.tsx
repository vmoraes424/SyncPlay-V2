import type { SettingsMenu, SettingsMenuId } from '../../settings/types';
import { getSettingsContent } from '../../settings/settingsContent';
import type { SettingsItem, SettingsSection } from '../../settings/types';
import { SettingsIconPlaceholder } from './SettingsIconPlaceholder';

interface SettingsModalProps {
  menus: SettingsMenu[];
  activeMenu: SettingsMenu | null;
  loading: boolean;
  onSelectMenu: (menuId: SettingsMenuId) => void;
  onBack: () => void;
  onClose: () => void;
}

export function SettingsModal({
  menus,
  activeMenu,
  loading,
  onSelectMenu,
  onBack,
  onClose,
}: SettingsModalProps) {
  const activeContent = getSettingsContent(activeMenu?.id ?? null);

  return (
    <section className="settings-modal" aria-label="Configurações">
      <header className="settings-modal__header">
        {activeMenu ? (
          <button className="settings-modal__back" type="button" onClick={onBack}>
            Voltar
          </button>
        ) : (
          <h2>Configurações</h2>
        )}
        {activeMenu && <h2>{activeMenu.title}</h2>}
        <button className="settings-modal__close" type="button" aria-label="Fechar configurações" onClick={onClose}>
          ×
        </button>
      </header>

      {loading && <p className="settings-modal__status">Carregando configurações...</p>}

      {!loading && !activeMenu && (
        <div className="settings-menu-grid">
          {menus.map(menu => (
            <button
              key={menu.id}
              className="settings-menu-card"
              type="button"
              onClick={() => onSelectMenu(menu.id)}
            >
              <SettingsIconPlaceholder label={menu.iconLabel} accent={menu.accent} src={menu.iconSrc} />
              <span>{menu.title}</span>
            </button>
          ))}
        </div>
      )}

      {!loading && activeMenu && activeContent && (
        <div className="settings-content">
          <div className="settings-content__summary">
            <SettingsIconPlaceholder
              label={activeMenu.iconLabel}
              accent={activeMenu.accent}
              src={activeMenu.iconSrc}
              compact
            />
            <span>
              <strong>{activeContent.title}</strong>
              <small>Template: #{activeContent.templateId}</small>
            </span>
          </div>
          {activeContent.sections.map(section => (
            <SettingsSectionView key={section.id} section={section} />
          ))}
        </div>
      )}
    </section>
  );
}

function SettingsSectionView({ section }: { section: SettingsSection }) {
  const level = section.level ?? 4;
  const HeadingTag = `h${level}` as 'h4' | 'h5' | 'h6';

  return (
    <section className={`settings-section settings-section--level-${level}`}>
      <HeadingTag>{section.title}</HeadingTag>
      {section.items && (
        <div className="settings-item-list">
          {section.items.map(item => <SettingsItemView key={item.id} item={item} />)}
        </div>
      )}
      {section.sections?.map(child => (
        <SettingsSectionView key={child.id} section={child} />
      ))}
    </section>
  );
}

function SettingsItemView({ item }: { item: SettingsItem }) {
  const target = item.config ? 'configs.json' : item.target;

  return (
    <div className="settings-item">
      <div className="settings-item__main">
        <strong>{item.label}</strong>
        <span>
          <code>#{item.id}</code>
          {item.config && <code>{item.config}</code>}
          {target && <em>{target}</em>}
        </span>
        {item.note && <small>{item.note}</small>}
      </div>
      <span className="settings-item__control">{controlLabel[item.control]}</span>
    </div>
  );
}

const controlLabel: Record<SettingsItem['control'], string> = {
  toggle: 'toggle',
  select: 'select',
  text: 'texto',
  number: 'número',
  range: 'intervalo',
  textarea: 'área de texto',
  checkbox: 'checkbox',
  button: 'botão',
  readonly: 'somente leitura',
  table: 'tabela',
  status: 'status',
};
