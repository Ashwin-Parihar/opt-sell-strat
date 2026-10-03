# Futures Collar Strategy — Backtest & Parameter Experiment Plan

## 1. Objective

Build a backtesting and experimentation framework for a NIFTY-based strategy consisting primarily of:

Long NIFTY Future

* Short Call Option
* Long OTM Put Option

The purpose is to test whether repeated option premium collection can improve the long-term economics of holding/rolling a futures position while the long Put provides protection against severe downside moves.

The system must not assume the strategy is profitable. Its job is to measure:

* profitability
* drawdown
* capital requirement
* tail risk
* behaviour in different market regimes
* sensitivity to parameter changes
* robustness across different historical periods

The framework should make it easy to experiment with strike selection, expiry selection, rolling rules and protection levels without rewriting the backtester.

---

# 2. Core Strategy — Version 1

Start with the simplest possible implementation.

Position:

1. Buy 1 NIFTY futures lot.
2. Sell 1 NIFTY Call.
3. Buy 1 NIFTY Put as downside protection.

Default assumption:

* Futures: current-month contract.
* Call: monthly expiry.
* Put: monthly expiry.
* Position opened at the start of each monthly cycle.
* Position held until defined roll date.
* Futures rolled into the next contract.
* Options closed/expired and new options opened according to strategy rules.

Do not add adjustment logic in Version 1.

The purpose of Version 1 is to establish the baseline behaviour.

---

# 3. Strategy Parameters

All important rules must be configurable.

Example configuration:

```yaml
underlying: NIFTY

future:
  lots: 1
  contract: current_month
  entry_day: first_trading_day
  roll_days_before_expiry: 1

short_call:
  enabled: true
  expiry_type: monthly
  strike_method: percent_otm
  strike_value: 2.0
  lots: 1
  exit_rule: expiry

protective_put:
  enabled: true
  expiry_type: monthly
  strike_method: percent_otm
  strike_value: 5.0
  lots: 1
  exit_rule: expiry

costs:
  brokerage: true
  exchange_charges: true
  stt: true
  gst: true
  stamp_duty: true
  slippage: true
```

---

# 4. Strike Selection Methods

The engine should support multiple methods.

## Short Call

Support:

```text
ATM
Fixed points OTM
Percentage OTM
Delta based
Premium based
```

Examples:

```text
ATM

+100 points
+200 points
+300 points
+500 points

1% OTM
2% OTM
3% OTM
4% OTM

0.50 delta
0.40 delta
0.30 delta
0.25 delta
0.20 delta
0.15 delta
```

If historical Greeks are unavailable, calculate delta from an option pricing model only in experiments where that approximation is explicitly allowed.

Do not silently mix historical delta and modelled delta.

---

# 5. Protective Put Selection

Support:

```text
Fixed points OTM
Percentage OTM
Delta based
Premium-budget based
```

Test candidates such as:

```text
2% OTM
3% OTM
4% OTM
5% OTM
7.5% OTM
10% OTM
```

Also support:

```text
0.30 delta
0.20 delta
0.15 delta
0.10 delta
0.05 delta
```

And premium-budget selection:

```text
Spend maximum 10% of Call premium
Spend maximum 20%
Spend maximum 30%
Spend maximum 40%
Spend maximum 50%
```

Example:

Call premium collected = ₹10,000.

At a 30% protection budget:

maximum Put premium = ₹3,000.

Select the closest eligible Put.

---

# 6. Expiry Combinations

The framework must support several structures.

## Structure A — Monthly / Monthly

```text
Long monthly Future
Short monthly Call
Long monthly Put
```

This is the baseline.

## Structure B — Weekly Call / Monthly Put

```text
Long monthly Future
Short weekly Call
Long monthly Put
```

Every weekly expiry:

* close/expire short Call
* sell a new weekly Call
* keep Future
* keep protective Put

This variation should be tested separately because the original strategy discussion considered repeatedly selling shorter-duration options because their premium decays faster closer to expiry.

## Structure C — Weekly Call / Longer-Duration Put

Example:

```text
Long current-month Future
Short weekly Call
Long next-month Put
```

## Structure D — Monthly Call / Longer Put

```text
Long current-month Future
Short monthly Call
Long 2-month Put
```

---

# 7. Futures Rolling Logic

The futures position should be treated continuously across contracts.

Support these roll rules:

```text
On expiry
1 trading day before expiry
2 days before expiry
3 days before expiry
5 days before expiry
```

Record both:

```text
Realised P&L from expiring Future
+
Cost/basis of new Future
```

