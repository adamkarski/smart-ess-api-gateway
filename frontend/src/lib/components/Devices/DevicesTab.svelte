<script lang="ts">
  import { automationState } from '../../stores/appStore'

  let tuyaDevices = $derived($automationState?.tuya_devices ?? {})
  let deviceEntries = $derived(Object.entries(tuyaDevices))
  let settings = $derived($automationState?.settings || {})

  const deviceIcons: Record<string, string> = {
    dlq: 'fa-gauge-high',
    tdq: 'fa-power-off',
    pir: 'fa-person-walking',
    wsdcg: 'fa-temperature-high',
  }
  const deviceLabels: Record<string, string> = {
    dlq: 'Licznik energii',
    tdq: 'Przełącznik',
    pir: 'Czujnik ruchu',
    wsdcg: 'Czujnik temp.',
  }
  const productIcons: Record<string, string> = {
    'jc1afi7ow32okd0h': 'fa-temperature-high',
    'gk0d4i8g5akryd9d': 'fa-person-walking',
  }
  const productLabels: Record<string, string> = {
    'jc1afi7ow32okd0h': 'Czujnik temperatury',
    'gk0d4i8g5akryd9d': 'Czujnik ruchu',
  }

  function isSensor(dev: any): boolean {
    const pid = dev.product_id
    const cat = dev.category
    if (pid && (pid === 'jc1afi7ow32okd0h' || pid === 'gk0d4i8g5akryd9d')) return true
    return cat === 'pir' || cat === 'wsdcg'
  }

  function getRelayOn(dev: any): boolean {
    // Check if any flow node has dps data for this device
    const deviceNode = Object.values($automationState?.nodes || {}).find(
      (n: any) => n.type === 'tuya' && (n.config?.device_id === dev.internal_app_id || n.config?.device_id === dev.tuya_device_id)
    )
    const nodeDps = (deviceNode as any)?.data?.dps || {}
    if (nodeDps['1'] !== undefined) return nodeDps['1'] === true
    // Fallback to last_dps from device cache
    return dev.last_dps?.['1'] === true
  }

  async function controlTuya(id: string, dps: number, value: boolean) {
    try {
      await fetch('/automation/tuya/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, dps, value })
      })
    } catch {}
  }

  async function syncCloud() {
    try {
      await fetch('/automation/tuya/import', { method: 'POST' })
      window.location.reload()
    } catch {}
  }
</script>

