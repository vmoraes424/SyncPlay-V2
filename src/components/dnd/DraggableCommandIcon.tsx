import { type ReactNode } from 'react';
import { useCommandIconDrag } from '../../hooks/usePlaylistItemDrag';

export interface DraggableCommandIconProps {
  commandId: string;
  label: string;
  children: ReactNode;
  /** Classes extras no wrapper (ex.: margem, tamanho). */
  className?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Ícone ou bloco que arrasta um item do tipo COMMAND para a playlist
 * (mesmo contrato que os comandos da barra lateral).
 */
export function DraggableCommandIcon({
  commandId,
  label,
  children,
  className = '',
  metadata,
}: DraggableCommandIconProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useCommandIconDrag(commandId, label, metadata);
  return (
    <div
      ref={setNodeRef}
      className={[
        'flex cursor-grab touch-none items-center justify-center active:cursor-grabbing',
        isDragging ? 'opacity-40' : '',
        className,
      ].join(' ')}
      title={`Arrastar: ${label}`}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}
