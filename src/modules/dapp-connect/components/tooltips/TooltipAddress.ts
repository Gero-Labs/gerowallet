export default () => `
<div class="tooltip-wrap">
  <div class="tooltip-row">
    <img alt="Whitelisted" src="${require(`@/assets/img/cardano-shield/dapp-safe.png`)}" />
    Address is whitelisted
  </div>
  <div class="tooltip-row">
    <img alt="Blacklisted" src="${require(`@/assets/img/cardano-shield/dapp-phishing.png`)}" />
    Address is blacklisted
  </div>
  <div class="tooltip-row">
    <img alt="Suspicious" src="${require(`@/assets/img/cardano-shield/dapp-suspicious.png`)}" />
    Considered suspicious
  </div>
  <div class="tooltip-row">
    <img alt="Unknown" src="${require(`@/assets/img/cardano-shield/dapp-unknown.png`)}" />
    Address passed check
  </div>
  <div class="tooltip-row">
    <img alt="Timeout" src="${require(`@/assets/img/cardano-shield/dapp-timeout.png`)}" />
    Unable to fetch info
  </div>
</div>
`;