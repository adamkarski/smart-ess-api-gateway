<script lang="ts">
  import { automationState } from '../../stores/appStore'
  import { onMount, onDestroy, tick } from 'svelte'

  let canvasEl: HTMLDivElement
  let nodesContainer: HTMLDivElement
  let svgLayer: SVGElement
  let hitsLayer: SVGElement
  let contextMenu: HTMLDivElement
  let editOverlay: HTMLDivElement
  let editContent: HTMLDivElement
  let canvasWrapper: HTMLDivElement

  let panX = $state(0)
  let panY = $state(0)
  let zoom = $state(1)
  let selectedId = $state<string | null>(null)
  let editPanelOpen = $state(false)
  let dragLine = $state('')
  let contextNodeId: string | null = $state(null)
  let contextLinkId: string | null = $state(null)

  let isDraggingNode = false
  let isDraggingLine = false
  let isUserInteracting = false
  let dragFrom: { nodeId: string; type: string } | null = null
  let dragNodeId: string | null = null
  let dragOffset = { x: 0, y: 0 }
  let isPanning = false
  let panStart = { x: 0, y: 0 }
  let mounted = false
  let showAddModal = $state(false)
  let showConsoleTree = $state(false)
  let consoleTreeData: any = $state(null)
  let consoleTreeTitle = $state('')

  const typeIcons: Record<string, string> = {
  calc: 'fa-calculator',
    weather: 'fa-cloud-sun', inverter: 'fa-solar-panel', tuya: 'fa-plug', predictor: 'fa-brain',
    action: 'fa-terminal', else: 'fa-code-branch', timer: 'fa-hourglass-half',
    logic: 'fa-microchip', label: 'fa-font', merge: 'fa-code-merge',
    execute: 'fa-circle-play', console: 'fa-display'
  }
  const typeColors: Record<string, string> = {
  calc: 'text-orange-400',
    weather: 'text-blue-400', inverter: 'text-orange-400', tuya: 'text-purple-400', predictor: 'text-cyan-400',
    action: 'text-green-400', else: 'text-amber-400', timer: 'text-cyan-400',
    logic: 'text-teal-400', label: 'text-pink-400', merge: 'text-indigo-400',
    execute: 'text-emerald-400', console: 'text-slate-400'
  }
  const typeDescriptions: Record<string, string> = {
    calc: 'Wyrażenie JS', weather: 'Dane pogodowe', inverter: 'Parametr inwertera',
    tuya: 'Urządzenie Tuya', predictor: 'Predykcja PV', action: 'Akcja wyjścia',
    else: 'W przeciwnym razie', timer: 'Czasomierz', logic: 'Bramka logiczna',
    label: 'Etykieta grupująca', merge: 'Scalenie sygnałów', execute: 'Wykonaj grupę',
    console: 'Podgląd danych'
  }

  onMount(() => {
    mounted = true
    panX = parseFloat(localStorage.getItem('flow_pan_x') || '0')
    panY = parseFloat(localStorage.getItem('flow_pan_y') || '0')
    zoom = parseFloat(localStorage.getItem('flow_zoom') || '1.0')
    renderCanvas()
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    if (canvasEl) canvasEl.addEventListener('wheel', onWheel, { passive: false })
    addDelegatedEvents()
  })

  onDestroy(() => {
    mounted = false
    stopAllTimers()
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  })

  let initialRenderDone = $state(false)
  $effect(() => {
    const state = $automationState
    if (mounted && state) {
      if (!initialRenderDone || !nodesContainer?.querySelector('[data-node-id]')) {
        initialRenderDone = true
        renderCanvas()
      } else {
        updateDisplayedValues(state)
        drawConnections()
      }
    }
  })

  function addDelegatedEvents() {
    if (!nodesContainer) return
    nodesContainer.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      const toggle = target.closest('.node-toggle') as HTMLElement
      if (toggle) {
        const el = toggle.closest('[data-node-id]') as HTMLElement
        if (!el) return
        const id = el.dataset.nodeId as string
        toggleNode(id)
      }
      const conBtn = target.closest('.console-expand-btn') as HTMLElement
      if (conBtn) {
        const id = conBtn.dataset.consoleId as string
        const name = conBtn.dataset.nodeName || id
        openConsoleTree(id, name)
      }
    })
    nodesContainer.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement
      const socket = target.closest('.socket') as HTMLElement
      const nodeEl = target.closest('[data-node-id]') as HTMLElement
      if (socket && nodeEl) {
        const type = socket.classList.contains('socket-out') ? 'out' : 'in'
        startSocketDrag(e, nodeEl.dataset.nodeId as string, type)
      } else if (nodeEl) {
        const t = e.target as HTMLElement
        if (t.closest('.node-toggle') || t.closest('.socket')) return
        startNodeDrag(e, nodeEl.dataset.nodeId as string)
      }
    })
    nodesContainer.addEventListener('dblclick', (e) => {
      const target = e.target as HTMLElement
      const nodeEl = target.closest('[data-node-id]') as HTMLElement
      if (nodeEl) { e.stopPropagation(); selectNode(nodeEl.dataset.nodeId as string) }
    })
    nodesContainer.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation()
      const target = e.target as HTMLElement
      const nodeEl = target.closest('[data-node-id]') as HTMLElement
      const linkEl = target.closest('.flow-line-hit') as HTMLElement
      if (linkEl) {
        const linkId = linkEl.dataset.linkId
        if (linkId) showContextMenu(e.clientX, e.clientY, null, linkId)
      } else if (nodeEl) {
        showContextMenu(e.clientX, e.clientY, nodeEl.dataset.nodeId as string, null)
      } else {
        showContextMenu(e.clientX, e.clientY, '__add__', null)
      }
    })
    nodesContainer.addEventListener('mouseup', (e) => {
      const target = e.target as HTMLElement
      const socket = target.closest('.socket') as HTMLElement
      const nodeEl = target.closest('[data-node-id]') as HTMLElement
      if (socket && nodeEl) {
        const type = socket.classList.contains('socket-in') ? 'in' : 'out'
        endSocketDrag(nodeEl.dataset.nodeId as string, type)
      }
    })
  }

  function updateDisplayedValues(state: any) {
    if (!nodesContainer) return
    for (const id of Object.keys(state.nodes || {})) {
      const el = nodesContainer.querySelector(`[data-node-id="${id}"]`) as HTMLElement
      if (!el) continue
      const node = state.nodes[id]
      const sourceId = node.type === 'tuya' ? node.id : (node.config?.device_id || node.id)
      const sourceNode = state.nodes[sourceId]
      let dps = sourceNode?.data?.dps_translated || node.data?.dps_translated || {}
      if (node.type === 'tuya' && Object.keys(dps).length === 0 && state.tuya_devices) {
        const tuyaDev = Object.values(state.tuya_devices).find(
          (d: any) => d.tuya_device_id === node.config?.device_id || d.internal_app_id === node.config?.device_id
        )
        if (tuyaDev) dps = tuyaDev.last_dps_translated || tuyaDev.last_dps || {}
      }

      // Update toggle button
      const toggle = el.querySelector('.node-toggle') as HTMLElement
      const enabled = node.config?.enabled !== false
      if (toggle) {
        toggle.className = `node-toggle ${enabled ? 'toggle-on' : 'toggle-off'}`
        toggle.textContent = enabled ? 'ON' : 'OFF'
      }
      el.querySelector('.node-inner')?.classList.toggle('disabled', !enabled)

      // Update LCD
      const lcd = el.querySelector('.node-lcd') as HTMLElement
      if (lcd && !lcd.classList.contains('timer-countdown')) {
        lcd.textContent = node.lastVal || '---'
      }

      // Update DPS value
      const dpsVal = el.querySelector('.node-dps-val') as HTMLElement
      if (dpsVal && node.config?.par && dps[node.config.par] !== undefined) {
        const v = dps[node.config.par]
        dpsVal.textContent = `${node.config.par}: ${typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : v}`
      }

      // Update online status
      const status = el.querySelector('.node-status-sm') as HTMLElement
      if (status) {
        const isOnline = sourceNode?.data?.online ?? node.data?.online
        if (isOnline !== undefined) {
          status.textContent = isOnline ? '● ONLINE' : '○ OFFLINE'
          status.className = `node-status-sm ${isOnline ? 'text-green-600' : 'text-slate-600'}`
        }
      }

      // Update relay state
      const relayState = el.querySelector('.node-relay-state') as HTMLElement
      if (relayState) {
        const dpsIdx = node.config?.dps_control || 1
        const rawDps = sourceNode?.data?.dps || node.data?.dps || {}
        let deviceDps: Record<string, any> = rawDps
        if (Object.keys(deviceDps).length === 0 && state.tuya_devices) {
          const tuyaDev = Object.values(state.tuya_devices).find(
            (d: any) => d.tuya_device_id === node.config?.device_id || d.internal_app_id === node.config?.device_id
          )
          if (tuyaDev) deviceDps = tuyaDev.last_dps || {}
        }
        const relayOn = deviceDps[String(dpsIdx)] === true
        relayState.textContent = relayOn ? '⚡ WŁĄCZONE' : '○ WYŁĄCZONE'
        relayState.className = `node-relay-state ${relayOn ? 'on' : 'off'}`
      }

      // Update console expand button
      if (node.type === 'console') {
        const existingBtn = el.querySelector('.console-expand-btn') as HTMLElement
        const hasJson = node.data?.consoleInput !== null && node.data?.consoleInput !== undefined && typeof node.data?.consoleInput === 'object'
        if (hasJson && !existingBtn) {
          const btn = document.createElement('button')
          btn.className = 'console-expand-btn'
          btn.dataset.consoleId = id
          btn.dataset.nodeName = node.name
          btn.innerHTML = '<i class="fas fa-tree"></i> JSON TREE'
          el.querySelector('.node-inner')?.appendChild(btn)
        } else if (!hasJson && existingBtn) {
          existingBtn.remove()
        }
      }

      // Update action log
      const logBox = el.querySelector('.node-log-box') as HTMLElement
      if (logBox && node.type === 'action') {
        logBox.textContent = node.data?.log || 'NO SIGNAL'
      }

      // Update execute stats
      const stats = el.querySelector('.node-stats') as HTMLElement
      if (stats && node.type === 'execute') {
        const d = node.data || {}
        const lastFire = d._lastFireTime ? new Date(d._lastFireTime).toLocaleTimeString() : '---'
        const count = d._fireCount || 0
        const statusEl = el.querySelector('.font-bold') as HTMLElement
        if (statusEl) {
          statusEl.textContent = node.lastVal === '🔥 EXECUTE' ? '🔥 FIRING' : (node.lastVal || 'WAITING')
        }
        stats.innerHTML = `<span>⏱ ${lastFire}</span><span>#${count}</span>`
      }
    }

    // Restart timer intervals for timer nodes
    for (const id of Object.keys(state.nodes || {})) {
      const node = state.nodes[id]
      if (node.type === 'timer') {
        const el = nodesContainer.querySelector(`[data-node-id="${id}"]`) as HTMLElement
        if (el) startTimer(id, node)
      }
    }
  }

  function renderCanvas() {
    if (!nodesContainer || !svgLayer || !hitsLayer || !canvasEl) return
    const state = $automationState
    if (!state?.nodes) return

    // Ensure SVG dimensions match container
    const wrapperRect = canvasEl.parentElement?.getBoundingClientRect()
    if (wrapperRect) {
      svgLayer.setAttribute('width', String(wrapperRect.width))
      svgLayer.setAttribute('height', String(wrapperRect.height))
      hitsLayer.setAttribute('width', String(wrapperRect.width))
      hitsLayer.setAttribute('height', String(wrapperRect.height))
    }

    // Clear
    stopAllTimers()
    const existingNodes = nodesContainer.querySelectorAll('[data-node-id]')
    existingNodes.forEach(el => el.remove())
    hitsLayer.innerHTML = ''
    const lines = svgLayer.querySelectorAll('.flow-line')
    lines.forEach(el => el.remove())

    let zIdx = 10
    for (const id of Object.keys(state.nodes)) {
      const node = state.nodes[id]
      const div = document.createElement('div')
      div.className = 'flow-node'
      div.style.transform = `translate3d(${node.x}px, ${node.y}px, 0)`
      div.style.zIndex = String(zIdx++)
      if (id === selectedId) div.classList.add('selected')
      div.dataset.nodeId = id

      const hasOut = !['action', 'label', 'execute'].includes(node.type)
      const hasIn = !['inverter', 'weather', 'predictor', 'label'].includes(node.type)

      div.innerHTML = buildNodeHTML(id, node, state)
      div.addEventListener('dblclick', (e) => {
        e.preventDefault(); e.stopPropagation()
        openEditPanel(id)
      })
      // Sockets
      if (hasIn) {
        const s = document.createElement('div')
        s.className = 'socket socket-in'
        div.appendChild(s)
      }
      if (hasOut) {
        const s = document.createElement('div')
        s.className = 'socket socket-out'
        div.appendChild(s)
      }

      nodesContainer.appendChild(div)
      if (node.type === 'timer') startTimer(id, node)
    }

    applyTransform()
    requestAnimationFrame(() => drawConnections())
  }

  function buildNodeHTML(id: string, node: any, state: any): string {
    const enabled = node.config?.enabled !== false
    const icon = typeIcons[node.type] || 'fa-circle'
    const color = typeColors[node.type] || 'text-slate-600'
    const sourceId = node.type === 'tuya' ? node.id : (node.config?.device_id || node.id)
    const sourceNode = state.nodes[sourceId]
    let dps = sourceNode?.data?.dps_translated || node.data?.dps_translated || {}
    if (node.type === 'tuya' && Object.keys(dps).length === 0 && state.tuya_devices) {
      const tuyaDev = Object.values(state.tuya_devices).find(
        (d: any) => d.tuya_device_id === node.config?.device_id || d.internal_app_id === node.config?.device_id
      )
      if (tuyaDev) dps = tuyaDev.last_dps_translated || tuyaDev.last_dps || {}
    }

    let html = `<div class="node-inner ${enabled ? '' : 'disabled'}">`
    html += `<div class="node-header"><i class="fas ${icon} ${color} text-[8px]"></i><span class="node-type-label">${node.type}</span>`
    const toggleOn = enabled ? 'ON' : 'OFF'
    const toggleCls = enabled ? 'toggle-on' : 'toggle-off'
    html += `<button class="node-toggle ${toggleCls}">${toggleOn}</button></div>`
    html += `<div class="node-name">${node.name}</div>`

    if (node.config?.par && dps[node.config.par] !== undefined) {
      const v = dps[node.config.par]
      html += `<div class="node-dps-val">${node.config.par}: ${typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : v}</div>`
    }

    if (node.type === 'inverter' || node.type === 'weather' || node.type === 'predictor') {
      const par = node.config?.par
      if (par) {
        const labels = node.data?.labels || {}
        const opMap: Record<string, string> = { gt: '>', lt: '<', eq: '==' }
        const parName = (labels[par] || par).replace(/_/g, ' ').toUpperCase()
        html += `<div class="node-badge">IF ${parName} ${opMap[node.config.op] || ''} ${node.config.threshold || 0}</div>`
      }
    }

    if (node.type === 'tuya' && node.config?.action_type) {
      const dpsIdx = node.config?.dps_control || 1
      const rawDps = sourceNode?.data?.dps || node.data?.dps || {}
      let deviceDps: Record<string, any> = rawDps
      if (Object.keys(deviceDps).length === 0 && state.tuya_devices) {
        const tuyaDev = Object.values(state.tuya_devices).find(
          (d: any) => d.tuya_device_id === node.config?.device_id || d.internal_app_id === node.config?.device_id
        )
        if (tuyaDev) deviceDps = tuyaDev.last_dps || {}
      }
      const relayOn = deviceDps[String(dpsIdx)] === true
      const isOnline = sourceNode?.data?.online ?? node.data?.online
      const onlineText = isOnline !== undefined ? (isOnline ? '● ONLINE' : '○ OFFLINE') : ''
      html += `<div class="node-relay-state ${relayOn ? 'on' : 'off'}">${relayOn ? '⚡ WŁĄCZONE' : '○ WYŁĄCZONE'}</div>`
      html += `<div class="node-lcd">${node.lastVal || '---'}</div>`
      if (onlineText) html += `<div class="node-status-sm ${isOnline ? 'text-green-600' : 'text-slate-600'}">${onlineText}</div>`
    }

    if (['action', 'else', 'merge', 'logic', 'timer', 'execute', 'calc', 'console'].includes(node.type) || (!['inverter', 'weather', 'tuya', 'predictor', 'label'].includes(node.type))) {
      html += `<div class="node-lcd">${node.lastVal || '---'}</div>`
    }

    if (node.type === 'console') {
      const hasJson = node.data?.consoleInput !== null && node.data?.consoleInput !== undefined && typeof node.data?.consoleInput === 'object'
      if (hasJson) {
        html += `<button class="console-expand-btn" data-console-id="${id}" data-node-name="${node.name}"><i class="fas fa-tree"></i> JSON TREE</button>`
      }
    }

    if (node.type === 'action') {
      html += `<div class="node-log-box">${node.data?.log || 'NO SIGNAL'}</div>`
    }

    if (node.type === 'merge') {
      const inCount = (state.links || []).filter((l: any) => l.toNode === id).length
      html += `<div class="node-badge text-indigo-400/60">↓ ${inCount} WEJŚĆ</div>`
    }

    if (node.type === 'logic') {
      const mode = (node.config?.mode || 'and').toUpperCase()
      const inCount = (state.links || []).filter((l: any) => l.toNode === id).length
      html += `<div class="node-badge text-teal-400/60">${mode} (${inCount} WEJŚĆ)</div>`
    }

    if (node.type === 'timer') {
      const mode = node.config?.mode || 'countdown'
      let ml = '⏱ COUNTDOWN'
      if (mode === 'schedule') ml = '🕐 ' + (node.config?.schedule_time || '--:--')
      else if (mode === 'window') ml = '🪟 ' + (node.config?.window_start || '--:--') + ' - ' + (node.config?.window_end || '--:--')
      if (mode === 'countdown' && node.config?.trigger_on_input !== false) html += `<div class="node-badge text-cyan-400/60">TRIGGER (IN)</div>`
      html += `<div class="node-badge text-purple-400/60">${ml}</div>`
      if ((mode === 'countdown' || mode === 'schedule') && node.config?.loop === true) html += `<div class="node-badge text-pink-400/80">↻ LOOP</div>`
      html += `<div class="timer-countdown node-lcd">${node.lastVal || '---'}</div>`
    }

    if (node.type === 'execute') {
      const d = node.data || {}
      const lastFire = d._lastFireTime ? new Date(d._lastFireTime).toLocaleTimeString() : '---'
      const count = d._fireCount || 0
      const status = node.lastVal === '🔥 EXECUTE' ? '🔥 FIRING' : (node.lastVal || 'WAITING')
      html += `<div class="font-bold" style="font-size:10px;color:#34d399;text-align:center">${status}</div>`
      html += `<div class="node-stats"><span>⏱ ${lastFire}</span><span>#${count}</span></div>`
    }

    return html
  }

  function drawConnections() {
    if (!svgLayer || !hitsLayer) return
    const state = $automationState
    if (!state?.links) return

    svgLayer.querySelectorAll('.flow-line, .flow-dot').forEach(el => el.remove())
    hitsLayer.innerHTML = ''

    state.links.forEach((link: any) => {
      const from = state.nodes[link.fromNode]
      const to = state.nodes[link.toNode]
      if (!from || !to) return

      const elFrom = nodesContainer.querySelector(`[data-node-id="${link.fromNode}"]`)
      const elTo = nodesContainer.querySelector(`[data-node-id="${link.toNode}"]`)
      
      let x1: number, y1: number, x2: number, y2: number

      if (elFrom) {
        const rect = (elFrom as HTMLElement).getBoundingClientRect()
        const socket = elFrom.querySelector('.socket-out')
        if (socket) {
          const sRect = socket.getBoundingClientRect()
          x1 = from.x + (sRect.left - rect.left + sRect.width / 2) / zoom
          y1 = from.y + (sRect.top - rect.top + sRect.height / 2) / zoom
        } else {
          x1 = from.x + 180
          y1 = from.y + 40
        }
      } else { x1 = from.x + 180; y1 = from.y + 40 }

      if (elTo) {
        const rect = (elTo as HTMLElement).getBoundingClientRect()
        const socket = elTo.querySelector('.socket-in')
        if (socket) {
          const sRect = socket.getBoundingClientRect()
          x2 = to.x + (sRect.left - rect.left + sRect.width / 2) / zoom
          y2 = to.y + (sRect.top - rect.top + sRect.height / 2) / zoom
        } else {
          x2 = to.x
          y2 = to.y + 40
        }
      } else { x2 = to.x; y2 = to.y + 40 }

      const dx = Math.abs(x1 - x2) * 0.4
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      line.setAttribute('d', d); line.setAttribute('class', 'flow-line')
      line.style.pointerEvents = 'none'
      svgLayer.appendChild(line)

      // Animated dot for active links (source node lastVal is truthy)
      const lv = (from as any)?.lastVal || ''
      const active = !lv.includes('FALSE') && !lv.includes('WAITING') && !lv.includes('✖') && lv.length > 0
      if (active) {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        dot.setAttribute('class', 'flow-dot')
        dot.setAttribute('r', '4')
        dot.setAttribute('fill', '#22c55e')
        const motion = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion')
        motion.setAttribute('dur', '1.5s')
        motion.setAttribute('repeatCount', 'indefinite')
        motion.setAttribute('path', d)
        dot.appendChild(motion)
        svgLayer.appendChild(dot)
      }

      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      hit.setAttribute('d', d); hit.setAttribute('fill', 'none')
      hit.setAttribute('stroke', 'transparent'); hit.setAttribute('stroke-width', '20')
      hit.style.cursor = 'pointer'; hit.style.pointerEvents = 'all'
      hit.addEventListener('mouseenter', () => line.classList.add('flow-line-hover'))
      hit.addEventListener('mouseleave', () => line.classList.remove('flow-line-hover'))
      hit.addEventListener('click', () => deleteLink(link.id))
      hit.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showContextMenu(e.clientX, e.clientY, null, link.id) })
      hitsLayer.appendChild(hit)
    })
  }

  let isFullscreen = $state(false)
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      canvasWrapper?.requestFullscreen()
      isFullscreen = true
    } else {
      document.exitFullscreen()
      isFullscreen = false
    }
  }
  onMount(() => {
    const fsChange = () => { isFullscreen = !!document.fullscreenElement }
    document.addEventListener('fullscreenchange', fsChange)
    return () => document.removeEventListener('fullscreenchange', fsChange)
  })

  function applyTransform() {
    if (!canvasEl) return
    canvasEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`
    canvasEl.style.transformOrigin = '0 0'
    localStorage.setItem('flow_pan_x', String(panX))
    localStorage.setItem('flow_pan_y', String(panY))
    localStorage.setItem('flow_zoom', String(zoom))
  }

  function getSocketPos(nodeId: string, type: string) {
    const el = nodesContainer.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement
    const sr = canvasEl.getBoundingClientRect()
    if (!el) {
      const n = $automationState?.nodes?.[nodeId]
      return n ? { x: type === 'out' ? n.x + 160 : n.x, y: n.y + 40 } : { x: 0, y: 0 }
    }
    const rect = el.getBoundingClientRect()
    return {
      x: type === 'out' ? (rect.right - sr.left) / zoom : (rect.left - sr.left) / zoom,
      y: (rect.top - sr.top + rect.height / 2) / zoom
    }
  }

  // --- Drag handlers ---
  function startNodeDrag(e: MouseEvent, id: string) {
    if (e.button !== 0) return
    e.stopPropagation()
    isDraggingNode = true; dragNodeId = id
    const el = nodesContainer.querySelector(`[data-node-id="${id}"]`) as HTMLElement
    if (el) { const r = el.getBoundingClientRect(); dragOffset = { x: e.clientX - r.left, y: e.clientY - r.top } }
    isUserInteracting = true
  }

  function startSocketDrag(e: MouseEvent, nodeId: string, type: string) {
    e.stopPropagation()
    if (e.button !== 0) return
    isDraggingLine = true; dragFrom = { nodeId, type }; isUserInteracting = true
  }

  function endSocketDrag(nodeId: string, type: string) {
    if (!isDraggingLine || !dragFrom || dragFrom.nodeId === nodeId) return
    if (dragFrom.type === 'out' && type === 'in') createLink(dragFrom.nodeId, nodeId)
    else if (dragFrom.type === 'in' && type === 'out') createLink(nodeId, dragFrom.nodeId)
  }

  function onMouseMove(e: MouseEvent) {
    if (isDraggingNode && dragNodeId) {
      const sr = canvasEl.getBoundingClientRect()
      const x = (e.clientX - sr.left - dragOffset.x) / zoom
      const y = (e.clientY - sr.top - dragOffset.y) / zoom
      const state = $automationState
      if (state?.nodes?.[dragNodeId]) {
        state.nodes[dragNodeId].x = Math.max(0, x); state.nodes[dragNodeId].y = Math.max(0, y)
        const el = nodesContainer.querySelector(`[data-node-id="${dragNodeId}"]`) as HTMLElement
        if (el) el.style.transform = `translate3d(${x}px, ${y}px, 0)`
        drawConnections()
      }
    }
    if (isDraggingLine && dragFrom) {
      const sr = canvasEl.getBoundingClientRect()
      const p1 = getSocketPos(dragFrom.nodeId, dragFrom.type)
      const x2 = (e.clientX - sr.left) / zoom; const y2 = (e.clientY - sr.top) / zoom
      dragLine = `M ${p1.x} ${p1.y} L ${x2} ${y2}`
    }
    if (isPanning) {
      panX = e.clientX - panStart.x; panY = e.clientY - panStart.y
      applyTransform()
    }
  }

  function onMouseUp() {
    if (isDraggingNode) {
      isDraggingNode = false; dragNodeId = null
      if (dragNodeId) savePositions(true)
    }
    if (isDraggingLine) {
      isDraggingLine = false; dragFrom = null; dragLine = ''
    }
    isPanning = false
    releaseInteraction()
  }

  function onCanvasMouseDown(e: MouseEvent) {
    if (e.target === canvasEl || (e.target as HTMLElement).closest('.canvas-bg')) {
      isPanning = true; panStart = { x: e.clientX - panX, y: e.clientY - panY }
    }
  }

  function onCanvasClick(e: MouseEvent) {
    if (e.target === canvasEl || (e.target as HTMLElement).closest('.canvas-bg')) {
      selectedId = null; if (editPanelOpen) closeEditPanel()
    }
  }

  let wheelAccum = 0
  function onWheel(e: WheelEvent) {
    e.preventDefault()
    wheelAccum += e.deltaY
    const steps = Math.round(wheelAccum / 30)
    if (steps === 0) return
    wheelAccum -= steps * 30
    zoom = Math.max(0.3, Math.min(3, zoom * Math.pow(1.08, -steps)))
    applyTransform()
  }

  function createLink(fromId: string, toId: string) {
    if (fromId === toId) return
    const state = $automationState; if (!state) return
    if (state.links.find((l: any) => l.fromNode === fromId && l.toNode === toId)) return
    state.links.push({ id: `link-${Date.now()}`, fromNode: fromId, toNode: toId })
    automationState.set(state); drawConnections()
  }

  function deleteLink(id: string) {
    const state = $automationState; if (!state) return
    state.links = state.links.filter((l: any) => l.id !== id)
    automationState.set(state); drawConnections()
  }
  function toggleNode(id: string) {
    const state = $automationState; if (!state?.nodes?.[id]) return
    const n = state.nodes[id]; if (!n.config) n.config = {}
    n.config.enabled = n.config.enabled === false
    automationState.set(state); renderCanvas()
  }

  function selectNode(id: string) {
    selectedId = id; renderCanvas(); openEditPanel(id)
  }

  async function openEditPanel(id: string) {
    editPanelOpen = true; isUserInteracting = true; selectedId = id
    await tick()
    if (editContent && $automationState?.nodes?.[id]) {
      editContent.innerHTML = buildEditPanelHTML(id)
    }
  }

  function closeEditPanel() { editPanelOpen = false; selectedId = null; releaseInteraction() }

  function releaseInteraction() { setTimeout(() => { isUserInteracting = false }, 300) }

  function buildEditPanelHTML(id: string): string {
    const node = $automationState?.nodes?.[id]; if (!node) return ''
    const config = node.config || {}
    const isEnabled = config.enabled !== false
    let html = '<div class="space-y-4">'
    
    // Header with enabled toggle
    html += `<div class="flex items-center justify-between px-2 py-3 bg-slate-950/60 rounded-xl border border-slate-800">
      <span class="text-[9px] uppercase font-black text-slate-500 tracking-widest">Moduł aktywny</span>
      <button id="edit-node-enabled" class="text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded border ${isEnabled ? 'bg-teal-500/20 text-teal-400 border-teal-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}" onclick="this.textContent = this.textContent === 'ON' ? 'OFF' : 'ON'; this.className = 'text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded border ' + (this.textContent === 'ON' ? 'bg-teal-500/20 text-teal-400 border-teal-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30')">${isEnabled ? 'ON' : 'OFF'}</button>
    </div>`

    if (node.type !== 'label') {
      html += `<div><label class="text-[9px] uppercase font-black text-slate-500 tracking-widest block mb-2">Nazwa Bloku</label><input type="text" id="edit-node-name" value="${node.name}" class="edit-input"></div>`
      
      // Type selection
      const types = ['logic', 'inverter', 'weather', 'predictor', 'timer', 'tuya', 'action', 'else', 'merge', 'execute', 'calc', 'console']
      html += `<div><label class="text-[9px] uppercase font-black text-slate-500 tracking-widest block mb-2">Typ Bloku</label><select id="edit-node-type" class="edit-input">`
      types.forEach(t => html += `<option value="${t}" ${node.type === t ? 'selected' : ''}>${t.toUpperCase()}</option>`)
      html += `</select></div>`
    }

    // Source specific config
    if (['inverter', 'weather', 'predictor', 'bms', 'tuya'].includes(node.type)) {
      const data = node.data || {}
      const labels = data.labels || {}
      const params = Object.keys(data).filter(k => k !== 'labels' && k !== 'forecast' && !k.startsWith('_'))
      
      html += `<div><label class="text-[9px] uppercase font-black text-slate-500 tracking-widest block mb-2">Parametr</label><select id="edit-node-par" class="edit-input">`
      html += `<option value="">-- wybierz --</option>`
      params.forEach(p => html += `<option value="${p}" ${config.par === p ? 'selected' : ''}>${labels[p] || p}</option>`)
      html += `</select></div>`

      html += `<div class="grid grid-cols-2 gap-3">
        <div><label class="text-[9px] uppercase font-black text-slate-500 tracking-widest block mb-2">Operator</label><select id="edit-node-op" class="edit-input">
          <option value="gt" ${config.op === 'gt' ? 'selected' : ''}>Większy niż (>)</option>
          <option value="lt" ${config.op === 'lt' ? 'selected' : ''}>Mniejszy niż (<)</option>
          <option value="eq" ${config.op === 'eq' ? 'selected' : ''}>Równy (==)</option>
          <option value="none" ${config.op === 'none' ? 'selected' : ''}>Brak (pobierz wartość)</option>
        </select></div>
        <div><label class="text-[9px] uppercase font-black text-slate-500 tracking-widest block mb-2">Próg</label><input type="number" id="edit-node-threshold" value="${config.threshold || 0}" step="0.1" class="edit-input"></div>
      </div>`

      html += `<div><label class="text-[9px] uppercase font-black text-slate-500 tracking-widest block mb-2">Histereza (±)</label><input type="number" id="edit-node-hysteresis" value="${config.hysteresis || 0}" step="0.1" class="edit-input"></div>`
    }

    if (node.type === 'logic') {
      html += `<div><label class="text-[9px] uppercase font-black text-slate-500 tracking-widest block mb-2">Tryb Logiczny</label><select id="edit-node-logic-mode" class="edit-input">
        <option value="and" ${config.mode === 'and' ? 'selected' : ''}>Wszystkie prawdziwe (AND)</option>
        <option value="or" ${config.mode === 'or' ? 'selected' : ''}>Którykolwiek prawdziwy (OR)</option>
      </select></div>`
    }

    if (node.type === 'timer') {
      const modes = ['countdown', 'window', 'schedule', 'tariff_offpeak', 'tariff_peak']
      html += `<div><label class="text-[9px] uppercase font-black text-slate-500 tracking-widest block mb-2">Tryb Timera</label><select id="edit-node-timer-mode" class="edit-input">`
      modes.forEach(m => html += `<option value="${m}" ${config.mode === m ? 'selected' : ''}>${m.toUpperCase()}</option>`)
      html += `</select></div>`
      
      html += `<div><label class="text-[9px] uppercase font-black text-slate-500 tracking-widest block mb-2">Czas (min) / Okno</label>
        <div class="flex gap-2">
          <input type="number" id="edit-node-timer-duration" value="${config.duration_minutes || 0}" class="edit-input w-1/3">
          <input type="text" id="edit-node-timer-start" value="${config.window_start || config.schedule_time || '00:00'}" class="edit-input w-1/3">
          <input type="text" id="edit-node-timer-end" value="${config.window_end || '00:00'}" class="edit-input w-1/3">
        </div>
      </div>`
      const isCountdownOrSchedule = config.mode === 'countdown' || config.mode === 'schedule'
      html += `<div class="flex gap-4">
        <label class="flex items-center gap-2"><input type="checkbox" id="edit-node-timer-trigger" ${config.trigger_on_input !== false ? 'checked' : ''} class="edit-checkbox"> <span class="text-[9px] uppercase font-black text-slate-500 tracking-widest">Start na IN</span></label>
        <label class="flex items-center gap-2"><input type="checkbox" id="edit-node-timer-loop" ${config.loop === true ? 'checked' : ''} class="edit-checkbox"> <span class="text-[9px] uppercase font-black text-slate-500 tracking-widest">↻ Pętla</span></label>
      </div>`
    }

    if (node.type === 'tuya') {
      const stateDevices = Object.values($automationState?.tuya_devices || {})
      const currentDeviceId = config.device_id || ''
      const currentDevice = stateDevices.find((d: any) => d.internal_app_id === currentDeviceId || d.tuya_device_id === currentDeviceId)
      html += `<div><label class="text-[9px] uppercase font-black text-slate-500 tracking-widest block mb-2">Urządzenie</label><select id="edit-node-tuya-device" class="edit-input">
        <option value="">-- wybierz --</option>
        ${stateDevices.map((d: any) => `<option value="${d.internal_app_id}" ${currentDevice?.internal_app_id === d.internal_app_id ? 'selected' : ''}>${d.name}</option>`).join('')}
      </select></div>`
      const dpsOptions = ['1', '9', '18', '19', '20', '38', '41']
      html += `<div><label class="text-[9px] uppercase font-black text-slate-500 tracking-widest block mb-2">Sterowanie DPS</label><select id="edit-node-tuya-dps" class="edit-input">
        ${dpsOptions.map(v => `<option value="${v}" ${String(config.dps_control || 1) === v ? 'selected' : ''}>DPS ${v}</option>`).join('')}
      </select></div>`
      html += `<div><label class="text-[9px] uppercase font-black text-slate-500 tracking-widest block mb-2">Źródło sygnału</label>
        <div class="flex gap-2">
          <button type="button" class="btn-option ${config.input_source !== 'node' ? 'btn-option-active' : ''}" onclick="this.parentElement.querySelectorAll('.btn-option').forEach(b=>b.classList.remove('btn-option-active'));this.classList.add('btn-option-active');document.getElementById('edit-node-tuya-source').value='device'">Parametr urządzenia</button>
          <button type="button" class="btn-option ${config.input_source === 'node' ? 'btn-option-active' : ''}" onclick="this.parentElement.querySelectorAll('.btn-option').forEach(b=>b.classList.remove('btn-option-active'));this.classList.add('btn-option-active');document.getElementById('edit-node-tuya-source').value='node'">Wejście z noda</button>
        </div>
        <input type="hidden" id="edit-node-tuya-source" value="${config.input_source || 'device'}">
      </div>`
      html += `<div><label class="text-[9px] uppercase font-black text-slate-500 tracking-widest block mb-2">Typ Akcji</label><select id="edit-node-tuya-action" class="edit-input">
        <option value="turn_on" ${config.action_type === 'turn_on' ? 'selected' : ''}>Włącz (ON)</option>
        <option value="turn_off" ${config.action_type === 'turn_off' ? 'selected' : ''}>Wyłącz (OFF)</option>
        <option value="toggle" ${config.action_type === 'toggle' ? 'selected' : ''}>Przełącz (TOGGLE)</option>
      </select></div>`
      html += `<button type="button" class="btn btn-teal text-[9px] w-full mt-2" id="edit-node-tuya-sync-btn" onclick="fetch('/automation/tuya/import',{method:'POST'}).then(()=>{this.textContent='✅ Zsynchronizowano'})"><i class="fa-solid fa-cloud-bolt"></i> Synch. chmurę</button>`
    }

    html += '</div>'
    return html
  }

  // --- Context menu ---
  function showContextMenu(x: number, y: number, nodeId: string | null, linkId: string | null) {
    hideContextMenu()
    contextNodeId = nodeId; contextLinkId = linkId
    if (!contextMenu) return
    const isAdd = nodeId === '__add__'
    const isNode = !!nodeId && !isAdd
    const isLink = !!linkId
    ;['ctx-edit', 'ctx-duplicate', 'ctx-delete'].forEach(cls => {
      const el = contextMenu.querySelector('.' + cls) as HTMLElement
      if (el) el.style.display = isNode ? 'flex' : 'none'
    })
    const addEl = contextMenu.querySelector('.ctx-add') as HTMLElement
    if (addEl) addEl.style.display = isAdd ? 'flex' : 'none'
    const addDiv = contextMenu.querySelector('.ctx-add-divider') as HTMLElement
    if (addDiv) addDiv.style.display = isAdd ? 'block' : 'none'
    const delLink = contextMenu.querySelector('.ctx-delete-link') as HTMLElement
    if (delLink) delLink.style.display = isLink ? 'flex' : 'none'
    contextMenu.style.left = x + 'px'; contextMenu.style.top = y + 'px'
    contextMenu.classList.remove('hidden')
    setTimeout(() => { document.addEventListener('click', hideContextMenu, { once: true }) }, 10)
  }

  function ctxAddNode() {
    hideContextMenu()
    showAddNodeModal()
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return { destroy() { if (node.parentNode) node.remove() } }
  }

  function hideContextMenu() { if (contextMenu) contextMenu.classList.add('hidden'); contextNodeId = null; contextLinkId = null }
  function ctxEdit() { const id = contextNodeId; hideContextMenu(); if (id) selectNode(id) }
  function ctxDuplicate() { const id = contextNodeId; hideContextMenu(); if (id) duplicateNode(id) }
  function ctxDelete() { const id = contextNodeId; hideContextMenu(); if (id) deleteNode(id) }
  function ctxDeleteLink() { const id = contextLinkId; hideContextMenu(); if (id) deleteLink(id) }

  function duplicateNode(id: string) {
    const state = $automationState; if (!state?.nodes?.[id]) return
    const orig = state.nodes[id]; const newId = `node-${Date.now()}`
    state.nodes[newId] = JSON.parse(JSON.stringify({ ...orig, id: newId, x: orig.x + 40, y: orig.y + 40 }))
    automationState.set(state); renderCanvas(); drawConnections(); savePositions(true)
  }

  function deleteNode(id: string) {
    const state = $automationState; if (!state?.nodes?.[id]) return
    delete state.nodes[id]
    state.links = state.links.filter((l: any) => l.fromNode !== id && l.toNode !== id)
    automationState.set(state); renderCanvas(); drawConnections(); savePositions(true)
  }

  async function savePositions(silent = false) {
    try {
      const state = $automationState
      await fetch('/automation/rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: state.nodes, links: state.links })
      })
    } catch {}
  }

  // --- Timer display ---
  const timerIntervals: Record<string, ReturnType<typeof setInterval>> = {}
  function startTimer(id: string, node: any) {
    if (timerIntervals[id]) { clearInterval(timerIntervals[id]); delete timerIntervals[id] }
    const config = node.config || {}; const data = node.data || {}
    const mode = config.mode || 'countdown'; const durationMs = (config.duration_minutes || 0) * 60 * 1000
    const update = () => {
      const el = nodesContainer?.querySelector(`[data-node-id="${id}"]`) as HTMLElement
      if (!el) { clearInterval(timerIntervals[id]); delete timerIntervals[id]; return }
      const lcd = el.querySelector('.timer-countdown') as HTMLElement; if (!lcd) return
      const now = Date.now()
      if (mode === 'window') {
        const nowDate = new Date()
        const cm = nowDate.getHours() * 60 + nowDate.getMinutes()
        const [sH, sM] = (config.window_start || '06:00').split(':').map(Number)
        const [eH, eM] = (config.window_end || '08:00').split(':').map(Number)
        const sm = sH * 60 + sM; const em = eH * 60 + eM
        const within = sm <= em ? (cm >= sm && cm < em) : (cm >= sm || cm < em)
        if (within) lcd.textContent = 'ACTIVE'
        else lcd.textContent = formatTimer((cm < sm ? sm - cm : (1440 - cm) + sm) * 60000)
        return
      }
      let remaining: number
      if (mode === 'schedule') {
        if (data._completed) { lcd.textContent = 'DONE'; clearInterval(timerIntervals[id]); delete timerIntervals[id]; return }
        const [h, m] = (config.schedule_time || '00:00').split(':').map(Number)
        const st = new Date(); st.setHours(h, m, 0, 0); const stMs = st.getTime()
        const tMs = now >= stMs ? stMs + 86400000 : stMs
        if (data._timerStart) remaining = Math.max(0, durationMs - (now - data._timerStart))
        else if (now >= stMs) remaining = 0
        else remaining = tMs - now
      } else {
        if (!data._timerStart || data._completed) { clearInterval(timerIntervals[id]); delete timerIntervals[id]; return }
        remaining = Math.max(0, durationMs - (now - data._timerStart))
      }
      if (remaining <= 0) { lcd.textContent = 'DONE'; clearInterval(timerIntervals[id]); delete timerIntervals[id] }
      else lcd.textContent = formatTimer(remaining)
    }
    update(); timerIntervals[id] = setInterval(update, 1000)
  }
  function stopAllTimers() { Object.keys(timerIntervals).forEach(id => { clearInterval(timerIntervals[id]); delete timerIntervals[id] }) }
  function formatTimer(ms: number): string {
    if (ms <= 0) return '0:00'
    const ts = Math.ceil(ms / 1000); const h = Math.floor(ts / 3600); const m = Math.floor((ts % 3600) / 60); const s = ts % 60
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
  }

  function addNodeOfType(type: string) {
    const state = $automationState; if (!state) return
    const id = `node-${Date.now()}`
    const count = Object.keys(state.nodes).length
    const offset = Math.min(count * 25, 300)
    const name = typeDescriptions[type] || type
    state.nodes[id] = { id, type: type as any, name: `Nowy ${name}`, config: {}, data: {}, x: 100 + offset, y: 100 + offset, lastUpdate: Date.now() }
    showAddModal = false
    automationState.set(state); renderCanvas(); drawConnections(); savePositions(true)
  }

  function showAddNodeModal() {
    showAddModal = true
  }

  function openConsoleTree(id: string, nodeName: string) {
    const state = $automationState
    const node = state?.nodes?.[id]
    if (!node) return
    consoleTreeData = node.data?.consoleInput ?? null
    consoleTreeTitle = nodeName || id
    showConsoleTree = true
  }

  function renderJsonTree(obj: any, depth = 0): string {
    if (depth > 8) return '<span class="json-truncated">...</span>'
    if (obj === null || obj === undefined) return '<span class="json-null">null</span>'
    if (typeof obj === 'boolean') return `<span class="json-bool">${obj}</span>`
    if (typeof obj === 'number') return `<span class="json-num">${obj}</span>`
    if (typeof obj === 'string') return `<span class="json-str">"${obj.replace(/"/g, '\\"')}"</span>`
    if (Array.isArray(obj)) {
      if (obj.length === 0) return '<span class="json-bracket">[]</span>'
      let items = obj.map((v, i) => `<div class="json-row" style="padding-left:${16 + depth * 16}px"><span class="json-key">${i}:</span> ${renderJsonTree(v, depth + 1)}</div>`).join('')
      return `<div class="json-block">${items}</div>`
    }
    if (typeof obj === 'object') {
      const keys = Object.keys(obj)
      if (keys.length === 0) return '<span class="json-bracket">{}</span>'
      let items = keys.map(k => `<div class="json-row" style="padding-left:${16 + depth * 16}px"><span class="json-key">${k}:</span> ${renderJsonTree(obj[k], depth + 1)}</div>`).join('')
      return `<div class="json-block">${items}</div>`
    }
    return String(obj)
  }

  async function saveNodeConfig(id: string) {
    const state = $automationState; const node = state?.nodes?.[id]; if (!node) return
    if (!node.config) node.config = {}
    
    const nameEl = document.getElementById('edit-node-name') as HTMLInputElement
    if (nameEl) node.name = nameEl.value

    const enabledEl = document.getElementById('edit-node-enabled') as HTMLButtonElement
    if (enabledEl) node.config.enabled = enabledEl.textContent === 'ON'

    const typeEl = document.getElementById('edit-node-type') as HTMLSelectElement
    if (typeEl) node.type = typeEl.value as any

    const parEl = document.getElementById('edit-node-par') as HTMLSelectElement
    if (parEl) node.config.par = parEl.value

    const opEl = document.getElementById('edit-node-op') as HTMLSelectElement
    if (opEl) node.config.op = opEl.value

    const threshEl = document.getElementById('edit-node-threshold') as HTMLInputElement
    if (threshEl) node.config.threshold = parseFloat(threshEl.value)

    const hystEl = document.getElementById('edit-node-hysteresis') as HTMLInputElement
    if (hystEl) node.config.hysteresis = parseFloat(hystEl.value)

    const logicModeEl = document.getElementById('edit-node-logic-mode') as HTMLSelectElement
    if (logicModeEl) node.config.mode = logicModeEl.value

    const timerModeEl = document.getElementById('edit-node-timer-mode') as HTMLSelectElement
    if (timerModeEl) node.config.mode = timerModeEl.value

    const timerDurEl = document.getElementById('edit-node-timer-duration') as HTMLInputElement
    if (timerDurEl) node.config.duration_minutes = parseInt(timerDurEl.value)

    const timerStartEl = document.getElementById('edit-node-timer-start') as HTMLInputElement
    if (timerStartEl) {
      if (node.config.mode === 'schedule') node.config.schedule_time = timerStartEl.value
      else node.config.window_start = timerStartEl.value
    }

    const timerEndEl = document.getElementById('edit-node-timer-end') as HTMLInputElement
    if (timerEndEl) node.config.window_end = timerEndEl.value

    const timerTriggerEl = document.getElementById('edit-node-timer-trigger') as HTMLInputElement
    if (timerTriggerEl) node.config.trigger_on_input = timerTriggerEl.checked

    const timerLoopEl = document.getElementById('edit-node-timer-loop') as HTMLInputElement
    if (timerLoopEl) node.config.loop = timerLoopEl.checked

    const tuyaDeviceEl = document.getElementById('edit-node-tuya-device') as HTMLSelectElement
    if (tuyaDeviceEl) node.config.device_id = tuyaDeviceEl.value

    const tuyaDpsEl = document.getElementById('edit-node-tuya-dps') as HTMLSelectElement
    if (tuyaDpsEl) node.config.dps_control = parseInt(tuyaDpsEl.value)

    const tuyaSourceEl = document.getElementById('edit-node-tuya-source') as HTMLInputElement
    if (tuyaSourceEl) node.config.input_source = tuyaSourceEl.value

    const tuyaActionEl = document.getElementById('edit-node-tuya-action') as HTMLSelectElement
    if (tuyaActionEl) node.config.action_type = tuyaActionEl.value

    isUserInteracting = true
    try { await savePositions(); renderCanvas(); drawConnections(); closeEditPanel() } catch {}
  }

  function refreshState() { isUserInteracting = false; renderCanvas() }
