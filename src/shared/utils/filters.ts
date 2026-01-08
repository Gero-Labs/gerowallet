const baseUrl = import.meta.env['VITE_BACKEND_URL'];

// Always use en-US locale for consistent number formatting regardless of user's system locale
const formatMax6Decimals = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
  useGrouping: true
})

const formatMax4Decimals = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
  useGrouping: true
})

const formatMax2Decimals = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
  useGrouping: true
})

/**
 * Cleans a numeric value by removing any locale-specific formatting (commas, spaces, etc.)
 * This ensures consistent parsing regardless of the user's locale
 * @param value - The value to clean (string or number)
 * @returns Cleaned string representation of the number
 */
const cleanNumericValue = (value: number | string): string => {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.replace(/[,\s]/g, '');
  return '0';
}

/**
 * Converts a balance from smallest unit (e.g., Lovelace) to main unit (e.g., ADA)
 * Handles both raw numbers and formatted strings
 * @param balance - Balance in smallest unit (Lovelace, etc.)
 * @param decimals - Number of decimal places (default: 6 for Cardano)
 * @returns Numeric value in main unit
 */
const convertFromSmallestUnit = (balance: number | string, decimals: number = 6): number => {
  const cleanValue = cleanNumericValue(balance);
  return Number(cleanValue) / Math.pow(10, decimals);
}

const filters = {
  truncate(value: string): any {
    if (!value || value.length <= 16) return value;
    const separator = '...';
    const sepLen = separator.length;
    const charsToShow = 16 - sepLen;
    const frontChars = Math.ceil(charsToShow / 2);
    const backChars = Math.floor(charsToShow / 2);

    return value.substring(0, frontChars) + separator + value.substring(value.length - backChars);
  },
  toIPFS(value) {
    let src
    let fileSrc
    if (typeof value == 'string') {
      fileSrc = value
    } else if (Array.isArray(value)) {
      fileSrc = value.join('')
    }
    console.log(baseUrl)
    if (fileSrc.startsWith('ar://') || fileSrc.startsWith('ar/')) {
      src = `${baseUrl}/api/ar/${fileSrc.replace('ar://', '').replace('ar/', '')}`
    } else if (fileSrc.startsWith('https://')) {
      src = fileSrc
    } else {
      src = `${baseUrl}/api/ipfs?path=${fileSrc.replace('ipfs://', '').replace('ipfs/', '')}`
    }
    return src
  },
  shortenStringWithEllipsis(str: string, maxLength: number) {
    if (!str || typeof str !== 'string') {
      return str
    }
    // Check if the string length is less than or equal to the maximum length
    if (str.length <= maxLength) {
      return str;
    }
    // Calculate the length of each part (start and end)
    const partLength = Math.floor((maxLength - 3) / 2);
    // Get the start and end parts of the string
    const startPart = str.slice(0, partLength);
    const endPart = str.slice(-partLength);
    // Concatenate the start part, ellipsis, and end part
    return `${startPart}...${endPart}`;
  },
  minutes(value: number): string {
    if (!value || typeof value !== "number") return "00:00"
    const min: number = value / 60, sec: number = value % 60
    return (min < 10 ? "0" + min : min) + ":" + (sec < 10 ? "0" + sec : sec)
  },
  msToMinutes(millis: number) {
    const minutes = Math.floor(millis / 60000);
    const seconds = Number(((millis % 60000) / 1000).toFixed(0));
    return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
  },
  toCurrency(value: number | string, signs?: boolean, decimalPlaces?: number, symbolPrefix?: string, symbolSuffix?: string, human?: boolean, decimals?: number) {
    if (symbolPrefix == undefined) {
      symbolPrefix = '₳'
    }
    if (symbolSuffix == undefined) {
      symbolSuffix = ''
    }
    if (decimals == undefined) {
      decimals = 6
    }
    
    // Convert from smallest unit to main unit (e.g., Lovelace to ADA)
    let res: number = convertFromSmallestUnit(value, decimals);
    if (human) {
      const lookup = [
        {value: 1, symbol: ""},
        {value: 1e3, symbol: "K"},
        {value: 1e6, symbol: "M"},
        {value: 1e9, symbol: "B"},
        {value: 1e12, symbol: "T"},
        {value: 1e15, symbol: "Q"}
      ];
      const item = lookup.slice().reverse().find(function (item) {
        return res >= item.value;
      });

      if (item && item.symbol) {
        symbolSuffix = item.symbol+symbolSuffix
        res = res / item.value
      }
    }
    if (decimalPlaces == 6) {
      if (res >= 0) {
        return (signs ? '+ ' : '') + symbolPrefix + formatMax6Decimals.format(res) + symbolSuffix;
      }
      return (signs ? '- ' : '') + symbolPrefix + formatMax6Decimals.format(Math.abs(res)) + symbolSuffix;
    } else if (decimalPlaces == 4) {
      if (res >= 0) {
        return (signs ? '+ ' : '') + symbolPrefix + formatMax4Decimals.format(res) + symbolSuffix;
      }
      return (signs ? '- ' : '') + symbolPrefix + formatMax4Decimals.format(Math.abs(res)) + symbolSuffix;
    } else {
      if (res >= 0) {
        return (signs ? '+ ' : '') + symbolPrefix + formatMax2Decimals.format(res) + symbolSuffix;
      }
      return (signs ? '- ' : '') + symbolPrefix + formatMax2Decimals.format(Math.abs(res)) + symbolSuffix;
    }
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
  humanFileSize(bytes, si= true, dp=1) {
    const thresh = si ? 1000 : 1024;

    if (Math.abs(bytes) < thresh) {
      return bytes + ' B';
    }

    const units = si
      ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
      : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let u = -1;
    const r = 10**dp;

    do {
      bytes /= thresh;
      ++u;
    } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);


    return bytes.toFixed(dp) + ' ' + units[u];
  },
  getColor(value: number) {
    if (value > 100) {
      value = 100
    }
    value = value / 100
    const hue = ((1 - value) * 120).toString(10);
    return ["hsl(", hue, ",100%,48%)"].join("");
  },
  extractHostname(url: string): string {
    let hostname;
    // Find & remove protocol (http, ftp, etc.) and get hostname
    if (url.indexOf('//') > -1) {
      hostname = url.split('/')[2];
    } else {
      hostname = url.split('/')[0];
    }
    // Find & remove port number
    hostname = hostname.split(':')[0];
    // Find & remove "?"
    hostname = hostname.split('?')[0];
    return hostname;
  },
  
  // Export utility functions for external use
  cleanNumericValue,
  convertFromSmallestUnit
};

export default filters;