The reporting system must retain cumulative futures P&L rather than treating the new contract as an unrelated trade.

This is important because the strategy concept discussed was to evaluate accumulated premium against cumulative futures P&L over time rather than looking only at the latest rolled contract.

---

# 8. Required Historical Data

Minimum:

## NIFTY Spot

```text
timestamp/date
open
high
low
close
```

## NIFTY Futures

```text
timestamp/date
expiry
open
high
low
close
volume
open_interest
lot_size
```

## NIFTY Options

For every available strike:

```text
timestamp/date
expiry
strike
option_type
open
high
low
close
volume
open_interest
lot_size
```

Preferably also:

```text
bid
ask
last_traded_price
IV
delta
gamma
theta
vega
```

## Additional market information

```text
India VIX
risk-free rate
NIFTY dividend yield if required
trading calendar
historical lot-size changes
contract expiry-rule changes
```

---

# 9. Data Frequency

Build the engine so it can support:

```text
Daily
5-minute
1-minute
```

Start with daily/EOD data.

Do not initially use 1-minute data unless adjustment or intraday execution rules are being tested.

Daily data is sufficient for the first long-term structural test.

---

# 10. Entry Price Rules

Avoid unrealistic fills.

Support:

```text
next-day open
same-day close
mid-price if bid/ask data exists
actual next available traded price
```

For every experiment, record which execution model was used.

Never assume fills at theoretical prices.

---

# 11. Slippage

Make slippage configurable.

Example:

```text
Futures:
0
0.5 point
1 point
2 points

Options:
0%
0.25%
0.5%
1%
2%
```

Also allow bid/ask based execution where data exists.

Run results both:

```text
before transaction costs
after transaction costs
```

---

# 12. Charges

Include realistic Indian derivatives costs.

Support:

```text
Brokerage
STT
Exchange transaction charges
SEBI charges
GST
Stamp duty
```

Charges should be calculated per transaction rather than approximated as one annual percentage.

---

# 13. Capital and Margin

Track:

```text
Starting capital
Required futures margin
Short-option margin
Hedge margin benefit
Peak margin requirement
Available cash
Mark-to-market variation
```

Do not calculate return using only option premium received.

Primary capital-return metric should be based on actual capital required to sustain the strategy.

Calculate:

```text
Return on starting capital

Return on average capital employed

Return on peak capital requirement
```

---

# 14. Daily Mark-to-Market

Every trading day calculate:

```text
Future MTM
Short Call MTM
Long Put MTM
Total strategy MTM
Realised P&L
Unrealised P&L
Total equity
Available capital
Required margin
```

Store all of these.

This is necessary for calculating real drawdowns.

---

# 15. P&L Attribution

Every period must separately report:

```text
Futures P&L
Short Call P&L
Protective Put P&L
Transaction costs
Net strategy P&L
```

Also track cumulative values:

```text
Cumulative futures P&L
Cumulative Call premium received
Cumulative short Call P&L
Cumulative Put premium paid
Cumulative Put P&L
Cumulative charges
Cumulative net P&L
```

---

# 16. Premium Coverage Metric

Create a specific metric called:

```text
Premium Coverage Ratio
```

Possible definition:

```text
Net option income /
absolute value of negative futures P&L
```

Also calculate:

```text
Gross Call premium received
- Put premium paid
- costs
= Net premium income
```

Example:

```text
Future P&L            -₹300,000
Call P&L              +₹420,000
Put P&L                -₹70,000
Costs                  -₹20,000
--------------------------------
Net                     +₹30,000
```

This is important because one of the core hypotheses being tested is whether accumulated option premium can offset periods of loss in the futures leg.

---

# 17. Core Performance Metrics

For every backtest calculate:

```text
Starting capital
Ending capital

Absolute profit
Total return
CAGR

Annualised volatility
Sharpe ratio
Sortino ratio

Maximum drawdown
Drawdown duration
Recovery time

Worst day
Worst week
Worst month
Worst year

Best month
Best year

Profitable months %
Losing months %

Average profitable month
Average losing month

Maximum consecutive profitable months
Maximum consecutive losing months

Profit factor

Average monthly return
Median monthly return

5th percentile monthly return
1st percentile monthly return
```

---

# 18. Strategy-Specific Risk Metrics

Calculate:

```text
Maximum futures MTM loss

Maximum short-Call loss

Maximum protective-Put gain

Maximum one-day strategy loss

Maximum gap loss

Maximum capital required

Maximum margin usage %

Number of margin-stress events

Number of months Call capped upside

Call assignment/settlement-equivalent impact

Percentage of months Put expired worthless

Total amount spent on insurance

Insurance cost as % of Call premium

Insurance cost as % of total returns
```

