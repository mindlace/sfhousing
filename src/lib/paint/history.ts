/** 'Undo' / 'Undo: {label}' and 'Redo' / 'Redo: {label}', as HistoryButtons names them. */
export function historyName(kind: 'undo' | 'redo', label: string | null): string {
  const word = kind === 'undo' ? 'Undo' : 'Redo';
  return label ? `${word}: ${label}` : word;
}
