import * as btc from "@scure/btc-signer";
import { networkParams, signBitcoinTransaction } from "./derivation.js";

/**
 * BUILDING AND SIGNING A NATIVE SEGWIT (P2WPKH) SPEND.
 *
 * PURE. No network call, no DOM, no storage, no clock. Everything this file needs
 * arrives as an argument: the UTXO set, the fee rate, the destination and the
 * key. That is not tidiness for its own sake, it is what makes the arithmetic
 * testable, and the arithmetic here is the part that loses money when it is
 * wrong. Fetching the UTXOs and broadcasting the result are the caller's job.
 *
 * ---------------------------------------------------------------------------
 * WHY BITCOIN FEES ARE NOT LIKE GAS
 * ---------------------------------------------------------------------------
 * On an EVM chain the fee is deducted from the account balance and the amount you
 * asked to send is the amount that arrives. Bitcoin has no balance: it has a set
 * of previous outputs, and a transaction must spend whole ones. The fee is not a
 * field at all, it is the difference between what the inputs are worth and what
 * the outputs are worth, and whatever is left over goes to the miner.
 *
 * Three consequences, each of which is a real way to lose coins:
 *
 *   1. THE FEE DEPENDS ON HOW MANY INPUTS YOU PICK, and picking more inputs to
 *      cover the fee raises the fee again. So selection and fee estimation have
 *      to be solved together, one input at a time, not in two passes.
 *
 *   2. YOU MUST PAY YOURSELF THE CHANGE, EXPLICITLY. Forget the change output and
 *      the entire remainder of every input you selected is handed to the miner,
 *      silently and irreversibly. This has cost real people entire wallets. The
 *      change output here is never optional and never implicit.
 *
 *   3. A CHANGE OUTPUT BELOW THE DUST LIMIT IS WORSE THAN NO CHANGE OUTPUT. It
 *      costs more in fees to spend than it is worth, so it can never be moved
 *      again, and nodes will not relay a transaction that creates one. Below the
 *      floor the remainder goes to the fee instead. See DUST_LIMIT_SATS.
 */

/**
 * The dust floor, in satoshis.
 *
 * 546 is the standard value for a P2WPKH output under the default relay policy:
 * three times what it costs, at the minimum relay rate, to spend an output of
 * that size. An output below it is not merely uneconomic, it is non standard, so
 * a transaction creating one is rejected by the network rather than mined. That
 * rejection arrives as an opaque error long after signing, which is why the check
 * happens here instead.
 */
export const DUST_LIMIT_SATS = 546;

/**
 * Virtual size of one P2WPKH input, in vbytes.
 *
 * Non witness: 32 byte outpoint hash + 4 byte index + 1 byte empty scriptSig
 * length + 4 byte sequence = 41 bytes, which count fully.
 * Witness: 1 item count + 1 length + 72 signature + 1 length + 33 pubkey = 108
 * bytes, which count as a quarter each = 27.
 * Total 68.
 *
 * The signature is taken as 72 bytes, its maximum. Low s DER signatures are
 * sometimes 71, so this over estimates by at most a quarter of a vbyte per input.
 * That direction is deliberate: over estimating costs a few satoshis, while under
 * estimating produces a transaction below the fee rate it promised, which sits
 * unconfirmed with no error anywhere.
 */
const P2WPKH_INPUT_VBYTES = 68;

/**
 * Fixed transaction overhead in vbytes: 4 version + 4 locktime = 8 non witness,
 * plus the segwit marker and flag (2 bytes, quartered) = 0.5. The input and
 * output count varints are added separately because they grow past 252.
 */
const TX_OVERHEAD_VBYTES = 8.5;

/** Bytes for a CompactSize count. One below 253, three up to 65535. */
function countVbytes(n) {
  if (n < 253) return 1;
  if (n <= 0xffff) return 3;
  return 5;
}

