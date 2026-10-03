import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../db.js';

const iso = v => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));
const round = v => Math.round(v * 100) / 100;
let db = await connect();
async function query(sql, params) {
  try { return await db.query(sql, params); }
  catch (error) {
    if (!['EPIPE','ECONNRESET','PROTOCOL_CONNECTION_LOST'].includes(error.code)) throw error;
    await db.end().catch(() => {});
    db = await connect();
    return db.query(sql, params);
  }
}
try {
  const [frows] = await query("SELECT scrip,timestamp,close FROM ohlc_data WHERE scrip LIKE 'NIFTY-%-FUT' AND time_interval='day' AND timestamp >= '2023-12-25' ORDER BY timestamp");
  const futures = new Map();
  for (const r of frows) {
    const expiry = /^NIFTY-(\d{4}-\d{2}-\d{2})-FUT$/.exec(r.scrip)?.[1];
    if (!expiry) continue;
    const d = iso(r.timestamp);
    (futures.get(d) ?? futures.set(d, []).get(d)).push({ expiry, close: Number(r.close) });
  }
  const dates = [...futures.keys()].sort();
  const active = d => futures.get(d)?.filter(x => x.expiry >= d).sort((a,b) => a.expiry.localeCompare(b.expiry))[0];
  const [erows] = await query("SELECT DISTINCT expiry FROM ohlc_data WHERE scrip LIKE 'NIFTY-%' AND time_interval='1min' AND timestamp >= '2024-01-01' AND timestamp < '2026-01-01' AND expiry IS NOT NULL ORDER BY expiry");
  const expiries = erows.map(x => x.expiry).filter(x => /^20\d\d-\d\d-\d\d$/.test(x));
  const cycles = [], skipped = [];
  const limit = process.env.FIRST_EXPIRIES ? Math.min(expiries.length, Number(process.env.FIRST_EXPIRIES)) : expiries.length;
  for (let i = 1; i < limit; i++) {
    const previous = expiries[i-1], expiry = expiries[i];
    if ((Date.parse(expiry) - Date.parse(previous)) / 86400000 > 10) continue;
    const entryDate = dates.find(d => d > previous && d < expiry && active(d));
    const exitDate = [...dates].reverse().find(d => d <= expiry && d > entryDate);
    if (!entryDate || !exitDate) continue;
    const [rows] = await query(`
      SELECT scrip,timestamp,close,volume FROM ohlc_data
      WHERE scrip LIKE ? AND time_interval='1min' AND volume > 0
        AND ((timestamp >= ? AND timestamp < ?) OR (timestamp >= ? AND timestamp < ?))
      ORDER BY timestamp
    `, [`NIFTY-${expiry}-%`, `${entryDate} 09:15:00`, `${entryDate} 15:31:00`, `${exitDate} 09:15:00`, `${exitDate} 15:31:00`]);
    const entry = new Map(), exit = new Map();
    for (const r of rows) {
      const m = /^NIFTY-\d{4}-\d{2}-\d{2}-(CE|PE)-(\d+)$/.exec(r.scrip);
      if (!m || !(Number(r.close) > 0)) continue;
      const q = { type:m[1], strike:Number(m[2]), price:Number(r.close), timestamp:r.timestamp.toISOString() };
      if (iso(r.timestamp) === entryDate && !entry.has(r.scrip)) entry.set(r.scrip,q);
      if (iso(r.timestamp) === exitDate) exit.set(r.scrip,q);
    }
    const future = active(entryDate);
    const targetCall = future.close * 1.02, targetPut = future.close * 0.95;
    const available = [...entry.entries()].filter(([s]) => exit.has(s));
    const call = available.filter(([,q]) => q.type==='CE' && q.strike >= targetCall).sort((a,b) => a[1].strike-b[1].strike)[0];
    const put = available.filter(([,q]) => q.type==='PE' && q.strike <= targetPut).sort((a,b) => b[1].strike-a[1].strike)[0];
    if (!call || !put) { skipped.push({ expiry, entryDate, exitDate, entryContracts:entry.size, exitContracts:exit.size, reason:'no traded call or put at required distance on both days' }); continue; }
    const period = dates.filter(d => d >= entryDate && d <= exitDate);
    let futurePoints = 0, held = future, rollCount = 0;
    for (const d of period.slice(1)) {
      const mark = futures.get(d)?.find(x => x.expiry === held.expiry);
      if (mark) { futurePoints += mark.close - held.close; held = mark; }
      else { const next = active(d); if (next) { held = next; rollCount++; } }
    }
    const callPoints = call[1].price - exit.get(call[0]).price;
    const putPoints = exit.get(put[0]).price - put[1].price;
    cycles.push({ expiry, entryDate, exitDate, futureExpiryAtEntry:future.expiry, callStrike:call[1].strike, putStrike:put[1].strike, callEntry:call[1], callExit:exit.get(call[0]), putEntry:put[1], putExit:exit.get(put[0]), futurePoints:round(futurePoints), callPoints:round(callPoints), putPoints:round(putPoints), totalPoints:round(futurePoints+callPoints+putPoints), rollCount });
    if (i % 25 === 0) console.log(`Inspected ${i}/${expiries.length} expiries; usable ${cycles.length}`);
  }
  const sum = field => round(cycles.reduce((a,x) => a+x[field],0));
  const report = { method:'First traded option minute on entry day, last traded option minute on exit day. Current-month future daily close. 2% OTM call sold and 5% OTM put bought, nearest available strike beyond target.', caveats:'Gross price points only. Trades at different intraday times; no verified historical lot size, bid/ask, slippage, fees, margin, or daily drawdown. Futures roll-day gap is not captured. Weeks without traded quotes on both days are skipped, so aggregate is not a continuous strategy return.', cycles:cycles.length, skipped:skipped.length, firstEntry:cycles[0]?.entryDate, lastExit:cycles.at(-1)?.exitDate, futurePoints:sum('futurePoints'), callPoints:sum('callPoints'), putPoints:sum('putPoints'), totalPoints:sum('totalPoints'), trades:cycles, skippedCycles:skipped };
  await mkdir('results',{recursive:true});
  const path=`results/weekly-collar-traded-${Date.now()}.json`;
  await writeFile(path,JSON.stringify(report,null,2));
  console.log(JSON.stringify({path,cycles:report.cycles,skipped:report.skipped,firstEntry:report.firstEntry,lastExit:report.lastExit,futurePoints:report.futurePoints,callPoints:report.callPoints,putPoints:report.putPoints,totalPoints:report.totalPoints}));
} finally { await db.end(); }
