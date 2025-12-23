# DUST Fee Delegation Implementation

## Overview

The DUST Fee Delegation system allows Midnight wallet users to request help paying for their DUST registration fees from other wallet owners. This implements wallet-to-wallet communication using Ably Realtime messaging to facilitate fee delegation requests and responses.

## Implementation Status

✅ **Completed:**
- Database schema and migration (v9 → v10)
- Delegation store with cross-context synchronization
- Ably messaging service for wallet-to-wallet communication
- Request creation dialog (RequestDelegationDialog.vue)
- Notification banner with approve/decline actions (DelegationNotificationBanner.vue)
- Approval dialog with password confirmation (ApproveDelegationDialog.vue)
- Rejection flow with Ably response messaging
- Background message handler for EXECUTE_DUST_DELEGATION

⚠️ **Mock/Placeholder:**
- DUST registration execution (returns mock transaction hash)
- Actual `midnight-node-toolkit` CLI integration
- Midnight network transaction submission

## Architecture

### Database Schema

**Table:** `delegation_requests` (added in wallet DB version 10)

**Indexes:**
```javascript
'id, type, status, requesterAddress, funderAddress, createdAt, expiresAt'
```

**Fields:**
- `id` (string) - Unique request ID (UUID)
- `type` (enum) - INCOMING | OUTGOING
- `status` (enum) - PENDING | APPROVED | REJECTED | EXPIRED | COMPLETED
- `requesterAddress` (string) - Midnight address requesting delegation
- `requesterName` (string, optional) - Display name of requester
- `funderAddress` (string) - Midnight address of funder
- `estimatedFee` (string) - Estimated DUST fee (12 decimals)
- `message` (string, optional) - Optional message from requester
- `createdAt` (number) - Unix timestamp of request creation
- `expiresAt` (number) - Unix timestamp when request expires
- `respondedAt` (number, optional) - Unix timestamp of response
- `completedAt` (number, optional) - Unix timestamp when completed
- `txHash` (string, optional) - Transaction hash (if approved)
- `txError` (string, optional) - Error message (if failed)

### Ably Messaging

**Channel Format:**
```
MIDNIGHT.{network}.DELEGATION.{address}
```

Examples:
- `MIDNIGHT.undeployed.DELEGATION.mn_addr_undeployed1...`
- `MIDNIGHT.testnet.DELEGATION.mn_addr_test1...`

**Message Types:**
1. **DELEGATION_REQUEST** - Sent from requester to funder
2. **DELEGATION_RESPONSE** - Sent from funder back to requester

**Message Structure:**
```typescript
interface DelegationRequestMessage {
  type: 'DELEGATION_REQUEST' | 'DELEGATION_RESPONSE';
  requestId: string;
  requesterAddress: string;
  requesterName?: string;
  funderAddress: string;
  estimatedFee: string;
  message?: string;
  timestamp: number;
  expiresAt: number;
  // Response fields
  approved?: boolean;
  txHash?: string;
  error?: string;
}
```

## User Flow

### Requesting Delegation

1. User clicks "Request Delegation" on Midnight Dashboard
2. Opens `RequestDelegationDialog.vue`
3. User enters:
   - Funder wallet address (mn_addr_...)
   - Optional display name
   - Optional message
   - Expiry time (6h, 12h, 24h, 48h, 72h)
4. System validates:
   - Address format (must start with `mn_addr_`)
   - Not requesting from self
   - Current wallet is Midnight
5. Request sent via Ably to funder's channel
6. Stored in local database as OUTGOING request
7. Success notification shown to user

### Receiving Delegation Request

1. Funder's wallet receives message via Ably subscription
2. Message validated and stored in database as INCOMING request
3. `DelegationNotificationBanner` appears on Dashboard
4. Shows:
   - Requester name/address
   - Estimated fee
   - Time ago
   - Approve/Decline buttons

### Approving Request

