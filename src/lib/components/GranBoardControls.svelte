<script lang="ts">
  import { onMount } from 'svelte';
  import { messages } from '#lib/i18n/index';
  import {
    bluetooth,
    bluetoothConnector,
    connectRelay,
    relayAvailable,
  } from '#lib/application/granboard/connection';
  import type { BoardHit } from '#lib/application/granboard/protocol';
  import { granBoard } from '../application/granboard/session.svelte';
  import Icon from './Icon.svelte';

  let {
    matchId,
    onhit,
    onconnection,
    onarm,
    armed,
    canArm,
  }: {
    matchId: string;
    onhit: (hit: BoardHit) => void;
    onconnection: (connected: boolean) => void;
    onarm: () => void;
    armed: boolean;
    canArm: boolean;
  } = $props();

  let direct = $state(false);
  let relay = $state(false);
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
    onconnection(connectionState === 'connected');
  });

  onMount(() => {
    const discovery = new AbortController();
    const detach = granBoard.listen(matchId, onhit);
    if (window.isSecureContext) {
      direct = Boolean(bluetooth());
      void relayAvailable(discovery.signal)
        .then((available) => {
          relay = available;
        })
        .catch(() => {});
    }
    return () => {
      discovery.abort();
      detach();
      onconnection(false);
    };
  });
</script>

{#if direct || relay || connectionState}
  <details class="stack" open={Boolean(connectionState)}>
    <summary class="button secondary"><Icon name="darts" />{messages.granboard.title}</summary>
    <div class="stack">
      <p>{messages.granboard.help}</p>
      {#if connectionState === 'failed'}<p class="error" role="alert">
          {messages.granboard.failed}
        </p>{/if}
      {#if connectionState === 'reconnecting'}<p role="status">
          {messages.granboard.reconnecting}
        </p>{/if}
      {#if connectionState === 'connecting'}<p role="status">
          {messages.granboard.connecting}
        </p>{/if}
      {#if connectionState === 'connected'}
        <p role="status">{armed ? messages.granboard.armed : messages.granboard.connected}</p>
      {/if}
      <div class="button-row">
        {#if connectionState === 'connected'}
          <button type="button" class="button" disabled={!canArm || armed} onclick={onarm}
            ><Icon name="play" />{messages.granboard.ready}</button
          >
        {/if}
        {#if connectionState && connectionState !== 'failed'}
          <button type="button" class="button secondary" onclick={disconnect}
            ><Icon name="close" />{messages.granboard.disconnect}</button
          >
        {:else if direct}
          <button type="button" class="button secondary" onclick={() => start('bluetooth')}
            ><Icon name="bluetooth" />{messages.granboard.bluetooth}</button
          >
        {/if}
      </div>
      {#if relay && (!connectionState || connectionState === 'failed')}
        <form
          class="stack"
          onsubmit={(event) => {
            event.preventDefault();
            void start('relay');
          }}
        >
          <label class="game-field">
            {messages.granboard.code}
            <input type="password" bind:value={code} required maxlength={128} autocomplete="off" />
          </label>
          <div class="button-row">
            <button class="button secondary" disabled={!code.trim()}
              ><Icon name="link" />{messages.granboard.relay}</button
            >
          </div>
        </form>
      {/if}
    </div>
  </details>
{/if}
