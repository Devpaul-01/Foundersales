// frontend/src/hooks/useCalendarShortcuts.ts
import { useEffect } from 'react';

interface ShortcutHandlers {
  onNew?: () => void;
  onToday?: () => void;
  onSearch?: () => void;
  onEscape?: () => void;
}

/**
 * Small, generic keyboard-shortcut hook — deliberately not hardcoded
 * per-shortcut handlers scattered across components, so it's easy to
 * extend as more shortcuts are added later.
 */
export function useCalendarShortcuts({ onNew, onToday, onSearch, onEscape }: ShortcutHandlers) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping = ['INPUT', 'TEXTAREA'].includes(target?.tagName) || target?.isContentEditable;
      if (isTyping) {
        if (e.key === 'Escape' && onEscape) onEscape();
        return;
      }
      if (e.key === 'n' && onNew) { e.preventDefault(); onNew(); }
      if (e.key === 't' && onToday) { e.preventDefault(); onToday(); }
      if (e.key === '/' && onSearch) { e.preventDefault(); onSearch(); }
      if (e.key === 'Escape' && onEscape) onEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNew, onToday, onSearch, onEscape]);
}
