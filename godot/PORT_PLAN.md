# Bunker Buster: Godot 4 port plan

This folder holds the first pieces for moving Bunker Buster from HTML/JavaScript to Godot 4 with C#.
The browser game stays the reference: everything here is checked against it.
Last synced with **v9** (the art and sounds in `assets/` are unchanged from v5 through v9, so they still match).

## Platform note
Target engine: **Godot 4.7.2-stable**. Its web exporter still refuses C# projects
(`platform/web/export/export_plugin.cpp`: "Exporting to Web is currently not supported in Godot 4 when using C#/.NET").
A C# build targets desktop and Android; the browser/GitHub Pages version stays on the JavaScript code
until Godot's web export supports C#. GDScript would keep a web build if that matters more.
When working on the port, keep a local clone of the engine source at the same tag and check APIs there
(see "Godot / C# work" in the repo's CLAUDE.md).

## What's here
| Path | What it is |
|---|---|
| `assets/textures/` | 64×64 tiles: floor, concrete (with hazard stripe), outer wall, extraction pad, crate, rubble. Import with **Filter: Nearest** to keep the pixel look. |
| `assets/sprites/guard_sheet.png` | 48×89 frames. Rows: front, back, side (facing right; flip for left). Columns: walk ×4, aiming, firing. |
| `assets/sprites/` | Downed guard, intel case, breach charge, "!" and "?" icons, objective arrow. |
| `assets/audio/` | 14 sound effects as 16-bit mono WAV, rendered from the game's own synthesizer settings. |
| `scripts/MazeGenerator.cs` | Room maze + extra loop openings + room centres. Seeded RNG (`Mulberry32`) so layouts reproduce. |
| `scripts/ScoreCalculator.cs` | Itemised score and damage penalty, same rounding as the browser game. |
| `scripts/maze-reference.mjs` + `.json` | Reference output (seed 12345) to check the C# maze against. |
| `tools/asset-export.js` | Re-runs the export from `bunker-buster.js`, so assets can be regenerated after art changes. |

## How the game maps onto Godot
| Browser game | Godot 4 |
|---|---|
| Voxel world array (`world`, `tile()`, `box()`) | `VoxelWorld` node: a byte array plus chunked `ArrayMesh` (16×12×16 chunks), rebuilt only for chunks that change. |
| Hand-written raycaster `render()` | Godot's renderer: chunk meshes + `StandardMaterial3D` per material using the textures above. |
| `trace()` (shots, line of sight, planting) | Voxel DDA ray kept in C# against the byte array (exact and cheap), not physics raycasts. |
| Guard billboards (`guardPixel`) | `AnimatedSprite3D` with Billboard on, frames from `guard_sheet.png`; view row chosen from facing angle. |
| Viewmodel carbine (canvas drawing) | `CanvasLayer` with sprite layers, or a low-poly model on a second `Camera3D`. |
| `checkIntegrity` / falling debris | `StructuralIntegrity.cs` (same support-distance BFS) + `RigidBody3D` chunks or simple falling sprites. |
| `flowField` / `followField` | `FlowField.cs` (same BFS); Godot's `NavigationServer` isn't needed for a grid this small. |
| Alert phases (`PHASE`, `setPhase`, `makeNoise`) | `AlertDirector.cs` autoload singleton raising C# events the HUD and guards subscribe to. |
| HUD / menus / results / leaderboard | `Control` scenes; `LeaderboardClient.cs` using `HttpRequest` against the existing bin. **Quirk:** the bin host (json.extendsclass.com) now sometimes appends an HTML page after the JSON; read the body as text and cut at the first `<!doctype`/`<html` before parsing (the browser game's `fetchBoard()` does this). |
| Touch controls (v7–v8 scheme) | One full-screen `Control` taking all touches. Left half: a floating MOVE stick that appears under the thumb. Right half: a floating LOOK stick that turns at a rate (dead zone 0.08, response curve power 1.6, 3.0 rad/s yaw, 1.7 rad/s pitch). FIRE sits diagonally up-left of the look stick's rest spot and also aims while held (hold to shoot, slide to steer). RELOAD / PLANT / DUCK in a row (beside FIRE in landscape, across the control area in portrait). A new finger always takes over its half; lifting or cancelling releases everything. See `touchLayout()` in `bunker-buster.js`. |
| `tone()` synth | `AudioStreamPlayer` with the WAVs in `assets/audio/`. |

## Suggested order
1. Project skeleton, input map, `VoxelWorld` + chunk meshing, first-person controller (walk the maze from `MazeGenerator`).
2. Shooting with the voxel DDA, concrete removal, `StructuralIntegrity`.
3. Guards (sprites, `FlowField`, `AlertDirector`), bullets.
4. Intel, extraction, charges, scoring, results screen, leaderboard.
5. Touch controls and Android export.

## Changes since the first port notes (v6–v9)
- v6: portrait layout on phones (game view on top, control area below), rotation-aware render size.
- v7–v8: touch controls rebuilt as described above (same scheme as the QUACK game).
- v8: leaderboard reads only the JSON part of the bin's reply.
- v9: start-screen notice that the game plays much better on desktop. Mobile is still the weak spot; in Godot, consider shipping desktop first.
