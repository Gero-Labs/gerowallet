// Contract-only stub, not the production widget. Mirrors GeroSwapEmbed.vue's attributes,
// signer property and token-change event; it never constructs/signs/submits transactions.
class SwapContract extends HTMLElement {
  signer: { getNetworkId(): Promise<number> } | undefined;
  connectedCallback() {
    if (this.childElementCount) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = 'swap-contract-event';
    button.textContent = this.getAttribute('button-label') || 'Contract event';
    button.addEventListener('click', () => this.dispatchEvent(new CustomEvent('token-change', {
      detail: { tokenIn: 'lovelace', contractOnly: true }, bubbles: true,
    })));
    this.append(button);
  }
}
customElements.define('gero-swap', SwapContract);
export type { SwapContract };
