<script lang="ts">
  import { dashboardData, weatherNode, globalWeatherData } from '../../stores/appStore'

  let opMode = $derived($dashboardData?.status?.opMode ?? '---')
  let tempDc = $derived($dashboardData?.status?.tempDc ?? '0')
  let tempOut = $derived($weatherNode?.data?.temp ?? $globalWeatherData?.temp ?? null)
  let prioOut = $derived($dashboardData?.status?.prioOut ?? '---')
  let prioChar = $derived($dashboardData?.status?.prioChar ?? '---')
</script>

<div class="section-card">
  <div class="section-header">
    <span class="section-title">Status Pracy i Pogoda</span>
  </div>
  <div class="status-grid">
    <div class="status-cell">
      <span class="status-label">Tryb Pracy</span>
      <div class="status-value text-teal-400 uppercase">{opMode}</div>
    </div>
    <div class="status-cell">
      <span class="status-label">Temp. Inwerter</span>
      <div class="status-value"><span class="lcd-text">{tempDc}</span><span class="unit-text">°C</span></div>
    </div>
    <div class="status-cell bg-blue-500/5">
      <span class="status-label text-blue-500">Temp. Zewnątrz</span>
      <div class="status-value text-blue-400"><span class="lcd-text">{tempOut ?? '--'}</span><span class="unit-text">°C</span></div>
    </div>
    <div class="status-cell">
      <span class="status-label">Priorytet Wyjścia</span>
      <div class="status-value">{prioOut}</div>
    </div>
    <div class="status-cell">
      <span class="status-label">Ładowarka</span>
      <div class="status-value uppercase">{prioChar}</div>
    </div>
  </div>
</div>

<style>
  .section-card {
    background: rgba(30, 41, 59, 0.7);
    backdrop-filter: blur(12px);
    border-radius: 24px;
    border: 1px solid #334155;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
    margin-bottom: 1.5rem;
  }
  .section-header {
    background: rgba(15, 23, 42, 0.5);
    padding: 1rem 2rem;
    border-bottom: 1px solid #334155;
  }
  .section-title {
    font-size: 14px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.3em;
    color: #94a3b8;
  }
  .status-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
  }
  .status-cell {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    justify-content: center;
    border-right: 1px solid #334155;
  }
  .status-cell:last-child { border-right: none; }
  .status-label {
    font-size: 8px;
    font-weight: 900;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.3em;
    margin-bottom: 0.25rem;
  }
  .status-value {
    font-size: 10px;
    font-weight: 700;
    color: #94a3b8;
  }

  @media (max-width: 768px) {
    .section-card { background: #2a2d35; backdrop-filter: none; border: none; border-radius: 24px; box-shadow: 14px 14px 42px #1a1d22, -14px -14px 42px #3d414b; }
    .section-header { background: transparent; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .status-grid { grid-template-columns: repeat(3, 1fr); }
    .status-cell { padding: 10px 8px; border-color: rgba(255,255,255,0.04); }
  }
</style>
