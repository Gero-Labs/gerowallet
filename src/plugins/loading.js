const loading = true

export default {
    setLoading(val) {
        // if (!val) {
        //     await new Promise(r => setTimeout(r, 3000));
        // }
        this.loading = val
    },
    loading,
}