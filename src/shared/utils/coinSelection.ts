import {
  TransactionUnspentOutput,
  TransactionOutputs,
  Value,
  AssetName,
  Assets,
  BigNum, DataCost, min_ada_for_output,
  MultiAsset,
  ScriptHash,
  TransactionOutput,
} from '@emurgo/cardano-serialization-lib-browser';
/**
 * BerryPool implementation of the __Random-Improve__ coin selection algorithm.
 *
 * = Overview
 *
 * The __Random-Improve__ coin selection algorithm works in __two phases__, by
 * /first/ selecting UTxO entries /at random/ to pay for each of the given
 * outputs, and /then/ attempting to /improve/ upon each of the selections.
 *
 * === Phase 1: Random Selection
 *
 * __In this phase, the algorithm randomly selects a minimal set of UTxO__
 * __entries to pay for each of the given outputs.__
 *
 * During this phase, the algorithm:
 *
 *   *  processes outputs in /descending order of coin value/.
 *
 *   *  maintains a /remaining UTxO set/, initially equal to the given
 *      /UTxO set/ parameter.
 *
 *   *  based on every output nature, generate a /native token UTxO subset/
 *      to narrow down to useful UTxO
 *
 *   *  maintains an /accumulated coin selection/, which is initially /empty/.
 *
 * For each output of value __/v/__, the algorithm /randomly/ selects entries
 * from the /remaining UTxO set/, until the total value of selected entries is
 * greater than or equal to __/v/__. The selected entries are then associated
 * with that output, and removed from the /remaining UTxO set/.
 *
 * This phase ends when every output has been associated with a selection of
 * UTxO entries.
 *
 * However, if the remaining UTxO set is completely exhausted before all
 * outputs can be processed, the algorithm terminates with an error.
 *
 * === Phase 2: Improvement
 *
 * __In this phase, the algorithm attempts to improve upon each of the UTxO__
 * __selections made in the previous phase, by conservatively expanding the__
 * __selection made for each output.__
 *
 * During this phase, the algorithm:
 *
 *   *  processes outputs in /ascending order of coin value/.
 *
 *   *  continues to maintain the /remaining UTxO set/ produced by the previous
 *      phase.
 *
 *   *  maintains an /accumulated coin selection/, initiated from previous phase.
 *
 * For each output of value __/v/__, the algorithm:
 *
 *  1.  __Calculates a /target range/__ for the total value of inputs used to
 *      pay for that output, defined by the triplet:
 *
 *      (/minimum/, /ideal/, /maximum/) = (/v/, /2v/, /3v/)
 *
 *  2.  __Attempts to /improve/ upon the /existing UTxO selection/__ for that
 *      output, by repeatedly selecting additional entries at random from the
 *      /remaining UTxO set/, stopping when the selection can be improved upon
 *      no further.
 *
 *      A selection with value /v1/ is considered to be an /improvement/ over a
 *      selection with value /v0/ if __all__ of the following conditions are
 *      satisfied:
 *
 *       * __Condition 1__: we have moved closer to the /ideal/ value:
 *
 *             abs (/ideal/ − /v1/) < abs (/ideal/ − /v0/)
 *
 *       * __Condition 2__: we have not exceeded the /maximum/ value:
 *
 *             /v1/ ≤ /maximum/
 *
 *       * __Condition 3__: when counting cumulatively across all outputs
 *       considered so far, we have not selected more than the /maximum/ number
 *       of UTxO entries specified by 'limit'.
 *
 *  3.  __Creates a /change value/__ for the output, equal to the total value
 *      of the /final UTxO selection/ for that output minus the value /v/ of
 *      that output.
 *
 *  4.  __Updates the /accumulated coin selection/__:
 *
 *       * Adds the /output/ to 'outputs'.
 *       * Adds the /improved UTxO selection/ to 'inputs'.
 *       * Adds the /change value/ to 'change'.
 *
 * This phase ends when every output has been processed, __or__ when the
 * /remaining UTxO set/ has been exhausted, whichever occurs sooner.
 *
 * = Termination
 *
 * When both phases are complete, the algorithm terminates.
 *
 * The /accumulated coin selection/ and /remaining UTxO set/ are returned to
 * the caller.
 *
 * === Failure Modes
 *
 * The algorithm terminates with an __error__ if:
 *
 *  1.  The /total value/ of the initial UTxO set (the amount of money
 *      /available/) is /less than/ the total value of the output list (the
 *      amount of money /required/).
 *
 *      See: __'InputsExhaustedError'__.
 *
 *  2.  The /number/ of UTxO entries needed to pay for the requested outputs
 *      would /exceed/ the upper limit specified by 'limit'.
 *
 *      See: __'InputLimitExceededError'__.
 *
 * == Motivating Principles
 *
 * There are several motivating principles behind the design of the algorithm.
 *
 * === Principle 1: Dust Management
 *
 * The probability that random selection will choose dust entries from a UTxO
 * set increases with the proportion of dust in the set.
 *
 * Therefore, for a UTxO set with a large amount of dust, there's a high
 * probability that a random subset will include a large amount of dust.
 *
 * === Principle 2: Change Management
 *
 * Ideally, coin selection algorithms should, over time, create a UTxO set that
 * has /useful/ outputs: outputs that will allow us to process future payments
 * with a minimum number of inputs.
 *
 * If for each payment request of value __/v/__ we create a change output of
 * /roughly/ the same value __/v/__, then we will end up with a distribution of
 * change values that matches the typical value distribution of payment
 * requests.
 *
 * === Principle 3: Performance Management
 *
 * Searching the UTxO set for additional entries to improve our change outputs
 * is /only/ useful if the UTxO set contains entries that are sufficiently
 * small enough. But it is precisely when the UTxO set contains many small
 * entries that it is less likely for a randomly-chosen UTxO entry to push the
 * total above the upper bound.
 */

