# Project instructions for agents

## Database safety

Treat the historical market database as strictly read-only. Never modify database data or schema, including through `INSERT`, `UPDATE`, `DELETE`, `REPLACE`, `TRUNCATE`, `ALTER`, `DROP`, `CREATE`, migrations, or import scripts. Use only read queries for inspection and research. Keep backtest output in local files under `results/`, not in the source database. Prefer a database account with `SELECT` permission only when available.

## Connection and market data

Read [docs/market-data.md](docs/market-data.md) before writing data queries. The connection helper is `src/db.js`; it loads `.env` and accepts `DATABASE_URL` or `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`, and `DATABASE_NAME`. Never print or commit credentials.

The historical candles are in `ohlc_data`. Filter by both `scrip` and `time_interval`, and order by `timestamp`. Options use `1min` candles. Futures in the supplied examples use `day` candles; do not assume minute futures exist. Check actual coverage before a backtest.
