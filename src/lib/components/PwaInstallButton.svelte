<script lang="ts">
  import { onMount } from 'svelte';
  import { messages } from '#lib/i18n/index';
  import Icon from './Icon.svelte';

  interface InstallPrompt extends Event {
    prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  let offer = $state.raw<InstallPrompt>();
  let installed = $state(false);
  let requesting = $state(false);
  let failed = $state(false);

  onMount(() => {
    const standalone = window.matchMedia('(display-mode: standalone)');
    const receiveOffer = (event: Event) => {
      const prompt = event as InstallPrompt;
      if (installed || standalone.matches || typeof prompt.prompt !== 'function') return;

      event.preventDefault();
      offer = prompt;
      failed = false;
    };
    const markInstalled = () => {
      installed = true;
      offer = undefined;
      failed = false;
    };
    const syncDisplayMode = () => {
      if (standalone.matches) markInstalled();
    };

    syncDisplayMode();
    window.addEventListener('beforeinstallprompt', receiveOffer);
    window.addEventListener('appinstalled', markInstalled);
    standalone.addEventListener('change', syncDisplayMode);
    return () => {
      window.removeEventListener('beforeinstallprompt', receiveOffer);
      window.removeEventListener('appinstalled', markInstalled);
      standalone.removeEventListener('change', syncDisplayMode);
    };
  });

  async function install() {
    const prompt = offer;
    if (!prompt || requesting || installed) return;
    requesting = true;
    try {
      const result = await prompt.prompt();
      if (result.outcome === 'accepted') installed = true;
    } catch {
      failed = !installed;
    } finally {
      if (offer === prompt || installed) offer = undefined;
      requesting = false;
    }
  }
</script>

{#if offer && !installed}
  <button class="button secondary" type="button" disabled={requesting} onclick={install}>
    <Icon name="download" />
    {messages.pwaInstall.action}
  </button>
{:else if failed}
  <small class="install-help" role="status">{messages.pwaInstall.fallback}</small>
{/if}

<style>
  .install-help {
    max-width: 20rem;
    text-align: end;
  }
</style>
