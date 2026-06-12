<script lang="ts">
  import { settings, automationState } from '../../stores/appStore'
  import { onMount } from 'svelte'
  import FlowCanvas from '../Flow/FlowCanvas.svelte'

  let s = $derived($settings ?? {})
  let weather = $derived(s.weather ?? {})
  let tuya = $derived(s.tuya ?? {})
  let solar = $derived(s.solar ?? {})
  let dess = $derived(s.dess ?? {})
  let tariff = $derived(s.tariff ?? { provider: 'G12w', source: 'static', peakRanges: [], offpeakRanges: [], peakPricePerKwh: 0, offpeakPricePerKwh: 0, dynamicThreshold: 300 })
  let saveStatus = $state('')

  interface TariffPreset {
    name: string;
    provider: string;
    peakRanges: {start: string, end: string, type: string}[];
    offpeakRanges: {start: string, end: string, type: string}[];
    peakPrice: number;
    offpeakPrice: number;
  }

  let tariffPresets = $state<TariffPreset[]>([])
  let presetsLoaded = $state(false)
  let dynamicPrices = $state<{hour: number, pricePerMwh: number, isCheap: boolean}[]>([])
  let currentPrice = $state(0)

  async function loadTariffPresets() {
    try {
      const r = await fetch('/automation/tariff-presets')
      const data = await r.json()
      if (data.presets?.length > 0) {
        tariffPresets = data.presets
        tariffPresets.push({
          name: 'Własna (manual)',
          provider: 'Custom',
          peakRanges: [],
          offpeakRanges: [],
          peakPrice: 0,
          offpeakPrice: 0,
        })
        presetsLoaded = true
      }
    } catch (e) {
      console.error('Failed to load tariff presets:', e)
    }
  }

  onMount(() => {
    loadTariffPresets()
    loadDynamicPrices()
  })

  async function loadDynamicPrices() {
    try {
      const r = await fetch('/automation/tariff-prices')
      const data = await r.json()
      dynamicPrices = data.dynamicPrices || []
      currentPrice = data.currentPricePerKwh || 0
    } catch (e) {
      console.error('Failed to load dynamic prices:', e)
    }
  }

  async function setTariffSource(source: 'static' | 'dynamic') {
    try {
      const r = await fetch('/automation/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tariff: {
            ...tariff,
            source,
          }
        }),
      })
      if (r.ok) {
        saveStatus = source === 'dynamic' ? '✔ Tryb dynamiczny aktywny!' : '✔ Tryb statyczny aktywny!'
        setTimeout(() => saveStatus = '', 2000)
        if (source === 'dynamic') loadDynamicPrices()
      }
    } catch (e) {
      console.error('Failed to set tariff source:', e)
    }
  }

  async function applyTariffPreset(preset: TariffPreset) {
    try {
      const r = await fetch('/automation/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tariff: {
            ...tariff,
            provider: preset.provider,
            peakRanges: preset.peakRanges,
            offpeakRanges: preset.offpeakRanges,
            peakPricePerKwh: preset.peakPrice,
            offpeakPricePerKwh: preset.offpeakPrice,
          }
        }),
      })
      if (r.ok) {
        saveStatus = '✔ Taryfa zapisana!'
        setTimeout(() => saveStatus = '', 2000)
        // Update DOM inputs
        const providerEl = document.getElementById('set-tariff-provider') as HTMLInputElement
        const peakPriceEl = document.getElementById('set-tariff-peak-price') as HTMLInputElement
        const offpeakPriceEl = document.getElementById('set-tariff-offpeak-price') as HTMLInputElement
        if (providerEl) providerEl.value = preset.provider
        if (peakPriceEl) peakPriceEl.value = String(preset.peakPrice)
        if (offpeakPriceEl) offpeakPriceEl.value = String(preset.offpeakPrice)
        // Update range rows in DOM
        const tariffSection = document.querySelector('.setting-card.col-span-full')
        if (tariffSection) {
          tariffSection.querySelectorAll('.tariff-peak-row, .tariff-offpeak-row').forEach(r => r.remove())
          const grids = tariffSection.querySelectorAll('.grid.grid-cols-2.gap-6.mt-4 > div')
          if (grids.length >= 2) {
            preset.peakRanges.forEach(r => {
              const div = document.createElement('div')
              div.className = 'field-row tariff-peak-row'
              div.innerHTML = `<input type="time" class="tariff-start field-input" value="${r.start}" /><span>–</span><input type="time" class="tariff-end field-input" value="${r.end}" />`
              grids[0].insertBefore(div, grids[0].querySelector('.btn') || null)
            })
            preset.offpeakRanges.forEach(r => {
              const div = document.createElement('div')
              div.className = 'field-row tariff-offpeak-row'
              div.innerHTML = `<input type="time" class="tariff-start field-input" value="${r.start}" /><span>–</span><input type="time" class="tariff-end field-input" value="${r.end}" />`
              grids[1].insertBefore(div, grids[1].querySelector('.btn') || null)
            })
          }
        }
      }
    } catch {
      saveStatus = '✖ Błąd zapisu taryfy'
    }
  }

  let solarVisualsInited = $state(false)

  onMount(() => {
    initMap()
    // Retry map init periodically until it succeeds (handles hidden tab)
    const mapRetry = setInterval(() => {
      if (!mapInitialized) initMap()
      else if (weatherMap) { weatherMap.invalidateSize(); clearInterval(mapRetry) }
    }, 500)
  })

  $effect(() => {
    if (solarVisualsInited) return
    if (solar.kwp == null) return
    const tiltEl = document.getElementById('set-solar-tilt') as HTMLInputElement
    const azEl = document.getElementById('set-solar-azimuth') as HTMLInputElement
    const kwpEl = document.getElementById('set-solar-kwp') as HTMLInputElement
    if (!tiltEl || !azEl || !kwpEl) return
    if (solar.tilt !== undefined) tiltEl.value = String(solar.tilt)
    if (solar.azimuth !== undefined) azEl.value = String(solar.azimuth)
    if (solar.kwp !== undefined) kwpEl.value = String(solar.kwp)
    solarVisualsInited = true
    updateAzimuthVisual()
    updateTiltVisual()
    fetchPredictionFromApi()
  })

  let locationInited = $state(false)

  $effect(() => {
    if (locationInited) return
    if (!weather.lat || !weather.lon) return
    const searchInput = document.getElementById('location-search') as HTMLInputElement
    if (!searchInput) return
    locationInited = true
    const lat = parseFloat(weather.lat)
    const lon = parseFloat(weather.lon)
    if (!isNaN(lat) && !isNaN(lon)) reverseGeocode(lat, lon)
  })

  let mapEl: HTMLDivElement
  let mapInitialized = false
  let weatherMap: any = null
  let mapMarker: any = null

  async function initMap() {
    if (mapInitialized || !mapEl || mapEl.offsetParent === null) return
    const L = (await import('leaflet')).default
    const lat = parseFloat(weather.lat) || 49.88
    const lon = parseFloat(weather.lon) || 19.56
    weatherMap = L.map(mapEl, {
      center: [lat, lon], zoom: 16,
      zoomControl: true, attributionControl: false,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(weatherMap)
    mapMarker = L.marker([lat, lon], { draggable: true }).addTo(weatherMap)
    mapMarker.on('dragend', () => {
      const pos = mapMarker.getLatLng()
      setLatLon(pos.lat.toFixed(5), pos.lng.toFixed(5))
      reverseGeocode(pos.lat, pos.lng)
      saveLocation(pos.lat.toFixed(5), pos.lng.toFixed(5))
    })
    weatherMap.on('click', (e: any) => {
      mapMarker.setLatLng(e.latlng)
      setLatLon(e.latlng.lat.toFixed(5), e.latlng.lng.toFixed(5))
      reverseGeocode(e.latlng.lat, e.latlng.lng)
      saveLocation(e.latlng.lat.toFixed(5), e.latlng.lng.toFixed(5))
    })
    mapInitialized = true
    setTimeout(() => weatherMap.invalidateSize(), 300)
  }

  function setLatLon(lat: string, lon: string) {
    const latEl = document.getElementById('set-weather-lat') as HTMLInputElement
    const lonEl = document.getElementById('set-weather-lon') as HTMLInputElement
    if (latEl) latEl.value = lat
    if (lonEl) lonEl.value = lon
  }

  async function reverseGeocode(lat: number, lon: number) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=pl`)
      const data = await r.json()
      const status = document.getElementById('location-status')
      const name = document.getElementById('location-name')
      const searchInput = document.getElementById('location-search') as HTMLInputElement
      const displayName = data.display_name?.split(', ').slice(0, 3).join(', ') || `${lat.toFixed(5)}, ${lon.toFixed(5)}`
      if (status && name) {
        status.classList.remove('hidden')
        name.textContent = displayName
      }
      if (searchInput) searchInput.value = displayName
    } catch {}
  }

  let searching = $state(false)

  async function saveLocation(lat: string, lon: string) {
    try {
      await fetch('/automation/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weather: { lat, lon } }),
      })
    } catch {}
  }

  function getSVGPoint(svgEl: SVGSVGElement, clientX: number, clientY: number) {
    const pt = svgEl.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    return pt.matrixTransform(svgEl.getScreenCTM()!.inverse())
  }

  function pickAzimuth(e: MouseEvent) {
    const svg = e.currentTarget as SVGSVGElement
    const pt = getSVGPoint(svg, e.clientX, e.clientY)
    const dx = pt.x - 60
    const dy = pt.y - 60
    let deg = Math.round(Math.atan2(dx, -dy) * 180 / Math.PI)
    if (deg < 0) deg += 360
    const input = document.getElementById('set-solar-azimuth') as HTMLInputElement
    if (input) { input.value = String(deg); updateAzimuthVisual(); fetchPredictionFromApi(); saveSolarAngles() }
  }

  function updateAzimuthVisual() {
    const input = document.getElementById('set-solar-azimuth') as HTMLInputElement
    const val = parseFloat(input?.value ?? '0') || 0
    const line = document.getElementById('azimuth-line')
    const label = document.getElementById('azimuth-label')
    if (line) {
      const rad = val * Math.PI / 180
      const x2 = 60 + Math.sin(rad) * 45
      const y2 = 60 - Math.cos(rad) * 45
      line.setAttribute('x2', String(x2))
      line.setAttribute('y2', String(y2))
    }
    if (label) label.textContent = `${val}°`
  }

  function getSolarInputs() {
    const tilt = parseFloat((document.getElementById('set-solar-tilt') as HTMLInputElement)?.value) || 0
    const az = parseFloat((document.getElementById('set-solar-azimuth') as HTMLInputElement)?.value) || 0
    const kwp = parseFloat((document.getElementById('set-solar-kwp') as HTMLInputElement)?.value) || 0
    const lat = (document.getElementById('set-weather-lat') as HTMLInputElement)?.value || s.weather?.lat || ''
    const lon = (document.getElementById('set-weather-lon') as HTMLInputElement)?.value || s.weather?.lon || ''
    return { tilt, az, kwp, lat, lon }
  }

  async function saveSolarAngles() {
    const { tilt, az } = getSolarInputs()
    try {
      await fetch('/automation/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solar: { ...solar, tilt, azimuth: az } }),
      })
    } catch {}
  }

  async function saveKwp() {
    const kwp = parseFloat((document.getElementById('set-solar-kwp') as HTMLInputElement)?.value) || 0
    try {
      await fetch('/automation/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solar: { ...solar, kwp } }),
      })
    } catch {}
  }

  function pickTilt(e: MouseEvent) {
    const svg = e.currentTarget as SVGSVGElement
    const pt = getSVGPoint(svg, e.clientX, e.clientY)
    const dx = 60 - pt.x
    const dy = 105 - pt.y
    let deg = Math.round(Math.atan2(dy, dx) * 180 / Math.PI)
    if (deg < 0) deg = 0
    if (deg > 90) deg = 90
    const input = document.getElementById('set-solar-tilt') as HTMLInputElement
    if (input) { input.value = String(deg); updateTiltVisual(); fetchPredictionFromApi(); saveSolarAngles() }
  }

  function updateTiltVisual() {
    const input = document.getElementById('set-solar-tilt') as HTMLInputElement
    const val = parseFloat(input?.value ?? '0') || 0
    const line = document.getElementById('tilt-line')
    const label = document.getElementById('tilt-label')
    const arc = document.getElementById('tilt-arc')
    const anchorX = 60, anchorY = 105, len = 50
    if (line) {
      const rad = val * Math.PI / 180
      const x2 = anchorX - Math.cos(rad) * len
      const y2 = anchorY - Math.sin(rad) * len
      line.setAttribute('x1', String(anchorX))
      line.setAttribute('y1', String(anchorY))
      line.setAttribute('x2', String(x2))
      line.setAttribute('y2', String(y2))
    }
    if (label) label.textContent = `${val}°`
    if (arc) {
      const r = 15, cx = anchorX, cy = anchorY
      const angle = val * Math.PI / 180
      const x1 = cx - r
      const y1 = cy
      const x2 = cx - Math.cos(angle) * r
      const y2 = cy - Math.sin(angle) * r
      const large = angle > Math.PI ? 1 : 0
      arc.setAttribute('d', `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`)
    }
  }

  // --- PV prediction via /api/solar/predict (real Open-Meteo API through backend) ---
  let predictedTodayLabel = $state('--')

  async function fetchPredictionFromApi() {
    const { tilt, az, kwp, lat, lon } = getSolarInputs()
    if (!lat || !lon || !kwp || kwp <= 0) {
      predictedTodayLabel = '-- kWh'
      return
    }
    try {
      const p = new URLSearchParams({ lat: String(lat), lon: String(lon), kwp: String(kwp), tilt: String(tilt), azimuth: String(az) })
      const r = await fetch(`/api/solar/predict?${p}`)
      if (!r.ok) throw new Error(await r.text())
      const sum = (await r.json()).expected_pv_today_sum_kwh ?? 0
      predictedTodayLabel = `${sum} kWh`
    } catch {
      predictedTodayLabel = '?? kWh'
    }
  }

  async function searchLocation() {
    const query = (document.getElementById('location-search') as HTMLInputElement)?.value
    if (!query) return
    searching = true
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&accept-language=pl`)
      const results = await r.json()
      searching = false
      if (results.length === 0) return
      const res = results[0]
      const lat = parseFloat(res.lat)
      const lon = parseFloat(res.lon)
      setLatLon(lat.toFixed(5), lon.toFixed(5))
      saveLocation(lat.toFixed(5), lon.toFixed(5))
      if (weatherMap && mapMarker) {
        weatherMap.setView([lat, lon], 15)
        mapMarker.setLatLng([lat, lon])
      }
      const status = document.getElementById('location-status')
      const name = document.getElementById('location-name')
      if (status && name) {
        status.classList.remove('hidden')
        name.textContent = res.display_name.split(', ').slice(0, 3).join(', ')
      }
    } catch {
      searching = false
    }
  }

  async function saveAll() {
    saveStatus = 'Zapisywanie...'

    // Collect tariff ranges from DOM
    const peakRanges: {start: string, end: string, type: string}[] = []
    const offpeakRanges: {start: string, end: string, type: string}[] = []
    document.querySelectorAll('.tariff-peak-row').forEach(row => {
      const start = (row.querySelector('.tariff-start') as HTMLInputElement)?.value
      const end = (row.querySelector('.tariff-end') as HTMLInputElement)?.value
      if (start && end) peakRanges.push({ start, end, type: 'peak' })
    })
    document.querySelectorAll('.tariff-offpeak-row').forEach(row => {
      const start = (row.querySelector('.tariff-start') as HTMLInputElement)?.value
      const end = (row.querySelector('.tariff-end') as HTMLInputElement)?.value
      if (start && end) offpeakRanges.push({ start, end, type: 'offpeak' })
    })

    const payload = {
      weather: {
        apiKey: (document.getElementById('set-weather-key') as HTMLInputElement)?.value || '',
        lat: (document.getElementById('set-weather-lat') as HTMLInputElement)?.value || '',
        lon: (document.getElementById('set-weather-lon') as HTMLInputElement)?.value || '',
      },
      tuya: {
        apiKey: (document.getElementById('set-tuya-key') as HTMLInputElement)?.value || '',
        apiSecret: (document.getElementById('set-tuya-secret') as HTMLInputElement)?.value || '',
        region: (document.getElementById('set-tuya-region') as HTMLInputElement)?.value || '',
      },
      solar: {
        kwp: parseFloat((document.getElementById('set-solar-kwp') as HTMLInputElement)?.value) || 0,
        tilt: parseFloat((document.getElementById('set-solar-tilt') as HTMLInputElement)?.value) || 0,
        azimuth: parseFloat((document.getElementById('set-solar-azimuth') as HTMLInputElement)?.value) || 0,
        elevation: parseFloat((document.getElementById('set-solar-elevation') as HTMLInputElement)?.value) || 0,
        batteryKwh: parseFloat((document.getElementById('set-battery-kwh') as HTMLInputElement)?.value) || 0,
        inverterKw: parseFloat((document.getElementById('set-inverter-kw') as HTMLInputElement)?.value) || 0,
      },
      dess: {
        pn: (document.getElementById('set-dess-pn') as HTMLInputElement)?.value || '',
        sn: (document.getElementById('set-dess-sn') as HTMLInputElement)?.value || '',
        devcode: (document.getElementById('set-dess-devcode') as HTMLInputElement)?.value || '',
        devaddr: (document.getElementById('set-dess-devaddr') as HTMLInputElement)?.value || '',
        batteryVoltage: parseFloat((document.getElementById('set-battery-voltage') as HTMLInputElement)?.value) || 0,
        username: (document.getElementById('set-dess-username') as HTMLInputElement)?.value || '',
      },
      tariff: {
        provider: (document.getElementById('set-tariff-provider') as HTMLInputElement)?.value || 'G12w',
        peakRanges,
        offpeakRanges,
        peakPricePerKwh: parseFloat((document.getElementById('set-tariff-peak-price') as HTMLInputElement)?.value) || 0,
        offpeakPricePerKwh: parseFloat((document.getElementById('set-tariff-offpeak-price') as HTMLInputElement)?.value) || 0,
      },
    }
    try {
      const r = await fetch('/automation/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (r.ok) {
        saveStatus = '✔ Zapisano!'
        setTimeout(() => saveStatus = '', 2500)
      } else saveStatus = '✖ Błąd zapisu'
    } catch {
      saveStatus = '✖ Błąd sieci'
    }
  }
