import type { LibraryColumnTabId } from './types';

const TABS: { id: LibraryColumnTabId; label: string }[] = [
  { id: 'acervo', label: 'Acervo' },
  { id: 'ia', label: 'IA' },
  { id: 'tocou', label: 'Tocou' },
];

export interface LibraryColumnTabBarProps {
  active: LibraryColumnTabId;
  onChange: (tab: LibraryColumnTabId) => void;
}

export function LibraryColumnTabBar({ active, onChange }: LibraryColumnTabBarProps) {
  return (
    <div
      className="flex gap-1 pb-1.5 bg-[#363636]"
      role="tablist"
      aria-label="Seções da biblioteca"
    >
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`library-tab-${tab.id}`}
            aria-controls={`library-tabpanel-${tab.id}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={[
              'flex-1 px-2 py-1.5 text-[0.8rem] font-medium transition-colors border outline-none focus-visible:ring-2 focus-visible:ring-neutral-500/60 focus-visible:border-neutral-500',
              isActive
                ? 'bg-white/10 text-white border-[#555]'
                : 'bg-transparent text-white/65 border-transparent hover:text-white/90 hover:bg-white/5',
            ].join(' ')}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
