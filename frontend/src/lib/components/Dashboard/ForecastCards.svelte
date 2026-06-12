<script lang="ts">
  import { weatherNode, globalWeatherData, globalSolarForecast } from '../../stores/appStore'

  let wd = $derived($weatherNode?.data ?? $globalWeatherData ?? {})
  let fc = $derived<Array<any>>(wd.forecast ?? [])
let dailySum = $derived<number[]>($globalSolarForecast?.daily_sum_kwh ?? []);
let dailyPeak = $derived<number[]>($globalSolarForecast?.daily_peak ?? []);

  function pvBarWidth(pvWp: number): number {
    if (pvWp > 1500) return 100
    if (pvWp > 700) return 60
    if (pvWp > 200) return 30
    return 20
  }

  function solarStatus(pvWp: number): { label: string; cls: string } {
    if (pvWp > 1500) return { label: 'B. WYSOKI', cls: 'text-orange-400 border-orange-500/30' }
    if (pvWp > 700) return { label: 'DOBRY', cls: 'text-yellow-400 border-yellow-500/30' }
    if (pvWp > 200) return { label: 'SŁABY', cls: 'text-slate-400 border-slate-500/30' }
    return { label: 'SŁABY', cls: 'text-slate-400 border-slate-500/30' }
  }

  function dayLabel(f: any, i: number): string {
    const offset = f.dayOffset ?? i
    if (offset === 0) return 'DZIŚ'
    if (offset === 1) return 'JUTRO'
    return new Date(f.dt * 1000).toLocaleDateString('pl-PL', { weekday: 'long' }).toUpperCase()
  }
</script>

<div class="section-card">
  <div class="section-header">
    <h3 class="section-title">Prognoza Produkcji i Pogody</h3>
    <div class="flex gap-2">
      <span class="badge">Solar Potential</span>
    </div>
  </div>
  <div class="forecast-grid">
    {#each fc.slice(0, 4) as f, i}
      {@const offset = f.dayOffset ?? i}
      {@const pvWp = dailyPeak[offset] || 0}
      {@const pvKwh = dailySum[offset] || 0}
      {@const status = solarStatus(pvWp)}
      <div class="forecast-card">
        <span class="forecast-day">{dayLabel(f, i)}</span>
        <img
          src="https://openweathermap.org/img/wn/{f.icon}@2x.png"
          class="w-12 h-12 -my-2" alt=""
        />
        <div class="forecast-temp">
          <span class="lcd-text">{Math.round(f.temp)}</span>
          <span class="unit-text">°C</span>
        </div>
        <div class="pv-bar-track">
          <div class="pv-bar-fill" style="width:{pvBarWidth(pvWp)}%"></div>
        </div>
        <div class="forecast-pv-stats">
          <span class="text-orange-400">{pvKwh.toFixed(1)} kWh</span>
          <span class="text-slate-600">|</span>
          <span class="text-yellow-400">{pvWp} Wp</span>
        </div>
        <div class="badge {status.cls}">{status.label}</div>
      </div>
    {/each}
  </div>
</div>

<style>
  .section-card {
    background: rgba(30, 41, 59, 0.7);
    backdrop-filter: blur(12px);
    border-radius: 24px;
    padding: 1.5rem;
    border: 1px solid #334155;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
    margin-bottom: 1.5rem;
  }
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }
  .section-title {
    font-size: 14px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.3em;
    color: #94a3b8;
  }
  .forecast-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1rem;
  }
  .forecast-card {
    background: rgba(15, 23, 42, 0.4);
    padding: 1rem;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.05);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }
  .forecast-day {
    font-size: 8px;
    font-weight: 900;
    color: #64748b;
    letter-spacing: 0.3em;
  }
  .forecast-temp {
    font-size: 18px;
    font-weight: 700;
  }
  .pv-bar-track {
    width: 100%;
    height: 6px;
    background: rgba(51, 65, 85, 0.6);
    border-radius: 999px;
    overflow: hidden;
  }
  .pv-bar-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(to right, #f97316, #fbbf24);
    transition: width 0.5s;
  }
  .forecast-pv-stats {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 8px;
    font-weight: 700;
  }
  .badge {
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid;
    font-size: 7px;
    font-weight: 900;
    text-transform: uppercase;
    background: rgba(15, 23, 42, 0.4);
  }

  @media (max-width: 768px) {
    .section-card { background: #2a2d35; backdrop-filter: none; border: none; border-radius: 24px; box-shadow: 14px 14px 42px #1a1d22, -14px -14px 42px #3d414b; }
    .forecast-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
    .forecast-card { background: #2a2d35; border: none; border-radius: 16px; box-shadow: 8px 8px 24px #1a1d22, -8px -8px 24px #3d414b; }
  }
</style>
