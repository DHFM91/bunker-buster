# Working on Bunker Buster

Read `NEXT_SESSION.md` first: it has the current priorities and the publishing conventions.

## Work efficiently
- `bunker-buster.js` is ~1,700 lines. Don't read it top to bottom: search for the function you need (`grep -n "^function \|^// ====="` gives the map) and read only that range. Line numbers drift; function names don't.
- Main areas, by function name:
  - `generateMaze` / `reset`: map building
  - `buildTextures` / `rollPalette`: surfaces and colours
  - `render`: the voxel raycaster
  - `guardPixel` / `corpsePixel` / `intelPixel`: sprites
  - `drawRifle`: the gun
  - `thinkGuard` / `pickRoom` / `updateAlert` / `makeNoise`: guard AI
  - `checkIntegrity` / `updateStructure`: collapse
  - `touchLayout` / `drawTouch`: phone controls
  - `fetchBoard` / `submitInitials`: leaderboard
- Hand routine, well-defined jobs (asset regeneration, test scripts, porting a single pure function to C#) to a cheaper subagent with exact file paths and the expected output, then check its work.
- Test in headless Playwright (desktop viewport plus an iPhone 13 profile) and look at screenshots before publishing.

## Godot / C# work: keep the engine source next to you
For anything in `godot/` (the eventual Godot 4 + C# port), work from the engine's own source, not memory or the online docs. Docs and training data lag behind the engine; the source is always exact for the version in use.

1. **Pin a version.** Current target: **Godot 4.7.2-stable**. If the project moves to a newer Godot, change it here and in `godot/PORT_PLAN.md`.
2. **Clone that exact tag** outside the repo; never commit it:
   `git clone --depth 1 --branch 4.7.2-stable https://github.com/godotengine/godot <scratch>/godot-4.7.2`
   It is about 440 MB and takes seconds through the proxy. On David's PC there is a copy at
   `C:\Users\david\Desktop\GPT's attempt at FPS prototype\Claude branchoff\godot-engine-4.7.2\godot-engine-4.7.2\`
   (extracted from `godot-engine-4.7.2.zip` in the same folder); use that when working on his machine.
3. **You can reference the engine code at any time.** Search it rather than guessing an API:
   - `doc/classes/<ClassName>.xml`: the full class reference (methods, properties, signals, defaults) for that exact version
   - `modules/mono/glue/GodotSharp/`: the C# API and how it maps to the engine
   - `platform/web/export/export_plugin.cpp`: what web export allows. In 4.7.2 it still refuses C# projects ("Exporting to Web is currently not supported in Godot 4 when using C#/.NET"), so the browser game stays JavaScript.
   - `scene/`, `servers/`: how nodes and rendering actually behave
4. **Version upgrades:** read the changelog and diff the two tags for the classes the port uses before changing anything.
5. **Check your own work headless** when a Godot binary and the .NET SDK are available:
   - build with `godot --headless --path <project> --build-solutions --quit`
   - run a scene with `godot --headless --path <project> <scene>.tscn --quit-after 300`
   - read the errors and fix them before reporting back

   This cloud workspace has no Godot or .NET installed and package installs may be off. If so, say so and keep checks to source review plus the reference JSON in `godot/scripts/`.

## Never
- Credit AI anywhere: no co-author or session trailers in commits, no "generated with" lines, no AI mentions in files, comments, metadata or docs. Commit as DHFM91 with the noreply address.
- Store API keys (extendsclass or any other) in code, files, commits or notes.