/** Serialised size of one output: 8 byte value + length prefix + script. */
function outputVbytes(scriptLen) {
  return 8 + countVbytes(scriptLen) + scriptLen;
}

/**
 * Estimated virtual size of a P2WPKH spend, in vbytes.
 *
 * Verified against @scure/btc-signer by building and signing real transactions:
 * one input with two P2WPKH outputs measures 141 and this returns 141; two inputs
 * with one output measures 178 and this returns 178; one input with one output
 * measures 110 and this returns 110.
 *
 * @param {number} inputCount            all inputs assumed P2WPKH
 * @param {number[]} outputScriptLengths one entry per output, in bytes
 * @returns {number} vbytes, rounded up, because fee rates are quoted per vbyte
 *                   and a fraction of a vbyte still has to be paid for
 */
export function estimateVsize(inputCount, outputScriptLengths) {
  const outputs = outputScriptLengths.reduce((sum, len) => sum + outputVbytes(len), 0);
  return Math.ceil(
    TX_OVERHEAD_VBYTES +
      countVbytes(inputCount) +
      countVbytes(outputScriptLengths.length) +
      inputCount * P2WPKH_INPUT_VBYTES +
      outputs
  );
}

/** Fee in satoshis for a given shape at a given rate. */
export function estimateFee(inputCount, outputScriptLengths, feeRateSatPerVb) {
  return Math.ceil(estimateVsize(inputCount, outputScriptLengths) * feeRateSatPerVb);
}

/**
 * The output script for an address, and its length.
 *
 * `Address(...).decode` verifies the bech32 or base58 checksum AND the network
 * prefix, so a testnet address handed to a mainnet build throws here rather than
 * producing a transaction that pays nobody.
 */
function scriptFor(address, network) {
  const params = networkParams(network);
  const script = btc.OutScript.encode(btc.Address(params).decode(address));
  return script;
}

/**
 * COIN SELECTION.
 *
 * Largest input first. Two reasons, both practical: it reaches the target in the
 * fewest inputs, and fewer inputs is directly less fee, since each one costs 68
 * vbytes. It is also deterministic, which means a test can assert exactly which
 * outputs were chosen.
 *
 * The fee is recomputed on every iteration rather than estimated once, because
 * adding an input to pay for the fee raises the fee. Estimating once and hoping
 * is how a transaction ends up a few hundred satoshis short of the rate it claims
 * and then sits in nobody's mempool.
 *
 * Two ways to finish, checked in this order:
 *
 *   1. WITH CHANGE, when the remainder after the fee is at or above the dust
 *      floor. The remainder comes back to the sender.
 *   2. WITHOUT CHANGE, when it is below the floor. The whole remainder becomes
 *      fee. That over pays by definition, but by less than 546 satoshis, and the
 *      alternative is an output nobody can ever spend, on a transaction the
 *      network will not relay.
 *
 * @returns {{ok:true, selected:Array, inputTotal:number, fee:number,
 *            change:number, hasChange:boolean}
 *        | {ok:false, reason:string}}
 */
