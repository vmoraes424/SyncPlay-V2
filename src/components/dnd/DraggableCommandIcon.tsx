import { type ReactNode } from 'react';
import { useCommandIconDrag } from '../../hooks/usePlaylistItemDrag';

export interface DraggableCommandIconProps {
  commandId: string;
  label: string;
  children: ReactNode;
  /** Classes extras no wrapper (ex.: margem, tamanho). */
  className?: string;
  metadata?: Record<string, unknown>;
  /**
   * Clique sem iniciar arraste — bloqueia o pointer no filho para o sensor do dnd-kit.
   * Útil enquanto o arrasto ainda não é necessário neste ícone.
   */
  onClickActivate?: () => void;
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
  onClickActivate,
}: DraggableCommandIconProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useCommandIconDrag(commandId, label, metadata);
  const dragTitle = `Arrastar: ${label}`;
  const title = onClickActivate ? `${label} — clique para alternar modo` : dragTitle;

  return (
    <div
      ref={setNodeRef}
      className={[
        'flex touch-none items-center justify-center',
        onClickActivate ? '' : 'cursor-grab active:cursor-grabbing',
        isDragging ? 'opacity-40' : '',
        className,
      ].join(' ')}
      title={title}
      {...attributes}
      {...(onClickActivate ? {} : listeners)}
    >
      {onClickActivate ? (
        <button
          type="button"
          className="flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#19a69e]"
          aria-label={label}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClickActivate();
          }}
        >
          {children}
        </button>
      ) : (
        children
      )}
    </div>
  );
}