---

# 19. Market-Regime Analysis

Classify historical periods.

At minimum:

```text
Bull market
Bear market
Sideways market
High volatility
Low volatility
Crash
Post-crash recovery
```

Possible classification rules:

Trend:

```text
Price > 200 DMA → bullish
Price < 200 DMA → bearish
```

Volatility:

```text
VIX percentile < 30 → low volatility
30–70 → normal
>70 → high volatility
```

Do not rely solely on these definitions. Allow alternate regime models.

Report performance separately for every regime.

Example:

| Regime   | Return | Max DD | Call P&L | Put P&L |
| -------- | -----: | -----: | -------: | ------: |
| Bull     |        |        |          |         |
| Bear     |        |        |          |         |
| Sideways |        |        |          |         |
| High VIX |        |        |          |         |
| Crash    |        |        |          |         |

---

# 20. Historical Stress Periods

Explicitly report strategy performance around major market events contained in the dataset.

Do not optimise around these events.

Use them as stress tests.

Examples include:

```text
sharp market crashes
high-volatility periods
long bull runs
sideways markets
rapid crash-recovery periods
```

Include the COVID-period data if available, because extreme-market testing was specifically discussed as part of validating the strategy.

---

# 21. Parameter Experiment Grid

Once baseline is validated, run parameter sweeps.

Example:

## Call Distance

```text
ATM
1% OTM
2% OTM
3% OTM
4% OTM
5% OTM
```

## Put Distance

```text
2%
3%
4%
5%
7.5%
10%
```

This creates:

```text
6 × 6 = 36 combinations
```

Then combine with:

```text
Monthly Call
Weekly Call
```

Now:

```text
72 combinations
```

Then different roll timing:

```text
Expiry
1 day before
3 days before
5 days before
```

Potentially:

```text
288 configurations
```

The framework must support running thousands of configurations automatically.

---

# 22. Parameter Ranking

Do NOT rank strategies using highest total profit alone.

Evaluate each configuration across:

```text
CAGR
Max drawdown
Return / Max Drawdown
Worst year
Worst month
Sharpe
Capital requirement
Tail losses
Stability across periods
```

Create a Pareto analysis.

Example:

Configuration A may have:

```text
CAGR = 19%
Max DD = 42%
```

Configuration B:

```text
CAGR = 16%
Max DD = 18%
```

Do not automatically declare A superior.

Present the trade-off.

---

# 23. Anti-Overfitting Process

This is critical.

Divide historical data into:

```text
Training period
Validation period
Out-of-sample period
```

Example:

```text
2016–2021 → development

2022–2024 → validation

2025–2026 → final out-of-sample
```

Dates should depend on available data.

Rules:

Do not optimise on the final test period.

Once the final test is run, do not repeatedly change parameters based on that result.

If parameters are changed, start a new validation process.

The conversation explicitly raised the risk that a strategy tuned to one particular month could become overfitted.

---

# 24. Walk-Forward Testing

After parameter exploration, implement walk-forward testing.

Example:

```text
Train: previous 3 years

Choose parameters

Test: next 6 months

Move forward 6 months

Repeat
```

Example:

```text
2017–2019 → optimise
2020 H1    → test

2017 H2–2020 H1 → optimise
2020 H2         → test

...
```

Combine all out-of-sample results into one equity curve.

---

# 25. Parameter Stability

Create heatmaps for:

```text
Call distance vs Put distance
```

with values such as:

```text
CAGR
Max drawdown
Sharpe
Return/DD
```

Look for broad regions of acceptable performance.

Avoid configurations where only one exact parameter works.

Example:

Bad:

```text
2.25% Call / 4.75% Put works exceptionally

everything around it fails
```

Better:

```text
Call 1.5–3%
Put 4–7%

all produce reasonably similar results
```

The latter indicates greater robustness.

---

# 26. Weekly Premium Experiment

After completing the monthly baseline, test:

```text
Long Future
+
Long monthly Put
+
Sell weekly Calls
```

Test:

```text
ATM
1% OTM
2% OTM
3% OTM
```

Weekly Call management options:

```text
Hold to expiry

Close at 80% profit

Close at 90% profit

Roll if underlying crosses strike

Roll based on delta

No adjustment
```

Each adjustment system should be evaluated separately.

---

# 27. Adjustment Experiments

Do not include these in baseline.

After baseline is stable, experiment with:

### Short Call adjustment

```text
Roll up
Roll out
Roll up-and-out
Close if delta > threshold
Close if loss > multiple of collected premium
```

