const filters = {
  truncate(value: string) {
    if (!value || value.length <= 16) return 'N/A';
    const separator = '...';
    const sepLen = separator.length;
    const charsToShow = 16 - sepLen;
    const frontChars = Math.ceil(charsToShow / 2);
    const backChars = Math.floor(charsToShow / 2);

    return value.substring(0, frontChars) + separator + value.substring(value.length - backChars);
  },
  toIPFS(value: string) {
    return 'https://cloudflare-ipfs.com/ipfs/' + value;
  },
  toCurrency(value: number, decimals: number) {
    return value / Math.pow(10, decimals);
  },
  toAda(value: number, signs: boolean, decimalPlaces) {
    const res = filters.toCurrency(value, 6)
    if (res >= 0) {
      return (signs ? '+ ' : '') + '₳'+ (decimalPlaces ? res.toLocaleString(undefined, {minimumFractionDigits: decimalPlaces}) : res.toLocaleString());
    }
    return  '- ₳'+(decimalPlaces ? Math.abs(res).toLocaleString(undefined, {minimumFractionDigits: decimalPlaces}) : Math.abs(res).toLocaleString());
  },
  stateColor(state: string) {
    if (state === 'NOT_FOR_SALE') {
      return 'rgba(137,22,214,0.56)';
    }
    if (state === 'FOR_SALE') {
      return 'rgba(22,125,214,0.56)';
    }
    if (state === 'RESERVED') {
      return 'rgba(22,214,179,0.56)';
    }
    if (state === 'MINTING') {
      return 'rgba(255,87,51,0.56)';
    }
    if (state === 'VERIFYING') {
      return 'rgba(199,0,57,0.56)';
    }
    if (state === 'SOLD') {
      return 'rgba(144,12,63,0.56)';
    }

    return '';
  },
  stateTitle(val: string) {
    if (val === 'NOT_FOR_SALE') {
      return 'Not For Sale';
    }
    if (val === 'FOR_SALE') {
      return 'For Sale';
    }
    if (val === 'RESERVED') {
      return 'Reserved';
    }
    if (val === 'MINTING') {
      return 'Minting';
    }
    if (val === 'VERIFYING') {
      return 'Verifying';
    }
    if (val === 'SOLD') {
      return 'Sold';
    }

    return 'N/A';
  },
  lastIndex(val: string) {
    const tok = val.split('.');

    return tok[tok.length - 1];
  },
  lastLastIndex(val) {
    const tok = val.split('.');

    return tok[tok.length - 2];
  },
  hex2a(hexx) {
    const hex = hexx.toString().replace('0x', '');
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return str;
  },
  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  },
  ipfsStatus(ipfsArray) {
    if (ipfsArray === 'N/A') {
      return 'N/A';
    } else if (ipfsArray && ipfsArray.length >= 1) {
      const isNA = ipfsArray.every(ipfsStatus => ipfsStatus === 'N/A' || ipfsStatus === undefined);
      if (isNA) {
        return 'N/A';
      }
      const allPinned = ipfsArray.every(ipfsStatus => {
        if (ipfsStatus && ipfsStatus.pins) {
          return (
            ipfsStatus.pins.every(pin => {
              if (pin) {
                return pin.status === 'Pinned';
              } else {
                return false;
              }
            }) === true
          );
        }
        return false;
      });
      if (allPinned) {
        return 'Pinned';
      } else {
        return 'N/A';
      }
    } else {
      return 'N/A';
    }
  },
};

export default filters;
