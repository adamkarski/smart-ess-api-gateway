import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import axios from 'axios';

const CACHE_FILE = join(__dirname, '../../data/stats/forecast-cache.json');
const CACHE_DIR = join(__dirname, '../../data/stats');

const SYSTEM_LOSS = 0.85;

function calcExpectedPv(kwp: number, radiationWm2: number): number {
  return Math.round(kwp * radiationWm2 * SYSTEM_LOSS);
}

interface ForecastCache {
  days: Record<string, number[]>;
}

function loadCache(): ForecastCache {
  try {
    if (existsSync(CACHE_FILE)) {
      return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[ForecastCache] Load error:', (e as Error).message);
  }
  return { days: {} };
}

function saveCache(cache: ForecastCache) {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
  } catch (e) {
    console.error('[ForecastCache] Save error:', (e as Error).message);
  }
}

export function getForecastForDate(dateStr: string): number[] | null {
  const cache = loadCache();
  return cache.days[dateStr] || null;
}

export async function fetchHistoricalSolar(
  lat: string, lon: string,
  kwp: number, tilt: number, azimuth: number,
  startDate: string, endDate: string
): Promise<Record<string, number[]>> {
  // Open-Meteo uses: 0°=S, -90°=E, 90°=W, ±180°=N
  const omAz = ((azimuth - 180) % 360 + 360) % 360;
  const mappedAzimuth = omAz > 180 ? omAz - 360 : omAz;

  const url = `https://archive-api.open-meteo.com/v1/archive`
    + `?latitude=${lat}&longitude=${lon}`
    + `&start_date=${startDate}&end_date=${endDate}`
    + `&hourly=global_tilted_irradiance`
    + `&tilt=${tilt}&azimuth=${mappedAzimuth}`
    + `&timezone=auto`;

  const resp = await axios.get(url, { timeout: 15000 });
  const hourly = resp.data.hourly;
  if (!hourly || !hourly.global_tilted_irradiance) return {};

  const radiation: number[] = hourly.global_tilted_irradiance;
  const times: string[] = hourly.time || [];
  const result: Record<string, number[]> = {};

  for (let i = 0; i < times.length && i < radiation.length; i++) {
    const date = times[i].substring(0, 10);
    const h = parseInt(times[i].substring(11, 13), 10);
    if (!result[date]) result[date] = new Array(24).fill(0);
    if (h >= 0 && h < 24) {
      result[date][h] = calcExpectedPv(kwp, radiation[i]);
    }
  }

  return result;
}

export function persistTodayForecast(hourlyPv: number[]) {
  const today = new Date().toISOString().slice(0, 10);
  const cache = loadCache();
  if (!cache.days[today]) {
    cache.days[today] = hourlyPv;
    saveCache(cache);
  }
}

export async function backfillMissingDates(
  lat: string, lon: string,
  kwp: number, tilt: number, azimuth: number
) {
  const cache = loadCache();
  const today = new Date().toISOString().slice(0, 10);
  const allDates: string[] = [];

  const d = new Date();
  d.setDate(d.getDate() - 14);
  const end = new Date(today);
  while (d <= end) {
    allDates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }

  const missing = allDates.filter(ds => !cache.days[ds]);
  if (missing.length === 0) {
    console.log('[ForecastCache] All dates already cached');
    return;
  }

  const startDate = missing[0];
  const endDate = missing[missing.length - 1];
  console.log(`[ForecastCache] Fetching historical solar ${startDate}..${endDate} (${missing.length} days)`);

  try {
    const fetched = await fetchHistoricalSolar(lat, lon, kwp, tilt, azimuth, startDate, endDate);
    let count = 0;
    for (const ds of missing) {
      if (fetched[ds]) {
        cache.days[ds] = fetched[ds];
        count++;
      }
    }
    saveCache(cache);
    console.log(`[ForecastCache] Cached ${count} days`);
  } catch (e) {
    console.error('[ForecastCache] Backfill failed:', (e as Error).message);
  }
}
