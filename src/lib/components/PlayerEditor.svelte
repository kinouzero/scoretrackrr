<script lang="ts">
  import Icon from './Icon.svelte';
  import { onMount } from 'svelte';
  import type { PlayerRecord } from '#lib/domain/records';
  import { normalizePlayerProfile, playerAvatars, type PlayerAvatar } from '#lib/domain/players';
  import type { LocalRepository } from '#lib/storage/repository';
  import { fetchGravatar } from '#lib/application/gravatar';
  import { playerErrorMessage } from '#lib/application/player-errors';
  import { messages } from '#lib/i18n/index';
  import PlayerAvatarView from './PlayerAvatar.svelte';

  let {
    player,
    repository,
    ondismiss,
    returnFocus,
    onsaved,
  }: {
    player: PlayerRecord | null;
    repository: LocalRepository;
    ondismiss: () => void;
    returnFocus?: HTMLElement;
    onsaved: (warning: boolean) => void;
  } = $props();
  let displayName = $state('');
  let color = $state('#153e35');
  let avatar = $state<PlayerAvatar>('initials');
  let isGuest = $state(false);
  let email = $state('');
  let refreshImage = $state(false);
  let saving = $state(false);
  let error = $state('');
  let dialog: HTMLDialogElement;
  let nameInput: HTMLInputElement;
  const avatarKeys = Object.keys(playerAvatars) as PlayerAvatar[];

  onMount(() => {
    displayName = player?.displayName ?? '';
    color = player?.color ?? '#153e35';
    avatar = player?.avatar ?? 'initials';
    isGuest = player?.isGuest ?? false;
    email = player?.email ?? '';
    const opener = returnFocus ?? document.activeElement;
    dialog.showModal();
    nameInput.focus();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    error = '';
    saving = true;
    try {
      let profile = normalizePlayerProfile({ displayName, color, avatar, isGuest, email });
      let warning = false;
      if (profile.avatar === 'gravatar') {
        const sameIdentity = profile.email === player?.email && player?.avatar === 'gravatar';
        let avatarImage = sameIdentity ? player?.avatarImage : undefined;
        if (!avatarImage || refreshImage) {
          try {
            avatarImage = await fetchGravatar(profile.email!);
          } catch {
            warning = true;
          }
        }
        profile = { ...profile, avatarImage };
      }
      const now = new Date().toISOString();
      if (player) await repository.updatePlayer(player.id, profile, player.revision ?? 0, now);
      else
        await repository.createPlayer({
          ...profile,
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
        });
      onsaved(warning);
    } catch (failure) {
      error = playerErrorMessage(failure);
    } finally {
      saving = false;
    }
  }
</script>

<dialog
  class="player-editor"
  bind:this={dialog}
  aria-labelledby="player-editor-title"
  onclose={ondismiss}
  oncancel={(event) => {
    if (saving) event.preventDefault();
  }}
>
  <h2 id="player-editor-title">
    {player ? messages.players.editTitle : messages.players.createTitle}
  </h2>
  <form onsubmit={save}>
    <fieldset disabled={saving} class="editor-fields player-editor-fields">
      <section class="player-section" aria-labelledby="player-identity-title">
        <h3 id="player-identity-title">{messages.players.identityTitle}</h3>
        <div class="player-identity-grid" class:guest={isGuest}>
          <div class="player-field">
            <label for="player-name">{messages.players.name}</label><input
              bind:this={nameInput}
              id="player-name"
              bind:value={displayName}
              maxlength="120"
              required
              autocomplete="off"
            />
          </div>
          {#if !isGuest}<div class="player-field">
              <label for="player-email">{messages.players.email}</label><input
                id="player-email"
                type="email"
                bind:value={email}
                maxlength="254"
                autocomplete="off"
                aria-describedby="player-email-hint"
              />
              <p id="player-email-hint" class="field-hint">{messages.players.emailHint}</p>
            </div>{/if}
        </div>
        <div class="player-guest-setting">
          <label class="check-label"
            ><input
              type="checkbox"
              bind:checked={isGuest}
              aria-describedby="player-guest-hint"
              onchange={(event) => {
                if (event.currentTarget.checked && avatar === 'gravatar') avatar = 'initials';
              }}
            />{messages.players.guest}</label
          >
          <p id="player-guest-hint" class="field-hint">{messages.players.guestHint}</p>
        </div>
      </section>
      <section class="player-section" aria-labelledby="player-appearance-title">
        <h3 id="player-appearance-title">{messages.players.appearanceTitle}</h3>
        <div class="profile-preview player-preview">
          <PlayerAvatarView
            profile={{
              displayName,
              color,
              avatar,
              isGuest,
              avatarImage:
                email.trim().toLowerCase() === player?.email ? player?.avatarImage : undefined,
            }}
          /><strong>{displayName || messages.players.name}</strong>
        </div>
        <fieldset class="avatar-options player-avatar-options">
          <legend>{messages.players.avatar}</legend>
          <div class="player-avatar-grid">
            {#each avatarKeys.filter((key) => key !== 'gravatar' || !isGuest) as key (key)}<label
                class="avatar-option"
                ><input type="radio" name="avatar" value={key} bind:group={avatar} /><span
                  aria-hidden="true"
                  >{#if key === 'initials'}Aa{:else}<Icon
                      name={key === 'gravatar' ? 'globe' : key}
                      size={24}
                    />{/if}</span
                ><span>{messages.players.avatarLabels[key]}</span></label
              >{/each}
          </div>
        </fieldset>
        {#if avatar === 'gravatar'}<div class="player-gravatar-help">
            <p class="field-hint">{messages.players.gravatarHint}</p>
            {#if player?.avatarImage}<label class="check-label"
                ><input type="checkbox" bind:checked={refreshImage} />{messages.players
                  .refresh}</label
              >{/if}
          </div>{/if}
        <div class="player-field player-color-field">
          <label for="player-color">{messages.players.color}</label>
          <div class="player-color-control">
            <input class="color-input" id="player-color" type="color" bind:value={color} /><output
              for="player-color">{color.toUpperCase()}</output
            >
          </div>
        </div>
      </section>
    </fieldset>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="form-actions player-editor-actions">
      <button class="button" type="submit" disabled={saving}
        ><Icon name="save" />{saving ? messages.players.saving : messages.players.save}</button
      ><button
        class="button secondary"
        type="button"
        disabled={saving}
        onclick={() => dialog.close()}><Icon name="close" />{messages.players.cancel}</button
      >
    </div>
  </form>
</dialog>

<style>
  .player-editor {
    width: min(660px, calc(100% - 2rem));
  }
  form {
    margin-top: var(--space-4);
    gap: var(--space-4);
  }
  .player-editor-fields {
    gap: var(--space-5);
  }
  .player-section {
    min-width: 0;
    display: grid;
    gap: var(--space-4);
  }
  .player-section + .player-section {
    border-top: 1px solid var(--border);
    padding-top: 1.25rem;
  }
  h3 {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 750;
    color: var(--muted-text);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .player-identity-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
    align-items: start;
  }
  .player-identity-grid.guest {
    grid-template-columns: 1fr;
  }
  .player-field {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  .player-identity-grid label {
    display: flex;
    align-items: end;
    min-height: 2.5em;
  }
  .player-field input {
    min-width: 0;
  }
  .player-guest-setting {
    padding: 0.65rem 0.9rem;
    background: var(--soft);
    border-radius: 12px;
  }
  .player-guest-setting .check-label {
    margin: 0;
  }
  .player-guest-setting .field-hint {
    margin-left: calc(20px + var(--space-3));
  }
  .player-preview {
    padding: 0.8rem 1rem;
    border-radius: 12px;
    background: var(--soft);
  }
  .player-preview strong {
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .player-avatar-options {
    display: block;
    margin: 0;
    min-width: 0;
  }
  .player-avatar-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .avatar-option {
    min-width: 0;
    padding: 0.6rem 0.5rem;
    gap: var(--space-2);
    font-size: 0.8rem;
  }
  .avatar-option input {
    flex: 0 0 16px;
    width: 16px;
    min-height: 16px;
    height: 16px;
    padding: 0;
    margin: 0;
  }
  .avatar-option span {
    white-space: nowrap;
  }
  .player-color-field {
    max-width: 250px;
  }
  .player-color-control {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    border: 1px solid var(--input-border);
    border-radius: 9px;
    padding: 0.35rem 0.65rem;
    min-height: 48px;
    background: var(--surface);
  }
  .player-color-control input {
    width: 44px;
    height: 44px;
    min-height: 44px;
    padding: 0;
    border: 0;
    flex-shrink: 0;
  }
  output {
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    color: var(--muted-text);
  }
  .player-editor-actions {
    position: sticky;
    bottom: -1.5rem;
    z-index: 1;
    margin: 0;
    padding: 1rem 0 0.25rem;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }
  .player-gravatar-help {
    display: grid;
    gap: var(--space-2);
  }
  @media (max-width: 600px) {
    .player-identity-grid {
      grid-template-columns: 1fr;
    }
    .player-identity-grid label {
      min-height: 0;
    }
    .player-avatar-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .player-editor {
      padding: var(--panel-padding);
    }
    .player-editor-actions {
      bottom: -1.25rem;
    }
    .player-color-field {
      max-width: none;
    }
  }
</style>
