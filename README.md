# Scoretrackrr

**Keep score, pass the phone, enjoy the game.**

Scoretrackrr keeps score for tabletop and outdoor games on one shared phone or tablet. Save players and teams, pause a game, pick it up later and play offline. No account is required.

![Scoretrackrr home screen](https://raw.githubusercontent.com/wiki/kinouzero/scoretrackrr/images/home-desktop.png)

## Install the website

First host Scoretrackrr at an HTTPS address your phone can reach. With Git, Docker and Docker Compose installed:

```sh
git clone --recurse-submodules https://github.com/kinouzero/scoretrackrr.git
cd scoretrackrr
docker compose up -d --build
```

Open **http://127.0.0.1:8090** on the host computer, then configure your HTTPS reverse proxy to forward to that address. The local HTTP endpoint alone is not sufficient for installing the PWA on another device.

See [website installation](https://github.com/kinouzero/scoretrackrr/wiki/Hosting) for HTTPS setup, ports, updates and a static-hosting alternative. Once the HTTPS site is reachable, follow [phone installation](https://github.com/kinouzero/scoretrackrr/wiki/Install-and-Update).

## Start playing

1. Open Scoretrackrr while connected to the internet and let it finish loading.
2. Add it to your Home Screen if you want to use it like an app.
3. Add your players, open **Games** and choose **Play**.
4. Choose the settings and participants, then create and start the match.

Use your own dice, cards, darts or outdoor equipment. The app records results; it does not replace the physical game.

## Supported games

421 · 5000 / 10000 · 6 qui prend! · Darts X01 / Cricket · Flip 7 · Mölkky · Pétanque · Skull King · Time's Up! · Yams

Skyjo · Belote / Coinche · Tarot · Rummy · UNO / UNO Flip · Scrabble · 7 Wonders · Qwixx · Très Futé ! · Dominoes

Each game has its own score-entry screen and a rules section. Available settings are listed in the [game catalog](https://github.com/kinouzero/scoretrackrr/wiki/Game-Catalog).

X01 and Cricket can receive GranBoard 3s hits via Bluetooth in Chrome on Android or through an [optional Linux Compose relay for iPhone](https://github.com/kinouzero/scoretrackrr/wiki/Hosting#optional-granboard-relay-for-iphone).

## Your games, on your device

Once the app has downloaded, scoring and saved matches work offline. You can correct an entry, pause or cancel a match, review earlier results and take a rematch. Language and appearance follow your device by default, with French and English available.

Keep a JSON backup from **Settings**: clearing browser data or changing the app's address can make local records unavailable. There is no cloud synchronization between devices.

## Help

- [User manual](https://github.com/kinouzero/scoretrackrr/wiki/Home): everything needed to use the app.
- [Install on a phone](https://github.com/kinouzero/scoretrackrr/wiki/Install-and-Update).
- [Players, teams and matches](https://github.com/kinouzero/scoretrackrr/wiki/User-Guide).
- [Game-by-game instructions](https://github.com/kinouzero/scoretrackrr/wiki/Games).
- [Save and restore a backup](https://github.com/kinouzero/scoretrackrr/wiki/Backups).
- [Privacy](https://github.com/kinouzero/scoretrackrr/wiki/Privacy).

For a problem or suggestion, open a [GitHub issue](https://github.com/kinouzero/scoretrackrr/issues) with the steps to reproduce it. Avoid sharing a personal backup publicly.

## Contribute or host the app

To host the site, follow [website installation](https://github.com/kinouzero/scoretrackrr/wiki/Hosting). Developers can use [Contributing](https://github.com/kinouzero/scoretrackrr/blob/master/CONTRIBUTING.md) and the separate [maintainer documentation](https://github.com/kinouzero/scoretrackrr/wiki/Developer-Home). The user manual does not require programming knowledge.

Scoretrackrr's source code and original documentation use the [MIT License](https://github.com/kinouzero/scoretrackrr/blob/master/LICENSE). Game names, trademarks, dependencies and publishers' rulebooks retain their own rights.
