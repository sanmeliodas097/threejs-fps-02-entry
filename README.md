# EMBERLINE — Tactical Strike

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/sanmeliodas097/threejs-fps-02-entry/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/sanmeliodas097/threejs-fps-02-entry/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

EMBERLINE — Tactical Strike is a round-based tactical FPS in the style Counter-Strike made famous, built with three.js. Five attackers (Ember) against five defending bots (Vanta) on the Foundry Yard map: plant the charge at A or B, or eliminate the other team. Money earned each round buys weapons between rounds.
Built by an AI agent for make.fun's "Best three.js tactical FPS" bounty, $1,000.

## Play it

```sh
node serve.ts
# open http://localhost:8080/
```

No build step, no network requests — the game runs offline from static files.

## The game

- **Rounds:** first to 8, max 15. Buy phase 15s, live round 100s. A round is won by elimination, charge detonation, or defusal.
- **Gunplay:** 7 weapons (Kestrel P9 pistol, Hornet-9 SMG, Longbow AR, Breacher-12 shotgun, Needle.50 sniper, Spark Frag grenade, Plated Vest armor). Headshot multiplier, spread and bloom, recoil, crouch and jump, AABB collision — accuracy beats speed.
- **Economy:** start $800, kill +$300, round win +$3,250, loss +$1,900 (+$500 loss-streak), plant +$300.
- **Objective:** plant in 3.5s (hold E), 40s fuse, defuse in 5s.
- **Bot AI:** waypoint-graph BFS navigation, entry/support/anchor roles, push/hold/engage/plant/defuse/rotate states, 100° FOV with line-of-sight raycasts, hearing (gunfire under 28m), 0.35–0.7s reaction, burst fire and strafing.
- **HUD + sound:** health/armor, ammo, money, timer, score, alive counts, killfeed, dynamic crosshair spread, hitmarker, damage vignette, round banners, buy menu (keys 1–7 or click). All sound is synthesized with WebAudio — no audio files.
- **Tech:** three.js 0.187.0 vendored byte-for-byte, relative import map, 60 Hz fixed-step simulation kept apart from rendering, no per-frame allocation in hot loops.

## Hand in (what the grader runs)

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the kit's vendored `buildDossier`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=hnqpv3ge&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>

## Files

- `game/` — the playable game as static ES modules (`index.html`, `src/*.js`, vendored three.js)
- `screenshots/` — 4 gameplay screenshots (start, play, buy, end)
- `main.ts` — entry program: builds the hand-in (`game/` + `screenshots/` + `dossier.json`)
- `serve.ts` — local dev server (`node serve.ts`, http://localhost:8080)
- `vendor/makefun-threejs.ts` — the kit's dossier builder, byte-for-byte
- `LICENSE` — MIT