### Put adjustment

```text
Never adjust
Roll upward after large rally
Re-buy when Put value falls below threshold
Maintain fixed % protection distance
```

### Futures adjustment

Initially:

```text
Do not adjust futures quantity.
```

Later experiment separately with:

```text
adding futures after large drawdown

reducing futures exposure

trend-based futures exposure
```

Do not mix these experiments into the core test.

---

# 28. Position Scaling

First test:

```text
1 lot only
```

Do not use compounding initially.

Then test scaling separately.

Examples:

```text
Fixed 1 lot

1 lot per ₹X capital

Increase lot only after equity increases by X%

Volatility-adjusted sizing
```

The original discussion also recommended establishing the base strategy before adding lots or extensive refinement.

---

# 29. Monte Carlo Analysis

After historical backtesting is completed, run Monte Carlo simulations.

Start with bootstrap simulation of monthly strategy returns.

Run:

```text
10,000 simulations
```

and optionally:

```text
100,000 simulations
```

Calculate:

```text
Median final capital

5th percentile final capital
1st percentile final capital

Median maximum drawdown
95th percentile maximum drawdown
99th percentile maximum drawdown

Probability of losing money after:
1 year
3 years
5 years

Probability of:
>20% drawdown
>30% drawdown
>40% drawdown
>50% drawdown

Longest simulated losing streak

Longest simulated underwater period
```

Prefer block-bootstrap or regime-aware simulation rather than purely random independent monthly reshuffling if sufficient data exists.

---

# 30. Scenario Tests

Create synthetic stress scenarios.

Examples:

```text
-10% market gap
-15% market gap
-20% market crash

+10% sudden rally
+15% rally

30% market decline over 3 months

50% VIX spike

long sideways market

slow 12-month decline

strong 24-month bull market
```

Evaluate position and margin behaviour under each.

---

# 31. Benchmark Comparisons

Compare against:

```text
NIFTY buy-and-hold

Long NIFTY futures only

Long Future + Short Call

Long Future + Long Put

Full strategy:
Long Future + Short Call + Long Put
```

This decomposition is essential.

It tells us where performance actually comes from.

Example:

```text
Future only               CAGR 15%
Future + Call             CAGR 17%
Future + Put              CAGR 12%
Future + Call + Put       CAGR 16%
```

Also compare drawdowns.

---

# 32. Incremental Component Analysis

Test the strategy step-by-step:

### Test 1

```text
Future only
```

### Test 2

```text
Future + Short Call
```

### Test 3

```text
Future + Protective Put
```

### Test 4

```text
Future + Short Call + Put
```

This prevents us from wrongly attributing performance to one component.

---

# 33. Required Charts

Generate:

```text
Equity curve

Drawdown curve

Monthly returns

Yearly returns

Rolling 12-month return

Rolling drawdown

Futures cumulative P&L

Call cumulative P&L

Put cumulative P&L

Costs cumulative

Net option premium cumulative
```

Also:

```text
Call strike distance vs CAGR heatmap

Call strike distance vs drawdown heatmap

Put strike distance vs CAGR heatmap

Put strike distance vs drawdown heatmap
```

---

# 34. Trade-Level Export

Every transaction should be exportable as CSV/Parquet.

Fields:

```text
strategy_run_id
trade_id

entry_timestamp
exit_timestamp

instrument
future/options
CE/PE

expiry
strike

action
BUY/SELL

quantity
lot_size

entry_price
exit_price

gross_pnl
charges
net_pnl

spot_at_entry
spot_at_exit

future_at_entry

vix_at_entry

days_to_expiry

reason_for_entry
reason_for_exit

parameter_set_id
```

---

# 35. Monthly Strategy Report

Produce one record per month:

```text
month

starting_equity
ending_equity

future_pnl
call_pnl
put_pnl

option_net_pnl
charges

strategy_pnl

return_pct

max_drawdown

premium_received
protection_cost

peak_margin
```

---

# 36. Experiment Tracking

Every backtest must receive a unique configuration ID.

Example:

```text
CALL_2PCT_PUT_5PCT_MONTHLY_V1
```

Store:

```text
code version
dataset version
parameters
start date
end date
execution assumptions
cost assumptions
result metrics
```

Never overwrite old experiment results.

---

# 37. Strategy Change Log

Every rule modification should be recorded.

Example:

```text
Version 1
Monthly Call 2% OTM
Monthly Put 5% OTM

Version 2
Changed Put from 5% → 7%

Reason:
Reduce insurance cost.

Result:
CAGR increased.
Drawdown also increased.
```