type UTxOSelection = {
  selection: TransactionUnspentOutput[]
  remaining: TransactionUnspentOutput[]
  subset: TransactionUnspentOutput[]
  amount: Value
}

type ImproveRange = {
  ideal: Value
  maximum: Value
}


let protocolParameters = null;

/**
 * CoinSelection Module.
 * @module src/lib/CoinSelection
 */
const CoinSelection = {
  /**
   * Set protocol parameters required by the algorithm
   * @param {string} minUTxO
   * @param {string} minFeeA
   * @param {string} minFeeB
   * @param {number} maxTxSize
   * @param coinsPerUtxoSize
   */
  setProtocolParameters: (minUTxO: string, minFeeA: number, minFeeB: number, maxTxSize: number, coinsPerUtxoSize: string) => {
    protocolParameters = {
      minUTxO: minUTxO,
      minFeeA: minFeeA,
      minFeeB: minFeeB,
      maxTxSize: maxTxSize,
      coinsPerUtxoSize: coinsPerUtxoSize
    };
  },
  /**
   * Random-Improve coin selection algorithm
   */
  randomImprove: (inputs: TransactionUnspentOutput[], outputs: TransactionOutputs, limit: number) => {
    if (!protocolParameters)
      throw new Error('Protocol parameters not set. Use setProtocolParameters().');

    const _minUTxOValue = BigInt(outputs.len()) * BigInt(protocolParameters.minUTxO);

    let utxoSelection: UTxOSelection = {
      selection: [],
      remaining: [...inputs], // Shallow copy
      subset: [],
      amount: Value.new(BigNum.from_str('0')),
    };

    const mergedOutputsAmounts = mergeOutputsAmounts(outputs);

    // Explode amount in an array of unique asset amount for comparison's sake
    let splitOutputsAmounts = splitAmounts(mergedOutputsAmounts);

    // Phase 1: Select enough input
    for (let i = 0; i < splitOutputsAmounts.length; i++) {
      createSubSet(utxoSelection, splitOutputsAmounts[i]); // Narrow down for NatToken UTxO

      utxoSelection = select(
        utxoSelection,
        splitOutputsAmounts[i],
        limit,
        _minUTxOValue
      );
    }

    // Phase 2: Improve
    splitOutputsAmounts = sortAmountList(splitOutputsAmounts);

    for (let i = 0; i < splitOutputsAmounts.length; i++) {
      createSubSet(utxoSelection, splitOutputsAmounts[i]); // Narrow down for NatToken UTxO

      const ideal = Value.new(BigNum.from_str('0')).checked_add(splitOutputsAmounts[i]).checked_add(splitOutputsAmounts[i])
      const range: ImproveRange = {
        ideal,
        maximum: Value.new(BigNum.from_str('0')).checked_add(ideal).checked_add(splitOutputsAmounts[i])
      };

      improve(utxoSelection, splitOutputsAmounts[i], limit - utxoSelection.selection.length, range);
    }

    // Insure change hold enough Ada to cover included native assets and fees
    if (utxoSelection.remaining.length > 0) {
      const change: Value = utxoSelection.amount.checked_sub(mergedOutputsAmounts);

      let minAmount = Value.new(
        min_ada_for_output(
          TransactionOutput.new(
            utxoSelection.remaining[0].output().address(),
            change
          ),
          DataCost.new_coins_per_byte(BigNum.from_str(protocolParameters.coinsPerUtxoSize))
        )
      );

      let maxFee: bigint | Value =
        BigInt(protocolParameters.minFeeA) *
        BigInt(protocolParameters.maxTxSize) +
        BigInt(protocolParameters.minFeeB);

      maxFee = Value.new(BigNum.from_str(maxFee.toString()));

      minAmount = minAmount.checked_add(maxFee);

      if (compare(change, minAmount) < 0) {
        // Not enough, add missing amount and run select one last time
        const minAda = minAmount
          .checked_sub(Value.new(change.coin()))
          .checked_add(Value.new(utxoSelection.amount.coin()));

        createSubSet(utxoSelection, minAda);
        utxoSelection = select(utxoSelection, minAda, limit, _minUTxOValue);
      }
    }

    return {
      input: utxoSelection.selection,
      output: outputs,
      remaining: utxoSelection.remaining,
      amount: utxoSelection.amount,
      change: utxoSelection.amount.checked_sub(mergedOutputsAmounts),
    };
  },
};

