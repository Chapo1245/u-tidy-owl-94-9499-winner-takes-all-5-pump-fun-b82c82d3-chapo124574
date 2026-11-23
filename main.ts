// Lull buyer for the pump.fun replay sprint (agent-fun/replay/v2).
//
// Idea, found by backtesting the dev window (see REPORT.md in this repo's
// build notes, not shipped): chasing pumps loses. An order decided on slot s
// fills at s+2 against the post-trade reserves of s+2, and a hot coin runs
// +40% in a single slot, so momentum buys either slippage-reject or fill at
// the top. The only family that beat hold-cash on the dev window buys the
// QUIET coins: real reserves >= 1 SOL (so a >= 0.01 SOL buy fits under the
// 1%-of-real-reserve cap), no trade for >= 100 slots, and price flat over the
// last 10 trades (<= +15%). Exits: sell half at +100%, the rest at +400%,
// stop out at -35%, or time out after 28,800 slots. Small size (0.1 SOL),
// at most 5 open positions, at least 20 distinct mints for the guardrail.
//
// Backtest evidence (own Python mirror of the engine, dev window, 24h):
//   hold-cash            0.000 SOL | house pilot sniper  -0.465 SOL (grade-local)
//   momentum families   -1.2..-9.5 SOL | reversion       -0.14..-3.8 SOL
//   this lull rule      +0.129 SOL, 73 coins, max drawdown 0.02
//   (6h slices: -0.14..+0.01 — not robust; see REPORT.md: submit only if
//   grade-local --stress confirms a positive median.)
//
// All comparisons are exact BigInt rational arithmetic on the recorded
// reserves, so the two grading executions agree byte for byte: no clock,
// no environment, no randomness (the seed is never used).
import { runBot, LAMPORTS_PER_SOL } from './vendor/makefun-bot.ts';
import type { Batch, BotState } from './vendor/makefun-bot.ts';

// ---- tunables (from the dev-window backtest grid) ----
const TARGET_BUY = LAMPORTS_PER_SOL / 10n; // 0.1 SOL per entry
const MIN_BUY = 10_000_000n; // 0.01 SOL, the guardrail's round-trip floor
const MIN_REAL_RESERVES = LAMPORTS_PER_SOL; // 1 SOL: cap then allows >= MIN_BUY
const COOL_SLOTS = 100; // no trade for this long before an entry
const WINDOW_TRADES = 10; // price window for the flatness check
const MAX_RISE_BPS = 1500; // price may rise at most +15% over the window
const MIN_TRADES = 5; // need some history before trusting a mint
const TP1_NUM = 2n; // sell half once price >= 2x breakeven
const TP2_NUM = 5n; // sell all once price >= 5x breakeven
const SL_NUM = 65n; // sell all once price <= 65% of breakeven (-35%)
const SL_DEN = 100n;
const TIMEOUT_SLOTS = 28800;
const SLIPPAGE_BPS = 2000;
const SELL_SLIPPAGE_BPS = 5000;
const MAX_POSITIONS = 5;

/**
 * Tokens of a position that can actually be sold: a sell whose payout
 * exceeds the curve's real SOL reserves is rejected (max_order_size), and
 * after a crash those reserves are near zero, so a full-size sell on a dead
 * coin just spams rejections forever. Size the sell to the payout the curve
 * can pay, with a 5% haircut for fill-time reserve moves, and skip it when
 * the proceeds would not cover ~3x the tx fee.
 */
function sellable(
  vq: bigint,
  vt: bigint,
  rq: bigint,
  tokens: bigint,
  txFee: bigint,
): bigint {
  if (vq <= rq || rq <= 0n || vt <= 0n || tokens <= 0n) return 0n;
  // q = t*vq/(vt+t) <= rq  =>  t <= rq*vt/(vq-rq)
  const maxT = ((rq * vt) / (vq - rq)) * 95n / 100n;
  const amt = tokens < maxT ? tokens : maxT;
  if (amt <= 0n) return 0n;
  const q = (amt * vq) / (vt + amt);
  if (q <= 3n * txFee) return 0n;
  return amt;
}

// ---- per-mint memory ----
interface MintMemory {
  /** Last WINDOW_TRADES+1 trade prices as [vq, vt] pairs, oldest first. */
  prices: Array<[bigint, bigint]>;
  /** Slot of the mint's most recent trade. */
  lastTradeSlot: number;
}

interface PositionMemory {
  entrySlot: number;
  tookHalf: boolean;
}

const memory = new Map<string, MintMemory>();
const positions = new Map<string, PositionMemory>();
const entered = new Set<string>();