</script>

<div class="section-card">
  <div class="section-header">
    <h2 class="section-title">Visual Logic Flow</h2>
    <div class="flex gap-3">
      <button class="btn btn-blue" onclick={showAddNodeModal}><i class="fas fa-plus mr-1"></i> Dodaj Blok</button>
      <button class="btn btn-teal" onclick={() => savePositions(false)}><i class="fas fa-save mr-1"></i> Zapisz</button>
      <button class="btn btn-slate" onclick={toggleFullscreen}>
        <i class="fas {isFullscreen ? 'fa-compress' : 'fa-expand'} mr-1"></i> 
        {isFullscreen ? 'Zamknij' : 'Pełny ekran'}
      </button>
      <button class="btn btn-slate" onclick={refreshState} title="Odśwież widok"><i class="fas fa-sync-alt"></i></button>
    </div>
  </div>
  <div class="canvas-wrapper" bind:this={canvasWrapper} role="application" class:fullscreen={isFullscreen}>
    <div class="canvas-bg" bind:this={canvasEl} onmousedown={onCanvasMouseDown} onclick={onCanvasClick}>
      <svg class="svg-layer" bind:this={svgLayer}>
        <path d={dragLine} class="drag-line" style="display: {dragLine ? 'block' : 'none'}" />
      </svg>
      <div class="nodes-container" bind:this={nodesContainer}>
        <svg class="hits-layer" bind:this={hitsLayer}></svg>
      </div>
    </div>
  </div>