/**
 * Use randomSelect & descSelect algorithm to select enough UTxO to fulfill requested outputs
 */
function select(utxoSelection: UTxOSelection, outputAmount: Value, limit: number, minUTxOValue: bigint): UTxOSelection {
  try {
    utxoSelection = randomSelect(
      cloneUTxOSelection(utxoSelection), // Deep copy in case of fallback needed
      outputAmount,
      limit - utxoSelection.selection.length,
      minUTxOValue
    );
  } catch (e) {
    if (e['message'] === 'INPUT_LIMIT_EXCEEDED') {
      // Limit reached : Fallback on DescOrdAlgo
      utxoSelection = descSelect(
        utxoSelection,
        outputAmount,
        limit - utxoSelection.selection.length,
        minUTxOValue
      );
    } else {
      throw e;
    }
  }

  return utxoSelection;
}

/**
 * Randomly select enough UTxO to fulfill requested outputs
 * @param {UTxOSelection} utxoSelection - The set of selected/available inputs.
 * @param {Value} outputAmount - Single compiled output qty requested for payment.
 * @param {int} limit - A limit on the number of inputs that can be selected.
 * @param {int} minUTxOValue - Network protocol 'minUTxOValue' current value.
 * @throws INPUT_LIMIT_EXCEEDED if the number of randomly picked inputs exceed 'limit' parameter.
 * @throws INPUTS_EXHAUSTED if all UTxO doesn't hold enough funds to pay for output.
 * @throws MIN_UTXO_ERROR if lovelace change is under 'minUTxOValue' parameter.
 * @return {UTxOSelection} - Successful random utxo selection.
 */
function randomSelect(utxoSelection: UTxOSelection, outputAmount: Value, limit: number, minUTxOValue: bigint): UTxOSelection {
  const nbFreeUTxO = utxoSelection.subset.length;
  // If quantity is met, return subset into remaining list and exit
  if (
    isQtyFulfilled(outputAmount, utxoSelection, minUTxOValue, nbFreeUTxO)
  ) {
    utxoSelection.remaining = [
      ...utxoSelection.remaining,
      ...utxoSelection.subset,
    ];
    utxoSelection.subset = [];
    return utxoSelection;
  }

  if (limit <= 0) {
    throw new Error('INPUT_LIMIT_EXCEEDED');
  }

  if (nbFreeUTxO <= 0) {
    if (isQtyFulfilled(outputAmount, utxoSelection, BigInt(0), 0)) {
      throw new Error('MIN_UTXO_ERROR');
    }
    throw new Error('INPUTS_EXHAUSTED');
  }

  /** @type {TransactionUnspentOutput} utxo */
  const utxo: TransactionUnspentOutput = utxoSelection.subset
    .splice(Math.floor(Math.random() * nbFreeUTxO), 1)
    .pop();

  utxoSelection.selection.push(utxo);
  utxoSelection.amount = addAmounts(
    utxo.output().amount(),
    utxoSelection.amount
  );

  return randomSelect(utxoSelection, outputAmount, limit - 1, minUTxOValue);
}

