# Train picker

A 3D team picker: a model train drives round a ring of stations, one per person, and
stops at a randomly chosen one. Built with [three.js](https://threejs.org) and
TypeScript, bundled with Vite.

Live at **https://picker.charding.dev** · fleet overview at **https://picker.charding.dev/fleet/**

## Using it

- **Pick someone** (or press <kbd>Space</kbd>): the train sets off, does a lap or two and
  pulls in at the chosen person's station. Double-tap <kbd>Tab</kbd> to skip the animation.
- **People**: one name per line. Add line pills in brackets, e.g. `Anna [S1] [TIF]`.
  A name ending in a **space** gets a station but is never picked.
  “Skip people already picked” takes each person out once chosen; “Reset picks” brings
  them back. “Your name” labels the home station by the tunnel (hidden until set).
- **Rolling stock**: the train type, number of carriages (1–12) and carriage length
  (8–30 m; blank for the type's real length).
- **Branding**: the logo and the lettering on the carriages.
- **Environment**: weather (sunny, snow, rain) and the camera view:
  - *Aerial*: the overview, flying in to a close-up on arrival.
  - *Platform*: down on the chosen station's platform to watch the train arrive.
  - *Driver*: in the cab, leaning out of the window at the platform.
- **Record a clip** saves a video of a whole run.

On a phone the panel folds away (the ▸ button), and folds itself when you pick.

### Trains

| Type | Notes |
| --- | --- |
| Toy steam / Steam (DB class 64) | Tank locomotive (shortened, or full size) with classic coaches |
| Taurus (class 182) | DB electric locomotive with EC coaches |
| ÖBB Railjet | Taurus locomotive, Railjet coaches and driving trailer |
| S-Bahn class 423 | Articulated EMU, units of 3–4 cars |
| BRB FLIRT 3 | Articulated EMU, units of 3–6 cars |
| BRB LINT | Diesel railcars, in pairs |
| ÖBB Desiro ML | EMU, each car on its own bogies |
| ÖBB Cityjet KISS | Double-deck EMU |
| ÖBB Railjet KISS | The KISS in Railjet colours |
| RhB Allegra | Metre-gauge articulated EMU (the track narrows to suit) |

The fleet page (`/fleet/`) shows every type side-on at any carriage count and length.

### URL parameters

Everything set in the panel is kept in the address, so a link reproduces it:

| Parameter | Meaning |
| --- | --- |
| `names` | The people, newline- or comma-separated |
| `me` | Your name (the home station) |
| `train` | `compact`, `full`, `taurus`, `railjet`, `s423`, `flirt`, `lint`, `desiro`, `kiss`, `rjkiss`, `allegra` |
| `carriages` | 1–12 |
| `length` | Carriage length in metres (8–30) |
| `logo`, `lettering` | Branding text |
| `weather` | `clear`, `snow`, `rain` |
| `view` | `aerial`, `platform`, `driver` |
| `lang` | `en`, `de` |

## Development

```sh
yarn install
yarn dev        # http://localhost:5173 (and /fleet/)
yarn build      # type-check and build to dist/
```

The default logo and lettering come from `.env` (`VITE_LOCO_EMBLEM`,
`VITE_CARRIAGE_LETTERING`) and are baked in at build time.

### Layout

- `src/main.ts`: the scene, trains, stations, camera and UI
- `src/terrain.ts`: ground, hill, cutting and tunnel
- `src/sign.ts`: DB-style station name boards
- `src/wallLetters.ts`: raised lettering from font outlines
- `src/materials.ts`: procedural brick and roof-tile textures
- `src/i18n.ts`, `src/locales/*.json`: translations (grouped by panel section)
- `vite.config.ts`: serves and builds the `/fleet/` page

### Deployment

Pushing to `main` builds the site and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`), served at `picker.charding.dev`.
