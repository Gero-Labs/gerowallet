export class LoadingPlugin {

  loading: boolean = true;

  setLoading(value: boolean) {
    // if (!val) {
    //     await new Promise(r => setTimeout(r, 3000));
    // }
    this.loading = value;
  }

}

export default new LoadingPlugin();