/**
 * Select enough UTxO in DESC order to fulfill requested outputs
 * @param {UTxOSelection} utxoSelection - The set of selected/available inputs.
 * @param {Value} outputAmount - Single compiled output qty requested for payment.
 * @param {int} limit - A limit on the number of inputs that can be selected.
 * @param {int} minUTxOValue - Network protocol 'minUTxOValue' current value.
 * @throws INPUT_LIMIT_EXCEEDED if the number of randomly picked inputs exceed 'limit' parameter.
 * @throws INPUTS_EXHAUSTED if all UTxO doesn't hold enough funds to pay for output.
 * @throws MIN_UTXO_ERROR if lovelace change is under 'minUTxOValue' parameter.
 * @return {UTxOSelection} - Successful random utxo selection.
 */
function descSelect(utxoSelection: UTxOSelection, outputAmount: Value, limit: number, minUTxOValue: bigint): UTxOSelection {
  // Sort UTxO subset in DESC order for required Output unit type
  utxoSelection.subset = utxoSelection.subset.sort((a, b) => {
    return Number(searchAmountValue(outputAmount, b.output().amount())) - Number(searchAmountValue(outputAmount, a.output().amount()));
  });

  do {
    if (limit <= 0) {
      throw new Error('INPUT_LIMIT_EXCEEDED');
    }

    if (utxoSelection.subset.length <= 0) {
      if (isQtyFulfilled(outputAmount, utxoSelection, BigInt(0), 0)) {
        throw new Error('MIN_UTXO_ERROR');
      }
      throw new Error('INPUTS_EXHAUSTED');
    }

    /** @type {TransactionUnspentOutput} utxo */
    const utxo: TransactionUnspentOutput = utxoSelection.subset.splice(0, 1).pop();

    utxoSelection.selection.push(utxo);
    utxoSelection.amount = addAmounts(
      utxo.output().amount(),
      utxoSelection.amount
    );

    limit--;
  } while (
    !isQtyFulfilled(
      outputAmount,
      utxoSelection,
      minUTxOValue,
      utxoSelection.subset.length - 1
    )
    );

  // Quantity is met, return subset into remaining list and return selection
  utxoSelection.remaining = [
    ...utxoSelection.remaining,
    ...utxoSelection.subset,
  ];
  utxoSelection.subset = [];

  return utxoSelection;
}

/**
 * Try to improve selection by increasing input amount in [2x,3x] range.
 * @param {UTxOSelection} utxoSelection - The set of selected/available inputs.
 * @param {Value} outputAmount - Single compiled output qty requested for payment.
 * @param {int} limit - A limit on the number of inputs that can be selected.
 * @param {ImproveRange} range - Improvement range target values
 */
function improve(utxoSelection: UTxOSelection, outputAmount: Value, limit: number, range: ImproveRange) {
  const nbFreeUTxO = utxoSelection.subset.length;

  if (
    compare(utxoSelection.amount, range.ideal) >= 0 ||
    nbFreeUTxO <= 0 ||
    limit <= 0
  ) {
    // Return subset in remaining
    utxoSelection.remaining = [
      ...utxoSelection.remaining,
      ...utxoSelection.subset,
    ];
    utxoSelection.subset = [];

    return;
  }

  /** @type {TransactionUnspentOutput} utxo */
  const utxo: TransactionUnspentOutput = utxoSelection.subset
    .splice(Math.floor(Math.random() * nbFreeUTxO), 1)
    .pop();

  const newAmount = Value.new(
    BigNum.from_str('0')
  )
    .checked_add(utxo.output().amount())
    .checked_add(outputAmount);

  if (
    abs(getAmountValue(range.ideal) - getAmountValue(newAmount)) <
    abs(getAmountValue(range.ideal) - getAmountValue(outputAmount)) &&
    compare(newAmount, range.maximum) <= 0
  ) {
    utxoSelection.selection.push(utxo);
    utxoSelection.amount = addAmounts(
      utxo.output().amount(),
      utxoSelection.amount
    );
    limit--;
  } else {
    utxoSelection.remaining.push(utxo);
  }

  return improve(utxoSelection, outputAmount, limit, range);
}

/**
 * Compile all required outputs to a flat amounts list
 * @param {TransactionOutputs} outputs - The set of outputs requested for payment.
 * @return {Value} - The compiled set of amounts requested for payment.
 */
function mergeOutputsAmounts(outputs: TransactionOutputs): Value {
  let compiledAmountList = Value.new(
    BigNum.from_str('0')
  );

  for (let i = 0; i < outputs.len(); i++) {
    compiledAmountList = addAmounts(
      outputs.get(i).amount(),
      compiledAmountList
    );
  }

  return compiledAmountList;
}

