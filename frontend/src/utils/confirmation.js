import { shallowRef } from 'vue';

export const confirmation = shallowRef(null);
const queue = [];
export function ask(options) {
  return new Promise(resolve => {
    queue.push({ ...options, resolve });
    if (!confirmation.value) confirmation.value = queue[0];
  });
}
export function settleConfirmation(value) {
  const current = queue.shift();
  confirmation.value = queue[0] || null;
  current?.resolve(value);
}
export async function confirmAction(message) {
  return Boolean(await ask({ title: '确认操作', message, confirmText: '确认', tone: 'danger' }));
}
export function promptAction(message, initial = '') {
  return ask({ title: '填写原因', message, initial, input: true, confirmText: '确认', tone: 'primary' });
}
