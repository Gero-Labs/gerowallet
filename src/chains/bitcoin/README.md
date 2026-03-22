# Bitcoin Integration - Coin Selection & PSBT Building

## Overview

The Bitcoin integration modules provide complete transaction building capabilities:

- **Coin Selection**: Multiple UTXO selection strategies (largest-first, smallest-first, accumulative, branch-and-bound)
- **PSBT Building**: Create unsigned PSBTs ready for signing by software/hardware wallets
- **Fee Estimation**: Real-time fee rate fetching with 3-tier priority (Fast/Medium/Slow)
- **Automatic Fee Calculation**: SegWit-aware virtual byte calculation
- **Change Output Management**: Smart change creation with dust threshold
- **Transaction Size Estimation**: Accurate vbyte calculation for P2WPKH (SegWit)

## Fee Estimation

### Get Current Fee Estimates

```typescript
import { getBitcoinFeeEstimator, FeePriority } from '@/chains/bitcoin/bitcoinFeeEstimator';
import { BitcoinApi } from '@/api/bitcoin-api';

// Initialize fee estimator
const feeEstimator = getBitcoinFeeEstimator();
const bitcoinApi = new BitcoinApi({ chain: 'Bitcoin', network: 'Mainnet' }, 'BLOCKSTREAM');
feeEstimator.setApi(bitcoinApi);

// Get all fee estimates (Fast/Medium/Slow)
const estimates = await feeEstimator.getAllFeeEstimates();

console.log('Fast:', estimates[0].feeRate, 'sat/vB (~10 min)');
console.log('Medium:', estimates[1].feeRate, 'sat/vB (~30 min)');
console.log('Slow:', estimates[2].feeRate, 'sat/vB (~60 min)');

// Get specific priority
const fastFee = await feeEstimator.getFeeEstimate(FeePriority.FAST);
console.log(`Fast fee: ${fastFee.feeRate} sat/vB`);
console.log(`Confirmation: ~${fastFee.estimatedMinutes} minutes`);
```

### Fee Priority Levels

```typescript
enum FeePriority {
  FAST = 'fast',       // Next block (~10 min)
  MEDIUM = 'medium',   // ~30 minutes (3 blocks)
  SLOW = 'slow',       // ~60 minutes (6 blocks)
  CUSTOM = 'custom'    // User-defined fee rate
}
```

### Calculate Transaction Fee

```typescript
// Calculate fee for specific transaction
const feeBreakdown = feeEstimator.calculateTransactionFee(
  2,      // Input count
  2,      // Output count (recipient + change)
  10,     // Fee rate (sat/vB)
  80000n  // Transaction amount (optional, for percentage calculation)
);

console.log('Transaction size:', feeBreakdown.transactionSize, 'vbytes');
console.log('Total fee:', feeBreakdown.totalFee, 'satoshis');
console.log('Total fee:', feeBreakdown.totalFeeBtc, 'BTC');
console.log('Fee percentage:', feeBreakdown.feePercentage.toFixed(2), '%');
```

### Estimate Fee for Specific Transaction

```typescript
// Estimate fee using actual UTXOs and outputs
const feeBreakdown = await feeEstimator.estimateTransactionFee(
  utxos,
  outputs,
  FeePriority.MEDIUM
);

console.log('Estimated fee:', feeBreakdown.totalFee);
console.log('Fee rate:', feeBreakdown.feeRate, 'sat/vB');
```

### Using Bitcoin Adapter

```typescript
import { createBitcoinAdapter } from '@/chains/bitcoin/bitcoinAdapter';
import { FeePriority } from '@/chains/bitcoin/bitcoinFeeEstimator';

const adapter = createBitcoinAdapter('Mainnet', 'segwit');
adapter.initializeFeeEstimator(bitcoinApi);

// Get all fee options
const feeOptions = await adapter.getAllFeeEstimates();

// Display to user
feeOptions.forEach(option => {
  console.log(`${option.description}: ${option.feeRate} sat/vB`);
});

// Get recommended fee rate
const recommendedFeeRate = await adapter.getRecommendedFeeRate('medium');
console.log('Recommended:', recommendedFeeRate, 'sat/vB');

// Estimate fee for transaction
const txFee = await adapter.estimateTransactionFee(
  utxos,
  outputs,
  FeePriority.MEDIUM
);
```

