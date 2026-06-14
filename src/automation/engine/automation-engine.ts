import { automationState } from '../state';
import { runCalcNode } from '../nodes/calc.node';
import { fetchWeather, fetchSolarForecast } from '../nodes/weather.node';
import { tuyaManager, getDpsValue } from '../nodes/tuya.node';
import { controllerGetData } from '../../http/controllers/query-data.controller';
import { saveAutomationState } from '../persistence';
import { accumulate } from '../../stats/daily-stats';
import { backfillMissingDates, persistTodayForecast } from '../../stats/forecast-cache';
import { fetchDynamicPrices, getCurrentPricePerKwh } from '../dynamic-prices';
import { EnergyManager } from '../energy-manager';

let backfillDone = false;
let lastWeatherFetch = 0;
let lastSolarFetch = 0;

/**
 * Force a fresh solar forecast fetch, bypassing the normal 2‑hour throttle.
 * Used by nodes that need up‑to‑date irradiance data immediately.
 */
export async function refreshSolarForecast(force = false): Promise<void> {
  // If not forced, respect the regular throttling interval.
  if (!force && Date.now() - lastSolarFetch < 2 * 60 * 60 * 1000) return;
  lastSolarFetch = Date.now();
  const solar = automationState.settings.solar;
  if (!solar || solar.kwp <= 0) return;
  const sf = await fetchSolarForecast(
    automationState.settings.weather.lat,
    automationState.settings.weather.lon,
    solar.kwp,
    solar.tilt,
    solar.azimuth,
  );
  // Attach a timestamp for age checks.
  sf.timestamp = Date.now();
  automationState.solarForecast = sf;
}

/**
 * Force a fresh weather fetch, bypassing the regular 20‑minute throttle.
 */
export async function refreshWeather(force = false): Promise<void> {
  if (!force && Date.now() - lastWeatherFetch < 20 * 60 * 1000) return;
  lastWeatherFetch = Date.now();
  const w = automationState.settings.weather;
  if (!w?.apiKey) return;
  const wd = await fetchWeather(w.apiKey, w.lat, w.lon);
  wd.timestamp = Date.now();
  automationState.weatherData = wd;
}


function isTimeInRange(current: number, start: string, end: string, earlyCutoffMin: number = 0): boolean {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let startMin = sh * 60 + sm;
    let endMin = eh * 60 + em;
    const currentMin = current;

    if (startMin <= endMin) {
        if (earlyCutoffMin > 0) {
            endMin = Math.max(startMin + 1, endMin - earlyCutoffMin);
        }
        return currentMin >= startMin && currentMin < endMin;
    } else {
        if (earlyCutoffMin > 0) {
            endMin = Math.max(0, endMin - earlyCutoffMin);
        }
        return currentMin >= startMin || currentMin < endMin;
    }
}

function isDynamicCheapNow(): boolean {
    const tariff = (automationState.settings as any).tariff;
    if (tariff?.source !== 'dynamic' || !tariff.dynamicPrices?.length) return false;

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const currentHour = now.getHours();

    const price = tariff.dynamicPrices.find(p => p.date === todayStr && p.hour === currentHour);
    return price?.isCheap || false;
}

function isTariffPeak(): boolean {
    const tariff = (automationState.settings as any).tariff;
    if (!tariff?.peakRanges?.length) return false;
    const now = new Date();
    const dayOfWeek = now.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const currentMin = now.getHours() * 60 + now.getMinutes();

    if (isWeekend && tariff.offpeakRanges?.length) {
        for (const range of tariff.offpeakRanges) {
            if (range.start === '00:00' && range.end === '23:59') return false;
        }
    }

    for (const range of tariff.peakRanges) {
        if (isTimeInRange(currentMin, range.start, range.end)) return true;
    }
    return false;
}

function isTariffOffpeak(earlyCutoffMin: number = 5): boolean {
    const tariff = (automationState.settings as any).tariff;
    if (!tariff) return false;

    if (tariff.source === 'dynamic') {
        return isDynamicCheapNow();
    }

    if (!tariff.offpeakRanges?.length) return false;
    const now = new Date();
    const dayOfWeek = now.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const currentMin = now.getHours() * 60 + now.getMinutes();

    if (isWeekend) {
        for (const range of tariff.offpeakRanges) {
            if (range.start === '00:00' && range.end === '23:59') return true;
        }
    }

    for (const range of tariff.offpeakRanges) {
        if (range.start === '00:00' && range.end === '23:59') continue;
        if (isTimeInRange(currentMin, range.start, range.end, earlyCutoffMin)) return true;
    }

    return false;
}

function getTariffStatus(): string {
    const tariff = (automationState.settings as any).tariff;
    if (!tariff?.peakRanges?.length && tariff?.source !== 'dynamic') return 'NOC';
    const peak = isTariffPeak();
    const offpeak = isTariffOffpeak();
    if (offpeak) return 'TANIO';
    return peak ? 'SZCZYT' : 'POZA SZCZYTEM';
}