</div>

<!-- Context Menu -->
<div use:portal class="context-menu hidden" bind:this={contextMenu} onclick={(e) => e.stopPropagation()} oncontextmenu={(e) => e.preventDefault()}>
  <div class="ctx-item ctx-add" onclick={ctxAddNode}><i class="fas fa-plus text-[10px] w-4"></i> Dodaj blok</div>
  <div class="ctx-divider ctx-add-divider"></div>
  <div class="ctx-item ctx-edit" onclick={ctxEdit}><i class="fas fa-pen text-[10px] w-4"></i> Edytuj</div>
  <div class="ctx-item ctx-duplicate" onclick={ctxDuplicate}><i class="fas fa-copy text-[10px] w-4"></i> Duplikuj</div>
  <div class="ctx-item ctx-delete-link" onclick={ctxDeleteLink}><i class="fas fa-unlink text-[10px] w-4"></i> Usuń połączenie</div>
  <div class="ctx-divider"></div>
  <div class="ctx-item ctx-delete" onclick={ctxDelete}><i class="fas fa-trash text-[10px] w-4"></i> Usuń blok</div>
</div>

<!-- Edit Panel Overlay -->
{#if editPanelOpen}
  <div use:portal class="edit-overlay" bind:this={editOverlay} onclick={(e) => { if (e.target === editOverlay) closeEditPanel() }}>
    <div class="edit-panel">
      <div class="edit-panel-header">
        <span class="edit-panel-title">Edytuj: {selectedId ? ($automationState?.nodes?.[selectedId]?.name || selectedId) : ''}</span>
        <button class="edit-close" onclick={closeEditPanel}>✕</button>
      </div>
      <div class="edit-panel-body" bind:this={editContent}></div>
      <div class="edit-panel-footer">
        <button class="btn btn-blue" onclick={() => { if (selectedId) saveNodeConfig(selectedId) }}>Zapisz</button>
        <button class="btn btn-slate" onclick={closeEditPanel}>Anuluj</button>
      </div>
    </div>
  </div>
{/if}

<!-- Add Node Modal -->
{#if showAddModal}
  <div use:portal class="add-modal-overlay" onclick={(e) => { if (e.target.classList.contains('add-modal-overlay')) showAddModal = false }}>
    <div class="add-modal">
      <div class="add-modal-header">
        <span class="add-modal-title">Dodaj blok</span>
        <button class="edit-close" onclick={() => showAddModal = false}>✕</button>
      </div>
      <div class="add-modal-body">
        {#each Object.keys(typeIcons) as type}
          {@const t = type}
          <button class="add-type-item" onclick={() => addNodeOfType(t)}>
            <i class="fas {typeIcons[t]} {typeColors[t]} text-sm"></i>
            <div class="add-type-info">
              <span class="add-type-name">{t}</span>
              <span class="add-type-desc">{typeDescriptions[t] || ''}</span>
            </div>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<!-- Console JSON Tree Viewer -->
{#if showConsoleTree}
  <div use:portal class="add-modal-overlay" onclick={(e) => { if (e.target.classList.contains('add-modal-overlay')) { showConsoleTree = false; consoleTreeData = null } }}>
    <div class="console-tree-modal">
      <div class="add-modal-header">
        <span class="add-modal-title">JSON Tree: {consoleTreeTitle}</span>
        <button class="edit-close" onclick={() => { showConsoleTree = false; consoleTreeData = null }}>✕</button>
      </div>
      <div class="console-tree-body">
        {#if consoleTreeData !== null && consoleTreeData !== undefined}
          <div class="json-tree">{@html renderJsonTree(consoleTreeData)}</div>
        {:else}
          <div class="console-tree-empty">Brak danych</div>
        {/if}
      </div>
    </div>
  </div>
{/if}

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
  .btn { padding:10px 16px; border-radius:12px; font-size:10px; font-weight:900; text-transform:uppercase; border:none; cursor:pointer; transition:all .2s; }
  .btn-blue { background:#2563eb; color:white; }
  .btn-teal { background:#0d9488; color:white; }
  .btn-slate { background:#334155; color:white; }
  .btn:active { transform:scale(.95); }
  .canvas-wrapper { position:relative; overflow:hidden; min-height:550px; background-image:radial-gradient(circle,#1e293b 1px,transparent 1px); background-size:30px 30px; cursor:grab; }
  .canvas-wrapper.fullscreen { position:fixed; inset:0; z-index:9999; height:100vh !important; width:100vw !important; border-radius:0; }
  .canvas-bg { position:absolute; top:0; left:0; width:100%; height:100%; transform-origin:0 0; }
  .svg-layer { position:absolute; top:0; left:0; width:100%; height:100%; overflow:visible; z-index:5; pointer-events:none; }
  .nodes-container { position:absolute; top:0; left:0; width:100%; height:100%; overflow:visible; }
  .hits-layer { position:absolute; top:0; left:0; width:100%; height:100%; overflow:visible; pointer-events:none; }
  .drag-line { stroke:#38bdf8; stroke-width:2; fill:none; stroke-dasharray:5,5; pointer-events:none; }
  :global(.flow-line) { fill:none; stroke:#94a3b8; stroke-width:2.5; transition:stroke .15s; filter:drop-shadow(0 0 3px rgba(148,163,184,.2)); }
  :global(.flow-line-hover) { stroke:#38bdf8; stroke-width:3; filter:drop-shadow(0 0 6px rgba(56,189,248,.4)); }
  :global(.flow-dot) { filter:drop-shadow(0 0 4px rgba(34,197,94,.6)); }

  :global(.flow-node) { position:absolute; top:0; left:0; cursor:grab; user-select:none; width:180px; background:linear-gradient(135deg,rgba(30,41,59,.95),rgba(15,23,42,.95)); border:1px solid rgba(71,85,105,.4); border-radius:16px; padding:10px 10px 10px 20px; box-shadow:0 10px 30px -10px rgba(0,0,0,.5); transition:border-color .2s,box-shadow .2s; }
  :global(.flow-node:hover) { border-color:rgba(56,189,248,.3); box-shadow:0 10px 30px -10px rgba(56,189,248,.15); }
  :global(.flow-node.selected) { border-color:#38bdf8; box-shadow:0 0 20px rgba(56,189,248,.2),0 10px 30px -10px rgba(56,189,248,.3); }
  :global(.node-inner) { width:100%; display:flex; flex-direction:column; align-items:center; gap:2px; }
  :global(.node-inner.disabled) { opacity:.5; }
  :global(.node-header) { display:flex; align-items:center; gap:4px; width:100%; border-bottom:1px solid rgba(255,255,255,.05); padding-bottom:3px; margin-bottom:3px; pointer-events:none; }
  :global(.node-type-label) { font-size:7px; text-transform:uppercase; font-weight:900; color:#475569; letter-spacing:.1em; }
  :global(.node-toggle) { margin-left:auto; font-size:7px; font-weight:900; text-transform:uppercase; letter-spacing:.1em; padding:1px 5px; border-radius:4px; border:1px solid; line-height:1; cursor:pointer; pointer-events:auto; transition:all .2s; }
  :global(.toggle-on) { background:rgba(20,184,166,.2); color:#2dd4bf; border-color:rgba(20,184,166,.3); }
  :global(.toggle-off) { background:rgba(100,116,139,.4); color:#64748b; border-color:#475569; }
  :global(.node-name) { font-size:9px; font-weight:700; color:white; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; pointer-events:none; }
  :global(.node-dps-val) { font-size:10px; font-family:monospace; color:#fdba74; font-weight:700; }
  :global(.node-badge) { font-size:7px; font-weight:700; text-transform:uppercase; margin-top:1px; padding:1px 5px; background:rgba(20,184,166,.05); border-radius:4px; border:1px solid rgba(20,184,166,.1); }
  :global(.node-log-box) { background:rgba(0,0,0,.4); width:100%; border-radius:4px; margin-top:2px; padding:4px; font-size:10px; font-family:monospace; color:#4ade80; text-align:center; word-break:break-all; }
  :global(.node-lcd) { font-size:11px; font-family:'LCD','LCD ITC Local','LCD ITC',monospace; letter-spacing:1px; color:#2dd4bf; margin-top:2px; pointer-events:none; }
  :global(.node-status-sm) { font-size:7px; pointer-events:none; text-align:center; }
  :global(.node-relay-state) { font-size:8px; font-weight:900; text-transform:uppercase; letter-spacing:.08em; text-align:center; padding:2px 0; pointer-events:none; }
  :global(.node-relay-state.on) { color:#34d399; }
  :global(.node-relay-state.off) { color:#ef4444; }
  :global(.node-stats) { font-size:7px; color:#64748b; font-weight:700; text-transform:uppercase; display:flex; justify-content:space-between; width:100%; padding:0 2px; }
  :global(.timer-countdown) { font-size:11px; font-family:'LCD','LCD ITC Local','LCD ITC',monospace; letter-spacing:1px; color:#67e8f9; margin-top:2px; pointer-events:none; }
  :global(.socket) { position:absolute; width:10px; height:10px; border-radius:50%; border:2px solid #475569; background:#0f172a; z-index:20; cursor:crosshair; transition:all .15s; }
  :global(.socket:hover) { border-color:#38bdf8; background:#1e293b; transform:scale(1.3); }
  :global(.socket-in) { top:50%; left:-6px; transform:translateY(-50%); }
  :global(.socket-out) { top:50%; right:-6px; transform:translateY(-50%); }
  :global(.socket-out:hover) { transform:translateY(-50%) scale(1.3); }
  :global(.context-menu) { position:fixed; z-index:9999; background:rgba(15,23,42,.98); border:1px solid #334155; border-radius:12px; padding:4px; min-width:160px; box-shadow:0 20px 60px rgba(0,0,0,.6); backdrop-filter:blur(16px); }
  :global(.context-menu.hidden) { display:none; }
  :global(.ctx-item) { display:flex; align-items:center; gap:8px; padding:8px 12px; font-size:10px; font-weight:700; color:#cbd5e1; border-radius:8px; cursor:pointer; transition:all .15s; }
  :global(.ctx-item:hover) { background:rgba(56,189,248,.1); color:#38bdf8; }
  :global(.ctx-divider) { height:1px; background:#1e293b; margin:4px 0; }
  :global(.edit-overlay) { position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,.6); z-index:5000; display:flex; justify-content:flex-end; backdrop-filter:blur(4px); }
  :global(.edit-panel) { width:420px; max-width:100vw; background:#0f172a; border-left:1px solid #334155; display:flex; flex-direction:column; box-shadow:-10px 0 40px rgba(0,0,0,.5); }
  :global(.edit-panel-header) { display:flex; justify-content:space-between; align-items:center; padding:1rem 1.25rem; border-bottom:1px solid #334155; }
  :global(.edit-panel-title) { font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:.15em; color:#94a3b8; }
  :global(.edit-close) { background:none; border:none; color:#64748b; font-size:18px; cursor:pointer; padding:4px; transition:color .2s; }
  :global(.edit-close:hover) { color:white; }
  :global(.edit-panel-body) { flex:1; overflow-y:auto; padding:1.25rem; }
  :global(.edit-panel-footer) { padding:1rem 1.25rem; border-top:1px solid #334155; display:flex; gap:8px; justify-content:flex-end; }
  :global(.edit-input) { width:100%; background:#020617; border:1px solid #334155; border-radius:12px; padding:10px 16px; font-size:14px; color:white; outline:none; transition:border-color .2s; }
  :global(.edit-input:focus) { border-color:#0d9488; }
  :global(.btn-option) { flex:1; padding:8px 12px; font-size:9px; font-weight:900; text-transform:uppercase; letter-spacing:.1em; border-radius:10px; border:1px solid #334155; background:#020617; color:#94a3b8; cursor:pointer; transition:all .2s; }
  :global(.btn-option:hover) { border-color:#0d9488; color:white; }
  :global(.btn-option-active) { background:#0d9488; border-color:#0d9488; color:white; }
  :global(.edit-checkbox) { width:16px; height:16px; accent-color:#0d9488; cursor:pointer; }

  :global(.add-modal-overlay) { position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,.6); z-index:5000; display:flex; justify-content:center; align-items:center; backdrop-filter:blur(4px); }
  :global(.add-modal) { width:480px; max-width:90vw; max-height:80vh; background:#0f172a; border:1px solid #334155; border-radius:20px; display:flex; flex-direction:column; box-shadow:0 25px 60px rgba(0,0,0,.6); }
  :global(.add-modal-header) { display:flex; justify-content:space-between; align-items:center; padding:1rem 1.25rem; border-bottom:1px solid #334155; }
  :global(.add-modal-title) { font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:.15em; color:#94a3b8; }
  :global(.add-modal-body) { flex:1; overflow-y:auto; padding:1rem; display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  :global(.add-type-item) { display:flex; align-items:center; gap:10px; padding:10px 12px; background:#020617; border:1px solid #1e293b; border-radius:12px; cursor:pointer; transition:all .15s; text-align:left; }
  :global(.add-type-item:hover) { border-color:#38bdf8; background:rgba(56,189,248,.08); }
  :global(.add-type-info) { display:flex; flex-direction:column; gap:1px; min-width:0; }
  :global(.add-type-name) { font-size:10px; font-weight:700; color:#e2e8f0; text-transform:uppercase; letter-spacing:.05em; }
  :global(.add-type-desc) { font-size:8px; color:#64748b; font-weight:600; }
  :global(.console-tree-modal) { width:560px; max-width:90vw; max-height:80vh; background:#0f172a; border:1px solid #334155; border-radius:20px; display:flex; flex-direction:column; box-shadow:0 25px 60px rgba(0,0,0,.6); }
  :global(.console-tree-body) { flex:1; overflow:auto; padding:1rem; font-family:'Fira Code','JetBrains Mono',monospace; font-size:11px; line-height:1.6; }
  :global(.console-tree-empty) { color:#64748b; font-size:12px; text-align:center; padding:2rem; font-family:sans-serif; }
  :global(.json-tree) { color:#e2e8f0; }
  :global(.json-row) { white-space:nowrap; }
  :global(.json-key) { color:#818cf8; font-weight:600; margin-right:4px; }
  :global(.json-null) { color:#64748b; font-style:italic; }
  :global(.json-bool) { color:#f472b6; }
  :global(.json-num) { color:#34d399; }
  :global(.json-str) { color:#fbbf24; }
  :global(.json-truncated) { color:#64748b; font-style:italic; }
  :global(.console-expand-btn) { font-size:7px; font-weight:900; text-transform:uppercase; letter-spacing:.08em; padding:2px 8px; border-radius:6px; border:1px solid rgba(148,163,184,.2); background:rgba(148,163,184,.08); color:#94a3b8; cursor:pointer; transition:all .15s; margin-top:2px; pointer-events:auto; }
  :global(.console-expand-btn:hover) { background:rgba(148,163,184,.2); color:#e2e8f0; border-color:rgba(148,163,184,.4); }

  @media (max-width: 768px) {
    .section-card { background: #2a2d35; backdrop-filter: none; border: none; border-radius: 24px; box-shadow: 14px 14px 42px #1a1d22, -14px -14px 42px #3d414b; }
    .section-header { background: transparent; padding: 0.75rem 1rem; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .canvas-wrapper { background-image: radial-gradient(circle,#3d414b 1px,transparent 1px); background-size: 30px 30px; border-radius: 20px; }
    :global(.flow-node) { width: 140px; background: #2a2d35; border: none; box-shadow: 8px 8px 24px #1a1d22, -8px -8px 24px #3d414b; }
    :global(.flow-node:hover) { box-shadow: 8px 8px 24px #1a1d22, -8px -8px 24px #3d414b; }
    :global(.flow-node.selected) { box-shadow: 0 0 0 2px #38bdf8, 8px 8px 24px #1a1d22, -8px -8px 24px #3d414b; }
  }
</style>
