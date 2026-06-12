<script lang="ts">
  interface Props {
    label: string
    value: string
    unit: string
    subValue?: string
    subUnit?: string
    percentage?: number
    color: string      // Tailwind stroke color class (e.g. 'text-teal-500')
    icon?: string      // optional emoji or text
    lcdClass?: string  // 'text-5xl' or 'text-6xl'
  }

  let { label, value, unit, subValue, subUnit, percentage = 0, color, icon, lcdClass = 'text-5xl' }: Props = $props()

  const circumference = 276.5 // 2 * PI * 44
  let offset = $derived(circumference - (percentage / 100) * circumference)
</script>

<div class="gauge-card">
  <h3 class="gauge-label">{label}</h3>
  <div class="relative w-44 h-44 mb-6 max-md:w-36 max-md:h-36">
    <svg class="w-full h-full circle-progress" viewBox="0 0 100 100">
      <circle class="text-slate-900 stroke-current" stroke-width="5" cx="50" cy="50" r="44" fill="transparent"></circle>
      <circle
        class="{color} stroke-current progress-ring__circle"
        stroke-width="6" stroke-linecap="round"
        cx="50" cy="50" r="44"
        fill="transparent"
        stroke-dasharray="276.5"
        stroke-dashoffset={offset}
      ></circle>
    </svg>
    <div class="absolute inset-0 flex flex-col items-center justify-center">
      <div>
        <span class="{lcdClass} font-bold lcd-text">{value}</span>
        <span class="unit-text">{unit}</span>
      </div>
      {#if subValue !== undefined}
        <div class="text-[11px] text-slate-500 font-mono mt-1 max-md:text-slate-400">{subValue} {subUnit}</div>
      {/if}
    </div>
  </div>
  {#if icon}
    <div class="flex items-center gap-2">
      <span class="text-xl">{icon}</span>
      <span class="text-2xl font-bold lcd-text">{subValue || value}</span>
      <span class="unit-text">{subUnit || unit}</span>
    </div>
  {/if}
</div>

<style>
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
  }
  .gauge-label {
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.3em;
    color: #94a3b8;
    margin-bottom: 1.5rem;
  }

  @media (max-width: 768px) {
    .gauge-card {
      background: #ffffff;
      backdrop-filter: none;
      border: none;
      border-radius: 14px;
      padding: 20px 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
    }
    .gauge-label {
      color: #8e8e93;
      font-size: 11px;
    }
  }
</style>
