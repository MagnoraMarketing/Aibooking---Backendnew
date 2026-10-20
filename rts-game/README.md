# Frontline — browser WWII tactical RTS

A small real-time strategy game inspired by squad-based WWII tactics games.
Top-down 2D, played in the browser, with a practice mode against an AI and
1v1 online play through a room code or invitation link. No account needed.

Tech: Vite, React, TypeScript, HTML Canvas, Supabase Realtime, Vercel.
All graphics are drawn procedurally in code — no third-party art.

This is a self-contained project inside this repository (like
`relay-server/`). It has its own `package.json`, and the root Next.js app's
tsconfig/eslint ignore it.

## Playing

| Input | Action |
| --- | --- |
| Left click / drag box | Select squads or a building (Shift adds/removes) |
| Double-click a squad | Select all your squads of that type on screen |
| Right click | Move, attack the unit/building under the cursor, or set a building's rally point |
| Arrow keys, screen edge, middle-drag | Scroll; mouse wheel zooms |
| Minimap | Left click to look, right click to send selected squads |
| R / M / B | Recruit Rifle Squad / recruit MG Team / build Barracks |
| E / S | Reinforce / stop |
| H, Space | Select HQ, centre on selection |
| Ctrl+1–9, 1–9 | Assign / recall control groups (press twice to jump to them) |
| Esc | Deselect, then open the menu (pauses practice) |

**Rules**

- Each side starts with a Headquarters and two Rifle Squads.
- **Manpower** accrues over time; each held capture point adds more income.
- The **HQ** recruits Rifle Squads. Build a **Barracks** (200) to unlock
  **MG Teams**: long range and high damage, but they must stand still for
  1.5 s to set up before firing.
- Squads fight **automatically** when enemies are in range, and they fire on
  the move (Rifles at reduced accuracy). Right-click an enemy to focus it.
- **Cover**: standing behind a wall, building or HQ relative to the shooter
  halves incoming damage (green shield); forests give light cover (−25%,
  yellow shield). The shield above your squads shows the cover they have
  against the nearest enemy.
- **Capture points** A, B, C: stand inside the circle uncontested to
  neutralise and then capture. Contested points freeze.
- **Victory**: holding more points than the enemy drains their victory
  points (800 each). Reaching 0 loses. Destroying the enemy HQ also wins.
- Damaged squads near your HQ/Barracks can **reinforce** lost soldiers.
- Squad cap: 10 (queued units count).

## Development

```bash
cd rts-game
npm install
npm run dev        # http://localhost:5173
npm test           # rules, AI and netcode tests (vitest)
npm run build      # typecheck + production build into dist/
```

Without Supabase configured, online rooms use a same-browser transport
(BroadcastChannel). Create a room, then open the invite link in a second tab
of the same browser to play both seats locally.

## Architecture

```
src/
  game/      Pure rules engine: no DOM, rendering or networking.
    types.ts       State, entities and command definitions
    constants.ts   Unit/building stats and economy tuning
    map.ts         The battlefield (authored half, mirrored for fairness)
    pathfinding.ts A* on the tile grid + path smoothing
    sim.ts         createGame / applyCommand / step (20 Hz fixed timestep)
    ai.ts          Practice opponent; emits ordinary commands
    rng.ts         Seeded PRNG kept inside the state
  render/    Canvas drawing: terrain (pre-rendered once), units, FX, minimap
  input/     Mouse/keyboard -> selection, camera and Commands
  net/       Sessions (practice / host / guest), protocol, transports, rooms
  ui/        React HUD, menus and overlays
tests/       vitest suites for rules, AI and the host/guest protocol
```

The only way to change the game is `applyCommand(state, command)` followed by
`step(state)`. The player, the AI and the remote opponent all go through
that path, so the sim is the single source of truth and is easy to test
headlessly.

### Multiplayer model

The game uses **host-authoritative** networking over Supabase Realtime
*broadcast* (pub/sub, no database tables):

- The room creator is the **host**. Its browser runs the simulation and
  broadcasts a compact snapshot 10×/s. The **guest** sends commands and
  renders the snapshots with interpolation.
- The host rewrites every guest command to player 1, so a guest cannot
  control the host's units.
- **Reconnection**
  - Guest refresh or brief drop: the guest keeps a per-room token in
    `localStorage`. It reclaims its seat and the next snapshot restores it.
  - The host pauses the battle while the guest is unreachable (4 s
    heartbeat). After 30 s the host may claim victory.
  - Host refresh: the host saves the full game to `localStorage` every
    1.5 s and resumes from it. Reopening the link in the same browser after
    closing the tab also resumes. The guest sees "host disconnected" and
    reconnects automatically.
  - Socket drops: realtime-js reconnects and rejoins the channel itself. A
    banner shows while that happens.
- A third player opening the link is told the room is full.

Known limitation: the host's tab must stay open. Browsers throttle
background tabs, so the battle runs in coarser steps while the host's tab is
hidden.

## Supabase setup

Online play needs only Supabase **Realtime** (broadcast). There are no
tables, migrations or auth.

1. Create a project at <https://supabase.com> (the free tier is fine). A
   dedicated project is recommended, separate from any production app.
2. **Project Settings → API**: copy the **Project URL** and the
   **publishable key** (`sb_publishable_…`, or the legacy `anon` key).
3. **Realtime → Settings**: keep **"Allow public access"** enabled. The game
   uses public broadcast channels named `rts-room-<CODE>`. If you enforce
   private channels only, joins will fail with `CHANNEL_ERROR`.
4. Locally, create `rts-game/.env.local` (gitignored):
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<publishable or anon key>
   ```
5. Restart `npm run dev`. The main menu stops saying "Online server not
   configured".

The publishable/anon key is designed to be shipped to browsers. Quotas: each
running match sends roughly 10–12 messages per second with a few KB per
snapshot, which fits comfortably in the free tier for casual play.

## Deploying to Vercel

1. In Vercel, **Add New → Project** and import this GitHub repository.
2. Set **Root Directory** to `rts-game`. The framework is detected as Vite,
   and `vercel.json` sets the build command and output directory (`dist`).
3. Add the environment variables `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` for Production (and Preview if wanted).
4. Deploy. Invitation links take the form `https://<your-app>/?room=ABC123`.

With the CLI: `cd rts-game && npx vercel` (choose `rts-game` as the root),
then `npx vercel --prod`.

## Roadmap ideas

Fog of war, suppression and retreat, grenades and abilities, vehicles,
garrisoning buildings, more maps, sound, spectators, and dedicated or
serverless authority so matches survive the host leaving.
