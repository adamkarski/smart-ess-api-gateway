<script lang="ts">
  import { login, register } from '../../stores/authStore'
  import { switchTab } from '../../stores/appStore'

  let mode = $state<'login' | 'register'>('login')
  let email = $state('')
  let password = $state('')
  let name = $state('')
  let loading = $state(false)
  let error = $state('')

  async function submit(e: Event) {
    e.preventDefault()
    loading = true
    error = ''
    const fn = mode === 'login' ? login : register
    const args = mode === 'login' ? [email, password] : [email, password, name || undefined]
    const result = await (fn as any)(...args)
    loading = false
    if (result.ok) {
      switchTab('dashboard')
    } else {
      error = result.error || 'Wystąpił błąd'
    }
  }

  function toggleMode() {
    mode = mode === 'login' ? 'register' : 'login'
    error = ''
  }
</script>

<div class="auth-page">
  <div class="auth-card">
    <div class="auth-icon">
      <i class="fa-solid fa-bolt-lightning text-teal-400"></i>
    </div>
    <h1 class="auth-title">PV Monitor PRO</h1>
    <p class="auth-subtitle">
      {mode === 'login' ? 'Zaloguj się aby kontynuować' : 'Utwórz konto'}
    </p>

    <form onsubmit={submit} class="auth-form">
      {#if mode === 'register'}
        <input
          type="text"
          placeholder="Nazwa (opcjonalnie)"
          bind:value={name}
          class="auth-input"
        />
      {/if}
      <input
        type="email"
        placeholder="Email"
        required
        bind:value={email}
        class="auth-input"
        autocomplete="email"
      />
      <input
        type="password"
        placeholder="Hasło"
        required
        minlength={4}
        bind:value={password}
        class="auth-input"
        autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
      />

      {#if error}
        <div class="auth-error">{error}</div>
      {/if}

      <button type="submit" class="auth-submit" disabled={loading}>
        {loading ? '...' : mode === 'login' ? 'Zaloguj się' : 'Zarejestruj się'}
      </button>
    </form>

    <button class="auth-toggle" onclick={toggleMode}>
      {mode === 'login'
        ? 'Nie masz konta? Zarejestruj się'
        : 'Masz już konto? Zaloguj się'}
    </button>
  </div>
</div>

<style>
  .auth-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    background: rgba(15, 23, 42, 0.95);
  }
  .auth-card {
    background: rgba(30, 41, 59, 0.9);
    backdrop-filter: blur(12px);
    border-radius: 24px;
    padding: 2.5rem;
    border: 1px solid #334155;
    box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
    max-width: 380px;
    width: 100%;
    text-align: center;
  }
  .auth-icon {
    font-size: 2rem;
    margin-bottom: 1rem;
  }
  .auth-title {
    font-size: 16px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.3em;
    color: #e2e8f0;
    margin-bottom: 0.5rem;
  }
  .auth-subtitle {
    font-size: 11px;
    color: #64748b;
    margin-bottom: 1.5rem;
  }
  .auth-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .auth-input {
    width: 100%;
    padding: 0.75rem 1rem;
    border-radius: 12px;
    border: 1px solid #334155;
    background: rgba(15, 23, 42, 0.6);
    color: #e2e8f0;
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }
  .auth-input:focus { border-color: #38bdf8; }
  .auth-input::placeholder { color: #475569; }
  .auth-error {
    font-size: 11px;
    color: #f87171;
    font-weight: 600;
    padding: 0.5rem;
    background: rgba(248, 113, 113, 0.1);
    border-radius: 8px;
  }
  .auth-submit {
    width: 100%;
    padding: 0.75rem;
    border-radius: 12px;
    border: none;
    background: #38bdf8;
    color: #0f172a;
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    cursor: pointer;
    transition: opacity 0.15s;
    margin-top: 0.25rem;
  }
  .auth-submit:hover { opacity: 0.9; }
  .auth-submit:disabled { opacity: 0.5; cursor: default; }
  .auth-toggle {
    background: none;
    border: none;
    color: #64748b;
    font-size: 11px;
    cursor: pointer;
    margin-top: 1rem;
    transition: color 0.15s;
  }
  .auth-toggle:hover { color: #38bdf8; }

  @media (max-width: 768px) {
    .auth-page { background: #f2f2f7; padding: 1rem; }
    .auth-card { background: #ffffff; border: none; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .auth-title { color: #1c1c1e; }
    .auth-subtitle { color: #8e8e93; }
    .auth-input { background: #f2f2f7; border-color: rgba(0,0,0,0.05); color: #1c1c1e; }
    .auth-input::placeholder { color: #c7c7cc; }
    .auth-submit { background: #007aff; color: #ffffff; }
  }
</style>
