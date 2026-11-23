<script lang="ts">
  import { translate } from '#lib/i18n/catalog';
  import { isScoreSheet, scoreSheetSpec } from '#lib/domain/games/score-sheets';
  import {
    configuredSixNimmtVersion,
    createSixNimmtGame,
    defaultSixNimmtOptions,
    type SixNimmtOptions,
  } from '#lib/domain/games/six-nimmt';
  import {
    configuredSkullKingVersion,
    createSkullKingGame,
    defaultSkullKingOptions,
    type SkullKingOptions,
  } from '#lib/domain/games/skull-king';
  import Icon from './Icon.svelte';
  import { gameSettings, initialX01Start, x01StartingScores } from '#lib/application/game-settings';
  import SetupPresets from './SetupPresets.svelte';
  import ParticipantOrder from './ParticipantOrder.svelte';
  import { presetParticipants } from '#lib/storage/preset-participants';
  import { onMount } from 'svelte';
  import type { LocalDatabase } from '#lib/storage/database';
  import type { GameVersionRecord, MatchMode, PlayerRecord } from '#lib/domain/records';
  import { CatalogRepository } from '#lib/storage/catalog';
  import { LocalRepository } from '#lib/storage/repository';
  import { TeamRepository, type TeamRoster } from '#lib/storage/teams';
  import { DeclarativeRepository } from '#lib/storage/declarative';
  import { defaultYamsOptions, yamsScoring, createYamsGame } from '#lib/domain/games/yams';
  import { configuredTimesUpVersion, createTimesUpGame } from '#lib/domain/games/times-up';
  import { createGame } from '#lib/domain/games/engine';
  import { catalogGameId } from '#lib/domain/games/catalog';
  import {
    bestOfLength,
    dartsMatchOptions,
    MAX_DARTS_LEGS_PER_SET,
    MAX_DARTS_LEGS_TO_WIN,
    MAX_DARTS_SETS_TO_WIN,
  } from '#lib/domain/games/darts-match';
  import { StorageError } from '#lib/storage/errors';
  import { TeamValidationError } from '#lib/domain/teams';
  import { EngineError } from '#lib/domain/engine/types';
  import { petanqueErrorMessage } from '#lib/application/petanque-errors';
  import { messages, getLocale } from '#lib/i18n/index';
  import { versionName } from '#lib/i18n/presentation';
  import SetupParameters from './SetupParameters.svelte';
  import SettingToggle from './SettingToggle.svelte';
  import PlayerPicker from './PlayerPicker.svelte';
  import TeamPicker from './TeamPicker.svelte';
  let {
    database,
    versionId,
    ondismiss,
    oncreated,
  }: {
    database: LocalDatabase;
    versionId: string;
    ondismiss: () => void;
    oncreated: (id: string) => void;
  } = $props();
  let version = $state.raw<GameVersionRecord>();
  const gameId = $derived(version ? catalogGameId(version) : undefined);
  let fourKindFixed = $state(false);
  let straightPreset = $state<'30/40' | '25/30' | 'custom'>('30/40');
  let smallStraight = $state(30);
  let largeStraight = $state(40);
  let extraYamsBonus = $state(true);
  let joker = $state(true);
  let sixOptions = $state<SixNimmtOptions>({ ...defaultSixNimmtOptions });
  let skullOptions = $state<SkullKingOptions>({ ...defaultSkullKingOptions });
  let cardCount = $state<number | undefined>(40);
  let durationSeconds = $state<number | undefined>(30);

  let variants = $state<GameVersionRecord[]>([]);
  function variantName(item: GameVersionRecord, index: number) {
    if (item.gameId === 'yams')
      return item.definition.upperBonus ? messages.yams.withBonus : messages.yams.withoutBonus;
    const name = versionName(item) || messages.games.custom;
    return item.gameId.startsWith('custom-')
      ? messages.games.publishedVariant(name, index + 1)
      : name;
  }
  function chooseVariant(id: string) {
    const next = variants.find((item) => item.id === id);
    if (!next) return;
    try {
      createGame(next);
    } catch {
      error = messages.matches.invalid;
      return;
    }
    version = next;
    if (!availableModes.includes(mode)) mode = availableModes[0] ?? 'individual';
    error = '';
  }
  const definition = $derived(version ? createGame(version).definition : undefined);
  const teamSelectionAllowed = $derived(
    version?.gameId === 'belote' ||
      version?.gameId === 'darts' ||
      version?.gameId === 'molkky' ||
      version?.gameId === 'times-up',
  );
  const availableModes = $derived(
    definition?.supportedModes.filter(
      (choice) => teamSelectionAllowed || (choice !== 'teams' && choice !== 'mixed'),
    ) ?? [],
  );
  const hasSetupOptions = $derived(
    !!version &&
      (gameSettings(version).length > 0 ||
        ['times-up', 'skull-king', '6-qui-prend'].includes(version.gameId) ||
        availableModes.length > 1 ||
        (version.gameId.startsWith('custom-') && variants.length > 1)),
  );
  const profiles = $derived(new LocalRepository(database));
  const teams = $derived(new TeamRepository(database));
  let players = $state<PlayerRecord[]>([]);
  let rosters = $state<TeamRoster[]>([]);
  let mode = $state<MatchMode>('individual');
  let matchMode = $state(false);
  let x01Start = $state(301);
  let legsToWin = $state(3);
  let legsFormat = $state<'firstTo' | 'bestOf'>('firstTo');
  let useSets = $state(false);
  let setsToWin = $state(2);
  let setsFormat = $state<'firstTo' | 'bestOf'>('firstTo');
  const maxLegWins = $derived(useSets ? MAX_DARTS_LEGS_PER_SET : MAX_DARTS_LEGS_TO_WIN);
  const winChoices = (max: number) => Array.from({ length: max - 1 }, (_, index) => index + 2);
  let startingRule = $state<'alternate' | 'loser'>('alternate');
  let firstStarterId = $state('');
  let corkEnabled = $state(false);
  let corkWinnerId = $state('');
  const camps = $derived(
    mode === 'teams'
      ? rosters.map((roster) => ({ id: roster.team.id, name: roster.team.name }))
      : players.map((player) => ({ id: player.id, name: player.displayName })),
  );
  $effect(() => {
    if (!camps.some((camp) => camp.id === firstStarterId)) firstStarterId = camps[0]?.id ?? '';
    if (!camps.some((camp) => camp.id === corkWinnerId)) corkWinnerId = '';
  });
  let cooperativeName = $state(messages.generic.cooperativeName);
  let saving = $state(false);
  let presetBusy = $state(false);
  let error = $state('');
  let dialog: HTMLDialogElement;
  const participants = $derived([
    ...new Map(
      [
        ...(mode === 'individual' || mode === 'cooperative' || mode === 'mixed' ? players : []),
        ...(mode === 'teams' || mode === 'mixed'
          ? rosters.flatMap((roster) => roster.members)
          : []),
      ].map((player) => [player.id, player]),
    ).values(),
  ]);
  const invalidTimesUpCount = $derived(
    version?.gameId === 'times-up' &&
      (rosters.length < 2 ||
        rosters.length > 6 ||
        rosters.some((roster) => roster.members.length < 2) ||
        participants.length > 12),
  );
  const invalidSixNimmtCount = $derived(
    version?.gameId === '6-qui-prend' &&
      (participants.length < 2 ||
        participants.length > (sixOptions.expansion === 'surprises' ? 8 : 10)),
  );
  const sheet = $derived(
    version && isScoreSheet(version.gameId) ? scoreSheetSpec(version.gameId) : undefined,
  );
  const invalidSheetCount = $derived(
    sheet &&
      (camps.length < sheet.min ||
        camps.length > sheet.max ||
        (sheet.teams && rosters.some((roster) => roster.members.length !== 2))),
  );
  onMount(() => {
    dialog.showModal();
    let active = true;
    void new CatalogRepository(database)
      .readSetupVersions(versionId)
      .then((result) => {
        if (active) {
          variants = result.versions;
          version = result.selected;
          if (version.gameId === 'yams') {
            const rules = createYamsGame(version.definition).definition;
            const options =
              rules.engine === 'yams-turns13'
                ? yamsScoring(rules)
                : { ...defaultYamsOptions, upperBonus: rules.upperBonus };
            fourKindFixed = options.fourKind === 'fixed40';
            smallStraight = options.smallStraight;
            largeStraight = options.largeStraight;
            straightPreset =
              smallStraight === 30 && largeStraight === 40
                ? '30/40'
                : smallStraight === 25 && largeStraight === 30
                  ? '25/30'
                  : 'custom';
            extraYamsBonus = options.extraYamsBonus;
            joker = options.joker;
          }
          if (version.gameId === 'darts' && version.definition.engine === 'x01')
            x01Start = initialX01Start(version.definition.start);
          if (version.gameId === '6-qui-prend')
            sixOptions = { ...createSixNimmtGame(version.definition).options };
          if (version.gameId === 'skull-king')
            skullOptions = { ...createSkullKingGame(version.definition).options };
          if (version.gameId === 'times-up') {
            const options = createTimesUpGame(version.definition).options;
            cardCount = options.cardCount;
            durationSeconds = options.durationSeconds;
          }
          mode = availableModes[0] ?? 'individual';
        }
      })
      .catch(() => {
        if (active) error = messages.matches.invalid;
      });
    return () => {
      active = false;
    };
  });
  function capturePreset() {
    return {
      versionId: version!.id,
      mode,
      playerIds: mode === 'teams' ? [] : players.map((player) => player.id),
      teamIds:
        mode === 'individual' || mode === 'cooperative'
          ? []
          : rosters.map((roster) => roster.team.id),
      fourKindFixed,
      straightPreset,
      smallStraight,
      largeStraight,
      extraYamsBonus,
      joker,
      x01Start,
      matchMode,
      legsToWin,
      ...(matchMode && legsFormat === 'bestOf' ? { legsFormat } : {}),
      ...(matchMode && useSets ? { setsToWin } : {}),
      ...(matchMode && useSets && setsFormat === 'bestOf' ? { setsFormat } : {}),
      startingRule,
      corkEnabled,
      cooperativeName,
      sixOptions: { ...sixOptions },
      skullOptions: { ...skullOptions },
      cardCount,
      durationSeconds,
    };
  }
  async function applyPreset(options: Record<string, unknown>) {
    if (typeof options.versionId !== 'string') throw new Error('Invalid preset');
    const result = await new CatalogRepository(database).readSetupVersions(options.versionId);
    if (catalogGameId(result.selected) !== gameId) throw new Error('Invalid preset game');
    const restored = await presetParticipants(database, options.playerIds, options.teamIds);
    const nextGame = createGame(result.selected);
    if (result.selected.gameId === '6-qui-prend')
      configuredSixNimmtVersion(options.sixOptions as SixNimmtOptions, '');
    if (result.selected.gameId === 'skull-king')
      configuredSkullKingVersion(options.skullOptions as SkullKingOptions, '');
    if (result.selected.gameId === 'times-up')
      configuredTimesUpVersion(
        {
          cardCount: options.cardCount as number,
          durationSeconds: options.durationSeconds as number,
        },
        '',
      );
    if (!nextGame.definition.supportedModes.some((choice) => choice === options.mode))
      throw new Error('Invalid preset mode');
    if (
      !x01StartingScores.includes(Number(options.x01Start)) ||
      !['30/40', '25/30', 'custom'].includes(String(options.straightPreset)) ||
      !['alternate', 'loser'].includes(String(options.startingRule))
    )
      throw new Error('Invalid preset options');
    for (const name of ['fourKindFixed', 'extraYamsBonus', 'joker', 'matchMode', 'corkEnabled'])
      if (typeof options[name] !== 'boolean') throw new Error('Invalid preset toggle');
    for (const name of ['smallStraight', 'largeStraight', 'legsToWin'])
      if (
        !Number.isInteger(options[name]) ||
        Number(options[name]) < 0 ||
        Number(options[name]) > 1000
      )
        throw new Error('Invalid preset number');
    const presetSeries = options.matchMode
      ? dartsMatchOptions({
          legsToWin: options.legsToWin,
          ...(options.setsToWin !== undefined ? { setsToWin: options.setsToWin } : {}),
          ...(options.legsFormat !== undefined ? { legsFormat: options.legsFormat } : {}),
          ...(options.setsFormat !== undefined ? { setsFormat: options.setsFormat } : {}),
          startingRule: options.startingRule,
          firstStarterId: '',
        })
      : undefined;
    variants = result.versions;
    version = result.selected;
    mode = options.mode as MatchMode;
    players = restored.players;
    rosters = restored.rosters;
    fourKindFixed = options.fourKindFixed as boolean;
    straightPreset = options.straightPreset as typeof straightPreset;
    smallStraight = options.smallStraight as number;
    largeStraight = options.largeStraight as number;
    extraYamsBonus = options.extraYamsBonus as boolean;
    joker = options.joker as boolean;
    x01Start = options.x01Start as number;
    matchMode = options.matchMode as boolean;
    legsToWin = options.legsToWin as number;
    legsFormat = presetSeries?.legsFormat ?? 'firstTo';
    useSets = presetSeries?.setsToWin !== undefined;
    setsToWin = presetSeries?.setsToWin ?? 2;
    setsFormat = presetSeries?.setsFormat ?? 'firstTo';
    startingRule = options.startingRule as typeof startingRule;
    corkEnabled = options.corkEnabled as boolean;
    if (result.selected.gameId === '6-qui-prend')
      sixOptions = { ...(options.sixOptions as SixNimmtOptions) };
    if (result.selected.gameId === 'skull-king')
      skullOptions = { ...(options.skullOptions as SkullKingOptions) };
    cardCount = options.cardCount as number;
    durationSeconds = options.durationSeconds as number;
    corkWinnerId = '';
    firstStarterId = '';
    if (typeof options.cooperativeName === 'string') cooperativeName = options.cooperativeName;
  }
  function reorder(ids: string[]) {
    if (mode === 'teams')
      rosters = ids.map((id) => rosters.find((roster) => roster.team.id === id)!);
    else players = ids.map((id) => players.find((player) => player.id === id)!);
  }
  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (saving || presetBusy) return;
    if (!availableModes.includes(mode)) {
      error = messages.generic.unavailableMode;
      return;
    }
    if (
      version?.gameId === 'darts' &&
      corkEnabled &&
      !camps.some((camp) => camp.id === corkWinnerId)
    ) {
      error = messages.dartsCork.required;
      return;
    }
    saving = true;
    error = '';
    try {
      const match = await new DeclarativeRepository(database).create({
        id: crypto.randomUUID(),
        versionId: version!.id,
        mode,
        playerIds: mode === 'teams' ? [] : players.map((player) => player.id),
        teams:
          mode === 'individual' || mode === 'cooperative'
            ? []
            : rosters.map((roster) => ({
                id: roster.team.id,
                revision: roster.team.revision ?? 0,
              })),
        organizerPlayerId: participants[0]?.id ?? '',
        cooperativeName,
        createdAt: new Date().toISOString(),
        ...(version?.gameId === '6-qui-prend' ? { sixNimmtOptions: { ...sixOptions } } : {}),
        ...(version?.gameId === 'skull-king' ? { skullKingOptions: { ...skullOptions } } : {}),
        ...(version?.gameId === 'times-up'
          ? { timesUpOptions: { cardCount: cardCount!, durationSeconds: durationSeconds! } }
          : {}),
        ...(version?.gameId === 'yams'
          ? {
              yamsOptions: {
                upperBonus: version.definition.upperBonus === true,
                fourKind: fourKindFixed ? ('fixed40' as const) : ('sum' as const),
                smallStraight:
                  straightPreset === 'custom'
                    ? smallStraight
                    : straightPreset === '25/30'
                      ? 25
                      : 30,
                largeStraight:
                  straightPreset === 'custom'
                    ? largeStraight
                    : straightPreset === '25/30'
                      ? 30
                      : 40,
                extraYamsBonus,
                joker,
              },
            }
          : {}),
        ...(version?.gameId === 'darts' && version.definition.engine === 'x01' ? { x01Start } : {}),
        ...(version?.gameId === 'darts' && matchMode
          ? {
              dartsMatch: {
                legsToWin,
                ...(legsFormat === 'bestOf' ? { legsFormat } : {}),
                ...(useSets ? { setsToWin } : {}),
                ...(useSets && setsFormat === 'bestOf' ? { setsFormat } : {}),
                startingRule,
                firstStarterId: corkEnabled ? corkWinnerId : firstStarterId,
              },
            }
          : {}),
        ...(version?.gameId === 'darts' && corkEnabled ? { dartsCorkWinnerId: corkWinnerId } : {}),
      });
      oncreated(match.id);
    } catch (failure) {
      error =
        failure instanceof EngineError ||
        failure instanceof TeamValidationError ||
        (failure instanceof StorageError && failure.code === 'invalid_record')
          ? messages.generic.invalidSetup
          : petanqueErrorMessage(failure, true);
    } finally {
      saving = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="declarative-setup-title"
  onclose={ondismiss}
  oncancel={(event) => {
    if (saving) event.preventDefault();
  }}
>
  <h2 id="declarative-setup-title">
    {version?.gameId === 'darts'
      ? messages.darts.setup(gameId === 'cricket' ? 'Cricket' : 'X01')
      : version?.gameId === 'yams'
        ? messages.yams.setup
        : messages.generic.setup}
  </h2>
  {#if definition}<form onsubmit={create}>
      {#if hasSetupOptions}
        <SetupPresets
          disabled={saving}
          bind:busy={presetBusy}
          gameId={gameId!}
          capture={capturePreset}
          apply={applyPreset}
        />
      {/if}
      <fieldset class="editor-fields" disabled={saving || presetBusy}>
        <SetupParameters
          version={version!}
          versions={variants}
          onselect={chooseVariant}
          bind:x01Start
        />
        {#if version?.gameId === '6-qui-prend'}
          <fieldset class="setup-parameters">
            <legend>{messages.parameters.title}</legend>
            <SettingToggle
              label={messages.sixNimmt.jokers}
              checked={sixOptions.expansion === 'jokers'}
              onchange={(enabled) =>
                (sixOptions = { ...sixOptions, expansion: enabled ? 'jokers' : 'none' })}
            />
            <SettingToggle
              label={messages.sixNimmt.surprises}
              hint={messages.sixNimmt.surprisesSetup}
              checked={sixOptions.expansion === 'surprises'}
              onchange={(enabled) =>
                (sixOptions = {
                  expansion: enabled ? 'surprises' : 'none',
                  passCards: false,
                  variableRows: false,
                })}
            />
            {#if sixOptions.expansion !== 'surprises'}
              <SettingToggle
                label={messages.sixNimmt.passCards}
                checked={sixOptions.passCards}
                onchange={(enabled) => (sixOptions = { ...sixOptions, passCards: enabled })}
              />
              <SettingToggle
                label={messages.sixNimmt.variableRows}
                checked={sixOptions.variableRows}
                onchange={(enabled) => (sixOptions = { ...sixOptions, variableRows: enabled })}
              />
            {/if}
          </fieldset>
        {/if}
        {#if version?.gameId === 'skull-king'}
          <fieldset class="setup-parameters">
            <legend>{messages.parameters.title}</legend>
            <SettingToggle
              label={messages.skull.advancedCards}
              hint={messages.skull.advancedHint}
              checked={skullOptions.advancedCards}
              onchange={(enabled) => (skullOptions = { ...skullOptions, advancedCards: enabled })}
            />
            <SettingToggle
              label={messages.skull.expansion}
              hint={messages.skull.expansionHint}
              checked={skullOptions.expansion}
              onchange={(enabled) => (skullOptions = { ...skullOptions, expansion: enabled })}
            />
            <SettingToggle
              label={messages.skull.loot}
              hint={messages.skull.lootHint}
              checked={skullOptions.loot}
              onchange={(enabled) => (skullOptions = { ...skullOptions, loot: enabled })}
            />
            <SettingToggle
              label={messages.skull.rascal}
              hint={messages.skull.rascalHint}
              checked={skullOptions.scoring === 'rascal'}
              onchange={(enabled) =>
                (skullOptions = { ...skullOptions, scoring: enabled ? 'rascal' : 'classic' })}
            />
          </fieldset>
        {/if}
        {#if version?.gameId === 'times-up'}
          <fieldset class="setup-parameters">
            <legend>{messages.parameters.title}</legend>
            <div class="game-field">
              <label for="times-up-card-count">{messages.timesUp.cardCount}</label>
              <input
                id="times-up-card-count"
                type="number"
                min="1"
                max="1000"
                step="1"
                bind:value={cardCount}
                required
              />
            </div>
            <div class="game-field">
              <label for="times-up-duration">{messages.timesUp.durationSeconds}</label>
              <input
                id="times-up-duration"
                type="number"
                min="1"
                max="600"
                step="1"
                bind:value={durationSeconds}
                required
              />
            </div>
          </fieldset>
        {/if}
        {#if version?.gameId === 'yams'}
          <fieldset class="setup-parameters">
            <legend>{messages.yams.scoringSettings}</legend>
            <SettingToggle
              label={messages.yams.fixedFourKind}
              hint={messages.yams.fourKindHint}
              checked={fourKindFixed}
              onchange={(enabled) => (fourKindFixed = enabled)}
            />
            <div class="game-field">
              <label for="yams-straights">{messages.yams.straights}</label>
              <select id="yams-straights" bind:value={straightPreset}>
                <option value="30/40">30 / 40</option><option value="25/30">25 / 30</option><option
                  value="custom">{messages.yams.customStraights}</option
                >
              </select>
            </div>
            {#if straightPreset === 'custom'}
              <div class="game-field">
                <label for="yams-small-straight">{messages.yams.smallStraightValue}</label><input
                  id="yams-small-straight"
                  type="number"
                  min="1"
                  max="1000"
                  step="1"
                  bind:value={smallStraight}
                  required
                />
              </div>
              <div class="game-field">
                <label for="yams-large-straight">{messages.yams.largeStraightValue}</label><input
                  id="yams-large-straight"
                  type="number"
                  min="1"
                  max="1000"
                  step="1"
                  bind:value={largeStraight}
                  required
                />
              </div>
            {/if}
            <SettingToggle
              label={messages.yams.extraYamsBonus}
              hint={messages.yams.extraYamsHint}
              checked={extraYamsBonus}
              onchange={(enabled) => (extraYamsBonus = enabled)}
            />
            <SettingToggle
              label={messages.yams.joker}
              hint={messages.yams.jokerHint}
              checked={joker}
              onchange={(enabled) => (joker = enabled)}
            />
          </fieldset>
        {/if}
        {#if version?.gameId.startsWith('custom-')}<details class="saved-rule-settings">
            <summary>{messages.parameters.history}</summary>
            <label for="saved-rule-configuration">{messages.parameters.savedRules}</label><select
              id="saved-rule-configuration"
              value={version.id}
              onchange={(event) => chooseVariant(event.currentTarget.value)}
            >
              {#each variants as item, index (item.id)}<option value={item.id}
                  >{variantName(item, index)}</option
                >{/each}
            </select>
          </details>{/if}
        {#if availableModes.includes('individual') && availableModes.includes('teams')}
          <SettingToggle
            label={messages.parameters.teamPlay}
            checked={mode === 'teams'}
            onchange={(enabled) => (mode = enabled ? 'teams' : 'individual')}
          />
        {:else if availableModes.includes('individual') && availableModes.includes('cooperative')}
          <SettingToggle
            label={messages.parameters.cooperativePlay}
            checked={mode === 'cooperative'}
            onchange={(enabled) => (mode = enabled ? 'cooperative' : 'individual')}
          />
        {/if}
        {#if mode === 'individual' || mode === 'cooperative' || mode === 'mixed'}<PlayerPicker
            repository={profiles}
            bind:selected={players}
          />{/if}
        {#if teamSelectionAllowed && (mode === 'teams' || mode === 'mixed')}<TeamPicker
            repository={teams}
            bind:selected={rosters}
          />{/if}
        {#if sheet}
          <p class="field-hint">
            {sheet.teams
              ? translate(getLocale(), 'scoreSheet.beloteRoster')
              : translate(getLocale(), 'scoreSheet.roster', { min: sheet.min, max: sheet.max })}
          </p>
        {/if}
        <ParticipantOrder items={camps} onchange={reorder} />
        {#if mode === 'cooperative'}<label for="cooperative-name">{messages.teams.name}</label
          ><input
            id="cooperative-name"
            bind:value={cooperativeName}
            maxlength="120"
            required
          />{/if}
        {#if version?.gameId === 'darts'}
          <SettingToggle
            label={messages.dartsMatch.enable}
            checked={matchMode}
            onchange={(enabled) => (matchMode = enabled)}
          />
          {#if matchMode}<p>{messages.dartsMatch.setupHint}</p>
            <SettingToggle
              label={messages.dartsMatch.enableSets}
              checked={useSets}
              onchange={(enabled) => {
                useSets = enabled;
                if (enabled && legsToWin > MAX_DARTS_LEGS_PER_SET)
                  legsToWin = MAX_DARTS_LEGS_PER_SET;
              }}
            />
            {#if useSets}
              <label for="sets-format">{messages.dartsMatch.setsFormat}</label>
              <select id="sets-format" bind:value={setsFormat}>
                <option value="firstTo">{messages.dartsMatch.firstTo}</option>
                <option value="bestOf">{messages.dartsMatch.bestOf}</option>
              </select>
              {#if setsFormat === 'bestOf'}
                <label for="sets-best-of">{messages.dartsMatch.setsBestOf}</label>
                <select id="sets-best-of" bind:value={setsToWin} required>
                  {#each winChoices(MAX_DARTS_SETS_TO_WIN) as wins (wins)}
                    <option value={wins}>{bestOfLength(wins)}</option>
                  {/each}
                </select>
              {:else}
                <label for="sets-to-win">{messages.dartsMatch.setsToWin}</label>
                <input
                  id="sets-to-win"
                  type="number"
                  min="2"
                  max={MAX_DARTS_SETS_TO_WIN}
                  step="1"
                  bind:value={setsToWin}
                  required
                />
              {/if}
            {/if}
            <label for="legs-format"
              >{useSets
                ? messages.dartsMatch.legsPerSetFormat
                : messages.dartsMatch.legsFormat}</label
            >
            <select id="legs-format" bind:value={legsFormat}>
              <option value="firstTo">{messages.dartsMatch.firstTo}</option>
              <option value="bestOf">{messages.dartsMatch.bestOf}</option>
            </select>
            {#if legsFormat === 'bestOf'}
              <label for="legs-best-of"
                >{useSets
                  ? messages.dartsMatch.legsPerSetBestOf
                  : messages.dartsMatch.legsBestOf}</label
              >
              <select id="legs-best-of" bind:value={legsToWin} required>
                {#each winChoices(maxLegWins) as wins (wins)}
                  <option value={wins}>{bestOfLength(wins)}</option>
                {/each}
              </select>
            {:else}
              <label for="legs-to-win"
                >{useSets ? messages.dartsMatch.legsPerSet : messages.dartsMatch.legsToWin}</label
              >
              <input
                id="legs-to-win"
                type="number"
                min="2"
                max={maxLegWins}
                step="1"
                bind:value={legsToWin}
                required
              />
            {/if}
            <label for="leg-start-rule">{messages.dartsMatch.startRule}</label><select
              id="leg-start-rule"
              bind:value={startingRule}
              ><option value="alternate">{messages.dartsMatch.alternate}</option><option
                value="loser">{messages.dartsMatch.loser}</option
              ></select
            >
            {#if !corkEnabled}<label for="first-leg-starter"
                >{messages.dartsMatch.firstStarter}</label
              ><select id="first-leg-starter" bind:value={firstStarterId} required
                >{#each camps as camp (camp.id)}<option value={camp.id}>{camp.name}</option
                  >{/each}</select
              >{/if}{/if}
          <SettingToggle
            label={messages.dartsCork.enable}
            hint={messages.dartsCork.hint}
            checked={corkEnabled}
            onchange={(enabled) => (corkEnabled = enabled)}
          />
          {#if corkEnabled}
            <fieldset class="setup-parameters cork-choices">
              <legend>{messages.dartsCork.winner}</legend>
              <p class="field-hint">{messages.dartsCork.instructions}</p>
              <p class="field-hint">{messages.dartsCork.tie}</p>
              {#each camps as camp (camp.id)}
                <label class="check-label cork-choice">
                  <input
                    type="radio"
                    name="cork-winner"
                    value={camp.id}
                    bind:group={corkWinnerId}
                    required
                  />
                  <span>{camp.name}</span>
                </label>
              {/each}
              {#if !camps.length}<p class="field-hint">{messages.dartsCork.chooseSides}</p>{/if}
            </fieldset>
          {/if}
        {/if}
      </fieldset>
      {#if !availableModes.length}<p class="error" role="alert">
          {messages.generic.unavailableMode}
        </p>{/if}
      <p class="error" role="alert">{error}</p>
      {#if matchMode && version?.gameId === 'darts' && camps.length !== 2}<p class="error">
          {messages.dartsMatch.twoCamps}
        </p>{/if}
      <div class="form-actions">
        <button
          class="button"
          disabled={saving ||
            presetBusy ||
            (version?.gameId === 'darts' &&
              corkEnabled &&
              !camps.some((camp) => camp.id === corkWinnerId)) ||
            invalidTimesUpCount ||
            invalidSixNimmtCount ||
            invalidSheetCount ||
            !availableModes.includes(mode) ||
            !participants.length ||
            (matchMode && version?.gameId === 'darts' && camps.length !== 2)}
          ><Icon name="plus" />{saving
            ? messages.petanque.saving
            : messages.petanque.createDraft}</button
        >
        <button
          class="button secondary"
          type="button"
          disabled={saving || presetBusy}
          onclick={() => dialog.close()}><Icon name="close" />{messages.players.cancel}</button
        >
      </div>
    </form>
  {:else}<p class="error" role="alert">{error || messages.games.loading}</p>
    <button class="button secondary" onclick={() => dialog.close()}
      ><Icon name="close" />{messages.players.cancel}</button
    >{/if}
</dialog>

<style>
  .cork-choices {
    display: grid;
    gap: var(--space-3);
  }
  .cork-choices p {
    margin: 0;
  }
  .cork-choice {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: var(--space-2) var(--space-3);
  }
  .cork-choice:has(input:checked) {
    background: var(--selected);
    border-color: var(--accent);
  }
  .cork-choice span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
