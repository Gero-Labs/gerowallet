export class LoadingPlugin {

  loading: boolean = true;
  text: string = '';
  isSyncing: boolean = true;
  isRestoring: boolean = false;

  setLoading(value: boolean) {
    // if (!val) {
    //     await new Promise(r => setTimeout(r, 3000));
    // }
    this.loading = value;
  }
  setText(value: string) {
    this.text = value
  }
  setSyncing(value: boolean) {
    this.isSyncing = value
  }
  setRestoring(value: boolean) {
    if (!value) {
      this.setText('')
    }
    this.loading = value
    this.isRestoring = value
  }
}

export default new LoadingPlugin();
