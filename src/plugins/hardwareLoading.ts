export class HardwareLoadingPlugin {

  text: string = '';
  loading: boolean = false;

  setText(text: string) {
    this.text = text;
  }

  setLoading(val: boolean) {
    this.loading = val;
  }
}

export default new HardwareLoadingPlugin();