function getCurrentTariffPrice(): number {
    return getCurrentPricePerKwh();
}

function getChargingEstimate() {
    return EnergyManager.calculateEstimate();
}
export async function runAutomationEngine() {
    automationState._tick = (automationState._tick || 0) + 1;
    console.log('[Engine] Cycle Start:', new Date().toLocaleTimeString());

    if (!backfillDone) {
        backfillDone = true;
        const sol = automationState.settings.solar;
        const wth = automationState.settings.weather;
        if (sol && sol.kwp > 0 && wth && wth.lat && wth.lon) {
            backfillMissingDates(wth.lat, wth.lon, sol.kwp, sol.tilt, sol.azimuth)
                .catch(e => console.warn('[Engine] Backfill error:', e.message));
        }
    }

    try {
        const tariff = (automationState.settings as any).tariff;
        if (tariff?.source === 'dynamic') {
            await fetchDynamicPrices();
        }

        await updateWeatherNode();
        await fetchInverterData();           // always fetch data for stats & dashboard
        await updateInverterNode();           // assign data to inverter nodes (if any)
        await updateBMSNode();
        await updateTuyaNodes();
        await updatePredictorNodes();
        evaluateFlow();
    } catch (err) {
        console.error('[Engine] Critical Error:', err.message);
    }
}

async function updatePredictorNodes() {
    const predictorNodes = Object.values(automationState.nodes).filter(n => n.type === 'predictor');
    if (predictorNodes.length === 0) return;

    const estimate = EnergyManager.calculateEstimate();
    const labels: Record<string, string> = {
        currentSoc: 'SOC (%)',
        hoursLeft: 'Pozostało godzin',
        deficitKwh: 'Deficyt (kWh)',
        targetSoc: 'Cel SOC (%)',
        energyNeededUntilNextCheap: 'Potrzeba do taniej (kWh)',
        energyNeededUntilNextPv: 'Potrzeba do PV (kWh)',
        avgConsumptionKw: 'Średnie zużycie (kW)',
        nextCheapWindowInfo: 'Następne okienko',
        nextPvWindowInfo: 'Następne PV',
        requiredChargeMinutes: 'Czas ładowania (min)',
        chargePowerKw: 'Moc ładowania (kW)',
        minProjectedSoc: 'Min. prognozowany SOC (%)',
        nextChargeSource: 'Następne ładowanie z',
        nextChargeHours: 'Za ile godzin',
        nextChargeInfo: 'Info o ładowaniu',
        minReserveSoc: 'Min. SOC rezerwa (%)',
        cutoffSocGrid: 'Cutoff SOC grid (%)',
        cutoffSocOffGrid: 'Cutoff SOC off-grid (%)',
        cutoffVoltage: 'Cutoff voltage (V)',
    };

    // Add inverter SOC protection settings to predictor data
    const invNode = Object.values(automationState.nodes).find(n => n.type === 'inverter');
    let cutoffSocGrid: number | null = null;
    let cutoffSocOffGrid: number | null = null;
    let cutoffVoltage: number | null = null;

    if (invNode?.data) {
        const d = invNode.data as Record<string, any>;
        const invLabels: Record<string, string> = d.labels || {};
        cutoffVoltage = d.bat_battery_cut_off_voltage !== undefined ? Number(d.bat_battery_cut_off_voltage) : null;

        for (const [key, label] of Object.entries(invLabels)) {
            const lower = (label || '').toLowerCase();
            const val = Number(d[key]);
            if (isNaN(val) || val <= 0 || val > 100) continue;

            if (lower.includes('soc') && (lower.includes('protection') || lower.includes('low') || lower.includes('cut'))) {
                if (lower.includes('grid') || lower.includes('mains') || lower.includes('on grid')) {
                    cutoffSocGrid = val;
                } else if (lower.includes('off')) {
                    cutoffSocOffGrid = val;
                } else if (!cutoffSocGrid) {
                    cutoffSocGrid = val;
                }
            }
        }
    }

    predictorNodes.forEach(node => {
        node.data = {
            ...estimate,
            labels,
            minReserveSoc: EnergyManager.getDischargeCutoffSoc(),
            cutoffSocGrid,
            cutoffSocOffGrid,
            cutoffVoltage,
        };
        node.lastUpdate = Date.now();
    });
    console.log('[Engine] Predictor nodes updated');
}