The original discussion explicitly recommended recording every strategy/rule change so future changes could be checked against previous conditions rather than repeatedly relearning the same lessons.

---

# 38. Development Sequence

Do the work in this exact order.

## Phase 1 — Data validation

Validate:

```text
missing dates
missing strikes
incorrect expiry mapping
bad prices
duplicate candles
lot-size changes
corporate/index changes if relevant
```

Do not run optimisation until data quality is verified.

## Phase 2 — Futures-only engine

Backtest:

```text
Long Future
monthly rollover
```

Verify P&L manually against sample months.

## Phase 3 — Add short Call

Test:

```text
Future + Short Call
```

## Phase 4 — Add protective Put

Test complete:

```text
Future + Short Call + Put
```

## Phase 5 — Costs and realistic execution

Add:

```text
charges
slippage
margin
```

## Phase 6 — Long historical baseline

Test the fixed base strategy across the full historical dataset.

## Phase 7 — Parameter grid

Experiment with:

```text
Call strikes
Put strikes
expiry structure
roll timing
```

## Phase 8 — Out-of-sample validation

Run:

```text
validation
walk-forward
parameter stability analysis
```

## Phase 9 — Weekly options

Test weekly Call-selling variation.

## Phase 10 — Monte Carlo

Stress-test the final robust candidates.

---

# 39. First Baseline Experiment

Start with this before optimising anything:

```text
Underlying:
NIFTY

Position:
Long 1 current-month Future

Short Call:
1 lot
2% OTM
monthly expiry

Protective Put:
1 lot
5% OTM
monthly expiry

Entry:
First trading day after previous monthly expiry

Exit/Roll:
1 trading day before monthly expiry

Adjustments:
None

Position sizing:
Fixed 1 lot

Slippage:
Realistic

Charges:
Full Indian transaction costs

Capital:
Enough to support actual peak margin + MTM

Backtest period:
Entire available dataset
```

The exact 2%/5% values are starting parameters for experimentation, not claims that they are optimal.

---

# 40. Initial Parameter Sweep

After baseline:

```text
CALL OTM %
0
1
2
3
4
5

PUT OTM %
2
3
4
5
7.5
10
```

Run every combination.

Then produce:

```text
CAGR table
Max DD table
Return/DD table
Worst-year table
Capital-required table
```

Do not pick a final strategy yet.

---

# 41. Second Experiment

Take stable regions from Experiment 1.

Then test:

```text
Weekly Call
vs
Monthly Call
```

while keeping the Put monthly.

---

# 42. Third Experiment

For robust candidates, compare:

```text
Fixed % OTM strikes
vs
Delta-based strikes
```

---

# 43. Fourth Experiment

Test different volatility conditions.

Examples:

```text
Same strikes regardless of VIX

Different Call distance based on VIX

Different Put distance based on VIX
```

Do this only after the fixed strategy has been fully tested.

---

# 44. Final Candidate Requirements

A strategy should only be considered a serious candidate if:

```text
It works over multiple market regimes.

It remains viable after realistic costs.

It survives severe historical drawdowns.

Results remain reasonable out-of-sample.

Nearby parameter values also work.

Performance is not dependent on one exceptional year.

Capital and margin requirements are practical.

Monte Carlo results do not reveal unacceptable tail behaviour.
```

Do not select a configuration simply because it has the highest historical CAGR.

---

# 45. Questions the Final Research Report Must Answer

At the end, answer:

1. Does adding a short Call improve the risk-adjusted outcome versus futures alone?

2. Does the protective Put materially reduce tail risk?

3. How much return does the Put protection cost?

4. What Call strike range gives stable results?

5. What Put strike range gives stable results?

6. Are weekly Calls superior or merely more profitable before transaction costs?

7. What is the worst historical drawdown?

8. What is the maximum capital requirement?

9. What happens during a COVID-like crash?

10. What happens during a prolonged bull market when the short Call repeatedly limits upside?

11. What happens during prolonged sideways markets?

12. How much of total profit comes from:

* futures
* Call selling
* Put protection?

13. How long can the strategy remain underwater?

14. What is the probability of severe drawdown according to Monte Carlo?

15. Which parameter ranges appear robust rather than merely historically optimal?

---

# 46. Important Research Principle

Treat this as an experiment, not as an attempt to prove that the strategy works.

The coding agent should actively look for conditions under which the strategy fails.

The priority is:

```text
Robustness
↓
Risk
↓
Capital requirement
↓
Consistency
↓
Return
```

Do not optimise only for maximum profit.

First understand the base strategy.

Then improve it one variable at a time.
