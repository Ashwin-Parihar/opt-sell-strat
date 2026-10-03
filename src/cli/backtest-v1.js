import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../db.js';

const date = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const round = value => Math.round(value * 100) / 100;
const daysBetween = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;
const connection = await connect();
try {
  const [rows] = await connection.query(`
    SELECT scrip, timestamp, open, close, expiry
    FROM ohlc_data
    WHERE scrip LIKE 'NIFTY-%-FUT' AND time_interval = 'day'
    ORDER BY timestamp, scrip
  `);
  const byExpiry = new Map();
  for (const row of rows) {
    if (!/^NIFTY-\d{4}-\d{2}-\d{2}-FUT$/.test(row.scrip)) continue;
    const expiry = row.scrip.slice(6, 16);
    if (row.expiry !== expiry) continue;
    const candle = { date: date(row.timestamp), open: Number(row.open), close: Number(row.close) };
    if (!(candle.open > 0 && candle.close > 0)) continue;
    (byExpiry.get(expiry) ?? byExpiry.set(expiry, []).get(expiry)).push(candle);
  }
  const cycles = [];
  const expiries = [...byExpiry.keys()].sort();
  for (let i = 1; i < expiries.length; i++) {
    const previousExpiry = expiries[i - 1];
    const expiry = expiries[i];
    const candles = byExpiry.get(expiry).sort((a, b) => a.date.localeCompare(b.date));
    const eligible = candles.filter(c => c.date > previousExpiry && c.date <= expiry);
    if (eligible.length < 10) continue;
    const entry = eligible[0];
    const exit = eligible[eligible.length - 2];
    if (entry.date >= exit.date || daysBetween(previousExpiry, entry.date) > 7 || daysBetween(exit.date, expiry) > 6) continue;
    cycles.push({ expiry, entryDate: entry.date, exitDate: exit.date, entryPrice: entry.open, exitPrice: exit.close, pnlPoints: round(exit.close - entry.open), observationDays: eligible.length });
  }
  let peak = 0, equity = 0, maxDrawdown = 0;
  for (const cycle of cycles) {
    equity += cycle.pnlPoints;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    cycle.cumulativePoints = round(equity);
  }
  const report = {
    name: 'NIFTY futures-only diagnostic, one contract, unscaled price points',
    rules: 'Enter first trading day after prior expiry at daily open; exit penultimate available trading day at daily close; no fees or slippage.',
    limitations: 'No historical lot-size or margin series verified. This is not a currency return or the complete collar. Daily candles have no execution quotes.',
    firstEntry: cycles[0]?.entryDate, lastExit: cycles.at(-1)?.exitDate,
    cycles: cycles.length, totalPoints: round(equity), maxCycleCloseDrawdownPoints: round(maxDrawdown),
    winningCycles: cycles.filter(c => c.pnlPoints > 0).length,
    losingCycles: cycles.filter(c => c.pnlPoints < 0).length,
    trades: cycles,
  };
  await mkdir('results', { recursive: true });
  const path = `results/futures-diagnostic-${Date.now()}.json`;
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ path, firstEntry: report.firstEntry, lastExit: report.lastExit, cycles: report.cycles, totalPoints: report.totalPoints, maxCycleCloseDrawdownPoints: report.maxCycleCloseDrawdownPoints, winningCycles: report.winningCycles, losingCycles: report.losingCycles }));
} finally {
  await connection.end();
}
