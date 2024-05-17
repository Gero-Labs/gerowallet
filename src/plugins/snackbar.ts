export class SnackbarPlugin {

  text: string = '';
  color: string = 'primary';
  active: boolean = false;
  timeout: number = 5000;

  setError(text: string) {
    this.text = text;
    this.active = true;
    this.color = '#ff6464';
  }

  setTimeout(value: number) {
    this.timeout = value;
  }
}

export default new SnackbarPlugin();