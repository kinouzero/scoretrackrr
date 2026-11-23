import { expect, test, type Page } from '../fixtures/browser';
import { seedPlayers } from '../fixtures/players';
import { configureDarts } from '../fixtures/setup-settings';

async function createMatch(page: Page, variant: string, series?: 'legs' | 'sets') {
  await seedPlayers(page, ['Alice', 'Bob']);
  await page.goto('/games/');
  await page
    .getByRole('link', {
      name: variant.startsWith('Cricket') ? 'Jouer au Cricket' : 'Jouer au X01',
      exact: true,
    })
    .click();
  const setup = page.getByRole('dialog');
  await configureDarts(setup, variant);
  for (const name of ['Alice', 'Bob']) {
    await setup.getByRole('checkbox', { name: `Sélectionner ${name}`, exact: true }).check();
  }
  if (series) {
    await setup.getByRole('switch', { name: 'Match en plusieurs legs' }).check();
    await setup.getByLabel('Nombre de legs à gagner').fill('2');
    if (series === 'sets') {
      await setup.getByRole('switch', { name: 'Jouer en sets' }).check();
      await setup.getByLabel('Nombre de sets à gagner').fill('2');
    }
    await setup.getByLabel('Premier lanceur du premier leg').selectOption({ label: 'Alice' });
  }
  await setup.getByRole('button', { name: 'Créer la partie', exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer la partie', exact: true }).click();
  const actions = page.getByRole('group', { name: 'Actions de la partie', exact: true });
  await actions.getByText('GranBoard', { exact: true }).click();
}

const arm = (page: Page) =>
  page.getByRole('button', { name: 'Activer la cible pour ce tour', exact: true });

test('explains why GranBoard pairing is unavailable without hiding the section', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { value: false });
  });
  await createMatch(page, '301 · sortie double');
  await expect(
    page.getByText('Ouvre Scoretrackrr avec une adresse HTTPS pour connecter une GranBoard.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connecter en Bluetooth', exact: true }),
  ).toHaveCount(0);
});

test('explains unavailable Bluetooth or relay support on a secure page', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'bluetooth', { value: undefined });
  });
  await createMatch(page, '301 · sortie double');
  await expect(page.getByText(/La connexion GranBoard est indisponible ici/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connecter en Bluetooth', exact: true }),
  ).toHaveCount(0);
});

async function mockAudio(page: Page) {
  await page.addInitScript(() => {
    let sounds = 0;
    class MockAudio {
      state = 'suspended';
      currentTime = 0;
      resume = async () => {
        this.state = 'running';
      };
      createGain = () => ({
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      });
      createPeriodicWave = () => ({});
      createOscillator = () => {
        const notes: number[] = [];
        return {
          frequency: {
            exponentialRampToValueAtTime() {},
            setValueAtTime(value: number) {
              notes.push(value);
            },
          },
          connect: (gain: unknown) => gain,
          setPeriodicWave() {},
          start() {
            document.documentElement.dataset.boardSounds = String(++sounds);
            document.documentElement.dataset.lastBoardCue = notes.join(',');
          },
          stop() {},
        };
      };
    }
    Object.defineProperty(window, 'AudioContext', { value: MockAudio });
  });
}

async function mockBluetooth(page: Page) {
  await mockAudio(page);
  await page.addInitScript(() => {
    const characteristic = Object.assign(new EventTarget(), {
      uuid: '442f1571-8a00-9a28-cbe1-e1d4212d53eb',
      properties: { notify: true },
      value: new DataView(new ArrayBuffer(0)),
      startNotifications: async () => {},
    });
    const effects: string[] = [];
    const lights = {
      uuid: '442f1572-8a00-9a28-cbe1-e1d4212d53eb',
      properties: { writeWithoutResponse: true },
      writeValueWithoutResponse: async (frame: Uint8Array) => {
        effects.push(frame.join(''));
        document.documentElement.dataset.boardEffects = effects.join(',');
      },
    };
    let connections = 0;
    let disconnections = 0;
    let pairings = 0;
    const device = Object.assign(new EventTarget(), {
      gatt: {
        connect: async () => {
          document.documentElement.dataset.boardConnections = String(++connections);
          return device.gatt;
        },
        disconnect: () => {
          document.documentElement.dataset.boardDisconnections = String(++disconnections);
          device.dispatchEvent(new Event('gattserverdisconnected'));
        },
        getPrimaryService: async (uuid: string) => {
          if (uuid !== '442f1570-8a00-9a28-cbe1-e1d4212d53eb') throw new Error('Service');
          return {
            getCharacteristics: async () => [characteristic, lights],
          };
        },
      },
    });
    Object.defineProperty(navigator, 'bluetooth', {
      value: {
        requestDevice: async () => {
          document.documentElement.dataset.boardPairings = String(++pairings);
          return device;
        },
      },
    });
    window.addEventListener('test-board-loss', () => {
      device.dispatchEvent(new Event('gattserverdisconnected'));
    });
    window.addEventListener('test-board', (event) => {
      for (const frame of (event as CustomEvent<string[]>).detail) {
        characteristic.value = new DataView(new TextEncoder().encode(frame).buffer);
        characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
      }
    });
  });
}

