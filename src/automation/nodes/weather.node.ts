import axios from 'axios';

export interface WeatherData {
    timestamp?: number;
    temp: number;
    description: string;
    isSunny: boolean;
    clouds: number;
    forecast: any[];
    raw: any;
}

export interface SolarForecast {
    timestamp?: number;
    expected_pv_hourly: number[];       // W per hour, 24 slots for today
    expected_pv_today_peak: number;     // max W for today
    expected_pv_today_sum_kwh: number;  // total kWh for today
    expected_pv_now: number;            // W for current hour
    daily_sum_kwh: number[];            // daily total kWh for each forecast day
    daily_peak: number[];              // daily peak W for each forecast day
    forecast_hourly: number[][];       // hourly W for each forecast day (for chart)
    forecast_dates: string[];        // ISO dates corresponding to each forecast_hourly entry
}

export async function fetchWeather(apiKey: string, lat: string, lon: string): Promise<WeatherData> {
    const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const currentResponse = await axios.get(currentUrl);
    const current = currentResponse.data;

    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const forecastResponse = await axios.get(forecastUrl);
    const forecastList = forecastResponse.data.list;

    const dailyForecast: any[] = [];
    const seenDays = new Set();
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    forecastList.forEach((item: any) => {
        const date = new Date(item.dt * 1000).toLocaleDateString();
        if (!seenDays.has(date) && dailyForecast.length < 4) {
            const hour = new Date(item.dt * 1000).getHours();
            if (hour >= 11 && hour <= 14) {
                const entryDate = new Date(item.dt * 1000);
                const entryStart = new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate());
                const dayOffset = Math.round((entryStart.getTime() - todayStart.getTime()) / 86400000);
                dailyForecast.push({
                    dt: item.dt,
                    temp: item.main.temp,
                    clouds: item.clouds.all,
                    description: item.weather[0].description,
                    icon: item.weather[0].icon,
                    isSunny: item.clouds.all < 50,
                    dayOffset: dayOffset >= 0 ? dayOffset : 0
                });
                seenDays.add(date);
            }
        }
    });

    return {
        temp: current.main.temp,
        description: current.weather[0].description,
        isSunny: current.clouds.all < 50,
        clouds: current.clouds.all,
        forecast: dailyForecast,
        raw: currentResponse.data
    };
}

const SYSTEM_LOSS = 0.85;

function calcExpectedPv(kwp: number, radiationWm2: number): number {
    return Math.round(kwp * radiationWm2 * SYSTEM_LOSS);
}

export async function fetchSolarForecast(
    lat: string, lon: string,
    kwp: number, tilt: number, azimuth: number
): Promise<SolarForecast> {
    const now = new Date();
    const currentHour = now.getHours();

    // Open-Meteo uses: 0°=S, -90°=E, 90°=W, ±180°=N
    // Our system uses: 0°=N, 90°=E, 180°=S, 270°=W
    const omAz = ((azimuth - 180) % 360 + 360) % 360;
    const mappedAzimuth = omAz > 180 ? omAz - 360 : omAz;

    const url = `https://api.open-meteo.com/v1/forecast`
        + `?latitude=${lat}&longitude=${lon}`
        + `&hourly=global_tilted_irradiance`
        + `&tilt=${tilt}&azimuth=${mappedAzimuth}`
        + `&timezone=auto&forecast_days=4`;

    const resp = await axios.get(url, { timeout: 10000 });
    const hourly = resp.data.hourly;

    if (!hourly || !hourly.global_tilted_irradiance) {
        return emptySolarForecast();
    }

    const radiation: number[] = hourly.global_tilted_irradiance;
    const hourlyPv: number[] = radiation.map(r => calcExpectedPv(kwp, r));
    const times: string[] = hourly.time || [];

    // Group by date to build per-day data
    const dayBuckets: Record<string, number[]> = {};
    for (let i = 0; i < times.length && i < hourlyPv.length; i++) {
        const date = times[i].substring(0, 10);
        if (!dayBuckets[date]) dayBuckets[date] = new Array(24).fill(0);
        const h = parseInt(times[i].substring(11, 13), 10);
        if (h >= 0 && h < 24) {
            dayBuckets[date][h] = hourlyPv[i];
        }
    }

    const sortedDates = Object.keys(dayBuckets).sort();
    const todayStr = now.toISOString().slice(0, 10);
    const todayPv = dayBuckets[todayStr] || new Array(24).fill(0);

    const daily_sum_kwh = sortedDates.map(d => {
        const sumWh = dayBuckets[d].reduce((s, v) => s + v, 0);
        return Math.round(sumWh / 1000 * 10) / 10;
    });
    const daily_peak = sortedDates.map(d => Math.max(...dayBuckets[d], 0));

    const peak = Math.max(...todayPv, 0);
    const dailySumWh = todayPv.reduce((s, v) => s + v, 0);

    return {
        expected_pv_hourly: todayPv,
        expected_pv_today_peak: peak,
        expected_pv_today_sum_kwh: Math.round(dailySumWh / 1000 * 10) / 10,
        expected_pv_now: todayPv[currentHour] || 0,
        daily_sum_kwh,
        daily_peak,
        forecast_hourly: sortedDates.map(d => dayBuckets[d]),
        forecast_dates: sortedDates,
    };
}

function emptySolarForecast(): SolarForecast {
    return {
        expected_pv_hourly: new Array(24).fill(0),
        expected_pv_today_peak: 0,
        expected_pv_today_sum_kwh: 0,
        expected_pv_now: 0,
        daily_sum_kwh: [],
        daily_peak: [],
        forecast_hourly: [],
        forecast_dates: [],
    };
}
