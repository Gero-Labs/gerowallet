var scriptLoadingStatus = {
  isLoading: false,
  isLoaded: false
};
async function loadMoonPay(version = "v1") {
  return new Promise((resolve, reject) => {
    const scriptSrc = '/moonpay-web-sdk.min.js';
    const existingScript = document.querySelector(`script[src="${scriptSrc}"]`);
    scriptLoadingStatus.isLoading = true;
    const checkLoaded = (count = 0) => {
      if (window.MoonPayWebSdk) {
        scriptLoadingStatus.isLoading = false;
        scriptLoadingStatus.isLoaded = true;
        resolve(window.MoonPayWebSdk.init);
        return;
      }
      if (count > 100) {
        scriptLoadingStatus.isLoading = false;
        reject(new Error("Loading MoonPayWebSdk script timed out."));
        return;
      }
      setTimeout(() => checkLoaded(count + 1), 100);
    };
    if (existingScript) {
      checkLoaded();
    } else {
      const script = document.createElement("script");
      script.async = true;
      script.src = scriptSrc;
      script.addEventListener("load", () => {
        scriptLoadingStatus.isLoading = false;
        scriptLoadingStatus.isLoaded = true;
        resolve(window.MoonPayWebSdk?.init);
      });
      script.addEventListener("error", () => {
        scriptLoadingStatus.isLoading = false;
        scriptLoadingStatus.isLoaded = false;
        reject(new Error("Failed to load MoonPayWebSdk script."));
      });
      document.body.appendChild(script);
    }
  });
}
export {
  loadMoonPay
};
//# sourceMappingURL=index.js.map