async function fetchInverterData() {
    try {
        const dessCfg = automationState.settings.dess || {} as any;
        const data = await controllerGetData({
            pn: dessCfg.pn,
            sn: dessCfg.sn,
            devcode: dessCfg.devcode,
            devaddr: dessCfg.devaddr,
        });
        if (data) {
            const flow = data.webQueryDeviceEnergyFlowEs || {};
            const rawParams: Record<string, any> = {};

            (['bt_status', 'pv_status', 'gd_status', 'bc_status'] as const).forEach(grp => {
                if (Array.isArray((flow as any)[grp])) {
                    (flow as any)[grp].forEach((p: any) => {
                        rawParams[p.par] = p.val;
                    });
                }
            });

            const pars = data.querySPDeviceLastData?.pars || {};
            Object.values(pars).forEach((group: any) => {
                if (Array.isArray(group)) {
                    group.forEach(p => { rawParams[p.id || p.par] = p.val; });
                }
            });

            try {
                const flowAny = flow as any;
                const findVal = (arr: any[] | undefined, par: string): number => {
                    const item = Array.isArray(arr) ? arr.find((i: any) => i.par === par) : undefined;
                    return item ? Number(item.val) : 0;
                };
                const pvW = findVal(flowAny.pv_status, 'pv_output_power') * 1000;
                const loadW = findVal(flowAny.bc_status, 'load_active_power') * 1000;
                let gridW = findVal(flowAny.gd_status, 'grid_active_power') * 1000;
                if (gridW === 0 && rawParams['gd_grid_active_power'] !== undefined) {
                    gridW = Number(rawParams['gd_grid_active_power']);
                }
                const batW_raw = findVal(flowAny.bt_status, 'battery_active_power') * 1000;
                const batW = Math.abs(batW_raw);
                const bStat = (flowAny.bt_status || []).find((i: any) => i.par === 'battery_active_power');
                const batStatus = bStat ? (bStat as any).status || 0 : 0;
                const batCap = Number(rawParams['bt_battery_capacity'] || (data as any).formattedData?.battery_real_level || 0);
                automationState._latestSoc = batCap;
                accumulate(pvW, loadW, gridW, batW, batStatus, batCap);
                console.log('[Engine] Stats accumulated');
            } catch (e) {
                console.error('[Engine] Stats error:', (e as Error).message);
            }
        }
    } catch (error) {
        console.error('[Engine] Inverter data fetch for stats failed:', (error as Error).message);
    }
}

