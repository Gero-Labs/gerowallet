(() => {
  const units = {
    usdcx: '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378',
    usdrf: '7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae55534472',
  };
  const pair = new URLSearchParams(window.location.search).get('pair') || 'usdcx-usdrf';
  const [tokenIn, tokenOut] = pair === 'ada-usdcx'
    ? ['lovelace', units.usdcx]
    : [units.usdcx, units.usdrf];

  customElements.whenDefined('gero-swap').then(() => {
    const widget = document.createElement('gero-swap');
    widget.setAttribute('mode', 'native');
    widget.setAttribute('network', 'mainnet');
    widget.setAttribute('base-url', `${window.location.origin}/mock`);
    widget.setAttribute('token-in', tokenIn);
    widget.setAttribute('token-out', tokenOut);
    document.querySelector('#fixture').append(widget);
    window.widgetSmoke = { widget, tokenIn, tokenOut, units };
  });
})();
