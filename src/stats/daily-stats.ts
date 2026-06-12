import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getForecastForDate } from './forecast-cache';

const STATS_FILE = join(__dirname, '../../data/stats/daily-stats.json');
const STATS_DIR = join(__dirname, '../../data/stats');

const TICK_H = 30 / 3600;

interface HourlyRaw {
  pvWh: number;
  loadWh: number;
  gridImportWh: number;
  gridExportWh: number;
  batChargeWh: number;
  batDischargeWh: number;
  autoConsumptionWh: number;
  socSamples: number[];
  samples: number;
  estBatKwh?: number;
}

interface DailyStatsStore {
  days: Record<string, Record<string, HourlyRaw>>;
}

function loadStore(): DailyStatsStore {
  try {
    if (existsSync(STATS_FILE)) {
      return JSON.parse(readFileSync(STATS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[Stats] Load error:', (e as Error).message);
  }
  return { days: {} };
}

function saveStore(store: DailyStatsStore) {
  try {
    if (!existsSync(STATS_DIR)) mkdirSync(STATS_DIR, { recursive: true });
    writeFileSync(STATS_FILE, JSON.stringify(store, null, 1));
  } catch (e) {
    console.error('[Stats] Save error:', (e as Error).message);
  }
}

export function accumulate(
  pvW: number, loadW: number, gridW: number,
  batW: number, batStatus: number, batCap: number,
) {
  const store = loadStore();
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA').format(now);
  const hour = String(now.getHours());

  if (!store.days[today]) store.days[today] = {};
  if (!store.days[today][hour]) {
    store.days[today][hour] = {
      pvWh: 0, loadWh: 0, gridImportWh: 0, gridExportWh: 0,
      batChargeWh: 0, batDischargeWh: 0, autoConsumptionWh: 0,
      socSamples: [], samples: 0,
    };
  }

  const h = store.days[today][hour];
  h.pvWh += pvW * TICK_H;
  h.loadWh += loadW * TICK_H;

  if (gridW > 0) h.gridImportWh += gridW * TICK_H;
  else h.gridExportWh += Math.abs(gridW) * TICK_H;

  if (batStatus === 1 && batW > 5) h.batChargeWh += batW * TICK_H;
  else if (batStatus === -1 && batW > 5) h.batDischargeWh += batW * TICK_H;

  if (gridW < 0) h.autoConsumptionWh += Math.max(0, pvW + gridW) * TICK_H;
  else h.autoConsumptionWh += pvW * TICK_H;

  h.socSamples.push(batCap);
  if (h.socSamples.length > 100) h.socSamples = h.socSamples.slice(-100);
  h.samples++;

  const dates = Object.keys(store.days).sort();
  if (dates.length > 30) {
    dates.slice(0, dates.length - 30).forEach(d => delete store.days[d]);
  }

  saveStore(store);
}

export interface HourlyData {
  hour: number;
  pvKwh: number;
  loadKwh: number;
  gridImportKwh: number;
  gridExportKwh: number;
  batChargeKwh: number;
  batDischargeKwh: number;
  autoConsumptionKwh: number;
  avgSoc: number | null;
  samples: number;
  estBatKwh?: number | null;
}

export function getHourly(dateStr: string) {
  const store = loadStore();
  const day = store.days[dateStr];
  if (!day) return null;

  const hours: HourlyData[] = Array.from({ length: 24 }, (_, i) => {
    const h = day[String(i)];
    if (!h || h.samples === 0) {
      return { hour: i, pvKwh: 0, loadKwh: 0, gridImportKwh: 0, gridExportKwh: 0, batChargeKwh: 0, batDischargeKwh: 0, autoConsumptionKwh: 0, avgSoc: null, samples: 0, estBatKwh: null };
    }
    return {
      hour: i,
      pvKwh: h.pvWh / 1000,
      loadKwh: h.loadWh / 1000,
      gridImportKwh: h.gridImportWh / 1000,
      gridExportKwh: h.gridExportWh / 1000,
      batChargeKwh: h.batChargeWh / 1000,
      batDischargeKwh: h.batDischargeWh / 1000,
      autoConsumptionKwh: h.autoConsumptionWh / 1000,
      avgSoc: h.socSamples.reduce((a, b) => a + b, 0) / h.socSamples.length,
      samples: h.samples,
      estBatKwh: h.estBatKwh ?? null,
    };
  });

  const sum = (k: keyof HourlyData) => hours.reduce((s, h) => s + (h[k] as number), 0);

  // Include forecast data from cache
  const forecastRaw = getForecastForDate(dateStr);
  const forecastKwh = forecastRaw ? forecastRaw.map(w => Math.round(w / 1000 * 100) / 100) : null;
  const forecastSumKwh = forecastKwh ? forecastKwh.reduce((s, v) => s + v, 0) : null;

  const actualPvKwh = sum('pvKwh');
  const accuracyPct = (forecastSumKwh && forecastSumKwh > 0)
    ? Math.round(actualPvKwh / forecastSumKwh * 100)
    : null;

  return {
    date: dateStr,
    hours,
    forecastKwh,
    accuracyPct,
    totals: {
      pvKwh: actualPvKwh,
      loadKwh: sum('loadKwh'),
      gridImportKwh: sum('gridImportKwh'),
      gridExportKwh: sum('gridExportKwh'),
      batChargeKwh: sum('batChargeKwh'),
      batDischargeKwh: sum('batDischargeKwh'),
      autoConsumptionKwh: sum('autoConsumptionKwh'),
      forecastSumKwh,
    },
  };
}

export function getAvailableDays(): string[] {
  const store = loadStore();
  return Object.keys(store.days).sort();
}

export function recalculateStats(batteryKwh: number) {
  const store = loadStore();
  let updated = 0;
  for (const date of Object.keys(store.days)) {
    for (const hour of Object.keys(store.days[date])) {
      const h = store.days[date][hour];
      if (h.socSamples.length > 0) {
        const avgSoc = h.socSamples.reduce((a, b) => a + b, 0) / h.socSamples.length;
        h.estBatKwh = Math.round((avgSoc / 100) * batteryKwh * 100) / 100;
        updated++;
      }
    }
  }
  saveStore(store);
  return { recalculated: true, days: Object.keys(store.days).length, hoursUpdated: updated, batteryKwh };
}

export function getAverageWeeklyConsumptionWatts(): number {
  const store = loadStore();
  const dates = Object.keys(store.days).sort().reverse().slice(0, 7); // Last 7 days
  
  if (dates.length === 0) return 500;

  let totalWh = 0;
  let totalHours = 0;

  for (const date of dates) {
    const dayData = store.days[date];
    for (const hour of Object.keys(dayData)) {
      const h = dayData[hour];
      if (h.loadWh > 0) {
        totalWh += h.loadWh;
        totalHours++;
      }
    }
  }

  return totalHours > 0 ? Math.round(totalWh / totalHours) : 500;
}

export function getTodayStats(): { avgConsumptionWatts: number; totalLoadWh: number; hoursCount: number } | null {
  const store = loadStore();
  const today = new Intl.DateTimeFormat('en-CA').format(new Date());
  const todayData = store.days[today];

  if (!todayData || Object.keys(todayData).length === 0) {
    return { avgConsumptionWatts: 500, totalLoadWh: 0, hoursCount: 0 };
  }

  let totalLoadWh = 0;
  let hoursCount = 0;
  for (const hour of Object.keys(todayData)) {
    const h = todayData[hour];
    totalLoadWh += h.loadWh || 0;
    hoursCount++;
  }

  const avgConsumptionWatts = hoursCount > 0 ? Math.round(totalLoadWh / hoursCount) : 500;

  return { avgConsumptionWatts, totalLoadWh, hoursCount };
}

(() => {
  if (!existsSync(STATS_DIR)) mkdirSync(STATS_DIR, { recursive: true });
})();