async function updateWeatherNode() {
    const weatherNodes = Object.values(automationState.nodes).filter(n => n.type === 'weather');
    const settings = automationState.settings.weather;
    if (!settings.apiKey) {
        console.warn('[Engine] Weather API Key missing');
        return;
    }

    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);

    // Throttle weather fetch to every 20 minutes
    let weatherData: any = null;
    if (now - lastWeatherFetch > 20 * 60 * 1000) {
        lastWeatherFetch = now;
        try {
            weatherData = await fetchWeather(settings.apiKey, settings.lat, settings.lon);
                // Store weather data globally
                weatherData.timestamp = Date.now();
                automationState.weatherData = weatherData;
        } catch (e) {
            console.error('[Engine] Weather fetch failed:', (e as Error).message);
        }
    }

    const rawParams: Record<string, any> = {};
    const labels: Record<string, string> = {};

    if (weatherData && weatherData.raw) {
        const r = weatherData.raw;
        rawParams['temp'] = r.main?.temp;
        labels['temp'] = 'Temperatura';
        rawParams['humidity'] = r.main?.humidity;
        labels['humidity'] = 'Wilgotność (%)';
        rawParams['clouds'] = r.clouds?.all;
        labels['clouds'] = 'Zachmurzenie (%)';
        rawParams['isSunny'] = (r.clouds?.all < 20);
        labels['isSunny'] = 'Czy Słonecznie';
    }

    if (weatherData && weatherData.forecast && weatherData.forecast.length > 0) {
        weatherData.forecast.forEach((f: any) => {
            const offset = f.dayOffset !== undefined ? f.dayOffset : 0;
            const dayName = offset === 0 ? 'Dziś' : offset === 1 ? 'Jutro' : `Pojutrze (${offset})`;
            const prefix = `f_${offset}_`;
            rawParams[`${prefix}temp`] = f.temp;
            labels[`${prefix}temp`] = `${dayName} - Temp`;
            rawParams[`${prefix}clouds`] = f.clouds;
            labels[`${prefix}clouds`] = `${dayName} - Chmury`;
            rawParams[`${prefix}isSunny`] = f.isSunny;
            labels[`${prefix}isSunny`] = `${dayName} - Słonecznie`;
        });
    }

    // Solar forecast from Open-Meteo — every 2 hours
    if (now - lastSolarFetch > 2 * 60 * 60 * 1000) {
        lastSolarFetch = now;
        try {
            const solar = automationState.settings.solar;
            if (solar && solar.kwp > 0) {
const sf = await fetchSolarForecast(
                     settings.lat, settings.lon,
                     solar.kwp, solar.tilt, solar.azimuth
                 );
                 // Store solar forecast globally
                 sf.timestamp = Date.now();
                automationState.solarForecast = sf;
                rawParams['expected_pv_now'] = sf.expected_pv_now;
                labels['expected_pv_now'] = 'Oczekiwane PV (W)';
                rawParams['expected_pv_today_peak'] = sf.expected_pv_today_peak;
                labels['expected_pv_today_peak'] = 'Szczyt PV dziś (W)';
                rawParams['expected_pv_today_sum_kwh'] = sf.expected_pv_today_sum_kwh;
                labels['expected_pv_today_sum_kwh'] = 'PV dziś suma (kWh)';
                rawParams['expected_pv_hourly'] = sf.expected_pv_hourly;
                rawParams['expected_pv_daily_sum_kwh'] = sf.daily_sum_kwh;
                rawParams['expected_pv_daily_peak'] = sf.daily_peak;
                rawParams['forecast_hourly'] = sf.forecast_hourly;
                rawParams['forecast_dates'] = sf.forecast_dates;
                // Persist today's hourly forecast to cache for dashboard
                if (sf.expected_pv_hourly) {
                    persistTodayForecast(sf.expected_pv_hourly);
                }
            }
        } catch (e) {
            console.warn('[Engine] Solar forecast unavailable:', (e as Error).message);
        }
    }

    weatherNodes.forEach(node => {
        const forecast = weatherData ? weatherData.forecast : (node.data?.forecast || []);
        node.data = { ...(node.data || {}), ...rawParams, labels, forecast };
        node.lastUpdate = Date.now();
    });
    const peakW = rawParams['expected_pv_today_peak'];
    const sumKwh = rawParams['expected_pv_today_sum_kwh'];
    const peakStr = peakW ? `, peak=${Math.round(peakW)}W` : '';
    const sumStr = sumKwh ? `, total=${sumKwh.toFixed(1)}kWh` : '';
    console.log(`[Engine] Weather + solar forecast updated${peakStr}${sumStr}`);
}
async function updateInverterNode() {
    const inverterNodes = Object.values(automationState.nodes).filter(n => n.type === 'inverter');
    if (inverterNodes.length === 0) return;

    try {
        const dessCfg = automationState.settings.dess || {} as any;
        const data = await controllerGetData({
            pn: dessCfg.pn,
            sn: dessCfg.sn,
            devcode: dessCfg.devcode,
            devaddr: dessCfg.devaddr,
        });
        if (data) {
            const rawParams: Record<string, any> = {};
            const labels: Record<string, string> = {};

            const flow = data.webQueryDeviceEnergyFlowEs || {};
            ['bt_status', 'pv_status', 'gd_status', 'bc_status'].forEach(grp => {
                if (Array.isArray(flow[grp])) {
                    flow[grp].forEach(p => {
                        rawParams[p.par] = p.val;
                        if (p.name) labels[p.par] = p.name;
                    });
                }
            });

            const pars = data.querySPDeviceLastData?.pars || {};
            Object.values(pars).forEach((group: any) => {
                if (Array.isArray(group)) {
                    group.forEach(p => {
                        const id = p.id || p.par;
                        rawParams[id] = p.val;
                        if (p.par) labels[id] = p.par;
                    });
                }
            });

            if (data.queryDeviceParsEs?.dat?.parameter) {
                data.queryDeviceParsEs.dat.parameter.forEach(p => {
                    rawParams[p.par] = p.val;
                    if (p.name) labels[p.par] = p.name;
                });
            }

            const soc = Number(rawParams['bt_battery_capacity'] || data.formattedData?.battery_real_level || 0);

            const nodeData = {
                ...data.formattedData,
                ...rawParams,
                battery_soc: soc,
                labels
            };

            inverterNodes.forEach(node => {
                node.data = nodeData;
                node.lastUpdate = Date.now();
            });
            console.log(`[Engine] Updated ${inverterNodes.length} inverter nodes (${Object.keys(rawParams).length} params found)`);
        }
    } catch (error) {
        console.error('[Engine] Inverter fetch failed:', error.message);
    }
}

async function updateBMSNode() {
    const bmsNodes = Object.values(automationState.nodes).filter(n => n.type === 'bms');
    if (bmsNodes.length === 0) return;

    // Data is pushed from ESP32 via POST /api/bms/data and stored in node.data
    // If no data yet, nodes will show WAITING in evaluateFlow
    const hasData = bmsNodes.some(n => n.data && Object.keys(n.data).length > 0);
    if (hasData) {
        console.log(`[Engine] BMS data available for ${bmsNodes.length} node(s)`);
    }
}

function isTruthy(v: any): boolean {
    return v === true || v === 1 || v === 'true' || v === '1';
}

function isFalsy(v: any): boolean {
    return v === false || v === 0 || v === 'false' || v === '0';
}

async function updateTuyaNodes() {
    const tuyaNodes = Object.values(automationState.nodes).filter(n => n.type === 'tuya');
    if (tuyaNodes.length === 0) return;
    const processed = new Set<string>();
    for (const node of tuyaNodes) {
        const effectiveId = node.config?.device_id || node.id;
        if (processed.has(effectiveId)) continue;
        processed.add(effectiveId);
        try {
            const localResult = await tuyaManager.getLocalStatus(node.id);
            if (localResult === null) {
                await tuyaManager.getCloudStatus(node.id);
            }
        } catch {
        }
    }
}