export function selectUtxos({ utxos, amountSats, feeRateSatPerVb, destScriptLen, changeScriptLen }) {
  const sorted = [...utxos].sort((a, b) => b.value - a.value);

  const selected = [];
  let inputTotal = 0;

  for (const utxo of sorted) {
    selected.push(utxo);
    inputTotal += utxo.value;

    const feeWithChange = estimateFee(selected.length, [destScriptLen, changeScriptLen], feeRateSatPerVb);
    const change = inputTotal - amountSats - feeWithChange;

    if (change >= DUST_LIMIT_SATS) {
      return { ok: true, selected, inputTotal, fee: feeWithChange, change, hasChange: true };
    }

    /**
     * The change would be dust, or slightly negative. Try the one output shape.
     *
     * Note the fee here is the ENTIRE remainder, not `feeNoChange`. Without a
     * change output there is nowhere else for it to go: in Bitcoin the fee is
     * whatever the outputs do not claim. `feeNoChange` is only the floor this
     * shape has to clear to be relayed at the requested rate.
     */
    const feeNoChange = estimateFee(selected.length, [destScriptLen], feeRateSatPerVb);
    if (inputTotal - amountSats >= feeNoChange) {
      return {
        ok: true,
        selected,
        inputTotal,
        fee: inputTotal - amountSats,
        change: 0,
        hasChange: false,
      };
    }
    // Still short. Keep adding, knowing the next input raises the fee too.
  }

  // Report the numbers, not just "insufficient funds". The user needs to know
  // whether they are short by a thousand satoshis or by half the amount, and
  // whether the fee is what pushed them over.
  const shortfallFee = estimateFee(Math.max(sorted.length, 1), [destScriptLen, changeScriptLen], feeRateSatPerVb);
  const needed = amountSats + shortfallFee;
  return {
    ok: false,
    reason:
      `These coins cannot cover the payment. Sending ${amountSats} satoshis at ` +
      `${feeRateSatPerVb} satoshis per vbyte needs about ${needed} satoshis including the fee, ` +
      `and this address holds ${inputTotal}.`,
  };
}

/**
 * Build and sign a P2WPKH spend.
 *
 * @param {object} args
 * @param {Array<{txid:string, vout:number, value:number, confirmed?:boolean}>} args.utxos
 *        unspent outputs belonging to `fromAddress`, values in satoshis
 * @param {string} args.fromAddress        the sender, which must be P2WPKH
 * @param {string} args.toAddress          the destination, any standard type
 * @param {number} args.amountSats         what the destination receives
 * @param {number} args.feeRateSatPerVb    satoshis per vbyte
 * @param {Uint8Array} args.privateKey     32 raw bytes, held only for this call
 * @param {"mainnet"|"testnet"} args.network
 * @param {boolean} [args.allowUnconfirmed=false]
 *
 * @returns {{ok:true, hex:string, txid:string, vsize:number, fee:number,
 *            feeRateSatPerVb:number, change:number, inputs:Array, inputTotal:number}
 *        | {ok:false, reason:string}}
 *
 * Returns a typed outcome rather than throwing for anything the user can cause,
 * so the caller cannot swallow a refusal in a catch and show an empty screen.
 * That silent catch is this project's most repeated failure and every reason
 * string below is written to be shown to a person as it is.
 */
