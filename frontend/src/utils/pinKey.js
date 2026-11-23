/**
 * Map a keydown event outside editable controls to a PinInput action.
 * Ignores modifier chords, IME composition, and held digit repeats.
 */
export function pinKeyAction(event) {
  if (!event || event.defaultPrevented || event.isComposing || event.keyCode === 229) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const tag = event.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return null;
  if (/^[0-9]$/.test(event.key)) return event.repeat ? null : { type: 'digit', value: event.key };
  if (event.key === 'Backspace') return { type: 'backspace' };
  if (event.key === 'Delete') return { type: 'clear' };
  return null;
}
