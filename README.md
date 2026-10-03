# Futures Collar Strategy Research

Node.js workspace for testing a NIFTY futures collar strategy against historical futures and options data in MySQL. The full research and experiment guide is in [docs/strategy-plan.md](docs/strategy-plan.md).

## Setup

Requires Node.js 20 or newer and access to the historical MySQL database.

1. Run `npm install`.
2. Copy `.env.example` to `.env` and enter the database connection details. Use `DATABASE_URL` **or** the `DATABASE_*` fields. Set `DB_SSL=true` if the server requires TLS. Never commit `.env`.
3. Run `npm run db:check` to confirm connectivity.
4. Run `npm run db:inspect` to list the database tables and columns without reading market rows.

See [docs/market-data.md](docs/market-data.md) for `ohlc_data` columns, instrument naming, candle frequencies, read queries, and the database read-only rule.

## Development order

The first implementation step is to map and validate the available data: dates, expiries, strikes, prices, duplicates, and historical lot sizes. Next comes a futures-only monthly roll backtest, followed by the call, protective put, costs, and parameter experiments in the order specified by the guide. The backtest engine is not implemented yet; data schema and execution assumptions must be confirmed first.

Results will go in `results/` (ignored by Git). Keep experiment parameters, code version, dataset version, execution assumptions, and costs with each run.

## Strike and NIFTY 50 data inventory

Run `npm run strikes:inventory` to export daily option strikes by expiry and NIFTY 50 daily values for the available 2024–2025 period. Use `npm run strikes:inventory -- --from 2024-01-01 --to 2024-01-31` for a narrower range. The command reads only from `ohlc_data` and creates a timestamped directory under `results/` with `option-strikes-daily.csv`, `strike-ranges-daily.csv`, `nifty50-daily.csv`, and `manifest.json`.

An option strike is *listed* when at least one `1min` candle exists for its exact symbol on that date. A *traded* strike has at least one candle with positive volume. NIFTY 50 values come from `NIFTY50` `day` candles, falling back to aggregated `1min` candles when needed; the source is labeled per row. Blank index values mean neither source has a candle for that date.