### Fee Caching

Fee estimates are cached for 60 seconds to reduce API calls:

```typescript
const estimator = getBitcoinFeeEstimator();

// Set custom cache TTL (in milliseconds)
estimator.setCacheTtl(120000); // 2 minutes

// Force refresh (bypass cache)
const freshEstimates = await estimator.fetchFeeEstimates(true);

// Clear cache manually
estimator.clearCache();
```

### Fee Validation

```typescript
const validation = feeEstimator.validateFeeRate(customFeeRate);

if (!validation.valid) {
  console.error('Invalid fee rate:', validation.message);
  // "Fee rate too low. Minimum is 1 sat/vB"
  // "Fee rate too high. Maximum is 1000 sat/vB"
}
```

### Fee Estimation Examples

**Example 1: Simple send with fee selector**

```typescript
// Get fee options
const feeOptions = await adapter.getAllFeeEstimates();

// User selects Medium priority
const selectedPriority = FeePriority.MEDIUM;
const feeEstimate = await adapter.getFeeEstimate(selectedPriority);

// Build transaction with selected fee rate
const unsignedTx = adapter.buildSendTransaction(
  utxos,
  recipientAddress,
  amount,
  feeEstimate.feeRate
);

console.log('Transaction fee:', unsignedTx.fee, 'satoshis');
console.log('Confirmation time:', feeEstimate.estimatedMinutes, 'minutes');
```

**Example 2: Display fee breakdown to user**

```typescript
const priorities = [FeePriority.FAST, FeePriority.MEDIUM, FeePriority.SLOW];

for (const priority of priorities) {
  const estimate = await adapter.getFeeEstimate(priority);
  const breakdown = feeEstimator.calculateTransactionFee(
    2, // Estimated inputs
    2, // Estimated outputs
    estimate.feeRate,
    sendAmount
  );

  console.log(`${estimate.description}:`);
  console.log(`  Fee rate: ${estimate.feeRate} sat/vB`);
  console.log(`  Total fee: ${breakdown.totalFeeBtc} BTC (${breakdown.totalFee} sats)`);
  console.log(`  Fee %: ${breakdown.feePercentage.toFixed(2)}%`);
  console.log(`  Time: ~${estimate.estimatedMinutes} min`);
  console.log('');
}
```

Output:
```
Fast (~10 min):
  Fee rate: 20 sat/vB
  Total fee: 0.00004160 BTC (4160 sats)
  Fee %: 5.20%
  Time: ~10 min

Medium (~30 min):
  Fee rate: 10 sat/vB
  Total fee: 0.00002080 BTC (2080 sats)
  Fee %: 2.60%
  Time: ~30 min

Slow (~1 hour):
  Fee rate: 3 sat/vB
  Total fee: 0.00000624 BTC (624 sats)
  Fee %: 0.78%
  Time: ~60 min
```

## Usage

### Basic Coin Selection

```typescript
import { selectCoins, CoinSelectionStrategy } from '@/chains/bitcoin/bitcoinCoinSelection';
import type { IUnifiedUtxo, IOutput } from '@/chains/common/interfaces';

// Available UTXOs (from wallet)
const utxos: IUnifiedUtxo[] = [
  { txHash: 'abc...', index: 0, address: 'bc1q...', value: 50000n, confirmed: true },
  { txHash: 'def...', index: 1, address: 'bc1q...', value: 100000n, confirmed: true },
  { txHash: 'ghi...', index: 0, address: 'bc1q...', value: 25000n, confirmed: true },
];

// Transaction outputs
const outputs: IOutput[] = [
  { address: 'bc1qrecipient...', value: 80000n }
];

// Coin selection
const feeRate = 10; // 10 sat/vB
const changeAddress = 'bc1qchange...';

const result = selectCoins(
  utxos,
  outputs,
  feeRate,
  changeAddress,
  CoinSelectionStrategy.ACCUMULATIVE
);

console.log('Selected UTXOs:', result.selectedUtxos.length);
console.log('Total fee:', result.fee);
console.log('Change amount:', result.changeAmount);
```

