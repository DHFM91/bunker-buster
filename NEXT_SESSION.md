# Bunker Buster: next session

Start here. Current version: **v14**. Loose ideas are in **TODO.md** (live at https://davidfeuling.com/bunker-buster/, repo DHFM91/bunker-buster).

## Status after v10
- Done: priority 1 (realism pass) and priority 3 (map variants, plus a fortified spawn foyer with a sentry in view).
- Left over from v10:
  - Port `planLayout` to C# (`godot/scripts/MapPlan.cs`) and re-run `godot/tools/asset-export.js` to refresh `godot/assets/`.
  - Rendering costs roughly 2.5x what v9 did (lighting, shadows and wall detail run per pixel). Fine on desktop; watch phones.
  - Not built yet: control room with camera/alarm panel, catwalks.
- Next up: priority 2 (smarter soldiers).

## Priorities, in order

### 1. Make it look more realistic: better visual assets
The same kind of pass as the first session (gun, intel, guards, rubble), aiming for a grittier, more real look. Ideas:
- **Surfaces** (`buildTextures()`, `colors`, `rollPalette()`): poured-concrete form-tie holes and seams, water stains running down from the top, grime gradient near the floor, scuffed floor with drain grates and painted lines, rust on the outer walls.
- **Lighting** (`render()`): ceiling light pools / caged bulbs with soft falloff, darker corners (fake ambient occlusion where walls meet floor), light dust haze in long corridors.
- **Props**: pipes and cable trays along walls, wall-mounted lamps, sandbag stacks, ammo crates with stencils, warning signs. Remember the intel stays orange and the extraction pad stays green whatever the palette.
- **Guards** (`guardPixel()`): more fabric folds and shading, webbing pouches, boots, a proper rifle silhouette, death pose variety (`corpsePixel()`).
- **Effects**: bullet holes and scorch marks that stay on walls, sparks on concrete hits, better smoke after blasts, muzzle smoke.
- **Gun** (`drawRifle()`): wear on the edges, better sights. The barrel end and left hand were removed on purpose; leave them out.
- After art changes, re-run `godot/tools/asset-export.js` so the Godot assets keep matching.

### 2. Smarter soldiers
Currently: alert phases (Undetected / Caution / Evasion / Alert), patrols near home, noise investigation, sweeps, reinforcements (`thinkGuard()`, `pickRoom()`, `updateAlert()`, `makeNoise()`). Ideas:
- Find bodies: a guard who sees a downed guard raises Caution and calls it in.
- Radio check-ins: if a guard is taken down and misses a check-in, others go to look.
- Pairs that patrol together; one covers while the other moves.
- Flanking in Alert: some guards take a different route to the player's last known spot instead of all following one path.
- Use cover: stop at doorways and corners before pushing in; peek and fire.
- React to blasts and new holes in walls (go see what changed), and avoid standing near a planted charge.
- Grenades or flushing the player out after a long standoff.
- Keep Kojima-style readability: clear "!" / "?" cues and sounds so the player understands every reaction.

### 3. More interesting generated maps
Currently `generateMaze()` builds a 7×10 grid of rooms with a backtracking maze plus a few extra openings, and `reset()` carves it into voxels. Ideas:
- **Courtyards**: merge 2×2 or 2×3 room blocks into open yards with low cover (crates, sandbags, a parked vehicle), open sky and different floor.
- **Double-thick or reinforced walls** that take two charges, or can't be shot through.
- Long corridors and a central atrium; a mezzanine or catwalk if height allows (Y is 12).
- Locked or barred doors that need a charge; vents or crawl gaps you can only fit through crouched.
- Guard posts / watchtowers with longer sight lines; a control room with a camera or alarm panel.
- Keep the guarantees: start and extraction far apart (distance ≥ 34), intel reachable, the centre column not too open, and the flow-field pathing (`walkable()`) still works with the new shapes.

### Also: keep the Godot port up to date
Everything for the eventual Godot 4 + C# port is in `godot/`:
- `PORT_PLAN.md`: how each part of the game maps to Godot, synced to v9.
- `scripts/`: the C# maze generator and score calculator, plus reference output to check them against.
- `assets/`: textures, sprites and sounds.
- `tools/`: the asset exporter.

When a feature lands in the browser game, add a line to PORT_PLAN.md.

## How we work (conventions)
- **Every published update bumps the version**:
  - `VERSION` in `bunker-buster.js` and `?v=N` on the script tag in `index.html`
  - a line in the README "Version history"
  - commit message `vN: …`
  - a snapshot in the local `builds\vN\` folder
- **Save everything twice**:
  - David's folder `C:\Users\david\Desktop\GPT's attempt at FPS prototype\Claude branchoff\`
  - GitHub
- **Publishing**: clone DHFM91/bunker-buster, copy the files in, commit and push to `main`.
  - Commit author: DHFM91 (noreply address).
  - No AI attribution anywhere: no co-author or session trailers, no "generated with" lines.
  - GitHub Pages updates in about a minute. Check the live files match by fetching them from the live page in a browser (the shell can't reach the live site).
- **Testing**: headless Playwright with an iPhone 13 profile for mobile, plus a desktop viewport. Look at screenshots before publishing.
- **Leaderboard**:
  - Board: `https://json.extendsclass.com/bin/26db85ce0e56` on David's extendsclass account.
  - Rules: top 10, ranked by score; time is worth the most, damage costs a lot.
  - Never store his API key anywhere.
- **Mobile**:
  - It works but is still weak; the start screen says it plays much better on desktop.
  - Controls copy the QUACK scheme: floating twin sticks, and FIRE next to the look stick that also aims while held.
  - Remove the desktop notice (`#device-note` in `index.html`) if mobile ever feels good.