export function buildP2wpkhSpend({
  utxos,
  fromAddress,
  toAddress,
  amountSats,
  feeRateSatPerVb,
  privateKey,
  network,
  allowUnconfirmed = false,
}) {
  // ---- Arguments ---------------------------------------------------------
  if (!Array.isArray(utxos)) {
    return { ok: false, reason: "No coins were supplied to spend from." };
  }
  if (!Number.isInteger(amountSats) || amountSats <= 0) {
    return { ok: false, reason: "The amount must be a whole number of satoshis above zero." };
  }
  if (amountSats < DUST_LIMIT_SATS) {
    return {
      ok: false,
      reason:
        `${amountSats} satoshis is below the dust limit of ${DUST_LIMIT_SATS}. ` +
        "The network will not relay a payment that small, because it would cost more to spend than it is worth.",
    };
  }
  if (!Number.isFinite(feeRateSatPerVb) || feeRateSatPerVb <= 0) {
    return { ok: false, reason: "A fee rate above zero is required, in satoshis per vbyte." };
  }

  let destScript;
  let changeScript;
  try {
    destScript = scriptFor(toAddress, network);
  } catch (err) {
    // The checksum and the network prefix are both verified inside decode, so
    // this is the single place a wrong network address is caught. Say which
    // network we were building for; "invalid address" alone sends people hunting
    // for a typo that is not there.
    return { ok: false, reason: `That destination address is not usable on ${network}. ${err.message}` };
  }
  try {
    changeScript = scriptFor(fromAddress, network);
  } catch (err) {
    return { ok: false, reason: `The sending address is not usable on ${network}. ${err.message}` };
  }

  /**
   * The sender must be native segwit.
   *
   * Every input is signed and sized as P2WPKH, and a witness program of version 0
   * with a 20 byte hash is exactly that. A P2PKH or P2SH sender would need a
   * different signing path and a different vbyte cost, so rather than sign
   * something that cannot be spent, refuse and say why.
   */
  if (!(changeScript.length === 22 && changeScript[0] === 0x00 && changeScript[1] === 0x14)) {
    return {
      ok: false,
      reason: "This builder spends native segwit addresses only. The sending address is not one.",
    };
  }

  // ---- Which coins are eligible -----------------------------------------
  const usable = utxos.filter((u) => allowUnconfirmed || u.confirmed !== false);
  if (usable.length === 0) {
    const pending = utxos.reduce((sum, u) => sum + (u.value || 0), 0);
    if (utxos.length > 0 && !allowUnconfirmed) {
      // Never a bare "insufficient funds" when the money is visibly there. A user
      // looking at a balance they cannot spend deserves to be told it is waiting
      // for a confirmation, not left to guess.
      return {
        ok: false,
        reason: `All ${pending} satoshis at this address are still unconfirmed. Wait for a confirmation, or allow unconfirmed coins.`,
      };
    }
    return { ok: false, reason: "This address holds no coins to spend." };
  }

  // ---- Selection ---------------------------------------------------------
  const selection = selectUtxos({
    utxos: usable,
    amountSats,
    feeRateSatPerVb,
    destScriptLen: destScript.length,
    changeScriptLen: changeScript.length,
  });
  if (!selection.ok) return selection;

  // ---- Build -------------------------------------------------------------
  const params = networkParams(network);
  const tx = new btc.Transaction();

  for (const utxo of selection.selected) {
    tx.addInput({
      txid: utxo.txid,
      index: utxo.vout,
      /**
       * `witnessUtxo` is the output being spent: its script and its value. For
       * segwit both are signed over, which is precisely the fix BIP 143 made:
       * the amount is committed to, so a wallet cannot be lied to about what an
       * input is worth and tricked into paying the difference as fee. Supplying
       * it is not optional, and getting the value wrong produces a signature that
       * verifies against nothing.
       */
      witnessUtxo: { script: changeScript, amount: BigInt(utxo.value) },
    });
  }

  tx.addOutputAddress(toAddress, BigInt(amountSats), params);

  if (selection.hasChange) {
    // Explicit, always. See the header: an omitted change output hands the whole
    // remainder to the miner and there is no way back.
    tx.addOutputAddress(fromAddress, BigInt(selection.change), params);
  }

  // ---- Sign --------------------------------------------------------------
  let signed;
  try {
    signed = signBitcoinTransaction(tx, privateKey);
  } catch (err) {
    return { ok: false, reason: err.message };
  }

  /**
   * Last line of defence before this leaves as a broadcastable payload.
   *
   * The fee is derived arithmetic, and if the estimate were ever badly wrong the
   * overpayment would go straight to a miner with no way to recall it. A
   * transaction that pays more in fee than it sends is never what anybody meant,
   * so it stops here rather than on the chain.
   */
  if (signed.fee > amountSats) {
    return {
      ok: false,
      reason:
        `The fee of ${signed.fee} satoshis would be larger than the ${amountSats} satoshis being sent, ` +
        "so the transaction was not completed. Lower the fee rate or send a larger amount.",
    };
  }

  return {
    ok: true,
    hex: signed.hex,
    txid: signed.txid,
    vsize: signed.vsize,
    fee: signed.fee,
    // What the fee actually works out at once the transaction is signed, which is
    // what a block explorer will show. Worth returning so a UI can display the
    // real number rather than the requested one.
    feeRateSatPerVb: Number((signed.fee / signed.vsize).toFixed(2)),
    change: selection.change,
    inputs: selection.selected,
    inputTotal: selection.inputTotal,
  };
}