## PSBT Transaction Building

### Build Simple Send Transaction

```typescript
import { buildSimpleSendPsbt } from '@/chains/bitcoin/bitcoinPsbtBuilder';

const unsignedTx = buildSimpleSendPsbt(
  utxos,
  'bc1qrecipient...', // Recipient address
  80000n,             // Amount in satoshis
  'bc1qchange...',    // Change address
  10,                 // Fee rate (sat/vB)
  'Mainnet'           // Network
);

console.log('PSBT hex:', unsignedTx.raw.hex);
console.log('PSBT base64:', unsignedTx.raw.base64);
console.log('Total fee:', unsignedTx.fee);
console.log('Inputs:', unsignedTx.inputs.length);
console.log('Outputs:', unsignedTx.outputs.length);
```

### Build Send All Transaction

```typescript
import { buildSendAllPsbt } from '@/chains/bitcoin/bitcoinPsbtBuilder';

const unsignedTx = buildSendAllPsbt(
  utxos,
  'bc1qrecipient...', // Recipient gets all funds minus fee
  10,                 // Fee rate (sat/vB)
  'Mainnet'
);

console.log('Sending all:', unsignedTx.outputs[0].value, 'satoshis');
console.log('Fee:', unsignedTx.fee);
```

### Using Bitcoin Adapter (Complete Flow)

```typescript
import { createBitcoinAdapter } from '@/chains/bitcoin/bitcoinAdapter';

const adapter = createBitcoinAdapter('Mainnet', 'segwit');
adapter.setChangeAddress('bc1qchange...');

// Build transaction using adapter
const unsignedTx = adapter.buildSendTransaction(
  utxos,
  'bc1qrecipient...',
  80000n,
  10
);

// PSBT is ready for signing
const psbt = unsignedTx.raw.psbt;
```

### Advanced PSBT Building

```typescript
import { buildPsbt, type PsbtBuildOptions } from '@/chains/bitcoin/bitcoinPsbtBuilder';
import type { IBuildTxParams } from '@/chains/common/interfaces';

const params: IBuildTxParams = {
  outputs: [
    { address: 'bc1qrecipient1...', value: 50000n },
    { address: 'bc1qrecipient2...', value: 30000n },
  ],
  utxos,
  changeAddress: 'bc1qchange...',
  feeRate: 10,
};

const options: PsbtBuildOptions = {
  feeRate: 10,
  changeAddress: 'bc1qchange...',
  strategy: CoinSelectionStrategy.BRANCH_AND_BOUND,
  rbfEnabled: true,  // Enable Replace-By-Fee
  locktime: 0,
};

const unsignedTx = buildPsbt(params, 'Mainnet', options);
```

## PSBT Structure

### Unsigned Transaction Format

```typescript
interface IUnsignedTx {
  raw: {
    psbt: bitcoin.Psbt;  // bitcoinjs-lib PSBT object
    hex: string;         // Hex encoding (for storage)
    base64: string;      // Base64 encoding (for QR codes, hardware wallets)
  };
  fee: bigint;           // Total transaction fee
  inputs: IUnifiedUtxo[]; // Selected UTXOs
  outputs: IOutput[];    // Transaction outputs (including change)
}
```

### PSBT Hex vs Base64

- **Hex**: Use for storage, internal processing
- **Base64**: Use for QR codes, hardware wallets (Ledger, Trezor, Keystone)

```typescript
const psbtHex = unsignedTx.raw.hex;       // "70736274..."
const psbtBase64 = unsignedTx.raw.base64; // "cHNidP8..."

// Parse from hex or base64
import { parsePsbtFromHex, parsePsbtFromBase64 } from '@/chains/bitcoin/bitcoinPsbtBuilder';

const psbt1 = parsePsbtFromHex(psbtHex, 'Mainnet');
const psbt2 = parsePsbtFromBase64(psbtBase64, 'Mainnet');
```

