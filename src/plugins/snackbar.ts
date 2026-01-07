export class SnackbarPlugin {

  text: string = '';
  color: string = 'primary';
  active: boolean = false;
  timeout: number = 7000;

  setError(text: string) {
    console.error('Error: ', text)
    //@ts-ignore
    window.notify({
      text,
      theme: 'error',
      hideAfter: this.timeout,
    })
  }

  fireSuccess(text: string) {
    //@ts-ignore
    window.notify({
      text,
      theme: 'success',
      hideAfter: this.timeout,
    })
  }

  setTimeout(value: number) {
    this.timeout = value;
  }
}

export default new SnackbarPlugin();
