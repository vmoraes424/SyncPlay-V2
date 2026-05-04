import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface ColumnRatios {
  'col-1': number;
  'col-2': number;
  'col-1-retrieve': number;
}

const CONFIG_FILE = 'Configs/columns.json';
const HANDLE_W = 4;         // largura do drag-handle em px (exportado para o JSX)
const COL_MIN_RATIO = 0.10; // largura mínima de cada coluna: 10%

const DEFAULT_RATIOS: ColumnRatios = {
  'col-1': 0.25,
  'col-2': 0.35,
  'col-1-retrieve': 0.25,
};

async function loadColumnRatios(): Promise<Partial<ColumnRatios>> {
  try {
    const raw: string = await invoke('read_config', { filename: CONFIG_FILE });
    return JSON.parse(raw) as Partial<ColumnRatios>;
  } catch {
    try {
      const stored = localStorage.getItem('columnConfig');
      return stored ? (JSON.parse(stored) as Partial<ColumnRatios>) : {};
    } catch {
      return {};
    }
  }
}

async function saveColumnRatios(ratios: ColumnRatios): Promise<void> {
  try {
    await invoke('write_config', {
      filename: CONFIG_FILE,
      content: JSON.stringify(ratios, null, 2),
    });
  } catch {
    localStorage.setItem('columnConfig', JSON.stringify(ratios));
  }
}

export interface UseColumnResizeReturn {
  /** Ref para o elemento wrapper que envolve as 3 colunas */
  headerRef: React.RefObject<HTMLDivElement | null>;
  /** Estilo flex da coluna 1 (considera modo retrieve) */
  col1Style: React.CSSProperties;
  /** Estilo flex da coluna 2 */
  col2Style: React.CSSProperties;
  /** Largura fixa do drag-handle em px */
  handleW: number;
  /** Se `true`, col-3 fica oculta e col-1 usa `col-1-retrieve` */
  isRetrieveMode: boolean;
  /** Alterna o modo retrieve */
  setRetrieveMode: (active: boolean) => void;
  /** Factory: retorna o onMouseDown para o handle `h1` ou `h2` */
  onHandleMouseDown: (handle: 'h1' | 'h2') => (e: React.MouseEvent) => void;
}

export function useColumnResize(): UseColumnResizeReturn {
  const [colRatios, setColRatios] = useState<ColumnRatios>(DEFAULT_RATIOS);
  const [isRetrieveMode, setRetrieveMode] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);

  // Ref espelho para leituras sem stale closure (ex.: mouseup)
  const colRatiosRef = useRef<ColumnRatios>(colRatios);
  useEffect(() => { colRatiosRef.current = colRatios; }, [colRatios]);

  const dragState = useRef<{
    handle: 'h1' | 'h2';
    startX: number;
    startR1: number;
    startR2: number;
  } | null>(null);

  // Carrega columns.json (ou localStorage como fallback) na montagem
  useEffect(() => {
    loadColumnRatios().then((saved) => {
      if (Object.keys(saved).length > 0) {
        setColRatios((prev) => ({ ...prev, ...saved }));
      }
    });
  }, []);

  // Listeners globais de mouse para o drag das colunas
  useLayoutEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds || !headerRef.current) return;
      const totalW = headerRef.current.offsetWidth;
      if (totalW === 0) return;
      const deltaRatio = (e.clientX - ds.startX) / totalW;

      setColRatios((prev) => {
        const r1 = prev['col-1'];
        const r2 = prev['col-2'];

        if (ds.handle === 'h1') {
          const maxR1 = 1 - r2 - COL_MIN_RATIO - (2 * HANDLE_W) / totalW;
          const newR1 = Math.max(COL_MIN_RATIO, Math.min(maxR1, ds.startR1 + deltaRatio));
          return { ...prev, 'col-1': newR1 };
        } else {
          const maxR2 = 1 - r1 - COL_MIN_RATIO - (2 * HANDLE_W) / totalW;
          const newR2 = Math.max(COL_MIN_RATIO, Math.min(maxR2, ds.startR2 + deltaRatio));
          return { ...prev, 'col-2': newR2 };
        }
      });
    };

    const onMouseUp = () => {
      if (!dragState.current) return;
      dragState.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      void saveColumnRatios(colRatiosRef.current);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const onHandleMouseDown = useCallback(
    (handle: 'h1' | 'h2') => (e: React.MouseEvent) => {
      e.preventDefault();
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      dragState.current = {
        handle,
        startX: e.clientX,
        startR1: colRatiosRef.current['col-1'],
        startR2: colRatiosRef.current['col-2'],
      };
    },
    [],
  );

  // Converte ratios → estilos flex
  const col1Style = useMemo<React.CSSProperties>(() => {
    const r = isRetrieveMode ? colRatios['col-1-retrieve'] : colRatios['col-1'];
    return { flex: `0 0 ${(r * 100).toFixed(4)}%`, minWidth: 0, overflow: 'hidden' };
  }, [colRatios, isRetrieveMode]);

  const col2Style = useMemo<React.CSSProperties>(() => ({
    flex: `0 0 ${(colRatios['col-2'] * 100).toFixed(4)}%`,
    minWidth: 0,
    overflow: 'hidden',
  }), [colRatios]);

  return {
    headerRef,
    col1Style,
    col2Style,
    handleW: HANDLE_W,
    isRetrieveMode,
    setRetrieveMode,
    onHandleMouseDown,
  };
}