</script>

<div class="section-card">
  <div class="section-header">
    <span class="section-title">Konfiguracja Systemu</span>
    <div class="flex gap-3 items-center">
      {#if saveStatus}
        <span class="save-status">{saveStatus}</span>
      {/if}
      <button class="btn btn-teal" onclick={saveAll}>
        <i class="fa-solid fa-floppy-disk"></i> Zapisz wszystko
      </button>
      <button class="btn btn-slate" onclick={() => window.location.reload()}>
        <i class="fa-solid fa-arrows-rotate"></i> Odśwież
      </button>
    </div>
  </div>
  <div class="settings-grid">
    <!-- Weather + Map -->
    <div class="setting-card col-span-full">
      <div class="setting-header">
        <i class="fa-solid fa-cloud-sun text-blue-400"></i>
        <span class="setting-card-title">Pogoda</span>
        <span class="setting-desc">Konfiguracja OpenWeatherMap</span>
      </div>
      <div class="weather-layout">
        <div class="weather-form">
          <label class="field-label" for="set-weather-key">Klucz API</label>
          <div class="field-row">
            <input type="text" id="set-weather-key" class="field-input flex-1" value={weather.apiKey || ''} />
            <a href="https://home.openweathermap.org/api_keys" target="_blank" rel="noopener" class="btn-external" title="Otwórz stronę z kluczami API"><i class="fa-solid fa-external-link-alt"></i></a>
          </div>
          <label class="field-label" for="location-search">Wyszukaj miejscowość</label>
          <div class="search-row">
            <input type="text" id="location-search" placeholder="np. Klecza Dolna, Wadowice..." class="field-input flex-1" onkeydown={(e) => { if (e.key === 'Enter') searchLocation(); }} />
            <button class="btn btn-blue" onclick={() => searchLocation()}>Szukaj</button>
          </div>
          <div class="coord-row">
            <div class="coord-field">
              <label class="field-label" for="set-weather-lat">Szerokość (Lat)</label>
              <input type="text" id="set-weather-lat" class="field-input" value={weather.lat || ''} />
            </div>
            <div class="coord-field">
              <label class="field-label" for="set-weather-lon">Długość (Lon)</label>
              <input type="text" id="set-weather-lon" class="field-input" value={weather.lon || ''} />
            </div>
          </div>
          <div id="location-status" class="location-status hidden">
            ✔ Lokalizacja: <span id="location-name"></span>
          </div>
        </div>
        <div bind:this={mapEl} class="map-container"></div>
      </div>
    </div>

    <!-- Tuya API -->
    <div class="setting-card col-span-full">
      <div class="setting-header">
        <i class="fa-solid fa-plug text-purple-400"></i>
        <span class="setting-card-title">Tuya Cloud</span>
        <span class="setting-desc">Dane API z platformy Tuya IoT</span>
      </div>
      <div class="grid grid-cols-3 gap-4">
        <div class="col-flex">
          <label class="field-label" for="set-tuya-key">Access ID</label>
          <div class="field-row">
            <input type="text" id="set-tuya-key" class="field-input flex-1" value={tuya.apiKey || ''} />
            <a href="https://iot.tuya.com/" target="_blank" rel="noopener" class="btn-external" title="Otwórz panel Tuya IoT"><i class="fa-solid fa-external-link-alt"></i></a>
          </div>
        </div>
        <div class="col-flex">
          <label class="field-label" for="set-tuya-secret">Access Secret</label>
          <div class="field-row">
            <input type="text" id="set-tuya-secret" class="field-input flex-1" value={tuya.apiSecret || ''} />
            <a href="https://iot.tuya.com/" target="_blank" rel="noopener" class="btn-external" title="Otwórz panel Tuya IoT"><i class="fa-solid fa-external-link-alt"></i></a>
          </div>
        </div>
        <div class="col-flex">
          <label class="field-label" for="set-tuya-region">Region</label>
          <select id="set-tuya-region" class="field-input">
            <option value="EU" selected={tuya.region === 'EU'}>Europa (EU)</option>
            <option value="US" selected={tuya.region === 'US'}>Ameryka (US)</option>
            <option value="CN" selected={tuya.region === 'CN'}>Chiny (CN)</option>
            <option value="IN" selected={tuya.region === 'IN'}>Indie (IN)</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Inverter (DESS) -->
    <div class="setting-card">
      <div class="setting-header">
        <i class="fa-solid fa-solar-panel text-orange-400"></i>
        <span class="setting-card-title">Inwerter DESS</span>
        <span class="setting-desc">Dane urządzenia DESS</span>
      </div>
      <div class="col-flex">
        <label class="field-label" for="set-dess-pn">PN</label>
        <input type="text" id="set-dess-pn" class="field-input" value={dess.pn || ''} />
      </div>
      <div class="col-flex">
        <label class="field-label" for="set-dess-sn">SN</label>
        <input type="text" id="set-dess-sn" class="field-input" value={dess.sn || ''} />
      </div>
      <div class="col-flex">
        <label class="field-label" for="set-dess-devcode">Device Code</label>
        <input type="text" id="set-dess-devcode" class="field-input" value={dess.devcode || ''} />
      </div>
      <div class="col-flex">
        <label class="field-label" for="set-dess-devaddr">Device Address</label>
        <input type="text" id="set-dess-devaddr" class="field-input" value={dess.devaddr || ''} autocomplete="off" />
      </div>
      <div class="col-flex">
        <label class="field-label" for="set-dess-username">Nazwa użytkownika</label>
        <input type="text" id="set-dess-username" class="field-input" value={dess.username || ''} />
      </div>
    </div>

    <!-- Battery -->
    <div class="setting-card">
      <div class="setting-header">
        <i class="fa-solid fa-bolt text-green-400"></i>
        <span class="setting-card-title">Bateria</span>
        <span class="setting-desc">Parametry magazynu energii</span>
      </div>
      <div class="col-flex">
        <label class="field-label" for="set-battery-voltage">Napięcie baterii (V)</label>
        <input type="number" id="set-battery-voltage" class="field-input" value={dess.batteryVoltage ?? 48} step="0.1" />
      </div>
      <div class="col-flex">
        <label class="field-label" for="set-battery-kwh">Pojemność (kWh)</label>
        <input type="number" id="set-battery-kwh" class="field-input" value={solar.batteryKwh ?? 16} step="0.5" />
      </div>
      <div class="col-flex">
        <label class="field-label" for="set-inverter-kw">Moc inwertera (kW)</label>
        <input type="number" id="set-inverter-kw" class="field-input" value={solar.inverterKw ?? 5} step="0.1" />
      </div>
    </div>

    <!-- Solar Panels -->
    <div class="setting-card">
      <div class="setting-header">
        <i class="fa-solid fa-sun text-yellow-400"></i>
        <span class="setting-card-title">Panele PV</span>
        <span class="setting-desc">Parametry instalacji solarnej</span>
      </div>
      <div class="col-flex">
        <label class="field-label" for="set-solar-kwp">Moc (kWp)</label>
        <input type="number" id="set-solar-kwp" class="field-input" step="0.1" oninput={() => { fetchPredictionFromApi(); saveKwp() }} />
      </div>
      <div class="solar-prediction-bar">
        <span class="field-label">Przewidywana PV dzisiaj:</span>
        <span class="solar-prediction-value">{predictedTodayLabel}</span>
      </div>
      <div class="solar-visuals">
        <div class="solar-visual-card">
          <label class="field-label">Kąt nachylenia</label>
          <svg viewBox="0 0 120 120" class="solar-svg" onclick={(e) => pickTilt(e)}>
            <!-- ground -->
            <line x1="5" y1="105" x2="60" y2="105" stroke="#475569" stroke-width="2" />
            <!-- angle arc -->
            <path id="tilt-arc" d="" stroke="#38bdf8" stroke-width="1.5" fill="none" />
            <!-- panel line -->
            <line id="tilt-line" x1="60" y1="105" x2="10" y2="105" stroke="#fbbf24" stroke-width="3" stroke-linecap="round" />
            <!-- sun -->
            <text x="110" y="20" font-size="10" fill="#fbbf24" text-anchor="middle">☀</text>
            <!-- angle label -->
            <text id="tilt-label" x="40" y="118" font-size="9" fill="#94a3b8" text-anchor="middle"></text>
          </svg>
          <input type="number" id="set-solar-tilt" class="field-input solar-input" oninput={() => { updateTiltVisual(); fetchPredictionFromApi(); saveSolarAngles() }} />
        </div>
        <div class="solar-visual-card">
          <label class="field-label">Azymut</label>
          <svg viewBox="0 0 120 120" class="solar-svg" onclick={(e) => pickAzimuth(e)}>
            <!-- compass circle -->
            <circle cx="60" cy="60" r="45" stroke="#334155" stroke-width="1" fill="none" />
            <circle cx="60" cy="60" r="43" stroke="#334155" stroke-width="0.5" fill="none" stroke-dasharray="2,2" />
            <!-- cardinal directions -->
            <text x="60" y="12" font-size="8" fill="#f87171" text-anchor="middle" font-weight="700">N</text>
            <text x="108" y="63" font-size="8" fill="#94a3b8" text-anchor="middle">E</text>
            <text x="60" y="117" font-size="8" fill="#64748b" text-anchor="middle">S</text>
            <text x="12" y="63" font-size="8" fill="#94a3b8" text-anchor="middle">W</text>
            <!-- needle -->
            <line id="azimuth-line" x1="60" y1="60" x2="60" y2="15" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" />
            <circle cx="60" cy="60" r="4" fill="#fbbf24" />
            <!-- degree label -->
            <text id="azimuth-label" x="60" y="102" font-size="9" fill="#94a3b8" text-anchor="middle"></text>
          </svg>
          <input type="number" id="set-solar-azimuth" class="field-input solar-input" oninput={() => { updateAzimuthVisual(); fetchPredictionFromApi(); saveSolarAngles() }} />
        </div>
      </div>
      <div class="col-flex">
        <label class="field-label" for="set-solar-elevation">Wysokość npm (m)</label>
        <input type="number" id="set-solar-elevation" class="field-input" value={solar.elevation ?? 0} />
      </div>
</div>
    </div>
  <div class="settings-grid">
    <!-- Taryfa -->
    <div class="setting-card col-span-full">
      <div class="setting-header">
        <i class="fa-solid fa-bolt text-yellow-400"></i>
        <span class="setting-card-title">Taryfa Energetyczna</span>
        <span class="setting-desc">Zakresy taryfy</span>
      </div>
      <div class="col-flex mb-4">
        <label class="field-label" for="set-tariff-preset">Wybierz predefiniowaną taryfę:</label>
        <select id="set-tariff-preset" class="field-input" onchange={(e) => {
          const preset = tariffPresets.find(p => p.name === (e.target as HTMLSelectElement).value)
          if (preset) applyTariffPreset(preset)
        }}>
          {#each tariffPresets as preset}
            <option value={preset.name} selected={tariff.provider === preset.provider}>{preset.name}</option>
          {/each}
        </select>
      </div>

      <!-- Source Toggle -->
      <div class="col-flex mb-4">
        <label class="field-label">Źródło cen:</label>
        <div class="flex gap-2">
          <button
            class="btn {tariff.source === 'static' ? 'btn-green' : 'btn-slate'} flex-1"
            onclick={() => setTariffSource('static')}
          >
            <i class="fa-solid fa-clock mr-1"></i> Statyczne
          </button>
          <button
            class="btn {tariff.source === 'dynamic' ? 'btn-green' : 'btn-slate'} flex-1"
            onclick={() => setTariffSource('dynamic')}
          >
            <i class="fa-solid fa-chart-line mr-1"></i> Dynamiczne
          </button>
        </div>
        {#if tariff.source === 'dynamic'}
          <div class="mt-2 p-3 bg-slate-800/50 rounded text-sm">
            <div class="flex justify-between items-center mb-1">
              <span class="text-slate-400">Aktualna cena:</span>
              <span class="font-mono text-green-400">{currentPrice.toFixed(4)} zł/kWh</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-slate-400">Tanie godziny:</span>
              <span class="font-mono text-yellow-400">{dynamicPrices.filter(p => p.isCheap).length}/24</span>
            </div>
            {#if dynamicPrices.length > 0}
              <div class="mt-2 text-xs text-slate-500">
                Następne tanie okno: {(() => {
                  const now = new Date().getHours();
                  const next = dynamicPrices.find((p, i) => p.isCheap && i > now);
                  return next ? `${next.hour}:00` : 'Brak';
                })()}
              </div>
            {/if}
          </div>
        {/if}
      </div>
      <div class="grid grid-cols-2 gap-4 mt-4">
        <div class="col-flex">
          <label class="field-label" for="set-tariff-provider">Dostawca / Taryfa</label>
          <input type="text" id="set-tariff-provider" class="field-input" value={tariff.provider || 'G12w'} placeholder="np. G12w" />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div class="col-flex">
            <label class="field-label" for="set-tariff-peak-price">Cena szczyt (PLN/kWh)</label>
            <input type="number" id="set-tariff-peak-price" class="field-input" value={tariff.peakPricePerKwh || 0} step="0.01" />
          </div>
          <div class="col-flex">
            <label class="field-label" for="set-tariff-offpeak-price">Cena poza szczytem (PLN/kWh)</label>
            <input type="number" id="set-tariff-offpeak-price" class="field-input" value={tariff.offpeakPricePerKwh || 0} step="0.01" />
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-6 mt-4">
        <div class="col-flex">
          <label class="field-label text-red-400">Godziny SZCZYTU (drogie)</label>
          {#each (tariff.peakRanges || []) as range, i}
            <div class="field-row tariff-peak-row">
              <input type="time" class="tariff-start field-input" value={range.start} />
              <span>–</span>
              <input type="time" class="tariff-end field-input" value={range.end} />
            </div>
          {/each}
          <button class="btn btn-slate text-xs mt-1" onclick={() => { const pr = tariff.peakRanges || []; pr.push({start:'06:00',end:'13:00',type:'peak'}); tariff.peakRanges = [...pr]; saveAll(); }}>
            <i class="fa-solid fa-plus"></i> Dodaj zakres
          </button>
        </div>
        <div class="col-flex">
          <label class="field-label text-green-400">Godziny POZA SZCZYTEM (taniej)</label>
          {#each (tariff.offpeakRanges || []) as range, i}
            <div class="field-row tariff-offpeak-row">
              <input type="time" class="tariff-start field-input" value={range.start} />
              <span>–</span>
              <input type="time" class="tariff-end field-input" value={range.end} />
            </div>
          {/each}
          <button class="btn btn-slate text-xs mt-1" onclick={() => { const or = tariff.offpeakRanges || []; or.push({start:'13:00',end:'15:00',type:'offpeak'}); tariff.offpeakRanges = [...or]; saveAll(); }}>
            <i class="fa-solid fa-plus"></i> Dodaj zakres
          </button>
        </div>
      </div>
    </div>
  </div>

  <div class="mt-8">
    <div class="section-header">
      <span class="section-title">Flow</span>
    </div>
    <FlowCanvas />
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
  }
  .section-header {
    background: rgba(15, 23, 42, 0.5);
    padding: 1rem 2rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #334155;
  }
  .section-title {
    font-size: 14px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.3em;
    color: #94a3b8;
  }
  .save-status {
    font-size: 9px;
    font-weight: 700;
    color: #2dd4bf;
    animation: fadeIn 0.2s;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.5rem;
    padding: 2rem;
  }
  .col-span-full { grid-column: 1 / -1; }
  .col-flex { display: flex; flex-direction: column; gap: 0.5rem; }
  .setting-card {
    background: rgba(15, 23, 42, 0.4);
    padding: 1.5rem;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.05);
    display: flex;
    flex-direction: column;
    gap: 1rem;
    position: relative;
    overflow: hidden;
  }
  .setting-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 10px;
  }
  .setting-card-title {
    font-weight: 900;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .setting-desc {
    color: #475569;
    font-size: 9px;
  }
  .weather-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  .weather-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .field-label {
    font-size: 8px;
    font-weight: 700;
    text-transform: uppercase;
    color: #475569;
  }
  .field-input {
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 12px;
    padding: 8px 12px;
    font-size: 12px;
    color: white;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }
  .field-input:focus { border-color: rgba(45,212,191,0.5); }
  .search-row { display: flex; gap: 0.5rem; }
  .coord-row { display: flex; gap: 0.5rem; }
  .coord-field { flex: 1; display: flex; flex-direction: column; gap: 0.5rem; }
  .location-status {
    font-size: 9px;
    color: #64748b;
    font-style: italic;
  }
  .location-status.hidden { display: none; }
  .map-container {
    width: 100%;
    height: 240px;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #334155;
  }
  .grid { display: grid; }
  .grid-cols-3 { grid-template-columns: repeat(3, 1fr); }
  .gap-4 { gap: 1rem; }
  .btn {
    padding: 8px 16px;
    border-radius: 12px;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    white-space: nowrap;
  }
  .solar-prediction-bar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
  .solar-prediction-value { font-size: 16px; font-weight: 900; color: #fbbf24; }
  .solar-visuals { display: flex; gap: 1rem; flex-wrap: wrap; }
  .solar-visual-card { flex: 1; min-width: 140px; display: flex; flex-direction: column; gap: 0.4rem; }
  .solar-svg { width: 100%; max-width: 200px; cursor: pointer; background: rgba(15,23,42,0.3); border-radius: 12px; padding: 4px; border: 1px solid #334155; transition: border-color 0.15s; }
  .solar-svg:hover { border-color: #38bdf8; }
  .solar-input { max-width: 100px; }
  .btn-blue { background: #2563eb; color: white; }
  .btn-teal { background: #0d9488; color: white; }
  .btn-slate { background: #334155; color: white; }
  .field-row { display: flex; gap: 0.5rem; align-items: center; }
  .btn-external {
    display: inline-flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; border-radius: 10px;
    background: #1e293b; border: 1px solid #334155;
    color: #38bdf8; text-decoration: none; flex-shrink: 0;
    transition: all 0.15s;
  }
  .btn-external:hover { background: #334155; color: #7dd3fc; }

  @media (max-width: 768px) {
    .section-card { background: #2a2d35; backdrop-filter: none; border: none; border-radius: 24px; box-shadow: 14px 14px 42px #1a1d22, -14px -14px 42px #3d414b; }
    .settings-grid { grid-template-columns: 1fr; padding: 16px; gap: 12px; }
    .setting-card { background: #2a2d35; border: none; border-radius: 20px; box-shadow: 8px 8px 24px #1a1d22, -8px -8px 24px #3d414b; padding: 16px; }
    .weather-layout { grid-template-columns: 1fr; }
    .grid-cols-3 { grid-template-columns: 1fr; }
    .field-input { background: #2a2d35; border: none; box-shadow: inset 4px 4px 12px #1a1d22, inset -4px -4px 12px #3d414b; color: #e2e8f0; }
    .field-label { color: #94a3b8; }
    .btn-external { background: #2a2d35; border: none; box-shadow: 4px 4px 12px #1a1d22, -4px -4px 12px #3d414b; }
  }
</style>
