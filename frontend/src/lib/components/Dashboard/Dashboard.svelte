<script lang="ts">
  import { dashboardData, weatherNode, automationState, dashboardWidgets, saveDashboardWidgets } from '../../stores/appStore'
  import { get } from 'svelte/store'
  import DailyChart from './DailyChart.svelte'
  import ForecastCards from './ForecastCards.svelte'
  import StatusBar from './StatusBar.svelte'
  import SystemDetails from './SystemDetails.svelte'

  // Widget edit mode
  let editMode = $state(false)
  let showModal = $state(false)
  let editingWidgetIndex = $state<number | null>(null)

  // Modal form state
  let modalTitle = $state('')
  let modalSource = $state('')
  let modalTuyaDevice = $state('')
  let modalTuyaDps = $state('')
  let modalInverterParam = $state('battery_voltage')
  let modalWeatherParam = $state('temp')
  let modalUnit = $state('°C')
  let modalColor = $state('text-teal-500')
  let modalSubParam = $state('')
  let modalSubUnit = $state('')
  let modalTuyaDpsDivisor = $state(1)
  let modalSubDivisor = $state(1)

  let tuyaDpsOptions = $state<{key: string, label: string, value: any}[]>([])

  const PRESET_UNITS = ['W', 'kW', 'V', 'A', '°C', '%', 'Hz', 'kWh', 'hPa', 'mm', 'm/s']
  const PRESET_COLORS = [
    { value: 'text-teal-500', label: 'Teal', hex: '#14b8a6' },
    { value: 'text-blue-500', label: 'Blue', hex: '#3b82f6' },
    { value: 'text-orange-500', label: 'Orange', hex: '#f97316' },
    { value: 'text-purple-500', label: 'Purple', hex: '#a855f7' },
    { value: 'text-red-500', label: 'Red', hex: '#ef4444' },
    { value: 'text-green-500', label: 'Green', hex: '#22c55e' },
    { value: 'text-yellow-500', label: 'Yellow', hex: '#eab308' },
    { value: 'text-cyan-500', label: 'Cyan', hex: '#06b6d4' },
  ]

  function toggleEditMode() {
    editMode = !editMode
  }

  function openAddModal() {
    editingWidgetIndex = null
    showModal = true
    resetModal()
  }

  function openEditModal(index: number) {
    editingWidgetIndex = index
    const w = $dashboardWidgets[index]
    if (!w) return
    showModal = true
    modalTitle = w.title || ''
    modalSource = w.sourceType || ''
    modalUnit = w.unit || ''
    modalColor = w.color || 'text-teal-500'
    modalSubParam = w.subParam || ''
    modalSubUnit = w.subUnit || ''
    modalTuyaDpsDivisor = w.dpsDivisor || 1
    modalSubDivisor = w.subDivisor || 1

    if (w.sourceType === 'tuya') {
      modalTuyaDevice = w.deviceId || ''
      modalTuyaDps = w.dpsKey || ''
      onTuyaDeviceChange()
    } else if (w.sourceType === 'inverter') {
      modalInverterParam = w.inverterParam || 'battery_voltage'
    } else if (w.sourceType === 'weather') {
      modalWeatherParam = w.dpsKey || 'temp'
    }
  }

  function resetModal() {
    modalTitle = ''
    modalSource = ''
    modalUnit = '°C'
    modalColor = 'text-teal-500'
    modalTuyaDevice = ''
    modalTuyaDps = ''
    modalInverterParam = 'battery_voltage'
    modalWeatherParam = 'temp'
    modalSubParam = ''
    modalSubUnit = ''
    modalTuyaDpsDivisor = 1
    modalSubDivisor = 1
    tuyaDpsOptions = []
  }

  function closeModal() {
    showModal = false
    editingWidgetIndex = null
  }

  function onSourceChange() {
    modalTuyaDevice = ''
    modalTuyaDps = ''
    tuyaDpsOptions = []
    // Auto-set unit defaults
    if (modalSource.startsWith('preset-')) {
      if (modalSource === 'preset-battery') {
        modalUnit = '%'
        modalColor = 'text-teal-500'
      } else if (modalSource === 'preset-battery-runtime') {
        modalUnit = 'h'
        modalColor = 'text-cyan-500'
      } else if (modalSource === 'preset-load') {
        modalUnit = 'W'
        modalColor = 'text-blue-500'
      } else if (modalSource === 'preset-pv') {
        modalUnit = 'W'
        modalColor = 'text-orange-500'
      } else {
        modalUnit = 'W'
        modalColor = 'text-purple-500'
      }
    }
  }

  function getTuyaDevices() {
    const state = get(automationState)
    if (!state?.tuya_devices) return []
    return Object.values(state.tuya_devices)
  }

  function onTuyaDeviceChange() {
    modalTuyaDps = ''
    tuyaDpsOptions = []
    if (!modalTuyaDevice) return

    const state = get(automationState)
    if (!state) return

    let dps: any = {}
    let translated: any = {}

    // Try node data first
    const node = Object.values(state.nodes || {}).find(
      (n: any) => n.type === 'tuya' && (n.config?.device_id === modalTuyaDevice || n.id === modalTuyaDevice)
    )
    if (node && node.data) {
      dps = node.data.dps || {}
      translated = node.data.dps_translated || {}
    }

    // Fallback to tuya_devices.last_dps
    if (Object.keys(dps).length === 0) {
      const dev = state.tuya_devices?.[modalTuyaDevice]
      if (dev?.last_dps) {
        dps = dev.last_dps
        translated = dev.last_dps_translated || {}
      }
    }

    if (Object.keys(dps).length === 0) return

    tuyaDpsOptions = Object.keys(dps).map(key => ({
      key,
      label: translated[key] || key,
      value: dps[key]
    }))
  }

  // ===================== VALUE RESOLUTION =====================

  function getPresetValues(widget: any) {
    const d = $dashboardData
    if (!d) return { main: '--', sub: null, pct: 0 }

    switch (widget.sourceType) {
      case 'preset-battery': {
        const soc = d.battery?.soc ?? 0
        const remaining = d.battery?.kwh ?? '--'
        const total = d.battery?.kwhTotal ?? '--'
        return {
          main: String(soc),
          sub: `${remaining} / ${total} kWh`,
          pct: soc,
          bottom: `${Math.abs(d.battery?.powerW ?? 0)}`,
          bottomUnit: 'W',
          bottomLabel: d.battery?.status ?? 'IDLE'
        }
      }
      case 'preset-load': {
        const w = d.load?.powerW ?? 0
        const pct = d.load?.pct ?? 0
        return { main: String(w), sub: `${pct}%`, pct: pct }
      }
      case 'preset-pv': {
        return { main: String(d.pv?.powerW ?? 0), sub: `${d.pv?.voltage ?? 0}V`, pct: Math.min(100, (d.pv?.powerW ?? 0) / 5000 * 100) }
      }
      case 'preset-grid': {
        return { main: String(d.grid?.powerW ?? 0), sub: `${d.grid?.voltage ?? 0}V`, pct: Math.min(100, Math.abs(d.grid?.powerW ?? 0) / 6000 * 100) }
      }
      case 'preset-battery-runtime': {
        const runtime = d.batteryRuntime ?? {}
        const pred = d.predictor ?? {}
        return {
          main: runtime.avgRuntimeText || pred.hoursLeft || '--',
          sub: `średnio | deficyt: ${pred.deficitKwh ?? '--'} kWh`,
          pct: 100,
          bottom: `${runtime.currentSoc ?? 0}% (${runtime.currentKwh ?? 0} kWh)`,
          bottomUnit: '',
          bottomLabel: `Cel: ${pred.targetSoc ?? '--'}% | ${pred.nextCheapWindowInfo ?? '--'}`
        }
      }
      default:
        return { main: '--', sub: null, pct: 0 }
    }
  }

  function getCustomValue(widget: any): { main: string | null, sub: string | null } {
    if (!widget) return { main: null, sub: null }
    const d = $dashboardData
    const as = get(automationState)
    if (!d || !as) return { main: null, sub: null }

    const flow = d._raw?.webQueryDeviceEnergyFlowEs || {}
    const pars = d._raw?.querySPDeviceLastData?.pars || {}
    const getVal = (arr: any[], par: string) => arr?.find((i: any) => i.par === par)?.val
    const toW = (v: string) => Math.round(parseFloat(v) * 1000)
    const pW = (v: string) => Math.round(parseFloat(v))

    if (widget.sourceType === 'tuya') {
      const node = Object.values(as.nodes || {}).find(
        (n: any) => n.type === 'tuya' && (n.config?.device_id === widget.deviceId || n.id === widget.deviceId)
      )
      let dps: any = {}
      let dpsT: any = {}
      if (node && node.data) {
        dps = node.data.dps || {}
        dpsT = node.data.dps_translated || {}
      } else if (widget.deviceId && as.tuya_devices?.[widget.deviceId]) {
        const dev = as.tuya_devices[widget.deviceId]
        dps = dev.last_dps || {}
        dpsT = dev.last_dps_translated || {}
      }
      const key = widget.dpsKey
      if (!key) return { main: null, sub: null }
      let val = dps[key]
      if (val === undefined) val = dpsT[key]
      if (val === undefined) return { main: null, sub: null }
      let main: string
      if (typeof val === 'number') {
        const divisor = widget.dpsDivisor || 1
        const scaled = divisor > 1 ? val / divisor : val
        main = String(Math.round(scaled * 10) / 10)
      } else {
        main = String(val)
      }
      // Sub value from subParam if specified
      let sub: string | null = null
      if (widget.subParam && dps[widget.subParam] !== undefined) {
        const sVal = dps[widget.subParam]
        if (typeof sVal === 'number') {
          const sDivisor = widget.subDivisor || 1
          const sScaled = sDivisor > 1 ? sVal / sDivisor : sVal
          sub = String(Math.round(sScaled * 10) / 10)
        } else {
          sub = String(sVal)
        }
        if (widget.subUnit) sub += ' ' + widget.subUnit
      }
      return { main, sub }
    }

    if (widget.sourceType === 'inverter') {
      const param = widget.inverterParam
      if (!param) return { main: null, sub: null }
      const map: Record<string, () => string | null> = {
        'battery_voltage': () => getVal(pars.bt_ || [], 'Battery Voltage') || null,
        'pv_voltage': () => getVal(pars.pv_ || [], 'PV Voltage') || null,
        'grid_voltage': () => getVal(pars.gd_ || [], 'Grid Voltage') || null,
        'output_voltage': () => getVal(pars.bc_ || [], 'Output Voltage') || null,
        'dc_temperature': () => {
          const v = getVal(pars.sy_ || [], 'DC Module Termperature')
          return v ? String(Math.round(parseFloat(v))) : null
        },
        'pv_power': () => {
          const v = pW(getVal(pars.pv_ || [], 'PV Power')) || toW(getVal(flow.pv_status || [], 'pv_output_power'))
          return v ? String(v) : null
        },
        'load_power': () => {
          const v = pW(getVal(pars.bc_ || [], 'Output Active Power')) || toW(getVal(flow.bc_status || [], 'load_active_power'))
          return v ? String(v) : null
        },
        'grid_power': () => {
          const v = toW(getVal(flow.gd_status || [], 'grid_active_power'))
          return v ? String(v) : null
        },
        'battery_power': () => {
          const v = Math.abs(toW(getVal(flow.bt_status || [], 'battery_active_power')))
          return v ? String(v) : null
        },
      }
      const fn = map[param]
      if (fn) {
        const r = fn()
        return { main: r || null, sub: null }
      }
      return { main: null, sub: null }
    }

    if (widget.sourceType === 'weather') {
      const wn = Object.values(as.nodes || {}).find((n: any) => n.type === 'weather')
      if (!wn || !wn.data) return { main: null, sub: null }
      const wd = wn.data as any
      const param = widget.dpsKey || widget.inverterParam
      if (param === 'temp') return { main: wd.temp !== undefined ? String(Math.round(wd.temp)) : null, sub: null }
      if (param === 'humidity') return { main: wd.humidity !== undefined ? String(wd.humidity) : null, sub: null }
      if (param === 'wind_speed') return { main: wd.wind_speed !== undefined ? String(wd.wind_speed) : null, sub: null }
      return { main: null, sub: null }
    }

    return { main: null, sub: null }
  }

  // ===================== SAVE / DELETE =====================

  function buildWidget(): any {
    const widget: any = {
      id: editingWidgetIndex !== null ? $dashboardWidgets[editingWidgetIndex]?.id : ('widget-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5)),
      title: modalTitle.trim(),
      sourceType: modalSource,
      unit: modalUnit,
      color: modalColor,
      subParam: modalSubParam || undefined,
      subUnit: modalSubUnit || undefined,
      dpsDivisor: modalTuyaDpsDivisor > 1 ? modalTuyaDpsDivisor : undefined,
      subDivisor: modalSubDivisor > 1 ? modalSubDivisor : undefined,
    }

    if (modalSource === 'tuya') {
      widget.deviceId = modalTuyaDevice
      widget.dpsKey = modalTuyaDps
      const dev = $automationState?.tuya_devices?.[modalTuyaDevice]
      if (dev) {
        if (dev.category === 'wsdcg' || modalTuyaDps?.match?.(/temp|temperature/i)) {
          widget.color = 'text-orange-500'
        } else if (dev.category === 'dlq') {
          widget.color = 'text-yellow-500'
        } else if (dev.category === 'pir') {
          widget.color = 'text-purple-500'
        }
      }
    } else if (modalSource === 'inverter') {
      widget.inverterParam = modalInverterParam
      const icons: Record<string, {icon: string, color: string}> = {
        'battery_voltage': { icon: 'fa-car-battery', color: 'text-emerald-500' },
        'pv_voltage': { icon: 'fa-solar-panel', color: 'text-orange-500' },
        'grid_voltage': { icon: 'fa-plug', color: 'text-purple-500' },
        'output_voltage': { icon: 'fa-bolt', color: 'text-blue-500' },
        'dc_temperature': { icon: 'fa-temperature-high', color: 'text-red-500' },
        'pv_power': { icon: 'fa-solar-panel', color: 'text-orange-500' },
        'load_power': { icon: 'fa-house', color: 'text-blue-500' },
        'grid_power': { icon: 'fa-plug', color: 'text-purple-500' },
        'battery_power': { icon: 'fa-battery-full', color: 'text-teal-500' },
      }
      const p = icons[modalInverterParam]
      if (p) widget.color = p.color
    } else if (modalSource === 'weather') {
      widget.dpsKey = modalWeatherParam
      widget.inverterParam = modalWeatherParam
      const icons: Record<string, {icon: string, color: string}> = {
        'temp': { icon: 'fa-temperature-high', color: 'text-orange-500' },
        'humidity': { icon: 'fa-droplet', color: 'text-blue-500' },
        'wind_speed': { icon: 'fa-wind', color: 'text-cyan-500' },
      }
      const w = icons[modalWeatherParam]
      if (w) widget.color = w.color
    }

    return widget
  }

  async function saveWidget() {
    if (!modalTitle.trim() || !modalSource) {
      alert('Wypełnij tytuł i wybierz źródło danych.')
      return
    }
    if (modalSource === 'tuya' && (!modalTuyaDevice || !modalTuyaDps)) {
      alert('Wybierz urządzenie i parametr.')
      return
    }

    const widget = buildWidget()
    let newWidgets: any[]
    if (editingWidgetIndex !== null) {
      newWidgets = $dashboardWidgets.map((w, i) => i === editingWidgetIndex ? widget : w)
    } else {
      newWidgets = [...$dashboardWidgets, widget]
    }
    await saveDashboardWidgets(newWidgets)
    closeModal()
  }

  async function deleteWidget(index: number) {
    if (!confirm('Usunąć ten widget?')) return
    const newWidgets = $dashboardWidgets.filter((_, i) => i !== index)
    await saveDashboardWidgets(newWidgets)
  }

  async function moveUp(index: number) {
    if (index <= 0) return
    const widgets = [...$dashboardWidgets]
    ;[widgets[index - 1], widgets[index]] = [widgets[index], widgets[index - 1]]
    await saveDashboardWidgets(widgets)
  }

  async function moveDown(index: number) {
    if (index >= $dashboardWidgets.length - 1) return
    const widgets = [...$dashboardWidgets]
    ;[widgets[index], widgets[index + 1]] = [widgets[index + 1], widgets[index]]
    await saveDashboardWidgets(widgets)
  }

  function getCircumference() {
    return 276.5
  }

  function getOffset(pct: number) {
    return 276.5 - (pct / 100) * 276.5
  }
</script>

<!-- Edit button -->
<div class="flex justify-end mb-4">
  <button onclick={toggleEditMode} class="edit-btn" class:active={editMode}>
    <i class="fa-solid {editMode ? 'fa-check' : 'fa-pen-to-square'}"></i>
    {editMode ? 'Gotowe' : 'Edytuj widgety'}
  </button>
</div>

<!-- Widgets grid -->
<div class="dashboard-grid" class:edit-mode={editMode}>
  {#each $dashboardWidgets as widget, i (widget.id)}
    {@const isPreset = widget.sourceType?.startsWith('preset-')}
    {@const vals = isPreset ? getPresetValues(widget) : { ...getCustomValue(widget), pct: 0 }}
    {@const mainVal = isPreset ? vals.main : (vals.main ?? '--')}
    {@const subVal = isPreset ? vals.sub : (vals.sub ?? null)}
    {@const pct = isPreset ? vals.pct : 0}

    {#if isPreset}
      <!-- PRESET WIDGET (looks exactly like before) -->
      {#if widget.sourceType === 'preset-battery'}
        <div class="gauge-card" class:edit-active={editMode} onclick={() => editMode && openEditModal(i)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && editMode && openEditModal(i)}>
          {#if editMode}
            <div class="order-controls">
              <button class="order-btn" onclick={(e) => { e.stopPropagation(); moveUp(i) }} disabled={i === 0} title="W górę"><i class="fa-solid fa-chevron-up"></i></button>
              <button class="order-btn" onclick={(e) => { e.stopPropagation(); moveDown(i) }} disabled={i === $dashboardWidgets.length - 1} title="W dół"><i class="fa-solid fa-chevron-down"></i></button>
            </div>
            <button class="widget-delete" onclick={(e) => { e.stopPropagation(); deleteWidget(i) }} title="Usuń"><i class="fa-solid fa-times"></i></button>
            <div class="edit-badge">EDYTUJ</div>
          {/if}
          <h3 class="gauge-label">{widget.title || 'Stan Baterii'}</h3>
          <div class="relative w-44 h-44 mb-6 max-md:w-36 max-md:h-36">
            <svg class="w-full h-full circle-progress" viewBox="0 0 100 100">
              <circle class="text-slate-900 stroke-current" stroke-width="5" cx="50" cy="50" r="44" fill="transparent"></circle>
              <circle class="text-teal-500 stroke-current progress-ring__circle" stroke-width="6" stroke-linecap="round" cx="50" cy="50" r="44" fill="transparent" stroke-dasharray="276.5" stroke-dashoffset={getOffset(pct)}></circle>
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <div><span class="text-6xl font-bold lcd-text">{mainVal}</span><span class="unit-text">{widget.unit || '%'}</span></div>
              {#if subVal}<div class="text-[11px] text-slate-500 font-mono mt-1 max-md:text-slate-400">{subVal}</div>{/if}
            </div>
          </div>
          {#if vals.bottom}
            <div class="flex items-center gap-2">
              <span class="text-xl">🔋</span>
              <span class="text-2xl font-bold lcd-text">{vals.bottom}</span><span class="unit-text">{vals.bottomUnit || 'W'}</span>
            </div>
            <div class="text-[9px] text-slate-500 mt-2 font-bold uppercase tracking-widest">{vals.bottomLabel || 'IDLE'}</div>
            {#if vals.bottomLabel && vals.bottomLabel.includes('ŁADOWANIE')}
              <div class="text-[9px] text-slate-500 mt-1 font-bold uppercase tracking-widest">
                ŹRÓDŁO: {$dashboardData?.battery?.chargeSource || 'BATERIA'}
              </div>
            {/if}
            <div class="mt-3 pt-3 border-t border-slate-800 w-full text-center">
              <div class="flex items-center justify-center gap-2">
                <span class="text-lg font-bold lcd-text">{$dashboardData?.battery?.netW ?? 0}</span><span class="unit-text text-[10px]">W</span>
                <span class="text-[8px] font-black uppercase tracking-widest text-slate-500">BILANS</span>
              </div>
              <div class="w-full h-0.5 bg-black/40 rounded-full mt-2 overflow-hidden">
                <div class="h-full bg-teal-500 transition-all duration-1000" style="width:{$dashboardData?.battery?.netFill ?? 50}%"></div>
              </div>
            </div>
          {/if}
        </div>
      {:else if widget.sourceType === 'preset-battery-runtime'}
        <div class="gauge-card" class:edit-active={editMode} onclick={() => editMode && openEditModal(i)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && editMode && openEditModal(i)}>
          {#if editMode}
            <div class="order-controls">
              <button class="order-btn" onclick={(e) => { e.stopPropagation(); moveUp(i) }} disabled={i === 0} title="W górę"><i class="fa-solid fa-chevron-up"></i></button>
              <button class="order-btn" onclick={(e) => { e.stopPropagation(); moveDown(i) }} disabled={i === $dashboardWidgets.length - 1} title="W dół"><i class="fa-solid fa-chevron-down"></i></button>
            </div>
            <button class="widget-delete" onclick={(e) => { e.stopPropagation(); deleteWidget(i) }} title="Usuń"><i class="fa-solid fa-times"></i></button>
            <div class="edit-badge">EDYTUJ</div>
          {/if}
          <h3 class="gauge-label">{widget.title || 'Czas pracy'}</h3>
          <div class="flex flex-col items-center justify-center py-4">
            <div class="text-center mb-4">
              <span class="text-4xl font-bold lcd-text text-cyan-400">{vals.main}</span>
              <span class="unit-text text-cyan-400">h</span>
            </div>
            <div class="text-[11px] text-slate-400 font-mono text-center px-2">
              {vals.sub}
            </div>
          </div>
          {#if vals.bottom}
            <div class="w-full pt-3 border-t border-slate-800 mt-3">
              <div class="text-[11px] text-slate-500 text-center">{vals.bottom}</div>
              {#if vals.bottomLabel}
                <div class="text-[9px] text-slate-600 mt-1 text-center">{vals.bottomLabel}</div>
              {/if}
            </div>
          {/if}
        </div>
      {:else}
        <div class="gauge-card" class:edit-active={editMode} onclick={() => editMode && openEditModal(i)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && editMode && openEditModal(i)}>
          {#if editMode}
            <div class="order-controls">
              <button class="order-btn" onclick={(e) => { e.stopPropagation(); moveUp(i) }} disabled={i === 0} title="W górę"><i class="fa-solid fa-chevron-up"></i></button>
              <button class="order-btn" onclick={(e) => { e.stopPropagation(); moveDown(i) }} disabled={i === $dashboardWidgets.length - 1} title="W dół"><i class="fa-solid fa-chevron-down"></i></button>
            </div>
            <button class="widget-delete" onclick={(e) => { e.stopPropagation(); deleteWidget(i) }} title="Usuń"><i class="fa-solid fa-times"></i></button>
            <div class="edit-badge">EDYTUJ</div>
          {/if}
          <h3 class="gauge-label">{widget.title}</h3>
          <div class="relative w-44 h-44 mb-6 max-md:w-36 max-md:h-36">
            <svg class="w-full h-full circle-progress" viewBox="0 0 100 100">
              <circle class="text-slate-900 stroke-current" stroke-width="5" cx="50" cy="50" r="44" fill="transparent"></circle>
              <circle class="{widget.color || 'text-teal-500'} stroke-current progress-ring__circle" stroke-width="6" stroke-linecap="round" cx="50" cy="50" r="44" fill="transparent" stroke-dasharray="276.5" stroke-dashoffset={getOffset(pct)}></circle>
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <div><span class="text-5xl font-bold lcd-text">{mainVal}</span><span class="unit-text">{widget.unit || ''}</span></div>
            </div>
          </div>
          {#if subVal}
            <div class="flex items-center gap-2"><span class="text-xl font-bold lcd-text">{subVal}</span></div>
          {/if}
        </div>
      {/if}
    {:else}
      <!-- CUSTOM WIDGET (same look, configurable) -->
      <div class="gauge-card" class:edit-active={editMode} onclick={() => editMode && openEditModal(i)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && editMode && openEditModal(i)}>
        {#if editMode}
          <div class="order-controls">
            <button class="order-btn" onclick={(e) => { e.stopPropagation(); moveUp(i) }} disabled={i === 0} title="W górę"><i class="fa-solid fa-chevron-up"></i></button>
            <button class="order-btn" onclick={(e) => { e.stopPropagation(); moveDown(i) }} disabled={i === $dashboardWidgets.length - 1} title="W dół"><i class="fa-solid fa-chevron-down"></i></button>
          </div>
          <button class="widget-delete" onclick={(e) => { e.stopPropagation(); deleteWidget(i) }} title="Usuń"><i class="fa-solid fa-times"></i></button>
          <div class="edit-badge">EDYTUJ</div>
        {/if}
        <h3 class="gauge-label">{widget.title}</h3>
        <div class="relative w-44 h-44 mb-6 max-md:w-36 max-md:h-36">
          <svg class="w-full h-full circle-progress" viewBox="0 0 100 100">
            <circle class="text-slate-900 stroke-current" stroke-width="5" cx="50" cy="50" r="44" fill="transparent"></circle>
            <circle class="{widget.color || 'text-teal-500'} stroke-current progress-ring__circle" stroke-width="6" stroke-linecap="round" cx="50" cy="50" r="44" fill="transparent" stroke-dasharray="276.5" stroke-dashoffset="276.5"></circle>
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <div><span class="text-5xl font-bold lcd-text">{mainVal}</span><span class="unit-text">{widget.unit || ''}</span></div>
          </div>
        </div>
        {#if subVal}
          <div class="flex items-center gap-2"><span class="text-xl font-bold lcd-text">{subVal}</span></div>
        {/if}
      </div>
    {/if}
  {/each}

  {#if editMode}
    <button class="gauge-card add-widget-card" onclick={openAddModal}>
      <i class="fa-solid fa-plus text-4xl text-teal-500/50 mb-3"></i>
      <span class="text-[10px] font-black uppercase tracking-widest text-teal-500/70">Dodaj widget</span>
    </button>
  {/if}
</div>

<!-- Add/Edit Widget Modal -->
{#if showModal}
  <div class="modal-overlay" role="button" tabindex="0" onclick={(e) => e.target === e.currentTarget && closeModal()} onkeydown={(e) => e.key === 'Escape' && closeModal()}>
    <div class="modal-panel">
      <h3 class="text-xs font-black uppercase tracking-widest text-teal-400 text-center mb-4">{editingWidgetIndex !== null ? 'Edytuj widget' : 'Dodaj własny widget'}</h3>

      <div class="form-group">
        <label for="w-title">Tytuł</label>
        <input id="w-title" type="text" bind:value={modalTitle} placeholder="np. Temperatura wody CWU" />
      </div>

      <div class="form-group">
        <label for="w-source">Źródło danych</label>
        <select id="w-source" bind:value={modalSource} onchange={onSourceChange}>
          <option value="">-- wybierz --</option>
          <option value="preset-battery">🔋 Stan Baterii</option>
          <option value="preset-battery-runtime">⏱️ Czas pracy na baterii</option>
          <option value="preset-load">🏠 Pobór Domu</option>
          <option value="preset-pv">☀️ Panele PV</option>
          <option value="preset-grid">🔌 Sieć AC</option>
          <option value="tuya">🔧 Własny: Urządzenie Tuya</option>
          <option value="inverter">🔧 Własny: Inwerter / DESS</option>
          <option value="weather">🔧 Własny: Pogoda</option>
        </select>
      </div>

      {#if modalSource === 'tuya'}
        <div class="form-group">
          <label for="w-tuya-dev">Urządzenie</label>
          <select id="w-tuya-dev" bind:value={modalTuyaDevice} onchange={onTuyaDeviceChange}>
            <option value="">-- wybierz --</option>
            {#each getTuyaDevices() as dev}
              <option value={dev.internal_app_id}>{dev.name}</option>
            {/each}
          </select>
        </div>
        <div class="form-group">
          <label for="w-tuya-dps">Parametr (DPS)</label>
          <select id="w-tuya-dps" bind:value={modalTuyaDps}>
            <option value="">-- wybierz --</option>
            {#each tuyaDpsOptions as opt}
              <option value={opt.key}>{opt.label} ({opt.key}) = {typeof opt.value === 'number' ? Math.round(opt.value * 10) / 10 : opt.value}</option>
            {/each}
          </select>
        </div>
        <div class="form-group">
          <label for="w-dps-divisor">Dzielnik (np. 10 dla 186→18.6)</label>
          <input type="number" id="w-dps-divisor" bind:value={modalTuyaDpsDivisor} min="1" step="1" />
        </div>
        <div class="form-group">
          <label for="w-sub-param">Pod-parametr (opcjonalnie)</label>
          <select id="w-sub-param" bind:value={modalSubParam}>
            <option value="">-- brak --</option>
            {#each tuyaDpsOptions as opt}
              <option value={opt.key}>{opt.label} ({opt.key})</option>
            {/each}
          </select>
        </div>
        {#if modalSubParam}
          <div class="form-group">
            <label for="w-sub-unit">Jednostka pod-parametru</label>
            <select id="w-sub-unit" bind:value={modalSubUnit}>
              {#each PRESET_UNITS as u}
                <option value={u}>{u}</option>
              {/each}
            </select>
          </div>
          <div class="form-group">
            <label for="w-sub-divisor">Dzielnik pod-parametru</label>
            <input type="number" id="w-sub-divisor" bind:value={modalSubDivisor} min="1" step="1" />
          </div>
        {/if}
      {/if}

      {#if modalSource === 'inverter'}
        <div class="form-group">
          <label for="w-inv-param">Parametr inwertera</label>
          <select id="w-inv-param" bind:value={modalInverterParam}>
            <option value="battery_voltage">Napięcie baterii</option>
            <option value="pv_voltage">Napięcie PV</option>
            <option value="grid_voltage">Napięcie sieci</option>
            <option value="output_voltage">Napięcie wyjścia</option>
            <option value="dc_temperature">Temperatura DC</option>
            <option value="pv_power">Moc PV</option>
            <option value="load_power">Moc obciążenia</option>
            <option value="grid_power">Moc sieci</option>
            <option value="battery_power">Moc baterii</option>
          </select>
        </div>
      {/if}

      {#if modalSource === 'weather'}
        <div class="form-group">
          <label for="w-w-param">Parametr pogodowy</label>
          <select id="w-w-param" bind:value={modalWeatherParam}>
            <option value="temp">Temperatura</option>
            <option value="humidity">Wilgotność</option>
            <option value="wind_speed">Wiatr</option>
          </select>
        </div>
      {/if}

      {#if !modalSource.startsWith('preset-')}
        <div class="form-row">
          <div class="form-group flex-1">
            <label for="w-unit">Jednostka</label>
            <select id="w-unit" bind:value={modalUnit}>
              {#each PRESET_UNITS as u}
                <option value={u}>{u}</option>
              {/each}
            </select>
          </div>
          <div class="form-group flex-1">
            <label for="w-color">Kolor</label>
            <select id="w-color" bind:value={modalColor}>
              {#each PRESET_COLORS as c}
                <option value={c.value}>{c.label}</option>
              {/each}
            </select>
          </div>
        </div>
      {/if}

      <div class="flex gap-3 mt-2">
        <button class="btn-cancel flex-1" onclick={closeModal}>Anuluj</button>
        <button class="btn-save flex-1" onclick={saveWidget}>{editingWidgetIndex !== null ? 'Zapisz zmiany' : 'Dodaj widget'}</button>
      </div>
    </div>
  </div>
{/if}

<DailyChart />
<ForecastCards />
<StatusBar />
<SystemDetails />

<style>
  .dashboard-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.92rem;
    margin-bottom: 1.5rem;
  }

  .gauge-card {
    background: rgba(30, 41, 59, 0.7);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-radius: 24px;
    padding: 2rem;
    border: 1px solid rgba(51, 65, 85, 1);
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
    flex: 1 1 calc(20% - 12px);
    max-width: calc(20% - 12px);
    min-width: 180px;
    position: relative;
    cursor: default;
    transition: border-color 0.2s, transform 0.1s;
  }
  .gauge-card:hover {
    border-color: rgba(45, 212, 191, 0.3);
  }
  .edit-mode .gauge-card.edit-active {
    border-color: rgba(234, 179, 8, 0.5);
    box-shadow: 0 0 12px rgba(234, 179, 8, 0.1);
    cursor: pointer;
  }
  .edit-mode .gauge-card.edit-active:hover {
    border-color: rgba(234, 179, 8, 0.8);
    transform: scale(1.01);
  }
  .edit-mode .gauge-card.edit-active::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px dashed rgba(234, 179, 8, 0.3);
    border-radius: inherit;
    pointer-events: none;
  }

  .gauge-label {
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.3em;
    color: #94a3b8;
    margin-bottom: 1.5rem;
    text-align: center;
  }

  .widget-delete {
    position: absolute;
    top: -10px;
    right: -10px;
    width: 24px;
    height: 24px;
    background: #ef4444;
    color: white;
    border: 2px solid rgba(0,0,0,0.3);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    cursor: pointer;
    z-index: 20;
    opacity: 0;
    transform: scale(0.8);
    transition: all 0.2s ease;
  }
  .gauge-card:hover .widget-delete {
    opacity: 1;
    transform: scale(1);
  }

  .order-controls {
    position: absolute;
    top: -10px;
    left: -10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 20;
    opacity: 0;
    transform: scale(0.8);
    transition: all 0.2s ease;
  }
  .gauge-card:hover .order-controls {
    opacity: 1;
    transform: scale(1);
  }
  .order-btn {
    width: 22px;
    height: 22px;
    background: #334155;
    color: #e2e8f0;
    border: 2px solid rgba(0,0,0,0.3);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    cursor: pointer;
    transition: all 0.15s ease;
    padding: 0;
  }
  .order-btn:hover:not(:disabled) {
    background: #475569;
    transform: scale(1.15);
  }
  .order-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .edit-badge {
    position: absolute;
    top: 8px;
    left: 8px;
    font-size: 8px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(234, 179, 8, 0.7);
    border: 1px solid rgba(234, 179, 8, 0.3);
    padding: 2px 6px;
    border-radius: 6px;
    pointer-events: none;
  }

  .add-widget-card {
    border: 2px dashed rgba(45, 212, 191, 0.3);
    background: rgba(45, 212, 191, 0.03);
    min-height: 260px;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .add-widget-card:hover {
    border-color: rgba(45, 212, 191, 0.6);
    background: rgba(45, 212, 191, 0.08);
  }

  .edit-btn {
    background: #1e293b;
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 12px;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border: 1px solid #334155;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .edit-btn:hover {
    background: #334155;
  }
  .edit-btn.active {
    background: #0d9488;
    border-color: #14b8a6;
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px);
  }
  .modal-panel {
    background: rgba(15, 23, 42, 0.95);
    border: 1px solid #334155;
    border-radius: 24px;
    padding: 1.5rem;
    width: 420px;
    max-width: 90vw;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
  }
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .form-group label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #64748b;
  }
  .form-group input,
  .form-group select {
    background: #0f172a;
    color: white;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 0.5rem 1rem;
    font-size: 14px;
    outline: none;
    width: 100%;
  }
  .form-group input:focus,
  .form-group select:focus {
    border-color: rgba(45, 212, 191, 0.5);
  }
  .form-row {
    display: flex;
    gap: 0.75rem;
  }
  .btn-cancel {
    background: #1e293b;
    color: #94a3b8;
    padding: 0.625rem;
    border-radius: 12px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-cancel:hover {
    background: #334155;
    color: white;
  }
  .btn-save {
    background: #0d9488;
    color: white;
    padding: 0.625rem;
    border-radius: 12px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-save:hover {
    background: #14b8a6;
  }

  .circle-progress {
    transform: rotate(-90deg);
    transform-origin: 50% 50%;
  }
  .progress-ring__circle {
    transition: stroke-dashoffset 1s ease-in-out;
  }

  @media (max-width: 1200px) {
    .gauge-card {
      flex: 1 1 calc(25% - 12px);
      max-width: calc(25% - 12px);
    }
  }

  @media (max-width: 992px) {
    .gauge-card {
      flex: 1 1 calc(33.333% - 10px);
      max-width: calc(33.333% - 10px);
    }
  }

  @media (max-width: 768px) {
    .dashboard-grid {
      gap: 8px;
    }
    .gauge-card {
      flex: 1 1 calc(50% - 6px);
      max-width: calc(50% - 6px);
      min-width: 140px;
      padding: 16px 12px;
      background: #ffffff;
      backdrop-filter: none;
      border: none;
      border-radius: 14px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
    }
    .gauge-label {
      color: #8e8e93;
      font-size: 11px;
      margin-bottom: 1rem;
    }
  }

  @media (max-width: 480px) {
    .gauge-card {
      flex: 1 1 calc(50% - 6px);
      max-width: calc(50% - 6px);
    }
  }
</style>
