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
