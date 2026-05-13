import type { SVGProps } from 'react';
import type { LibraryColumnTabId } from './types';

type TabIconProps = SVGProps<SVGSVGElement>;

function AcervoTabIcon(props: TabIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      fill="currentColor"
      {...props}
    >
      <path d="M640-160q-50 0-85-35t-35-85q0-50 35-85t85-35q11 0 21 1.5t19 6.5v-328h200v80H760v360q0 50-35 85t-85 35ZM120-320v-80h320v80H120Zm0-160v-80h480v80H120Zm0-160v-80h480v80H120Z" />
    </svg>
  );
}

function IaTabIcon(props: TabIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      fill="currentColor"
      {...props}
    >
      <path d="m176-120-56-56 301-302-181-45 198-123-17-234 179 151 216-88-87 217 151 178-234-16-124 198-45-181-301 301Zm24-520-80-80 80-80 80 80-80 80Zm355 197 48-79 93 7-60-71 35-86-86 35-71-59 7 92-79 49 90 22 23 90Zm165 323-80-80 80-80 80 80-80 80ZM569-570Z" />
    </svg>
  );
}

function TocouTabIcon(props: TabIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      fill="currentColor"
      {...props}
    >
      <path d="M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-418v-422h240v160H560v400q0 66-47 113t-113 47Z" />
    </svg>
  );
}

const ICON_CLASS = 'shrink-0 size-5 pointer-events-none';

const TABS: {
  id: LibraryColumnTabId;
  label: string;
  Icon: (p: TabIconProps) => React.ReactElement;
}[] = [
  { id: 'acervo', label: 'Acervo', Icon: AcervoTabIcon },
  { id: 'ia', label: 'IA', Icon: IaTabIcon },
  { id: 'tocou', label: 'Tocou', Icon: TocouTabIcon },
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
        const Icon = tab.Icon;
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
              'flex-1 px-2 py-1.5 flex items-center gap-1 justify-center text-[0.8rem] font-medium transition-colors border outline-none focus-visible:ring-2 focus-visible:ring-neutral-500/60 focus-visible:border-neutral-500',
              isActive
                ? 'bg-white/10 text-white border-[#555]'
                : 'bg-transparent text-white/65 border-transparent hover:text-white/90 hover:bg-white/5',
            ].join(' ')}
            onClick={() => onChange(tab.id)}
          >
            <Icon className={ICON_CLASS} aria-hidden />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
