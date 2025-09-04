# Position Value Tooltip - Complete Mathematical Documentation

This document provides a comprehensive breakdown of each tooltip item, its calculation functions, complete function definitions, formulas, and the `PerpetualInfo` data fields used.

## Tooltip Items and Calculations

### 1. **Opening Fee**
**Display:** Shows the fee paid when opening the position

**Data Used from PerpetualInfo:**
- `openingUSDFee` (primary source - uses this if available)
- `positionSize` (fallback calculation)
- `entryPrice` (fallback calculation)
- `version` (fallback calculation)

**Complete Function Definition:**
```typescript
// Main calculation (lines 195-197)
const openingFee = openingUSDFee
  ? openingUSDFee
  : calculateOpeningFee(positionSize, entryPrice, 0, 0, "Long", version);
```

**External Function `calculateOpeningFee` (from @/lib/math):**
```typescript
export const calculateOpeningFee = (
  positionSize: number,
  entryPrice: number,
  totalLongInterest: number,
  totalShortInterest: number,
  position: "Long" | "Short",
  version?: number,
  token: "ada" | "snek" = "ada"
) => {
  return (
    calculateOpeningFeeADA(
      positionSize,
      totalLongInterest,
      totalShortInterest,
      position,
      version,
      token
    ) * entryPrice
  );
};

export const calculateOpeningFeeADA = (
  positionSize: number,
  totalLongInterest: number,
  totalShortInterest: number,
  position: "Long" | "Short",
  version?: number,
  token: "ada" | "snek" = "ada"
) => {
  // Get percentage - use version if provided, otherwise use dynamic calculation
  const percentage = version
    ? getVersionPercentage(version, token)
    : openingFee(position, totalLongInterest, totalShortInterest, token);

  // Platform fee: percentage of position size OR at least 2 ADA/SNEK
  const platformFee = Math.max(positionSize * percentage, 2);

  const lpFee = positionSize * 0.002;

  const openFee = platformFee + lpFee;

  return openFee;
};

const getVersionPercentage = (
  version: number,
  token: "ada" | "snek" = "ada"
): number => {
  const config = tokenConfig[token].openingFee;
  return version === 1 ? config.v1 : version === 2 ? config.v2 : config.default;
};

export const openingFee = (
  position: "Long" | "Short",
  totalLongInterest: number,
  totalShortInterest: number,
  token: "ada" | "snek" = "ada"
): number => {
  if (position === "Short") {
    return 0.001;
  }

  // Calculate total interest
  const totalInterest = totalLongInterest + totalShortInterest;

  // Handle edge case where total interest is 0
  if (totalInterest === 0) {
    return tokenConfig[token].openingFee.v2; // Default to v2 fee
  }

  // Calculate long percentage
  const longPercentage = (totalLongInterest / totalInterest) * 100;

  // Return fee based on long percentage thresholds
  if (longPercentage > 95) {
    return 0.0065;
  } else if (longPercentage > 90) {
    return 0.0055;
  } else if (longPercentage > 85) {
    return 0.0045;
  } else if (longPercentage > 80) {
    return 0.0035;
  } else if (longPercentage > 75) {
    return 0.00325;
  } else if (longPercentage > 70) {
    return 0.003;
  } else if (longPercentage > 65) {
    return 0.00275;
  } else {
    return tokenConfig[token].openingFee.v2;
  }
};

// Token configuration
export const tokenConfig = {
  ada: {
    openingFee: { v1: 0.003, v2: 0.0025, default: 0.004 },
    // ... other config
  },
  snek: {
    openingFee: { v1: 0.003, v2: 0.0025, default: 0.004 },
    // ... other config
  },
} as const;
```

**Formula:**
```
// Primary: Use openingUSDFee from PerpetualInfo if available

// Fallback:
percentage = getVersionPercentage(version, token) OR openingFee(position, 0, 0, token)
platformFee = Math.max(positionSize * percentage, 2)
lpFee = positionSize * 0.002
openingFeeADA = platformFee + lpFee
openingFeeUSD = openingFeeADA * entryPrice
```

---

### 2. **Hourly Borrow Fee**
**Display:** Shows the hourly fee rate and percentage of position value