/**
 * Add up an Amounts List values to another Amounts List
 * @param {Value} amounts - Set of amounts to be added.
 * @param {Value} compiledAmounts - The compiled set of amounts.
 * @return {Value}
 */
function addAmounts(amounts: Value, compiledAmounts: Value): Value {
  return compiledAmounts.checked_add(amounts);
}

/**
 * Split amounts contained in a single {Value} object in separate {Value} objects
 * @param {Value} amounts - Set of amounts to be split.
 * @throws MIN_UTXO_ERROR if lovelace change is under 'minUTxOValue' parameter.
 * @return {Value[]}
 */
function splitAmounts(amounts: Value): Value[] {
  let splitAmounts = [];

  if (amounts.multiasset()) {
    const mA = amounts.multiasset();

    for (let i = 0; i < mA.keys().len(); i++) {
      const scriptHash = mA.keys().get(i);

      for (let j = 0; j < mA.get(scriptHash).keys().len(); j++) {
        const _assets = Assets.new();
        const assetName = mA.get(scriptHash).keys().get(j);

        _assets.insert(
          AssetName.from_bytes(assetName.to_bytes()),
          BigNum.from_bytes(
            mA.get(scriptHash).get(assetName).to_bytes()
          )
        );

        const _multiasset = MultiAsset.new();
        _multiasset.insert(
          ScriptHash.from_bytes(scriptHash.to_bytes()),
          _assets
        );
        const _value = Value.new(
          BigNum.from_str('0')
        );
        _value.set_multiasset(_multiasset);

        splitAmounts.push(_value);
      }
    }
  }

  // Order assets by qty DESC
  splitAmounts = sortAmountList(splitAmounts, 'DESC');

  // Insure lovelace is last to account for min ada requirement
  splitAmounts.push(
    Value.new(
      BigNum.from_bytes(amounts.coin().to_bytes())
    )
  );

  return splitAmounts;
}

/**
 * Sort a mismatched AmountList ASC/DESC
 * @param {Value[]} amountList - Set of mismatched amounts to be sorted.
 * @param {string} [sortOrder=ASC] - Order
 * @return {Value[]} - The sorted AmountList
 */
function sortAmountList(amountList: Value[], sortOrder: string = 'ASC'): Value[] {
  return amountList.sort((a, b) => {
    const sortInt = sortOrder === 'DESC' ? BigInt(-1) : BigInt(1);
    return Number((getAmountValue(a) - getAmountValue(b)) * sortInt);
  });
}

/**
 * Return BigInt amount value
 * @param {Value} amount
 * @return {bigint}
 */
function getAmountValue(amount: Value): bigint {
  let val = BigInt(0);
  const lovelace = BigInt(amount.coin().to_str());

  if (lovelace > 0) {
    val = lovelace;
  } else if (amount.multiasset() && amount.multiasset().len() > 0) {
    const scriptHash = amount.multiasset().keys().get(0);
    const assetName = amount.multiasset().get(scriptHash).keys().get(0);
    val = BigInt(amount.multiasset().get(scriptHash).get(assetName).to_str());
  }

  return val;
}

/**
 * Search & Return BigInt amount value
 * @param needle
 * @param haystack
 * @return {bigint}
 */
function searchAmountValue(needle: Value, haystack: Value): BigInt {
  let val = BigInt(0);
  const lovelace = BigInt(needle.coin().to_str());

  if (lovelace > 0) {
    val = BigInt(haystack.coin().to_str());
  } else if (
    needle.multiasset() &&
    haystack.multiasset() &&
    needle.multiasset().len() > 0 &&
    haystack.multiasset().len() > 0
  ) {
    const scriptHash = needle.multiasset().keys().get(0);
    const assetName = needle.multiasset().get(scriptHash).keys().get(0);
    val = BigInt(haystack.multiasset().get(scriptHash).get(assetName).to_str());
  }

  return val;
}

/**
 * Narrow down remaining UTxO set in case of native token, use full set for lovelace
 * @param {UTxOSelection} utxoSelection - The set of selected/available inputs.
 * @param {Value} output - Single compiled output qty requested for payment.
 */
