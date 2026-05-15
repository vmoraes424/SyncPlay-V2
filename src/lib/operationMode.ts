/** Valor em `Configs/configs.json` — alinhado às opções em Configurações. */
export type OperationMode = 'Rede' | 'Local';

export function parseOperationMode(raw: unknown): OperationMode {
  if (raw === 'Local' || raw === 'local') return 'Local';
  return 'Rede';
}

export function isNetworkOperationMode(mode: OperationMode): boolean {
  return mode === 'Rede';
}