**Data Used from PerpetualInfo:**
- `hourlyBorrowFee` (from props, likely derived from `PerpetualInfo.hourlyBorrowFee`)
- `positionSize`

**Complete Function Definition:**
```typescript
const formatPercentage = (value: number, totalPositionValue: number) => {
  if (totalPositionValue === 0) return "0.00%";
  const percentage = (Math.abs(value) / totalPositionValue) * 100;

  if (percentage === 0) return "0.00%";
  if (percentage >= 0.01) return `${percentage.toFixed(2)}%`;

  // For very small percentages, show at least 2 significant digits
  const percentageStr = percentage.toFixed(20);
  const [, decimalPart = ""] = percentageStr.split(".");

  let firstNonZeroIndex = -1;
  for (let i = 0; i < decimalPart.length; i++) {
    if (decimalPart[i] !== "0") {
      firstNonZeroIndex = i;
      break;
    }
  }

  if (firstNonZeroIndex === -1) return "0.00%";

  const decimalPlaces = firstNonZeroIndex + 2;
  return `${percentage.toFixed(decimalPlaces)}%`;
};

// Usage (lines 281, 305)
const totalPositionValue = positionSize * currentPrice;
formatPercentage(hourlyBorrowFee, totalPositionValue)
```

**Formula:**
```
totalPositionValue = positionSize * currentPrice
percentage = (Math.abs(hourlyBorrowFee) / totalPositionValue) * 100
```

---

### 3. **Next Hourly Fee Update (Countdown)**
**Display:** Shows countdown timer until next hourly fee update

**Data Used from PerpetualInfo:**
- `enteredPositionTime`

**Complete Function Definition:**
```typescript
const calculateCountdown = () => {
  const now = Date.now() + 300000;
  const adjustedStartTime = enteredPositionTime;
  const positionHours = Math.floor(
    (now - adjustedStartTime) / (1000 * 60 * 60)
  );
  const nextHourlyUpdate =
    adjustedStartTime + (positionHours + 1) * (1000 * 60 * 60);
  const timeUntilNext = nextHourlyUpdate - now;

  if (timeUntilNext <= 0) {
    return "Next fee update: Now";
  }

  const minutes = Math.floor(timeUntilNext / (1000 * 60));
  const seconds = Math.floor((timeUntilNext % (1000 * 60)) / 1000);

  return `Next Hourly Fee Update: ${minutes}m ${seconds}s`;
};

// Usage with useEffect (lines 71-84)
useEffect(() => {
  const updateCountdown = () => {
    setCountdown(calculateCountdown());
  };

  updateCountdown();
  const interval = setInterval(updateCountdown, 1000);
  return () => clearInterval(interval);
}, [enteredPositionTime]);
```

**Formula:**
```
now = Date.now() + 300000  // Current time + 5min offset
positionHours = Math.floor((now - enteredPositionTime) / (1000 * 60 * 60))
nextHourlyUpdate = enteredPositionTime + (positionHours + 1) * (1000 * 60 * 60)
timeUntilNext = nextHourlyUpdate - now
minutes = Math.floor(timeUntilNext / (1000 * 60))
seconds = Math.floor((timeUntilNext % (1000 * 60)) / 1000)
```

---

### 4. **Liquidation After Hourly**
**Display:** Shows predicted liquidation price after next hourly fee update

**Data Used from PerpetualInfo:**
- `rawPositionAssetAmount` (optional)
- `rawEnteredAtUsdPrice` (optional)
- `rawMaintainMarginAmount` (optional)
- `rawCollateralAssetAmount` (optional)
- `rawHourlyUsdBorrowFee` (optional)
- `position` ("Long" | "Short")
- `enteredPositionTime`
- `asset.ticker` (from AssetInfo)
- `positionSize`
- `entryPrice`
- `collateral.amount`