function noteTrade(mint: string, slot: number, vq: bigint, vt: bigint): void {
  let m = memory.get(mint);
  if (m === undefined) {
    m = { prices: [], lastTradeSlot: slot };
    memory.set(mint, m);
  }
  m.prices.push([vq, vt]);
  if (m.prices.length > WINDOW_TRADES + 1) m.prices.shift();
  m.lastTradeSlot = slot;
}

/** True when the mint's price rose by at most MAX_RISE_BPS over the window. */
function flatEnough(m: MintMemory): boolean {
  if (m.prices.length <= WINDOW_TRADES) return false;
  const [vq0, vt0] = m.prices[0];
  const [vq1, vt1] = m.prices[m.prices.length - 1];
  if (vq0 <= 0n || vt0 <= 0n || vq1 <= 0n || vt1 <= 0n) return false;
  // vq1/vt1 <= vq0/vt0 * (1 + MAX_RISE_BPS/10000)
  // <=> vq1 * vt0 * 10000 <= vq0 * vt1 * (10000 + MAX_RISE_BPS)
  return vq1 * vt0 * 10000n <= vq0 * vt1 * (10000n + BigInt(MAX_RISE_BPS));
}

await runBot({
  onBatch(state: BotState, batch: Batch) {
    // Learn from this batch's trades first (state already folded them in).
    for (const e of batch.events) {
      if (e.event === 'TradeEvent') {
        noteTrade(e.mint, e.slot, BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves));
      }
    }

    const orders: Array<
      | { side: 'buy'; mint: string; quote_lamports: bigint; max_slippage_bps: number }
      | { side: 'sell'; mint: string; token_amount: bigint; max_slippage_bps: number }
    > = [];

    // ---- exits ----
    for (const [mint, pos] of state.positions) {
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      const vq = curve.virtual_quote_reserves;
      const vt = curve.virtual_token_reserves;
      if (vq <= 0n || vt <= 0n || pos.token_amount <= 0n || pos.cost_lamports <= 0n) continue;
      const mem = positions.get(mint);
      // price vs breakeven, as vq/vt vs cost/tokens:
      //   price >= k * breakeven  <=>  vq * tokens >= vt * cost * k
      const lhs = vq * pos.token_amount;
      const rhs = vt * pos.cost_lamports;
      const age = batch.slot - (mem?.entrySlot ?? batch.slot);
      const txFee = state.txFeeLamports();
      const amtAll = sellable(vq, vt, curve.real_quote_reserves, pos.token_amount, txFee);
      if (amtAll === 0n) continue;
      if (lhs * SL_DEN <= rhs * SL_NUM || age > TIMEOUT_SLOTS) {
        orders.push({ side: 'sell', mint, token_amount: amtAll, max_slippage_bps: SELL_SLIPPAGE_BPS });
      } else if (lhs >= rhs * TP2_NUM) {
        orders.push({ side: 'sell', mint, token_amount: amtAll, max_slippage_bps: SELL_SLIPPAGE_BPS });
      } else if (lhs >= rhs * TP1_NUM && mem !== undefined && !mem.tookHalf) {
        const amtHalf = sellable(vq, vt, curve.real_quote_reserves, pos.token_amount / 2n, txFee);
        if (amtHalf > 0n) {
          orders.push({ side: 'sell', mint, token_amount: amtHalf, max_slippage_bps: SELL_SLIPPAGE_BPS });
          mem.tookHalf = true;
        }
      }
    }

    // ---- entries ----
    if (state.committedPositionCount() < MAX_POSITIONS) {
      for (const [mint, curve] of state.curves) {
        if (state.committedPositionCount() + orders.filter((o) => o.side === 'buy').length >= MAX_POSITIONS) break;
        if (state.positions.has(mint) || entered.has(mint) || curve.complete) continue;
        if (curve.trades < MIN_TRADES) continue;
        if (curve.real_quote_reserves < MIN_REAL_RESERVES) continue;
        const m = memory.get(mint);
        if (m === undefined) continue;
        if (batch.slot - m.lastTradeSlot < COOL_SLOTS) continue;
        if (!flatEnough(m)) continue;
        const cap = curve.real_quote_reserves / 100n;
        const size = TARGET_BUY < cap ? TARGET_BUY : cap;
        if (size < MIN_BUY) continue;
        if (state.freeCashLamports() < size + state.txFeeLamports()) continue;
        orders.push({ side: 'buy', mint, quote_lamports: size, max_slippage_bps: SLIPPAGE_BPS });
        entered.add(mint);
        positions.set(mint, { entrySlot: batch.slot, tookHalf: false });
      }
    }

    return orders;
  },
});
