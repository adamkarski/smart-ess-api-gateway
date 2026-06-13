<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { appData, weatherNode, globalWeatherData, globalSolarForecast } from '../../stores/appStore'

  let chartEl: HTMLDivElement
  let Plotly: any = null
  let chartTimers: ReturnType<typeof setInterval>[]
  let pvTotal = $state('--')
  let loadTotal = $state('--')
  let gridTotal = $state('--')
  let gridCls = $state('text-slate-400')
  let accText = $state('--')
  let accCls = $state('')

  function localDateStr(d?: Date): string {
    const dt = d ?? new Date()
    const y = dt.getFullYear()
    const m = String(dt.getMonth() + 1).padStart(2, '0')
    const day = String(dt.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  let selectedDate = $state(localDateStr())
  let isFuture = $state(false)
  let dateLabel = $state('DZIŚ')
  let availableDays: string[] = $state([])

  let wd = $derived($weatherNode?.data ?? $globalWeatherData ?? {});
let sf = $derived($globalSolarForecast ?? {});

  // DESS connectivity check
  let dessOffline = $derived.by(() => {
    const raw = $appData
    if (!raw) return true
    const flow = raw.webQueryDeviceEnergyFlowEs
    if (!flow || !flow.date) return true
    const lastUpdate = new Date(flow.date).getTime()
    if (isNaN(lastUpdate)) return true
    return Date.now() - lastUpdate > 10 * 60 * 1000
  })

  // --- Chart settings (persisted to localStorage) ---
  type ChartMode = 'bar' | 'line' | 'bar+line' | 'area'
  interface ChartSettings {
    mode: ChartMode
    series: Record<string, boolean>
  }

  const LS_KEY = 'desmonitor_chart_settings'

  function loadSettings(): ChartSettings {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) return JSON.parse(raw)
    } catch {}
    return {
      mode: 'bar',
      series: { pv: true, load: true, gridImport: true, gridExport: true, batCharge: true, batDischarge: true },
    }
  }

  function saveSettings(s: ChartSettings) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch {}
  }

  let settings = $state(loadSettings())

  function setMode(m: ChartMode) {
    settings.mode = m
    saveSettings(settings)
    renderChart()
  }

  function toggleSeries(key: string) {
    settings.series[key] = !settings.series[key]
    saveSettings(settings)
    renderChart()
  }

  // Map series key → trace index (matches order in renderChart)
  function seriesKeyToTraceIndex(key: string): number {
    const idx = seriesDefs.findIndex(d => d.key === key)
    return idx
  }
  function traceIndexToSeriesKey(idx: number): string | null {
    return seriesDefs[idx]?.key ?? null
  }

  // Handle Plotly legend click — sync settings & re-render
  function onLegendClick(data: any) {
    if (data?.curveNumber === undefined) return
    const key = traceIndexToSeriesKey(data.curveNumber)
    if (!key) return
    settings.series[key] = !settings.series[key]
    saveSettings(settings)
    setTimeout(() => renderChart(), 10)
  }

  // Series definition
  const seriesDefs = [
    { key: 'pv', label: 'PV', icon: 'fa-sun', color: '#fbbf24' },
    { key: 'load', label: 'DOM', icon: 'fa-house', color: '#3b82f6' },
    { key: 'gridImport', label: 'Import', icon: 'fa-bolt', color: '#f87171' },
    { key: 'gridExport', label: 'Eksport', icon: 'fa-arrow-up-from-bracket', color: '#4ade80' },
    { key: 'batCharge', label: 'Bateria +', icon: 'fa-battery-three-quarters', color: '#00b0ff' },
    { key: 'batDischarge', label: 'Bateria -', icon: 'fa-battery-quarter', color: '#a78bfa' },
  ]

  const dayNames = ['DZIŚ', 'JUTRO', 'POJUTRZE']

  onMount(async () => {
    Plotly = (await import('plotly.js-dist-min')).default
    await loadAvailableDays()
    chartTimers = [
      setTimeout(() => renderChart(), 500),
      setInterval(renderChart, 30000),
    ]
    if (chartEl) {
      chartEl.on('plotly_legendclick', onLegendClick)
    }
  })

  onDestroy(() => {
    chartTimers?.forEach(t => { if (t) clearInterval(t) })
  })

  async function loadAvailableDays() {
    try {
      const r = await fetch('/stats/daily')
      const d = await r.json()
      availableDays = d.availableDays || []
    } catch {}
  }

  function prevDay() {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() - 1)
    selectedDate = localDateStr(d)
    updateLabel()
    renderChart()
  }

  function nextDay() {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + 1)
    selectedDate = localDateStr(d)
    updateLabel()
    renderChart()
  }

  function goToday() {
    selectedDate = localDateStr()
    updateLabel()
    renderChart()
  }

  function updateLabel() {
    const today = localDateStr()
    const diff = Math.round((new Date(selectedDate).getTime() - new Date(today).getTime()) / 86400000)
    isFuture = diff > 0
    if (diff === 0) dateLabel = 'DZIŚ'
    else if (diff === 1) dateLabel = 'JUTRO'
    else if (diff === -1) dateLabel = 'WCZORAJ'
    else dateLabel = new Date(selectedDate).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'short' }).toUpperCase()
  }

  function hoursArray(): number[] {
    return Array.from({ length: 24 }, (_, i) => i)
  }

  function distributeDailySum(kwh: number): number[] {
    const h = hoursArray()
    const weights = h.map(i => Math.exp(-Math.pow(i - 12, 2) / 18))
    const totalW = weights.reduce((a, b) => a + b, 0)
    return weights.map(w => Math.round(((w / totalW) * kwh) * 1000) / 1000)
  }

  async function renderChart() {
    if (!Plotly || !chartEl) return
    try {
      const r = await fetch(`/stats/daily?date=${selectedDate}`)
      const data = await r.json()
      const hasRealData = data?.hours && data.hours.length > 0
      const hours = hoursArray().map(h => String(h).padStart(2, '0') + ':00')

      let traces: any[] = []
      let totals: any = null

      if (hasRealData) {
        const pv = data.hours.map((h: any) => h.pvKwh ?? 0)
        const load = data.hours.map((h: any) => Math.round((h.loadKwh ?? 0) * 100) / 100)
        const gridImport = data.hours.map((h: any) => Math.round((h.gridImportKwh ?? 0) * 100) / 100)
        const gridExport = data.hours.map((h: any) => -Math.round((h.gridExportKwh ?? 0) * 100) / 100)
        const batCh = data.hours.map((h: any) => Math.round((h.batChargeKwh ?? 0) * 100) / 100)
        const batDis = data.hours.map((h: any) => -Math.round((h.batDischargeKwh ?? 0) * 100) / 100)

        const mode = settings.mode
        const isLine = mode === 'line' || mode === 'bar+line'
        const isArea = mode === 'area'
        const isBar = mode === 'bar' || mode === 'bar+line'
        const traceType = isArea ? 'scatter' : (isBar ? 'bar' : 'scatter')
        const scatterOpts = isArea
          ? { fill: 'tozeroy', mode: 'lines+markers', line: { width: 1.5 }, marker: { size: 3 } }
          : { mode: 'lines+markers', line: { width: 1.5 }, marker: { size: 3 } }

        const seriesMap: Record<string, { y: number[], color: string, name: string }> = {
          pv: { y: pv, color: '#fbbf24', name: 'PV' },
          load: { y: load, color: '#3b82f6', name: 'DOM' },
          gridImport: { y: gridImport, color: '#f87171', name: 'Sieć (import)' },
          gridExport: { y: gridExport, color: '#4ade80', name: 'Sieć (eksport)' },
          batCharge: { y: batCh, color: '#00b0ff', name: 'Bateria (ładowanie)' },
          batDischarge: { y: batDis, color: '#a78bfa', name: 'Bateria (rozładowanie)' },
        }

        seriesDefs.forEach(def => {
          const s = seriesMap[def.key]
          if (!s) return
          const visible = settings.series[def.key] ? true : 'legendonly'

          if (isLine) {
            traces.push({
              x: hours, y: s.y, type: 'scatter', visible, ...scatterOpts,
              name: s.name, marker: { color: s.color, size: 3 }, line: { color: s.color, width: 1.2 },
              hovertemplate: `%{y:.3f} kWh<extra>${s.name}</extra>`,
            })
          } else if (isArea) {
            // area: only positive values
            if (def.key === 'gridExport' || def.key === 'batDischarge') return
            traces.push({
              x: hours, y: s.y, type: 'scatter', visible, ...scatterOpts,
              name: s.name, marker: { color: s.color, size: 2 }, line: { color: s.color, width: 0 },
              fillcolor: s.color + '40',
              hovertemplate: `%{y:.3f} kWh<extra>${s.name}</extra>`,
            })
          } else {
            traces.push({
              x: hours, y: s.y, type: 'bar', visible, name: s.name,
              marker: { color: s.color, opacity: def.key === 'pv' ? 0.85 : 0.7 },
              hovertemplate: `%{y:.3f} kWh<extra>${s.name}</extra>`,
            })
          }
        })

        // Forecast overlay for today (and past days with forecast cached)
        const todayStr = localDateStr()
        const isToday = selectedDate === todayStr
        const fd = wd.forecast_dates ?? $globalSolarForecast?.forecast_dates ?? []
        const fh = wd.forecast_hourly ?? $globalSolarForecast?.forecast_hourly ?? []
        const todayIdx = fd.indexOf(selectedDate)
        if (todayIdx >= 0 && fh[todayIdx] && settings.series.pv) {
          const todayForecast = fh[todayIdx].map((v: number) => Math.round(v / 1000 * 1000) / 1000)
          traces.push({
            x: hours, y: todayForecast, type: 'scatter', mode: 'lines+markers',
            name: isToday ? 'Prognoza PV' : `Prognoza (${selectedDate})`,
            line: { color: 'rgba(251, 191, 36, 0.5)', width: 1.5, dash: 'dot' },
            marker: { color: 'rgba(251, 191, 36, 0.6)', size: 4 },
            hovertemplate: '%{y:.3f} kWh<extra>Prognoza</extra>',
          })
        }

        totals = data.totals
      } else if (isFuture) {
        // Find correct forecast index by matching dates
        const forecastDates = wd.forecast_dates ?? $globalSolarForecast?.forecast_dates ?? []
        const hourlyAll = wd.forecast_hourly ?? $globalSolarForecast?.forecast_hourly ?? []
        const dailySums = wd.expected_pv_daily_sum_kwh || []
        const idx = forecastDates.indexOf(selectedDate)
        const hourlyArr = idx >= 0 ? hourlyAll[idx] : null
        const dailySum = idx >= 0 ? dailySums[idx] : 0
        const pvKwh = hourlyArr
          ? hourlyArr.map(v => Math.round(v / 1000 * 1000) / 1000)
          : distributeDailySum(dailySum)
        // Always show forecast as dashed line (ignores chart mode)
        if (settings.series.pv) {
          traces.push({
            x: hours, y: pvKwh, type: 'scatter', mode: 'lines+markers',
            name: 'PV (prognoza)',
            line: { color: 'rgba(251, 191, 36, 0.6)', width: 1.5, dash: 'dot' },
            marker: { color: 'rgba(251, 191, 36, 0.7)', size: 3, symbol: 'diamond' },
            hovertemplate: '%{y:.3f} kWh<extra>Prognoza PV</extra>',
          })
          // Add subtle fill under curve
          traces.push({
            x: hours, y: pvKwh, type: 'scatter', mode: 'none',
            name: 'PV (zakres)',
            fill: 'tozeroy',
            fillcolor: 'rgba(251, 191, 36, 0.08)',
            line: { width: 0 },
            showlegend: false,
            hoverinfo: 'skip',
          })
        }
        totals = { pvKwh: dailySum, loadKwh: 0, gridImportKwh: 0, gridExportKwh: 0 }
      }

      const barmode = settings.mode === 'bar' ? 'relative' : 'relative'

      const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
        margin: { t: 5, r: 5, b: 25, l: 35 }, showlegend: true,
        legend: { orientation: 'h', y: -0.2, font: { color: '#64748b', size: 8 }, itemclick: 'toggle', itemdoubleclick: false },
        barmode,
        xaxis: { showgrid: true, gridcolor: 'rgba(255,255,255,0.03)', tickfont: { color: '#475569', size: 8 }, dtick: 2 },
        yaxis: { showgrid: true, gridcolor: 'rgba(255,255,255,0.03)', tickfont: { color: '#475569', size: 8 }, title: { text: 'kWh', font: { color: '#475569', size: 8 } } },
        hovermode: 'x unified',
        hoverlabel: { bgcolor: 'rgba(15,23,42,0.95)', font: { color: '#e2e8f0', size: 9 } },
        shapes: (data.tariff?.offpeakRanges || []).flatMap((r: any) => {
          const [sh, sm] = r.start.split(':').map(Number)
          const [eh, em] = r.end.split(':').map(Number)
          const startVal = sh + sm/60
          const endVal = eh + em/60
          
          if (endVal <= startVal) {
            // Overnight range — split into two rects: start→24, 0→end
            return [
              { type: 'rect', xref: 'x', yref: 'paper', x0: startVal, y0: 0, x1: 24, y1: 1, fillcolor: 'rgba(45, 212, 191, 0.05)', line: { width: 0 }, layer: 'below' },
              { type: 'rect', xref: 'x', yref: 'paper', x0: 0, y0: 0, x1: endVal, y1: 1, fillcolor: 'rgba(45, 212, 191, 0.05)', line: { width: 0 }, layer: 'below' },
            ]
          }
          
          return {
            type: 'rect',
            xref: 'x', yref: 'paper',
            x0: startVal, y0: 0, x1: endVal, y1: 1,
            fillcolor: 'rgba(45, 212, 191, 0.05)',
            line: { width: 0 },
            layer: 'below'
          }
        })
      }

      await Plotly.react(chartEl, traces.length > 0 ? traces : [{ x: hours, y: hours.map(() => 0), type: 'bar', name: 'Brak danych', marker: { color: '#334155' } }], layout, { responsive: true, displayModeBar: false })

      if (totals) {
        pvTotal = 'PV: ' + (totals.pvKwh ?? 0).toFixed(1) + ' kWh'
        loadTotal = 'DOM: ' + (totals.loadKwh ?? 0).toFixed(1) + ' kWh'
        const net = (totals.gridImportKwh ?? 0) - (totals.gridExportKwh ?? 0)
        gridTotal = 'SIEC: ' + (net >= 0 ? '+' : '') + net.toFixed(1) + ' kWh'
        if (data?.accuracyPct !== null && data?.accuracyPct !== undefined && !isFuture) {
          const cls = data.accuracyPct >= 80 ? 'text-green-400' : data.accuracyPct >= 40 ? 'text-yellow-400' : 'text-red-400'
          accText = `${data.accuracyPct}% planu`
          accCls = cls
        } else {
          accText = isFuture ? 'PROGNOZA' : '--'
          accCls = 'text-slate-400'
        }
        // Dynamic color for grid balance
        const netGrid = (totals.gridImportKwh ?? 0) - (totals.gridExportKwh ?? 0)
        gridCls = netGrid >= 0 ? 'text-red-400' : 'text-green-400'
      }
    } catch {}
  }
