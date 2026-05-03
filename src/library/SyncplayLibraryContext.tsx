import { createContext, useContext, type ReactNode } from 'react';

export interface SyncplayLibraryMaps {
  musicLibrary: Record<string, unknown> | null;
  musicFilters: Record<string, unknown> | null;
  mediaLibrary: Record<string, unknown> | null;
  mediaFilters: Record<string, unknown> | null;
}

const SyncplayLibraryContext = createContext<SyncplayLibraryMaps | null>(null);

export function SyncplayLibraryProvider({
  value,
  children,
}: {
  value: SyncplayLibraryMaps;
  children: ReactNode;
}) {
  return <SyncplayLibraryContext.Provider value={value}>{children}</SyncplayLibraryContext.Provider>;
}

export function useSyncplayLibraryMaps(): SyncplayLibraryMaps {
  return (
    useContext(SyncplayLibraryContext) ?? {
      musicLibrary: null,
      musicFilters: null,
      mediaLibrary: null,
      mediaFilters: null,
    }
  );
}
