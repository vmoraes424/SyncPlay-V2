import type { CSSProperties } from 'react';

interface SettingsIconPlaceholderProps {
  label?: string;
  accent?: string;
  src?: string;
  compact?: boolean;
}

export function SettingsIconPlaceholder({
  label = 'CFG',
  accent = '#3b82f6',
  src,
  compact = false,
}: SettingsIconPlaceholderProps) {
  return (
    <span
      className={compact ? 'settings-icon-placeholder settings-icon-placeholder--compact' : 'settings-icon-placeholder'}
      style={{ '--settings-icon-accent': accent } as CSSProperties}
      aria-hidden
    >
      {src ? <img src={src} alt="" /> : label}
    </span>
  );
}