function createSubSet(utxoSelection: UTxOSelection, output: Value) {
  if (BigInt(output.coin().to_str()) < BigInt(1)) {
    const subset = [];
    const remaining = [];
    for (let i = 0; i < utxoSelection.remaining.length; i++) {
      if (
        compare(utxoSelection.remaining[i].output().amount(), output) !==
        undefined
      ) {
        subset.push(utxoSelection.remaining[i]);
      } else {
        remaining.push(utxoSelection.remaining[i]);
      }
    }
    utxoSelection.subset = subset;
    utxoSelection.remaining = remaining;
  } else {
    utxoSelection.subset = utxoSelection.remaining.splice(
      0,
      utxoSelection.remaining.length
    );
  }
}

/**
 * Is Quantity Fulfilled Condition - Handle 'minUTxOValue' protocol parameter.
 * @param {Value} outputAmount - Single compiled output qty requested for payment.
 * @param {UTxOSelection} utxoSelection - The set of selected/available inputs.
 * @param {number} minUTxOValue - Network protocol 'minUTxOValue' current value.
 * @param {number} nbFreeUTxO - Number of free UTxO available.
 * @return {boolean}
 */
function isQtyFulfilled(
  outputAmount: Value,
  utxoSelection: UTxOSelection,
  minUTxOValue: bigint,
  nbFreeUTxO: number
): boolean {
  let amount = outputAmount;

  if (minUTxOValue && BigInt(outputAmount.coin().to_str()) > 0) {
    const minAmount = Value.new(
      min_ada_for_output(
        TransactionOutput.new(
          utxoSelection.remaining[0].output().address(),
          utxoSelection.amount
        ),
        DataCost.new_coins_per_byte(BigNum.from_str(protocolParameters.coinsPerUtxoSize))
      )
    );

    // Lovelace min amount to cover assets and number of output need to be met
    if (compare(utxoSelection.amount, minAmount) < 0) return false;

    // If requested Lovelace lower than minAmount, plan for change
    if (compare(outputAmount, minAmount) < 0) {
      amount = minAmount.checked_add(
        Value.new(
          BigNum.from_str(protocolParameters.minUTxO)
        )
      );
    }

    // Try covering the max fees
    if (nbFreeUTxO > 0) {
      let maxFee: bigint | Value =
        BigInt(protocolParameters.minFeeA) *
        BigInt(protocolParameters.maxTxSize) +
        BigInt(protocolParameters.minFeeB);

      maxFee = Value.new(
        BigNum.from_str(maxFee.toString())
      );

      amount = amount.checked_add(maxFee);
    }
  }

  return compare(utxoSelection.amount, amount) >= 0;
}

/**
 * Return a deep copy of UTxOSelection
 * @param {UTxOSelection} utxoSelection
 * @return {UTxOSelection} Clone - Deep copy
 */
function cloneUTxOSelection(utxoSelection: UTxOSelection): UTxOSelection {
  return {
    selection: cloneUTxOList(utxoSelection.selection),
    remaining: cloneUTxOList(utxoSelection.remaining),
    subset: cloneUTxOList(utxoSelection.subset),
    amount: cloneValue(utxoSelection.amount),
  };
}

/**
 * Return a deep copy of an UTxO List
 */
const cloneUTxOList = (utxoList: TransactionUnspentOutput[]) =>
  utxoList.map((utxo) =>
    TransactionUnspentOutput.from_bytes(utxo.to_bytes())
  );

/**
 * Return a deep copy of a Value object
 */
const cloneValue = (value: Value) => Value.from_bytes(value.to_bytes());

// Helper
function abs(big: bigint) {
  return big < 0 ? big * BigInt(-1) : big;
}

/**
 * Compare a candidate value to the one in a group if present
 * @param {Value} group
 * @param {Value} candidate
 * @return {number} - -1 group lower, 0 equal, 1 group higher, undefined if no match
 */
function compare(group: Value, candidate: Value): number {
  let gQty = BigInt(group.coin().to_str());
  let cQty = BigInt(candidate.coin().to_str());

  if (candidate.multiasset()) {
    const cScriptHash = candidate.multiasset().keys().get(0);
    const cAssetName = candidate.multiasset().get(cScriptHash).keys().get(0);

    if (group.multiasset() && group.multiasset().len()) {
      if (
        group.multiasset().get(cScriptHash) &&
        group.multiasset().get(cScriptHash).get(cAssetName)
      ) {
        gQty = BigInt(
          group.multiasset().get(cScriptHash).get(cAssetName).to_str()
        );
        cQty = BigInt(
          candidate.multiasset().get(cScriptHash).get(cAssetName).to_str()
        );
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  return gQty >= cQty ? (gQty === cQty ? 0 : 1) : -1;
}

export default CoinSelection;
