import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../db.js';

const istDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const round = x => Math.round(x * 100) / 100;
const connection = await connect();
try {
  const [futureRows] = await connection.query(`SELECT scrip, timestamp, close FROM ohlc_data WHERE scrip LIKE 'NIFTY-%-FUT' AND time_interval='day' AND timestamp >= '2023-12-25' ORDER BY timestamp`);
  const futures = new Map();
  for (const r of futureRows) {
    const expiry = /^NIFTY-(\d{4}-\d{2}-\d{2})-FUT$/.exec(r.scrip)?.[1];
    if (!expiry) continue;
    const d = istDate(r.timestamp);
    (futures.get(d) ?? futures.set(d, []).get(d)).push({ expiry, close: Number(r.close) });
  }
  const [optionRows] = await connection.query(`
    SELECT scrip, expiry, strike, timestamp, close, volume
    FROM ohlc_data
    WHERE scrip LIKE 'NIFTY-%' AND time_interval='1min'
      AND timestamp >= '2024-01-01' AND timestamp < '2026-01-01'
      AND TIME(timestamp) IN ('15:29:00', '15:30:00')
    ORDER BY timestamp
  `);
  const quotes = new Map();
  const expiries = new Set();
  for (const r of optionRows) {
    const match = /^NIFTY-(\d{4}-\d{2}-\d{2})-(CE|PE)-(\d+)$/.exec(r.scrip);
    if (!match || match[1] !== r.expiry) continue;
    const d = istDate(r.timestamp);
    if (d > r.expiry) continue;
    const price = Number(r.close);
    if (!(price > 0) || !(Number(r.volume) > 0)) continue;
    expiries.add(r.expiry);
    const key = `${r.expiry}|${d}|${match[2]}|${match[3]}`;
    // The 10:00 candle supersedes 09:59 when both are available.
    quotes.set(key, price);
  }
  const allDates = [...futures.keys()].sort();
  const futAt = (date, expiry) => futures.get(date)?.find(f => f.expiry === expiry)?.close;
  const currentFuture = date => futures.get(date)?.filter(f => f.expiry >= date).sort((a,b) => a.expiry.localeCompare(b.expiry))[0];
  const cycles = [], skipped = [];
  const sortedExpiries = [...expiries].sort();
  for (let i = 1; i < sortedExpiries.length; i++) {
    const previous = sortedExpiries[i - 1], expiry = sortedExpiries[i];
    const entryDate = allDates.find(d => d >= previous && d < expiry && currentFuture(d));
    const exitDate = [...allDates].reverse().find(d => d <= expiry && d > entryDate);
    if (!entryDate || !exitDate || Date.parse(expiry) - Date.parse(previous) > 10 * 86400000) continue;
    const future = currentFuture(entryDate);
    const callTarget = future.close * 1.02, putTarget = future.close * 0.95;
    const candidates = type => [...quotes.keys()].filter(k => k.startsWith(`${expiry}|${entryDate}|${type}|`)).map(k => Number(k.split('|')[3]));
    const callStrike = candidates('CE').filter(s => s >= callTarget).sort((a,b) => a-b)[0];
    const putStrike = candidates('PE').filter(s => s <= putTarget).sort((a,b) => b-a)[0];
    const callEntry = quotes.get(`${expiry}|${entryDate}|CE|${callStrike}`);
    const callExit = quotes.get(`${expiry}|${exitDate}|CE|${callStrike}`);
    const putEntry = quotes.get(`${expiry}|${entryDate}|PE|${putStrike}`);
    const putExit = quotes.get(`${expiry}|${exitDate}|PE|${putStrike}`);
    if (![callEntry,callExit,putEntry,putExit].every(Number.isFinite)) {
      skipped.push({ expiry, entryDate, exitDate, reason: 'missing traded entry or exit quote at market close' });
      continue;
    }
    const dates = allDates.filter(d => d >= entryDate && d <= exitDate);
    let futurePnl = 0, held = future;
    for (let j = 1; j < dates.length; j++) {
      const d = dates[j], same = futAt(d, held.expiry);
      if (same !== undefined) {
        futurePnl += same - held.close;
        held = { expiry: held.expiry, close: same };
      } else {
        const replacement = currentFuture(d);
        if (!replacement) break;
        held = replacement;
      }
    }
    const callPnl = callEntry - callExit, putPnl = putExit - putEntry;
    cycles.push({ expiry, entryDate, exitDate, futureExpiry: future.expiry, callStrike, putStrike, futurePnl: round(futurePnl), callPnl: round(callPnl), putPnl: round(putPnl), totalPoints: round(futurePnl + callPnl + putPnl) });
  }
  const sum = key => round(cycles.reduce((a,c) => a + c[key], 0));
  const report = { description: 'Weekly NIFTY 2% OTM short call + 5% OTM long put, current-month long future, one contract each', execution: 'Entry/exit at last traded minute close on weekly roll dates; future at daily close; no costs/slippage', limitations: 'Diagnostic only: no verified lot sizes, costs, margin, daily mark-to-market, or reliable execution at closing prints. Missing option quotes are skipped.', optionRowsInspected: optionRows.length, cycles: cycles.length, skipped: skipped.length, firstEntry: cycles[0]?.entryDate, lastExit: cycles.at(-1)?.exitDate, futurePnlPoints: sum('futurePnl'), callPnlPoints: sum('callPnl'), putPnlPoints: sum('putPnl'), totalPoints: sum('totalPoints'), trades: cycles, skippedCycles: skipped };
  await mkdir('results', { recursive: true });
  const path = `results/weekly-collar-${Date.now()}.json`;
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ path, cycles: report.cycles, skipped: report.skipped, firstEntry: report.firstEntry, lastExit: report.lastExit, futurePnlPoints: report.futurePnlPoints, callPnlPoints: report.callPnlPoints, putPnlPoints: report.putPnlPoints, totalPoints: report.totalPoints }));
} finally { await connection.end(); }