**Complete Function Definition:**
```typescript
const calculateLiquidationPriceAfterNextHourlyUpdate = () => {
  const currentTime = Date.now() + 300000;
  const nextHourTime = currentTime + 60 * 60 * 1000;

  if (
    rawPositionAssetAmount !== undefined &&
    rawEnteredAtUsdPrice !== undefined &&
    rawMaintainMarginAmount !== undefined &&
    rawCollateralAssetAmount !== undefined &&
    rawHourlyUsdBorrowFee !== undefined
  ) {
    const liquidationPrice = findLiquidationPrice(
      position,
      rawPositionAssetAmount,
      rawEnteredAtUsdPrice,
      rawMaintainMarginAmount,
      rawCollateralAssetAmount,
      rawHourlyUsdBorrowFee,
      enteredPositionTime,
      nextHourTime
    );

    const usdPriceMultiplier = assetTicker === "SNEK" ? 1_000_000 : 10_000;
    return liquidationPrice / usdPriceMultiplier;
  } else {
    const usdPriceMultiplier = assetTicker === "SNEK" ? 1_000_000 : 10_000;
    const decimals = assetTicker === "SNEK" ? 1 : 1_000_000;
    const maintainMargin =
      assetTicker === "SNEK"
        ? snekMaintainMarginAmount
        : maintainMarginAmount;

    const positionAssetAmount = positionSize * decimals;
    const enteredAtUsdPrice = entryPrice * usdPriceMultiplier;
    const collateralAssetAmount =
      (collateralAmount || positionSize) * decimals;
    const hourlyUsdBorrowFee = hourlyBorrowFee * usdPriceMultiplier;

    const liquidationPrice = findLiquidationPrice(
      position,
      positionAssetAmount,
      enteredAtUsdPrice,
      maintainMargin,
      collateralAssetAmount,
      hourlyUsdBorrowFee,
      enteredPositionTime,
      nextHourTime
    );

    return liquidationPrice / usdPriceMultiplier;
  }
};
```

**External Function `findLiquidationPrice` (from @/lib/math):**
```typescript
export const findLiquidationPrice = (
  side: "Long" | "Short",
  positionAmount: number,
  enteredAtUsdPrice: number,
  maintainMarginAmount: number,
  collateralAmount: number,
  hourlyBorrowUsdFee: number,
  enteredPositionTime: number,
  currentTime: number
): number => {
  // Calculate accumulated interest fee
  const hoursElapsed = (currentTime - enteredPositionTime) / 3600 / 1000;

  const interestFee = hourlyBorrowUsdFee * hoursElapsed;

  // Calculate collateral value AFTER deducting interest fees
  const collateralValue = collateralAmount * enteredAtUsdPrice;

  const maintainMarginFactor = maintainMarginAmount / 100;

  let liquidationPrice: number;

  if (side === "Long") {
    liquidationPrice =
      (collateralValue - positionAmount * enteredAtUsdPrice - interestFee) /
      (positionAmount * (maintainMarginFactor - 1));

    return Math.floor(liquidationPrice);
  } else {
    liquidationPrice =
      (collateralValue + positionAmount * enteredAtUsdPrice - interestFee) /
      (positionAmount * (maintainMarginFactor + 1));

    return Math.ceil(liquidationPrice);
  }
};
```

**Formula:**
```
nextHourTime = currentTime + 60 * 60 * 1000
hoursElapsed = (nextHourTime - enteredPositionTime) / 3600 / 1000
interestFee = hourlyBorrowUsdFee * hoursElapsed
collateralValue = collateralAmount * enteredAtUsdPrice
maintainMarginFactor = maintainMarginAmount / 100

Long Position:
liquidationPrice = (collateralValue - positionAmount * enteredAtUsdPrice - interestFee) / (positionAmount * (maintainMarginFactor - 1))
result = Math.floor(liquidationPrice)

Short Position:
liquidationPrice = (collateralValue + positionAmount * enteredAtUsdPrice - interestFee) / (positionAmount * (maintainMarginFactor + 1))
result = Math.ceil(liquidationPrice)

finalPrice = liquidationPrice / usdPriceMultiplier
```

---

### 5. **Accumulated Borrow Fee**
**Display:** Shows total borrow fees accumulated since position opening

**Data Used from PerpetualInfo:**
- `hourlyBorrowFee` (from props)
- `enteredPositionTime`

**Complete Function Definition:**
```typescript
const calculateAccumulatedBorrowFee = (
  hourlyBorrowFee: number,
  enteredPositionTime: number
) => {
  const currentTime = Date.now() + 300000;
  const hoursElapsed = (currentTime - enteredPositionTime) / (1000 * 60 * 60);
  return hourlyBorrowFee * hoursElapsed;
};

// Usage (lines 199-202)
const accumulatedBorrowFee = calculateAccumulatedBorrowFee(
  hourlyBorrowFee,
  enteredPositionTime
);
```

