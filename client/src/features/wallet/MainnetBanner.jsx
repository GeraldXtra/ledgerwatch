/**
 * Deliberately renders nothing.
 *
 * This used to show a persistent red "MAINNET. REAL FUNDS." banner on every
 * wallet and trading screen whenever the selected chain was a mainnet. The owner
 * asked for it to be removed, so it is gone.
 *
 * Kept as a no-op component rather than deleted so the five call sites do not
 * need touching and the banner can be restored by reverting this one file. The
 * network name and its mainnet/testnet styling still appear in NetworkSwitcher,
 * which remains the thing that tells a user which chain they are on.
 */
export default function MainnetBanner() {
  return null;
}
