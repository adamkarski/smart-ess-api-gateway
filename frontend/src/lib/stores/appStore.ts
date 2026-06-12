import { writable, derived } from 'svelte/store'
import { getToken } from './authStore'

// --- Tab management ---
export const activeTab = writable<string>('dashboard')

export function switchTab(tab: string) {
  activeTab.set(tab)
  window.location.hash = tab
  if (tab === 'flow' || tab === 'setup' || tab === 'devices') {
    fetchFullAutomation()
  }
}

// Listen for hash changes
if (typeof window !== 'undefined') {
  const validTabs = ['dashboard', 'flow', 'devices', 'setup', 'profile']
  const onHash = () => {
    const hash = window.location.hash.slice(1)
    if (validTabs.includes(hash)) activeTab.set(hash)
    else activeTab.set('dashboard')
  }
  window.addEventListener('hashchange', onHash)
  const hash = window.location.hash.slice(1)
  if (validTabs.includes(hash)) activeTab.set(hash)
}

// --- App data ---
export const appData = writable<any>(null)
export const automationState = writable<any>(null)
export const inverterData = writable<any>(null)
export const dailyStats = writable<any>(null)
export const settings = writable<any>(null)
export const dashboardWidgets = writable<any[]>([])

// Helper: find value in DESS status array by parameter name
function getVal(arr: any[] | undefined, par: string): string | undefined {
  return arr?.find((i: any) => i.par === par)?.val
}

function toWatts(v: string | undefined): number {
  if (v === undefined || v === null || v === '' || v === 'NaN') return 0
  const n = parseFloat(v)
  return Math.round(n * 1000)
}

function parseW(v: string | undefined): number {
  if (v === undefined || v === null || v === '') return 0
  return Math.round(parseFloat(v))
}

// Derived: transformed dashboard data from raw /data response
export const dashboardData = derived([appData, automationState], ([$d, $as]) => {
  if (!$d) return null
  const flow = $d.webQueryDeviceEnergyFlowEs || {}
  const pars = $d.querySPDeviceLastData?.pars || {}
  const formatted = $d.formattedData || {}
  const auto = $as?.settings?.solar || {} as any

  const pvRaw = parseW(getVal(pars.pv_, 'PV Power')) || toWatts(getVal(flow.pv_status, 'pv_output_power'))
  const loadRaw = parseW(getVal(pars.bc_, 'Output Active Power')) || toWatts(getVal(flow.bc_status, 'load_active_power'))
  const gridRaw = toWatts(getVal(flow.gd_status, 'grid_active_power'))
  const batPowerRaw = getVal(flow.bt_status, 'battery_active_power')
  let batWRaw = Math.abs(toWatts(batPowerRaw))

  // AC charging detection from raw params
  const acChargeCurrent = parseFloat(getVal(pars.gd_, 'AC charging current') || '0')
  const batChargeCurrent = parseFloat(formatted.battery_charging_current || '0')
  
  // If batWRaw is 0 but we have charging current, use it (P = U * I)
  if (batWRaw < 5 && batChargeCurrent > 0) {
    const batV = parseFloat(getVal(pars.bt_ || [], 'Battery Voltage') || '50')
    batWRaw = Math.round(batChargeCurrent * batV)
  }

  const bStatusEntry = (flow.bt_status || []).find((i: any) => i.par === 'battery_active_power')
  let isCharging = bStatusEntry ? bStatusEntry.status === 1 : (pvRaw > loadRaw + 20)
  
  // Fallback for AC charging
  if (!isCharging && (acChargeCurrent > 0 || batChargeCurrent > 0.5)) {
    isCharging = true
  }

  const isDischarging = bStatusEntry ? bStatusEntry.status === -1 : (loadRaw > pvRaw + 20 && gridRaw < 20)

  const soc = parseFloat(getVal(flow.bt_status, 'bt_battery_capacity') || formatted.battery_real_level || '0')
  const invKw = auto.inverterKw || 6.2
  const batKwh = auto.batteryKwh || 10
  const loadPct = Math.min(100, Math.round((loadRaw / (invKw * 1000)) * 100))
  const remainingKwh = ((soc / 100) * batKwh)
  const pvVoltage = getVal(pars.pv_, 'PV Voltage') || '0'
  const gridVoltage = getVal(pars.gd_, 'Grid Voltage') || '0'

  // Net balance
  const netW = pvRaw - loadRaw - gridRaw
  const netFill = 50 + Math.min(50, Math.max(-50, netW / 20))

  let batStatus = 'CZUWAJ / IDLE'
  if (isCharging && batWRaw > 5) batStatus = 'ŁADOWANIE ' + batWRaw + 'W'
  else if (isDischarging && batWRaw > 5) batStatus = 'ZASILANIE ' + batWRaw + 'W'

  // System status from sy_ pars
  const syPars = pars.sy_ || []
  const opMode = getVal(syPars, 'Operating mode') || '---'
  const tempDc = parseFloat(getVal(syPars, 'DC Module Termperature') || '0')
  const prioOut = getVal(syPars, 'Output priority') || '---'
  const prioChar = getVal(syPars, 'Charger Source Priority') || '---'

  // Voltages
  const batV = getVal(pars.bt_ || [], 'Battery Voltage') || '0.0'
  const loadV = getVal(pars.bc_ || [], 'Output Voltage') || '0.0'

  // Last sync from flow date
  const lastSync = flow.date || '--:--:--'

  // Battery runtime from the latest poll
  const runtime = $d.batteryRuntime || {
    avgRuntimeText: '--',
    instantRuntimeText: '--',
    currentSoc: Math.round(soc),
    currentKwh: parseFloat(remainingKwh.toFixed(2)),
    avgConsumptionW: 500
  }

  // Determine charging source
  let chargeSource = 'BATERIA'
  if (isCharging) {
    // If PV is producing power and there's enough to both charge battery AND meet load, it's solar
    if (pvRaw > loadRaw + 20 && pvRaw > batWRaw + 20) {
      chargeSource = 'PV'
    } else if (gridRaw < -20) { // Negative grid power means we're pulling from grid (not charging)
      chargeSource = 'TAURON'
    } else if (pvRaw > 0) {
      // PV is producing but not enough to cover everything
      chargeSource = 'PV + ZASILANIE'
    } else if (gridRaw > 20) { // Positive grid power means we're charging from grid
      chargeSource = 'TAURON'
    } else {
      chargeSource = 'PV' // Default to PV if unsure
    }
  }

  // Predictor nodes data
  const predictorNodes = Object.values($as?.nodes || {}).filter((n: any) => n.type === 'predictor')
  const predictorData = predictorNodes.length > 0 ? predictorNodes[0].data : {}

  return {
    battery: {
      soc: isNaN(soc) ? 0 : Math.round(soc),
      kwh: remainingKwh.toFixed(1),
      kwhTotal: batKwh.toFixed(1),
      powerW: batWRaw,
      status: batStatus,
      netW,
      netFill: Math.round(netFill),
      isCharging: isCharging && batWRaw > 5,
      isDischarging: isDischarging && batWRaw > 5,
      chargeSource: chargeSource,
      runtime: runtime,
    },
    load: {
      powerW: loadRaw,
      pct: loadPct,
    },
    pv: {
      powerW: pvRaw,
      voltage: pvVoltage,
    },
    grid: {
      powerW: gridRaw,
      voltage: gridVoltage,
    },
    status: {
      opMode: opMode.replace(/^\s+|\s+$/g, ''),
      tempDc: String(Math.round(tempDc)),
      prioOut: prioOut.replace(/^\s+|\s+$/g, ''),
      prioChar: prioChar.replace(/^\s+|\s+$/g, ''),
    },
    details: {
      batteryV: batV,
      gridV: gridVoltage,
      loadV: loadV,
      lastSync: lastSync,
    },
    batteryRuntime: runtime,
    predictor: predictorData
  }
})