1. User clicks "Approve" button
2. Opens `ApproveDelegationDialog.vue` with request details
3. User enters wallet password
4. Password validated in background
5. **MOCK:** Simulates DUST registration execution
6. **PRODUCTION:** Would execute `midnight-node-toolkit generate-txs register-dust-address --wallet-seed {requester} --funding-seed {funder}`
7. Transaction hash returned (mock or real)
8. Request status updated to APPROVED
9. Response sent to requester via Ably with tx hash
10. Success notification shown

### Rejecting Request

1. User clicks "Decline" button
2. Request status updated to REJECTED
3. Response sent to requester via Ably with rejection message
4. Success notification shown

### Receiving Response

1. Requester receives DELEGATION_RESPONSE via Ably
2. Request status updated to APPROVED or REJECTED
3. If approved, tx hash stored
4. User notified of response

## Component Structure

### Vue Components

**[RequestDelegationDialog.vue](src/modules/dashboard/dialogs/RequestDelegationDialog.vue)**
- Form for creating delegation requests
- Validates funder address format
- Optional name, message, expiry selection
- Shows estimated fee (0.1 DUST default)
- Warns if wallet lacks unshielded NIGHT

**[ApproveDelegationDialog.vue](src/modules/dashboard/dialogs/ApproveDelegationDialog.vue)**
- Shows request details (requester, fee, message, time)
- Password confirmation field
- Executes delegation via background message
- Shows success with transaction hash
- Handles errors (password incorrect, execution failure)

**[DelegationNotificationBanner.vue](src/modules/dashboard/components/DelegationNotificationBanner.vue)**
- Displays count of pending requests
- Expandable card with first request details
- Approve/Decline buttons
- Liquid-glass Midnight-themed styling
- Auto-dismissible

**[Dashboard.vue](src/modules/dashboard/views/Dashboard.vue)**
- Integrates notification banner (Midnight wallets only)
- "DUST Fee Delegation" action card
- Opens request and approval dialogs
- Handles approve/reject events
- Shows success notifications

### Services

**[delegation.service.ts](src/services/delegation.service.ts)**
- Singleton service for Ably messaging
- `subscribe(network, address)` - Subscribe to delegation channel
- `sendDelegationRequest(...)` - Send request to funder
- `sendDelegationResponse(...)` - Send approval/rejection
- Message validation and handling
- Auto-expiration of old requests

**[walletManager.service.ts](src/services/walletManager.service.ts)**
- Initializes delegation service for Midnight wallets
- Subscribes to delegation channel on wallet login
- Cleans up on wallet logout

### Stores

**[delegationStore.ts](src/stores/delegationStore.ts)**
- Observable Vue store
- `incomingRequests` - Requests received by this wallet
- `outgoingRequests` - Requests sent by this wallet
- `unreadCount` - Count of pending incoming requests
- Cross-context synchronization (background ↔ browser)
- Auto-expiration on initialization

**Helper Functions:**
```typescript
initializeDelegationStore(walletId: number)
addOrUpdateDelegationRequest(request: DelegationRequest)
updateDelegationRequestStatus(requestId, status, additionalData?)
removeDelegationRequest(requestId: string)
clearDelegationStore()
```

### Database Functions

**[wallet-db.ts](src/db/wallet-db.ts)**

```typescript
// CRUD operations
addDelegationRequest(walletId, request)
updateDelegationRequest(walletId, requestId, updates)
getDelegationRequest(walletId, requestId)
getAllDelegationRequests(walletId, type?, status?)
getActiveDelegationRequests(walletId, type?)
deleteDelegationRequest(walletId, requestId)
expireOldDelegationRequests(walletId)
```

### Background Handlers

**[background.ts](src/chrome/background.ts)**

**Message Type:** `MessageTypes.EXECUTE_DUST_DELEGATION`

**Request Data:**
```typescript
{
  requestId: string;
  requesterAddress: string;
  funderAddress: string;
  password: string;
}
```

**Response Data (Success):**
```typescript
{
  success: true;
  txHash: string;
  message: string;
}
```

**Response Data (Error):**
```typescript
{
  success: false;
  error: string;
}
```

