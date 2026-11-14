# PICO: THE MARTIAN SURVIVOR (2030)

An interactive, browser-based open-world Mars survival adventure built with **vanilla HTML5 Canvas + JavaScript** (no external assets, libraries, or build step).

This project now includes an **interactive website landing page** plus the playable game:

- `index.html` — interactive website/landing page (story, missions, real Mars mission sites, controls, play/preview)
- `play.html` — full playable game
- `game.js` — game engine, rendering, story progression, survival systems, and educational mission info popups

## Story
**Year:** 2030 · **Location:** Planet Mars  
**Main character:** Pico  
**Mission Captain:** Captain Vijay  
**Crew:** Sristi, Bhavyesh, Bikramaditya, Anurag, Saswati

After an asteroid storm strikes the mission spacecraft, Pico’s landing pod crashes on a distant part of Mars. Stranded and alone, Pico must learn to survive, explore the unknown, endure setbacks and underground dungeons, repair the spacecraft, and launch home — guided by Captain Vijay over a fragile communications link.

## Website + Game Features
- Interactive landing website with story, chapter overview, controls, and mission-site showcase
- Embedded game preview option and direct **Play Now** launch (`play.html`)
- 2.5D third-person exploration (orbit camera, camera-relative movement)
- Survival systems: **oxygen, power, water, food, radiation, suit integrity**
- Story-driven mission briefings/objectives and finale (repair spacecraft and launch)
- Underground dungeons with randomized entrances
- Real Mars regions/biomes: **Gusev Crater, Meridiani Planum, Jezero Crater, Gale Crater, Valles Marineris**
- Educational in-game mission info popups (resources pause while reading) for real mission sites:
  - Spirit (MER-A, 2004), Opportunity (MER-B, 2004), Phoenix (2008), Curiosity (2012), Perseverance (2021)
  - Plus mission/comms objects (e.g. probe, communications array, spacecraft/equipment)

## Controls (in game)
- **WASD / Arrows**: Move
- **Mouse drag**: Orbit camera
- **Mouse wheel**: Zoom
- **Shift**: Sprint
- **E**: Interact / repair / enter-exit / open mission info
- **J**: Journal
- **Esc / P**: Pause
- **Enter**: Continue briefings/popups

## Run locally
No build step required.

```bash
# Option 1: open the website
xdg-open index.html   # Linux
# or open index.html in your browser

# Option 2: serve locally (recommended)
python3 -m http.server 8000
# then open http://localhost:8000
```

- Website: `http://localhost:8000/`
- Direct game: `http://localhost:8000/play.html`

## Deploy as a website
Because this is a static site, you can host it on any static hosting platform (GitHub Pages, Netlify, Vercel static, Cloudflare Pages, etc.).
- For **GitHub Pages**, serve from the repository root so `index.html` becomes the website homepage and `play.html` is the game page.

## Notes
- Dev mode is available in the game via `?dev` (on `play.html`) or console helpers (e.g. `RedDust.enableDevMode()` / `RedDust.dev.*`).
- The game is a 2.5D Canvas adaptation of the story.
