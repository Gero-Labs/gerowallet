# @moonpay/moonpay-js

The MoonPay Web SDK enables you to integrate the MoonPay widget so you can facilitate crypto purchases within your platform.

## Documentation

For detailed integration instructions and further documentation, please visit our [Documentation Site](https://moonpay.readme.io/docs/ramps-sdk-install-web).

## Installation

To install the package, use npm or yarn:

```bash
npm install --save @moonpay/moonpay-js
```

or

```bash
yarn add @moonpay/moonpay-js
```

## Prerequisites

Before using this package, make sure you have the following:

- An active MoonPay account.
- Your MoonPay API key.

## Usage

1. Import the `loadMoonPay` function.

```typescript
import { loadMoonPay } from '@moonpay/moonpay-js';
```

2. Call the `loadMoonPay` function to get the constructor for the `MoonPayWebSdk`.

```typescript
const moonPay = await loadMoonPay();

const widget = moonPay({
  flow: 'buy',
  environment: 'sandbox',
  params: {
    apiKey: 'pk_test_123',
  },
  variant: 'overlay',
});
```

3. Call the `show` method on your instance

```typescript
widget.show();
```
