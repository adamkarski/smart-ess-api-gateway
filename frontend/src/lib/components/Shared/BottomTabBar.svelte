<script lang="ts">
  import { activeTab, switchTab } from '../../stores/appStore'

  const tabs = [
    { id: 'dashboard', label: 'Monitor', icon: 'fa-house' },
    { id: 'devices', label: 'Urządzenia', icon: 'fa-plug' },
    { id: 'setup', label: 'Setup', icon: 'fa-gear' },
    { id: 'profile', label: 'Profil', icon: 'fa-user' },
  ]

  function onTabClick(tab: string) {
    switchTab(tab)
  }
</script>

<div id="mobile-tab-bar" class="mobile-tab-bar">
  {#each tabs as t}
    <button
      class="mobile-tab-item"
      class:active={$activeTab === t.id}
      onclick={() => onTabClick(t.id)}
      aria-label={t.label}
    >
      <i class="fa-solid {t.icon}"></i>
    </button>
  {/each}
</div>

<style>
  .mobile-tab-bar {
    display: none;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 60px;
    background: rgba(255,255,255,0.92);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    border-top: 0.5px solid rgba(0,0,0,0.12);
    z-index: 100;
    padding: 8px 0 env(safe-area-inset-bottom, 8px) 0;
    justify-content: space-around;
    align-items: flex-start;
  }

  @media (max-width: 768px) {
    .mobile-tab-bar { display: flex; background: #2a2d35; border-top: none; box-shadow: 0 -8px 24px rgba(0,0,0,0.3); }
  }

  .mobile-tab-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 2px;
    flex: 1;
    padding: 4px 0;
    border: none;
    background: none;
    cursor: pointer;
    min-height: 44px;
    min-width: 44px;
  }
  .mobile-tab-item i {
    font-size: 23px;
    color: #8e8e93;
    transition: color 0.15s;
  }
  .mobile-tab-item.active i {
    color: #007aff;
  }
</style>