// Derived: weather node from automation state
export const weatherNode = derived(automationState, ($as) => {
  if (!$as?.nodes) return null
  return Object.values($as.nodes as Record<string, any>).find((n: any) => n.type === 'weather')
})

// Global weather data for whole app (fallback when no weather node)
export const globalWeatherData = derived(automationState, ($as) => $as?.weatherData ?? null);
export const globalSolarForecast = derived(automationState, ($as) => $as?.solarForecast ?? null);

// Derived: forecast array from weather node
export const forecast = derived(weatherNode, ($wn) => {


  return $wn?.data?.forecast || []
})

// --- Polling ---
let pollInterval: ReturnType<typeof setInterval>
let fullStateInterval: ReturnType<typeof setInterval>
let isFirstPoll = true

export function startPolling() {
  fetchFullAutomation()
  fetchDashboardWidgets()
  fetchPoll()
  pollInterval = setInterval(fetchPoll, 30000)
  fullStateInterval = setInterval(fetchFullAutomation, 300000)
}

export function stopPolling() {
  if (pollInterval) clearInterval(pollInterval)
  if (fullStateInterval) clearInterval(fullStateInterval)
}

export async function fetchFullAutomation() {
  try {
    const as = await fetch('/automation/state').then(r => r.json())
    automationState.set(as)
    settings.set(as.settings)
  } catch {}
}

export async function fetchDashboardWidgets() {
  const token = getToken()
  if (!token) return
  try {
    const r = await fetch('/user/widgets', { headers: { Authorization: `Bearer ${token}` } })
    const data = await r.json()
    if (Array.isArray(data.widgets)) {
      dashboardWidgets.set(data.widgets)
    }
  } catch {}
}

export async function saveDashboardWidgets(widgets: any[]) {
  const token = getToken()
  if (!token) return
  try {
    await fetch('/user/widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ widgets })
    })
    dashboardWidgets.set(widgets)
  } catch (e) {
    console.error('Save widgets failed', e)
  }
}

export async function fetchPoll() {
  try {
    const pollData = await fetch('/api/poll').then(r => r.json())
    if (pollData.data) appData.set(pollData.data)
    if (pollData.stats) dailyStats.set(pollData.stats)
    if (pollData.predictor) {
      appData.update(d => d ? { ...d, predictor: pollData.predictor } : { predictor: pollData.predictor })
    }
    if (pollData.displays) {
      automationState.update(state => {
        if (!state) return state
        for (const [id, d] of Object.entries(pollData.displays) as [string, { lastVal?: string; lastUpdate?: number }][]) {
          const node = state.nodes[id]
          if (node) {
            if (d.lastVal !== undefined) node.lastVal = d.lastVal
            if (d.lastUpdate !== undefined) node.lastUpdate = d.lastUpdate
          }
        }
        return state
      })
    }
    const br = await fetch('/automation/battery-runtime').then(r => r.json()).catch(() => null)
    if (br && !br.error) {
      appData.update(d => d ? { ...d, batteryRuntime: br } : { batteryRuntime: br })
    }
  } catch {}
}

// --- Version check ---
let currentVersion: string | null = null
export async function checkVersion() {
  try {
    const v = await fetch('/version').then(r => r.json())
    if (currentVersion === null) {
      currentVersion = v.version
    } else if (currentVersion !== v.version) {
      window.location.reload()
    }
  } catch {}
}