function formatTimer(ms: number): string {
    if (ms <= 0) return '0:00';
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

export function evaluateFlow() {
    console.log('[Engine] Evaluating Flow...');
    const nodeResults: Record<string, any> = {};

    // Step 1: Evaluate inverter + weather sources
    Object.values(automationState.nodes).forEach(node => {
        if (node.config?.enabled === false) {
            nodeResults[node.id] = null;
            node.lastVal = 'DISABLED';
            return;
        }
        if (node.type === 'inverter' || node.type === 'weather' || node.type === 'bms' || node.type === 'predictor') {
            const config = node.config || {};
            const data = node.data || {};
            const hasData = Object.keys(data).length > 0;
            const par = config.par;

            if (!par) {
                nodeResults[node.id] = data;
                node.lastVal = hasData ? 'READY' : 'WAITING';
                return;
            }

            const inputVal = data[par];
            if (inputVal === undefined || inputVal === null) {
                node.lastVal = 'MISSING DATA';
                nodeResults[node.id] = null;
                return;
            }

            const threshold = Number(config.threshold ?? 0);
            const hysteresis = Number(config.hysteresis ?? 0);
            const currentVal = Number(inputVal);
            const wasTrue = node.lastVal?.includes('-> TRUE');

            let result = false;
            switch (config.op) {
                case 'gt':
                    result = wasTrue ? (currentVal > threshold - hysteresis) : (currentVal > threshold);
                    break;
                case 'lt':
                    result = wasTrue ? (currentVal < threshold + hysteresis) : (currentVal < threshold);
                    break;
                case 'eq':
                    result = String(inputVal) === String(threshold);
                    break;
                default:
                    result = !!inputVal;
            }
            nodeResults[node.id] = result;
            node.lastVal = `${inputVal} -> ${result ? 'TRUE' : 'FALSE'}`;
        }
    });

    // Pending Tuya actions — gated by execute node unless emergency
    const pendingTuyaActions: Array<{ fn: () => void, name: string }> = [];

    // Step 2: Evaluate chained nodes (multi-pass for dependencies)
    const allNodeIds = Object.keys(automationState.nodes);
    for (let pass = 0; pass < 5; pass++) {
    allNodeIds.forEach(nodeId => {
        const node = automationState.nodes[nodeId];

        // Skip disabled nodes — break logic chain
        if (node.config?.enabled === false) {
            if (nodeResults[node.id] === undefined) {
                nodeResults[node.id] = null;
                node.lastVal = 'DISABLED';
            }
            return;
        }

        // Calc node – evaluate custom JavaScript expression
        if (node.type === 'calc') {
            // runCalcNode is synchronous (no async IO)
            runCalcNode(node);
            nodeResults[node.id] = node.data?.value ?? null;
            node.lastVal = nodeResults[node.id] !== null ? `OK ${nodeResults[node.id]}` : 'ERROR';
            return;
        }

        // Console node – pass-through, stores raw input for frontend display
        if (node.type === 'console') {
            const links = (automationState.links || []).filter(l => l.toNode === node.id);
            if (links.length === 0) {
                node.data.consoleInput = null;
                nodeResults[node.id] = null;
                node.lastVal = 'NO SIGNAL';
                return;
            }
            const inputVal = nodeResults[links[0].fromNode];
            node.data.consoleInput = inputVal;
            if (typeof inputVal === 'object' && inputVal !== null) {
                const len = Array.isArray(inputVal) ? inputVal.length : Object.keys(inputVal).length;
                node.lastVal = `📋 JSON (${len})`;
            } else if (inputVal === true || inputVal === false) {
                node.lastVal = inputVal ? 'TRUE' : 'FALSE';
            } else if (inputVal === null || inputVal === undefined) {
                node.lastVal = 'NULL';
            } else {
                node.lastVal = String(inputVal);
            }
            nodeResults[node.id] = inputVal;
            return;
        }

        if (node.type === 'merge') {
            if (nodeResults[node.id] !== undefined) return;
            const links = (automationState.links || []).filter(l => l.toNode === node.id);
            if (links.length === 0) {
                nodeResults[node.id] = null;
                node.lastVal = 'WAITING...';
                return;
            }
            let anyTrue = false;
            let allReady = true;
            for (const link of links) {
                const inputVal = nodeResults[link.fromNode];
                if (inputVal === undefined) { allReady = false; break; }
                if (isTruthy(inputVal)) anyTrue = true;
            }
            if (!allReady) return;
            nodeResults[node.id] = anyTrue;
            node.lastVal = anyTrue ? 'TRUE' : 'FALSE';
            console.log(`[Engine] Node ${node.id} (merge): ${node.lastVal}`);
            return;
        }

        if (node.type === 'else') {
            // Skip if already resolved on a previous pass
            if (nodeResults[node.id] !== undefined) return;
            const link = (automationState.links || []).find(l => l.toNode === node.id);
            if (!link) {
                nodeResults[node.id] = null;
                node.lastVal = 'WAITING...';
                return;
            }
            const inputVal = nodeResults[link.fromNode];
            if (inputVal === undefined) return; // not ready yet, wait for next pass
            if (isTruthy(inputVal)) {
                nodeResults[node.id] = false;
                node.lastVal = 'FALSE';
            } else if (isFalsy(inputVal)) {
                nodeResults[node.id] = true;
                node.lastVal = 'TRUE';
            } else {
                nodeResults[node.id] = null;
                node.lastVal = 'WAITING...';
            }
            console.log(`[Engine] Node ${node.id} (else): ${node.lastVal}`);
            return;
        }

        if (node.type === 'timer') {
            if (nodeResults[node.id] !== undefined) return;
            const config = node.config || {};
            const mode = config.mode || 'countdown';
            const durationMs = (config.duration_minutes || 0) * 60 * 1000;
            if (!node.data) node.data = {};

            // Reset timer if config changed (e.g. user changed duration)
            const configStr = JSON.stringify(config);
            if (node.data._configHash && node.data._configHash !== configStr) {
                node.data._timerStart = null;
                node.data._completed = false;
                node.data._triggeredToday = false;
            }
            node.data._configHash = configStr;

            let result = false;
            let displayVal = '---';

            if (mode === 'window') {
                const now = new Date();
                const currentMinutes = now.getHours() * 60 + now.getMinutes();
                const windowStart: string = config.window_start || '06:00';
                const windowEnd: string = config.window_end || '08:00';

                const [startH, startM] = windowStart.split(':').map(Number);
                const [endH, endM] = windowEnd.split(':').map(Number);
                const startMinutes = startH * 60 + startM;
                const endMinutes = endH * 60 + endM;

                let isWithinWindow: boolean;
                if (startMinutes <= endMinutes) {
                    isWithinWindow = currentMinutes >= startMinutes && currentMinutes < endMinutes;
                } else {
                    isWithinWindow = currentMinutes >= startMinutes || currentMinutes < endMinutes;
                }

                if (isWithinWindow) {
                    result = true;
                    displayVal = 'ACTIVE';
                } else {
                    result = false;
                    let minutesUntilNext: number;
                    if (currentMinutes < startMinutes) {
                        minutesUntilNext = startMinutes - currentMinutes;
                    } else {
                        minutesUntilNext = (24 * 60 - currentMinutes) + startMinutes;
                    }
                    displayVal = formatTimer(minutesUntilNext * 60 * 1000);
                }
            } else if (mode === 'tariff_peak') {
                const peak = isTariffPeak();
                result = peak;
                displayVal = peak ? 'SZCZYT ✔' : `POZA SZCZYTEM (${getTariffStatus()})`;
            } else if (mode === 'tariff_offpeak') {
                const offpeak = isTariffOffpeak(5);
                result = offpeak;
                const estimate = getChargingEstimate();
                if (offpeak) {
                    let info = 'TANIO ✔';
                    if (estimate) {
                        info += ` ${estimate.deficitKwh.toFixed(1)}kWh`;
                    }
                    displayVal = info;
                } else {
                    const status = getTariffStatus();
                    const price = getCurrentTariffPrice().toFixed(3);
                    displayVal = `SZCZYT ${price}zł/kWh`;
                }
            } else if (mode === 'schedule') {
                const scheduleTime: string = config.schedule_time || '00:00';
                const now = Date.now();
                const [hours, minutes] = scheduleTime.split(':').map(Number);

                const scheduleDate = new Date();
                scheduleDate.setHours(hours, minutes, 0, 0);
                const scheduleMs = scheduleDate.getTime();

                // If time already passed today, schedule for tomorrow
                const targetMs = now >= scheduleMs ? scheduleMs + 86400000 : scheduleMs;

                if (!node.data._completed) {
                    if (!node.data._timerStart) {
                        // Not yet triggered
                        const timeUntil = targetMs - now;
                        displayVal = formatTimer(timeUntil);
                    } else {
                        const elapsed = now - node.data._timerStart;
                        if (elapsed >= durationMs) {
                            result = true;
                            node.data._completed = true;
                            displayVal = 'DONE';
                        } else {
                            const remaining = durationMs - elapsed;
                            displayVal = formatTimer(remaining);
                        }
                    }
                } else {
                    result = true;
                    displayVal = 'DONE';
                }

                // Loop reset: next day for schedule, immediate for countdown
                if (node.data._completed) {
                    const shouldLoop = mode === 'schedule' ? config.loop !== false : config.loop === true;
                    if (mode === 'schedule' && shouldLoop && now > targetMs) {
                        const dayAfter = new Date(targetMs);
                        dayAfter.setDate(dayAfter.getDate() + 1);
                        if (now >= dayAfter.getTime()) {
                            node.data._timerStart = null;
                            node.data._completed = false;
                        }
                    }
                }
            } else {
                // Countdown mode
                const triggerOnInput = config.trigger_on_input !== false;

                if (triggerOnInput) {
                    const link = (automationState.links || []).find(l => l.toNode === node.id);
                    if (!link) {
                        nodeResults[node.id] = null;
                        node.lastVal = 'WAITING...';
                        return;
                    }
                    const inputVal = nodeResults[link.fromNode];
                    if (inputVal === undefined) return;

                    const inputTruthy = isTruthy(inputVal);
                    if (!inputTruthy) {
                        node.data._timerStart = null;
                        node.data._completed = false;
                        nodeResults[node.id] = false;
                        node.lastVal = 'WAITING...';
                        return;
                    }
                }

                // Start timer on first evaluation
                if (!node.data._timerStart && !node.data._completed) {
                    node.data._timerStart = Date.now();
                }

                if (node.data._completed) {
                    result = true;
                    displayVal = 'DONE';
                    if (config.loop === true) {
                        node.data._timerStart = Date.now();
                        node.data._completed = false;
                    }
                } else {
                    const elapsed = Date.now() - node.data._timerStart;
                    if (elapsed >= durationMs) {
                        result = true;
                        displayVal = 'DONE';
                        node.data._completed = !config.loop;
                        if (config.loop === true) {
                            node.data._timerStart = Date.now();
                        }
                    } else {
                        displayVal = formatTimer(durationMs - elapsed);
                    }
                }
            }

            nodeResults[node.id] = result;
            node.lastVal = displayVal;
            console.log(`[Engine] Node ${node.id} (timer): ${displayVal}`);
            return;
        }

        if (node.type === 'logic') {
            if (nodeResults[node.id] !== undefined) return;
            const mode = (node.config?.mode || 'and') as string;
            const links = (automationState.links || []).filter(l => l.toNode === node.id);
            if (links.length === 0) {
                nodeResults[node.id] = null;
                node.lastVal = 'WAITING...';
                return;
            }
            let allReady = true;
            let anyTrue = false;
            let allTrue = true;
            for (const link of links) {
                const inputVal = nodeResults[link.fromNode];
                if (inputVal === undefined) { allReady = false; break; }
                if (isTruthy(inputVal)) anyTrue = true;
                else allTrue = false;
            }
            if (!allReady) return;
            const result = mode === 'or' ? anyTrue : allTrue;
            nodeResults[node.id] = result;
            node.lastVal = result ? 'TRUE' : 'FALSE';
            console.log(`[Engine] Node ${node.id} (logic-${mode}): ${node.lastVal}`);
            return;
        }

        if (node.type === 'execute') {
            if (nodeResults[node.id] !== undefined) return;
            const links = (automationState.links || []).filter(l => l.toNode === node.id);
            if (links.length === 0) {
                nodeResults[node.id] = null;
                node.lastVal = 'WAITING...';
                return;
            }
            let allReady = true;
            let anyTrue = false;
            for (const link of links) {
                const inputVal = nodeResults[link.fromNode];
                if (inputVal === undefined) { allReady = false; break; }
                if (isTruthy(inputVal)) anyTrue = true;
            }
            if (!allReady) return;
            if (anyTrue) {
                if (!node.data) node.data = {};
                node.data._lastFireTime = Date.now();
                node.data._fireCount = (node.data._fireCount || 0) + 1;
            }
            nodeResults[node.id] = anyTrue;
            node.lastVal = anyTrue ? '🔥 EXECUTE' : 'WAITING...';
            console.log(`[Engine] Node ${node.id} (execute): ${node.lastVal}`);
            return;
        }

        if (node.type !== 'tuya') return;
        if (nodeResults[node.id] !== undefined) return;
        const config = node.config || {};
        const data = node.data || {};
        const hasLinks = (automationState.links || []).some(l => l.toNode === node.id);
        const inputSource = config.input_source || (hasLinks && !config.par ? 'node' : 'device');

        let inputVal: any = null;
        let inputLabel = '';

        if (inputSource === 'node') {
            const link = (automationState.links || []).find(l => l.toNode === node.id);
            if (!link) {
                nodeResults[node.id] = data;
                node.lastVal = 'WAITING...';
                return;
            }
            inputVal = nodeResults[link.fromNode];
            if (inputVal === undefined) return;
            inputLabel = `IN:${inputVal}`;
        } else {
            const par = config.par;
            if (!par) {
                nodeResults[node.id] = data;
                node.lastVal = 'READY';
                return;
            }
            inputVal = data[par] ?? data.dps_translated?.[par] ?? data.dps?.[par];
            inputLabel = par;
        }

        if (inputVal === undefined || inputVal === null) {
            node.lastVal = 'MISSING DATA';
            nodeResults[node.id] = null;
            return;
        }

        const threshold = config.threshold ?? 0;
        let result = false;
        if (config.op === 'none') {
            result = !!inputVal;
        } else {
            switch (config.op) {
                case 'gt': result = Number(inputVal) > Number(threshold); break;
                case 'lt': result = Number(inputVal) < Number(threshold); break;
                case 'eq': result = String(inputVal) === String(threshold); break;
                default: result = !!inputVal;
            }
        }

        const dpsIndex = Number(config.dps_control) || 1;
        const actionType = config.action_type || 'turn_on';
        if (!node.data) node.data = {};

        if (actionType === 'toggle') {
            const lastToggle = node.data._lastToggleResult;
            if (result && result !== lastToggle) {
                const currentVal = getDpsValue(data.dps, dpsIndex, data.category);
                const toggleVal = !currentVal;
                console.log(`[Engine] 🔧 Toggle: ${node.name} DPS ${dpsIndex} => ${toggleVal}`);
                const performAction = async () => {
                    try {
                        const ok = await tuyaManager.setStatus(node.id, dpsIndex, toggleVal);
                        console.log(`[Engine] ✅ ${ok ? 'OK' : 'FAIL'} toggle ${node.name}`);
                    } catch (e) {
                        console.error(`[Engine] 💥 Toggle exception ${node.id}:`, e?.message);
                    }
                };
                const isEmergency = config.emergency || node.name.toLowerCase().includes('emergency') || node.name.toLowerCase().includes('awaryjne');
                if (isEmergency) { 
                    performAction(); 
                } else { 
                    pendingTuyaActions.push({ fn: performAction, name: node.name }); 
                }
            }
            node.data._lastToggleResult = result;
        } else {
            let targetValue: any;
            if (actionType === 'turn_on') {
                targetValue = result;
            } else if (actionType === 'turn_off') {
                targetValue = !result;
            } else if (actionType === 'set_value') {
                targetValue = config.action_value !== undefined ? config.action_value : true;
            } else {
                targetValue = true;
            }

            const currentVal = getDpsValue(data.dps, dpsIndex, data.category);
            const lastSent = node.data._lastSentTarget;

            if (currentVal === targetValue) {
                node.lastVal = `${inputLabel} -> ${result ? 'TRUE' : 'FALSE'} (OK)`;
                nodeResults[node.id] = result;
                return;
            }

            console.log(`[Engine] 🔧 Action: ${node.name} → ${actionType} DPS ${dpsIndex} => ${targetValue} (was ${currentVal})`);
            node.data._lastSentTarget = targetValue;

            const performAction = async () => {
                try {
                    const ok = await tuyaManager.setStatus(node.id, dpsIndex, targetValue);
                    console.log(`[Engine] ✅ ${ok ? 'OK' : 'FAIL'} ${node.name} -> ${targetValue}`);
                } catch (e) {
                    console.error(`[Engine] 💥 Action exception ${node.id}:`, e?.message);
                }
            };
            const isEmergency = config.emergency || node.name.toLowerCase().includes('emergency') || node.name.toLowerCase().includes('awaryjne');
            if (isEmergency) { 
                performAction(); 
            } else if (actionType === 'turn_on' && !targetValue) { 
                performAction(); // OFF always goes through
            } else { 
                pendingTuyaActions.push({ fn: performAction, name: node.name }); 
            }
        }

        nodeResults[node.id] = result;
        node.lastVal = `${inputLabel} -> ${result ? 'TRUE' : 'FALSE'}`;
        console.log(`[Engine] Node ${node.id} (tuya): ${node.lastVal}`);
    });
    }

    // Execute gate: Tuya actions only fire if at least one execute node received TRUE
    const executeNodes = Object.values(automationState.nodes).filter(n => n.type === 'execute');
    const executeGateOpen = executeNodes.length === 0 || executeNodes.some(n => isTruthy(nodeResults[n.id]));

    if (executeGateOpen) {
        if (pendingTuyaActions.length > 0) {
            console.log(`[Engine] 🔓 Execute gate OPEN — firing ${pendingTuyaActions.length} Tuya action(s)`);
            for (const item of pendingTuyaActions) item.fn();
        }
    } else {
        const suppressed = pendingTuyaActions.length;
        if (suppressed > 0) {
            console.log(`[Engine] 🔒 Execute gate CLOSED — ${suppressed} action(s) suppressed (normal priority)`);
        }
    }
    pendingTuyaActions.length = 0;

    // Step 3: Propagate to action nodes
    Object.values(automationState.nodes).forEach(node => {
        if (node.type !== 'action') return;
        const link = (automationState.links || []).find(l => l.toNode === node.id);
        if (!link) {
            if (!node.data) node.data = {};
            node.data.log = 'IDLE (NO LINK)';
            return;
        }
        const inputData = nodeResults[link.fromNode];
        console.log(`[Engine] Propagating ${link.fromNode} -> ${node.id} (Val: ${inputData})`);
        if (!node.data) node.data = {};
        node.data.log = inputData === null ? 'WAITING...' : String(inputData).toUpperCase();
        node.lastVal = node.data.log;
    });

    saveAutomationState();
}
