# Bunker Buster

A first-person tactical shooter that runs in your browser. Grab the orange intel case and get back to the green extraction pad. You can take the corridors, or blow your own shortcut through the concrete.

**Play:** https://dhfm91.github.io/bunker-buster/

## How it plays
- Every level is a new random maze of concrete rooms.
- Each rifle shot knocks out one block of cracked concrete. Breach charges blow out whole sections.
- Concrete can only reach so far without support. Blast a big enough hole and the wall above it cracks and falls in pieces, leaving rubble piles. Falling debris hurts.
- Back off after you plant a charge, because the blast hurts you too.
- The base is a large random maze (7 × 10 rooms), so a run is a real trek.
- Guards follow four alert phases:
  - **Undetected:** lazy patrols near their posts.
  - **Caution:** a gunshot or blast was heard, and the guards who heard it converge on the sound.
  - **Evasion:** they know you're here but not where. They split up and sweep the base, listening for footsteps.
  - **Alert:** you've been seen. Every guard closes in, and 5 reinforcements arrive from the edges of the map.
- Crouch to move silently and to be harder to spot. Running footsteps can be heard nearby.
- When a guard spots you he calls out ("!"), raises his rifle and fires a round you can see. Keep moving and you can dodge it.

## Controls
| Desktop | Phone / tablet (portrait or landscape) |
|---|---|
| WASD: move | Left thumb anywhere on the left half: MOVE stick |
| Mouse: aim | Right thumb anywhere on the right half: LOOK stick (hold to keep turning) |
| Click: fire | FIRE (hold to shoot; slide your thumb to aim while firing) |
| Q: plant charge | PLANT |
| R: reload | RELOAD |
| C: crouch | DUCK |
| Esc: pause | II |

## Version history
- **v15:** grenade reminder reads "3 GRN (PRESS G)" so it reads as one item.
- **v14:** grenades now blow holes in concrete walls (smaller than a breach charge) and crack reinforced walls; the kit readout shows "3 GRN · PRESS G" on desktop as a reminder.
- **v13:** Night Raid is now seen through green night-vision goggles that auto-adjust their brightness, with soldiers standing out brighter than the walls; night weather in the other themes is brighter too.
- **v12:** endless runs. Every extraction takes you to a brand-new procedural base, a little tougher each time, with its own theme: Relay Station, Arctic Outpost (snow; louder footsteps), Desert Depot (guards see further), Night Raid (darker, more guards), Deep Vault (reinforced walls, extra charges), Lockdown (starts on CAUTION, fuel drums everywhere) and Overgrown Depot (moss, gates, vents and windows). After a win, go on or end the run; the leaderboard now ranks run totals and shows levels cleared. Also: windows in some walls (some barred) that you and the guards can see through, red fuel drums that explode and chain, and 3 grenades per level (G, or NADE on touch) that lob in a low arc, bounce, set off drums and draw guards with the noise.
- **v11:** guards keep a body's width apart, so you can always count them; a guard who spots you needs 1 second to report it, and if you kill every guard who saw you inside that second the alert is called off (reinforcements only come once the report gets out).
- **v10:** big realism pass and new maps. Real sun and shadows, sky with clouds, five times of day and weather, wall lamps, corner shading, stains, cracks, pipes, painted hazard edges on every opening, persistent bullet holes and scorch marks, blast smoke, sparks, muzzle smoke, camouflage and skin-tone variety on soldiers, three death poses, wear on the carbine. Maps now have a fortified spawn foyer with five exits and a sentry in view, courtyards with parked trucks and low cover, a pillared atrium, long halls, reinforced walls (two charges), barred gates, crouch-only vents, sandbag guard posts with sentries, an intel vault, crates, drums and sandbags.
- **v9:** start-screen notice that the game plays much better on desktop than on mobile; global leaderboard reads correctly again.
- **v8:** FIRE moved right next to the look stick and now aims too (hold and slide); fixed the global leaderboard showing "offline" when the score host adds extra text to its reply.
- **v7:** new touch controls in the style of QUACK: twin floating sticks (move on the left, look on the right) that appear under your thumbs, FIRE above the look stick, and no stuck controls when a finger slips off.
- **v6:** playable in portrait on phones (game view on top, control deck below); landscape adapts on rotation; clearer RELOAD button; steadier touch aiming.
- **v5:** clearer objective arrow on the compass (proper head and shaft instead of a small triangle).
- **v4:** four alert phases (Undetected, Caution, Evasion, Alert) with reinforcements; map doubled to 7 × 10 rooms; centred menus; more ammo and charges.
- **v3:** global top-10 leaderboard connected.
- **v2:** new random colour scheme on every deploy; itemised scoring (time, soldiers, concrete, damage penalty).
- **v1:** first public release: voxel maze, destructible concrete with structural collapse, breach charges, guards with wind-up shots, desktop and touch controls.

## Running it locally
No build step. Download the repo and open `index.html` in a browser.
