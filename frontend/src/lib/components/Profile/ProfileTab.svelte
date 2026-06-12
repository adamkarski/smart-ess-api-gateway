<script lang="ts">
  import { currentUser, logout, updateProfile } from '../../stores/authStore'
  import { switchTab } from '../../stores/appStore'

  let name = $state($currentUser?.name || '')
  let saving = $state(false)
  let saved = $state(false)

  async function saveName() {
    saving = true
    saved = false
    const r = await updateProfile({ name })
    saving = false
    if (r.ok) saved = true
  }

  function handleLogout() {
    logout()
    switchTab('dashboard')
  }
</script>

<div class="section-card">
  <div class="section-header">
    <h3 class="section-title">Profil</h3>
  </div>

  <div class="profile-email">
    <i class="fa-solid fa-envelope text-slate-400"></i>
    {$currentUser?.email}
  </div>

  <div class="field-group">
    <label class="field-label" for="profile-name">Nazwa</label>
    <div class="field-row">
      <input
        id="profile-name"
        type="text"
        bind:value={name}
        class="field-input"
        placeholder="Twoja nazwa"
      />
      <button class="btn-save" onclick={saveName} disabled={saving}>
        {saving ? '...' : 'Zapisz'}
      </button>
    </div>
    {#if saved}
      <div class="field-hint text-teal-400">Zapisano</div>
    {/if}
  </div>

  <div class="section-divider"></div>

  <button class="btn-logout" onclick={handleLogout}>
    <i class="fa-solid fa-right-from-bracket"></i>
    Wyloguj się
  </button>
</div>

<style>
  .section-card {
    background: rgba(30, 41, 59, 0.7);
    backdrop-filter: blur(12px);
    border-radius: 24px;
    padding: 1.5rem;
    border: 1px solid #334155;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
    margin-bottom: 1.5rem;
  }
  .section-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1.25rem;
  }
  .section-title {
    font-size: 14px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.3em;
    color: #94a3b8;
  }
  .profile-email {
    font-size: 13px;
    color: #64748b;
    margin-bottom: 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .field-group { margin-bottom: 1rem; }
  .field-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #64748b;
    display: block;
    margin-bottom: 0.4rem;
  }
  .field-row {
    display: flex;
    gap: 0.5rem;
  }
  .field-input {
    flex: 1;
    padding: 0.6rem 0.8rem;
    border-radius: 10px;
    border: 1px solid #334155;
    background: rgba(15, 23, 42, 0.6);
    color: #e2e8f0;
    font-size: 14px;
    outline: none;
  }
  .field-input:focus { border-color: #38bdf8; }
  .btn-save {
    padding: 0.6rem 1rem;
    border-radius: 10px;
    border: none;
    background: #38bdf8;
    color: #0f172a;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn-save:disabled { opacity: 0.5; }
  .field-hint { font-size: 10px; font-weight: 600; margin-top: 0.3rem; }
  .section-divider {
    height: 1px;
    background: #334155;
    margin: 1.25rem 0;
  }
  .btn-logout {
    width: 100%;
    padding: 0.7rem;
    border-radius: 12px;
    border: 1px solid #f87171;
    background: rgba(248, 113, 113, 0.1);
    color: #f87171;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    transition: background 0.15s;
  }
  .btn-logout:hover { background: rgba(248, 113, 113, 0.2); }

  @media (max-width: 768px) {
    .section-card { background: #ffffff; backdrop-filter: none; border: none; border-radius: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .section-title { color: #8e8e93; }
    .profile-email { color: #c7c7cc; }
    .field-input { background: #f2f2f7; border-color: rgba(0,0,0,0.05); color: #1c1c1e; }
    .btn-save { background: #007aff; color: #ffffff; }
    .section-divider { background: rgba(0,0,0,0.05); }
  }
</style>
