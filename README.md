# Data Wars

Current deployed release: **v1.3.0**, at https://www.playdatawars.com.

## Run the current version

The `site/` directory is an exact snapshot of the deployed HTML, JavaScript, CSS and optimized assets:

```sh
python3 -m http.server 8080 --directory site
```

Open http://localhost:8080. Local saves belong to that browser and origin. Production browser saves are not part of this repository.

This release includes Model awakening, live operations, five military/intelligence structures, Destroyer and Distiller incursions, repairs/recovery, complete local saves, and selected-card pause controls.

The original root Vite project and `src/` are retained from the earlier game version. They are historical source material, not the source of the current deployed snapshot. Future source reconciliation should preserve the snapshot's tested behavior.

## Verify and package

```sh
python3 scripts/verify-site.py
python3 scripts/package-site.py
```

The package command writes `dist/playdatawars.com.zip`. Its contents are the deployable files at the archive root. `docs/deployed-v1.3.0.json` records file hashes and the original deployed ZIP hash.

For the simulation and DOM/geometry regression checks (Node.js 24 used):

```sh
npm install --no-save jsdom
node tests/simulation.cjs
node tests/geometry.cjs
node tests/ui.cjs
```

These checks exercise the deployed bundle directly. They do not replace an interactive visual playtest.

## Versions

`VERSION` contains the semantic release number. Every completed release is tagged `vMAJOR.MINOR.PATCH`. The version-tags workflow tags the exact main-branch commit changing VERSION and refuses to move an existing tag.

v1.3.1 remains planned. See [the pending roadmap](docs/roadmap.md). No tutorial, economy rebalance, ongoing Model upkeep or mobile-store redirect has been implemented in v1.3.0.
