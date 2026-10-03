import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../db.js';

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const args = process.argv.slice(2);
const getArg = flag => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
if (args.some(a => !['--from', '--to'].includes(a) && !dayPattern.test(a))) {
  throw new Error('Usage: node src/cli/strike-inventory.js [--from YYYY-MM-DD] [--to YYYY-MM-DD]');
}
const from = getArg('--from') ?? '2024-01-01';
const to = getArg('--to') ?? '2025-12-31';
if (![from, to].every(x => dayPattern.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`))) || from > to) {
  throw new Error('Provide a valid date range: --from YYYY-MM-DD --to YYYY-MM-DD');
}
const nextDay = date => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const csv = value => {
  if (value === null || value === undefined) return '';
  const string = String(value);
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
};
const toCsv = (headers, rows) => [headers.join(','), ...rows.map(row => headers.map(h => csv(row[h])).join(','))].join('\n') + '\n';
const istDay = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));

const db = await connect();
try {
  const [optionRows] = await db.execute(`
    SELECT DATE_FORMAT(timestamp, '%Y-%m-%d') AS trade_date,
           scrip, expiry, strike,
           COUNT(*) AS candle_rows,
           COUNT(DISTINCT timestamp) AS distinct_minutes,
           SUM(volume > 0) AS traded_candles,
           DATE_FORMAT(MIN(timestamp), '%Y-%m-%d %H:%i:%s') AS first_candle,
           DATE_FORMAT(MAX(timestamp), '%Y-%m-%d %H:%i:%s') AS last_candle
    FROM ohlc_data
    WHERE time_interval = '1min' AND timestamp >= ? AND timestamp < ?
      AND scrip LIKE 'NIFTY-%' AND expiry IS NOT NULL AND strike > 0
    GROUP BY DATE(timestamp), scrip, expiry, strike
    ORDER BY trade_date, expiry, scrip
  `, [`${from} 00:00:00`, `${nextDay(to)} 00:00:00`]);

  const [indexRows] = await db.execute(`
    SELECT timestamp, open, high, low, close
    FROM ohlc_data
    WHERE scrip = 'NIFTY50' AND time_interval = 'day'
      AND timestamp >= ? AND timestamp < ?
    ORDER BY timestamp
  `, [`${new Date(Date.parse(`${from}T00:00:00Z`) - 86400000).toISOString().slice(0,10)} 00:00:00`, `${nextDay(to)} 00:00:00`]);

  const indexByDay = new Map();
  for (const row of indexRows) {
    const date = istDay(row.timestamp);
    if (date >= from && date <= to) {
      indexByDay.set(date, { trade_date:date, nifty50_open:Number(row.open), nifty50_high:Number(row.high), nifty50_low:Number(row.low), nifty50_close:Number(row.close), nifty50_source:'day' });
    }
  }
  const [minuteIndexRows] = await db.execute(`
    SELECT timestamp, open, high, low, close
    FROM ohlc_data
    WHERE scrip = 'NIFTY50' AND time_interval = '1min'
      AND timestamp >= ? AND timestamp < ?
    ORDER BY timestamp
  `, [`${from} 00:00:00`, `${nextDay(to)} 00:00:00`]);
  for (const row of minuteIndexRows) {
    const date = istDay(row.timestamp);
    if (indexByDay.get(date)?.nifty50_source === 'day') continue;
    const candle = indexByDay.get(date);
    if (!candle) {
      indexByDay.set(date, { trade_date:date, nifty50_open:Number(row.open), nifty50_high:Number(row.high), nifty50_low:Number(row.low), nifty50_close:Number(row.close), nifty50_source:'1min_aggregated' });
    } else {
      candle.nifty50_high = Math.max(candle.nifty50_high, Number(row.high));
      candle.nifty50_low = Math.min(candle.nifty50_low, Number(row.low));
      candle.nifty50_close = Number(row.close);
    }
  }

  const detail = [];
  const summaryByKey = new Map();
  for (const row of optionRows) {
    const match = /^NIFTY-(\d{4}-\d{2}-\d{2})-(CE|PE)-(\d+)$/.exec(row.scrip);
    if (!match || match[1] !== row.expiry || Number(match[3]) !== Number(row.strike)) continue;
    const strike = Number(row.strike);
    const traded = Number(row.traded_candles);
    const index = indexByDay.get(row.trade_date);
    detail.push({ trade_date:row.trade_date, expiry:row.expiry, option_type:match[2], strike, scrip:row.scrip, candle_rows:Number(row.candle_rows), distinct_minutes:Number(row.distinct_minutes), traded_candles:traded, first_candle:row.first_candle, last_candle:row.last_candle, nifty50_close:index?.nifty50_close ?? null, nifty50_source:index?.nifty50_source ?? null });
    const key = `${row.trade_date}|${row.expiry}`;
    const summary = summaryByKey.get(key) ?? { trade_date:row.trade_date, expiry:row.expiry, nifty50_close:index?.nifty50_close ?? null, nifty50_source:index?.nifty50_source ?? null,
      ce_min:null, ce_max:null, ce_strikes:0, ce_traded_min:null, ce_traded_max:null, ce_traded_strikes:0,
      pe_min:null, pe_max:null, pe_strikes:0, pe_traded_min:null, pe_traded_max:null, pe_traded_strikes:0 };
    summaryByKey.set(key, summary);
    const side = match[2].toLowerCase();
    summary[`${side}_min`] = Math.min(summary[`${side}_min`] ?? strike, strike);
    summary[`${side}_max`] = Math.max(summary[`${side}_max`] ?? strike, strike);
    summary[`${side}_strikes`]++;
    if (traded > 0) {
      summary[`${side}_traded_min`] = Math.min(summary[`${side}_traded_min`] ?? strike, strike);
      summary[`${side}_traded_max`] = Math.max(summary[`${side}_traded_max`] ?? strike, strike);
      summary[`${side}_traded_strikes`]++;
    }
  }

  const summary = [...summaryByKey.values()].sort((a,b) => a.trade_date.localeCompare(b.trade_date) || a.expiry.localeCompare(b.expiry));
  const indexDaily = [...indexByDay.values()].sort((a,b) => a.trade_date.localeCompare(b.trade_date));
  const folder = `results/strike-inventory-${from}-to-${to}-${Date.now()}`;
  await mkdir(folder, { recursive:true });
  await Promise.all([
    writeFile(`${folder}/option-strikes-daily.csv`, toCsv(['trade_date','expiry','option_type','strike','scrip','candle_rows','distinct_minutes','traded_candles','first_candle','last_candle','nifty50_close','nifty50_source'], detail)),
    writeFile(`${folder}/strike-ranges-daily.csv`, toCsv(['trade_date','expiry','nifty50_close','nifty50_source','ce_min','ce_max','ce_strikes','ce_traded_min','ce_traded_max','ce_traded_strikes','pe_min','pe_max','pe_strikes','pe_traded_min','pe_traded_max','pe_traded_strikes'], summary)),
    writeFile(`${folder}/nifty50-daily.csv`, toCsv(['trade_date','nifty50_open','nifty50_high','nifty50_low','nifty50_close','nifty50_source'], indexDaily)),
  ]);
  const report = { from, to, folder, optionStrikeDateRows:detail.length, dateExpiryRows:summary.length, indexDays:indexDaily.length,
    dateExpiryRowsWithoutIndex:summary.filter(x => x.nifty50_close === null).length,
    optionFirstDate:summary[0]?.trade_date ?? null, optionLastDate:summary.at(-1)?.trade_date ?? null,
    indexFirstDate:indexDaily[0]?.trade_date ?? null, indexLastDate:indexDaily.at(-1)?.trade_date ?? null,
    definitions:{ listed:'At least one 1min candle exists for the exact NIFTY option scrip on that date.', traded:'At least one of those candles has volume > 0.', nifty50:'NIFTY50 day candle OHLC, or aggregated 1min OHLC when day candle is unavailable.', timezone:'Asia/Kolkata' } };
  await writeFile(`${folder}/manifest.json`, JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally { await db.end(); }