**Formula:**
```
currentTime = Date.now() + 300000
hoursElapsed = (currentTime - enteredPositionTime) / (1000 * 60 * 60)
accumulatedBorrowFee = hourlyBorrowFee * hoursElapsed
```

---

### 6. **PNL (Profit and Loss)**
**Display:** Shows unrealized profit/loss excluding fees

**Data Used from PerpetualInfo:**
- `entryPrice`
- `position` ("Long" | "Short")
- `positionSize`

**Complete Function Definition:**
```typescript
const calculatePNL = (
  entryPrice: number,
  markPrice: number,
  side: "Long" | "Short",
  size: number
) => {
  const pnl =
    side === "Long"
      ? (markPrice - entryPrice) * size
      : (entryPrice - markPrice) * size;

  return Number(pnl.toFixed(2));
};

// Usage (line 203)
const profit = calculatePNL(entryPrice, currentPrice, position, positionSize);
```

**Formula:**
```
Long Position:  pnl = (currentPrice - entryPrice) * positionSize
Short Position: pnl = (entryPrice - currentPrice) * positionSize
result = Number(pnl.toFixed(2))
```

---

### 7. **PNL With Fees**
**Display:** Shows net profit/loss including all fees

**Data Used from PerpetualInfo:**
- `entryPrice`
- `position` ("Long" | "Short")
- `positionSize`
- `hourlyBorrowFee` (from props)
- `version`
- `enteredPositionTime`
- `openingUSDFee` (optional)

**Complete Function Definition:**
```typescript
const calculatePNLWithFees = (
  entryPrice: number,
  markPrice: number,
  side: "Long" | "Short",
  size: number,
  includeFees: boolean,
  hourlyBorrowFee: number,
  version: number,
  enteredPositionTime: number,
  openingUSDFee?: number
) => {
  const basePNL = calculatePNL(entryPrice, markPrice, side, size);

  if (!includeFees) {
    return basePNL;
  }

  let openingFee = 0;

  if (openingUSDFee) {
    openingFee = openingUSDFee;
  } else {
    openingFee = calculateOpeningFee(size, entryPrice, 0, 0, "Long", version);
  }

  const accumulatedBorrowFee = calculateAccumulatedBorrowFee(
    hourlyBorrowFee,
    enteredPositionTime
  );

  return Number((basePNL - openingFee - accumulatedBorrowFee).toFixed(2));
};

// Usage (lines 205-214)
const profitWithFees = calculatePNLWithFees(
  entryPrice,
  currentPrice,
  position,
  positionSize,
  true,
  hourlyBorrowFee,
  version,
  enteredPositionTime
);
```

**Formula:**
```
basePNL = calculatePNL(entryPrice, currentPrice, position, positionSize)
openingFee = openingUSDFee || calculateOpeningFee(positionSize, entryPrice, 0, 0, "Long", version)
accumulatedBorrowFee = calculateAccumulatedBorrowFee(hourlyBorrowFee, enteredPositionTime)
pnlWithFees = basePNL - openingFee - accumulatedBorrowFee
result = Number(pnlWithFees.toFixed(2))
```

---

## Utility Functions

### **formatCurrency**
**Complete Function Definition:**
```typescript
const formatCurrency = (value: number) => {
  const formattedValue = Math.abs(value).toFixed(
    Math.max(2, Math.abs(value) < 0.01 ? 4 : 2)
  );
  return value < 0 ? `-$${formattedValue}` : `$${formattedValue}`;
};
```

### **formatPriceWithMinDigits**
**Complete Function Definition:**
```typescript
const formatPriceWithMinDigits = (price: number): string => {
  if (price === 0 || !isFinite(price) || isNaN(price)) return "0.0000";

  if (price >= 1) {
    // For prices >= 1, show standard 2 decimal places
    return price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  // For prices < 1, we need to show at least 4 significant digits
  // Convert to string in fixed notation to avoid scientific notation
  const priceStr = price.toFixed(20); // Use high precision to avoid rounding
  const [, decimalPart = ""] = priceStr.split(".");

  // Find the first non-zero digit in decimal part
  let firstNonZeroIndex = -1;
  for (let i = 0; i < decimalPart.length; i++) {
    if (decimalPart[i] !== "0") {
      firstNonZeroIndex = i;
      break;
    }
  }

  if (firstNonZeroIndex === -1) return "0.0000";

  // We want at least 4 significant digits after the first non-zero
  const decimalPlaces = firstNonZeroIndex + 4;

  return price.toFixed(decimalPlaces);
};
```

