<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { messages } from '#lib/i18n/index';
  import { bluetooth, bluetoothConnector } from '#lib/application/granboard/bluetooth';
  import { connectRelay, relayAvailable } from '#lib/application/granboard/relay';
  import type { BoardHit } from '#lib/application/granboard/protocol';
  import { granBoard } from '../application/granboard/session.svelte';
  import Icon from './Icon.svelte';

  let {
    matchId,
    onhit,
    onnext,
    onconnection,
    onarm,
    armed,
    canArm,
    awaitingNext,
  }: {
    matchId: string;
    onhit: (hit: BoardHit) => void;
    onnext: () => void;
    onconnection: (connected: boolean) => void;
    onarm: () => void;
    armed: boolean;
    canArm: boolean;
    awaitingNext: boolean;
  } = $props();

  let direct = $state(false);
  let relay = $state<boolean>();
  let secureContext = $state<boolean>();
  const connectionState = $derived(granBoard.matchId === matchId ? granBoard.status : undefined);
  let code = $state('');

  function disconnect() {
    granBoard.stop(matchId);
  }

  function start(method: 'bluetooth' | 'relay') {
    if (method === 'bluetooth') {
      granBoard.start(matchId, bluetoothConnector(), 60000);
    } else {
      const pairingCode = code.trim();
      code = '';
      granBoard.start(
        matchId,
        (signal, receiver) => connectRelay(pairingCode, signal, receiver),
        20000,
      );
    }
  }

  $effect(() => {
    const connected = connectionState === 'connected';
    untrack(() => onconnection(connected));
  });

  onMount(() => {
    const discovery = new AbortController();
    const detach = granBoard.listen(matchId, onhit, onnext);
    secureContext = window.isSecureContext;
    direct = secureContext && typeof bluetooth()?.requestDevice === 'function';
    if (secureContext && !direct) {
      void relayAvailable(discovery.signal)
        .then((available) => {
          relay = available;
        })
        .catch(() => {
          if (!discovery.signal.aborted) relay = false;
        });
    }
    return () => {
      discovery.abort();
      detach();
      onconnection(false);
    };
  });
</script>

<details class="granboard" open={Boolean(connectionState)}>
  <summary class="button secondary">
    <Icon name="darts" />
    <span>{messages.granboard.title}</span>
    {#if connectionState === 'connected'}<span class="connection-dot" aria-hidden="true"
      ></span>{/if}
  </summary>
  <div class="board-panel">
    {#if secureContext === false}
      <p>{messages.granboard.httpsRequired}</p>
    {:else if connectionState === 'connected'}
      <p class="connected-state" role="status">
        <Icon name="check" />{armed ? messages.granboard.armed : messages.granboard.connected}
      </p>
      <p class="board-help">{messages.granboard.help}</p>
      <div class="board-actions">
        {#if !awaitingNext}
          <button type="button" class="button" disabled={!canArm || armed} onclick={onarm}>
            <Icon name="play" />{messages.granboard.ready}
          </button>
        {/if}
        <button type="button" class="button secondary" onclick={disconnect}>
          <Icon name="close" />{messages.granboard.disconnect}
        </button>
      </div>
    {:else if connectionState === 'connecting' || connectionState === 'reconnecting'}
      <p role="status">
        {connectionState === 'connecting'
          ? messages.granboard.connecting
          : messages.granboard.reconnecting}
      </p>
      <button type="button" class="button secondary" onclick={disconnect}>
        <Icon name="close" />{messages.granboard.disconnect}
      </button>
    {:else if direct || relay}
      {#if connectionState === 'failed'}<p class="error" role="alert">
          {messages.granboard.failed}
        </p>{/if}
      {#if direct}
        <button type="button" class="button" onclick={() => start('bluetooth')}>
          <Icon name="bluetooth" />{messages.granboard.bluetooth}
        </button>
      {:else}
        <form
          class="relay-form"
          onsubmit={(event) => {
            event.preventDefault();
            start('relay');
          }}
        >
          <label class="game-field">
            {messages.granboard.code}
            <input type="password" bind:value={code} required maxlength={128} autocomplete="off" />
          </label>
          <button class="button" disabled={!code.trim()}>
            <Icon name="link" />{messages.granboard.relay}
          </button>
        </form>
      {/if}
    {:else if relay === false}
      <p role="status">{messages.granboard.unavailable}</p>
    {/if}
  </div>
</details>

<style>
  .granboard {
    min-inline-size: 0;
  }
  .granboard[open] {
    flex-basis: 100%;
  }
  summary {
    justify-content: flex-start;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .granboard[open] > summary.button {
    inline-size: 100%;
    margin-block-end: 0;
    border-end-start-radius: 0;
    border-end-end-radius: 0;
  }
  summary::after {
    margin-inline-start: auto;
  }
  .connection-dot {
    inline-size: 0.55rem;
    block-size: 0.55rem;
    background: var(--success);
    border-radius: 50%;
  }
  .board-panel {
    display: grid;
    justify-items: start;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-block-start: 0;
    border-radius: 0 0 11px 11px;
    background: var(--surface);
  }
  .board-panel p {
    margin: 0;
  }
  .connected-state {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--success);
    font-weight: 650;
  }
  .board-help {
    color: var(--muted-text);
  }
  .board-actions,
  .relay-form {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-2);
    inline-size: 100%;
  }
  .relay-form .game-field {
    flex: 1 1 12rem;
    min-inline-size: 0;
  }
  .board-actions > button,
  .relay-form > button {
    flex: 1 1 auto;
  }
</style>