</script>

<div class="section-card">
  <div class="section-header">
    <h3 class="section-title">Dzienny Bilans Energii</h3>
    <div class="date-nav">
      <button class="date-btn" onclick={prevDay}><i class="fa-solid fa-chevron-left"></i></button>
      <span class="date-label">{dateLabel}</span>
      <button class="date-btn" onclick={nextDay}><i class="fa-solid fa-chevron-right"></i></button>
      <button class="date-btn text-teal-400" onclick={goToday}><i class="fa-solid fa-calendar-day"></i></button>
    </div>
  </div>
  <div class="stat-row">
    <span class="stat-label text-amber-400 stat-tip" data-tip="Całkowita produkcja fotowoltaiczna dzisiaj (0:00–23:59)">
      {pvTotal}
      <span class="stat-tip-box">Całkowita produkcja fotowoltaiczna dzisiaj (0:00–23:59)</span>
    </span>
    <span class="stat-label text-blue-500 stat-tip" data-tip="Całkowite zużycie energii w domu dzisiaj">
      {loadTotal}
      <span class="stat-tip-box">Całkowite zużycie energii w domu dzisiaj</span>
    </span>
    <span class="stat-label {gridCls} stat-tip" data-tip="Bilans z siecią energetyczną. Dodatni = pobrano z sieci, ujemny = oddano do sieci">
      {gridTotal}
      <span class="stat-tip-box">Bilans z siecią energetyczną. Dodatni = pobrano z sieci, ujemny = oddano do sieci</span>
    </span>
    <span class="stat-label {accCls} stat-tip" data-tip="Procent dzisiejszej prognozy PV, który został zrealizowany">
      {accText}
      <span class="stat-tip-box">Procent dzisiejszej prognozy PV, który został zrealizowany</span>
    </span>
  </div>

  <!-- Chart controls: mode + series toggles -->
  <div class="chart-controls">
    <div class="control-group">
      <span class="control-label">Tryb:</span>
      <div class="mode-btns">
        {#each ['bar', 'line', 'bar+line', 'area'] as mode}
          <button
            class="mode-btn"
            class:mode-btn-active={settings.mode === mode}
            onclick={() => setMode(mode as ChartMode)}
          >
            {mode === 'bar' ? 'Słupki' : mode === 'line' ? 'Linie' : mode === 'bar+line' ? 'Sł.+Lin.' : 'Pow.'}
          </button>
        {/each}
      </div>
    </div>
    <div class="control-group series-group">
      <span class="control-label">Serie:</span>
      {#each seriesDefs as def}
        <button
          class="series-btn"
          class:series-btn-off={!settings.series[def.key]}
          style="--series-color: {def.color}"
          onclick={() => toggleSeries(def.key)}
        >
          <i class="fa-solid {def.icon}" style="font-size: 8px;"></i>
          {def.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="chart-wrapper">
    <div bind:this={chartEl} class="chart-area"></div>
    {#if dessOffline}
      <div class="dess-overlay">
        <div class="dess-overlay-content">
          <i class="fa-solid fa-wifi-slash text-3xl text-red-400 mb-3"></i>
          <div class="dess-overlay-title">BRAK KOMUNIKACJI Z DESS</div>
          <div class="dess-overlay-text">
            Sprawdź połączenie internetowe w piwnicy.<br>
            Router / przełącznik mógł się zrestartować.
          </div>
          <div class="dess-overlay-hint">Dane zostaną wznowione automatycznie po przywróceniu łączności</div>
        </div>
      </div>
    {/if}
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
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .section-title {
    font-size: 14px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.3em;
    color: #94a3b8;
    margin-right: auto;
  }
  .date-nav {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(15, 23, 42, 0.5);
    border-radius: 20px;
    padding: 3px;
    border: 1px solid #334155;
  }
  .date-btn {
    width: 28px; height: 28px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: #94a3b8;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
    font-size: 11px;
  }
  .date-btn:hover { background: rgba(56, 189, 248, 0.1); color: #38bdf8; }
  .date-label {
    font-size: 9px;
    font-weight: 900;
    color: #e2e8f0;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    min-width: 60px;
    text-align: center;
  }
  .stat-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }
  .stat-label { font-size: 14px; font-weight: 700; }
  .stat-tip { position: relative; cursor: help; }
  .stat-tip-box {
    display: none;
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    background: #0f172a;
    color: #e2e8f0;
    font-size: 9px;
    font-weight: 600;
    padding: 6px 10px;
    border-radius: 8px;
    white-space: nowrap;
    border: 1px solid #334155;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    z-index: 20;
    pointer-events: none;
    letter-spacing: 0;
    text-transform: none;
  }
  .stat-tip-box::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-top-color: #334155;
  }
  .stat-tip:hover .stat-tip-box { display: block; }
  @media (max-width: 768px) {
    .stat-tip-box { display: none !important; }
  }

  /* Chart controls */
  .chart-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .control-group {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .control-label {
    font-size: 8px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #64748b;
    margin-right: 0.2rem;
  }
  .mode-btns {
    display: flex;
    gap: 2px;
    background: rgba(15, 23, 42, 0.5);
    border-radius: 6px;
    padding: 2px;
  }
  .mode-btn {
    font-size: 8px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: #64748b;
    cursor: pointer;
    transition: all 0.15s;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .mode-btn:hover { color: #e2e8f0; }
  .mode-btn-active { background: #1e293b; color: #38bdf8; }
  .series-group { flex-wrap: wrap; }
  .series-btn {
    font-size: 8px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--series-color);
    background: color-mix(in srgb, var(--series-color) 20%, transparent);
    color: var(--series-color);
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .series-btn:hover { background: color-mix(in srgb, var(--series-color) 35%, transparent); }
  .series-btn-off {
    opacity: 0.3;
    border-color: #475569;
    background: transparent;
    color: #64748b;
  }

  .chart-wrapper { position: relative; width: 100%; }
  .chart-area { width: 100%; height: 220px; }
  .dess-overlay {
    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(15, 23, 42, 0.92);
    backdrop-filter: blur(8px);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }
  .dess-overlay-content {
    text-align: center;
    padding: 2rem;
    max-width: 320px;
  }
  .dess-overlay-title {
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: #f87171;
    margin-bottom: 0.75rem;
  }
  .dess-overlay-text {
    font-size: 10px;
    font-weight: 600;
    color: #94a3b8;
    line-height: 1.5;
    margin-bottom: 1rem;
  }
  .dess-overlay-hint {
    font-size: 8px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  @media (max-width: 768px) {
    .section-card { background: #2a2d35; backdrop-filter: none; border: none; border-radius: 24px; box-shadow: 14px 14px 42px #1a1d22, -14px -14px 42px #3d414b; }
    .section-header { background: transparent; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .date-nav { background: #2a2d35; border: none; box-shadow: 8px 8px 24px #1a1d22, -8px -8px 24px #3d414b; margin-bottom: 12px; }
    .mode-btns { background: #2a2d35; }
    .mode-btn-active { background: #2a2d35; color: #38bdf8; box-shadow: inset 4px 4px 12px #1a1d22, inset -4px -4px 12px #3d414b; }
    .series-btn { border: none; background: #2a2d35; box-shadow: 4px 4px 12px #1a1d22, -4px -4px 12px #3d414b; }
    .series-btn-off { opacity: 0.35; box-shadow: none; }
  }
</style>
