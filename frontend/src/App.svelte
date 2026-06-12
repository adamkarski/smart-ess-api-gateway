<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { activeTab, switchTab, fetchPoll, fetchFullAutomation, checkVersion, startPolling, stopPolling } from './lib/stores/appStore'
  import { authState, isAuthenticated, fetchProfile } from './lib/stores/authStore'
  import LoginPage from './lib/components/Auth/LoginPage.svelte'
  import Dashboard from './lib/components/Dashboard/Dashboard.svelte'
  import DevicesTab from './lib/components/Devices/DevicesTab.svelte'
  import SetupTab from './lib/components/Setup/SetupTab.svelte'
  import ProfileTab from './lib/components/Profile/ProfileTab.svelte'
  import BottomTabBar from './lib/components/Shared/BottomTabBar.svelte'

  let authReady = $state(false)
  let pollingStarted = $state(false)
  let lastVersionCheck: ReturnType<typeof setInterval>

  onMount(async () => {
    if ($authState.token) {
      await fetchProfile()
    }
    authReady = true
  })

  // Start polling once authenticated
  $effect(() => {
    if (authReady && $isAuthenticated && !pollingStarted) {
      pollingStarted = true
      fetchPoll()
      fetchFullAutomation()
      startPolling()
      lastVersionCheck = setInterval(checkVersion, 2000)
    }
  })

  onDestroy(() => {
    stopPolling()
    if (lastVersionCheck) clearInterval(lastVersionCheck)
  })

  function onTabClick(tab: string) {
    switchTab(tab)
  }
</script>

{#if !authReady}
  <div class="splash-screen">
    <i class="fa-solid fa-bolt-lightning text-teal-400 text-4xl"></i>
  </div>
{:else if !$isAuthenticated}
  <LoginPage />
{:else}
  <nav class="sticky top-0 z-40 w-full bg-slate-950/90 glass border-b border-slate-800">
    <div class="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between max-md:hidden">
      <div class="flex items-center gap-3">
        <button onclick={() => onTabClick('dashboard')} class="cursor-pointer">
          <img src="/assets/logo.svg" alt="Solar PV" class="h-9 w-auto">
        </button>
       <!--  <span class="font-bold text-white uppercase text-xs tracking-widest">
          PV Monitor <span class="text-teal-500 font-light">PRO</span>
        </span> -->
      </div>
      <div class="flex gap-6 h-full">
        {#each ['dashboard', 'devices', 'setup', 'profile'] as tab}
          <button
            class="tab-btn h-full px-2 text-[10px] font-bold uppercase tracking-widest transition-colors"
            class:text-white={$activeTab === tab}
            class:text-slate-500={$activeTab !== tab}
            onclick={() => onTabClick(tab)}
          >
            {tab === 'dashboard' ? 'Monitor' : tab === 'flow' ? 'Flow' : tab === 'devices' ? 'Urządzenia' : tab === 'setup' ? 'Setup' : 'Profil'}
          </button>
        {/each}
      </div>
      <div id="status-dot" class="w-2 h-2 rounded-full bg-green-500"></div>
    </div>
  </nav>

  <main class="max-w-[1400px] mx-auto p-6 max-md:p-3">
    {#if $activeTab === 'dashboard'}
      <div class="tab-content animate-tab-entry">
        <Dashboard />
      </div>
    {:else if $activeTab === 'devices'}
      <div class="tab-content animate-tab-entry">
        <DevicesTab />
      </div>
    {:else if $activeTab === 'setup'}
      <div class="tab-content animate-tab-entry">
        <SetupTab />
      </div>
    {:else if $activeTab === 'profile'}
      <div class="tab-content animate-tab-entry">
        <ProfileTab />
      </div>
    {/if}
  </main>

  <BottomTabBar />
{/if}

<style>
  .splash-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(15, 23, 42, 0.95);
  }
</style>
