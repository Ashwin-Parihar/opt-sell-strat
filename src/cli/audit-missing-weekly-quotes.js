import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../db.js';

const source = process.argv[2];
if (!source) throw new Error('Pass the weekly-collar-traded result path');
const run = JSON.parse(await readFile(source));
let db = await connect();
const query = async (sql, values) => {
  try { return await db.query(sql, values); }
  catch (e) {
    if (!['EPIPE', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST'].includes(e.code)) throw e;
    await db.end().catch(() => {});
    db = await connect();
    return db.query(sql, values);
  }
};
const output = [];
try {
  for (const cycle of run.skippedCycles) {
    const { expiry, entryDate, exitDate } = cycle;
    const [futures] = await query(`
      SELECT scrip,close FROM ohlc_data
      WHERE scrip LIKE 'NIFTY-%-FUT' AND time_interval='day'
        AND timestamp >= ? AND timestamp < ?
    `, [`${entryDate} 00:00:00`, `${entryDate} 23:59:59`]);
    const future = futures.map(x => ({...x, expiry:/^NIFTY-(\d{4}-\d{2}-\d{2})-FUT$/.exec(x.scrip)?.[1]}))
      .filter(x => x.expiry >= entryDate).sort((a,b) => a.expiry.localeCompare(b.expiry))[0];
    if (!future) { output.push({ expiry, entryDate, exitDate, problem:'no eligible monthly future daily candle' }); continue; }
    const [rows] = await query(`
      SELECT scrip,DATE_FORMAT(timestamp,'%Y-%m-%d') tradeDate,COUNT(*) candles,
        SUM(volume > 0) tradedMinutes,MIN(timestamp) firstCandle,MAX(timestamp) lastCandle,
        MIN(CASE WHEN volume > 0 THEN timestamp END) firstTrade,
        MAX(CASE WHEN volume > 0 THEN timestamp END) lastTrade
      FROM ohlc_data
      WHERE scrip LIKE ? AND time_interval='1min'
        AND ((timestamp >= ? AND timestamp < ?) OR (timestamp >= ? AND timestamp < ?))
      GROUP BY scrip,DATE(timestamp)
    `, [`NIFTY-${expiry}-%`, `${entryDate} 09:15:00`, `${entryDate} 15:31:00`, `${exitDate} 09:15:00`, `${exitDate} 15:31:00`]);
    const byScrip = new Map();
    for (const r of rows) (byScrip.get(r.scrip) ?? byScrip.set(r.scrip, new Map()).get(r.scrip)).set(r.tradeDate, r);
    const level = Number(future.close);
    const legs = [];
    for (const [type, target, direction] of [['CE',level*1.02,1],['PE',level*0.95,-1]]) {
      const prefix = `NIFTY-${expiry}-${type}-`;
      const listed = [...byScrip.keys()].filter(s => s.startsWith(prefix)).map(s => ({scrip:s,strike:Number(s.slice(prefix.length))}));
      const entryListed = listed.filter(x => byScrip.get(x.scrip)?.has(entryDate));
      const all = listed
        .filter(x => direction === 1 ? x.strike >= target : x.strike <= target)
        .sort((a,b) => direction === 1 ? a.strike-b.strike : b.strike-a.strike);
      const withEntryTrade = all.find(x => Number(byScrip.get(x.scrip)?.get(entryDate)?.tradedMinutes) > 0);
      const withBothTrades = all.find(x => Number(byScrip.get(x.scrip)?.get(entryDate)?.tradedMinutes) > 0 && Number(byScrip.get(x.scrip)?.get(exitDate)?.tradedMinutes) > 0);
      const selected = withEntryTrade ?? all[0];
      const state = selected ? byScrip.get(selected.scrip) : undefined;
      const summarize = d => { const x=state?.get(d); return { date:d, candles:Number(x?.candles ?? 0), tradedMinutes:Number(x?.tradedMinutes ?? 0), firstTrade:x?.firstTrade ?? null, lastTrade:x?.lastTrade ?? null }; };
      const nearestActual = entryListed.sort((a,b) => Math.abs(a.strike-target)-Math.abs(b.strike-target))[0];
      legs.push({ type, target:Math.round(target*100)/100, selectedScrip:selected?.scrip ?? null, nearestListedScrip:all[0]?.scrip ?? null, nearestAvailableEntryScrip:nearestActual?.scrip ?? null, entryStrikeMin:entryListed.length?Math.min(...entryListed.map(x=>x.strike)):null, entryStrikeMax:entryListed.length?Math.max(...entryListed.map(x=>x.strike)):null, entry:summarize(entryDate), exit:summarize(exitDate), anyEligibleEntryTrade:!!withEntryTrade, anyEligibleBothDaysTrade:!!withBothTrades, issue:!withEntryTrade?'no qualifying strike traded on entry day':!withBothTrades?'entry traded but no qualifying strike traded on exit day':'both days traded' });
    }
    output.push({ expiry, entryDate, exitDate, futureScrip:future.scrip, futureClose:level, timeframe:'1min', window:'09:15:00–15:30:59 Asia/Kolkata', legs });
    console.log(`Audited ${output.length}/${run.skippedCycles.length}: ${expiry}`);
  }
  const path='results/missing-weekly-quotes-audit.json';
  await writeFile(path,JSON.stringify({source,rows:output},null,2));
  console.log(JSON.stringify({path,rows:output.length}));
} finally { await db.end().catch(() => {}); }
