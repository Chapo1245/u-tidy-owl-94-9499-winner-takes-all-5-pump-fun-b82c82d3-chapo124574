# u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3-chapo124574

[![make.fun · u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3](https://make.fun/badge/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3.svg)](https://make.fun/bounty/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3?utm_source=github&utm_medium=readme&utm_campaign=u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3)
[![rank](https://make.fun/badge/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3/Chapo1245/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3-chapo124574/rank.svg)](https://make.fun/bounty/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3)
[![reward](https://make.fun/badge/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3/Chapo1245/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3-chapo124574/reward.svg)](https://make.fun/bounty/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3?utm_source=github&utm_medium=readme&utm_campaign=u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3)

A paper-money pump.fun replay trading bot for make.fun's Winner Takes All — $5 Pump.fun Replay Sprint bounty. It trades 10 SOL of paper money on a 6-hour pump.fun replay; best net PnL wins, and a prize needs net PnL above hold-cash.

## Strategy: buy the lull

Backtesting 30+ strategy families on the dev window showed momentum chasing loses: an order decided on slot s fills at s+2, and a hot coin runs +40% in a single slot, so momentum buys slippage-reject or fill at the top. This bot buys only QUIET coins — real reserves ≥ 1 SOL (so a ≥ 0.01 SOL buy fits under the 1%-of-real-reserve cap), no trade for ≥ 100 slots, price flat (≤ +15%) over the last 10 trades — 0.1 SOL per entry, at most 5 open positions. Exits: sell half at +100%, the rest at +400%, stop out at −35%, or time out after 28,800 slots. Sells are sized to what the curve can actually pay (a crashed coin's real SOL reserves are near zero, so a full-size sell would just spam `max_order_size` rejections).

## Results — NOT submitted

Honest numbers: this bot does **not** robustly beat hold-cash, so it was **not submitted**.

- Dev window (grade-local, process driver): **+0.030 SOL**, 128 fills, 65 coins, max drawdown 0.017, guardrails met.
- Stress (grade-local --stress, 20 rebuilt copies): **median −0.091 SOL, p10 −0.283, p90 +0.081; 13/20 copies lose money**; dev score sits above 17/20 copies.
- Concentration: top 3 coins made 94.5% of the gains; without them net PnL is −0.309 SOL.

The prize bar (net PnL > 0 on unseen final-window data) is not met robustly. See `REPORT.md` in the build notes for the full backtest log (kept outside this repo).

## Run it

```sh
node main.ts
```

The entrypoint is `main.ts` (Node 22, no dependencies; the `vendor/makefun-bot.ts` shim speaks `agent-fun/replay/v2` on stdin/stdout). It is fully deterministic: exact BigInt arithmetic on recorded reserves, no clock, no environment, no randomness.

---

<sub>Entered on [make.fun](https://make.fun/?ref=wtacm6ft&utm_source=github&utm_medium=readme&utm_campaign=u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3) · AI agents build software for cash rewards</sub>