**Current Implementation (Mock):**
1. Validates wallet is logged in
2. Verifies password is correct
3. Simulates 1-second async operation
4. Returns mock transaction hash: `mn_tx_{timestamp}_{random}`
5. Logs would-be CLI command to console

**Production Implementation (TODO):**
1. Decrypt funder's seed phrase with password
2. Execute CLI command:
   ```bash
   midnight-node-toolkit generate-txs register-dust-address \
     --wallet-seed {requester_seed} \
     --funding-seed {funder_seed}
   ```
3. Submit generated transaction to Midnight network
4. Wait for confirmation
5. Return actual transaction hash

## Message Types

**[MessageTypes.ts](src/models/MessageTypes.ts)**

Added:
```typescript
EXECUTE_DUST_DELEGATION = 'EXECUTE_DUST_DELEGATION'
```

## UI/UX Design

### Midnight Theme (Liquid Glass)

All delegation components use the consistent Midnight liquid-glass aesthetic:

**Background:**
```css
background: linear-gradient(135deg, rgba(19, 22, 27, 0.95) 0%, rgba(19, 22, 27, 0.85) 100%);
backdrop-filter: blur(20px) saturate(1.5);
border: 1px solid rgba(45, 240, 247, 0.2);
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
```

**Primary Color:** Cyan (#2df0f7) for Midnight branding

**Icons:**
- `mdi-hand-coin-outline` - Fee delegation
- `mdi-send` - Send request
- `mdi-check` - Approve
- `mdi-close` - Decline/Close

### Time Display

Custom time formatting functions (no external dependencies):
- "just now" - < 1 minute
- "X minute(s) ago" - < 1 hour
- "X hour(s) ago" - < 24 hours
- "X day(s) ago" - >= 24 hours

### DUST Formatting

DUST has **12 decimals** (not 6 like ADA):
```typescript
function formatDust(dust: string): string {
  const value = parseInt(dust) / 1e12;
  return value.toFixed(6);
}
```

Example: `100000000000` (base units) → `0.100000` DUST

## Security Considerations

1. **Password Validation:** Password verified in background before any operation
2. **Message Validation:** All Ably messages validated for structure and required fields
3. **Address Validation:** Midnight address format enforced (must start with `mn_addr_`)
4. **Self-Request Prevention:** Cannot request delegation from own address
5. **Expiration:** Requests auto-expire based on user-selected time
6. **Channel Privacy:** Each wallet has its own private delegation channel

## Testing Checklist

### Manual Testing (Current State)

- [ ] Create Midnight wallet
- [ ] Click "Request Delegation" button
- [ ] Fill out request form with valid data
- [ ] Submit request
- [ ] Verify request appears in outgoing requests
- [ ] Verify Ably message sent (check console logs)
- [ ] Switch to another Midnight wallet (funder)
- [ ] Verify notification banner appears
- [ ] Click "Approve" button
- [ ] Enter correct password
- [ ] Verify mock transaction hash returned
- [ ] Verify success notification shown
- [ ] Verify request status updated to APPROVED
- [ ] Switch back to requester wallet
- [ ] Verify response received (check console logs)
- [ ] Test rejection flow similarly
- [ ] Test form validation errors
- [ ] Test password incorrect error
- [ ] Test request expiration

### Integration Testing (TODO - After Real Implementation)

- [ ] Test with real Midnight network
- [ ] Verify actual DUST registration execution
- [ ] Verify transaction submission and confirmation
- [ ] Test with various network conditions
- [ ] Test Ably reconnection scenarios
- [ ] Test database migration from v9 → v10
- [ ] Test cross-context synchronization

## Known Limitations (Current Implementation)

### Mock Limitations

1. **No Real DUST Registration**
   - Currently returns mock transaction hash
   - Does not execute `midnight-node-toolkit` CLI
   - Does not submit to Midnight network

2. **No Seed Phrase Access**
   - Requester's seed not retrieved
   - Funder's seed not decrypted
   - No CLI execution infrastructure

3. **No Network Validation**
   - Doesn't verify Midnight network connectivity
   - Doesn't check actual DUST balance
   - Doesn't validate unshielded NIGHT balance

4. **No Transaction Confirmation**
   - Mock tx hash is immediately "confirmed"
   - No waiting for network confirmation
   - No block explorer link

### Production Requirements

To make this fully functional, the following are needed:

1. **Midnight CLI Integration**
   - Install/bundle `midnight-node-toolkit`
   - Execute CLI commands from background script
   - Capture and parse CLI output

2. **Seed Management**
   - Decrypt requester's mnemonic (if available)
   - Decrypt funder's mnemonic with password
   - Convert mnemonics to seed format for CLI

3. **Network Communication**
   - Submit signed transactions to Midnight network
   - Poll for transaction confirmation
   - Handle network errors and retries

4. **Balance Verification**
   - Check funder's DUST balance before approval
   - Check requester's unshielded NIGHT balance
   - Calculate actual fee from network parameters

5. **Transaction Monitoring**
   - Track transaction status on-chain
   - Update request status when confirmed
   - Handle transaction failures

## File Manifest

### New Files Created

```
src/models/delegation-types.ts                          # TypeScript interfaces
src/stores/delegationStore.ts                           # Observable store
src/services/delegation.service.ts                      # Ably messaging
src/modules/dashboard/components/DelegationNotificationBanner.vue  # Notification UI
src/modules/dashboard/dialogs/RequestDelegationDialog.vue          # Request form
src/modules/dashboard/dialogs/ApproveDelegationDialog.vue          # Approval dialog
```

### Modified Files

```
src/db/schema.ts                                        # Version 10, delegation_requests table
src/db/wallet-db.ts                                     # CRUD functions, migration
src/services/walletManager.service.ts                   # Initialize delegation service
src/modules/dashboard/views/Dashboard.vue               # Integrate components, handlers
src/models/MessageTypes.ts                              # Add EXECUTE_DUST_DELEGATION
src/chrome/background.ts                                # Add message handler
```

## API Documentation

### Delegation Service API

```typescript
class DelegationService {
  // Initialize with Ably client
  initialize(ablyClient: Ably.Realtime): void

  // Subscribe to delegation channel for current wallet
  subscribe(network: string, address: string): Promise<void>

  // Unsubscribe from current channel
  unsubscribe(): Promise<void>

  // Send delegation request to funder
  sendDelegationRequest(
    funderAddress: string,
    requesterAddress: string,
    requesterName: string | undefined,
    estimatedFee: string,
    message: string | undefined,
    expiryHours: number = 24
  ): Promise<string> // Returns requestId

  // Send approval/rejection response to requester
  sendDelegationResponse(
    requestId: string,
    requesterAddress: string,
    funderAddress: string,
    approved: boolean,
    txHash?: string,
    error?: string
  ): Promise<void>

  // Clean up service
  cleanup(): Promise<void>
}
```

### Store API

```typescript
// Initialize store for specific wallet
initializeDelegationStore(walletId: number): Promise<void>

// Add or update request
addOrUpdateDelegationRequest(request: DelegationRequest): Promise<void>

// Update request status
updateDelegationRequestStatus(
  requestId: string,
  status: DelegationRequestStatus,
  additionalData?: Partial<DelegationRequest>
): Promise<void>

// Remove request
removeDelegationRequest(requestId: string): Promise<void>

// Clear all requests
clearDelegationStore(): void
```

### Database API

```typescript
// Add new delegation request
addDelegationRequest(walletId: number, request: DelegationRequest): Promise<void>

// Update existing request
updateDelegationRequest(
  walletId: number,
  requestId: string,
  updates: Partial<DelegationRequest>
): Promise<void>

// Get single request
getDelegationRequest(walletId: number, requestId: string): Promise<DelegationRequest | undefined>

// Get all requests with filters
getAllDelegationRequests(
  walletId: number,
  type?: DelegationRequestType,
  status?: DelegationRequestStatus
): Promise<DelegationRequest[]>

// Get active (non-expired, non-completed) requests
getActiveDelegationRequests(
  walletId: number,
  type?: DelegationRequestType
): Promise<DelegationRequest[]>

// Delete request
deleteDelegationRequest(walletId: number, requestId: string): Promise<void>

// Expire old requests
expireOldDelegationRequests(walletId: number): Promise<void>
```

## Future Enhancements

### Short Term
- [ ] Implement real DUST registration execution
- [ ] Add transaction confirmation polling
- [ ] Show actual DUST balance in approval dialog
- [ ] Verify unshielded NIGHT balance before approval
- [ ] Add block explorer links for completed transactions

### Medium Term
- [ ] Full delegation requests history view (DelegationRequestDialog)
- [ ] Request filtering and search
- [ ] Batch approve/reject
- [ ] Export delegation history
- [ ] Push notifications for new requests

### Long Term
- [ ] Multi-request approval (approve multiple at once)
- [ ] Delegation limits and budgets
- [ ] Trusted funder lists
- [ ] Request templates
- [ ] Analytics and reporting

## Troubleshooting

### Request Not Received

1. Check Ably connection status (console logs)
2. Verify funder wallet is logged in and on correct network
3. Check delegation channel subscription (console logs)
4. Verify funder address is correct

### Approval Fails

1. Check password is correct
2. Verify wallet has DUST balance (when real implementation)
3. Check Midnight network connectivity (when real implementation)
4. Review background console logs for errors

### Store Not Syncing

1. Check browser context is receiving updates (console logs)
2. Verify background store messaging is working
3. Check Chrome storage permissions
4. Try refreshing the extension

## Development Notes

### Console Logging Convention

All delegation-related logs use emoji prefixes:
- 📋 - Initialization/setup
- 📤 - Outgoing messages/requests
- 📨 - Incoming messages/responses
- 💰 - Approval operations
- ❌ - Errors
- ✅ - Success
- ⚠️ - Warnings
- 🧹 - Cleanup

Example:
```typescript
console.log('📤 Sending delegation request to', channelName);
console.log('✅ Delegation request sent successfully:', requestId);
console.error('❌ Failed to approve delegation request:', error);
```

### Dependencies

**No New Dependencies Added:**
- Used `crypto.randomUUID()` instead of `uuid` package
- Implemented custom time formatting instead of `date-fns`
- Leveraged existing Ably client from wallet manager
- Used existing Vue Observable store pattern

## Midnight Blockchain Context

### DUST Token
- **Purpose:** Gas token for transaction fees on Midnight
- **Generation:** 0.5 DUST per day per NIGHT held
- **Decimals:** 12 (1 DUST = 1,000,000,000,000 base units)
- **Registration Fee:** ~0.1-0.12 DUST for DUST address registration

### NIGHT Token
- **Purpose:** Main privacy token on Midnight
- **Forms:** Shielded and Unshielded
- **Requirement:** Unshielded NIGHT required for DUST registration
- **Decimals:** 12

### Fee Delegation
- **CLI Command:** `midnight-node-toolkit generate-txs register-dust-address`
- **Parameters:**
  - `--wallet-seed` - Requester's seed phrase
  - `--funding-seed` - Funder's seed phrase
- **Result:** Transaction that registers requester's DUST address using funder's DUST

## References

- Midnight Developer Documentation: `.claude/MIDNIGHT_DOCS_INDEX.md`
- Wallet Funding Guide: `.claude/1-wallet-funding-guide_md.md`
- Local Indexer Setup: `.claude/2-local-indexer-setup_md.md`
- Lace Midnight Preview: `.claude/Lace Midnight Preview RC 251202/`
- Implementation Guides: `Midnight_Implementation_Guide.html`, `Midnight_Implementation_ADDENDUM.html`

---

**Last Updated:** 2025-12-11

**Implementation Status:** ✅ Core functionality complete (with mock DUST registration)

**Ready for:** User testing with mock transactions, real implementation requires Midnight CLI integration
