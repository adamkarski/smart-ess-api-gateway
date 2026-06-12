<script lang="ts">
  let visible = $state(false)
  let message = $state('')
  let timer: ReturnType<typeof setTimeout>

  export function show(msg: string) {
    message = msg
    visible = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { visible = false }, 5000)
  }
</script>

{#if visible}
  <div class="toast" onclick={() => visible = false}>
    {message}
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: #ff3b30;
    color: white;
    padding: 12px 24px;
    border-radius: 14px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 200;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    max-width: 90vw;
    text-align: center;
  }
</style>
