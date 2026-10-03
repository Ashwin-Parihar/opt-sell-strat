# Historical market data access

The source MySQL database is **read-only for this project**. Agents and scripts must not write market rows or change the schema. Put derived data and backtest results in local `results/` files. Use a `SELECT`-only database account if one is available.

## Connect

`src/db.js` exports `connect()` using `mysql2/promise` and loads `.env`. Set `DATABASE_URL`, or set `DATABASE_HOST`, `DATABASE_PORT` (default 3306), `DATABASE_USERNAME`, `DATABASE_PASSWORD`, and `DATABASE_NAME`. Set `DB_SSL=true` only when the server requires TLS. Do not log or commit `.env` values.

`npm run db:check` checks connectivity. `npm run db:inspect` reads column metadata from `information_schema`. Both are read-only.

## `ohlc_data`

User-provided examples establish these columns:

| Column | Meaning / observed use |
| --- | --- |
| `scrip` | Instrument identifier. Examples: `BANKNIFTY`, `NIFTY-2019-01-31-FUT`, `NIFTY-2026-01-06-PE-26350`. |
| `time_interval` | Candle frequency. Observed: `1min` for options and index samples; `day` for a futures sample. |
| `timestamp` | Candle date and time, e.g. `2025-12-31 10:00:00`. |
| `open`, `high`, `low`, `close` | OHLC prices. |
| `volume` | Traded volume; can be zero in index samples. |
| `iv` | Implied volatility field; can be `NULL` or zero. Validate before using. |
| `oi` | Open interest field; can be `NULL` or zero. Validate before using. |
| `strike` | Option strike; `0` in the futures sample and `NULL` in index samples. |
| `expiry` | Contract expiry; `NULL` in index samples. |

The tab-separated samples also show a leading numeric ID, but its column name has not been confirmed. Inspect the live schema before referencing it. Do not assume types, keys, timezone, full date coverage, or whether every futures contract has only daily candles solely from these examples.

Instrument naming in the examples is `UNDERLYING-YYYY-MM-DD-FUT` for futures and `UNDERLYING-YYYY-MM-DD-CE/PE-STRIKE` for options. Confirm the exact symbols and expiry coverage with read queries before generalizing.

## Read examples

```sql
SELECT scrip, time_interval, timestamp, open, high, low, close, volume, iv, oi, strike, expiry
FROM ohlc_data
WHERE scrip = 'NIFTY-2019-01-31-FUT' AND time_interval = 'day'
ORDER BY timestamp
LIMIT 100;
```

```sql
SELECT scrip, time_interval, timestamp, open, high, low, close, volume, iv, oi, strike, expiry
FROM ohlc_data
WHERE scrip = 'NIFTY-2026-01-06-PE-26350' AND time_interval = '1min'
ORDER BY timestamp
LIMIT 100;
```

For a backtest, aggregate option minute candles to the required daily observation using an explicit rule; do not join a daily future candle directly to an arbitrary option minute. Verify missing candles, duplicate `(scrip, time_interval, timestamp)` records, expiry mapping, and quote quality before interpreting results. A zero `iv` or `oi` should not automatically be treated as a measured value.