## PSBT Validation

### Extract Transaction Details

```typescript
import { extractPsbtDetails, validatePsbt } from '@/chains/bitcoin/bitcoinPsbtBuilder';

const details = extractPsbtDetails(psbt);
console.log('Inputs:', details.inputCount);
console.log('Outputs:', details.outputCount);
console.log('Total input:', details.totalInput);
console.log('Total output:', details.totalOutput);
console.log('Fee:', details.fee);

// Validate PSBT structure
try {
  validatePsbt(psbt);
  console.log('✅ PSBT is valid');
} catch (error) {
  console.error('❌ PSBT validation failed:', error.message);
}
```

## Replace-By-Fee (RBF)

Enable RBF to allow fee bumping after broadcast:

```typescript
const options: PsbtBuildOptions = {
  feeRate: 10,
  changeAddress: 'bc1qchange...',
  rbfEnabled: true,  // Sequence = 0xfffffffd
};

const unsignedTx = buildPsbt(params, 'Mainnet', options);

// Later, to bump the fee:
// 1. Build new PSBT with higher fee rate
// 2. Include same inputs (with higher sequence if needed)
// 3. Reduce change output or increase fee
// 4. Broadcast new transaction (replaces old one)
```

## Transaction Finalization

After signing, finalize the PSBT to extract the broadcast-ready transaction:

```typescript
import { finalizePsbt } from '@/chains/bitcoin/bitcoinPsbtBuilder';

// After signing (covered in Task #23 - software signing, Task #24 - hardware signing)
const signedPsbt = psbt; // Assume psbt is now signed

try {
  const { txHex, txId } = finalizePsbt(signedPsbt);

  console.log('✅ Transaction ready for broadcast');
  console.log('Transaction ID:', txId);
  console.log('Transaction hex:', txHex);

  // Broadcast via BitcoinApi
  // await bitcoinApi.broadcastTransaction(txHex);
} catch (error) {
  console.error('❌ Finalization failed:', error.message);
  // Common errors: missing signatures, invalid signatures
}
```

### Using Bitcoin Adapter (Recommended)

```typescript
import { createBitcoinAdapter } from '@/chains/bitcoin/bitcoinAdapter';

const adapter = createBitcoinAdapter('Mainnet', 'segwit');
adapter.setChangeAddress('bc1qchange...');

// Select coins using adapter
const selection = adapter.selectCoins(utxos, outputs, feeRate);

// Or use custom strategy
const selectionOptimal = adapter.selectCoinsWithStrategy(
  utxos,
  outputs,
  feeRate,
  changeAddress,
  CoinSelectionStrategy.BRANCH_AND_BOUND
);
```

## Selection Strategies

### 1. Accumulative (Default)
Simple and fast. Selects UTXOs in order until target is met.

**Best for**: General use, balanced performance

```typescript
CoinSelectionStrategy.ACCUMULATIVE
```

### 2. Largest First
Selects largest UTXOs first to minimize number of inputs.

**Best for**: Minimizing transaction size and fees

```typescript
CoinSelectionStrategy.LARGEST_FIRST
```

### 3. Smallest First
Selects smallest UTXOs first to consolidate small outputs.

**Best for**: UTXO consolidation, cleaning up wallet

```typescript
CoinSelectionStrategy.SMALLEST_FIRST
```

### 4. Branch and Bound (Optimal)
Bitcoin Core's algorithm. Attempts to find exact match or minimize change.

**Best for**: Privacy (no change output) and fee optimization

```typescript
CoinSelectionStrategy.BRANCH_AND_BOUND
```

## Transaction Size Calculation

### SegWit P2WPKH (Default)

```typescript
import { calculateTxSize, calculateTxFee } from '@/chains/bitcoin/bitcoinCoinSelection';

const inputCount = 2;
const outputCount = 2; // 1 recipient + 1 change
const feeRate = 10; // sat/vB

const vsize = calculateTxSize(inputCount, outputCount);
// Result: ~208 vbytes

const fee = calculateTxFee(inputCount, outputCount, feeRate);
// Result: 2080 satoshis
```

