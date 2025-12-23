# DUST Delegation Testing Guide

## Quick Setup

### 1. Create Test Wallets

Run this in the browser console after starting the app:

```javascript
// Create Alice and Bob test wallets
await window.midnightDevUtils.createDelegationTestWallets()
```

This will create two mock Midnight wallets:
- **Alice (Requester)** - Purple wallet (the one requesting help)
- **Bob (Funder)** - Indigo wallet (the one providing DUST)

### 2. Get Wallet Addresses

To get the addresses for testing:

```javascript
// Get addresses for both wallets
window.midnightMockData.logDelegationAddresses()
```

This will output:
```
👩 Alice (Requester):
  Address: mn_addr_undeployed1j8abcdef...
  Alice will REQUEST delegation from Bob

👨 Bob (Funder):
  Address: mn_addr_undeployed1k9xyzabc...
  Use this when requesting delegation FROM Bob

📋 Testing Flow:
  1. Login to Alice → Click "Request Delegation"
  2. Enter Bob's address: mn_addr_undeployed1k9xyzabc...
  3. Login to Bob → See notification → Approve
  4. Login to Alice → See approval notification
```

## Testing Flow

### Step 1: Send Delegation Request (Alice)

1. Login to **Alice (Requester)** wallet
2. On the Midnight Dashboard, find the "DUST Fee Delegation" card
3. Click **"Request Delegation"** button
4. Fill out the form:
   - **Funder Wallet Address**: Paste Bob's address (from console output)
   - **Your Display Name** (optional): "Alice"
   - **Message** (optional): "Hi Bob! Can you help me register for DUST?"
   - **Request Expiry**: 24 hours (default)
5. Click **"Send Request"**
6. You should see: ✅ "Delegation request sent successfully!"

### Step 2: Receive and Approve Request (Bob)

1. Logout from Alice
2. Login to **Bob (Funder)** wallet
3. You should see a **notification banner** at the top of the dashboard:
   - Shows: "New DUST Delegation Request"
   - Requester: Alice
   - Estimated Fee: 0.100000 DUST
   - Time: "just now"
4. Click **"Approve"** button (or expand to see more details first)
5. Enter Bob's wallet password (any password works for mock wallets)
6. Click **"Approve & Fund"**
7. You should see:
   - Loading spinner while processing
   - Success message: "DUST delegation approved! TX: mn_tx_..."
   - Mock transaction hash displayed

### Step 3: Check Response (Alice)

1. Logout from Bob
2. Login to **Alice (Requester)** wallet
3. Check console logs for the delegation response
4. In the future, this will show a notification: "Your delegation request was approved!"

## Testing Rejection Flow

To test rejecting a request:

1. Follow **Step 1** (Alice sends request)
2. Login to **Bob (Funder)**
3. Instead of clicking "Approve", click **"Decline"**
4. You should see: "Delegation request declined"
5. Login to Alice and check console logs for rejection response

## Console Debugging

### Check Delegation Store State

```javascript
// View current incoming requests (for funder)
delegationStore.incomingRequests

// View current outgoing requests (for requester)
delegationStore.outgoingRequests

// Check unread count
delegationStore.unreadCount
```

### Check Ably Connection

```javascript
// Check if Ably is connected
// Look for console logs with:
// "✅ Subscribed to delegation channel: MIDNIGHT.undeployed.DELEGATION.mn_addr_..."
```

### Simulate Multiple Requests

```javascript
// Send multiple requests to test notification counter
// Just repeat Step 1 multiple times
// The banner will show "X New DUST Delegation Requests"
```

## What's Working vs. Mock

### ✅ Fully Functional
- Request creation and form validation
- Ably real-time messaging (wallet-to-wallet)
- Notification banner UI
- Approval dialog with password validation
- Rejection flow with messaging
- Database persistence
- Cross-context state synchronization

### ⚠️ Mock/Simulated
- **DUST registration execution** - Returns mock transaction hash
- **Network submission** - No actual Midnight blockchain interaction
- **Transaction confirmation** - Immediately "confirmed"
- **Balance validation** - Doesn't check actual DUST balance
- **Wallet addresses** - Generated from wallet names (not real keys)

## Expected Console Output

### When Alice Sends Request:
```
📤 Sending delegation request to MIDNIGHT.undeployed.DELEGATION.mn_addr_undeployed1k9xyzabc...
✅ Delegation request sent successfully: [UUID]
✅ Delegation request sent successfully!
```

### When Bob Receives Request:
```
📨 Received delegation request: {requestId: "...", requesterAddress: "mn_addr_undeployed1j8abcdef...", ...}
✅ Delegation request processed successfully
```

### When Bob Approves:
```
💰 Approving delegation request: [UUID]
⚠️ DUST delegation execution not yet implemented - returning mock success
📝 Would execute: midnight-node-toolkit generate-txs register-dust-address
   Requester: mn_addr_undeployed1j8abcdef...
   Funder: mn_addr_undeployed1k9xyzabc...
✅ Delegation approved, transaction hash: mn_tx_1733954829456_7k3m2n
✅ Delegation response sent successfully
```

### When Alice Receives Response:
```
📨 Received delegation response: {approved: true, txHash: "mn_tx_1733954829456_7k3m2n", ...}
✅ Delegation response for [UUID] processed: approved
```

## Troubleshooting

### Request Not Appearing

**Problem**: Bob doesn't see the notification after Alice sends request

**Solutions**:
1. Check console for Ably connection logs
2. Verify both wallets have unique addresses (run `logDelegationAddresses()`)
3. Make sure Bob is logged in AFTER Alice sends the request
4. Check browser console for errors

### Addresses Are the Same

**Problem**: Alice and Bob have the same address

**Solution**:
- Recreate wallets with `createDelegationTestWallets()`
- Each wallet name generates a unique address via hash

### Password Validation Fails

**Problem**: "Incorrect password" error when approving

**Solution**:
- Mock wallets accept ANY password (it just validates format)
- Try any non-empty password
- Check console for actual error message

### No Response Received

**Problem**: Alice doesn't receive approval/rejection response

**Solution**:
1. Check that Alice's wallet is subscribed to correct Ably channel
2. Verify delegation service initialized (check console logs)
3. Make sure Alice and Bob have different addresses

## Advanced Testing

### Test Request Expiration

1. Create request with 6-hour expiry
2. Manually update request `expiresAt` in database to past time
3. Refresh - request should show as "expired"

### Test Multiple Concurrent Requests

1. Login to Alice
2. Send request to Bob
3. Send another request to Bob (or different wallet)
4. Login to Bob
5. Should see "X New DUST Delegation Requests" banner

### Test Database Persistence

1. Send request from Alice
2. Close browser tab
3. Reopen and login to Bob
4. Request should still be there (persisted in IndexedDB)

## Manual Database Inspection

Open Browser DevTools → Application → IndexedDB:

```
wallet-{bobId}
  └─ delegation_requests
     └─ Check for requests with:
        - type: "incoming"
        - status: "pending"
        - requesterAddress: Alice's address
```

## Known Limitations

1. **No Real Transaction**: Mock tx hash returned immediately
2. **No Network Delay**: Instant messaging (no real network latency)
3. **No Balance Checks**: Doesn't verify Bob has enough DUST
4. **No NIGHT Validation**: Doesn't check Alice has unshielded NIGHT
5. **Same Machine Only**: Can't test between different computers (no real Ably deployment)

---

**Ready to Test**: Yes! ✅
**Production Ready**: No ⚠️ (needs real Midnight integration)