---

## External Dependencies

### **From `@/lib/math`:**
1. **`calculateOpeningFee(size, price, 0, 0, "Long", version)`** - Complete implementation above
2. **`findLiquidationPrice(...)`** - Complete implementation above

### **From `@/lib/constants`:**
1. **`maintainMarginAmount`** - Maintenance margin for most assets
2. **`snekMaintainMarginAmount`** - Maintenance margin for SNEK asset

---

## PerpetualInfo Type Structure

```typescript
export interface PerpetualInfo {
  position: "Long" | "Short";                    // Used in: PNL calculations, liquidation price
  positionSize: number;                          // Used in: All PNL calculations, opening fee, percentage calculations
  leverage: number;                              // Not used in tooltip calculations
  stopLoss: number;                              // Not used in tooltip calculations
  takeProfit: number;                            // Not used in tooltip calculations
  asset: AssetInfo;                              // Used for: asset.ticker (SNEK vs others)
  collateral: {                                  // Used in: liquidation price calculation (fallback)
    amount: number;
    ticker: string;
    includeStrike?: boolean;
    strikeAmount?: number;
  };
  entryPrice: number;                            // Used in: PNL calculations, opening fee, liquidation price
  isPending: boolean;                            // Not used in tooltip calculations
  outRef: OutRef;                                // Not used in tooltip calculations
  enteredPositionTime: number;                   // Used in: countdown, accumulated fees, liquidation price
  status: "Pending" | "Completed" | "Limit Order"; // Not used in tooltip calculations
  liquidationPrice: number;                     // Not used in tooltip calculations (calculated fresh)
  version: number;                               // Used in: opening fee calculation
  hourlyBorrowFee?: number;                      // Used in: hourly fee display, accumulated fee, PNL with fees
  originalTxHash?: string;                       // Not used in tooltip calculations
  openingUSDFee?: number;                        // PRIMARY SOURCE for opening fee display
  
  // Raw blockchain values for accurate liquidation calculation
  rawPositionAssetAmount?: number;               // Used in: liquidation price (preferred)
  rawEnteredAtUsdPrice?: number;                 // Used in: liquidation price (preferred)
  rawMaintainMarginAmount?: number;              // Used in: liquidation price (preferred)
  rawCollateralAssetAmount?: number;             // Used in: liquidation price (preferred)
  rawHourlyUsdBorrowFee?: number;               // Used in: liquidation price (preferred)
}
```

---

## Constants Used

- **Time Offset:** `300000ms` (5 minutes) - Added to current time for all calculations
- **Hour in Milliseconds:** `1000 * 60 * 60` (3,600,000ms)
- **USD Price Multipliers:** 
  - Default assets: `10_000`
  - SNEK asset: `1_000_000`
- **Decimals:**
  - Default assets: `1_000_000`
  - SNEK asset: `1`
- **Opening Fee Configuration:**
  - v1: `0.003` (0.3%)
  - v2: `0.0025` (0.25%)
  - default: `0.004` (0.4%)
  - LP Fee: `0.002` (0.2%)
  - Minimum Platform Fee: `2` ADA/SNEK

---

## Data Flow Summary

1. **Opening Fee:** Uses `PerpetualInfo.openingUSDFee` directly (preferred) or calculates using `calculateOpeningFee()`
2. **Hourly Borrow Fee:** Uses `PerpetualInfo.hourlyBorrowFee` directly
3. **Countdown:** Calculates from `PerpetualInfo.enteredPositionTime`
4. **Liquidation Price:** Uses raw blockchain values if available, otherwise calculates from display values
5. **Accumulated Fee:** Calculated from `hourlyBorrowFee` and time elapsed
6. **PNL:** Calculated from price difference and position size
7. **PNL With Fees:** Combines PNL with opening fee and accumulated borrow fee