### Size Breakdown (P2WPKH)

- **Base Transaction**: ~10.5 vbytes
- **Per Input**: ~68 vbytes (41 base + 107 witness / 4)
- **Per Output**: ~31 vbytes
- **Example (2-in, 2-out)**: ~208 vbytes

## Dust Handling

### Dust Limit

The minimum economical output value (546 satoshis for P2WPKH).

```typescript
import { isDust } from '@/chains/bitcoin/bitcoinCoinSelection';

const amount = 500n; // satoshis
const feeRate = 3; // sat/vB

if (isDust(amount, feeRate)) {
  // Amount is too small to be economical
  // Either add to fee or increase amount
}
```

### Change Threshold

Change outputs are only created if the remainder is > 1.5x dust limit (819 satoshis).

If change would be dust, it's added to the transaction fee instead.

## Maximum Sendable

Calculate the maximum amount that can be sent (all UTXOs minus fee):

```typescript
import { estimateMaxSendable } from '@/chains/bitcoin/bitcoinCoinSelection';

const maxSendable = estimateMaxSendable(utxos, feeRate, 1);

console.log(`Max sendable: ${maxSendable} satoshis`);
// Use this for "Send All" functionality
```

## Integration with WalletBg

```typescript
// In walletBg.ts or transaction building
import { createBitcoinAdapter } from '@/chains/bitcoin/bitcoinAdapter';

const adapter = createBitcoinAdapter(this.network, this.addressType);
adapter.setChangeAddress(this.baseAddress); // Or derive dedicated change address

// Get UTXOs from wallet store
const utxos = WalletStore.state.utxos as IUnifiedUtxo[];

// Define transaction outputs
const outputs: IOutput[] = [
  { address: recipientAddress, value: amountSatoshis }
];

// Select coins
try {
  const selection = adapter.selectCoins(utxos, outputs, feeRate);

  // Build PSBT with selected UTXOs (Task #21)
  // ...
} catch (error) {
  if (error.message === 'Insufficient funds for transaction') {
    // Show error to user
  }
}
```

## Error Handling

Common errors and how to handle them:

```typescript
try {
  const selection = selectCoins(utxos, outputs, feeRate, changeAddress);
} catch (error) {
  switch (error.message) {
    case 'No UTXOs available for coin selection':
      // Wallet has no UTXOs
      break;
    case 'No confirmed UTXOs available for spending':
      // All UTXOs are unconfirmed
      break;
    case 'Insufficient funds for transaction':
      // Not enough satoshis to cover outputs + fee
      break;
    case 'Invalid fee rate: must be positive':
      // Fee rate is 0 or negative
      break;
  }
}
```

## Performance Considerations

- **Accumulative**: O(n) - fastest
- **Largest/Smallest First**: O(n log n) - sorting overhead
- **Branch and Bound**: O(2^n) with 100ms timeout - falls back to largest-first

For large UTXO sets (>100 UTXOs), prefer accumulative or largest-first for better performance.

## Testing

```typescript
// Test with mock UTXOs
const mockUtxos: IUnifiedUtxo[] = [
  { txHash: 'test1', index: 0, address: 'bc1q...', value: 100000n, confirmed: true },
  { txHash: 'test2', index: 0, address: 'bc1q...', value: 50000n, confirmed: true },
  { txHash: 'test3', index: 0, address: 'bc1q...', value: 25000n, confirmed: true },
];

const mockOutputs: IOutput[] = [
  { address: 'bc1qrecipient...', value: 80000n }
];

const result = selectCoins(mockUtxos, mockOutputs, 5, 'bc1qchange...');

// Verify result
console.assert(result.selectedUtxos.length > 0, 'Should select at least one UTXO');
console.assert(result.fee > 0n, 'Fee should be calculated');
console.assert(
  result.selectedUtxos.reduce((sum, u) => sum + u.value, 0n) ===
  mockOutputs[0].value + result.changeAmount + result.fee,
  'Inputs should equal outputs + change + fee'
);
```
