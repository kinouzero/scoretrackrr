<script lang="ts">
  import Icon from './Icon.svelte';
  import { onMount } from 'svelte';
  import type { PlayerRecord } from '#lib/domain/records';
  import { teamAvatars, type TeamAvatar, type TeamFormat } from '#lib/domain/teams';
  import type { TeamRepository, TeamRoster } from '#lib/storage/teams';
  import type { LocalRepository } from '#lib/storage/repository';
  import { teamErrorMessage } from '#lib/application/team-errors';
  import { messages } from '#lib/i18n/index';
  import TeamAvatarView from './TeamAvatar.svelte';
  import PlayerPicker from './PlayerPicker.svelte';

  let {
    roster,
    teams,
    players,
    ondismiss,
    returnFocus,
    onsaved,
    initialMembers = [],
  }: {
    roster: TeamRoster | null;
    teams: TeamRepository;
    players: LocalRepository;
    ondismiss: () => void;
    returnFocus?: HTMLElement;
    onsaved: () => void;
    initialMembers?: readonly PlayerRecord[];
  } = $props();
  let name = $state('');
  let color = $state('#153e35');
  let avatar = $state<TeamAvatar>('initials');
  let format = $state<TeamFormat>('free');
  let selected = $state<PlayerRecord[]>([]);
  let saving = $state(false);
  let error = $state('');
  let dialog: HTMLDialogElement;
  let nameInput: HTMLInputElement;
  const avatarKeys = Object.keys(teamAvatars) as TeamAvatar[];
  onMount(() => {
    name = roster?.team.name ?? '';
    color = roster?.team.color ?? '#153e35';
    avatar = roster?.team.avatar ?? 'initials';
    format = roster?.team.format ?? 'free';
    selected = [...(roster?.members ?? initialMembers)];
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
    saving = true;
    error = '';
    try {
      const now = new Date().toISOString();
      await teams.saveTeam(
        {
          ...roster?.team,
          id: roster?.team.id ?? crypto.randomUUID(),
          name,
          color,
          avatar,
          format,
          createdAt: roster?.team.createdAt ?? now,
          updatedAt: now,
        },
        selected.map((player) => player.id),
        roster ? { expectedRevision: roster.team.revision ?? 0 } : { create: true },
      );
      onsaved();
    } catch (failure) {
      error = teamErrorMessage(failure);
    } finally {
      saving = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="team-editor-title"
  onclose={ondismiss}
  oncancel={(event) => {
    if (saving) event.preventDefault();
  }}
>
  <h2 id="team-editor-title">{roster ? messages.teams.editTitle : messages.teams.createTitle}</h2>
  <form onsubmit={save}>
    <fieldset class="editor-fields" disabled={saving}>
      <div class="profile-preview">
        <TeamAvatarView team={{ name, color, avatar }} /><span>{name || messages.teams.name}</span>
      </div>
      <label for="team-name">{messages.teams.name}</label><input
        bind:this={nameInput}
        id="team-name"
        bind:value={name}
        required
        maxlength="120"
        autocomplete="off"
      />
      <label for="team-format">{messages.teams.format}</label><select
        id="team-format"
        bind:value={format}
        ><option value="free">{messages.teams.free}</option><option value="petanque_doublette"
          >{messages.teams.doublette}</option
        ></select
      >
      <p class="field-hint">{messages.teams.formatHint}</p>
      <fieldset class="avatar-options">
        <legend>{messages.teams.avatar}</legend>{#each avatarKeys as key (key)}<label
            class="avatar-option"
            ><input type="radio" name="team-avatar" value={key} bind:group={avatar} /><span
              aria-hidden="true"
              >{#if key === 'initials'}Aa{:else}<Icon
                  name={key === 'boules' ? 'petanque' : key}
                  size={24}
                />{/if}</span
            ><span>{messages.teams.avatarLabels[key]}</span></label
          >{/each}
      </fieldset>
      <label for="team-color">{messages.teams.color}</label><input
        class="color-input"
        id="team-color"
        type="color"
        bind:value={color}
      />
      <PlayerPicker repository={players} bind:selected />
    </fieldset>
    <p class="error" role="alert">{error}</p>
    <div class="form-actions">
      <button class="button" type="submit" disabled={saving}
        ><Icon name="save" />{saving ? messages.teams.saving : messages.teams.save}</button
      ><button
        class="button secondary"
        type="button"
        disabled={saving}
        onclick={() => dialog.close()}><Icon name="close" />{messages.players.cancel}</button
      >
    </div>
  </form>
</dialog>
