<script lang="ts">
  import { dashboardData } from '../../stores/appStore'

  let batV = $derived($dashboardData?.details?.batteryV ?? '0.0')
  let gridV = $derived($dashboardData?.details?.gridV ?? '0.0')
  let loadV = $derived($dashboardData?.details?.loadV ?? '0.0')
  let lastSync = $derived($dashboardData?.details?.lastSync ?? '--:--:--')
</script>

<div class="section-card">
  <div class="section-header">
    <span class="section-title">Szczegóły Systemu</span>
    <span class="sync-time">{lastSync}</span>
  </div>
  <div class="details-grid">
    <div class="detail-row">
      <span class="detail-label">Bateria</span>
      <div><span class="detail-value">{batV}</span><span class="unit-text">V</span></div>
    </div>
    <div class="detail-row">
      <span class="detail-label">Sieć (In)</span>
      <div><span class="detail-value">{gridV}</span><span class="unit-text">V</span></div>
    </div>
    <div class="detail-row">
      <span class="detail-label">Dom (Out)</span>
      <div><span class="detail-value">{loadV}</span><span class="unit-text">V</span></div>
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
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .section-title {
    font-size: 14px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.3em;
    color: #94a3b8;
  }
  .sync-time {
    font-size: 9px;
    font-family: monospace;
    color: #475569;
  }
  .details-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }
  .detail-row {
    padding: 1.5rem 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-right: 1px solid #334155;
  }
  .detail-row:last-child { border-right: none; }
  .detail-label {
    font-size: 12px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
  }
  .detail-value {
    font-size: 20px;
    font-weight: 700;
    color: #94a3b8;
  }

  @media (max-width: 768px) {
    .section-card { background: #2a2d35; backdrop-filter: none; border: none; border-radius: 24px; box-shadow: 14px 14px 42px #1a1d22, -14px -14px 42px #3d414b; }
    .section-header { background: transparent; border-bottom: 1px solid rgba(255,255,255,0.04); }
    .details-grid { grid-template-columns: 1fr; }
    .detail-row { border-right: none; border-bottom: 1px solid rgba(255,255,255,0.04); padding: 12px 16px; }
    .detail-row:last-child { border-bottom: none; }
  }
</style>