test('direct Bluetooth survives a pause and leg change, then closes on cancellation', async ({
  page,
}) => {
  await mockBluetooth(page);
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = (resource, options) => {
      if (resource === '/api/granboard/status') {
        document.documentElement.dataset.relayProbed = 'true';
        return Promise.resolve(Response.json({ protocol: 'granboard-v1' }));
      }
      return fetch(resource, options);
    };
  });
  await createMatch(page, '301 · sortie double', 'legs');
  await expect(page.getByLabel('Code de connexion au relais')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-relay-probed', 'true');
  const emit = (...frames: string[]) =>
    page.evaluate(
      (detail) => window.dispatchEvent(new CustomEvent('test-board', { detail })),
      frames,
    );
  const scores = page.getByRole('region', { name: 'Scores', exact: true });
  await page.getByRole('button', { name: 'Connecter en Bluetooth', exact: true }).click();
  await expect(arm(page)).toBeEnabled();
  await emit('4.0@');
  await arm(page).click();
  await emit('3.4@', '3.4@', '3.4@', '4.0@');
  await expect(page.getByRole('heading', { name: 'Volée terminée · Alice' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer la fléchette' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toHaveCount(0);
  await emit('BTN@');
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await expect(scores).toContainText(/Alice\s*121/);
  await expect(scores).toContainText(/Bob\s*301/);
  await emit('4.0@');
  await expect(scores).toContainText(/Bob\s*251/);
  await page.getByRole('button', { name: 'Annuler la dernière saisie' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(scores).toContainText(/Bob\s*301/);
  await expect(page.getByText('Impacts enregistrés pour ce tour', { exact: true })).toBeVisible();
  const browserState = page.locator('html');
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await expect(page.locator('.match-card .match-status')).toHaveText('En pause');
  await emit('4.0@');
  await page.getByRole('link', { name: 'Joueurs', exact: true }).click();
  await page.getByRole('link', { name: 'Parties', exact: true }).click();
  await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await expect(page.getByText('Cible connectée', { exact: true })).toBeVisible();
  await expect(scores).toContainText(/Bob\s*301/);
  await expect(browserState).not.toHaveAttribute('data-board-disconnections');
  await expect(browserState).toHaveAttribute('data-board-connections', '1');
  await arm(page).click();
  await emit('3.4@', '3.4@', '3.4@');
  await expect(page.getByRole('heading', { name: 'Volée terminée · Bob' })).toBeVisible();
  await page.getByRole('button', { name: 'Joueur suivant', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Au tour de Alice', exact: true })).toBeVisible();
  await emit('3.4@', '3.1@', '6.6@');
  const nextLeg = page.getByRole('button', { name: 'Démarrer le leg 2', exact: true });
  await expect(nextLeg).toBeVisible();
  await expect(page.getByText('Cible connectée', { exact: true })).toBeVisible();
  await expect(arm(page)).toBeDisabled();
  await nextLeg.click();
  await expect(nextLeg).toHaveCount(0);
  await expect(arm(page)).toBeDisabled();
  await emit('4.0@');
  await expect(scores).toContainText(/Bob\s*251/);
  await expect(browserState).toHaveAttribute('data-board-connections', '1');
  await page.evaluate(() => window.dispatchEvent(new Event('test-board-loss')));
  await expect(page.getByText(/Reconnexion en cours/)).toBeVisible();
  await expect(arm(page)).toBeEnabled();
  await expect(browserState).toHaveAttribute('data-board-pairings', '1');
  await expect(browserState).toHaveAttribute('data-board-connections', '2');
  await page.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
  await page.locator('.match-card').getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(browserState).toHaveAttribute('data-board-disconnections', '2');
});

test('the physical button hands over the visit and accepted hits play sound and color', async ({
  page,
  context,
}) => {
  await mockBluetooth(page);
  await createMatch(page, '301 · sortie double');
  await page.clock.install();
  await page.getByRole('button', { name: 'Connecter en Bluetooth', exact: true }).click();
  await expect(arm(page)).toBeEnabled();
  const emit = (...frames: string[]) =>
    page.evaluate(
      (detail) => window.dispatchEvent(new CustomEvent('test-board', { detail })),
      frames,
    );
  await emit('BTN@');
  await expect(arm(page)).toBeDisabled();
  await page.clock.fastForward(500);
  await emit('3.4@', 'BTN@', 'BTN@', '4.0@');
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  const scores = page.getByRole('region', { name: 'Scores', exact: true });
  await expect(scores).toContainText(/Alice\s*241/);
  await expect(scores).toContainText(/Bob\s*301/);
  await expect(page.locator('html')).toHaveAttribute(
    'data-board-effects',
    /(?:^|,)10004000000000000003(?:,|$)/,
  );
  await expect(page.locator('html')).toHaveAttribute('data-board-sounds', '1');
  await expect(page.locator('html')).toHaveAttribute('data-last-board-cue', '760,760,760');
  const settings = await context.newPage();
  await settings.goto('/settings/');
  const sounds = settings.getByRole('switch', { name: 'Sons des fléchettes', exact: true });
  await expect(sounds).toBeChecked();
  await sounds.uncheck();
  await settings.reload();
  await expect(sounds).not.toBeChecked();
  await page.bringToFront();
  await emit('4.0@');
  await expect(scores).toContainText(/Bob\s*251/);
  await expect(page.locator('html')).toHaveAttribute('data-board-sounds', '1');
  await sounds.check();
  await settings.close();
  await page.bringToFront();
  await page.getByLabel('Secteur touché', { exact: true }).selectOption('0');
  await page.getByRole('button', { name: 'Enregistrer la fléchette', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-board-sounds', '2');
  await expect(page.locator('html')).toHaveAttribute('data-last-board-cue', '350');
});

test('a detected miss uses its own cue and a winning double bull plays the victory cue', async ({
  page,
}) => {
  await mockBluetooth(page);
  await createMatch(page, '101 · sortie simple');
  await page.getByRole('button', { name: 'Connecter en Bluetooth', exact: true }).click();
  await arm(page).click();
  const state = page.locator('html');
  await expect(state).toHaveAttribute('data-board-effects', /(?:^|,)44444444444444444444(?:,|$)/);
  const emit = (...frames: string[]) =>
    page.evaluate(
      (detail) => window.dispatchEvent(new CustomEvent('test-board', { detail })),
      frames,
    );
  await emit('OUT@');
  await expect(page.getByText(/^Fléchette 2 sur 3/)).toBeVisible();
  await expect(state).toHaveAttribute('data-last-board-cue', '350');
  await emit('10.0@');
  await expect(state).toHaveAttribute('data-board-effects', /(?:^|,)33333333333333333333(?:,|$)/);
  await emit('4.0@');
  await expect(page.getByText('Victoire : Alice', { exact: true })).toBeVisible();
  await expect(state).toHaveAttribute('data-last-board-cue', '392,523,659,784,1047');
  await expect(state).toHaveAttribute('data-board-disconnections', '1');
});

for (const points of [true, false]) {
  test(`Cricket adapts the GranBoard lights to its scoring option (points=${points})`, async ({
    page,
  }) => {
    await mockBluetooth(page);
    await createMatch(page, points ? 'Cricket · points classiques' : 'Cricket · sans points');
    await page.getByRole('button', { name: 'Connecter en Bluetooth', exact: true }).click();
    await arm(page).click();
    const state = page.locator('html');
    const emit = (frame: string) =>
      page.evaluate(
        (detail) => window.dispatchEvent(new CustomEvent('test-board', { detail })),
        [frame],
      );

    await expect(state).toHaveAttribute('data-board-effects', /(?:^|,)0{14}4{6}$/);
    await emit('3.4@'); // T20 closes 20 for Alice.
    await expect(state).toHaveAttribute(
      'data-board-effects',
      new RegExp(`(?:^|,)0{14}4{5}${points ? '3' : '0'}$`),
    );
    await emit('2.6@'); // D1 is outside Cricket's playable targets.
    await expect(state).toHaveAttribute('data-board-effects', /(?:^|,)10{19}(?:,|$)/);

    await emit('BTN@');
    await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
    await expect(state).toHaveAttribute('data-board-effects', /(?:^|,)0{14}4{6}$/);
  });
}

async function mockRelay(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'bluetooth', { value: undefined });
    const fetch = window.fetch.bind(window);
    let streams = 0;
    window.fetch = async (resource, options) => {
      if (resource === '/api/granboard/status') return Response.json({ protocol: 'granboard-v1' });
      if (resource === '/api/granboard/session') {
        return new Response(null, {
          status:
            options?.method === 'POST' && options.body === '{"code":"test-pairing"}' ? 204 : 403,
        });
      }
      if (resource === '/api/granboard/lights') {
        if (options?.method !== 'POST' || !(options.body instanceof Uint8Array))
          return new Response(null, { status: 400 });
        const element = document.documentElement;
        element.dataset.relayLights = [element.dataset.relayLights, options.body[0]]
          .filter(Boolean)
          .join(',');
        return new Response(null, { status: 204 });
      }
      return fetch(resource, options);
    };
    class BoardStream extends EventTarget {
      onerror: (() => void) | null = null;
      constructor(url: string) {
        super();
        if (url !== '/api/granboard/events') throw new Error('Events path');
        document.documentElement.dataset.boardStreams = String(++streams);
        window.addEventListener('test-relay', this.relay);
        queueMicrotask(() => this.send({ type: 'ready', lights: true, lightPatterns: true }));
      }
      send(data: unknown) {
        this.dispatchEvent(new MessageEvent('board', { data: JSON.stringify(data) }));
      }
      relay = (event: Event) => {
        const detail = (event as CustomEvent<{ sequence: number; frame: string }>).detail;
        this.send({ type: 'hit', ...detail });
      };
      close() {
        window.removeEventListener('test-relay', this.relay);
      }
    }
    Object.defineProperty(window, 'EventSource', { value: BoardStream });
  });
}

for (const transport of ['Bluetooth', 'relay'] as const) {
  test(`resumes GranBoard scoring after canceling and confirming undo through ${transport}`, async ({
    page,
  }) => {
    const relay = transport === 'relay';
    await (relay ? mockRelay(page) : mockBluetooth(page));
    await createMatch(page, '301 · sortie double');
    if (relay) await page.getByLabel('Code de connexion au relais').fill('test-pairing');
    await page
      .getByRole('button', {
        name: relay ? 'Connecter via le relais' : 'Connecter en Bluetooth',
        exact: true,
      })
      .click();
    await arm(page).click();
    let sequence = 0;
    const emit = (frame: string) =>
      page.evaluate(
        ({ relay, frame, sequence }) => {
          window.dispatchEvent(
            relay
              ? new CustomEvent('test-relay', { detail: { sequence, frame } })
              : new CustomEvent('test-board', { detail: [frame] }),
          );
        },
        { relay, frame, sequence: ++sequence },
      );
    const scores = page.getByRole('region', { name: 'Scores', exact: true });
    const undo = page.getByRole('button', { name: 'Annuler la dernière saisie', exact: true });
    const dialog = page.getByRole('dialog');
    const armed = page.getByText('Impacts enregistrés pour ce tour', { exact: true });

    await emit('3.4@');
    await expect(scores).toContainText(/Alice\s*241/);
    await undo.click();
    await emit('4.0@');
    await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(scores).toContainText(/Alice\s*241/);
    await expect(armed).toBeVisible();

    await undo.click();
    await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
    await expect(scores).toContainText(/Alice\s*301/);
    await expect(armed).toBeVisible();
    await emit('4.0@');
    await expect(scores).toContainText(/Alice\s*251/);
    await emit('3.4@');
    await emit('3.4@');
    await expect(page.getByRole('heading', { name: 'Volée terminée · Alice' })).toBeVisible();
    await expect(scores).toContainText(/Alice\s*131/);

    await undo.click();
    await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Au tour de Alice', exact: true }),
    ).toBeVisible();
    await expect(scores).toContainText(/Alice\s*191/);
    await expect(armed).toBeVisible();
    await emit('4.0@');
    await expect(page.getByRole('heading', { name: 'Volée terminée · Alice' })).toBeVisible();
    await expect(scores).toContainText(/Alice\s*141/);
    await expect(page.locator('html')).toHaveAttribute(
      relay ? 'data-board-streams' : 'data-board-connections',
      '1',
    );
  });
}

test('relay advances legs and sets without a new stream or an extra activation', async ({
  page,
}) => {
  await mockAudio(page);
  await mockRelay(page);
  await createMatch(page, '101 · sortie simple', 'sets');
  await page.clock.install();
  await page.getByLabel('Code de connexion au relais').fill('test-pairing');
  await page.getByRole('button', { name: 'Connecter via le relais', exact: true }).click();
  await arm(page).click();
  let sequence = 0;
  async function emit(frame: string) {
    await page.evaluate(
      (detail) => window.dispatchEvent(new CustomEvent('test-relay', { detail })),
      {
        sequence: ++sequence,
        frame,
      },
    );
  }
  const scores = page.getByRole('region', { name: 'Scores', exact: true });
  const summary = page.getByRole('region', { name: 'Score du match', exact: true });
  await emit('10.0@');
  await emit('4.0@');
  await expect(summary).toContainText('Leg remporté par Alice');
  await expect(page.locator('html')).toHaveAttribute('data-last-board-cue', '523,659,784');
  await emit('3.4@');
  await expect(scores).toContainText(/Bob\s*101/);
  await emit('BTN@');
  await expect(summary).toContainText('Set 1 · Leg 2');
  await expect(scores.getByRole('heading', { name: 'Au tour de Bob' })).toBeVisible();
  await emit('3.4@');
  await expect(scores).toContainText(/Bob\s*41/);
  await page.clock.fastForward(500);
  await emit('BTN@');
  await expect(scores.getByRole('heading', { name: 'Au tour de Alice' })).toBeVisible();
  await emit('10.0@');
  await emit('4.0@');
  await expect(summary).toContainText('Set remporté par Alice');
  await page.clock.fastForward(500);
  await emit('BTN@');
  await expect(summary).toContainText('Set 2 · Leg 1');
  await expect(scores.getByRole('heading', { name: 'Au tour de Alice' })).toBeVisible();
  await emit('3.4@');
  await expect(scores).toContainText(/Alice\s*41/);
  await expect(page.locator('html')).toHaveAttribute('data-board-streams', '1');
});

test('relay restores the connection without replaying hits or rearming the visit', async ({
  page,
}) => {
  await mockRelay(page);
  await createMatch(page, 'Cricket · points classiques');
  await expect(
    page.getByRole('button', { name: 'Connecter en Bluetooth', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Code de connexion au relais').fill('test-pairing');
  await page.getByRole('button', { name: 'Connecter via le relais', exact: true }).click();
  await arm(page).click();
  const emit = (sequence: number, frame = '4.0@') =>
    page.evaluate((detail) => window.dispatchEvent(new CustomEvent('test-relay', { detail })), {
      sequence,
      frame,
    });
  const grid = page.getByRole('table', { name: 'Grille de Cricket', exact: true });
  await emit(1);
  await emit(1);
  await expect(grid.getByLabel('Alice · bull : 2 marque(s) sur 3', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-relay-lights', /(?:^|,)31(?:,|$)/);
  await emit(3);
  await expect(page.getByText(/Reconnexion en cours/)).toBeVisible();
  await expect(arm(page)).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-board-streams', '2');
  await emit(1);
  await expect(grid.getByLabel('Alice · bull : 2 marque(s) sur 3', { exact: true })).toBeVisible();
  await arm(page).click();
  await emit(2);
  await expect(
    grid.getByLabel('Alice · bull : 3 marque(s) sur 3 · fermé', { exact: true }),
  ).toBeVisible();
  await emit(3, 'BTN@');
  await expect(page.getByRole('heading', { name: 'Au tour de Bob', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Déconnecter la cible', exact: true }).click();
  await expect(arm(page)).toHaveCount(0);
});
