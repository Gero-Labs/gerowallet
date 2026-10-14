import { reactive } from 'vue';

export interface ToastMessage {
  id: number;
  text: string;
  theme: 'error' | 'success';
}

export const toastMessages = reactive<ToastMessage[]>([]);
let nextId = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function dismissToast(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const index = toastMessages.findIndex(message => message.id === id);
  if (index !== -1) toastMessages.splice(index, 1);
}

export class SnackbarPlugin {
  timeout = 7000;

  private show(text: string, theme: ToastMessage['theme']) {
    const id = ++nextId;
    toastMessages.push({ id, text, theme });
    timers.set(id, setTimeout(() => dismissToast(id), this.timeout));
  }

  setError(text: string) { this.show(text, 'error'); }
  fireSuccess(text: string) { this.show(text, 'success'); }
  setTimeout(value: number) { this.timeout = value; }
}

export default new SnackbarPlugin();
