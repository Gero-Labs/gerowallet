export class LoadingPlugin {

  loading: boolean = true;
  isSyncing: boolean = true;

  setLoading(value: boolean) {
    // if (!val) {
    //     await new Promise(r => setTimeout(r, 3000));
    // }
    this.loading = value;
  }
  setSyncing(value: boolean) {
    this.isSyncing = value
  }
}

export default new LoadingPlugin();
