# 🏗️ Wallet State Architecture

## 📋 Business Rules (Clear & Unique)

The wallet state is determined by **2 key factors**:

1. **🔐 Kaiserex Authentication Status** (has valid token)
2. **📋 KYC Verification Status** (document verification state)

### State Decision Matrix

| Kaiserex Token | KYC Status    | Result State | Component        | Description              |
| -------------- | ------------- | ------------ | ---------------- | ------------------------ |
| ❌ No          | Any           | `auth`       | KaiserexAuthPage | Authentication required  |
| ✅ Yes         | `not_started` | `new`        | OrderCardSection | Order Gero Card          |
| ✅ Yes         | `pending`     | `pending`    | PendingSection   | KYC under review         |
| ✅ Yes         | `approved`    | `approved`   | HomeSection      | Full wallet access       |
| ✅ Yes         | `rejected`    | `auth`       | KaiserexAuthPage | Re-authentication needed |
| ✅ Yes         | `expired`     | `auth`       | KaiserexAuthPage | Re-authentication needed |

## 🔧 Implementation

### Core Logic (`walletStatus.ts`)

```typescript
const computedState = computed((): WalletStatusState => {
  const { isKaiserexAuthenticated, kycStatus, isLoading } = walletStatusStore;

  // System loading state
  if (isLoading) return 'loading';

  // Rule 1: Authentication gate
  const hasValidToken = isKaiserexAuthenticated && walletStatusStore.authStatus === 'authenticated';
  if (!hasValidToken) return 'auth';

  // Rule 2-5: KYC-based routing
  switch (kycStatus) {
    case 'not_started':
      return 'new'; // Order card flow
    case 'pending':
      return 'pending'; // Wait for approval
    case 'approved':
      return 'approved'; // Full access
    case 'rejected':
    case 'expired':
      return 'auth'; // Re-authentication
    default:
      return 'new'; // Fallback
  }
});
```

### Component Mapping (`GeroCard.vue`)

```typescript
const WALLET_COMPONENTS = {
  auth: KaiserexAuthPage, // Authentication required
  new: OrderCardSection, // Order Gero Card
  pending: PendingSection, // KYC under review
  approved: HomeSection, // Full wallet access
  loading: null, // Keep current component
} as const;
```

## 🧪 Testing Framework

### Development Test Buttons

Each button simulates a specific business scenario:

- **🔐 Auth**: No token → Authentication required
- **🆕 New**: Has token + KYC not started → Order card
- **⏳ Pending**: Has token + KYC pending → Wait for approval
- **✅ Approved**: Has token + KYC approved → Full access

### Test Implementation

```typescript
const WalletStateTester = {
  testAuthState: () => {
    // Rule 1: No authentication token
    setKaiserexAuthentication(false);
    // Expected: KaiserexAuthPage
  },

  testNewState: () => {
    // Rule 2: Has token but KYC not started
    setKaiserexAuthentication(true);
    setKYCStatus('not_started');
    // Expected: OrderCardSection
  },

  // ... other test methods
};
```

## 🔄 State Flow Diagram

```
┌─────────────┐
│   Loading   │ ← Initial state
└─────────────┘
       │
       ▼
┌─────────────┐
│ Check Token │
└─────────────┘
       │
    ┌──▼──┐
    │Token│
    └─────┘
   No │ │ Yes
      │ └─────────┐
      ▼           ▼
┌─────────┐ ┌─────────────┐
│   Auth  │ │ Check KYC   │
└─────────┘ └─────────────┘
              │
         ┌────┼────┬────┐
         │    │    │    │
         ▼    ▼    ▼    ▼
    ┌─────┐ ┌──────┐ ┌────────┐ ┌─────┐
    │ New │ │Pending│ │Approved│ │Auth │
    └─────┘ └──────┘ └────────┘ └─────┘
```

## 🎯 Key Benefits

1. **🔍 Clear Business Logic**: Each rule is explicitly documented
2. **🏗️ Single Responsibility**: One function determines state
3. **🧪 Testable**: Each scenario has dedicated test function
4. **📊 Debuggable**: Comprehensive logging and state visibility
5. **🔒 Type Safe**: TypeScript ensures state consistency
6. **🚀 Maintainable**: Easy to modify business rules

## 🚨 Important Notes

- **Authentication is the primary gate**: No token = no access to any flow
- **KYC status determines user journey**: Each status maps to specific UI
- **State changes are reactive**: UI updates automatically on state change
- **Fallback strategy**: Unknown states default to safe 'new' state
- **Development helpers**: Test buttons only available in dev mode