<div class="section-card">
  <div class="section-header">
    <h2 class="section-title">Smart Devices</h2>
    <button class="btn btn-teal" onclick={syncCloud}>
      <i class="fa-solid fa-cloud-bolt"></i> Synchronizuj Chmurę
    </button>
  </div>
  <div class="devices-grid">
    <!-- Inverter Card -->
    <div class="device-card">
      <div class="device-top">
        <div class="device-icon"><i class="fa-solid fa-solar-panel text-orange-400"></i></div>
        <div class="device-status-badge connected">Connected</div>
      </div>
      <div class="device-name">Inwerter Hybrydowy</div>
      <div class="device-sub">DESS Monitor API</div>
      <div class="device-meta">
        <span>Status: Online</span>
        <span>{settings?.inverter?.dessId || '---'}</span>
      </div>
    </div>

    <!-- Weather Card -->
    <div class="device-card">
      <div class="device-top">
        <div class="device-icon"><i class="fa-solid fa-cloud-sun text-blue-400"></i></div>
        <div class="device-status-badge connected">Active</div>
      </div>
      <div class="device-name">Stacja Pogodowa</div>
      <div class="device-sub">OpenWeatherMap</div>
      <div class="device-meta">
        <span>Aktualizacja</span>
        <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>

    <!-- Tuya Device Cards -->
    {#each deviceEntries as [id, dev]}
      {@const sensor = isSensor(dev)}
      {@const relayOn = getRelayOn(dev)}
      {@const icon = productIcons[dev.product_id || ''] || deviceIcons[dev.category || ''] || 'fa-power-off'}
      {@const label = productLabels[dev.product_id || ''] || deviceLabels[dev.category || ''] || 'Urządzenie'}
      {@const iconColor = dev.category === 'dlq' ? 'text-yellow-400' : sensor ? 'text-cyan-400' : 'text-teal-400'}
      <div class="device-card" class:relay-active={!sensor && relayOn}>
        <div class="device-top">
          <div class="device-icon {iconColor}"><i class="fa-solid {icon}"></i></div>
          <div class="flex flex-col items-end gap-1">
            <div class="device-status-badge" class:online={dev.status === 'online'} class:offline={dev.status !== 'online'}>{dev.status}</div>
            {#if !sensor && relayOn}
              <div class="relay-badge">⚡ ON</div>
            {/if}
            <div class="device-type-label">{label}</div>
          </div>
        </div>
        <div class="device-name">{dev.name || id}</div>
        <div class="device-sub">{dev.ip || 'Tylko chmura'}</div>
        {#if sensor}
          <div class="device-sensor-note">Urządzenie pomiarowe (brak sterowania)</div>
        {:else}
          <button class="control-btn" class:on={relayOn} class:off={!relayOn}
            onclick={() => controlTuya(dev.internal_app_id, 1, !relayOn)}>
            {relayOn ? 'WYŁĄCZ' : 'WŁĄCZ'}
          </button>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .section-card {
    background: rgba(30, 41, 59, 0.7);
    backdrop-filter: blur(12px);
    border-radius: 24px;
    border: 1px solid #334155;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
    overflow: hidden;
    margin-bottom: 1rem;
  }
  .section-header {
    background: rgba(15, 23, 42, 0.5);
    padding: 1rem 1.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #334155;
  }
  .section-title { font-size:14px; font-weight:900; text-transform:uppercase; letter-spacing:.3em; color:#94a3b8; }
  .btn { padding:10px 16px; border-radius:12px; font-size:10px; font-weight:900; text-transform:uppercase; border:none; cursor:pointer; transition:all .2s; display:flex; align-items:center; gap:.5rem; }
  .btn-teal { background:#0d9488; color:white; }
  .devices-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
    padding: 1.5rem;
  }
  .device-card {
    background: rgba(15, 23, 42, 0.4);
    padding: 1.5rem;
    border-radius: 24px;
    border: 1px solid rgba(255,255,255,0.05);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    transition: border-color .2s;
  }
  .device-card:hover { border-color: rgba(56,189,248,.2); }
  .device-card.relay-active { border-color: rgba(52,211,153,.4); box-shadow: 0 0 12px rgba(52,211,153,.15); }
  .device-top { display:flex; justify-content:space-between; align-items:flex-start; }
  .device-icon {
    width: 48px; height: 48px;
    background: #0f172a;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #334155;
  }
  .device-status-badge {
    padding: 4px 8px;
    border-radius: 999px;
    font-size: 7px;
    font-weight: 900;
    text-transform: uppercase;
  }
  .online { background: rgba(16,185,129,0.1); color: #10b981; border: 1px solid rgba(16,185,129,0.2); }
  .offline { background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.2); }
  .device-name { font-weight: 700; color: white; font-size: 14px; text-transform: uppercase; }
  .device-sub { font-size:8px; color:#64748b; font-family:monospace; font-style:italic; }
  .device-type-label { font-size:7px; color:#475569; font-weight:700; text-transform:uppercase; letter-spacing:.1em; }
  .relay-badge { font-size:7px; color:#34d399; font-weight:900; text-transform:uppercase; letter-spacing:.1em; }
  .device-meta { font-size:9px; color:#64748b; font-weight:700; display:flex; justify-content:space-between; padding-top:.5rem; border-top:1px solid rgba(255,255,255,.05); text-transform:uppercase; }
  .device-sensor-note { font-size:9px; color:#64748b; font-style:italic; text-align:center; }
  .control-btn {
    width:100%; padding:10px; border-radius:12px; font-size:9px; font-weight:900;
    text-transform:uppercase; letter-spacing:.1em; transition:all .2s; border:1px solid;
    cursor:pointer;
  }
  .control-btn.on { background:rgba(239,68,68,.2); color:#ef4444; border-color:rgba(239,68,68,.3); }
  .control-btn.on:hover { background:rgba(239,68,68,.3); }
  .control-btn.off { background:rgba(20,184,166,.2); color:#2dd4bf; border-color:rgba(20,184,166,.3); }
  .control-btn.off:hover { background:rgba(20,184,166,.3); }

  @media (max-width: 768px) {
    .section-card { background: #2a2d35; backdrop-filter: none; border: none; border-radius: 24px; box-shadow: 14px 14px 42px #1a1d22, -14px -14px 42px #3d414b; }
    .devices-grid { grid-template-columns: 1fr; gap: 12px; }
    .device-card { background: #2a2d35; border: none; border-radius: 20px; box-shadow: 8px 8px 24px #1a1d22, -8px -8px 24px #3d414b; }
    .device-icon { background: #2a2d35; border: none; box-shadow: inset 4px 4px 12px #1a1d22, inset -4px -4px 12px #3d414b; }
    .device-name { color: #e2e8f0; }
    .device-meta { border-top-color: rgba(255,255,255,0.04); }
  }
</style>
