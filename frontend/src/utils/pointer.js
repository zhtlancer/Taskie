// Focusing a field on a touch screen opens its keyboard, which covers a dialog's quick choices.
// Only mouse and keyboard devices start in the text field.
export const prefersTyping = () => globalThis.matchMedia?.('(pointer: fine)').matches ?? true;
