'use strict';

/*
 * RED DUST — A Third-Person Open-World Mars Adventure
 * A self-contained 2.5D survival adventure. No assets, no libraries.
 */
(() => {

  // =========================================================================
  // Helpers
  // =========================================================================
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const rndi = (a, b) => Math.floor(rnd(a, b + 1));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const damp = (cur, target, speed, dt) => cur + (target - cur) * (1 - Math.exp(-speed * dt));
  const dampAngle = (cur, target, speed, dt) => {
    let delta = ((target - cur + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return cur + delta * (1 - Math.exp(-speed * dt));
  };

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // =========================================================================
  // Third-person orbit camera + perspective projection
  // =========================================================================
  // The world is flat, so the horizon, ground texture and billboards all use
  // one simple pinhole camera. Drag the mouse to orbit, and scroll to change
  // the orbit distance.
  const CAM = {
    yaw: 0,
    targetYaw: 0,
    pitch: 0.32,
    targetPitch: 0.32,
    dist: 690,
    targetDist: 690,
    minPitch: 0.18,
    maxPitch: 0.82,
    minDist: 470,
    maxDist: 920,
    lookAhead: 125,
    D: 0,
    H: 0,
    d: 690,
    focal: 760,
    fx: 0,
    fy: -1,
    rx: 1,
    ry: 0,
    cx: 0,
    cy: 0,
    camX: 0,
    camY: 0,
    focusX: 0,
    focusY: 0,
    horizon: 0,
    // Camera-aligned orthographic ground plane, projected one screen row at a
    // time. 0.5 px/world-unit keeps the cached chunk art legible.
    pxPerUnit: 0.5,
    planeW: 2048,
    planeH: 1280,
    planeDepth: 1600
  };

  let screenShakeX = 0;
  let screenShakeY = 0;
  let groundPlane = null;
  let gctx = null;

  function ensureGroundPlane() {
    const px = 0.28;
    CAM.pxPerUnit = px;
    CAM.planeH = Math.ceil(CAM.planeDepth * px) + 8;
    // Extra width keeps the far corners covered on wide screens. Fog hides
    // anything just beyond the edge.
    CAM.planeW = clamp(
      Math.ceil(CAM.planeH * (VIEW.w / Math.max(1, VIEW.h)) * 1.05),
      900,
      3000
    );
    if (!groundPlane ||
      groundPlane.width !== CAM.planeW ||
      groundPlane.height !== CAM.planeH) {
      groundPlane = document.createElement('canvas');
      groundPlane.width = CAM.planeW;
      groundPlane.height = CAM.planeH;
      gctx = groundPlane.getContext('2d');
    }
  }

  function setupCamera() {
    const pitch = CAM.pitch;
    CAM.D = CAM.dist * Math.cos(pitch);
    CAM.H = CAM.dist * Math.sin(pitch);
    CAM.d = CAM.dist;
    CAM.fx = Math.sin(CAM.yaw);
    CAM.fy = -Math.cos(CAM.yaw);
    CAM.rx = Math.cos(CAM.yaw);
    CAM.ry = Math.sin(CAM.yaw);
    CAM.focal = Math.max(280, VIEW.h * 0.95);
    CAM.cx = VIEW.w / 2 + screenShakeX;
    CAM.cy = VIEW.h / 2 + screenShakeY;
    CAM.horizon = CAM.cy - (CAM.H / CAM.D) * CAM.focal;

    const p = game.player;
    if (p) {
      CAM.focusX = p.x + CAM.fx * CAM.lookAhead;
      CAM.focusY = p.y + CAM.fy * CAM.lookAhead;
      CAM.camX = CAM.focusX - CAM.fx * CAM.D;
      CAM.camY = CAM.focusY - CAM.fy * CAM.D;
    }
  }

  // Project a world point (z is height above the ground) into CSS pixels.
  function projectPoint(x, y, z = 0) {
    const dx = x - CAM.camX;
    const dy = y - CAM.camY;
    const L = dx * CAM.fx + dy * CAM.fy;
    const X = dx * CAM.rx + dy * CAM.ry;
    const dz = z - CAM.H;
    const depth = (L * CAM.D - dz * CAM.H) / CAM.d;
    const up = (L * CAM.H + dz * CAM.D) / CAM.d;
    const sx = CAM.cx + (X / depth) * CAM.focal;
    const sy = CAM.cy - (up / depth) * CAM.focal;
    return {
      x: sx,
      y: sy,
      depth,
      L,
      scale: CAM.focal / depth,
      visible: depth > 55 && L > 15 && L < CAM.planeDepth + 450
    };
  }

  function w2s(x, y) {
    return projectPoint(x, y, 0);
  }

  // Distance haze shared by ground and billboards.
  function fogAlpha(L) {
    return 1 - clamp((L - 1000) / 550, 0, 1);
  }

  // Draw a standing object at its ground position. Billboards stay upright;
  // only their size is scaled by perspective.
  function drawAt(x, y, draw, lift = 0, pr = null) {
    const p = pr || projectPoint(x, y, 0);
    if (!p.visible) return;
    const nearA = clamp((p.depth - 55) / 120, 0, 1);
    const alpha = Math.min(fogAlpha(p.L), nearA);
    if (alpha < 0.02) return;
    const pad = 360;
    if (p.x < -pad || p.x > VIEW.w + pad || p.y < -pad * 1.4 || p.y > VIEW.h + pad) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.scale(p.scale, p.scale);
    if (lift) ctx.translate(0, -lift);
    draw();
    ctx.restore();
  }

  // =========================================================================
  // DOM
  // =========================================================================
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const minimap = $('minimap');
  const mctx = minimap.getContext('2d');

  const dom = {
    hud: $('hud'),
    statO2: $('statO2'), statFood: $('statFood'), statRad: $('statRad'),
    statPower: $('statPower'), statWater: $('statWater'), statSuit: $('statSuit'),
    barO2: $('barO2'), barFood: $('barFood'), barRad: $('barRad'),
    barPower: $('barPower'), barWater: $('barWater'), barSuit: $('barSuit'),
    valO2: $('valO2'), valFood: $('valFood'), valRad: $('valRad'),
    valPower: $('valPower'), valWater: $('valWater'), valSuit: $('valSuit'),
    pips: Array.from($('pips').children),
    missionBarFill: $('missionBarFill'),
    cellCount: $('cellCount'),
    missionEyebrow: $('missionEyebrow'),
    missionText: $('missionText'),
    missionHint: $('missionHint'),
    clock: $('clock'),
    mapRegion: $('mapRegion'),
    journalBtn: $('journalBtn'),
    muteBtn: $('muteBtn'),
    regionBanner: $('regionBanner'),
    regionName: $('regionName'),
    journal: $('journal'),
    journalRegion: $('journalRegion'),
    journalObjective: $('journalObjective'),
    journalUpgrades: $('journalUpgrades'),
    upgradeCount: $('upgradeCount'),
    journalLogs: $('journalLogs'),
    journalCount: $('journalCount'),
    journalClose: $('journalClose'),
    shelterChip: $('shelterChip'),
    minimapWrap: $('minimapWrap'),
    flareBanner: $('flareBanner'),
    flareText: $('flareText'),
    danger: $('danger'),
    toasts: $('toasts'),
    screen: $('screen'),
    startPanel: $('startPanel'),
    endPanel: $('endPanel'),
    endKicker: $('endKicker'),
    endTitle: $('endTitle'),
    endText: $('endText'),
    endStats: $('endStats'),
    startBtn: $('startBtn'),
    retryBtn: $('retryBtn'),
    pause: $('pause'),
    resumeBtn: $('resumeBtn'),
    installBtn: $('installBtn'),
    missionPanel: $('missionPanel'),
    missionPanelKicker: $('missionPanelKicker'),
    missionPanelTitle: $('missionPanelTitle'),
    missionPanelText: $('missionPanelText'),
    missionPanelObjective: $('missionPanelObjective'),
    missionPanelBtn: $('missionPanelBtn'),
    missionPanelHint: $('missionPanelHint'),
    missionSuccessPopup: $('missionSuccessPopup'),
    missionSuccessKicker: $('missionSuccessKicker'),
    missionSuccessImage: $('missionSuccessImage'),
    missionSuccessText: $('missionSuccessText'),
    missionSuccessBtn: $('missionSuccessBtn'),
    infoPopup: $('infoPopup'),
    infoBadge: $('infoBadge'),
    infoFlag: $('infoFlag'),
    infoKicker: $('infoKicker'),
    infoTitle: $('infoTitle'),
    infoMeta: $('infoMeta'),
    infoBody: $('infoBody'),
    infoIcon: $('infoIcon'),
    infoCloseBtn: $('infoCloseBtn')
  };

  // =========================================================================
  // Tiny procedural audio (WebAudio, no files)
  // =========================================================================
  const Sound = {
    ctx: null,
    master: null,
    windGain: null,
    bgm: null,
    caveBgm: null,
    dungeonMove: null,
    creditsBgm: null,
    bgmWanted: false,
    inCave: false,
    bgmFadeTimer: null,
    muted: false,

    init() {
      // Main BGM (MP3)
      if (!this.bgm) {
        try {
          this.bgm = new Audio('bgm.mp3');
          this.bgm.loop = true;
          this.bgm.preload = 'auto';
          this.bgm.volume = this.muted ? 0 : 0.45;
        } catch (e) {
          this.bgm = null;
        }
      }
      // Cave/Dungeon BGM (MP3)
      if (!this.caveBgm) {
        try {
          this.caveBgm = new Audio('cave-bgm.mp3');
          this.caveBgm.loop = true;
          this.caveBgm.preload = 'auto';
          this.caveBgm.volume = 0;
        } catch (e) {
          this.caveBgm = null;
        }
      }
      // Dungeon movement sound (very low, while moving in dungeon)
      if (!this.dungeonMove) {
        try {
          this.dungeonMove = new Audio('dungeon-move.aac');
          this.dungeonMove.loop = true;
          this.dungeonMove.preload = 'auto';
          this.dungeonMove.volume = 0;
        } catch (e) {
          this.dungeonMove = null;
        }
      }
      // Credits BGM
      if (!this.creditsBgm) {
        try {
          this.creditsBgm = new Audio('Credits-bgm.mp3');
          this.creditsBgm.loop = true;
          this.creditsBgm.preload = 'auto';
          this.creditsBgm.volume = 0;
        } catch (e) {
          this.creditsBgm = null;
        }
      }
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        if (this.bgmWanted) this.syncMusic();
        this.syncDungeonMove();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        if (this.bgmWanted) this.syncMusic();
        this.syncDungeonMove();
        return;
      }
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        // Keep procedural SFX subtle under music
        this.master.gain.value = this.muted ? 0 : 0.35;
        this.master.connect(this.ctx.destination);
        this.startWind();
      } catch (err) {
        this.ctx = null;
      }
      if (this.bgmWanted) this.syncMusic();
      this.syncDungeonMove();
    },

    _clearBgmFade() {
      if (this.bgmFadeTimer) {
        clearInterval(this.bgmFadeTimer);
        this.bgmFadeTimer = null;
      }
    },

    playAudioSafe(a) {
      if (!a) return;
      a.muted = !!this.muted;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    },

    // Crossfade between main BGM and cave BGM
    syncMusic() {
      this._clearBgmFade();
      const main = this.bgm;
      const cave = this.caveBgm;
      const wantMain = !!(this.bgmWanted && !this.inCave);
      const wantCave = !!(this.bgmWanted && this.inCave);
      const mainTarget = (wantMain && !this.muted) ? 0.45 : 0;
      const caveTarget = (wantCave && !this.muted) ? 0.5 : 0;

      if (wantMain) this.playAudioSafe(main);
      if (wantCave) this.playAudioSafe(cave);

      const step = () => {
        let done = true;
        const fade = (a, target) => {
          if (!a) return;
          try {
            const v = Number.isFinite(a.volume) ? a.volume : 0;
            const t = clamp(target, 0, 1);
            const diff = t - v;
            if (Math.abs(diff) < 0.02) {
              a.volume = t;
              a.muted = !!this.muted;
              return;
            }
            done = false;
            a.volume = clamp(v + Math.sign(diff) * 0.03, 0, 1);
            a.muted = !!this.muted;
          } catch (e) {
            // ignore audio fade errors
          }
        };
        fade(main, mainTarget);
        fade(cave, caveTarget);
        if (done) {
          if (!wantMain && main) try { main.pause(); } catch (e) {}
          if (!wantCave && cave) try { cave.pause(); } catch (e) {}
          this._clearBgmFade();
        }
      };
      this.bgmFadeTimer = setInterval(step, 50);
      step();
    },

    syncDungeonMove(moving = false) {
      const a = this.dungeonMove;
      if (!a) return;
      const want = !!(this.inCave && moving && this.bgmWanted && !this.muted);
      if (want) {
        a.muted = !!this.muted;
        if (a.paused) this.playAudioSafe(a);
        // Very low movement sound in dungeon
        a.volume = this.muted ? 0 : 0.08;
      } else {
        try { a.pause(); } catch (e) {}
        a.volume = 0;
      }
    },

    enterCave() {
      this.inCave = true;
      this.syncMusic();
      this.syncDungeonMove(false);
    },

    exitCave() {
      this.inCave = false;
      this.syncMusic();
      this.syncDungeonMove(false);
    },

    playBgm() { this.syncMusic(); },
    pauseBgm() {
      this.bgmWanted = false;
      this.syncMusic();
      this.syncDungeonMove(false);
    },

    playCreditsBgm() {
      if (!this.creditsBgm) this.init();
      const a = this.creditsBgm;
      if (!a) return;
      // Stop in-game music while credits play
      this.bgmWanted = false;
      this.syncMusic();
      this.syncDungeonMove(false);
      a.muted = !!this.muted;
      a.volume = this.muted ? 0 : 0.5;
      try { a.currentTime = 0; } catch (e) {}
      this.playAudioSafe(a);
    },

    stopCreditsBgm() {
      const a = this.creditsBgm;
      if (!a) return;
      try { a.pause(); } catch (e) {}
      a.volume = 0;
    },

    startWind() {
      const c = this.ctx;
      if (!c || !this.master) return;
      const seconds = 3;
      const buffer = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
      const data = buffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        brown = (brown + 0.02 * white) / 1.02;
        data[i] = brown * 3.2;
      }
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 380;
      lp.Q.value = 0.6;
      const gain = c.createGain();
      gain.gain.value = 0.0001;
      src.connect(lp).connect(gain).connect(this.master);
      src.start();
      gain.gain.exponentialRampToValueAtTime(0.02, c.currentTime + 2.2);
      this.windGain = gain;
    },

    wind(on) {
      this.bgmWanted = !!on;
      this.syncMusic();
      if (!this.ctx || !this.windGain) return;
      const t = this.ctx.currentTime;
      this.windGain.gain.cancelScheduledValues(t);
      this.windGain.gain.setTargetAtTime(on ? 0.02 : 0.0001, t, 0.4);
    },

    setMuted(m) {
      this.muted = m;
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(m ? 0 : 0.35, this.ctx.currentTime, 0.05);
      }
      if (this.bgm) this.bgm.muted = !!m;
      if (this.caveBgm) this.caveBgm.muted = !!m;
      if (this.dungeonMove) this.dungeonMove.muted = !!m;
      if (this.creditsBgm) {
        this.creditsBgm.muted = !!m;
        if (this.creditsBgm.volume > 0 || !this.creditsBgm.paused) this.creditsBgm.volume = m ? 0 : 0.5;
      }
      this.syncMusic();
      this.syncDungeonMove(this.inCave && game && game.player ? !!game.player.moving : false);
      try { localStorage.setItem('reddust-muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    },

    tone(freq, dur, opts = {}) {
      if (!this.ctx || !this.master || this.muted) return;
      const c = this.ctx;
      const t0 = c.currentTime + (opts.delay || 0);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, t0 + dur);
      const vol = opts.vol == null ? 0.1 : opts.vol;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },

    pickup() {
      this.tone(620, 0.09, { type: 'sine', vol: 0.13 });
      this.tone(930, 0.12, { type: 'sine', vol: 0.1, delay: 0.055 });
    },
    cell() {
      this.tone(523, 0.12, { type: 'triangle', vol: 0.15 });
      this.tone(659, 0.12, { type: 'triangle', vol: 0.15, delay: 0.09 });
      this.tone(880, 0.26, { type: 'triangle', vol: 0.16, delay: 0.18 });
    },
    warn() {
      this.tone(238, 0.14, { type: 'square', vol: 0.055 });
      this.tone(196, 0.18, { type: 'square', vol: 0.055, delay: 0.18 });
    },
    flare() {
      this.tone(320, 0.7, { type: 'sawtooth', vol: 0.07, slide: 70 });
      this.tone(92, 0.9, { type: 'sine', vol: 0.14, slide: 55 });
    },
    death() {
      this.tone(180, 1.2, { type: 'sawtooth', vol: 0.09, slide: 45 });
      this.tone(70, 1.5, { type: 'sine', vol: 0.16, slide: 38 });
    },
    win() {
      [523, 659, 784, 1046].forEach((f, i) => {
        this.tone(f, 0.5, { type: 'triangle', vol: 0.11, delay: i * 0.13 });
      });
    }
  };

  // =========================================================================
  // Story & Missions — PICO: THE MARTIAN SURVIVOR (2030)
  // =========================================================================
  const STORY = {
    title: 'PICO: THE MARTIAN SURVIVOR',
    subtitle: 'An Open-World Space Survival Adventure',
    year: '2030',
    location: 'Planet Mars',
    captain: 'Captain Vijay',
    hero: 'Pico',
    crew: ['Sristi', 'Bhavyesh', 'Bikramaditya', 'Anurag', 'Saswati'],
    intro: `Year 2030. Humanity launches an ambitious expedition to Mars led by Captain Vijay with crew members Sristi, Bhavyesh, Bikramaditya, Anurag, Saswati — and a young, curious astronaut named Pico.\n\nAn asteroid storm strikes the spacecraft. Pico's landing pod crashes on Mars. He survives — alone, with low oxygen and limited supplies.\n\nPico must stay close to the ship, repair his rover, and prepare for a dangerous journey across Mars: finding old mission supplies, braving volcanic terrain, scavenging crashed ships, and building a way to launch home.`
  };

  const CHAPTERS = [
    { id: 1, title: 'CRASH & SURVIVAL', subtitle: 'STAY CLOSE TO THE SHIP' },
    { id: 2, title: 'BEYOND THE CRASH SITE', subtitle: 'SEARCH FOR SUPPLIES' },
    { id: 3, title: 'PREPARE THE ROCKET', subtitle: 'SCAVENGE AND BUILD' },
    { id: 4, title: 'FINAL CHECKS', subtitle: 'READY FOR LAUNCH' },
    { id: 5, title: 'THE LAUNCH', subtitle: 'SIGNAL AND ESCAPE' }
  ];

  const MISSIONS = [
    {
      id: 1, chapter: 1, name: 'STAY ALIVE',
      before: `Pico's landing pod has crashed on Mars.\n\nOxygen is low. The suit systems are unstable. Venturing far from the ship would be dangerous.\n\nPICO: "I can't go far like this... I need to stay within the crash site, find an emergency ration for temporary food, inspect the pod, and repair the rover."`,
      objective: 'Stay within the crash site: collect the emergency ration, inspect the pod, and repair the rover.',
      after: `Pico secures a temporary food ration, inspects the damaged pod, and gets the rover running.\n\nFor now, he can survive — but the pod's reserves won't last forever.`,
      accomplished: 'ROVER REPAIRED — Mission 1 complete.'
    },
    {
      id: 2, chapter: 2, name: 'FIND OLD SUPPLIES',
      before: `The rover is ready, and Pico can finally travel beyond the crash site.\n\nSupplies from the rocket are running out.\n\nPICO: "I need to find the oxygen and food chamber built by a previous Mars mission."`,
      objective: 'Travel to the oxygen and food chamber built by a previous Mars mission.',
      after: `Pico reaches the old mission supply chamber and secures oxygen and food.\n\nHe can push farther into Mars — but bigger challenges lie ahead.`,
      accomplished: 'SUPPLIES FOUND — Outer biomes unlocked.'
    },
    {
      id: 3, chapter: 3, name: 'HEAT SHIELDS',
      before: `To survive the journey ahead and prepare the rocket, Pico must protect critical systems from heat.\n\nPICO: "I need to equip the heat shields for the rocket."`,
      objective: 'Equip heat shields for the rocket.',
      after: `Heat shields are equipped and secured.\n\nThe rocket is better protected for the work to come.`,
      accomplished: 'HEAT SHIELDS EQUIPPED — Rocket protection ready.'
    },
    {
      id: 4, chapter: 3, name: 'SIGNAL AND SALVAGE',
      before: `Pico must venture into dangerous volcanic terrain, search wreckage for vital materials, and restore communications.\n\nPICO: "I need obsidian shards, rocket parts from crashed ships... and I have to repair the commsat to contact Captain Vijay."`,
      objective: 'Collect obsidian shards, scan crashed ships for an engine, fuel tank, and nose cone, and repair the commsat to contact Captain Vijay.',
      after: `Obsidian shards recovered. Crashed ships scanned. Commsat repaired.\n\nCAPTAIN VIJAY: "Pico, I can hear you now. Good work restoring the signal. Keep going — you're getting closer to coming home."`,
      accomplished: 'COMMSAT REPAIRED — Contact with Captain Vijay restored.'
    },
    {
      id: 5, chapter: 3, name: 'BUILD THE ROCKET',
      before: `The recovered parts are ready — but assembling a rocket on Mars won't be easy.\n\nPICO: "I have to move the engine and seal the hull before anything else."`,
      objective: 'Haul the engine with the magnetic crane and weld the hull of the rocket.',
      after: `The heavy thruster is in place and the hull is sealed.\n\nThe rocket is finally taking shape.`,
      accomplished: 'ASSEMBLY PROGRESS — Engine hauled and hull welded.'
    },
    {
      id: 6, chapter: 3, name: 'FUEL RUN',
      before: `The rocket still needs fuel.\n\nPICO: "I'll have to siphon leftover fuel from wrecked ships."`,
      objective: 'Siphon rocket fuel from three different wrecked ships.',
      after: `Fuel tanks filled from the wreckage.\n\nThe rocket is one step closer to launch.`,
      accomplished: 'FUEL SECURED — Rocket tanks filled.'
    },
    {
      id: 7, chapter: 4, name: 'THRUSTER TEST',
      before: `Before launch, Pico must be sure the engine works.\n\nPICO: "Time for a quick ignition check."`,
      objective: 'Test the thrusters with a quick ignition check.',
      after: `The thrusters fire successfully.\n\nThe engine is ready.`,
      accomplished: 'THRUSTERS TESTED — Engine responds properly.'
    },
    {
      id: 8, chapter: 4, name: 'SCIENCE & SYSTEMS',
      before: `With the rocket nearly ready, Pico completes final field tasks around Mars.\n\nPICO: "Collect samples, check the solar panels, and reach the water ice spot."`,
      objective: 'Collect rock samples, check the solar panels, and walk to the water ice spot.',
      after: `Samples collected, solar panels checked, and the water ice spot reached.\n\nFinal preparations are almost complete.`,
      accomplished: 'FIELD TASKS COMPLETE — Final checks underway.'
    },
    {
      id: 9, chapter: 5, name: 'LAUNCH SEQUENCE',
      before: `This is it. Pico prepares the final steps for escape.\n\nPICO: "Align the dish, load supplies, clear the clamps... then launch."`,
      objective: 'Align the satellite dish, load supplies, and clear four launch clamps.',
      after: `Satellite dish aligned. Supplies loaded. Launch clamps released.\n\nPico boards the rocket and launches toward home.\n\nTHE END.`,
      accomplished: 'LAUNCH COMPLETE — Pico escapes Mars.'
    }
  ];

  // =========================================================================
  // Constants
  // =========================================================================
  const WORLD = { w: 18000, h: 13000 };
  const LANDER_POS = { x: 4800, y: 7800 };
  const SHELTER_DEFS = [
    { x: 3600, y: 7035, name: 'HAB-01' },
    { x: 6450, y: 8565, name: 'HAB-02' },
    { x: 2700, y: 9941, name: 'HAB-03' },
    { x: 7800, y: 3365, name: 'HAB-04' },
    { x: 12300, y: 5812, name: 'HAB-05' },
    { x: 14700, y: 9482, name: 'HAB-06' },
    { x: 9750, y: 10706, name: 'HAB-07' },
    { x: 2100, y: 3800, name: 'HAB-08' },
    { x: 13200, y: 2400, name: 'HAB-09' },
    { x: 16500, y: 11200, name: 'HAB-10' }
  ];
  const SPACE_CENTRE = { x: 11400, y: 2753, name: 'ARES SPACE CENTRE', r: 64, safeR: 110, refillR: 86, padR: 148 };
  const FOOD_CENTRE = { x: 3300, y: 11318, name: 'HYDROPONICS BAY', r: 58, safeR: 104, refillR: 82, padR: 142 };
  const COMM_ARRAY = { x: 8400, y: 6576, name: 'COMM ARRAY', r: 54, safeR: 96, padR: 132 };
  const RELAY_SPOTS = [
    { x: 2250, y: 2753 },
    { x: 13500, y: 2294 },
    { x: 15600, y: 11012 }
  ];
  const PROBE_POS = { x: 13500, y: 2104 };
  // Dungeon interiors: separate local cave mazes entered from outdoor entrances.
  // Layouts are randomized every run and each dungeon gets a different maze.
  const DUNGEON_CONFIGS = [
    {
      id: 'basalt',
      name: 'Basalt Cave',
      entrance: { x: 2700, y: 5506, r: 26 },
      cols: 11, rows: 9, cell: 78,
      items: [
        { type: 'part', partId: 'valve' },
        { type: 'knowledge', knowledgeId: 'gravity' }
      ]
    },
    {
      id: 'ice',
      name: 'Ice Crevasse',
      entrance: { x: 9600, y: 2141, r: 26 },
      cols: 12, rows: 9, cell: 74,
      items: [
        { type: 'knowledge', knowledgeId: 'ice' }
      ]
    },
    {
      id: 'maw',
      name: 'Maw Ruin',
      entrance: { x: 15300, y: 10400, r: 26 },
      cols: 12, rows: 9, cell: 76,
      items: [
        { type: 'part', partId: 'chip' },
        { type: 'part', partId: 'seal' }
      ]
    }
  ];
  const DUNGEONS = DUNGEON_CONFIGS; // legacy alias

  function generateDungeonMaze(cfg) {
    const margin = 40;
    const baseCell = cfg.cell || 76;
    const cell = baseCell + rndi(-4, 4);
    const cols = Math.max(7, (cfg.cols || 10) + rndi(-1, 2));
    const rows = Math.max(7, (cfg.rows || 8) + rndi(-1, 1));
    const w = margin * 2 + cols * cell;
    const h = margin * 2 + rows * cell;
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({
      v: false, walls: [true, true, true, true] // top,right,bottom,left
    })));
    const stack = [];
    const start = { c: 0, r: Math.floor(rows / 2) };
    grid[start.r][start.c].v = true;
    stack.push(start);
    const dirs = [
      { dc: 0, dr: -1, w: 0, ow: 2 },
      { dc: 1, dr: 0,  w: 1, ow: 3 },
      { dc: 0, dr: 1,  w: 2, ow: 0 },
      { dc: -1, dr: 0, w: 3, ow: 1 }
    ];
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const neigh = [];
      for (const d of dirs) {
        const nc = cur.c + d.dc, nr = cur.r + d.dr;
        if (nc >= 0 && nr >= 0 && nc < cols && nr < rows && !grid[nr][nc].v) neigh.push({ nc, nr, d });
      }
      if (!neigh.length) { stack.pop(); continue; }
      const pick = neigh[rndi(0, neigh.length - 1)];
      grid[cur.r][cur.c].walls[pick.d.w] = false;
      grid[pick.nr][pick.nc].walls[pick.d.ow] = false;
      grid[pick.nr][pick.nc].v = true;
      stack.push({ c: pick.nc, r: pick.nr });
    }

    const wallT = 12;
    const walls = [
      { x: 0, y: 0, w: w, h: margin }, { x: 0, y: h - margin, w: w, h: margin },
      { x: 0, y: 0, w: margin, h: h }, { x: w - margin, y: 0, w: margin, h: h }
    ];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = margin + c * cell;
        const y = margin + r * cell;
        const cw = grid[r][c].walls;
        if (cw[0] && r === 0) walls.push({ x, y, w: cell + wallT, h: wallT });
        if (cw[3] && c === 0) walls.push({ x, y, w: wallT, h: cell + wallT });
        if (cw[1]) walls.push({ x: x + cell, y, w: wallT, h: cell + wallT });
        if (cw[2]) walls.push({ x, y: y + cell, w: cell + wallT, h: wallT });
      }
    }

    const cellCenter = (c, r) => ({ x: margin + c * cell + cell / 2, y: margin + r * cell + cell / 2 });
    // BFS distances from start to place exit/items in far reachable cells
    const distMap = Array.from({ length: rows }, () => Array(cols).fill(-1));
    const q = [start];
    distMap[start.r][start.c] = 0;
    while (q.length) {
      const cur = q.shift();
      const base = distMap[cur.r][cur.c];
      const cw = grid[cur.r][cur.c].walls;
      const moves = [
        { dc: 0, dr: -1, open: !cw[0] },
        { dc: 1, dr: 0, open: !cw[1] },
        { dc: 0, dr: 1, open: !cw[2] },
        { dc: -1, dr: 0, open: !cw[3] }
      ];
      for (const m of moves) {
        if (!m.open) continue;
        const nc = cur.c + m.dc, nr = cur.r + m.dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        if (distMap[nr][nc] !== -1) continue;
        distMap[nr][nc] = base + 1;
        q.push({ c: nc, r: nr });
      }
    }
    const cellsByDist = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (distMap[r][c] >= 0) cellsByDist.push({ c, r, d: distMap[r][c] });
    cellsByDist.sort((a, b) => b.d - a.d);

    const pickCell = (minD, excludeSet) => {
      const pool = cellsByDist.filter((cc) => cc.d >= minD && !excludeSet.has(`${cc.c},${cc.r}`));
      const src = pool.length ? pool : cellsByDist.filter((cc) => !excludeSet.has(`${cc.c},${cc.r}`));
      const list = src.length ? src : cellsByDist;
      return list[rndi(0, list.length - 1)] || start;
    };
    const used = new Set([`${start.c},${start.r}`]);
    const far = Math.max(6, cellsByDist[0] ? cellsByDist[0].d : 6);
    const exitCell = pickCell(Math.floor(far * 0.75), used); used.add(`${exitCell.c},${exitCell.r}`);
    const foodCell = pickCell(Math.floor(far * 0.35), used); used.add(`${foodCell.c},${foodCell.r}`);

    const spawn = cellCenter(start.c, start.r);
    const exitPos = cellCenter(exitCell.c, exitCell.r);
    const foodPos = cellCenter(foodCell.c, foodCell.r);

    const itemCells = [];
    (cfg.items || []).forEach((it, i) => {
      const minD = Math.floor(far * (0.55 + i * 0.12));
      const cc = pickCell(minD, used); used.add(`${cc.c},${cc.r}`);
      const pos = cellCenter(cc.c, cc.r);
      itemCells.push({ ...it, x: pos.x, y: pos.y });
    });

    return {
      interior: { w, h, spawn: { x: spawn.x, y: spawn.y }, exit: { x: exitPos.x, y: exitPos.y, r: 34 } },
      walls,
      foodStation: { x: foodPos.x, y: foodPos.y, r: 42 },
      itemCells
    };
  }

  function buildDungeonInstance(cfg) {
    const maze = generateDungeonMaze(cfg);
    return {
      id: cfg.id,
      name: cfg.name,
      entrance: { ...(cfg.entrance || { x: 800, y: 1600, r: 26 }) },
      interior: maze.interior,
      walls: maze.walls,
      foodStation: maze.foodStation,
      items: maze.itemCells.map((it) => ({
        type: it.type,
        sampleId: it.sampleId,
        knowledgeId: it.knowledgeId,
        partId: it.partId,
        x: it.x,
        y: it.y,
        r: ({ rad: 11, relay: 14, amp: 17, tank: 14, lining: 14, boots: 14, sample: 13, knowledge: 12, part: 14, water: 13, repair: 13, power: 12 })[it.type] || 13,
        taken: false,
        phase: rnd(0, TAU)
      }))
    };
  }
  const SAMPLE_DEFS = [
    { id: 'dune', name: 'Gale Dune Soil', where: 'Gale Crater' },
    { id: 'iron', name: 'Meridiani Iron Nodule', where: 'Meridiani Planum' },
    { id: 'basalt', name: 'Gusev Basalt Core', where: 'Gusev Crater' },
    { id: 'frost', name: 'Jezero Sediment Sample', where: 'Jezero Crater' },
    { id: 'maw', name: 'Valles Marineris Rock', where: 'Valles Marineris' }
  ];
  const KNOWLEDGE_DEFS = [
    { id: 'sky', title: 'Mars Sky', text: 'Mars looks red because iron-rich dust in its thin atmosphere scatters sunlight, tinting the sky rusty by day and blue near the setting Sun.' },
    { id: 'gravity', title: 'Low Gravity', text: 'Gravity on Mars is about 38% of Earth’s. A 30 kg backpack would feel like 11 kg, but falls still hurt on sharp rock.' },
    { id: 'ice', title: 'Water Ice', text: 'Mars holds vast amounts of water ice at its poles and underground. Liquid water cannot last long on the surface because the air pressure is so low.' },
    { id: 'olympus', title: 'Olympus Mons', text: 'Olympus Mons is the tallest known volcano in the Solar System, rising about 22 km high — nearly three times the height of Mount Everest.' },
    { id: 'day', title: 'A Sol', text: 'A Martian day, called a sol, lasts 24 hours and 39 minutes. Seasons last longer too because Mars takes 687 Earth days to orbit the Sun.' }
  ];
  const PART_DEFS = [
    { id: 'valve', name: 'Fuel Valve', where: 'Basalt Cave' },
    { id: 'chip', name: 'Navigation Chip', where: 'Maw Ruin' },
    { id: 'seal', name: 'Hull Seal', where: 'Maw Ruin' }
  ];
  const ZONES = [
    { id: 'gusev', name: 'Gusev Crater', x: 2700, y: 4894, r: 2800, rgb: [126, 72, 42], rad: 0.45 },
    { id: 'meridiani', name: 'Meridiani Planum', x: 8400, y: 6882, r: 3080, rgb: [152, 80, 48], rad: 0.4 },
    { id: 'jezero', name: 'Jezero Crater', x: 9000, y: 2141, r: 2660, rgb: [150, 126, 110], rad: 0.36 },
    { id: 'valles', name: 'Valles Marineris', x: 14700, y: 10400, r: 3080, rgb: [96, 44, 28], rad: 0.72 },
    { id: 'gale', name: 'Gale Crater', x: 3300, y: 10706, r: 2660, rgb: [170, 110, 66], rad: 0.38 },
    { id: 'volcano', name: 'Volcanic Highlands', x: 15300, y: 2753, r: 2380, rgb: [78, 26, 20], rad: 0.62 }
  ];

  // Real Mars mission sites (rovers/landers with country flags) — educational mission info
  const ROVER_SITES = [
    {
      id: 'spirit',
      name: 'Spirit (MER-A) · Gusev Crater',
      year: '2004',
      agency: 'NASA (Mars Exploration Rover mission)',
      country: 'USA',
      flag: 'USA',
      x: 2100, y: 4588, r: 28,
      zone: 'Gusev Crater',
      info: 'Spirit (MER-A) was a twin Mars Exploration Rover with Opportunity. Launched 2003 and landed Jan 4, 2004 in Gusev Crater to explore Martian geology and search for signs of past water. Planned for ~90 sols, Spirit far outlived its mission and remained active until March 22, 2010 (USA/NASA mission).'
    },
    {
      id: 'opportunity',
      name: 'Opportunity (MER-B) · Meridiani Planum',
      year: '2004',
      agency: 'NASA (Mars Exploration Rover mission)',
      country: 'USA',
      flag: 'USA',
      x: 8700, y: 7188, r: 28,
      zone: 'Meridiani Planum',
      info: 'Opportunity (MER-B, "Oppy") was the twin Mars Exploration Rover with Spirit. Launched July 7, 2003 and landed Jan 25, 2004 in Meridiani Planum. It studied Martian geology and evidence of past water, operating 5,111 sols (2004–June 10, 2018), far beyond its 90-sol plan (USA/NASA mission).'
    },
    {
      id: 'phoenix',
      name: 'Phoenix Lander · Near Martian North Pole',
      year: '2008',
      agency: 'NASA / University of Arizona (LPL) · JPL',
      country: 'USA',
      flag: 'USA',
      x: 9000, y: 918, r: 28,
      zone: 'Near North Polar Region',
      info: 'Phoenix was an uncrewed NASA Mars lander (Mars Scout Program). It landed May 25, 2008 near the Martian north pole to dig for water ice and study local habitability and the history of water on Mars. Operated 157 sols (161 days) until Nov 2, 2008. Led by the University of Arizona Lunar and Planetary Laboratory with JPL project management; multi-agency/academic/industry partners (USA, Canada, Switzerland, Denmark, Germany, UK, Finland and others). Total cost ~$420M. First NASA Mars mission led by a public university.'
    },
    {
      id: 'curiosity',
      name: 'Curiosity (MSL) · Gale Crater',
      year: '2012',
      agency: 'NASA (Mars Science Laboratory / JPL)',
      country: 'USA',
      flag: 'USA',
      x: 3150, y: 11012, r: 30,
      zone: 'Gale Crater',
      info: 'Curiosity is a car-sized NASA rover exploring Gale Crater and Mount Sharp (Aeolis Palus). Launched Nov 26, 2011 and landed Aug 6, 2012 (Bradbury Landing). Goals: study Martian climate and geology, investigate past habitable environments and the role of water, and assess habitability for future human exploration. Originally a 2-year mission, it remains active (USA/NASA mission).'
    },
    {
      id: 'perseverance',
      name: 'Perseverance (Mars 2020) · Jezero Crater',
      year: '2021',
      agency: 'NASA (JPL, Mars 2020)',
      country: 'USA',
      flag: 'USA',
      x: 9300, y: 2294, r: 30,
      zone: 'Jezero Crater',
      info: 'Perseverance is a NASA rover exploring Jezero Crater (ancient river delta) since landing Feb 18, 2021 (launched July 30, 2020). Goals: search for signs of ancient life, study geology/climate, collect samples for possible return to Earth, and test tech for human exploration (including MOXIE oxygen production). It deployed Ingenuity, which made the first powered flight on another planet (USA/NASA mission).'
    }
  ];

  const MISSION_INFO_OBJECTS = {
    probe: {
      title: 'Survey Probe K-9',
      text: 'Survey Probe K-9 represents robotic Mars explorers that collect data, images, and signals from remote regions. Probes help scientists study terrain, weather, and resources before and during crewed missions.'
    },
    comm: {
      title: 'Communications Array',
      text: 'A Mars communications array relays signals between astronauts, habitats, rovers, and mission control. Reliable communications are essential for navigation, safety, science data, and rescue coordination.'
    },
    commsUnit: {
      title: 'Damaged Communications Equipment',
      text: 'Portable comms equipment allows astronauts to send/receive guidance and telemetry. On Mars, repairing antennas and radios is critical because distance and dust storms can interrupt signals.'
    },
    spacecraft: {
      title: 'Spacecraft / Landing Pod',
      text: 'A Mars landing craft must survive entry, descent, and landing, then provide shelter and systems for survival. For return, propulsion, navigation, power, and life-support systems must be repaired and checked before launch.'
    }
  };
  const LOG_DEFS = [
    {
      x: 5400, y: 7341, title: 'LOG 01 — THE DOOR',
      text: 'Ares Horizon, Sol 0. The threshold test failed in a way we cannot explain. The door opened onto a place with red sky and no wind. Corporal Reyes went through. She did not come back. The child in the observation room was not on the manifest.'
    },
    {
      x: 2100, y: 4282, title: 'LOG 02 — WATER DISCIPLINE',
      text: 'Sol 14. Rationing is holding. The recyclers in the canyon habitats still work, but the dust gets into everything. If you are reading this, use the domes. They buy you minutes. Minutes are the whole game out here.'
    },
    {
      x: 3300, y: 9482, title: 'LOG 03 — THE SURVEYOR',
      text: 'Sol 31. K-9 went down across the flats with the long-range amplifier still in its bay. Without it our beacon is a flashlight pointed at the ground. Someone has to walk to the probe. Nobody volunteers.'
    },
    {
      x: 9300, y: 1835, title: 'LOG 04 — JEZERO SILENCE',
      text: 'Sol 47. Jezero Crater at night is the quietest place I have ever stood. The ancient sediment under the dust is real. So is the radiation coming off the scarp. Keep your tabs close and your visits short.'
    },
    {
      x: 14700, y: 2447, title: 'LOG 05 — WHAT WE HEARD',
      text: 'Sol 58. The probe kept transmitting after it died. Not telemetry. A voice, reading numbers, then a child counting backward from ten. I am writing this down because I do not trust my own ears anymore.'
    },
    {
      x: 15300, y: 10706, title: 'LOG 06 — VALLES MARINERIS',
      text: 'Sol 66. Do not cross the black crater field without shielding. The regolith there is hot enough to cook a suit. The crew calls it the Maw. I call it the place that is winning.'
    },
    {
      x: 7200, y: 10400, title: 'LOG 07 — CAMP PICTURE',
      text: 'Sol 71. Found an old camp in the dunes. Six bunks, one child-sized boot, and a drawing pinned to the wall: a red circle, a small figure, and a door standing open in the middle of nowhere. We are not the first ones here.'
    },
    {
      x: 11400, y: 7953, title: 'LOG 08 — LAST ENTRY',
      text: 'Sol 80. If the beacon is rebuilt, the door will open again. I do not know if that is rescue or something worse. But there is a kid on this planet now, and kids deserve a way home. — I. Vale'
    }
  ];
  const UPGRADE_SPOTS = [
    { type: 'tank', x: 2400, y: 3671 },
    { type: 'tank', x: 11700, y: 2447 },
    { type: 'lining', x: 14100, y: 9788 },
    { type: 'boots', x: 3900, y: 11624 }
  ];
  const RATES = {
    o2: 0.95,
    o2Sprint: 1.5,
    o2Refill: 18,
    o2Starve: 1.8,
    food: 0.28,
    foodRefill: 22,
    power: 0.22,
    powerSprint: 0.55,
    powerRefill: 20,
    water: 0.18,
    waterRefill: 20,
    radOpen: 0.45,
    radFlare: 5.2,
    radShelter: 9,
    suitWearRad: 0.06,
    suitWearFlare: 0.22,
    suitRepair: 16,
    starveDeath: 16,
    dehydrateDeath: 18,
    powerDeath: 20
  };
  const ITEM_DEF = {
    rad: { r: 11, color: '#cf9bff', glow: 'rgba(190,120,255,0.26)', label: 'RAD TAB' },
    relay: { r: 14, color: '#ffd23f', glow: 'rgba(255,200,50,0.36)', label: 'RELAY MODULE' },
    amp: { r: 17, color: '#7ef0ff', glow: 'rgba(90,230,255,0.38)', label: 'SIGNAL AMPLIFIER' },
    tank: { r: 14, color: '#6ff0c8', glow: 'rgba(80,235,190,0.3)', label: 'O₂ TANK MODULE' },
    lining: { r: 14, color: '#d19bff', glow: 'rgba(200,140,255,0.3)', label: 'RAD LINING' },
    boots: { r: 14, color: '#ffb06e', glow: 'rgba(255,170,90,0.3)', label: 'SERVO BOOTS' },
    sample: { r: 13, color: '#ff9b6a', glow: 'rgba(255,140,90,0.28)', label: 'MARS ROCK' },
    knowledge: { r: 12, color: '#7fdcff', glow: 'rgba(110,220,255,0.26)', label: 'MARS KNOWLEDGE' },
    part: { r: 14, color: '#ffe08a', glow: 'rgba(255,210,100,0.28)', label: 'COMPONENT' },
    water: { r: 13, color: '#6fd7ff', glow: 'rgba(110,215,255,0.32)', label: 'WATER CANISTER' },
    repair: { r: 13, color: '#ffd89a', glow: 'rgba(255,220,150,0.3)', label: 'REPAIR KIT' },
    power: { r: 12, color: '#a8ff7a', glow: 'rgba(160,255,120,0.3)', label: 'POWER CELL' }
  };
  const VIEW = { w: 0, h: 0, scale: 1, dpr: 1 };

  // =========================================================================
  // State
  // =========================================================================
  const game = {
    time: 0,
    cam: { x: LANDER_POS.x, y: LANDER_POS.y + 120 },
    player: null,
    rocks: [],
    items: [],
    craters: [],
    shelters: [],
    lander: null,
    spaceCentre: null,
    foodCentre: null,
    commArray: null,
    probe: null,
    logs: [],
    particles: [],
    motes: [],
    dungeons: [],
    flare: { phase: 'idle', timer: 42, count: 0 },
    quest: {
      radarRestored: false, amplifier: false, ampInstalled: false,
      earthContact: false, earthMissionGiven: false, missionStage: 0,
      level: 1,
      rocksCollected: 0, rocksRequired: 3,
      waterFound: 0, waterRequired: 2,
      nearPartRepaired: false
    },
    side: {
      samples: 0, sampleIds: {},
      knowledge: 0, knowledgeIds: {},
      parts: 0, partIds: {},
      rocketRepaired: false
    },
    location: 'outdoor',
    dungeonId: null,
    dungeon: null,
    outdoorPos: null,
    region: null,
    regionTimer: 0,
    shake: 0,
    sheltered: false,
    o2Refill: false,
    foodRefill: false,
    powerRefill: false,
    waterRefill: false,
    stats: { distance: 0, pickups: 0, peakRad: 0, relays: 0, logs: 0 },
    flags: {},
    tips: [],
    warnings: { o2: 0, food: 0, rad: 0, power: 0, water: 0, suit: 0 },
    nearBeacon: false,
    nearAction: '',
    hudTimer: 0,
    lastMapDraw: 0
  };

  let state = 'menu';
  let lastFrame = performance.now();
  const groundCache = new Map();
  let warmQueue = [];
  const CHUNK = 1024;
  const GROUND_CACHE_MAX = 60;

  // Input
  const keys = Object.create(null);
  const look = { active: false, id: null, lastX: 0, lastY: 0 };


  try {
    Sound.muted = localStorage.getItem('reddust-muted') === '1';
  } catch (e) { /* ignore */ }

  // =========================================================================
  // World generation — procedural ground (chunked, deterministic, cached)
  // =========================================================================
  function hash2(x, y) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function zoneWeights(x, y) {
    const w = [];
    let sum = 0;
    for (const z of ZONES) {
      const dx = (x - z.x) / z.r;
      const dy = (y - z.y) / z.r;
      const d2 = dx * dx + dy * dy;
      const v = 1 / (1 + d2 * d2 * 1.6);
      w.push(v);
      sum += v;
    }
    return { w, sum };
  }

  function zoneAt(x, y) {
    const { w } = zoneWeights(x, y);
    let best = 0;
    for (let i = 1; i < w.length; i++) if (w[i] > w[best]) best = i;
    return ZONES[best];
  }

  function groundColorAt(x, y, out) {
    const { w, sum } = zoneWeights(x, y);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < ZONES.length; i++) {
      const c = ZONES[i].rgb;
      const k = w[i] / sum;
      r += c[0] * k;
      g += c[1] * k;
      b += c[2] * k;
    }
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return out;
  }

  function paintChunk(cx, cy) {
    const rng = mulberry32(hash2(cx * 7 + 13, cy * 11 + 29));
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 512;
    const g = cv.getContext('2d');
    const ox = cx * CHUNK;
    const oy = cy * CHUNK;

    // Smooth base field, sampled on a small grid then scaled up
    const small = document.createElement('canvas');
    small.width = 64;
    small.height = 64;
    const sg = small.getContext('2d');
    const img = sg.createImageData(64, 64);
    const data = img.data;
    const col = [0, 0, 0];
    let pi = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const wx = ox + (x + 0.5) * (CHUNK / 64);
        const wy = oy + (y + 0.5) * (CHUNK / 64);
        groundColorAt(wx, wy, col);
        const j = (rng() - 0.5) * 6;
        data[pi++] = clamp(col[0] + j, 0, 255);
        data[pi++] = clamp(col[1] + j, 0, 255);
        data[pi++] = clamp(col[2] + j, 0, 255);
        data[pi++] = 255;
      }
    }
    sg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(small, 0, 0, 512, 512);

    const zone = zoneAt(ox + CHUNK / 2, oy + CHUNK / 2);

    // Broad mineral / ice / ash blotches
    for (let i = 0; i < 64; i++) {
      const x = rng() * 512;
      const y = rng() * 512;
      const r = 18 + rng() * 130;
      const light = rng() > 0.52;
      let color;
      if (zone.id === 'jezero') color = light ? 'rgba(236,220,210,0.05)' : 'rgba(80,60,52,0.055)';
      else if (zone.id === 'valles') color = light ? 'rgba(210,110,70,0.035)' : 'rgba(18,7,4,0.10)';
      else if (zone.id === 'gusev') color = light ? 'rgba(235,150,100,0.04)' : 'rgba(40,18,10,0.085)';
      else if (zone.id === 'gale') color = light ? 'rgba(255,205,150,0.05)' : 'rgba(88,40,18,0.06)';
      else color = light ? 'rgba(235,160,110,0.045)' : 'rgba(40,14,7,0.075)'; // Meridiani Planum and fallback
      g.fillStyle = color;
      g.beginPath();
      g.ellipse(x, y, r, r * (0.35 + rng() * 0.5), rng() * TAU, 0, TAU);
      g.fill();
    }

    // Global craters (cosmetic)
    for (const cr of game.craters) {
      if (cr.x + cr.r < ox - 40 || cr.x - cr.r > ox + CHUNK + 40) continue;
      if (cr.y + cr.r < oy - 40 || cr.y - cr.r > oy + CHUNK + 40) continue;
      const px = (cr.x - ox) / 2;
      const py = (cr.y - oy) / 2;
      const pr = cr.r / 2;
      g.save();
      g.translate(px, py);
      g.scale(1, cr.squash);
      const rim = g.createRadialGradient(0, 0, pr * 0.25, 0, 0, pr);
      rim.addColorStop(0, 'rgba(58,24,13,0.26)');
      rim.addColorStop(0.78, 'rgba(62,26,14,0.19)');
      rim.addColorStop(0.94, 'rgba(235,155,105,0.10)');
      rim.addColorStop(1, 'rgba(255,190,140,0)');
      g.fillStyle = rim;
      g.beginPath();
      g.arc(0, 0, pr, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(255,185,135,0.07)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(0, 0, pr * 0.94, 0.15, Math.PI * 0.95);
      g.stroke();
      g.restore();
    }

    // Zone-specific texture (real Mars regions)
    if (zone.id === 'jezero') {
      // Jezero Crater - ancient delta / sediment-like bands
      for (let i = 0; i < 24; i++) {
        const x = rng() * 512;
        const y = rng() * 512;
        const len = 40 + rng() * 140;
        g.strokeStyle = rng() > 0.5 ? 'rgba(235,220,205,0.08)' : 'rgba(90,70,58,0.08)';
        g.lineWidth = 1.2 + rng() * 2.2;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + len * 0.5, y + (rng() - 0.5) * 18, x + len, y + (rng() - 0.5) * 12);
        g.stroke();
      }
      for (let i = 0; i < 8; i++) {
        const x = rng() * 512; const y = rng() * 512; const r = 18 + rng() * 50;
        g.fillStyle = 'rgba(210,190,170,0.05)';
        g.beginPath(); g.ellipse(x, y, r, r * 0.5, rng() * TAU, 0, TAU); g.fill();
      }
    } else if (zone.id === 'gusev') {
      // Gusev Crater - basaltic plains / cratered terrain
      for (let i = 0; i < 22; i++) {
        const y = rng() * 512;
        g.strokeStyle = rng() > 0.5 ? 'rgba(60,30,18,0.12)' : 'rgba(220,150,100,0.06)';
        g.lineWidth = 2 + rng() * 5;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(150, y + (rng() - 0.5) * 22, 360, y + (rng() - 0.5) * 22, 512, y + (rng() - 0.5) * 14);
        g.stroke();
      }
    } else if (zone.id === 'volcano') {
      // Volcanic Highlands - dark basalt, ash, and lava-like streaks
      for (let i = 0; i < 40; i++) {
        const x = rng() * 512;
        const y = rng() * 512;
        g.fillStyle = rng() > 0.5 ? 'rgba(20,8,6,0.18)' : 'rgba(180,70,30,0.05)';
        g.beginPath();
        g.ellipse(x, y, 8 + rng() * 38, 4 + rng() * 16, rng() * TAU, 0, TAU);
        g.fill();
      }
      g.strokeStyle = 'rgba(255,90,40,0.08)';
      for (let i = 0; i < 10; i++) {
        const x = rng() * 512; const y = rng() * 512;
        g.lineWidth = 1 + rng() * 2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng()-0.5)*80, y + (rng()-0.5)*40); g.stroke();
      }
    } else if (zone.id === 'valles') {
      // Valles Marineris - canyon system, fractured dark terrain
      for (let i = 0; i < 34; i++) {
        const x = rng() * 512;
        const y = rng() * 512;
        g.fillStyle = rng() > 0.5 ? 'rgba(12,4,2,0.16)' : 'rgba(220,120,80,0.045)';
        g.beginPath();
        g.ellipse(x, y, 10 + rng() * 42, 5 + rng() * 20, rng() * TAU, 0, TAU);
        g.fill();
      }
      g.strokeStyle = 'rgba(10,4,2,0.22)';
      for (let i = 0; i < 14; i++) {
        const x = rng() * 512; const y = rng() * 512;
        g.lineWidth = 1 + rng() * 1.8;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 140, y + (rng() - 0.5) * 140); g.stroke();
      }
    } else if (zone.id === 'gale') {
      // Gale Crater - dunes/mount sharp foothills texture
      for (let i = 0; i < 26; i++) {
        const x = rng() * 512; const y = rng() * 512; const len = 60 + rng() * 180;
        const shade = rng() > 0.5;
        g.lineWidth = 2 + rng() * 3;
        g.strokeStyle = shade ? 'rgba(255,205,150,0.075)' : 'rgba(85,38,16,0.09)';
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + len * 0.4, y - 16 - rng() * 18, x + len, y + 4);
        g.stroke();
      }
    } else {
      // Meridiani Planum - smoother hematite plains
      for (let i = 0; i < 12; i++) {
        const x = rng() * 512; const y = rng() * 512;
        g.strokeStyle = 'rgba(255,200,150,0.045)';
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + 35, y + (rng() - 0.5) * 12, x + 80, y + (rng() - 0.5) * 10);
        g.stroke();
      }
    }

    // Fine regolith speckle
    for (let i = 0; i < 900; i++) {
      const x = rng() * 512;
      const y = rng() * 512;
      const s = 0.6 + rng() * 1.6;
      g.fillStyle = rng() > 0.55 ? 'rgba(255,220,185,0.16)' : 'rgba(30,12,6,0.2)';
      g.fillRect(x, y, s, s);
    }

    return cv;
  }

  function getChunk(cx, cy) {
    const key = `${cx},${cy}`;
    let c = groundCache.get(key);
    if (c) {
      groundCache.delete(key);
      groundCache.set(key, c);
      return c;
    }
    c = paintChunk(cx, cy);
    groundCache.set(key, c);
    if (groundCache.size > GROUND_CACHE_MAX) {
      groundCache.delete(groundCache.keys().next().value);
    }
    return c;
  }

  let warmKey = '';
  function buildWarmQueue(force = false) {
    const cx = Math.floor(game.cam.x / CHUNK);
    const cy = Math.floor(game.cam.y / CHUNK);
    const key = `${cx},${cy}`;
    if (!force && key === warmKey) return;
    warmKey = key;
    const list = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) list.push([cx + dx, cy + dy, dx * dx + dy * dy]);
    }
    list.sort((a, b) => a[2] - b[2]);
    warmQueue = list;
  }

  // Paint one nearby chunk per frame so the first playable frames do not stall
  // on procedural ground generation. The five-by-five ring covers every orbit
  // angle around the player at the current draw distance.
  function warmGroundStep() {
    if (!warmQueue.length) return;
    const [cx, cy] = warmQueue.shift();
    if (!groundCache.has(`${cx},${cy}`)) getChunk(cx, cy);
  }

  function ensureGround() {
    if (!game.craters.length) {      for (let i = 0; i < 64; i++) {
        let x, y, tries = 0;
        do {
          x = rnd(100, WORLD.w - 100);
          y = rnd(100, WORLD.h - 100);
          tries++;
        } while (tries < 30 && dist(x, y, LANDER_POS.x, LANDER_POS.y) < 280);
        game.craters.push({
          x, y,
          r: rnd(30, 120),
          squash: rnd(0.62, 0.95)
        });
      }
    }
  }

  function isClear(x, y, pad = 0, itemGap = 50) {
    if (x < 90 || y < 90 || x > WORLD.w - 90 || y > WORLD.h - 90) return false;
    if (dist(x, y, LANDER_POS.x, LANDER_POS.y) < 220 + pad) return false;
    if (dist(x, y, LANDER_POS.x, LANDER_POS.y + 120) < 150 + pad) return false;
    if (dist(x, y, PROBE_POS.x, PROBE_POS.y) < 150 + pad) return false;
    for (const s of game.shelters) {
      if (dist(x, y, s.x, s.y) < 130 + pad) return false;
    }
    if (game.rocks) for (const r of game.rocks) {
      if (dist(x, y, r.x, r.y) < r.r + 30 + pad) return false;
    }
    if (game.items) for (const it of game.items) {
      if (dist(x, y, it.x, it.y) < itemGap) return false;
    }
    for (const cell of RELAY_SPOTS) {
      if (dist(x, y, cell.x, cell.y) < 65) return false;
    }
    for (const l of LOG_DEFS) {
      if (dist(x, y, l.x, l.y) < 60 + pad) return false;
    }
    for (const u of UPGRADE_SPOTS) {
      if (dist(x, y, u.x, u.y) < 65 + pad) return false;
    }
    if (nearMissionObject(x, y, pad)) return false;
    return true;
  }

  function makeRock(x, y, r) {
    const n = rndi(7, 10);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const rr = r * rnd(0.76, 1.08);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.8]);
    }
    return { x, y, r, pts };
  }

  function nearMissionObject(x, y, pad = 0) {
    const so = game.storyObjects;
    if (!so) return false;
    for (const k in so) {
      const o = so[k];
      if (o && typeof o.x === 'number' && typeof o.y === 'number') {
        if (dist(x, y, o.x, o.y) < (o.r || 30) + 60 + pad) return true;
      }
    }
    return false;
  }

  function nearLandmark(x, y, pad) {
    if (dist(x, y, PROBE_POS.x, PROBE_POS.y) < 180 + pad) return true;
    for (const l of LOG_DEFS) if (dist(x, y, l.x, l.y) < 70 + pad) return true;
    for (const u of UPGRADE_SPOTS) if (dist(x, y, u.x, u.y) < 80 + pad) return true;
    if (nearMissionObject(x, y, pad)) return true;
    return false;
  }

  function makeRocks() {
    const rocks = [];
    let guard = 0;
    while (rocks.length < 520 && guard < 18000) {
      guard++;
      const r = rnd(13, 42);
      const x = rnd(90, WORLD.w - 90);
      const y = rnd(90, WORLD.h - 90);
      if (dist(x, y, LANDER_POS.x, LANDER_POS.y) < 230) continue;
      if (dist(x, y, LANDER_POS.x, LANDER_POS.y + 120) < 160) continue;
      if (nearLandmark(x, y, 20 + r)) continue;
      let ok = true;
      for (const s of game.shelters) if (dist(x, y, s.x, s.y) < 145 + r) { ok = false; break; }
      for (const cell of RELAY_SPOTS) if (dist(x, y, cell.x, cell.y) < 95 + r) { ok = false; break; }
      for (const o of rocks) if (dist(x, y, o.x, o.y) < o.r + r + 18) { ok = false; break; }
      if (ok) rocks.push(makeRock(x, y, r));
    }
    // Boulder landmarks scattered across the expanded map
    for (let i = 0; i < 42; i++) {
      let placed = false;
      for (let a = 0; a < 240 && !placed; a++) {
        const r = rnd(46, 88);
        const x = rnd(120, WORLD.w - 120);
        const y = rnd(120, WORLD.h - 120);
        if (dist(x, y, LANDER_POS.x, LANDER_POS.y) < 360) continue;
        if (dist(x, y, LANDER_POS.x, LANDER_POS.y + 120) < 220) continue;
        if (nearLandmark(x, y, 40 + r)) continue;
        let ok = true;
        for (const s of game.shelters) if (dist(x, y, s.x, s.y) < 190 + r) { ok = false; break; }
        for (const cell of RELAY_SPOTS) if (dist(x, y, cell.x, cell.y) < 150 + r) { ok = false; break; }
        for (const o of rocks) if (dist(x, y, o.x, o.y) < o.r + r + 30) { ok = false; break; }
        if (ok) { rocks.push(makeRock(x, y, r)); placed = true; }
      }
    }
    return rocks;
  }

  function addItem(type, x, y, extra = {}) {
    const def = ITEM_DEF[type];
    const it = { type, x, y, r: def.r, taken: false, phase: rnd(0, TAU) };
    if (extra.sampleId) it.sampleId = extra.sampleId;
    if (extra.knowledgeId) it.knowledgeId = extra.knowledgeId;
    if (extra.partId) it.partId = extra.partId;
    game.items.push(it);
  }

  function spotNear(cx, cy, minD, maxD) {
    for (let i = 0; i < 80; i++) {
      const a = rnd(0, TAU);
      const d = rnd(minD, maxD);
      const x = clamp(cx + Math.cos(a) * d, 90, WORLD.w - 90);
      const y = clamp(cy + Math.sin(a) * d, 90, WORLD.h - 90);
      if (isClear(x, y, 0, 42)) return { x, y };
    }
    return null;
  }

  function makeItems() {
    // Relay modules (spread across the map)
    RELAY_SPOTS.forEach((p) => addItem('relay', p.x, p.y));

    // Mars samples placed in distant regions to reward exploration
    addItem('sample', 3300, 10706, { sampleId: 'dune' });
    addItem('sample', 2400, 4588, { sampleId: 'iron' });
    addItem('sample', 9300, 2294, { sampleId: 'frost' });
    addItem('sample', 2700, 5506, { sampleId: 'basalt' });
    addItem('sample', 15000, 10400, { sampleId: 'maw' });

    // Water sources/canisters across the journey
    addItem('water', 2100, 2141);
    addItem('water', 11400, 2753);
    addItem('water', 7800, 9482);
    addItem('water', 14700, 6424);

    // Only one supply crate exists in the world (Mission 1 emergency ration). No extra supply crates.

    // Optional suit upgrades hidden at the edges of the map
    UPGRADE_SPOTS.forEach((u) => addItem(u.type, u.x, u.y));

    // Extra knowledge discoveries
    addItem('knowledge', 6300, 7341, { knowledgeId: 'sky' });
    addItem('knowledge', 15300, 3365, { knowledgeId: 'olympus' });
    addItem('knowledge', 11400, 9482, { knowledgeId: 'day' });
  }

  function makePlayer() {
    return {
      x: LANDER_POS.x + 95,
      y: LANDER_POS.y + 152,
      r: 14,
      speed: 200,
      o2: 45,
      maxO2: 100,
      food: 100,
      power: 100,
      maxPower: 100,
      water: 100,
      suit: 100,
      maxSuit: 100,
      rad: 0,
      radResist: 1,
      relays: 0,
      upgrades: { tank: 0, lining: 0, boots: 0 },
      walk: 0,
      moving: false,
      face: { x: -0.53, y: -0.848 },
      starving: false,
      starveTimer: 0,
      dehydrateTimer: 0,
      powerTimer: 0,
      stepT: 0
    };
  }

  function makeMotes() {
    const vw = VIEW.w || 1000;
    const vh = VIEW.h || 700;
    return Array.from({ length: 130 }, () => ({
      x: rnd(-30, vw + 30),
      y: rnd(-30, vh + 30),
      vx: rnd(-16, 22),
      vy: rnd(-7, 7),
      r: rnd(0.5, 1.8),
      a: rnd(0.06, 0.3)
    }));
  }

  function randomDungeonEntrance() {
    for (let i = 0; i < 120; i++) {
      const x = rnd(220, WORLD.w - 220);
      const y = rnd(220, WORLD.h - 220);
      if (dist(x, y, LANDER_POS.x, LANDER_POS.y) < 420) continue;
      if (dist(x, y, COMM_ARRAY.x, COMM_ARRAY.y) < 260) continue;
      if (dist(x, y, SPACE_CENTRE.x, SPACE_CENTRE.y) < 260) continue;
      if (dist(x, y, FOOD_CENTRE.x, FOOD_CENTRE.y) < 260) continue;
      if (game.shelters.some((s) => dist(x, y, s.x, s.y) < 220)) continue;
      if (game.dungeons && game.dungeons.some((d) => dist(x, y, d.entrance.x, d.entrance.y) < 320)) continue;
      return { x, y, r: 26 };
    }
    return { x: rnd(500, WORLD.w - 500), y: rnd(500, WORLD.h - 500), r: 26 };
  }

  function resetWorld() {
    game.time = 0;
    CAM.yaw = 0;
    CAM.targetYaw = 0;
    CAM.pitch = 0.32;
    CAM.targetPitch = 0.32;
    CAM.dist = 690;
    CAM.targetDist = 690;
    game.stats = { distance: 0, pickups: 0, peakRad: 0, relays: 0, logs: 0, upgrades: 0 };
    game.footprints = [];
    game.dustDevils = [];
    game.shootingStars = [];
    game.quest = {
      radarRestored: false, amplifier: false, ampInstalled: false,
      earthContact: false, earthMissionGiven: false, earthMissionComplete: false, missionStage: 0,
      level: 1,
      rocksCollected: 0, rocksRequired: 3,
      waterFound: 0, waterRequired: 2,
      nearPartRepaired: false
    };
    game.side = {
      samples: 0, sampleIds: {},
      knowledge: 0, knowledgeIds: {},
      parts: 0, partIds: {},
      rocketRepaired: false
    };
    game.location = 'outdoor';
    game.dungeonId = null;
    game.dungeon = null;
    game.outdoorPos = null;
    game.flare = { phase: 'idle', timer: 42, count: 0 };
    game.region = null;
    game.regionTimer = 0;
    game.shake = 0;
    game.particles = [];
    game.footprints = game.footprints || [];
    game.dustDevils = game.dustDevils || [];
    game.shootingStars = game.shootingStars || [];
    game.warnings = { o2: 0, food: 0, rad: 0, power: 0, water: 0, suit: 0 };
    game.sheltered = false;
    game.o2Refill = false;
    game.stationO2Refill = false;
    game.rocketO2Refill = false;
    game.foodRefill = false;
    game.powerRefill = false;
    game.waterRefill = false;
    game.nearBeacon = false;
    game.nearAction = '';
    game.hudTimer = 0;
    game.lastMapDraw = 0;
    game.flags = {};
    game.tips = [];
    game.nearPart = null;
    game.probe = { x: PROBE_POS.x, y: PROBE_POS.y, r: 40, active: false };
    game.logs = LOG_DEFS.map((l, i) => ({
      id: i, x: l.x, y: l.y, title: l.title, text: l.text,
      taken: false, phase: rnd(0, TAU)
    }));
    game.lander = { x: LANDER_POS.x, y: LANDER_POS.y, r: 46, safeR: 106 };
    game.lander.bodyGrad = ctx.createLinearGradient(-34, -52, 34, 18);
    game.lander.bodyGrad.addColorStop(0, '#fff8ea');
    game.lander.bodyGrad.addColorStop(0.55, '#e8ddcb');
    game.lander.bodyGrad.addColorStop(1, '#bfb19d');
    game.spaceCentre = { ...SPACE_CENTRE };
    game.foodCentre = { ...FOOD_CENTRE };
    game.extraOxygenChambers = [];
    game.commArray = { ...COMM_ARRAY };
    game.shelters = SHELTER_DEFS.map((s) => ({
      x: s.x, y: s.y, name: s.name, safeR: 88, padR: 124
    }));
    game.shelters.forEach((s) => {
      const g = ctx.createRadialGradient(-34, -66, 6, 0, -46, 122);
      g.addColorStop(0, 'rgba(255,242,220,0.22)');
      g.addColorStop(0.4, 'rgba(255,190,135,0.10)');
      g.addColorStop(0.75, 'rgba(190,130,95,0.06)');
      g.addColorStop(1, 'rgba(120,75,52,0.02)');
      s.glassGrad = g;
    });
    game.dungeons = DUNGEON_CONFIGS.map((cfg) => buildDungeonInstance(cfg));
    // Randomize dungeon entrances each run for more adventure
    game.dungeons.forEach((d) => { d.entrance = randomDungeonEntrance(); });

    // Randomize oxygen/food chambers and add extra oxygen chambers each run (spread out for coverage)
    (function randomizeChambers() {
      const placed = [];
      const blocked = (x, y, pad, minFromPlaced = 520) => {
        if (dist(x, y, LANDER_POS.x, LANDER_POS.y) < 700 + pad) return true;
        if (dist(x, y, COMM_ARRAY.x, COMM_ARRAY.y) < 260 + pad) return true;
        for (const s of game.shelters) if (dist(x, y, s.x, s.y) < 220 + pad) return true;
        for (const d of game.dungeons) if (d.entrance && dist(x, y, d.entrance.x, d.entrance.y) < 300 + pad) return true;
        for (const p of placed) if (dist(x, y, p.x, p.y) < minFromPlaced + pad) return true;
        return x < 450 || y < 450 || x > WORLD.w - 450 || y > WORLD.h - 450;
      };
      const pickInRect = (rx1, ry1, rx2, ry2, pad = 0, minFromPlaced = 520) => {
        for (let i = 0; i < 260; i++) {
          const x = rnd(rx1, rx2), y = rnd(ry1, ry2);
          if (!blocked(x, y, pad, minFromPlaced)) { placed.push({ x, y }); return { x, y }; }
        }
        for (let i = 0; i < 260; i++) {
          const x = rnd(700, WORLD.w - 700), y = rnd(700, WORLD.h - 700);
          if (!blocked(x, y, pad, Math.max(320, minFromPlaced - 120))) { placed.push({ x, y }); return { x, y }; }
        }
        const x = clamp((rx1 + rx2) / 2, 800, WORLD.w - 800), y = clamp((ry1 + ry2) / 2, 800, WORLD.h - 800);
        placed.push({ x, y }); return { x, y };
      };

      // Spread oxygen sources across map so no large region is left without oxygen
      const oxygenZones = [
        [700, 700, WORLD.w * 0.38, WORLD.h * 0.42],                 // NW
        [WORLD.w * 0.62, 700, WORLD.w - 700, WORLD.h * 0.42],       // NE
        [700, WORLD.h * 0.58, WORLD.w * 0.38, WORLD.h - 700],       // SW
        [WORLD.w * 0.62, WORLD.h * 0.58, WORLD.w - 700, WORLD.h - 700], // SE
        [WORLD.w * 0.35, WORLD.h * 0.32, WORLD.w * 0.65, WORLD.h * 0.68] // Center
      ].sort(() => Math.random() - 0.5);
      const scPos = pickInRect(...oxygenZones[0], 40, 480); game.spaceCentre.x = scPos.x; game.spaceCentre.y = scPos.y;
      const fc = pickInRect(rnd(700, WORLD.w * 0.45), rnd(WORLD.h * 0.45, WORLD.h - 700), rnd(WORLD.w * 0.55, WORLD.w - 700), rnd(700, WORLD.h * 0.55), 40, 420);
      game.foodCentre.x = fc.x; game.foodCentre.y = fc.y;
      game.extraOxygenChambers = [1, 2, 3, 4].map((n, i) => {
        const z = oxygenZones[(i + 1) % oxygenZones.length];
        const p = pickInRect(z[0], z[1], z[2], z[3], 30, 420);
        return { x: p.x, y: p.y, name: `OXYGEN CHAMBER ${n}`, r: 60, safeR: 104, refillR: 84, padR: 140 };
      });
    })();

    // Story state and mission objects — create before world generation so rocks/items avoid them
    game.missionIndex = 0;
    game.missionPhase = 'before';
    game.story = {
      // Mission 1
      m1Supplies: 0,
      m1PodInspected: false,
      m1RoverRepaired: false,
      m1Complete: false,
      // Mission 2
      m2OldChamberReached: false,
      // Mission 3
      m3HeatShieldsEquipped: false,
      // Mission 4
      m4Obsidian: 0,
      m4ScannedEngine: false,
      m4ScannedTank: false,
      m4ScannedNose: false,
      m4CommsatParts: 0,
      m4CommsatFixed: false,
      m4VijayContact: false,
      // Mission 5
      m5EngineHauled: false,
      m5HullWelded: false,
      // Mission 6
      m6Fuel1: false, m6Fuel2: false, m6Fuel3: false,
      // Mission 7
      m7ThrustersTested: false,
      // Mission 8
      m8Rocks: 0,
      m8SolarChecked: false,
      m8WaterIceReached: false,
      // Mission 9
      m9DishAligned: false,
      m9SuppliesLoaded: false,
      m9ClampsReleased: 0,
      m9Launched: false
    };
    game.storyObjects = {
      crashPod: { x: LANDER_POS.x, y: LANDER_POS.y, r: 50, inspected: false },
      rover: { x: LANDER_POS.x - 980, y: LANDER_POS.y - 760, r: 32, repaired: false },
      // Mission 2
      oldSupplyChamber: { x: 9300, y: 1835, r: 46, visited: false }, // far north, Jezero region
      // Mission 3/5/7/9
      spacecraft: { x: LANDER_POS.x + 20, y: LANDER_POS.y - 40, r: 44 },
      heatShieldStation: { x: LANDER_POS.x + 180, y: LANDER_POS.y - 120, r: 28, equipped: false },
      // Mission 4 volcano/obsidian/commsat
      volcano: { x: 15600, y: 2447, r: 140 },
      // Mission 4 crashed ships to scan for parts
      crashEngine: { x: 12900, y: 7953, r: 34, scanned: false },
      crashTank: { x: 14700, y: 5506, r: 34, scanned: false },
      crashNose: { x: 10800, y: 10706, r: 34, scanned: false },
      // Mission 4 commsat (repair to contact Captain Vijay)
      m4Commsat: { x: 9800, y: 4200, r: 32, repaired: false },
      // Mission 5
      magneticCrane: { x: LANDER_POS.x - 220, y: LANDER_POS.y - 180, r: 34, used: false },
      weldSpot: { x: LANDER_POS.x - 40, y: LANDER_POS.y - 110, r: 30, done: false },
      // Mission 6 fuel wrecks
      fuelWreck1: { x: 11700, y: 1835, r: 30, siphoned: false },
      fuelWreck2: { x: 2700, y: 11012, r: 30, siphoned: false },
      fuelWreck3: { x: 16200, y: 9482, r: 30, siphoned: false },
      // Mission 7
      thrusterConsole: { x: LANDER_POS.x + 90, y: LANDER_POS.y - 120, r: 26, tested: false },
      // Mission 8
      solarPanel: { x: 7200, y: 2447, r: 30, checked: false },
      waterIceSpot: { x: 2100, y: 2141, r: 34, visited: false },
      // Mission 9
      satelliteDish: { x: 12600, y: 6424, r: 34, aligned: false },
      supplyLoad: { x: LANDER_POS.x - 120, y: LANDER_POS.y + 40, r: 30, loaded: false },
      launchClamp1: { x: LANDER_POS.x - 60, y: LANDER_POS.y - 70, r: 18, released: false },
      launchClamp2: { x: LANDER_POS.x + 60, y: LANDER_POS.y - 70, r: 18, released: false },
      launchClamp3: { x: LANDER_POS.x - 60, y: LANDER_POS.y + 10, r: 18, released: false },
      launchClamp4: { x: LANDER_POS.x + 60, y: LANDER_POS.y + 10, r: 18, released: false }
    };

    // Randomize old settlement / oxygen-food chamber each run (spread for oxygen coverage)
    (function randomizeOldSettlement() {
      const so = game.storyObjects, placed = [game.spaceCentre, game.foodCentre].concat(game.extraOxygenChambers || []);
      const zones = [
        [700, WORLD.h * 0.45, WORLD.w * 0.45, WORLD.h - 700],           // south/west
        [WORLD.w * 0.55, WORLD.h * 0.45, WORLD.w - 700, WORLD.h - 700], // south/east
        [700, 700, WORLD.w * 0.45, WORLD.h * 0.45],                     // north/west
        [WORLD.w * 0.55, 700, WORLD.w - 700, WORLD.h * 0.45]            // north/east
      ].sort(() => Math.random() - 0.5);
      for (const z of zones) {
        for (let i = 0; i < 160; i++) {
          const x = rnd(z[0], z[2]), y = rnd(z[1], z[3]);
          if (dist(x, y, LANDER_POS.x, LANDER_POS.y) < 1200) continue;
          if (dist(x, y, COMM_ARRAY.x, COMM_ARRAY.y) < 260) continue;
          if (game.shelters.some((s) => dist(x, y, s.x, s.y) < 220)) continue;
          if (game.dungeons.some((d) => d.entrance && dist(x, y, d.entrance.x, d.entrance.y) < 280)) continue;
          if (placed.some((p) => p && dist(x, y, p.x, p.y) < 360)) continue;
          so.oldSupplyChamber.x = x; so.oldSupplyChamber.y = y; return;
        }
      }
      for (let i = 0; i < 220; i++) {
        const x = rnd(700, WORLD.w - 700), y = rnd(700, WORLD.h - 700);
        if (dist(x, y, LANDER_POS.x, LANDER_POS.y) < 1000) continue;
        if (placed.some((p) => p && dist(x, y, p.x, p.y) < 300)) continue;
        so.oldSupplyChamber.x = x; so.oldSupplyChamber.y = y; return;
      }
    })();

    game.rocks = makeRocks();
    game.items = [];
    makeItems();
    game._dungeonVisited = false;
    setupMissionWorld(0);
    game.player = makePlayer();
    // Start with low oxygen feel for Mission 1
    game.player.o2 = Math.min(game.player.o2, 45);
    updateCamera(0, true);
    game.motes = makeMotes();
    ensureGround();
    buildWarmQueue(true);
  }

  function isRadSheltered(x, y) {
    if (game.location === 'dungeon') return true;
    if (dist(x, y, game.lander.x, game.lander.y) < game.lander.safeR) return true;
    if (game.spaceCentre && dist(x, y, game.spaceCentre.x, game.spaceCentre.y) < game.spaceCentre.safeR) return true;
    if (game.foodCentre && dist(x, y, game.foodCentre.x, game.foodCentre.y) < game.foodCentre.safeR) return true;
    for (const s of game.shelters) {
      if (dist(x, y, s.x, s.y) < s.safeR) return true;
    }
    return false;
  }

  function isO2Refill(x, y) {
    if (game.location === 'dungeon') return false;
    if (game.spaceCentre && dist(x, y, game.spaceCentre.x, game.spaceCentre.y) < game.spaceCentre.refillR) return true;
    const old = game.storyObjects && game.storyObjects.oldSupplyChamber;
    if (old && dist(x, y, old.x, old.y) < (old.r || 46) + 24) return true; // old settlement oxygen
    for (const oc of (game.extraOxygenChambers || [])) {
      if (dist(x, y, oc.x, oc.y) < (oc.refillR || 84)) return true;
    }
    return false;
  }

  function isFoodRefill(x, y) {
    if (game.location === 'dungeon') {
      const d = game.dungeon;
      return !!(d && d.foodStation && dist(x, y, d.foodStation.x, d.foodStation.y) < d.foodStation.r);
    }
    return !!(game.foodCentre && dist(x, y, game.foodCentre.x, game.foodCentre.y) < game.foodCentre.refillR);
  }

  function isPowerRefill(x, y) {
    if (game.location === 'dungeon') return false;
    if (game.spaceCentre && dist(x, y, game.spaceCentre.x, game.spaceCentre.y) < game.spaceCentre.refillR) return true;
    if (dist(x, y, game.lander.x, game.lander.y) < game.lander.safeR) return true;
    for (const s of game.shelters) if (dist(x, y, s.x, s.y) < s.safeR) return true;
    return false;
  }

  function isWaterRefill(x, y) {
    if (game.location === 'dungeon') {
      const d = game.dungeon;
      return !!(d && d.foodStation && dist(x, y, d.foodStation.x, d.foodStation.y) < d.foodStation.r);
    }
    return !!(game.foodCentre && dist(x, y, game.foodCentre.x, game.foodCentre.y) < game.foodCentre.refillR);
  }

  function isSuitRepair(x, y) {
    if (game.location === 'dungeon') return false;
    if (game.spaceCentre && dist(x, y, game.spaceCentre.x, game.spaceCentre.y) < game.spaceCentre.refillR) return true;
    if (game.foodCentre && dist(x, y, game.foodCentre.x, game.foodCentre.y) < game.foodCentre.refillR) return true;
    for (const s of game.shelters) if (dist(x, y, s.x, s.y) < s.safeR) return true;
    return false;
  }

  // Compatibility alias: "sheltered" in life-support/UI means protected from radiation.
  function isSheltered(x, y) {
    return isRadSheltered(x, y);
  }

  function burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = rnd(0, TAU);
      const s = rnd(speed * 0.25, speed);
      game.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 12,
        life: rnd(0.4, 0.95),
        maxLife: 1,
        size: rnd(1.4, 3.4),
        color,
        gravity: 26
      });
      game.particles[game.particles.length - 1].maxLife = game.particles[game.particles.length - 1].life;
    }
  }

  function puff(x, y) {
    game.particles.push({
      x: x + rnd(-4, 4),
      y: y + rnd(-2, 2),
      vx: rnd(-14, 14),
      vy: rnd(-18, -5),
      life: rnd(0.35, 0.7),
      maxLife: 0.7,
      size: rnd(2, 4.5),
      color: 'rgba(220,170,130,0.45)',
      gravity: -5
    });
  }

  // Mission helpers
  function currentMission() { return MISSIONS[game.missionIndex || 0] || null; }
  function showMissionBriefing(kind = 'before') {
    const m = currentMission();
    if (!m) return;
    game.missionPhase = kind;
    const ch = CHAPTERS.find(c => c.id === m.chapter) || CHAPTERS[0];
    dom.missionPanelKicker.textContent = `Chapter ${ch.id}: ${ch.title} · ${kind === 'after' ? 'Complete' : 'Briefing'}`;
    dom.missionPanelTitle.textContent = m.name;
    if (kind === 'before') {
      dom.missionPanelText.textContent = m.before;
      dom.missionPanelObjective.innerHTML = `<b>YOUR OBJECTIVE:</b> ${m.objective}`;
      dom.missionPanelBtn.textContent = `Begin: ${m.name}`;
    } else {
      dom.missionPanelText.textContent = `${m.after}\n\n${m.accomplished}`;
      const next = MISSIONS[game.missionIndex + 1];
      dom.missionPanelObjective.innerHTML = next ? `<b>Next:</b> ${next.name}` : `<b>Final:</b> Pico escapes Mars.`;
      dom.missionPanelBtn.textContent = next ? `Continue` : 'See Ending';
    }
    dom.missionPanelHint.innerHTML = 'Press <kbd>Enter</kbd> or click to continue';
    dom.screen.classList.remove('hidden');
    dom.startPanel.classList.add('hidden');
    dom.endPanel.classList.add('hidden');
    dom.missionPanel.classList.remove('hidden');
    dom.pause.classList.add('hidden');
  }
  function hideMissionPanel() { dom.missionPanel.classList.add('hidden'); }
  function startMissionBriefing() { if (game.player) showMissionBriefing('before'); }
  function onMissionPanelContinue() {
    const m = currentMission();
    if (!m) return;
    if (game.missionPhase === 'before') {
      game.missionPhase = 'active';
      state = 'playing';
      hideMissionPanel();
      dom.screen.classList.add('hidden');
      Sound.wind(true);
      lastFrame = performance.now();
      toast(`${m.name}`, 'gold', 3500);
      if (m.id === 1) toast('Oxygen is low. Stay close to the ship.', 'danger', 4200);
    } else if (game.missionPhase === 'after') {
      if ((game.missionIndex || 0) >= MISSIONS.length - 1) {
        hideMissionPanel();
        endGame('won', 'ESCAPE COMPLETE',
          `Pico completes the launch sequence and escapes Mars.\n\nAgainst low oxygen, limited supplies, and the harsh Martian frontier, he found what he needed, rebuilt a way home, and launched to safety.\n\nTHE END.`);
        return;
      }
      game.missionIndex = (game.missionIndex || 0) + 1;
      setupMissionWorld(game.missionIndex);
      state = 'briefing';
      showMissionBriefing('before');
    }
  }
  function showMissionSuccessImage(m) {
    // Show mission completion image popup
    if (!m || !dom.missionSuccessPopup) { showMissionBriefing('after'); return; }
    let src = null, kicker = `CHAPTER ${m.chapter} · ${m.accomplished || 'MISSION COMPLETE'}`, text = '';
    if (m.id === 1) {
      src = 'Level 4.jpeg';
      text = 'Emergency ration secured, pod inspected, and rover repaired. Mission 1 complete.';
    } else if (m.id === 4) {
      src = 'Mission-4.jpeg';
      text = 'Commsat repaired. Communication restored with Captain Vijay.';
    } else if (m.id === 6) {
      src = 'Level7.jpeg';
      text = 'Fuel secured from all wrecked ships. Mission 6 complete.';
    } else if (m.id === 8) {
      src = 'Mission 8.jpeg';
      text = 'Rock samples collected, solar panels checked, and water ice reached. Mission 8 complete.';
    } else if (m.id === 9) {
      src = 'Mission 9.jpeg';
      text = 'Launch sequence complete. Pico is heading home to Earth.';
    }
    if (!src) { showMissionBriefing('after'); return; }
    state = 'briefing';
    game.missionPhase = 'successImage';
    if (dom.screen) dom.screen.classList.add('hidden');
    hideMissionPanel();
    if (dom.missionSuccessKicker) dom.missionSuccessKicker.textContent = kicker;
    if (dom.missionSuccessText) dom.missionSuccessText.textContent = text;
    if (dom.missionSuccessImage) { dom.missionSuccessImage.src = src; dom.missionSuccessImage.alt = kicker; }
    dom.missionSuccessPopup.classList.remove('hidden');
    Sound.wind(false);
  }
  function onMissionSuccessContinue() {
    if (dom.missionSuccessPopup) dom.missionSuccessPopup.classList.add('hidden');
    if (game.missionPhase === 'successImage') {
      const m = currentMission();
      const isFinalLaunch = (m && m.id === 9) || ((game.missionIndex || 0) >= MISSIONS.length - 1);
      if (isFinalLaunch) {
        hideMissionPanel();
        if (dom.screen) dom.screen.classList.remove('hidden');
        if (state !== 'won' && state !== 'dead') {
          endGame('won', 'LAUNCH COMPLETE',
            `Pico completes the launch sequence and escapes Mars.\n\nSatellite dish aligned. Supplies loaded. Launch clamps released.\nThe rocket lifts off into the Martian sky, heading home to Earth.\n\nTHE END.`);
        } else if (state === 'won' && dom.endPanel) {
          dom.endPanel.classList.add('win-credits');
          dom.endPanel.classList.remove('hidden');
        }
        return;
      }
      game.missionPhase = 'after';
      onMissionPanelContinue();
    }
  }

  function missionCompleteCheck() {
    if (!game.player || game.missionPhase !== 'active') return;
    const m = currentMission();
    if (!m) return;
    const s = game.story || {};
    let done = false;
    switch (m.id) {
      case 1:
        done = (s.m1Supplies || 0) >= 1 && !!s.m1PodInspected && !!s.m1RoverRepaired;
        if (done) s.m1Complete = true;
        break;
      case 2: done = !!s.m2OldChamberReached; break;
      case 3: done = !!s.m3HeatShieldsEquipped; break;
      case 4: done = (s.m4Obsidian || 0) >= 3 && !!s.m4ScannedEngine && !!s.m4ScannedTank && !!s.m4ScannedNose && !!s.m4CommsatFixed; break;
      case 5: done = !!s.m5EngineHauled && !!s.m5HullWelded; break;
      case 6: done = !!s.m6Fuel1 && !!s.m6Fuel2 && !!s.m6Fuel3; break;
      case 7: done = !!s.m7ThrustersTested; break;
      case 8: done = (s.m8Rocks || 0) >= 3 && !!s.m8SolarChecked && !!s.m8WaterIceReached; break;
      case 9: {
        const so = game.storyObjects || {};
        const clampsReleased = [so.launchClamp1, so.launchClamp2, so.launchClamp3, so.launchClamp4].filter(c => c && c.released).length;
        s.m9ClampsReleased = clampsReleased;
        done = !!s.m9DishAligned && !!s.m9SuppliesLoaded && clampsReleased >= 4;
        break;
      }
    }
    if (done) {
      game.missionPhase = 'completing';
      Sound.cell();
      burst(game.player.x, game.player.y, '#8dffb0', 40, 160);
      setTimeout(() => {
        if (m.id === 9) {
          s.m9Launched = true;
          showMissionSuccessImage(m);
        } else if (m.id === 1 || m.id === 4 || m.id === 6 || m.id === 8) {
          showMissionSuccessImage(m);
        } else {
          showMissionBriefing('after');
        }
      }, 900);
    }
  }
  function setupMissionWorld(index) {
    const m = MISSIONS[index] || MISSIONS[0];
    const s = game.story || (game.story = {});
    const so = game.storyObjects || (game.storyObjects = {});
    // Clean mission-tagged items by mission
    game.items = (game.items || []).filter(it => !/^m\d+/.test(it.storyTag || ''));

    if (m.id === 1) {
      s.m1Supplies = 0; s.m1PodInspected = false; s.m1RoverRepaired = false; s.m1Complete = false;
      if (so.rover) { so.rover.repaired = false; so.rover.x = LANDER_POS.x - 980; so.rover.y = LANDER_POS.y - 760; }
      if (so.crashPod) so.crashPod.inspected = false;
      // One emergency ration crate scattered in the crash debris field
      const supplyPts = [
        { x: LANDER_POS.x - 1050, y: LANDER_POS.y + 420 } // emergency food crate flung from the crash
      ];
      supplyPts.forEach((p, i) => game.items.push({ type: 'repair', x: p.x, y: p.y, r: 13, taken: false, phase: rnd(0, TAU), storyTag: 'm1supply', label: 'Emergency Ration Crate' }));
    }
    if (m.id === 2) {
      s.m2OldChamberReached = false;
      if (so.oldSupplyChamber) so.oldSupplyChamber.visited = false;
    }
    if (m.id === 3) {
      s.m3HeatShieldsEquipped = false;
      if (so.heatShieldStation) so.heatShieldStation.equipped = false;
    }
    if (m.id === 4) {
      s.m4Obsidian = 0; s.m4ScannedEngine = false; s.m4ScannedTank = false; s.m4ScannedNose = false;
      s.m4CommsatParts = 0; s.m4CommsatFixed = false; s.m4VijayContact = false;
      if (so.crashEngine) so.crashEngine.scanned = false;
      if (so.crashTank) so.crashTank.scanned = false;
      if (so.crashNose) so.crashNose.scanned = false;
      if (so.m4Commsat) so.m4Commsat.repaired = false;
      const obs = [
        { x: 15150, y: 2141 }, { x: 16050, y: 2600 }, { x: 15525, y: 3212 }
      ];
      obs.forEach((p, i) => game.items.push({ type: 'sample', sampleId: 'obs_' + i, x: p.x, y: p.y, r: 13, taken: false, phase: rnd(0, TAU), storyTag: 'm4obs', label: 'Obsidian Shard' }));
      // Commsat components to repair commsat and contact Captain Vijay
      const commsParts = [
        { x: 9200, y: 3800, label: 'Commsat Antenna Module' },
        { x: 10400, y: 4600, label: 'Commsat Signal Chip' },
        { x: 9400, y: 5000, label: 'Commsat Power Coupler' }
      ];
      commsParts.forEach((p, i) => game.items.push({ type: 'part', partId: 'm4comms_' + i, x: p.x, y: p.y, r: 14, taken: false, phase: rnd(0, TAU), storyTag: 'm4comms', label: p.label }));
    }
    if (m.id === 5) {
      s.m5EngineHauled = false; s.m5HullWelded = false;
      if (so.magneticCrane) so.magneticCrane.used = false;
      if (so.weldSpot) so.weldSpot.done = false;
    }
    if (m.id === 6) {
      s.m6Fuel1 = false; s.m6Fuel2 = false; s.m6Fuel3 = false;
      if (so.fuelWreck1) so.fuelWreck1.siphoned = false;
      if (so.fuelWreck2) so.fuelWreck2.siphoned = false;
      if (so.fuelWreck3) so.fuelWreck3.siphoned = false;
    }
    if (m.id === 7) {
      s.m7ThrustersTested = false;
      if (so.thrusterConsole) so.thrusterConsole.tested = false;
    }
    if (m.id === 8) {
      s.m8Rocks = 0; s.m8SolarChecked = false; s.m8WaterIceReached = false;
      if (so.solarPanel) so.solarPanel.checked = false;
      if (so.waterIceSpot) so.waterIceSpot.visited = false;
      const rocks = [{ x: 2400, y: 5506 }, { x: 10500, y: 8565 }, { x: 15900, y: 4588 }];
      rocks.forEach((p, i) => game.items.push({ type: 'sample', sampleId: 'm8rock_' + i, x: p.x, y: p.y, r: 13, taken: false, phase: rnd(0, TAU), storyTag: 'm8rock', label: 'Rock Sample' }));
    }
    if (m.id === 9) {
      s.m9DishAligned = false; s.m9SuppliesLoaded = false; s.m9ClampsReleased = 0; s.m9Launched = false;
      if (so.satelliteDish) so.satelliteDish.aligned = false;
      if (so.supplyLoad) so.supplyLoad.loaded = false;
      ['launchClamp1','launchClamp2','launchClamp3','launchClamp4'].forEach(k => { if (so[k]) so[k].released = false; });
    }
    // Keep boundary behavior: mission 1 restricted near lander
    updateHud();
  }

  // =========================================================================
  // Simulation
  // =========================================================================
  function update(dt) {
    const p = game.player;
    game.time += dt;
    const dev = window.RedDust && window.RedDust.dev;
    if (dev && dev._god) {
      p.o2 = p.maxO2;
      p.food = 100;
      p.power = p.maxPower;
      p.water = 100;
      p.suit = p.maxSuit;
      p.rad = 0;
      p.starving = false;
      p.starveTimer = 0;
      p.dehydrateTimer = 0;
      p.powerTimer = 0;
    }

    // Opening guidance
    if (!game.flags.tip1 && game.missionPhase === 'active' && game.missionIndex === 0 && game.time > 0.8) {
      game.flags.tip1 = true;
      toast('Oxygen is low. Stay within the crash site: find the emergency ration, inspect the pod, and repair the rover.', 'danger', 5500);
    }
    if (!game.flags.tip2 && game.missionPhase === 'active' && game.time > 5.0) {
      game.flags.tip2 = true;
      toast('Monitor oxygen, power, water, food, radiation, and suit integrity. The yellow arrow points to your objective.', '', 5200);
    }

    // Movement intent (screen space). Third-person controls are camera-relative,
    // so the stick direction is converted into the current camera basis.
    let ix = 0;
    let iy = 0;
    if (keys.w || keys.arrowup) iy -= 1;
    if (keys.s) iy += 1;
    if (keys.a) ix -= 1;
    if (keys.d) ix += 1;
    if (keys.arrowleft) ix -= 1;
    if (keys.arrowright) ix += 1;
    let mag = Math.hypot(ix, iy);
    if (mag > 1) {
      ix /= mag;
      iy /= mag;
      mag = 1;
    }
    const wantsMove = mag > 0.08;
    const sprinting = wantsMove && !!keys.shift && p.o2 > 0 && !p.starving;
    p.moving = wantsMove;

    if (wantsMove) {
      let wx, wy;
      if (game.location === 'dungeon') {
        // In interiors, movement is world-axis aligned for clarity.
        wx = ix;
        wy = iy;
      } else {
        // Camera-relative movement: W walks into the screen, A/D strafe, and
        // the kid turns to face whichever way the stick pushes.
        const forwardAmt = -iy;
        const sideAmt = ix;
        wx = CAM.fx * forwardAmt + CAM.rx * sideAmt;
        wy = CAM.fy * forwardAmt + CAM.ry * sideAmt;
      }
      const wmag = Math.hypot(wx, wy) || 1;
      const speed = p.speed * (sprinting ? 1.55 : 1) * (p.starving ? 0.8 : 1);
      const nx = p.x + (wx / wmag) * speed * dt;
      const ny = p.y + (wy / wmag) * speed * dt;
      game.stats.distance += Math.hypot(nx - p.x, ny - p.y);
      p.x = nx;
      p.y = ny;
      p.face.x = wx / wmag;
      p.face.y = wy / wmag;
      p.walk += speed * dt * 0.052;
      p.stepT -= dt;
      if (p.stepT <= 0) {
        p.stepT = sprinting ? 0.1 : 0.17;
        if (game.location === 'outdoor') {
          puff(p.x, p.y + 13);
          if (game.footprints) {
            game.footprints.push({ x: p.x + rnd(-3,3), y: p.y + 10 + rnd(-2,2), a: Math.atan2(p.face.y, p.face.x), life: rnd(8, 14), maxLife: 14, s: rnd(0.7, 1.1) });
            if (game.footprints.length > 120) game.footprints.splice(0, game.footprints.length - 120);
          }
        }
      }
    } else {
      p.stepT = 0;
    }

    resolveCollisions(p);
    // Mission 1 boundary: wide crash debris field (stay near ship, but search the area)
    if (game.location === 'outdoor' && game.missionIndex === 0 && !(game.story && game.story.m1Complete)) {
      const dx = p.x - LANDER_POS.x;
      const dy = p.y - LANDER_POS.y;
      const maxR = 1500;
      const d = Math.hypot(dx, dy);
      if (d > maxR && d > 0.001) {
        p.x = LANDER_POS.x + (dx / d) * maxR;
        p.y = LANDER_POS.y + (dy / d) * maxR;
        if (!game.flags.m1BoundaryWarn || game.time - game.flags.m1BoundaryWarn > 3) {
          game.flags.m1BoundaryWarn = game.time;
          toast('Oxygen is low — stay within the crash debris field for now.', 'danger', 2400);
        }
      }
    }

    if (Sound && Sound.syncDungeonMove) Sound.syncDungeonMove(game.location === 'dungeon' && !!p.moving);

    // Suit life support: O₂, food, power, water, radiation, and suit integrity.
    const sheltered = isRadSheltered(p.x, p.y);
    const stationO2Refill = isO2Refill(p.x, p.y); // oxygen stations (e.g. old settlement/oxygen chamber, Ares Space Centre)
    const nearRocket = game.location === 'outdoor' && !!game.lander && dist(p.x, p.y, game.lander.x, game.lander.y) < (game.lander.safeR || 106);
    const rocketO2Available = !((game.story && game.story.m2OldChamberReached) || (game.missionIndex || 0) >= 2); // till level/mission 2, until old oxygen-food supply found
    const rocketO2Cap = 70;
    const rocketCanRefill = nearRocket && rocketO2Available && p.o2 < rocketO2Cap - 0.5;
    const rocketO2Denied = nearRocket && !rocketO2Available && p.o2 < p.maxO2 - 1;
    const o2Refill = stationO2Refill || rocketCanRefill;
    const foodRefill = isFoodRefill(p.x, p.y);
    const powerRefill = isPowerRefill(p.x, p.y);
    const waterRefill = isWaterRefill(p.x, p.y);
    const suitRepair = isSuitRepair(p.x, p.y);

    if (stationO2Refill && !game.stationO2Refill && p.o2 < p.maxO2 - 1) toast('Oxygen refilling.', 'good', 2200);
    if (rocketCanRefill && !game.rocketO2Refill) toast('Rocket oxygen refilling (limited to 70%).', 'good', 2600);
    if (rocketO2Denied) {
      game._rocketO2DeniedT = (game._rocketO2DeniedT || 0) - dt;
      if (game._rocketO2DeniedT <= 0) {
        toast("Rocket oxygen supply cut. Please find an old settlement or oxygen chamber to refill.", 'danger', 5200);
        game._rocketO2DeniedT = 8;
      }
    } else {
      game._rocketO2DeniedT = 0;
    }

    if (foodRefill && !game.foodRefill && p.food < 99) toast('Food refilling.', 'good', 2200);
    if (powerRefill && !game.powerRefill && p.power < p.maxPower - 1) toast('Power charging.', 'good', 2200);
    if (waterRefill && !game.waterRefill && p.water < 99) toast('Water supply refilling.', 'good', 2200);
    if (suitRepair && p.suit < p.maxSuit - 1) game._suitRepairToastT = (game._suitRepairToastT || 0) + dt;
    else game._suitRepairToastT = 0;
    if (game._suitRepairToastT > 1.2) { toast('Suit integrity being repaired.', 'good', 2200); game._suitRepairToastT = -6; }
    game.sheltered = sheltered;
    game.o2Refill = o2Refill;
    game.stationO2Refill = stationO2Refill;
    game.rocketO2Refill = rocketCanRefill;
    game.foodRefill = foodRefill;
    game.powerRefill = powerRefill;
    game.waterRefill = waterRefill;

    let o2Rate = -RATES.o2;
    if (sprinting) o2Rate -= RATES.o2Sprint;
    if (p.starving) o2Rate *= RATES.o2Starve;
    if (p.suit < 35) o2Rate -= 0.25;
    if (stationO2Refill) {
      o2Rate = RATES.o2Refill;
      p.o2 = clamp(p.o2 + o2Rate * dt, 0, p.maxO2);
    } else if (rocketCanRefill) {
      o2Rate = RATES.o2Refill;
      p.o2 = clamp(p.o2 + o2Rate * dt, 0, rocketO2Cap);
    } else {
      p.o2 = clamp(p.o2 + o2Rate * dt, 0, p.maxO2);
    }

    let foodRate = -RATES.food;
    if (foodRefill) foodRate = RATES.foodRefill;
    p.food = clamp(p.food + foodRate * dt, 0, 100);
    if (p.food <= 0) {
      if (!p.starving) {
        p.starving = true;
        toast('You are starving. Find food.', 'danger', 4500);
        Sound.warn();
      }
      p.starveTimer += dt;
    } else {
      p.starving = false;
      p.starveTimer = 0;
    }

    let powerRate = -RATES.power;
    if (sprinting) powerRate -= RATES.powerSprint;
    if (powerRefill) powerRate = RATES.powerRefill;
    if (p.suit < 25) powerRate -= 0.15;
    p.power = clamp(p.power + powerRate * dt, 0, p.maxPower);
    if (p.power <= 0) p.powerTimer += dt; else p.powerTimer = 0;

    let waterRate = -RATES.water;
    if (sprinting) waterRate -= 0.06;
    if (waterRefill) waterRate = RATES.waterRefill;
    p.water = clamp(p.water + waterRate * dt, 0, 100);
    if (p.water <= 0) p.dehydrateTimer += dt; else p.dehydrateTimer = 0;

    const flareActive = game.flare.phase === 'active';
    if (sheltered) {
      p.rad = Math.max(0, p.rad - RATES.radShelter * dt);
      p.suit = clamp(p.suit + RATES.suitRepair * 0.15 * dt, 0, p.maxSuit);
    } else {
      const zoneRad = zoneAt(p.x, p.y).rad;
      // During active solar flare, radiation rises at 5 points per second when exposed
      const base = flareActive ? 5 : zoneRad;
      const suitFactor = 0.7 + (1 - p.suit / p.maxSuit) * 0.8;
      p.rad += base * p.radResist * suitFactor * dt;
      let wear = zoneRad * RATES.suitWearRad * dt;
      if (flareActive) wear += RATES.suitWearFlare * dt * (base / Math.max(1, RATES.radFlare));
      p.suit = clamp(p.suit - wear, 0, p.maxSuit);
    }
    if (suitRepair) p.suit = clamp(p.suit + RATES.suitRepair * dt, 0, p.maxSuit);
    p.rad = clamp(p.rad, 0, 100);
    game.stats.peakRad = Math.max(game.stats.peakRad, p.rad);

    collectItems();
    if (game.location === 'outdoor') collectLogs();
    updateQuest();
    if (game.location === 'outdoor') updateRegion(dt);
    if (game.location === 'outdoor') updateFlare(dt);
    updateWarnings(dt);
    updateParticles(dt);
    updateInteractions();
    game.hudTimer += dt;
    if (game.hudTimer >= 0.08) {
      game.hudTimer = 0;
      updateHud();
    }
    missionCompleteCheck();

    // No legacy mission-specific timers in the new mission plan.

    // End conditions
    if (p.o2 <= 0) {
      endGame('dead', 'OUT OF AIR',
        'Your suit’s last breath curls into the dust. Mars keeps its silence.');
      return;
    }
    if (p.rad >= 100) {
      endGame('dead', 'THE SKY BURNED',
        'Radiation overwhelms your suit. The dust settles over your tracks.');
      return;
    }
    if (p.starveTimer >= RATES.starveDeath) {
      endGame('dead', 'TOO SLOW',
        'Hunger made you slow, and Mars is not patient. The cold moves in.');
      return;
    }
    if (p.dehydrateTimer >= RATES.dehydrateDeath) {
      endGame('dead', 'DEHYDRATED',
        'Without water, the mission ends in silence. Mars keeps what it takes.');
      return;
    }
    if (p.powerTimer >= RATES.powerDeath) {
      endGame('dead', 'POWER FAILURE',
        'Your suit systems go dark. On Mars, darkness is final.');
      return;
    }
    if (p.suit <= 0) {
      endGame('dead', 'SUIT BREACH',
        'Suit integrity collapsed. The environment rushes in.');
      return;
    }
  }

  function resolveRectCollision(p, r) {
    const nx = clamp(p.x, r.x, r.x + r.w);
    const ny = clamp(p.y, r.y, r.y + r.h);
    const dx = p.x - nx;
    const dy = p.y - ny;
    const d2 = dx * dx + dy * dy;
    const rad = p.r;
    if (d2 < rad * rad) {
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        p.x = nx + (dx / d) * rad;
        p.y = ny + (dy / d) * rad;
      } else {
        // Centre inside rect: push out along smallest axis.
        const left = p.x - r.x;
        const right = r.x + r.w - p.x;
        const top = p.y - r.y;
        const bottom = r.y + r.h - p.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) p.x = r.x - rad;
        else if (m === right) p.x = r.x + r.w + rad;
        else if (m === top) p.y = r.y - rad;
        else p.y = r.y + r.h + rad;
      }
    }
  }

  function resolveCollisions(p) {
    if (window.RedDust && window.RedDust.dev && window.RedDust.dev._noclip) {
      if (game.location === 'outdoor') {
        p.x = clamp(p.x, 20, WORLD.w - 20);
        p.y = clamp(p.y, 20, WORLD.h - 20);
      } else if (game.location === 'dungeon' && game.dungeon) {
        p.x = clamp(p.x, p.r + 2, game.dungeon.interior.w - p.r - 2);
        p.y = clamp(p.y, p.r + 2, game.dungeon.interior.h - p.r - 2);
      }
      return;
    }
    if (game.location === 'dungeon' && game.dungeon) {
      const d = game.dungeon;
      p.x = clamp(p.x, p.r + 8, d.interior.w - p.r - 8);
      p.y = clamp(p.y, p.r + 8, d.interior.h - p.r - 8);
      for (const w of d.walls) resolveRectCollision(p, w);
      p.x = clamp(p.x, p.r + 8, d.interior.w - p.r - 8);
      p.y = clamp(p.y, p.r + 8, d.interior.h - p.r - 8);
      return;
    }

    for (const r of game.rocks) {
      const dx = p.x - r.x;
      const dy = p.y - r.y;
      const min = r.r * 0.74 + p.r * 0.62;
      const d = Math.hypot(dx, dy);
      if (d < min && d > 0.001) {
        p.x = r.x + (dx / d) * min;
        p.y = r.y + (dy / d) * min;
      }
    }
    const L = game.lander;
    const ldx = p.x - L.x;
    const ldy = p.y - L.y;
    const lmin = L.r + p.r * 0.7;
    const ld = Math.hypot(ldx, ldy);
    if (ld < lmin && ld > 0.001) {
      p.x = L.x + (ldx / ld) * lmin;
      p.y = L.y + (ldy / ld) * lmin;
    }
    // Collide with centres, extra oxygen chambers, and comm array
    for (const c of [game.spaceCentre, game.foodCentre, game.commArray].concat(game.extraOxygenChambers || [])) {
      if (!c) continue;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const min = c.r + p.r * 0.7;
      const d = Math.hypot(dx, dy);
      if (d < min && d > 0.001) {
        p.x = c.x + (dx / d) * min;
        p.y = c.y + (dy / d) * min;
      }
    }
    p.x = clamp(p.x, 42, WORLD.w - 42);
    p.y = clamp(p.y, 42, WORLD.h - 42);
  }

  function collectItems() {
    const p = game.player;
    const list = game.location === 'dungeon' && game.dungeon ? game.dungeon.items : game.items;
    for (const it of list) {
      if (it.taken) continue;
      if (dist(p.x, p.y, it.x, it.y) > p.r + it.r + 8) continue;
      if (it.type === 'rad' && p.rad < 3) continue;

      it.taken = true;
      game.stats.pickups++;
      const def = ITEM_DEF[it.type] || { color: '#fff', glow: 'rgba(255,255,255,0.2)', label: 'ITEM' };
      const big = ['relay','amp','tank','lining','boots','sample','knowledge','part'].includes(it.type);
      burst(it.x, it.y, def.color, big ? 24 : 12, big ? 140 : 85);

      if (it.type === 'rad') {
        p.rad = clamp(p.rad - 35, 0, 100);
        toast('Radiation flushed', 'good', 1900);
        Sound.pickup();
      } else if (it.type === 'tank') {
        p.upgrades.tank++;
        p.maxO2 += 25;
        p.o2 = clamp(p.o2 + 30, 0, p.maxO2);
        game.stats.upgrades++;
        toast('Suit upgrade — O₂ tank +25 capacity', 'good', 4600);
        Sound.cell();
      } else if (it.type === 'lining') {
        p.upgrades.lining++;
        p.radResist *= 0.72;
        game.stats.upgrades++;
        toast('Suit upgrade — radiation lining', 'good', 4600);
        Sound.cell();
      } else if (it.type === 'boots') {
        p.upgrades.boots++;
        p.speed *= 1.12;
        game.stats.upgrades++;
        toast('Suit upgrade — servo boots', 'good', 4600);
        Sound.cell();
      } else if (it.type === 'sample' && it.sampleId && !game.side.sampleIds[it.sampleId]) {
        game.side.sampleIds[it.sampleId] = true;
        game.side.samples++;
        if (it.storyTag === 'm4obs') {
          game.story.m4Obsidian = (game.story.m4Obsidian || 0) + 1;
          toast(`Obsidian shard collected (${game.story.m4Obsidian}/3)`, 'gold', 3400);
        } else if (it.storyTag === 'm8rock') {
          game.story.m8Rocks = (game.story.m8Rocks || 0) + 1;
          toast(`Rock sample collected (${game.story.m8Rocks}/3)`, 'gold', 3400);
        } else {
          if (game.quest.rocksCollected < game.quest.rocksRequired) game.quest.rocksCollected++;
          const info = SAMPLE_DEFS.find((s) => s.id === it.sampleId);
          toast(`Mars sample collected: ${info ? info.name : (it.label || 'Sample')}`, 'gold', 3600);
        }
        Sound.pickup();
      } else if (it.type === 'water') {
        if (game.quest.waterFound < game.quest.waterRequired) game.quest.waterFound++;
        p.water = clamp(p.water + 45, 0, 100);
        toast('Water collected', 'good', 2600);
        Sound.pickup();
      } else if (it.type === 'power') {
        p.power = clamp(p.power + 40, 0, p.maxPower);
        toast('Power cell collected', 'good', 2200);
        Sound.pickup();
      } else if (it.type === 'repair') {
        if (it.storyTag === 'm1supply') {
          game.story.m1Supplies = (game.story.m1Supplies || 0) + 1;
          // Temporary emergency ration: boosts food now
          p.food = clamp(p.food + 35, 0, 100);
          toast('Emergency ration collected — temporary food boost secured.', 'gold', 3200);
        } else {
          p.suit = clamp(p.suit + 35, 0, p.maxSuit);
          toast('Suit repaired with field kit', 'good', 2600);
        }
        Sound.pickup();
      } else if (it.type === 'knowledge' && it.knowledgeId && !game.side.knowledgeIds[it.knowledgeId]) {
        game.side.knowledgeIds[it.knowledgeId] = true;
        game.side.knowledge++;
        const info = KNOWLEDGE_DEFS.find((k) => k.id === it.knowledgeId);
        toast(`Mars knowledge found: ${info ? info.title : 'Data'} (${game.side.knowledge}/${KNOWLEDGE_DEFS.length})`, 'good', 4200);
        Sound.pickup();
      } else if (it.type === 'part' && it.partId && !game.side.partIds[it.partId]) {
        game.side.partIds[it.partId] = true;
        game.side.parts++;
        if (it.storyTag === 'm4comms') {
          game.story.m4CommsatParts = (game.story.m4CommsatParts || 0) + 1;
          toast(`${it.label || 'Commsat component'} found (${game.story.m4CommsatParts}/3)`, 'gold', 3600);
        } else if (it.storyTag === 'm8part') {
          game.story.spacecraftParts = (game.story.spacecraftParts || 0) + 1;
          toast(`Spacecraft component recovered (${game.story.spacecraftParts}/3)`, 'gold', 4200);
        } else {
          const info = PART_DEFS.find((k) => k.id === it.partId);
          toast(`Component recovered: ${info ? info.name : 'Part'}`, 'gold', 3600);
        }
        Sound.cell();
      } else if (it.type === 'relay') {
        p.relays++;
        game.stats.relays = p.relays;
        toast('Relay module recovered', 'gold', 3000);
        Sound.cell();
      } else if (it.type === 'amp') {
        game.quest.amplifier = true;
        toast('Signal amplifier recovered.', 'gold', 3200);
        Sound.cell();
      }

      // Dungeons can still be explored, but no mission requires them in the new plan.
      updateHud();
    }
  }

  function collectLogs() {
    const p = game.player;
    for (const l of game.logs) {
      if (l.taken) continue;
      if (dist(p.x, p.y, l.x, l.y) > p.r + 18) continue;
      l.taken = true;
      game.stats.logs++;
      burst(l.x, l.y, '#9defff', 18, 100);
      toast(`Field log recovered (${game.stats.logs}/${game.logs.length}) — press J to read it.`, 'good', 4800);
      Sound.pickup();
      updateJournalButton();
    }
  }

  function enterDungeon(id) {
    if (game.location !== 'outdoor') return;
    const d = game.dungeons.find((x) => x.id === id);
    if (!d) return;
    game.outdoorPos = { x: game.player.x, y: game.player.y };
    game.location = 'dungeon';
    game.dungeonId = id;
    game.dungeon = d;
    game.player.x = d.interior.spawn.x;
    game.player.y = d.interior.spawn.y;
    game.nearAction = '';
    game.flare.phase = 'idle'; // interiors are shielded
    if (Sound && Sound.enterCave) Sound.enterCave();
    toast(`Entered ${d.name}. Use your lantern to explore the dark maze.`, '', 4200);
  }

  function exitDungeon() {
    if (game.location !== 'dungeon') return;
    game.location = 'outdoor';
    if (game.outdoorPos) {
      game.player.x = game.outdoorPos.x;
      game.player.y = game.outdoorPos.y;
    }
    game.outdoorPos = null;
    game.dungeon = null;
    game.dungeonId = null;
    game.nearAction = '';
    if (Sound && Sound.exitCave) Sound.exitCave();
    toast('Back on the surface.', '', 2200);
  }


  function doInteract() {
    if (state !== 'playing') return;
    const a = game.nearAction;
    if (!a) return;
    const s = game.story || {};
    const so = game.storyObjects || {};
    const p = game.player;

    if (a && a.indexOf('info:') === 0) {
      const key = a.slice(5);
      if (key.indexOf('rover:') === 0) {
        const id = key.slice(6);
        const site = ROVER_SITES.find(r => r.id === id);
        if (site) openMissionInfo(site);
      }
      return;
    }

    const ok = (msg, color = 'good', snd = 'cell') => {
      if (msg) toast(msg, color, 4200);
      if (snd && Sound[snd]) Sound[snd]();
      updateHud();
    };

    // Mission 1
    if (a === 'story:inspectPod') {
      if (so.crashPod && !s.m1PodInspected) {
        s.m1PodInspected = true; so.crashPod.inspected = true;
        burst(so.crashPod.x, so.crashPod.y, '#ffd36e', 28, 140);
        ok('Pod inspected. Systems are damaged, but salvageable.');
      } return;
    }
    if (a === 'story:repairRover') {
      if (so.rover && !s.m1RoverRepaired) {
        s.m1RoverRepaired = true; so.rover.repaired = true;
        burst(so.rover.x, so.rover.y, '#7ef0ff', 32, 150);
        ok('Rover repaired. You can now travel farther.', 'gold');
      } return;
    }

    // Mission 2
    if (a === 'story:oldSupplyChamber') {
      if (so.oldSupplyChamber && !s.m2OldChamberReached) {
        s.m2OldChamberReached = true; so.oldSupplyChamber.visited = true;
        p.o2 = clamp(p.o2 + 40, 0, p.maxO2);
        p.food = clamp(p.food + 45, 0, 100);
        p.water = clamp(p.water + 35, 0, 100);
        burst(so.oldSupplyChamber.x, so.oldSupplyChamber.y, '#9dffb4', 40, 160);
        ok('Oxygen and food chamber found. Supplies secured.');
      } return;
    }

    // Mission 3
    if (a === 'story:equipHeatShields') {
      if (so.heatShieldStation && !s.m3HeatShieldsEquipped) {
        s.m3HeatShieldsEquipped = true; so.heatShieldStation.equipped = true;
        burst(so.heatShieldStation.x, so.heatShieldStation.y, '#ffb36e', 35, 150);
        ok('Heat shields equipped for the rocket.', 'gold');
      } return;
    }

    // Mission 4
    if (a === 'story:scanEngine') { if (so.crashEngine && !s.m4ScannedEngine) { s.m4ScannedEngine = true; so.crashEngine.scanned = true; burst(so.crashEngine.x, so.crashEngine.y, '#ffe08a', 28, 140); ok('Intact engine found and scanned.'); } return; }
    if (a === 'story:scanTank') { if (so.crashTank && !s.m4ScannedTank) { s.m4ScannedTank = true; so.crashTank.scanned = true; burst(so.crashTank.x, so.crashTank.y, '#ffe08a', 28, 140); ok('Fuel tank found and scanned.'); } return; }
    if (a === 'story:scanNose') { if (so.crashNose && !s.m4ScannedNose) { s.m4ScannedNose = true; so.crashNose.scanned = true; burst(so.crashNose.x, so.crashNose.y, '#ffe08a', 28, 140); ok('Nose cone found and scanned.'); } return; }
    if (a === 'story:repairM4Commsat') {
      if (so.m4Commsat && !s.m4CommsatFixed) {
        if ((s.m4CommsatParts || 0) < 3) {
          toast(`Find all commsat components first (${s.m4CommsatParts || 0}/3).`, '', 3000);
          return;
        }
        s.m4CommsatFixed = true;
        s.m4VijayContact = true;
        so.m4Commsat.repaired = true;
        burst(so.m4Commsat.x, so.m4Commsat.y, '#7ef0ff', 45, 180);
        ok('Commsat repaired! Contact restored with Captain Vijay.', 'gold');
      }
      return;
    }

    // Mission 5
    if (a === 'story:haulEngine') { if (so.magneticCrane && !s.m5EngineHauled) { s.m5EngineHauled = true; so.magneticCrane.used = true; burst(so.magneticCrane.x, so.magneticCrane.y, '#ffd36e', 36, 160); ok('Heavy thruster hauled to the launchpad.', 'gold'); } return; }
    if (a === 'story:weldHull') { if (so.weldSpot && !s.m5HullWelded) { s.m5HullWelded = true; so.weldSpot.done = true; burst(so.weldSpot.x, so.weldSpot.y, '#7fdcff', 32, 150); ok('Hull cracks sealed and welded.'); } return; }

    // Mission 6
    if (a === 'story:siphonFuel1') { if (so.fuelWreck1 && !s.m6Fuel1) { s.m6Fuel1 = true; so.fuelWreck1.siphoned = true; burst(so.fuelWreck1.x, so.fuelWreck1.y, '#a8ff7a', 28, 140); ok('Fuel siphoned from wrecked ship (1/3).'); } return; }
    if (a === 'story:siphonFuel2') { if (so.fuelWreck2 && !s.m6Fuel2) { s.m6Fuel2 = true; so.fuelWreck2.siphoned = true; burst(so.fuelWreck2.x, so.fuelWreck2.y, '#a8ff7a', 28, 140); ok('Fuel siphoned from wrecked ship (2/3).'); } return; }
    if (a === 'story:siphonFuel3') { if (so.fuelWreck3 && !s.m6Fuel3) { s.m6Fuel3 = true; so.fuelWreck3.siphoned = true; burst(so.fuelWreck3.x, so.fuelWreck3.y, '#a8ff7a', 28, 140); ok('Fuel siphoned from wrecked ship (3/3).'); } return; }

    // Mission 7
    if (a === 'story:testThrusters') { if (so.thrusterConsole && !s.m7ThrustersTested) { s.m7ThrustersTested = true; so.thrusterConsole.tested = true; game.shake = Math.max(game.shake, 4); burst(so.thrusterConsole.x, so.thrusterConsole.y, '#ffd36e', 40, 170); ok('Thrusters tested. Ignition check successful.', 'gold', 'win'); } return; }

    // Mission 8
    if (a === 'story:checkSolar') { if (so.solarPanel && !s.m8SolarChecked) { s.m8SolarChecked = true; so.solarPanel.checked = true; burst(so.solarPanel.x, so.solarPanel.y, '#ffe08a', 30, 140); ok('Solar panels checked and operational.'); } return; }
    if (a === 'story:waterIceSpot') { if (so.waterIceSpot && !s.m8WaterIceReached) { s.m8WaterIceReached = true; so.waterIceSpot.visited = true; p.water = clamp(p.water + 30, 0, 100); burst(so.waterIceSpot.x, so.waterIceSpot.y, '#7fdcff', 34, 150); ok('Water ice spot reached.'); } return; }

    // Mission 9
    if (a === 'story:alignDish') { if (so.satelliteDish && !s.m9DishAligned) { s.m9DishAligned = true; so.satelliteDish.aligned = true; burst(so.satelliteDish.x, so.satelliteDish.y, '#7ef0ff', 36, 160); ok('Satellite dish aligned toward Earth. Rescue signal sent.', 'gold'); } return; }
    if (a === 'story:loadSupplies') { if (so.supplyLoad && !s.m9SuppliesLoaded) { s.m9SuppliesLoaded = true; so.supplyLoad.loaded = true; burst(so.supplyLoad.x, so.supplyLoad.y, '#ffe08a', 30, 150); ok('Supplies loaded: helper bot, base hamster, and snacks.'); } return; }
    if (a === 'story:launchClamp1' || a === 'story:launchClamp2' || a === 'story:launchClamp3' || a === 'story:launchClamp4') {
      const clamp = so[a.replace('story:', '')];
      if (clamp && !clamp.released) {
        clamp.released = true;
        const released = [so.launchClamp1, so.launchClamp2, so.launchClamp3, so.launchClamp4].filter(c => c && c.released).length;
        s.m9ClampsReleased = released;
        burst(clamp.x, clamp.y, '#ffb36e', 20, 120);
        ok(`Launch clamp released (${released}/4).`);
      }
      return;
    }

    if (a === 'exitDungeon') { exitDungeon(); return; }
    if (a.indexOf('enterDungeon:') === 0) enterDungeon(a.slice('enterDungeon:'.length));
  }

  function updateInteractions() {
    const p = game.player;
    if (!p) return;
    const s = game.story || {};
    const so = game.storyObjects || {};
    const m = currentMission();
    let action = '';
    let prompt = '';

    if (state === 'playing' && m && game.missionPhase === 'active') {
      const id = m.id;
      const near = (o, r = 60) => o && dist(p.x, p.y, o.x, o.y) < r;
      if (id === 1) {
        if (!s.m1PodInspected && near(so.crashPod, 70)) { action = 'story:inspectPod'; prompt = 'Press E to inspect the pod'; }
        else if (!s.m1RoverRepaired && near(so.rover, 60)) { action = 'story:repairRover'; prompt = 'Press E to repair the rover'; }
      } else if (id === 2) {
        if (!s.m2OldChamberReached && near(so.oldSupplyChamber, 70)) { action = 'story:oldSupplyChamber'; prompt = 'Press E to access the old oxygen and food chamber'; }
      } else if (id === 3) {
        if (!s.m3HeatShieldsEquipped && near(so.heatShieldStation, 60)) { action = 'story:equipHeatShields'; prompt = 'Press E to equip heat shields for the rocket'; }
      } else if (id === 4) {
        if (!s.m4ScannedEngine && near(so.crashEngine, 60)) { action = 'story:scanEngine'; prompt = 'Press E to scan crashed ship for an intact engine'; }
        else if (!s.m4ScannedTank && near(so.crashTank, 60)) { action = 'story:scanTank'; prompt = 'Press E to scan crashed ship for a fuel tank'; }
        else if (!s.m4ScannedNose && near(so.crashNose, 60)) { action = 'story:scanNose'; prompt = 'Press E to scan crashed ship for a nose cone'; }
        else if (!s.m4CommsatFixed && near(so.m4Commsat, 65)) { action = 'story:repairM4Commsat'; prompt = (s.m4CommsatParts||0)>=3 ? 'Press E to repair the commsat and contact Captain Vijay' : `Find commsat components (${s.m4CommsatParts||0}/3), then press E to repair`; }
      } else if (id === 5) {
        if (!s.m5EngineHauled && near(so.magneticCrane, 65)) { action = 'story:haulEngine'; prompt = 'Press E to use the magnetic crane and haul the engine'; }
        else if (!s.m5HullWelded && near(so.weldSpot, 60)) { action = 'story:weldHull'; prompt = 'Press E to weld and seal the hull'; }
      } else if (id === 6) {
        if (!s.m6Fuel1 && near(so.fuelWreck1, 60)) { action = 'story:siphonFuel1'; prompt = 'Press E to siphon fuel from wrecked ship (1/3)'; }
        else if (!s.m6Fuel2 && near(so.fuelWreck2, 60)) { action = 'story:siphonFuel2'; prompt = 'Press E to siphon fuel from wrecked ship (2/3)'; }
        else if (!s.m6Fuel3 && near(so.fuelWreck3, 60)) { action = 'story:siphonFuel3'; prompt = 'Press E to siphon fuel from wrecked ship (3/3)'; }
      } else if (id === 7) {
        if (!s.m7ThrustersTested && near(so.thrusterConsole, 60)) { action = 'story:testThrusters'; prompt = 'Press E to run thruster ignition check'; }
      } else if (id === 8) {
        if (!s.m8SolarChecked && near(so.solarPanel, 60)) { action = 'story:checkSolar'; prompt = 'Press E to check the solar panels'; }
        else if (!s.m8WaterIceReached && near(so.waterIceSpot, 60)) { action = 'story:waterIceSpot'; prompt = 'Press E to inspect the water ice spot'; }
      } else if (id === 9) {
        if (!s.m9DishAligned && near(so.satelliteDish, 65)) { action = 'story:alignDish'; prompt = 'Press E to align the satellite dish toward Earth'; }
        else if (!s.m9SuppliesLoaded && near(so.supplyLoad, 60)) { action = 'story:loadSupplies'; prompt = 'Press E to load supplies into the cockpit'; }
        else if (!so.launchClamp1?.released && near(so.launchClamp1, 50)) { action = 'story:launchClamp1'; prompt = 'Press E to release launch clamp (1/4)'; }
        else if (!so.launchClamp2?.released && near(so.launchClamp2, 50)) { action = 'story:launchClamp2'; prompt = 'Press E to release launch clamp (2/4)'; }
        else if (!so.launchClamp3?.released && near(so.launchClamp3, 50)) { action = 'story:launchClamp3'; prompt = 'Press E to release launch clamp (3/4)'; }
        else if (!so.launchClamp4?.released && near(so.launchClamp4, 50)) { action = 'story:launchClamp4'; prompt = 'Press E to release launch clamp (4/4)'; }
      }
    }

    // Educational mission info interactions (real Mars mission sites only)
    if (!action && state === 'playing') {
      for (const site of ROVER_SITES) {
        if (dist(p.x, p.y, site.x, site.y) < 70) { action = `info:rover:${site.id}`; prompt = `Press E to learn about ${site.name}`; break; }
      }
    }

    if (!action && game.location === 'dungeon' && game.dungeon) {
      const ex = game.dungeon.interior.exit;
      if (dist(p.x, p.y, ex.x, ex.y) < ex.r + 10) { action = 'exitDungeon'; prompt = 'Press E to exit to the surface'; }
    } else if (!action && game.location === 'outdoor') {
      for (const d of game.dungeons || []) {
        if (dist(p.x, p.y, d.entrance.x, d.entrance.y) < d.entrance.r + 18) {
          action = 'enterDungeon:' + d.id; prompt = `Press E to enter ${d.name}`; break;
        }
      }
    }

    if (action && action !== game.nearAction && prompt) toast(prompt, 'gold', 2600);
    game.nearAction = action;
    document.body.classList.toggle('can-install', !!action);
    if (dom.installBtn) {
      const labels = {
        'story:inspectPod': 'Inspect pod', 'story:repairRover': 'Repair rover',
        'story:oldSupplyChamber': 'Access chamber', 'story:equipHeatShields': 'Equip heat shields',
        'story:scanEngine': 'Scan engine', 'story:scanTank': 'Scan fuel tank', 'story:scanNose': 'Scan nose cone', 'story:repairM4Commsat': 'Repair commsat',
        'story:haulEngine': 'Haul engine', 'story:weldHull': 'Weld hull',
        'story:siphonFuel1': 'Siphon fuel', 'story:siphonFuel2': 'Siphon fuel', 'story:siphonFuel3': 'Siphon fuel',
        'story:testThrusters': 'Test thrusters', 'story:checkSolar': 'Check solar panels', 'story:waterIceSpot': 'Inspect ice',
        'story:alignDish': 'Align dish', 'story:loadSupplies': 'Load supplies',
        'story:launchClamp1': 'Release clamp', 'story:launchClamp2': 'Release clamp', 'story:launchClamp3': 'Release clamp', 'story:launchClamp4': 'Release clamp',
        'exitDungeon': 'Exit'
      };
      if (labels[action]) dom.installBtn.textContent = labels[action];
      else if (action && action.indexOf('enterDungeon:') === 0) dom.installBtn.textContent = 'Enter dungeon';
      else if (action && action.indexOf('info:') === 0) dom.installBtn.textContent = 'Mission info';
      else dom.installBtn.textContent = 'Interact';
      dom.installBtn.classList.toggle('hidden', !action);
    }
  }

  function getObjective() {
    const p = game.player;
    if (!p) return null;
    if (game.location === 'dungeon' && game.dungeon) {
      const d = game.dungeon;
      let best = null, bd = Infinity;
      for (const it of d.items) {
        if (it.taken) continue;
        const dd = dist(p.x, p.y, it.x, it.y);
        if (dd < bd) { bd = dd; best = it; }
      }
      if (best) return { x: best.x, y: best.y, label: 'SUPPLY', kind: 'cell' };
      return { x: d.interior.exit.x, y: d.interior.exit.y, label: 'EXIT', kind: 'lander' };
    }

    const m = currentMission();
    const s = game.story || {};
    const so = game.storyObjects || {};
    const nearItem = (tag, label) => {
      let best = null, bd = Infinity;
      for (const it of (game.items || [])) {
        if (it.taken || it.storyTag !== tag) continue;
        const d = dist(p.x, p.y, it.x, it.y);
        if (d < bd) { bd = d; best = it; }
      }
      return best ? { x: best.x, y: best.y, label, kind: 'cell' } : null;
    };
    if (m) {
      switch (m.id) {
        case 1: {
          if ((s.m1Supplies || 0) < 1) return nearItem('m1supply', 'EMERGENCY RATION') || { x: LANDER_POS.x, y: LANDER_POS.y, label: 'CRASH SITE', kind: 'lander' };
          if (!s.m1PodInspected && so.crashPod) return { x: so.crashPod.x, y: so.crashPod.y, label: 'INSPECT POD', kind: 'lander' };
          if (!s.m1RoverRepaired && so.rover) return { x: so.rover.x, y: so.rover.y, label: 'REPAIR ROVER', kind: 'amp' };
          return { x: LANDER_POS.x, y: LANDER_POS.y, label: 'CRASH SITE', kind: 'lander' };
        }
        case 2:
          return so.oldSupplyChamber ? { x: so.oldSupplyChamber.x, y: so.oldSupplyChamber.y, label: s.m2OldChamberReached ? 'SUPPLY CHAMBER' : 'OLD SUPPLY CHAMBER', kind: 'cell' } : { x: LANDER_POS.x, y: LANDER_POS.y, label: 'CRASH SITE', kind: 'lander' };
        case 3:
          return so.heatShieldStation ? { x: so.heatShieldStation.x, y: so.heatShieldStation.y, label: s.m3HeatShieldsEquipped ? 'HEAT SHIELDS' : 'EQUIP HEAT SHIELDS', kind: 'cell' } : { x: LANDER_POS.x, y: LANDER_POS.y, label: 'SPACECRAFT', kind: 'lander' };
        case 4: {
          // Main goal: repair commsat to contact Captain Vijay (while also doing obsidian and scans)
          if ((s.m4Obsidian || 0) < 3) return nearItem('m4obs', 'OBSIDIAN SHARD') || { x: (so.volcano||{}).x || 15600, y: (so.volcano||{}).y || 2447, label: 'VOLCANO BIOME', kind: 'cell' };
          if (!s.m4ScannedEngine && so.crashEngine) return { x: so.crashEngine.x, y: so.crashEngine.y, label: 'SCAN ENGINE', kind: 'cell' };
          if (!s.m4ScannedTank && so.crashTank) return { x: so.crashTank.x, y: so.crashTank.y, label: 'SCAN FUEL TANK', kind: 'cell' };
          if (!s.m4ScannedNose && so.crashNose) return { x: so.crashNose.x, y: so.crashNose.y, label: 'SCAN NOSE CONE', kind: 'cell' };
          if (!s.m4CommsatFixed) {
            if ((s.m4CommsatParts || 0) < 3) return nearItem('m4comms', 'COMMSAT COMPONENT') || (so.m4Commsat ? { x: so.m4Commsat.x, y: so.m4Commsat.y, label: 'COMMSAT', kind: 'cell' } : null);
            if (so.m4Commsat) return { x: so.m4Commsat.x, y: so.m4Commsat.y, label: 'REPAIR COMMSAT', kind: 'cell' };
          }
          return { x: LANDER_POS.x, y: LANDER_POS.y, label: 'LAUNCHPAD', kind: 'lander' };
        }
        case 5:
          if (!s.m5EngineHauled && so.magneticCrane) return { x: so.magneticCrane.x, y: so.magneticCrane.y, label: 'MAGNETIC CRANE', kind: 'cell' };
          if (!s.m5HullWelded && so.weldSpot) return { x: so.weldSpot.x, y: so.weldSpot.y, label: 'WELD HULL', kind: 'cell' };
          return { x: LANDER_POS.x, y: LANDER_POS.y, label: 'LAUNCHPAD', kind: 'lander' };
        case 6:
          if (!s.m6Fuel1 && so.fuelWreck1) return { x: so.fuelWreck1.x, y: so.fuelWreck1.y, label: 'SIPHON FUEL (1/3)', kind: 'cell' };
          if (!s.m6Fuel2 && so.fuelWreck2) return { x: so.fuelWreck2.x, y: so.fuelWreck2.y, label: 'SIPHON FUEL (2/3)', kind: 'cell' };
          if (!s.m6Fuel3 && so.fuelWreck3) return { x: so.fuelWreck3.x, y: so.fuelWreck3.y, label: 'SIPHON FUEL (3/3)', kind: 'cell' };
          return { x: LANDER_POS.x, y: LANDER_POS.y, label: 'LAUNCHPAD', kind: 'lander' };
        case 7:
          return so.thrusterConsole ? { x: so.thrusterConsole.x, y: so.thrusterConsole.y, label: s.m7ThrustersTested ? 'THRUSTERS OK' : 'TEST THRUSTERS', kind: 'cell' } : { x: LANDER_POS.x, y: LANDER_POS.y, label: 'LAUNCHPAD', kind: 'lander' };
        case 8: {
          if ((s.m8Rocks || 0) < 3) return nearItem('m8rock', 'ROCK SAMPLE') || { x: LANDER_POS.x, y: LANDER_POS.y, label: 'COLLECT SAMPLES', kind: 'cell' };
          if (!s.m8SolarChecked && so.solarPanel) return { x: so.solarPanel.x, y: so.solarPanel.y, label: 'CHECK SOLAR PANELS', kind: 'cell' };
          if (!s.m8WaterIceReached && so.waterIceSpot) return { x: so.waterIceSpot.x, y: so.waterIceSpot.y, label: 'WATER ICE SPOT', kind: 'cell' };
          return { x: LANDER_POS.x, y: LANDER_POS.y, label: 'LAUNCHPAD', kind: 'lander' };
        }
        case 9:
          if (!s.m9DishAligned && so.satelliteDish) return { x: so.satelliteDish.x, y: so.satelliteDish.y, label: 'ALIGN SATELLITE DISH', kind: 'cell' };
          if (!s.m9SuppliesLoaded && so.supplyLoad) return { x: so.supplyLoad.x, y: so.supplyLoad.y, label: 'LOAD SUPPLIES', kind: 'cell' };
          if ((s.m9ClampsReleased || 0) < 4) {
            const clamps = [so.launchClamp1, so.launchClamp2, so.launchClamp3, so.launchClamp4].filter(c => c && !c.released);
            if (clamps.length) { const c = clamps[0]; return { x: c.x, y: c.y, label: 'RELEASE LAUNCH CLAMP', kind: 'cell' }; }
          }
          return { x: LANDER_POS.x, y: LANDER_POS.y, label: 'LAUNCHPAD', kind: 'lander' };
      }
    }
    return { x: LANDER_POS.x, y: LANDER_POS.y, label: 'CRASH SITE', kind: 'lander' };
  }

  function updateQuest() {
    // Legacy quest progression disabled in Pico: The Martian Survivor story mode.
  }

  function updateRegion(dt) {
    if (!game.player) return;
    if (game.regionTimer > 0) {
      game.regionTimer -= dt;
      if (game.regionTimer <= 0) dom.regionBanner.classList.remove('show');
    }
    const z = zoneAt(game.player.x, game.player.y);
    if (game.region !== z.id) {
      game.region = z.id;
      dom.regionName.textContent = z.name;
      dom.regionBanner.classList.remove('show');
      void dom.regionBanner.offsetWidth;
      dom.regionBanner.classList.add('show');
      game.regionTimer = 3.8;
    }
  }

  function updateFlare(dt) {
    const f = game.flare;
    if (f.phase === 'idle') {
      f.timer -= dt;
      if (f.timer <= 0) {
        f.phase = 'warning';
        f.timer = 10;
        toast('SOLAR FLARE INCOMING — GET TO A HABITAT', 'danger', 5200);
        Sound.warn();
        game.shake = Math.max(game.shake, 4);
      }
    } else if (f.phase === 'warning') {
      f.timer -= dt;
      if (f.timer <= 0) {
        f.phase = 'active';
        f.timer = 12;
        f.count++;
        game.shake = 13;
        Sound.flare();
        if (isSheltered(game.player.x, game.player.y)) {
          toast('Flare front passing. Life support is holding.', 'good', 4600);
        } else {
          toast('Radiation spiking! You are exposed.', 'danger', 4600);
        }
      }
    } else {
      f.timer -= dt;
      if (f.timer <= 0) {
        f.phase = 'idle';
        f.timer = rnd(58, 82);
        toast('Solar flare passed. Check your radiation.', 'good', 3000);
      }
    }
  }

  function updateWarnings(dt) {
    const p = game.player;
    const w = game.warnings;
    for (const k in w) w[k] = Math.max(0, (w[k] || 0) - dt);
    if (p.o2 < 25 && w.o2 <= 0) {
      w.o2 = 17;
      toast('Oxygen low.', 'danger', 2600);
      Sound.warn();
    }
    if (p.food < 25 && w.food <= 0) {
      w.food = 22;
      toast('Food low.', 'danger', 2600);
      Sound.warn();
    }
    if (p.water < 25 && w.water <= 0) {
      w.water = 22;
      toast('Water low — find a water canister or refill station.', 'danger', 3000);
      Sound.warn();
    }
    if (p.power < 25 && w.power <= 0) {
      w.power = 22;
      toast('Power low — recharge at a station or collect a power cell.', 'danger', 3000);
      Sound.warn();
    }
    if (p.suit < 30 && w.suit <= 0) {
      w.suit = 24;
      toast('Suit integrity critical — repair soon.', 'danger', 3200);
      Sound.warn();
    }
    if (p.rad > 70 && w.rad <= 0) {
      w.rad = 17;
      toast('Radiation high — reach shelter.', 'danger', 3200);
      Sound.warn();
    }
  }

  function updateParticles(dt) {
    const arr = game.particles;
    for (let i = arr.length - 1; i >= 0; i--) {
      const q = arr[i];
      q.life -= dt;
      if (q.life <= 0) {
        arr.splice(i, 1);
        continue;
      }
      q.vy += q.gravity * dt;
      q.vx *= 1 - dt * 1.2;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
    if (arr.length > 300) arr.splice(0, arr.length - 300);

    const active = game.flare.phase === 'active';
    const vw = VIEW.w || 1000;
    const vh = VIEW.h || 700;
    for (const m of (game.motes || [])) {
      m.x += (m.vx + (active ? 90 : 0)) * dt;
      m.y += m.vy * dt;
      if (m.x < -30) m.x += vw + 60;
      if (m.x > vw + 30) m.x -= vw + 60;
      if (m.y < -30) m.y += vh + 60;
      if (m.y > vh + 30) m.y -= vh + 60;
    }

    // Imaginative ambience: footprints fade, dust devils swirl, occasional shooting stars
    if (game.footprints) {
      for (let i = game.footprints.length - 1; i >= 0; i--) {
        game.footprints[i].life -= dt;
        if (game.footprints[i].life <= 0) game.footprints.splice(i, 1);
      }
    }
    const p = game.player;
    if (game.location === 'outdoor' && p) {
      if (!game._dustDevilT) game._dustDevilT = rnd(2, 6);
      game._dustDevilT -= dt;
      if (game._dustDevilT <= 0 && (game.dustDevils || []).length < 4) {
        game._dustDevilT = rnd(8, 18);
        const ang = rnd(0, TAU), d = rnd(220, 520);
        const dx = p.x + Math.cos(ang) * d, dy = p.y + Math.sin(ang) * d;
        if (dx > 80 && dy > 80 && dx < WORLD.w - 80 && dy < WORLD.h - 80) {
          game.dustDevils.push({ x: dx, y: dy, vx: rnd(-18,18), vy: rnd(-18,18), life: rnd(8,14), t: rnd(0,TAU), r: rnd(18,34) });
        }
      }
      for (let i = (game.dustDevils || []).length - 1; i >= 0; i--) {
        const dv = game.dustDevils[i];
        dv.t += dt * 4.5; dv.life -= dt; dv.x += dv.vx * dt + Math.cos(dv.t) * 8 * dt; dv.y += dv.vy * dt + Math.sin(dv.t * 0.8) * 8 * dt;
        dv.vx *= Math.pow(0.2, dt); dv.vy *= Math.pow(0.2, dt);
        dv.vx += rnd(-8,8)*dt; dv.vy += rnd(-8,8)*dt;
        if (Math.random() < dt * 10) burst(dv.x + rnd(-dv.r*0.4,dv.r*0.4), dv.y + rnd(-6,6), 'rgba(210,150,110,0.45)', 1, 18);
        if (dv.life <= 0) game.dustDevils.splice(i, 1);
      }
      if (!game._shootT) game._shootT = rnd(6, 16);
      game._shootT -= dt;
      if (game._shootT <= 0 && (game.shootingStars || []).length < 2) {
        game._shootT = rnd(10, 28);
        game.shootingStars.push({ x: rnd(0, vw), y: rnd(0, Math.max(40, (VIEW.h||700)*0.45)), vx: rnd(220, 420), vy: rnd(40, 140), life: rnd(0.5, 1.1), len: rnd(30, 70) });
      }
    } else {
      game.dustDevils = [];
      game.shootingStars = [];
    }
    if (game.shootingStars) {
      for (let i = game.shootingStars.length - 1; i >= 0; i--) {
        const st = game.shootingStars[i]; st.life -= dt; st.x += st.vx * dt; st.y += st.vy * dt;
        if (st.life <= 0 || st.x > vw + 80 || st.y > vh) game.shootingStars.splice(i, 1);
      }
    }
  }

  function updateCamera(dt, snap = false) {
    const p = game.player;
    if (!p) return;
    if (snap) {
      CAM.yaw = CAM.targetYaw;
      CAM.pitch = CAM.targetPitch;
      CAM.dist = CAM.targetDist;
    } else {
      CAM.yaw = dampAngle(CAM.yaw, CAM.targetYaw, 18, dt);
      CAM.pitch = damp(CAM.pitch, CAM.targetPitch, 16, dt);
      CAM.dist = damp(CAM.dist, CAM.targetDist, 12, dt);
    }
    // The simulation/warm-up code still uses a simple camera focus point.
    game.cam.x = p.x;
    game.cam.y = p.y;
    game.shake = Math.max(0, game.shake - dt * 22);
  }

  // =========================================================================
  // HUD + screens
  // =========================================================================
  function fmtTime(t) {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function updateHud() {
    const p = game.player;
    if (!p) return;
    dom.barO2.style.width = `${clamp((p.o2 / p.maxO2) * 100, 0, 100)}%`;
    dom.barFood.style.width = `${clamp(p.food, 0, 100)}%`;
    dom.barRad.style.width = `${clamp(p.rad, 0, 100)}%`;
    if (dom.barPower) dom.barPower.style.width = `${clamp((p.power / p.maxPower) * 100, 0, 100)}%`;
    if (dom.barWater) dom.barWater.style.width = `${clamp(p.water, 0, 100)}%`;
    if (dom.barSuit) dom.barSuit.style.width = `${clamp((p.suit / p.maxSuit) * 100, 0, 100)}%`;
    dom.valO2.textContent = Math.ceil(p.o2);
    dom.valFood.textContent = Math.ceil(p.food);
    dom.valRad.textContent = Math.ceil(p.rad);
    if (dom.valPower) dom.valPower.textContent = Math.ceil(p.power);
    if (dom.valWater) dom.valWater.textContent = Math.ceil(p.water);
    if (dom.valSuit) dom.valSuit.textContent = Math.ceil(p.suit);

    dom.statO2.classList.toggle('low', p.o2 < p.maxO2 * 0.25);
    dom.statFood.classList.toggle('low', p.food < 25);
    dom.statRad.classList.toggle('low', p.rad > 65);
    if (dom.statPower) dom.statPower.classList.toggle('low', p.power < 25);
    if (dom.statWater) dom.statWater.classList.toggle('low', p.water < 25);
    if (dom.statSuit) dom.statSuit.classList.toggle('low', p.suit < 30);

    const health = clamp(((p.o2 / p.maxO2) * 22 + (p.food / 100) * 18 + (p.water / 100) * 18 + (p.power / p.maxPower) * 14 + (p.suit / p.maxSuit) * 28) - (p.rad * 0.25), 0, 100);
    if (dom.barHealth) dom.barHealth.style.width = `${health}%`;
    if (dom.valHealth) dom.valHealth.textContent = Math.ceil(health);
    if (dom.statHealth) dom.statHealth.classList.toggle('low', health < 30);
    if (dom.barHealth) {
      if (health < 30) dom.barHealth.style.background = 'linear-gradient(90deg,#c93a3a,#ff7a5c)';
      else if (health < 60) dom.barHealth.style.background = 'linear-gradient(90deg,#d29a2d,#ffd36e)';
      else dom.barHealth.style.background = 'linear-gradient(90deg,#39c96b,#8dff9f)';
    }

    const m = currentMission();
    if (m) {
      const ch = CHAPTERS.find(c => c.id === m.chapter) || CHAPTERS[0];
      const s = game.story || {};
      dom.missionEyebrow.textContent = `CHAPTER ${ch.id} · ${m.id}/${MISSIONS.length}`;
      let text = '', hint = m.objective, progress = 0;
      switch (m.id) {
        case 1: {
          const done = [ (s.m1Supplies||0)>=1, !!s.m1PodInspected, !!s.m1RoverRepaired ].filter(Boolean).length;
          progress = done / 3;
          text = `Emergency ration <b>${(s.m1Supplies||0)>=1?'collected':'needed'}</b> · Pod <b>${s.m1PodInspected?'inspected':'pending'}</b> · Rover <b>${s.m1RoverRepaired?'repaired':'broken'}</b>`;
          hint = s.m1Complete ? 'Rover ready. You can travel farther.' : 'Stay within the crash debris field: collect the emergency ration, inspect the pod, and repair the rover.';
          break;
        }
        case 2:
          progress = s.m2OldChamberReached ? 1 : 0.2;
          text = s.m2OldChamberReached ? 'Old supply chamber <b>reached</b>' : 'Find oxygen & food chamber <b>from previous mission</b>';
          hint = s.m2OldChamberReached ? 'Supplies secured.' : 'Travel to the oxygen and food chamber built by a previous Mars mission.';
          break;
        case 3:
          progress = s.m3HeatShieldsEquipped ? 1 : 0.3;
          text = s.m3HeatShieldsEquipped ? 'Heat shields <b>equipped</b>' : 'Heat shields <b>not equipped</b>';
          hint = s.m3HeatShieldsEquipped ? 'Rocket protected.' : 'Equip heat shields for the rocket near the launchpad.';
          break;
        case 4: {
          const scans = [!!s.m4ScannedEngine, !!s.m4ScannedTank, !!s.m4ScannedNose].filter(Boolean).length;
          const obs = s.m4Obsidian || 0;
          const parts = s.m4CommsatParts || 0;
          const comms = !!s.m4CommsatFixed;
          const doneCount = [obs>=3, scans>=3, comms].filter(Boolean).length;
          progress = ((obs/3) + (scans/3) + (comms ? 1 : Math.min(parts/3, 0.9))) / 3;
          text = `Obsidian <b>${obs}</b>/3 · Parts scanned <b>${scans}</b>/3 · Commsat <b>${comms ? 'repaired' : `${parts}/3 parts`}</b>`;
          hint = doneCount===3 ? 'Commsat repaired. Contact restored with Captain Vijay.' : 'Collect obsidian, scan crashed ships, and repair the commsat (main goal) to contact Captain Vijay.';
          break;
        }
        case 5: {
          const done = [!!s.m5EngineHauled, !!s.m5HullWelded].filter(Boolean).length;
          progress = done / 2;
          text = `Engine <b>${s.m5EngineHauled?'hauled':'pending'}</b> · Hull <b>${s.m5HullWelded?'welded':'cracked'}</b>`;
          hint = done===2 ? 'Rocket assembly progressing well.' : 'Haul the engine with the magnetic crane and weld the hull.';
          break;
        }
        case 6: {
          const f = [!!s.m6Fuel1, !!s.m6Fuel2, !!s.m6Fuel3].filter(Boolean).length;
          progress = f / 3;
          text = `Fuel siphoned <b>${f}</b>/3`;
          hint = f===3 ? 'Fuel tanks filled.' : 'Siphon rocket fuel from three different wrecked ships.';
          break;
        }
        case 7:
          progress = s.m7ThrustersTested ? 1 : 0.3;
          text = s.m7ThrustersTested ? 'Thrusters <b>tested</b>' : 'Thrusters <b>not tested</b>';
          hint = s.m7ThrustersTested ? 'Engine fires properly.' : 'Run a quick ignition check to test the thrusters.';
          break;
        case 8: {
          const rocks = s.m8Rocks || 0;
          const done = [rocks>=3, !!s.m8SolarChecked, !!s.m8WaterIceReached].filter(Boolean).length;
          progress = ((rocks/3) + (s.m8SolarChecked?1:0) + (s.m8WaterIceReached?1:0)) / 3;
          text = `Samples <b>${rocks}</b>/3 · Solar <b>${s.m8SolarChecked?'checked':'pending'}</b> · Ice spot <b>${s.m8WaterIceReached?'reached':'pending'}</b>`;
          hint = done===3 ? 'Field tasks complete.' : 'Collect rock samples, check the solar panels, and walk to the water ice spot.';
          break;
        }
        case 9: {
          const done = [!!s.m9DishAligned, !!s.m9SuppliesLoaded, (s.m9ClampsReleased||0)>=4].filter(Boolean).length;
          progress = ((s.m9DishAligned?1:0) + (s.m9SuppliesLoaded?1:0) + ((s.m9ClampsReleased||0)/4)) / 3;
          text = `Dish <b>${s.m9DishAligned?'aligned':'pending'}</b> · Supplies <b>${s.m9SuppliesLoaded?'loaded':'pending'}</b> · Clamps <b>${s.m9ClampsReleased||0}</b>/4`;
          hint = done===3 ? 'Ready for launch.' : 'Align the satellite dish, load supplies, and clear four launch clamps.';
          break;
        }
        default:
          text = m.name;
          break;
      }
      // Imaginative HUD touch: show live distance to current objective
      if (game.location === 'outdoor' && game.missionPhase === 'active') {
        const obj = getObjective();
        if (obj && game.player) {
          const d = Math.round(dist(game.player.x, game.player.y, obj.x, obj.y));
          text += ` <span style="color:#9adfff;font-weight:700">· ${d}m</span>`;
        }
      }
      dom.missionText.innerHTML = text;
      dom.missionHint.textContent = hint;
      if (dom.missionBarFill) dom.missionBarFill.style.width = `${Math.round(clamp(progress, 0, 1) * 100)}%`;
      dom.pips.forEach((pip, i) => pip.classList.toggle('on', i < Math.ceil(progress * 3)));
    } else {
      dom.missionEyebrow.textContent = 'MISSION';
      dom.missionText.innerHTML = 'Explore Mars';
      dom.missionHint.textContent = 'Follow Captain Vijay\'s guidance.';
      if (dom.missionBarFill) dom.missionBarFill.style.width = '0%';
      dom.pips.forEach((pip) => pip.classList.remove('on'));
    }

    dom.clock.textContent = `SOL 1 · ${fmtTime(game.time)}`;
    if (game.location === 'dungeon' && game.dungeon) {
      dom.mapRegion.textContent = 'DG';
    } else {
      const zid = zoneAt(p.x, p.y).id;
      const zi = ZONES.findIndex((z) => z.id === zid) + 1;
      dom.mapRegion.textContent = String(zi).padStart(2, '0');
    }

    const chipShow = game.sheltered || game.o2Refill || game.foodRefill;
    dom.shelterChip.classList.toggle('show', chipShow);
    if (chipShow) {
      const parts = [];
      if (game.sheltered) parts.push(game.flare.phase === 'active' ? 'Flare shielded' : 'Sheltered');
      if (game.o2Refill && p.o2 < p.maxO2 - 1) parts.push('O₂ refilling');
      if (game.foodRefill && p.food < 99) parts.push('Food refilling');
      dom.shelterChip.textContent = parts.length ? parts.join(' · ') : (game.sheltered ? 'Life support' : 'Refill station');
    }

    const f = game.flare;
    if (game.location === 'outdoor' && f.phase === 'warning') {
      dom.flareBanner.classList.remove('hidden', 'active');
      dom.flareText.textContent = `SOLAR FLARE INCOMING · ${Math.ceil(f.timer)}s — SEEK SHELTER`;
    } else if (game.location === 'outdoor' && f.phase === 'active') {
      dom.flareBanner.classList.remove('hidden');
      dom.flareBanner.classList.add('active');
      dom.flareText.textContent = `SOLAR FLARE ACTIVE · ${Math.ceil(f.timer)}s — STAY SHIELDED`;
    } else {
      dom.flareBanner.classList.add('hidden');
    }

    let danger = (p.rad / 100) * 0.5;
    if (f.phase === 'active' && !game.sheltered) danger += 0.32;
    if (p.o2 < 20) danger += 0.16;
    if (p.starving) danger += 0.1;
    dom.danger.style.opacity = clamp(danger, 0, 0.9).toFixed(3);
  }

  function toast(text, kind = '', ms = 3000) {
    const div = document.createElement('div');
    div.className = `toast ${kind}`.trim();
    div.textContent = text;
    dom.toasts.appendChild(div);
    requestAnimationFrame(() => div.classList.add('show'));
    while (dom.toasts.children.length > 3) dom.toasts.firstElementChild.remove();
    window.setTimeout(() => {
      div.classList.remove('show');
      window.setTimeout(() => div.remove(), 260);
    }, ms);
  }

  function startGame() {
    resetWorld();
    state = 'briefing';
    Sound.init();
    if (Sound && Sound.stopCreditsBgm) Sound.stopCreditsBgm();

    dom.hud.classList.remove('hidden');
    dom.minimapWrap.classList.remove('hidden');
    dom.installBtn.classList.add('hidden');
    dom.shelterChip.classList.remove('show');
    dom.flareBanner.classList.add('hidden');
    dom.regionBanner.classList.remove('show');
    dom.journal.classList.add('hidden');
    if (dom.infoPopup) dom.infoPopup.classList.add('hidden');
    if (dom.missionSuccessPopup) dom.missionSuccessPopup.classList.add('hidden');
    if (dom.endPanel) dom.endPanel.classList.remove('win-credits');
    dom.toasts.innerHTML = '';
    dom.danger.style.opacity = '0';
    updateJournalButton();
    updateHud();
    lastFrame = performance.now();
    showMissionBriefing('before');
  }

  function endGame(kind, title, text) {
    if (state === 'won' || state === 'dead') return;
    state = kind;
    const p = game.player;
    Sound.wind(false);
    if (kind === 'won') {
      Sound.win();
      if (Sound.playCreditsBgm) Sound.playCreditsBgm();
    } else {
      if (Sound.stopCreditsBgm) Sound.stopCreditsBgm();
      Sound.death();
    }

    const missionNum = (game.missionIndex || 0) + 1;
    const total = MISSIONS.length;
    dom.endKicker.textContent = kind === 'won'
      ? 'PICO: THE MARTIAN SURVIVOR · 2030'
      : `SUIT FAILURE · CHAPTER ${Math.min((MISSIONS[game.missionIndex||0]||MISSIONS[0]).chapter || 1, 5)}`;
    dom.endTitle.textContent = kind === 'won' ? 'A HERO RETURNS' : title;
    dom.endText.textContent = kind === 'won'
      ? (text || `After a long and difficult journey, Pico reunites with Captain Vijay and the crew.\n\nCAPTAIN VIJAY: "You did something extraordinary, Pico."\nPICO: "I just wanted to come home, Captain."\nCAPTAIN VIJAY: "You didn't just survive Mars. You proved that courage has nothing to do with age."\n\nTHE END.`)
      : text;

    let rating = '';
    if (kind === 'won') {
      rating = game.time < 420 && game.stats.peakRad < 55 ? 'S'
        : game.time < 600 ? 'A'
          : 'B';
    }

    const fourth = kind === 'won'
      ? `<div class="end-stat"><span>Rating</span><b class="rating">${rating}</b></div>`
      : `<div class="end-stat"><span>Peak rad</span><b>${Math.round(game.stats.peakRad)}</b></div>`;

    dom.endStats.innerHTML = `
      <div class="end-stat"><span>Time</span><b>${fmtTime(game.time)}</b></div>
      <div class="end-stat"><span>Distance</span><b>${(game.stats.distance / 1000).toFixed(2)} km</b></div>
      <div class="end-stat"><span>Progress</span><b>${kind === 'won' ? `${MISSIONS.length} / ${MISSIONS.length}` : `${Math.max(0, game.missionIndex || 0)} / ${MISSIONS.length}`}</b></div>
      ${fourth}
    `;

    dom.hud.classList.add('hidden');
    dom.minimapWrap.classList.add('hidden');
    dom.installBtn.classList.add('hidden');
    dom.toasts.innerHTML = '';
    document.body.classList.remove('can-install');
    dom.shelterChip.classList.remove('show');
    dom.flareBanner.classList.add('hidden');
    dom.regionBanner.classList.remove('show');
    dom.journal.classList.add('hidden');
    dom.pause.classList.add('hidden');
    if (dom.infoPopup) dom.infoPopup.classList.add('hidden');
    if (dom.missionSuccessPopup) dom.missionSuccessPopup.classList.add('hidden');
    dom.screen.classList.remove('hidden');
    dom.startPanel.classList.add('hidden');
    dom.endPanel.classList.toggle('win-credits', kind === 'won');
    dom.endPanel.classList.remove('hidden');
    dom.danger.style.opacity = kind === 'won' ? '0' : '0.5';
  }

  function installRadar() {
    if (state !== 'playing') return;
    const p = game.player;
    const q = game.quest;
    if (game.location !== 'outdoor' || !game.commArray) return;
    if (dist(p.x, p.y, game.commArray.x, game.commArray.y) > 130) return;
    if (q.radarRestored || p.relays < 3) return;
    q.radarRestored = true;
    q.level = 2;
    burst(game.commArray.x, game.commArray.y - 20, '#7ef0ff', 50, 180);
    toast('Communications restored! You can now contact Captain Vijay from the Comm Array.', 'gold', 7000);
    Sound.cell();
    game.shake = 7;
    updateHud();
  }

  function installCells() {
    if (state !== 'playing') return;
    const p = game.player;
    const q = game.quest;
    if (game.location !== 'outdoor') return;
    if (dist(p.x, p.y, game.lander.x, game.lander.y) > 130) return;

    if (q.radarRestored && q.amplifier && !q.ampInstalled) {
      q.ampInstalled = true;
      burst(game.lander.x, game.lander.y - 10, '#8dffb0', 60, 210);
      toast('Signal amplifier installed.', 'good', 4000);
      Sound.cell();
      updateHud();
    }
  }

  function togglePause() {
    if (state === 'playing') {
      state = 'paused';
      dom.pause.classList.remove('hidden');
      Sound.wind(false);
    } else if (state === 'paused') {
      state = 'playing';
      dom.pause.classList.add('hidden');
      Sound.wind(true);
      lastFrame = performance.now();
    }
  }

  // =========================================================================
  // Field journal
  // =========================================================================
  function updateJournalButton() {
    const n = game.stats.logs || 0;
    dom.journalBtn.textContent = 'JOURNAL';
    dom.journalBtn.setAttribute('aria-label', n
      ? `Open field journal — ${n} field log${n === 1 ? '' : 's'} recovered`
      : 'Open field journal');
  }

  function buildJournal() {
    const p = game.player;
    if (!p) return;
    const m = currentMission();
    const ch = m ? (CHAPTERS.find(c => c.id === m.chapter) || CHAPTERS[0]) : CHAPTERS[0];
    const zone = game.location === 'dungeon' && game.dungeon ? { name: game.dungeon.name } : zoneAt(p.x, p.y);
    dom.journalRegion.textContent = zone.name;

    let objective = 'Explore Mars and survive.';
    if (m) {
      objective = `<b>${ch.title}</b> — ${m.name}<br><b>Objective:</b> ${m.objective}<br><span style="color:#b8a294">Captain Vijay and crew (Sristi, Bhavyesh, Bikramaditya, Anurag, Saswati) are counting on you.</span>`;
    }
    const s = game.story || {};
    const sideLines = [
      `<b>Mission 1:</b> Emergency ration ${(s.m1Supplies||0)>=1?'collected':'needed'}, Pod ${s.m1PodInspected?'inspected':'pending'}, Rover ${s.m1RoverRepaired?'repaired':'pending'}.`,
      `<b>Mission 4:</b> Obsidian ${(s.m4Obsidian||0)}/3, Parts scanned ${[s.m4ScannedEngine,s.m4ScannedTank,s.m4ScannedNose].filter(Boolean).length}/3.`,
      `<b>Mission 6/7:</b> Fuel ${[s.m6Fuel1,s.m6Fuel2,s.m6Fuel3].filter(Boolean).length}/3, Thrusters ${s.m7ThrustersTested?'tested':'pending'}.`,
      `<b>Mission 8:</b> Rocks ${(s.m8Rocks||0)}/3, Solar ${s.m8SolarChecked?'checked':'pending'}, Ice spot ${s.m8WaterIceReached?'reached':'pending'}.`,
      `<b>Mission 9:</b> Dish ${s.m9DishAligned?'aligned':'pending'}, Supplies ${s.m9SuppliesLoaded?'loaded':'pending'}, Clamps ${(s.m9ClampsReleased||0)}/4.`,
      `<b>Real Mars regions:</b> Gusev Crater, Meridiani Planum, Gale Crater, Jezero Crater, Valles Marineris, Volcanic Highlands.`
    ];
    dom.journalObjective.innerHTML = objective + '<br><br>' + sideLines.join('<br>');

    const ups = [];
    if (p.upgrades.tank) ups.push(`O₂ tank +${p.upgrades.tank * 25}`);
    if (p.upgrades.lining) ups.push(`Rad lining ×${p.upgrades.lining}`);
    if (p.upgrades.boots) ups.push(`Servo boots ×${p.upgrades.boots}`);
    dom.upgradeCount.textContent = `${game.stats.upgrades} found`;
    dom.journalUpgrades.innerHTML = ups.length
      ? ups.map((u) => `<span class="upgrade-chip">${u}</span>`).join('')
      : '<span class="upgrade-chip empty">No suit upgrades found</span>';

    const totalFound = game.stats.logs + game.side.knowledge;
    dom.journalCount.textContent = `${totalFound} / ${game.logs.length + KNOWLEDGE_DEFS.length}`;
    const foundLogs = game.logs.filter((l) => l.taken).map((l) => `
          <article class="journal-entry">
            <h3>${l.title}</h3>
            <p>${l.text}</p>
          </article>`);
    const foundKnowledge = KNOWLEDGE_DEFS.filter((k) => game.side.knowledgeIds[k.id]).map((k) => `
          <article class="journal-entry">
            <h3>MARS KNOWLEDGE — ${k.title.toUpperCase()}</h3>
            <p>${k.text}</p>
          </article>`);
    const entries = foundLogs.concat(foundKnowledge);
    dom.journalLogs.innerHTML = entries.length
      ? entries.join('')
      : '<p class="journal-empty">No field logs or Mars knowledge yet. Explore the surface and dungeons to learn more.</p>';
  }

  function openJournal() {
    if (state !== 'playing') return;
    state = 'journal';
    buildJournal();
    dom.journal.classList.remove('hidden');
    Sound.wind(false);
  }

  function closeJournal() {
    if (state !== 'journal') return;
    state = 'playing';
    dom.journal.classList.add('hidden');
    Sound.wind(true);
    lastFrame = performance.now();
  }

  // =========================================================================
  // Educational mission info popup (pauses resources)
  // =========================================================================
  let infoReturnState = 'playing';
  function openMissionInfo(data) {
    if (!data || (state !== 'playing' && state !== 'paused')) return;
    if (state === 'paused') dom.pause.classList.add('hidden');
    infoReturnState = 'playing';
    state = 'infopopup';
    Sound.wind(false);

    const title = data.name || data.title || 'Mission Info';
    const year = data.year ? String(data.year) : '';
    const agency = data.agency || '';
    const country = data.country || (data.flag ? String(data.flag) : 'Mission');
    const flagText = data.flag === 'USA' ? '🇺🇸 USA MISSION' : (data.flag || country || 'INFO');
    const zone = data.zone || '';
    const text = data.info || data.text || '';
    const icon = '🚀';

    if (dom.infoPopup) {
      const panel = dom.infoPopup.querySelector('.info-panel');
      if (panel) panel.classList.add('mission-premium');
    }
    if (dom.infoIcon) dom.infoIcon.textContent = icon;
    dom.infoBadge.textContent = 'HISTORIC MARS MISSION';
    dom.infoFlag.textContent = flagText;
    dom.infoKicker.textContent = 'Real Mars Mission Intelligence · Survival Resources Paused';
    dom.infoTitle.textContent = title;

    const meta = [];
    if (year) meta.push(`<span><b>Mission Year</b>${year}</span>`);
    if (agency) meta.push(`<span><b>Agency / Program</b>${agency}</span>`);
    if (zone) meta.push(`<span><b>Location</b>${zone}</span>`);
    if (country) meta.push(`<span><b>Country</b>${country}</span>`);
    dom.infoMeta.innerHTML = meta.join('');
    dom.infoBody.textContent = text;

    dom.infoPopup.classList.remove('hidden');
  }

  function closeMissionInfo() {
    if (state !== 'infopopup') return;
    const panel = dom.infoPopup ? dom.infoPopup.querySelector('.info-panel') : null;
    if (panel) panel.classList.remove('mission-premium');
    dom.infoPopup.classList.add('hidden');
    state = 'playing';
    Sound.wind(true);
    lastFrame = performance.now();
  }

  // =========================================================================
  // Rendering
  // =========================================================================
  function renderDungeon(now) {
    const t = now / 1000;
    const d = game.dungeon;
    const p = game.player;
    if (!d || !p) return;
    const dpr = VIEW.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#050403';
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);

    const margin = 24;
    const scale = Math.min((VIEW.w - margin * 2) / d.interior.w, (VIEW.h - margin * 2) / d.interior.h);
    const ox = (VIEW.w - d.interior.w * scale) / 2;
    const oy = (VIEW.h - d.interior.h * scale) / 2;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // Floor (dark cave)
    ctx.fillStyle = '#120d0b';
    ctx.fillRect(0, 0, d.interior.w, d.interior.h);
    ctx.strokeStyle = 'rgba(255,180,120,0.05)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= d.interior.w; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, d.interior.h); ctx.stroke(); }
    for (let y = 0; y <= d.interior.h; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(d.interior.w, y); ctx.stroke(); }

    // Walls
    ctx.fillStyle = '#2f1d17';
    for (const w of d.walls) {
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = 'rgba(255,210,170,0.08)';
      ctx.strokeRect(w.x + 1, w.y + 1, w.w - 2, w.h - 2);
    }

    // Exit
    const ex = d.interior.exit;
    ctx.fillStyle = 'rgba(120,255,170,0.16)';
    ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(150,255,190,0.45)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#dfffe8'; ctx.font = '700 14px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText('EXIT', ex.x, ex.y - ex.r - 10);

    // Food station
    const fs = d.foodStation;
    const pulse = 0.6 + 0.4 * Math.sin(t * 3);
    ctx.fillStyle = `rgba(255,210,90,${0.12 + pulse * 0.05})`;
    ctx.beginPath(); ctx.arc(fs.x, fs.y, fs.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,120,0.5)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#ffe9a8'; ctx.font = '700 13px ui-monospace, monospace';
    ctx.fillText('FOOD STATION', fs.x, fs.y - fs.r - 8);

    // Items
    for (const it of d.items) {
      if (it.taken) continue;
      const def = ITEM_DEF[it.type] || { color: '#fff', label: 'ITEM' };
      ctx.save();
      ctx.translate(it.x, it.y - 4 + Math.sin(t * 2.4 + it.phase) * 2);
      ctx.fillStyle = def.glow || 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(0, 0, it.r + 8, 0, TAU); ctx.fill();
      ctx.fillStyle = def.color;
      ctx.beginPath(); ctx.arc(0, 0, it.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,245,230,0.85)';
      ctx.font = '600 11px ui-monospace, monospace'; ctx.textAlign = 'center';
      let label = def.label || it.type;
      if (it.label) label = it.label;
      if (it.type === 'sample') { const s = SAMPLE_DEFS.find(x => x.id === it.sampleId); label = s ? s.name : label; }
      if (it.type === 'knowledge') { const k = KNOWLEDGE_DEFS.find(x => x.id === it.knowledgeId); label = k ? k.title : label; }
      if (it.type === 'part') { const pr = PART_DEFS.find(x => x.id === it.partId); label = pr ? pr.name : label; }
      ctx.fillText(label, it.x, it.y - it.r - 12);
    }

    // Player
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.face.y, p.face.x));
    ctx.fillStyle = '#ffd9b0';
    ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7fdcff';
    ctx.beginPath(); ctx.arc(4, 0, 5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#40251a'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();

    // Darkness + lantern glow (limited visibility, adventurous)
    const flicker = 1 + Math.sin(t * 7.3) * 0.03 + Math.sin(t * 11.7) * 0.02;
    const lightR = 165 * flicker;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    const fog = ctx.createRadialGradient(p.x, p.y, lightR * 0.15, p.x, p.y, Math.max(d.interior.w, d.interior.h) * 1.1);
    fog.addColorStop(0, 'rgba(0,0,0,0)');
    fog.addColorStop(0.22, 'rgba(0,0,0,0.18)');
    fog.addColorStop(0.5, 'rgba(0,0,0,0.72)');
    fog.addColorStop(1, 'rgba(0,0,0,0.965)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, d.interior.w, d.interior.h);
    // Warm lantern light
    const lamp = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, lightR);
    lamp.addColorStop(0, 'rgba(255,230,170,0.16)');
    lamp.addColorStop(0.35, 'rgba(255,190,120,0.08)');
    lamp.addColorStop(1, 'rgba(255,160,80,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = lamp;
    ctx.beginPath(); ctx.arc(p.x, p.y, lightR, 0, TAU); ctx.fill();
    ctx.restore();

    ctx.restore();

    // Title and hint
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,230,210,0.92)';
    ctx.font = '700 18px ui-monospace, monospace';
    ctx.fillText(d.name.toUpperCase(), VIEW.w / 2, 34);
    ctx.fillStyle = 'rgba(255,220,170,0.7)';
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.fillText('Collect items · Use the food station · Reach EXIT to return outside', VIEW.w / 2, 54);

    if (game.nearAction === 'exitDungeon') {
      ctx.fillStyle = 'rgba(160,255,190,0.95)';
      ctx.font = '700 13px ui-monospace, monospace';
      ctx.fillText('PRESS E TO EXIT', VIEW.w / 2, VIEW.h - 36);
    }

    if (state === 'playing' || state === 'paused') {
      if (now - game.lastMapDraw > 70) { game.lastMapDraw = now; drawMinimap(); }
    }
  }

  const renderEnts = [];
  let groundPlaneStamp = 0;

  function render(now) {
    if (game.location === 'dungeon') { renderDungeon(now); return; }
    const t = now / 1000;
    const p = game.player;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d0705';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!p) return;

    const shake = game.shake + (game.flare.phase === 'active' && !game.sheltered ? 1.7 : 0);
    screenShakeX = (Math.random() * 2 - 1) * shake;
    screenShakeY = (Math.random() * 2 - 1) * shake;
    setupCamera();

    const dpr = VIEW.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const prof0 = performance.now();
    drawSky();
    drawGround(t, now);
    drawHaze();

    // Fading footprints on the Martian surface
    if (game.footprints && game.footprints.length) {
      for (const fp of game.footprints) {
        const pr = projectPoint(fp.x, fp.y, 0);
        if (!pr.visible) continue;
        const a = clamp(fp.life / (fp.maxLife || 14), 0, 1) * 0.22;
        const s = (pr.scale || 0.5) * 16 * (fp.s || 1);
        ctx.save();
        ctx.translate(pr.x, pr.y);
        ctx.rotate((fp.a || 0) - CAM.yaw);
        ctx.fillStyle = `rgba(70,35,22,${a})`;
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.35, s * 0.18, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }

    // Standing objects are depth-sorted billboards.
    renderEnts.length = 0;
    const push = (x, y, fn, obj) => {
      const pr = projectPoint(x, y, 0);
      if (pr.visible) renderEnts.push({ depth: pr.depth, x, y, pr, fn, obj });
    };
    for (const r of game.rocks) push(r.x, r.y, drawRock, r);
    for (const s of game.shelters) push(s.x, s.y, drawShelter, s);
    if (game.commArray) push(game.commArray.x, game.commArray.y, drawCommArray, game.commArray);
    if (game.spaceCentre) push(game.spaceCentre.x, game.spaceCentre.y, drawSpaceCentre, game.spaceCentre);
    if (game.foodCentre) push(game.foodCentre.x, game.foodCentre.y, drawFoodCentre, game.foodCentre);
    for (const oc of (game.extraOxygenChambers || [])) push(oc.x, oc.y, drawSpaceCentre, oc);
    for (const d of (game.dungeons || [])) push(d.entrance.x, d.entrance.y, drawDungeonEntrance, d);
    for (const it of game.items) if (!it.taken) push(it.x, it.y, drawItem, it);
    for (const l of game.logs) if (!l.taken) push(l.x, l.y, drawLog, l);
    // (no extra damaged equipment near launchpad)
    if (game.storyObjects) {
      const so = game.storyObjects;
      // Crash site / rover / pod
      if (so.rover) push(so.rover.x, so.rover.y, drawRover, so.rover);
      if (so.crashPod) push(so.crashPod.x, so.crashPod.y, drawNearPart, so.crashPod);
      // Mission 2
      if (so.oldSupplyChamber) push(so.oldSupplyChamber.x, so.oldSupplyChamber.y, drawFoodCentre, so.oldSupplyChamber);
      // Mission 3/5/7/9 spacecraft area
      if (so.spacecraft) push(so.spacecraft.x, so.spacecraft.y, drawTransmitter, so.spacecraft);
      if (so.heatShieldStation) push(so.heatShieldStation.x, so.heatShieldStation.y, drawNearPart, so.heatShieldStation);
      // Mission 4 volcano & wreck scans
      if (so.volcano) push(so.volcano.x, so.volcano.y, drawCraterMarker, so.volcano);
      if (so.crashEngine) push(so.crashEngine.x, so.crashEngine.y, drawNearPart, so.crashEngine);
      if (so.crashTank) push(so.crashTank.x, so.crashTank.y, drawNearPart, so.crashTank);
      if (so.crashNose) push(so.crashNose.x, so.crashNose.y, drawNearPart, so.crashNose);
      if (so.m4Commsat) push(so.m4Commsat.x, so.m4Commsat.y, drawAntenna, so.m4Commsat);
      // Mission 5
      if (so.magneticCrane) push(so.magneticCrane.x, so.magneticCrane.y, drawAntenna, so.magneticCrane);
      if (so.weldSpot) push(so.weldSpot.x, so.weldSpot.y, drawNearPart, so.weldSpot);
      // Mission 6
      if (so.fuelWreck1) push(so.fuelWreck1.x, so.fuelWreck1.y, drawNearPart, so.fuelWreck1);
      if (so.fuelWreck2) push(so.fuelWreck2.x, so.fuelWreck2.y, drawNearPart, so.fuelWreck2);
      if (so.fuelWreck3) push(so.fuelWreck3.x, so.fuelWreck3.y, drawNearPart, so.fuelWreck3);
      // Mission 7/8
      if (so.thrusterConsole) push(so.thrusterConsole.x, so.thrusterConsole.y, drawAntenna, so.thrusterConsole);
      if (so.solarPanel) push(so.solarPanel.x, so.solarPanel.y, drawSolarPanels, so.solarPanel);
      if (so.waterIceSpot) push(so.waterIceSpot.x, so.waterIceSpot.y, drawWaterIce, so.waterIceSpot);
      // Mission 9
      if (so.satelliteDish) push(so.satelliteDish.x, so.satelliteDish.y, drawAntenna, so.satelliteDish);
      if (so.supplyLoad) push(so.supplyLoad.x, so.supplyLoad.y, drawNearPart, so.supplyLoad);
      if (so.launchClamp1) push(so.launchClamp1.x, so.launchClamp1.y, drawNearPart, so.launchClamp1);
      if (so.launchClamp2) push(so.launchClamp2.x, so.launchClamp2.y, drawNearPart, so.launchClamp2);
      if (so.launchClamp3) push(so.launchClamp3.x, so.launchClamp3.y, drawNearPart, so.launchClamp3);
      if (so.launchClamp4) push(so.launchClamp4.x, so.launchClamp4.y, drawNearPart, so.launchClamp4);
    }
    for (const site of ROVER_SITES) push(site.x, site.y, drawRoverSite, site);
    push(game.lander.x, game.lander.y, drawLander, null);
    push(game.probe.x, game.probe.y, drawProbe, null);
    push(p.x, p.y, drawKid, p);
    renderEnts.sort((a, b) => b.depth - a.depth);
    for (let i = 0; i < renderEnts.length; i++) {
      const e = renderEnts[i];
      drawAt(e.x, e.y, () => e.obj != null ? e.fn(e.obj, t) : e.fn(t), 0, e.pr);
    }

    drawEntityLabels(t);
    drawParticles();
    drawMotes(t);

    // Dust devils: swirling Martian whirlwinds
    if (game.dustDevils && game.dustDevils.length) {
      ctx.save();
      for (const dv of game.dustDevils) {
        const pr = projectPoint(dv.x, dv.y, 0);
        if (!pr.visible) continue;
        const s = (pr.scale || 0.4) * dv.r;
        ctx.globalAlpha = 0.10 + 0.08 * Math.sin(dv.t * 2);
        ctx.strokeStyle = 'rgba(220,170,130,0.55)'; ctx.lineWidth = Math.max(1, s * 0.12);
        ctx.beginPath(); ctx.ellipse(pr.x, pr.y - s * 0.9, s * 0.9, s * 0.28, dv.t * 0.4, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(pr.x + Math.cos(dv.t) * s * 0.2, pr.y - s * 1.6, s * 0.55, s * 0.18, -dv.t * 0.6, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = 'rgba(210,150,110,0.5)';
        ctx.beginPath(); ctx.ellipse(pr.x, pr.y - s * 1.1, s * 0.7, s * 1.4, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawZoneAtmosphere(t);
    drawFlareFX(t);
    drawObjectiveMarker(t);
    // Subtle cinematic vignette
    const vg = ctx.createRadialGradient(VIEW.w * 0.5, VIEW.h * 0.45, Math.min(VIEW.w, VIEW.h) * 0.2, VIEW.w * 0.5, VIEW.h * 0.55, Math.max(VIEW.w, VIEW.h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(10,5,4,0.28)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);

    // Low-oxygen / critical survival pulse for tension and feedback
    if (p && state === 'playing') {
      const o2p = p.o2 / (p.maxO2 || 100);
      if (o2p < 0.22 || p.rad > 80 || p.suit < 20) {
        const pulse = 0.5 + 0.5 * Math.sin(t * (o2p < 0.12 ? 5.5 : 3.2));
        const a = (o2p < 0.22 ? (0.22 - o2p) / 0.22 : 0.4) * (0.08 + 0.12 * pulse);
        const cg = ctx.createRadialGradient(VIEW.w * 0.5, VIEW.h * 0.5, Math.min(VIEW.w, VIEW.h) * 0.18, VIEW.w * 0.5, VIEW.h * 0.5, Math.max(VIEW.w, VIEW.h) * 0.7);
        cg.addColorStop(0, 'rgba(120,20,10,0)');
        cg.addColorStop(1, `rgba(160,30,20,${clamp(a, 0, 0.22)})`);
        ctx.fillStyle = cg;
        ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      }
    }

    if (state === 'playing' || state === 'paused') {
      if (now - game.lastMapDraw > 70) {
        game.lastMapDraw = now;
        drawMinimap();
      }
    }
  }

  function drawSky() {
    const horizon = clamp(CAM.horizon, -80, VIEW.h + 80);
    const skyBottom = Math.max(0, horizon);
    const t = performance.now() * 0.001;
    const g = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizon));
    g.addColorStop(0, '#07040d');
    g.addColorStop(0.22, '#140b16');
    g.addColorStop(0.45, '#281018');
    g.addColorStop(0.68, '#4a2216');
    g.addColorStop(0.86, '#7a3a24');
    g.addColorStop(1, '#b85a32');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.w, skyBottom);

    // Stars
    ctx.save();
    for (let i = 0; i < 90; i++) {
      const sx = (i * 137.5) % VIEW.w;
      const sy = ((i * 97.3) % Math.max(60, skyBottom - 20)) + 8;
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (0.7 + (i % 5) * 0.23) + i));
      ctx.globalAlpha = 0.14 + tw * 0.42;
      ctx.fillStyle = i % 7 === 0 ? '#ffe4cc' : '#fff7f0';
      ctx.beginPath();
      ctx.arc(sx, sy, i % 11 === 0 ? 1.6 : 0.85, 0, TAU);
      ctx.fill();
    }
    // Shooting stars for a more alive Martian sky
    if (game.shootingStars) {
      for (const st of game.shootingStars) {
        const a = clamp(st.life / 1.1, 0, 1);
        const tx = st.x - (st.vx / Math.hypot(st.vx, st.vy)) * st.len;
        const ty = st.y - (st.vy / Math.hypot(st.vx, st.vy)) * st.len;
        const sg = ctx.createLinearGradient(st.x, st.y, tx, ty);
        sg.addColorStop(0, `rgba(255,245,230,${0.85 * a})`);
        sg.addColorStop(1, 'rgba(255,245,230,0)');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = sg; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(tx, ty); ctx.stroke();
      }
    }
    ctx.restore();

    // Ground base under the warped plane
    ctx.fillStyle = '#24140e';
    ctx.fillRect(0, skyBottom, VIEW.w, VIEW.h - skyBottom);

    // Dual horizon glow
    const sunX = VIEW.w * 0.62;
    const rg = ctx.createRadialGradient(sunX, horizon - 18, 10, sunX, horizon + 10, VIEW.w * 0.38);
    rg.addColorStop(0, 'rgba(255,220,170,0.26)');
    rg.addColorStop(0.45, 'rgba(255,150,90,0.16)');
    rg.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, Math.max(0, horizon - 160), VIEW.w, 240);

    const glow = ctx.createLinearGradient(0, horizon - 130, 0, horizon + 34);
    glow.addColorStop(0, 'rgba(255,132,72,0)');
    glow.addColorStop(0.55, 'rgba(255,128,68,0.14)');
    glow.addColorStop(1, 'rgba(255,180,120,0.3)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, Math.max(0, horizon - 130), VIEW.w, 180);
  }

  function drawHaze() {
    const hz = CAM.horizon;
    const y0 = Math.max(0, hz - 34);
    const y1 = Math.min(VIEW.h, hz + Math.max(150, VIEW.h * 0.24));
    if (y1 <= y0) return;
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(82,40,26,0.97)');
    g.addColorStop(0.22, 'rgba(96,48,30,0.82)');
    g.addColorStop(0.56, 'rgba(86,43,28,0.38)');
    g.addColorStop(1, 'rgba(64,31,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, VIEW.w, y1 - y0);
  }

  function drawGround(t, now) {
    let g = groundPlane;
    if (!g) {
      renderGroundPlane(t);
      g = groundPlane;
    } else {
      const pose = `${g.width},${g.height},${CAM.camX.toFixed(1)},${CAM.camY.toFixed(1)},${CAM.yaw.toFixed(4)},${CAM.pitch.toFixed(4)},${CAM.dist.toFixed(1)}`;
      const anim = Math.floor(t * 12);
      const stamp = `${pose}|${anim}`;
      if (stamp !== groundPlaneStamp) {
        renderGroundPlane(t);
        groundPlaneStamp = stamp;
        g = groundPlane;
      }
    }

    const pw = g.width;
    const ph = g.height;
    const px = CAM.pxPerUnit;
    const fp = CAM.focal;
    const cx = CAM.cx;
    const cy = CAM.cy;
    const startY = Math.max(0, Math.ceil(CAM.horizon) + 1);

    ctx.imageSmoothingEnabled = false;
    // Grouping rows keeps the per-row drawImage overhead down. Over four
    // pixels the perspective change is tiny apart from the fogged horizon.
    const ROW_STEP = 4;
    for (let y = startY; y < VIEW.h; y += ROW_STEP) {
      const yEnd = Math.min(VIEW.h, y + ROW_STEP);
      const v = (cy - (y + yEnd) * 0.5) / fp;
      const denom = CAM.H - v * CAM.D;
      if (denom <= 0.001) continue;
      const Lc = CAM.H * (CAM.D + v * CAM.H) / denom;
      if (Lc <= 18 || Lc > CAM.planeDepth) continue;

      const vTop = (cy - (y + 0.5)) / fp;
      const dTop = CAM.H - vTop * CAM.D;
      const vBot = (cy - (yEnd + 0.5)) / fp;
      const dBot = CAM.H - vBot * CAM.D;
      if (dTop <= 0.001 || dBot <= 0.001) continue;
      const LTop = Math.min(CAM.planeDepth, CAM.H * (CAM.D + vTop * CAM.H) / dTop);
      const LBot = clamp(CAM.H * (CAM.D + vBot * CAM.H) / dBot, 0, CAM.planeDepth);
      if (LTop - LBot < 0.02) continue;

      const sy = LBot * px;
      const sh = (LTop - LBot) * px;
      const lambda = CAM.H * CAM.d / denom;
      const sw = (lambda * VIEW.w / fp) * px;
      if (sw < 0.5) continue;
      let s0 = pw / 2 - sw / 2;
      let s1 = s0 + sw;
      let d0 = 0;
      let d1 = VIEW.w;
      if (s1 <= 0 || s0 >= pw) continue;
      if (s0 < 0) {
        d0 = (-s0 / sw) * VIEW.w;
        s0 = 0;
      }
      if (s1 > pw) {
        d1 = VIEW.w - ((s1 - pw) / sw) * VIEW.w;
        s1 = pw;
      }
      if (s1 - s0 < 0.2 || d1 - d0 < 0.2) continue;
      ctx.drawImage(g, s0, sy, s1 - s0, sh, d0, y, d1 - d0, (yEnd - y) + 0.6);
    }
    ctx.imageSmoothingEnabled = false;
  }

  function renderGroundPlane(t) {
    const g = gctx;
    const w = groundPlane.width;
    const h = groundPlane.height;
    const px = CAM.pxPerUnit;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#2f1a12';
    g.fillRect(0, 0, w, h);

    // World -> camera-aligned ground plane. Source +y is forward from the
    // camera; source +x is screen-right.
    const a = px * CAM.rx;
    const b = px * CAM.fx;
    const c = px * CAM.ry;
    const d = px * CAM.fy;
    const e = w / 2 - px * (CAM.rx * CAM.camX + CAM.ry * CAM.camY);
    const f = -px * (CAM.fx * CAM.camX + CAM.fy * CAM.camY);
    g.setTransform(a, b, c, d, e, f);
    g.imageSmoothingEnabled = false;

    const toWorld = (sx, sy) => {
      const A = (sx - w / 2) / px;
      const B = sy / px;
      return {
        x: CAM.camX + A * CAM.rx + B * CAM.fx,
        y: CAM.camY + A * CAM.ry + B * CAM.fy
      };
    };
    const c0 = toWorld(0, 0);
    const c1 = toWorld(w, 0);
    const c2 = toWorld(0, h);
    const c3 = toWorld(w, h);
    const minX = Math.min(c0.x, c1.x, c2.x, c3.x) - 8;
    const maxX = Math.max(c0.x, c1.x, c2.x, c3.x) + 8;
    const minY = Math.min(c0.y, c1.y, c2.y, c3.y) - 8;
    const maxY = Math.max(c0.y, c1.y, c2.y, c3.y) + 8;
    const x0 = Math.floor(minX / CHUNK);
    const x1 = Math.floor(maxX / CHUNK);
    const y0 = Math.floor(minY / CHUNK);
    const y1 = Math.floor(maxY / CHUNK);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const wx = cx * CHUNK;
        const wy = cy * CHUNK;
        // Cull chunks whose camera-space footprint is entirely outside the
        // ground plane (notably the ones behind the camera).
        const sx0 = a * wx + c * wy + e;
        const sy0 = b * wx + d * wy + f;
        const sx1 = a * (wx + CHUNK) + c * wy + e;
        const sy1 = b * (wx + CHUNK) + d * wy + f;
        const sx2 = a * wx + c * (wy + CHUNK) + e;
        const sy2 = b * wx + d * (wy + CHUNK) + f;
        const sx3 = a * (wx + CHUNK) + c * (wy + CHUNK) + e;
        const sy3 = b * (wx + CHUNK) + d * (wy + CHUNK) + f;
        if (Math.max(sx0, sx1, sx2, sx3) < -4 ||
          Math.min(sx0, sx1, sx2, sx3) > w + 4 ||
          Math.max(sy0, sy1, sy2, sy3) < -4 ||
          Math.min(sy0, sy1, sy2, sy3) > h + 4) continue;
        g.drawImage(getChunk(cx, cy), wx, wy, CHUNK, CHUNK);
      }
    }

    paintGroundDecals(g, t);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  function paintGroundDecals(g, t) {
    const L = game.lander;
    g.save();
    // Lander: radiation-safe pad (no refill)
    g.lineWidth = 2.4;
    g.setLineDash([8, 13]);
    g.strokeStyle = `rgba(112,240,168,${0.13 + Math.sin(t * 2) * 0.025})`;
    g.beginPath();
    g.arc(L.x, L.y, L.safeR, 0, TAU);
    g.stroke();
    g.setLineDash([]);

    // Habitats: radiation shelters
    game.shelters.forEach((sh, i) => {
      const pulse = 0.12 + Math.sin(t * 1.7 + i) * 0.03;
      g.strokeStyle = `rgba(112,240,168,${pulse})`;
      g.lineWidth = 2.6;
      g.beginPath();
      g.arc(sh.x, sh.y, sh.safeR, 0, TAU);
      g.stroke();

      g.fillStyle = 'rgba(40,22,16,0.42)';
      g.beginPath();
      g.arc(sh.x, sh.y, sh.padR, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(255,196,150,0.16)';
      g.lineWidth = 2.4;
      g.beginPath();
      g.arc(sh.x, sh.y, sh.padR, 0, TAU);
      g.stroke();
      g.strokeStyle = 'rgba(255,196,150,0.09)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(sh.x, sh.y, sh.padR - 13, 0, TAU);
      g.stroke();
    });

    // Space Centre: oxygen refill
    if (game.spaceCentre) {
      const sc = game.spaceCentre;
      const pulse = 0.14 + Math.sin(t * 2.1) * 0.03;
      g.fillStyle = 'rgba(30,40,48,0.42)';
      g.beginPath(); g.arc(sc.x, sc.y, sc.padR, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(150,220,255,0.18)'; g.lineWidth = 2.4;
      g.beginPath(); g.arc(sc.x, sc.y, sc.padR, 0, TAU); g.stroke();
      g.fillStyle = `rgba(70,220,245,${pulse * 0.28})`;
      g.beginPath(); g.arc(sc.x, sc.y, sc.refillR, 0, TAU); g.fill();
      g.strokeStyle = `rgba(110,235,255,${pulse + 0.12})`;
      g.lineWidth = 2.6; g.setLineDash([10, 16]);
      g.beginPath(); g.arc(sc.x, sc.y, sc.refillR - 6, 0, TAU); g.stroke();
      g.setLineDash([]);
    }

    // Food Centre: food refill
    if (game.foodCentre) {
      const fc = game.foodCentre;
      const pulse = 0.14 + Math.sin(t * 2.0) * 0.03;
      g.fillStyle = 'rgba(46,38,22,0.42)';
      g.beginPath(); g.arc(fc.x, fc.y, fc.padR, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,210,140,0.18)'; g.lineWidth = 2.4;
      g.beginPath(); g.arc(fc.x, fc.y, fc.padR, 0, TAU); g.stroke();
      g.fillStyle = `rgba(255,210,90,${pulse * 0.24})`;
      g.beginPath(); g.arc(fc.x, fc.y, fc.refillR, 0, TAU); g.fill();
      g.strokeStyle = `rgba(255,220,120,${pulse + 0.12})`;
      g.lineWidth = 2.6; g.setLineDash([10, 16]);
      g.beginPath(); g.arc(fc.x, fc.y, fc.refillR - 6, 0, TAU); g.stroke();
      g.setLineDash([]);
    }

    // Dungeon entrances
    for (const d of (game.dungeons || [])) {
      const e = d.entrance;
      g.fillStyle = 'rgba(30,20,16,0.55)';
      g.beginPath(); g.arc(e.x, e.y, e.r + 18, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(200,150,110,0.35)';
      g.lineWidth = 2; g.setLineDash([6, 8]);
      g.beginPath(); g.arc(e.x, e.y, e.r + 10, 0, TAU); g.stroke();
      g.setLineDash([]);
    }
    g.restore();
  }

  function drawCrate(x, y, w, h) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(18,8,4,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 1, w * 0.62, 4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#4a3426';
    roundRect(ctx, -w / 2, -h, w, h, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,180,110,0.18)';
    ctx.fillRect(-w / 2, -h, w, 3);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    roundRect(ctx, -w / 2, -h, w, h, 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,200,140,0.14)';
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h * 0.55);
    ctx.lineTo(w / 2, -h * 0.55);
    ctx.stroke();
    ctx.restore();
  }

  // A habitat dome, drawn upright at its ground anchor.
  function drawShelter(sh, t) {
    const R = 74;
    const H = 92;
    const pulse = 0.6 + 0.4 * Math.sin(t * 1.8 + sh.x * 0.001);

    // Ground shadow
    ctx.fillStyle = 'rgba(24,8,3,0.34)';
    ctx.beginPath();
    ctx.ellipse(6, 2, R + 16, 24, 0, 0, TAU);
    ctx.fill();

    // Solar panels lying on the pad
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * (R - 4), -4);
      if (side < 0) ctx.scale(-1, 1);
      ctx.beginPath();
      const w = 34;
      ctx.moveTo(-w, 6);
      ctx.lineTo(w * 0.55, -7);
      ctx.lineTo(w, -2);
      ctx.lineTo(-w * 0.55, 12);
      ctx.closePath();
      ctx.fillStyle = 'rgba(24,46,56,0.88)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,210,225,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120,210,225,0.10)';
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(k * 12, -4);
        ctx.lineTo(k * 12 - 10, 8);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Oxygen recycler stack
    ctx.save();
    ctx.translate(R + 8, 0);
    ctx.fillStyle = 'rgba(12,6,3,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 1, 12, 4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#c9d3cd';
    roundRect(ctx, -7, -40, 14, 40, 6);
    ctx.fill();
    ctx.fillStyle = '#67e6c2';
    ctx.fillRect(-7, -28, 14, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(-7, -9, 14, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(-5, -37, 3, 22);
    ctx.restore();

    // Supply crates
    drawCrate(-R - 4, 4, 18, 14);
    drawCrate(-R + 14, 10, 14, 11);

    // Dome body
    ctx.beginPath();
    ctx.moveTo(-R, 0);
    ctx.bezierCurveTo(-R, -H * 1.02, R, -H * 1.02, R, 0);
    ctx.quadraticCurveTo(R * 0.6, 7, 0, 7);
    ctx.quadraticCurveTo(-R * 0.6, 7, -R, 0);
    ctx.closePath();
    ctx.fillStyle = sh.glassGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,212,175,0.34)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Base skirt
    ctx.beginPath();
    ctx.ellipse(0, 2, R, 12, 0, 0, TAU);
    ctx.strokeStyle = 'rgba(255,196,150,0.16)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dome ribs
    ctx.strokeStyle = 'rgba(255,220,190,0.13)';
    ctx.lineWidth = 1.2;
    for (const m of [-0.55, 0, 0.55]) {
      ctx.beginPath();
      ctx.moveTo(m * R, 3);
      ctx.bezierCurveTo(m * R * 1.02, -H * 0.42, m * R * 0.62, -H * 0.94, m * R * 0.2, -H * 0.97);
      ctx.stroke();
    }
    for (const h of [-0.34, -0.66]) {
      const rx = R * Math.sqrt(Math.max(0, 1 - (h * 1.02) ** 2));
      ctx.beginPath();
      ctx.ellipse(0, H * h, rx, rx * 0.16, 0, 0, Math.PI);
      ctx.stroke();
    }

    // Glass highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-R * 0.78, -8);
    ctx.quadraticCurveTo(-R * 0.55, -H * 0.92, R * 0.12, -H * 0.96);
    ctx.stroke();

    // Airlock
    ctx.fillStyle = 'rgba(38,24,18,0.82)';
    roundRect(ctx, -15, -16, 30, 25, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,205,165,0.35)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.fillStyle = `rgba(112,240,168,${0.18 + pulse * 0.25})`;
    ctx.fillRect(-8, -9, 16, 4);
    ctx.fillStyle = 'rgba(20,10,6,0.5)';
    ctx.fillRect(-2, -13, 4, 20);

    // Antenna and link light
    ctx.strokeStyle = 'rgba(230,220,205,0.65)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(R * 0.42, -H * 0.82);
    ctx.lineTo(R * 0.58, -H - 18);
    ctx.stroke();
    ctx.fillStyle = `rgba(120,255,170,${0.35 + pulse * 0.55})`;
    ctx.shadowColor = '#6dffa3';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(R * 0.58, -H - 19, 2.6, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Screen-space labels for landmarks, drawn above the billboards.
  function drawEntityLabels(t) {
    const p = game.player;
    const q = game.quest;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.72)';
    ctx.shadowBlur = 4;
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';

    const label = (pr, text, lift, color) => {
      if (!pr.visible) return;
      const a = fogAlpha(pr.L) * clamp((pr.depth - 55) / 120, 0, 1);
      if (a < 0.05) return;
      ctx.globalAlpha = a;
      ctx.fillStyle = color;
      ctx.fillText(text, pr.x, pr.y - lift * pr.scale);
    };

    for (const sh of game.shelters) {
      label(w2s(sh.x, sh.y), `${sh.name} · RADIATION SHELTER`, 112, 'rgba(190,245,210,0.62)');
    }
    if (game.spaceCentre) {
      label(w2s(game.spaceCentre.x, game.spaceCentre.y), 'ARES SPACE CENTRE · O₂', 128, 'rgba(170,240,255,0.78)');
    }
    if (game.foodCentre) {
      label(w2s(game.foodCentre.x, game.foodCentre.y), 'HYDROPONICS BAY · FOOD', 124, 'rgba(255,230,170,0.78)');
    }
    for (const oc of (game.extraOxygenChambers || [])) {
      label(w2s(oc.x, oc.y), (oc.name || 'OXYGEN CHAMBER') + ' · O₂', 118, 'rgba(170,240,255,0.78)');
    }
    for (const d of (game.dungeons || [])) {
      label(w2s(d.entrance.x, d.entrance.y), `${d.name.toUpperCase()} · DUNGEON`, 92, 'rgba(255,210,170,0.72)');
    }


    if (game.commArray) {
      const ca = game.commArray;
      const cs = w2s(ca.x, ca.y);
      label(cs, 'COMM ARRAY', 132, 'rgba(150,255,220,0.75)');
    }

    const L = game.lander;
    const s = game.story || {};
    const ls = w2s(L.x, L.y);
    const beaconLabel = s.m9Launched ? 'CRASH SITE · LAUNCHED' : 'CRASH SITE / LANDING POD';
    label(ls, beaconLabel, 138, s.m9Launched ? 'rgba(150,255,190,0.9)' : 'rgba(255,224,196,0.62)');

    // Prompts for dungeon entrances
    for (const d of (game.dungeons || [])) {
      const pr = w2s(d.entrance.x, d.entrance.y);
      if (!pr.visible) continue;
      if (dist(p.x, p.y, d.entrance.x, d.entrance.y) < d.entrance.r + 18) {
        ctx.globalAlpha = 1;
        ctx.font = '700 11px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillStyle = 'rgba(255,226,150,0.92)';
        ctx.fillText(`PRESS E TO ENTER ${d.name.toUpperCase()}`, pr.x, pr.y - 108 * pr.scale);
      }
    }

    if (game.probe) {
      const prb = w2s(game.probe.x, game.probe.y);
      ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      label(prb, 'SURVEY PROBE K-9', 92, 'rgba(255,220,196,0.55)');
    }

    // Story objects — new mission plan
    if (game.storyObjects) {
      const so = game.storyObjects;
      const s = game.story || {};
      if (so.crashPod) label(w2s(so.crashPod.x, so.crashPod.y), s.m1PodInspected ? 'POD · INSPECTED' : 'CRASHED POD', 70, s.m1PodInspected ? 'rgba(170,255,220,0.85)' : 'rgba(255,220,170,0.85)');
      if (so.rover) label(w2s(so.rover.x, so.rover.y), s.m1RoverRepaired ? 'ROVER · REPAIRED' : 'ROVER · DAMAGED', 70, s.m1RoverRepaired ? 'rgba(170,255,220,0.85)' : 'rgba(255,210,160,0.85)');
      if (so.oldSupplyChamber) label(w2s(so.oldSupplyChamber.x, so.oldSupplyChamber.y), s.m2OldChamberReached ? 'OLD SUPPLY CHAMBER · OPEN' : 'OLD OXYGEN & FOOD CHAMBER', 96, s.m2OldChamberReached ? 'rgba(170,255,220,0.85)' : 'rgba(255,230,170,0.85)');
      if (so.heatShieldStation) label(w2s(so.heatShieldStation.x, so.heatShieldStation.y), s.m3HeatShieldsEquipped ? 'HEAT SHIELDS · EQUIPPED' : 'HEAT SHIELD STATION', 84, s.m3HeatShieldsEquipped ? 'rgba(170,255,220,0.85)' : 'rgba(255,220,170,0.85)');
      if (so.volcano) label(w2s(so.volcano.x, so.volcano.y), 'VOLCANO BIOME · OBSIDIAN ZONE', 100, 'rgba(255,170,120,0.85)');
      if (so.crashEngine) label(w2s(so.crashEngine.x, so.crashEngine.y), s.m4ScannedEngine ? 'CRASHED SHIP · ENGINE SCANNED' : 'CRASHED SHIP · ENGINE', 90, s.m4ScannedEngine ? 'rgba(170,255,220,0.85)' : 'rgba(255,220,170,0.85)');
      if (so.crashTank) label(w2s(so.crashTank.x, so.crashTank.y), s.m4ScannedTank ? 'CRASHED SHIP · FUEL TANK SCANNED' : 'CRASHED SHIP · FUEL TANK', 96, s.m4ScannedTank ? 'rgba(170,255,220,0.85)' : 'rgba(255,220,170,0.85)');
      if (so.crashNose) label(w2s(so.crashNose.x, so.crashNose.y), s.m4ScannedNose ? 'CRASHED SHIP · NOSE CONE SCANNED' : 'CRASHED SHIP · NOSE CONE', 96, s.m4ScannedNose ? 'rgba(170,255,220,0.85)' : 'rgba(255,220,170,0.85)');
      if (so.m4Commsat) label(w2s(so.m4Commsat.x, so.m4Commsat.y), s.m4CommsatFixed ? 'COMMSAT · ONLINE (CONTACT VIJAY)' : ((s.m4CommsatParts||0)>=3 ? 'COMMSAT · READY TO REPAIR' : 'BROKEN COMMSAT'), 110, s.m4CommsatFixed ? 'rgba(170,255,220,0.9)' : 'rgba(255,220,170,0.85)');
      if (so.magneticCrane) label(w2s(so.magneticCrane.x, so.magneticCrane.y), s.m5EngineHauled ? 'MAGNETIC CRANE · ENGINE HAULED' : 'MAGNETIC CRANE', 92, s.m5EngineHauled ? 'rgba(170,255,220,0.85)' : 'rgba(255,230,170,0.85)');
      if (so.weldSpot) label(w2s(so.weldSpot.x, so.weldSpot.y), s.m5HullWelded ? 'ROCKET HULL · WELDED' : 'ROCKET HULL · CRACKED', 86, s.m5HullWelded ? 'rgba(170,255,220,0.85)' : 'rgba(255,210,160,0.85)');
      if (so.fuelWreck1) label(w2s(so.fuelWreck1.x, so.fuelWreck1.y), s.m6Fuel1 ? 'WRECKED SHIP · FUEL SIPHONED' : 'WRECKED SHIP · FUEL (1/3)', 94, s.m6Fuel1 ? 'rgba(170,255,220,0.85)' : 'rgba(255,220,170,0.85)');
      if (so.fuelWreck2) label(w2s(so.fuelWreck2.x, so.fuelWreck2.y), s.m6Fuel2 ? 'WRECKED SHIP · FUEL SIPHONED' : 'WRECKED SHIP · FUEL (2/3)', 94, s.m6Fuel2 ? 'rgba(170,255,220,0.85)' : 'rgba(255,220,170,0.85)');
      if (so.fuelWreck3) label(w2s(so.fuelWreck3.x, so.fuelWreck3.y), s.m6Fuel3 ? 'WRECKED SHIP · FUEL SIPHONED' : 'WRECKED SHIP · FUEL (3/3)', 94, s.m6Fuel3 ? 'rgba(170,255,220,0.85)' : 'rgba(255,220,170,0.85)');
      if (so.thrusterConsole) label(w2s(so.thrusterConsole.x, so.thrusterConsole.y), s.m7ThrustersTested ? 'THRUSTER CONSOLE · TESTED' : 'THRUSTER CONSOLE', 90, s.m7ThrustersTested ? 'rgba(170,255,220,0.85)' : 'rgba(255,230,170,0.85)');
      if (so.solarPanel) label(w2s(so.solarPanel.x, so.solarPanel.y), s.m8SolarChecked ? 'SOLAR PANELS · CHECKED' : 'SOLAR PANELS', 80, s.m8SolarChecked ? 'rgba(170,255,220,0.85)' : 'rgba(255,220,170,0.85)');
      if (so.waterIceSpot) label(w2s(so.waterIceSpot.x, so.waterIceSpot.y), s.m8WaterIceReached ? 'WATER ICE SPOT · VISITED' : 'WATER ICE SPOT', 84, s.m8WaterIceReached ? 'rgba(170,255,220,0.85)' : 'rgba(180,240,255,0.85)');
      if (so.satelliteDish) label(w2s(so.satelliteDish.x, so.satelliteDish.y), s.m9DishAligned ? 'SATELLITE DISH · ALIGNED' : 'SATELLITE DISH', 86, s.m9DishAligned ? 'rgba(170,255,220,0.85)' : 'rgba(255,230,170,0.85)');
      if (so.supplyLoad) label(w2s(so.supplyLoad.x, so.supplyLoad.y), s.m9SuppliesLoaded ? 'SUPPLIES · LOADED' : 'SUPPLY LOAD POINT', 84, s.m9SuppliesLoaded ? 'rgba(170,255,220,0.85)' : 'rgba(255,220,170,0.85)');
      if (so.launchClamp1) label(w2s(so.launchClamp1.x, so.launchClamp1.y), so.launchClamp1.released ? 'CLAMP 1 · RELEASED' : 'LAUNCH CLAMP 1', 64, so.launchClamp1.released ? 'rgba(170,255,220,0.85)' : 'rgba(255,210,160,0.85)');
      if (so.launchClamp2) label(w2s(so.launchClamp2.x, so.launchClamp2.y), so.launchClamp2.released ? 'CLAMP 2 · RELEASED' : 'LAUNCH CLAMP 2', 64, so.launchClamp2.released ? 'rgba(170,255,220,0.85)' : 'rgba(255,210,160,0.85)');
      if (so.launchClamp3) label(w2s(so.launchClamp3.x, so.launchClamp3.y), so.launchClamp3.released ? 'CLAMP 3 · RELEASED' : 'LAUNCH CLAMP 3', 64, so.launchClamp3.released ? 'rgba(170,255,220,0.85)' : 'rgba(255,210,160,0.85)');
      if (so.launchClamp4) label(w2s(so.launchClamp4.x, so.launchClamp4.y), so.launchClamp4.released ? 'CLAMP 4 · RELEASED' : 'LAUNCH CLAMP 4', 64, so.launchClamp4.released ? 'rgba(170,255,220,0.85)' : 'rgba(255,210,160,0.85)');
      if (so.spacecraft) label(w2s(so.spacecraft.x, so.spacecraft.y), s.m9Launched ? 'ROCKET · LAUNCHED' : 'ROCKET / LAUNCHPAD', 86, s.m9Launched ? 'rgba(170,255,210,0.9)' : 'rgba(255,230,190,0.85)');
    }

    // Real Mars rover landing sites with country flags — educational mission info
    for (const site of ROVER_SITES) {
      const pr = w2s(site.x, site.y);
      label(pr, `${site.name} · ${site.year}`, 78, 'rgba(255,235,210,0.9)');
      label(pr, `FLAG: ${site.flag} (${site.country}) · Press E for mission info`, 64, 'rgba(180,220,255,0.84)');
      if (pr.visible && dist(p.x, p.y, site.x, site.y) < 70) {
        const a = 0.55 + 0.45 * Math.sin(t * 5);
        ctx.globalAlpha = 1; ctx.font = '700 11px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillStyle = `rgba(255,226,150,${a})`;
        ctx.fillText('PRESS E FOR ROVER MISSION INFO', pr.x, pr.y - 98 * pr.scale);
      }
    }
    ctx.restore();
  }

  function drawItem(it, t) {
    const def = ITEM_DEF[it.type];
    const bob = Math.sin(t * 2.2 + it.phase) * 2.2;
    const pulse = 0.72 + 0.28 * Math.sin(t * 3.1 + it.phase);

    // Ground shadow
    ctx.fillStyle = 'rgba(20,8,3,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 4, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(0, -13 - bob);

    // Soft halo
    ctx.globalAlpha = 0.55 * pulse;
    ctx.fillStyle = def.glow;
    ctx.beginPath();
    ctx.arc(0, 0, 19 + pulse * 4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Target ring
    ctx.strokeStyle = def.color;
    ctx.globalAlpha = 0.25 + pulse * 0.18;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, 14.5, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (it.type === 'rad') {
      ctx.fillStyle = '#d9b5ff';
      roundRect(ctx, -5, -8.5, 10, 17, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(80,40,120,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(-1, -7, 2, 14);
    } else if (it.type === 'cell') {
      ctx.fillStyle = '#2a2413';
      roundRect(ctx, -6.5, -11, 13, 22, 3);
      ctx.fill();
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(1.5, -7);
      ctx.lineTo(-3.5, 0.5);
      ctx.lineTo(-0.4, 0.5);
      ctx.lineTo(-1.5, 7);
      ctx.lineTo(3.7, -1);
      ctx.lineTo(0.4, -1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#8a7a3f';
      ctx.fillRect(-3, -13, 6, 2.5);
    } else if (it.type === 'amp') {
      ctx.fillStyle = '#1d3339';
      roundRect(ctx, -9, -9, 18, 19, 3);
      ctx.fill();
      ctx.strokeStyle = '#7ef0ff';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(140,245,255,0.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, -3, 5.4, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.fillStyle = '#9ef7ff';
      ctx.beginPath();
      ctx.arc(0, -3, 1.7, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(140,245,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(0, -8.6);
      ctx.lineTo(0, -14);
      ctx.stroke();
      ctx.fillStyle = '#bff9ff';
      ctx.fillRect(-4, 4, 8, 2);
      ctx.fillRect(-4, 7.5, 5, 1.6);
    } else if (it.type === 'tank') {
      ctx.fillStyle = '#d9fff1';
      roundRect(ctx, -8, -8, 7.5, 17, 3);
      ctx.fill();
      roundRect(ctx, 0.5, -8, 7.5, 17, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,90,70,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#4fe3b0';
      ctx.fillRect(-8, -3, 7.5, 3);
      ctx.fillRect(0.5, -3, 7.5, 3);
      ctx.fillStyle = '#7ef0c8';
      ctx.fillRect(-4, -11, 8, 3);
    } else if (it.type === 'lining') {
      ctx.fillStyle = '#3a2450';
      roundRect(ctx, -8, -8, 16, 17, 4);
      ctx.fill();
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(225,185,255,0.75)';
      ctx.lineWidth = 1;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(-6, k * 4);
        ctx.lineTo(6, k * 4 - 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#e6c8ff';
      ctx.beginPath();
      ctx.arc(0, -8.5, 2.2, 0, TAU);
      ctx.fill();
    } else if (it.type === 'boots') {
      ctx.fillStyle = '#4a2a17';
      roundRect(ctx, -9, -6, 8, 13, 2);
      ctx.fill();
      roundRect(ctx, 1, -6, 8, 13, 2);
      ctx.fill();
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#ffcf9a';
      ctx.fillRect(-9, 4, 8, 3);
      ctx.fillRect(1, 4, 8, 3);
    } else if (it.type === 'sample') {
      ctx.fillStyle = '#6b3a24';
      ctx.beginPath();
      ctx.moveTo(0, -10); ctx.lineTo(9, -2); ctx.lineTo(6, 9); ctx.lineTo(-6, 9); ctx.lineTo(-9, -2);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = def.color; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = 'rgba(255,210,170,0.35)';
      ctx.beginPath(); ctx.moveTo(-2, -7); ctx.lineTo(4, -2); ctx.lineTo(1, 4); ctx.closePath(); ctx.fill();
    } else if (it.type === 'knowledge') {
      ctx.fillStyle = '#163746';
      roundRect(ctx, -9, -7, 18, 14, 3); ctx.fill();
      ctx.strokeStyle = def.color; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = '#bff4ff';
      ctx.fillRect(-5, -3, 10, 2);
      ctx.fillRect(-5, 1, 7, 2);
      ctx.fillRect(4, -5, 2, 10);
    } else if (it.type === 'part') {
      ctx.fillStyle = '#4a3a1a';
      roundRect(ctx, -8, -8, 16, 16, 3); ctx.fill();
      ctx.strokeStyle = def.color; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#ffe08a';
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const r = i % 2 ? 3 : 6;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = def.color || '#fff';
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawLog(l, t) {
    const bob = Math.sin(t * 1.8 + l.phase) * 2;
    const pulse = 0.6 + 0.4 * Math.sin(t * 2.6 + l.phase);

    ctx.fillStyle = 'rgba(26,10,5,0.32)';
    ctx.beginPath();
    ctx.ellipse(2, 0, 10, 3.6, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(0, -13 - bob);

    ctx.globalAlpha = 0.4 * pulse;
    ctx.fillStyle = 'rgba(90,225,245,0.32)';
    ctx.beginPath();
    ctx.arc(0, 0, 16 + pulse * 3, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.rotate(-0.16);
    ctx.fillStyle = '#132a30';
    roundRect(ctx, -6.5, -9, 13, 18, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(140,240,255,0.75)';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.fillStyle = `rgba(150,245,255,${0.5 + pulse * 0.4})`;
    ctx.fillRect(-3.5, -5.5, 7, 1.4);
    ctx.fillRect(-3.5, -2.6, 5, 1.2);
    ctx.fillRect(-3.5, 0.3, 6.5, 1.2);
    ctx.fillStyle = 'rgba(90,220,240,0.35)';
    ctx.fillRect(-3.5, 3.6, 7, 2.4);
    ctx.restore();

    ctx.restore();
  }

  function drawProbe(t) {
    const pr = game.probe;
    const active = game.probe.active || game.quest.amplifier;
    const blink = 0.5 + 0.5 * Math.sin(t * (active ? 6 : 2.4));

    // Scanning pulse on the ground
    if (active) {
      ctx.strokeStyle = `rgba(120,240,255,${0.12 + blink * 0.16})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 54 + blink * 8, 20 + blink * 3, 0, 0, TAU);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(0, -24);

    // Shadow
    ctx.fillStyle = 'rgba(24,8,3,0.4)';
    ctx.beginPath();
    ctx.ellipse(4, 24, 40, 12, 0, 0, TAU);
    ctx.fill();

    // Bent landing legs
    ctx.strokeStyle = '#96887a';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-15, 2); ctx.lineTo(-30, 23); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(15, 2); ctx.lineTo(27, 22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(-4, 25); ctx.stroke();

    // Tilted body
    ctx.save();
    ctx.rotate(-0.18);
    ctx.fillStyle = '#cdbfa9';
    roundRect(ctx, -19, -18, 38, 34, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(55,38,26,0.5)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = '#8f7d68';
    ctx.fillRect(-19, -4, 38, 5);
    ctx.fillStyle = '#31424a';
    roundRect(ctx, -9, -12, 18, 8, 2);
    ctx.fill();
    ctx.fillStyle = `rgba(120,235,255,${0.35 + blink * 0.5})`;
    ctx.fillRect(-6, -10, 4, 2);
    ctx.fillStyle = 'rgba(255,140,70,0.7)';
    ctx.fillRect(1, -10, 3, 2);

    // Broken mast and dish
    ctx.strokeStyle = '#b3a491';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(8, -18);
    ctx.lineTo(19, -44);
    ctx.stroke();
    ctx.save();
    ctx.translate(22, -47);
    ctx.rotate(0.5);
    ctx.fillStyle = 'rgba(195,205,200,0.9)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 7, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,100,98,0.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(80,90,88,0.6)';
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(12, 0);
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    // Status beacon
    ctx.fillStyle = active
      ? `rgba(130,245,255,${0.3 + blink * 0.7})`
      : `rgba(255,120,60,${0.25 + blink * 0.5})`;
    ctx.shadowColor = active ? '#7ef0ff' : '#ff7a3c';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(-14, -19, 2.8 + blink * 1.4, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  function drawRock(r) {
    ctx.fillStyle = 'rgba(32,11,5,0.3)';
    ctx.beginPath();
    ctx.ellipse(7, 3, r.r * 0.95, r.r * 0.38, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(0, -r.r * 0.5);

    ctx.beginPath();
    r.pts.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt[0], pt[1]);
      else ctx.lineTo(pt[0], pt[1]);
    });
    ctx.closePath();
    ctx.fillStyle = '#57301f';
    ctx.fill();
    ctx.strokeStyle = 'rgba(34,14,7,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Sunlit facet
    ctx.save();
    ctx.scale(0.66, 0.66);
    ctx.translate(-r.r * 0.12, -r.r * 0.18);
    ctx.beginPath();
    r.pts.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt[0], pt[1]);
      else ctx.lineTo(pt[0], pt[1]);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(176,104,68,0.35)';
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  function drawKid(p, t) {
    const moving = !!p.moving;
    const walk = p.walk || 0;
    const swing = moving ? Math.sin(walk) * 6.2 : Math.sin(t * 1.4) * 0.7;
    const swing2 = moving ? Math.sin(walk + Math.PI) * 6.2 : Math.sin(t * 1.4 + 1.2) * 0.5;
    const bob = moving ? Math.abs(Math.sin(walk * 1.05)) * 2.8 : Math.sin(t * 1.8) * 1.1;
    const sway = moving ? Math.sin(walk * 0.5) * 1.4 : Math.sin(t * 1.1) * 0.5;
    const lean = moving ? 1.4 : 0.2;
    const f = p.face;

    // Ground shadow
    ctx.fillStyle = 'rgba(24,10,5,0.34)';
    ctx.beginPath();
    ctx.ellipse(1.5, 0, 15.5, 5.5, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(sway * 0.4, -19 - bob);
    ctx.rotate((sway * 0.015) + (f.x * 0.01));

    // Backpack (rounded)
    ctx.fillStyle = '#bf6736';
    roundRect(ctx, -11, -16, 22, 18, 7);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,220,170,0.22)';
    roundRect(ctx, -7, -13, 4.5, 10, 2);
    ctx.fill();

    // Legs (two segments feel more human)
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const drawLeg = (side, phase) => {
      const hipX = side * 4.2;
      const hipY = 4;
      const kneeBend = moving ? 2.2 + Math.max(0, Math.sin(phase + Math.PI / 2)) * 3.2 : 0.4;
      const kneeX = hipX + phase * 0.55;
      const kneeY = hipY + 6.5 + kneeBend * 0.25;
      const footX = hipX + phase * 0.95;
      const footY = 17.5 - Math.max(0, -Math.sin(phase)) * 1.2;
      ctx.strokeStyle = '#e8dfd2';
      ctx.lineWidth = 5.2;
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      ctx.quadraticCurveTo(hipX + phase * 0.2, hipY + 4.5, kneeX, kneeY);
      ctx.quadraticCurveTo(kneeX + phase * 0.25, kneeY + 4.5, footX, footY);
      ctx.stroke();
      // boot
      ctx.strokeStyle = '#3a2820';
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.moveTo(footX - 0.8, footY - 0.5);
      ctx.lineTo(footX + 2.2 * Math.sign(side || 1), footY + 1.2);
      ctx.stroke();
    };
    drawLeg(-1, swing);
    drawLeg(1, swing2);

    // Torso (softer suit)
    const bodyGrad = ctx.createLinearGradient(-9, -17, 10, 10);
    bodyGrad.addColorStop(0, '#fff7ea');
    bodyGrad.addColorStop(1, '#d8ccb9');
    ctx.fillStyle = bodyGrad;
    roundRect(ctx, -9.5, -16.5, 19, 22, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,45,32,0.25)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // suit fold/belt
    ctx.fillStyle = '#e26d2f';
    roundRect(ctx, -9, -7.5, 18, 3.8, 2);
    ctx.fill();

    // Arms (swing opposite legs, slight elbow bend)
    const drawArm = (side, phase) => {
      const shX = side * 9.2;
      const shY = -9.5;
      const handX = shX + side * 2.2 + phase * 0.55;
      const handY = 3.2 + Math.abs(phase) * 0.12;
      const elbowX = shX + side * 0.8 + phase * 0.25;
      const elbowY = -2.5;
      ctx.strokeStyle = '#f0e7da';
      ctx.lineWidth = 4.6;
      ctx.beginPath();
      ctx.moveTo(shX, shY);
      ctx.quadraticCurveTo(elbowX, elbowY, handX, handY);
      ctx.stroke();
      ctx.fillStyle = '#d67a3b';
      ctx.beginPath();
      ctx.arc(handX, handY, 2.6, 0, TAU);
      ctx.fill();
    };
    drawArm(-1, swing2 * 0.7);
    drawArm(1, swing * 0.7);

    // Chest panel
    ctx.fillStyle = '#2f241d';
    roundRect(ctx, -4.5, -2.2, 9, 6.2, 2);
    ctx.fill();
    const blink = 0.55 + 0.45 * Math.sin(t * 3.2);
    ctx.fillStyle = `rgba(120,240,255,${0.45 + blink * 0.55})`;
    ctx.fillRect(-2.6, -0.2, 1.8, 1.8);
    ctx.fillStyle = 'rgba(255,170,90,0.9)';
    ctx.fillRect(0.8, -0.2, 1.8, 1.8);

    // Neck ring + helmet/head
    const hx = 0;
    const hy = -24.5;
    ctx.fillStyle = '#e9dece';
    roundRect(ctx, -4.5, -18.5, 9, 4.5, 2);
    ctx.fill();
    ctx.fillStyle = '#f8f1e6';
    ctx.beginPath();
    ctx.ellipse(hx, hy, 11.5, 12.2, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,45,32,0.28)';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // Visor (human-facing direction)
    const fpx = f.x * CAM.rx + f.y * CAM.ry;
    const fpy = -(f.x * CAM.fx + f.y * CAM.fy);
    const vx = hx + fpx * 2.6;
    const vy = hy + 0.6 + fpy * 1.8;
    const visor = ctx.createLinearGradient(vx - 7, vy - 7, vx + 7, vy + 7);
    visor.addColorStop(0, '#4f8798');
    visor.addColorStop(0.5, '#183644');
    visor.addColorStop(1, '#0b1d27');
    ctx.fillStyle = visor;
    ctx.beginPath();
    ctx.ellipse(vx, vy, 7.8, 6.4, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // visor highlight
    ctx.fillStyle = 'rgba(210,245,255,0.45)';
    ctx.beginPath();
    ctx.ellipse(vx - 2.6, vy - 2.4, 2.6, 1.5, -0.6, 0, TAU);
    ctx.fill();

    // subtle head lamp/rim (less robotic antenna)
    ctx.strokeStyle = 'rgba(255,170,110,0.35)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(hx, hy, 11.6, Math.PI * 1.18, Math.PI * 1.72);
    ctx.stroke();

    ctx.restore();
  }

  function drawNearPart(np, t) {
    const done = !!(np && (np.repaired || np.inspected || np.equipped || np.done || np.scanned || np.siphoned || np.released || np.visited || np.loaded || np.used || np.tested || np.checked || np.aligned));
    const pulse = 0.5 + 0.5 * Math.sin(t * (done ? 3 : 6));
    ctx.fillStyle = 'rgba(20,10,6,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 0, 24, 8, 0, 0, TAU); ctx.fill();
    ctx.save();
    ctx.translate(0, -9);
    ctx.fillStyle = done ? '#9a9588' : '#7a6a58';
    roundRect(ctx, -16, -9, 32, 16, 4); ctx.fill();
    ctx.strokeStyle = done ? 'rgba(180,255,210,0.45)' : 'rgba(255,160,120,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = done ? `rgba(120,255,180,${0.4 + pulse * 0.35})` : `rgba(255,120,80,${0.3 + pulse * 0.3})`;
    ctx.beginPath(); ctx.arc(0, -2, 3, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawSolarPanels(o, t) {
    const ok = !!(o && o.checked) || !!game.story?.m8SolarChecked;
    const pulse = 0.5 + 0.5 * Math.sin(t * (ok ? 2 : 5));
    ctx.fillStyle = 'rgba(20,10,6,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 0, 42, 14, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(0, -12);
    ctx.fillStyle = '#6b6f78'; roundRect(ctx, -30, -8, 60, 10, 3); ctx.fill();
    for (let i = -1; i <= 1; i++) {
      ctx.save(); ctx.translate(i * 22, -18); ctx.rotate(-0.45);
      ctx.fillStyle = ok ? '#2e6fd6' : '#33445a';
      roundRect(ctx, -10, -14, 20, 28, 2); ctx.fill();
      ctx.strokeStyle = ok ? `rgba(120,220,255,${0.4 + pulse*0.4})` : 'rgba(255,120,80,0.5)';
      ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = ok ? `rgba(255,220,120,${0.4+pulse*0.4})` : `rgba(255,90,60,${0.4+pulse*0.4})`;
    ctx.beginPath(); ctx.arc(0, -2, 3, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawWaterIce(o, t) {
    const ok = !!(o && o.visited) || !!game.story?.m8WaterIceReached;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.fillStyle = 'rgba(20,10,6,0.35)'; ctx.beginPath(); ctx.ellipse(0,0,34,12,0,0,TAU); ctx.fill();
    ctx.save(); ctx.translate(0,-10);
    ctx.fillStyle = ok ? 'rgba(180,240,255,0.95)' : 'rgba(140,220,255,0.85)';
    ctx.beginPath(); ctx.moveTo(-20,8); ctx.lineTo(-8,-16); ctx.lineTo(4,-10); ctx.lineTo(18,6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = `rgba(220,250,255,${0.5+pulse*0.3})`; ctx.lineWidth = 2; ctx.stroke();
    if (ok) { ctx.fillStyle = `rgba(120,255,200,${0.5+pulse*0.4})`; ctx.beginPath(); ctx.arc(0,-2,4,0,TAU); ctx.fill(); }
    ctx.restore();
  }
  function drawAntenna(o, t) {
    const ok = !!game.story?.antennaRepaired;
    const pulse = 0.5 + 0.5 * Math.sin(t * (ok ? 3 : 6));
    ctx.fillStyle = 'rgba(20,10,6,0.35)'; ctx.beginPath(); ctx.ellipse(0,0,24,9,0,0,TAU); ctx.fill();
    ctx.save(); ctx.translate(0,-8);
    ctx.strokeStyle = '#cfc8bc'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0,8); ctx.lineTo(0,-34); ctx.stroke();
    ctx.strokeStyle = ok ? '#9fffd0' : '#ffb080'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0,-30,10,Math.PI*0.2,Math.PI*0.8); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,-30,16,Math.PI*0.22,Math.PI*0.78); ctx.stroke();
    ctx.fillStyle = ok ? `rgba(140,255,220,${0.5+pulse*0.4})` : `rgba(255,110,80,${0.4+pulse*0.4})`;
    ctx.beginPath(); ctx.arc(0,-36,3.5,0,TAU); ctx.fill();
    ctx.restore();
  }
  function drawRover(o, t) {
    const repaired = !!(o && o.repaired) || !!game.story?.m1RoverRepaired;
    const pulse = 0.5 + 0.5 * Math.sin(t * (repaired ? 2 : 4));
    ctx.fillStyle = 'rgba(20,10,6,0.35)'; ctx.beginPath(); ctx.ellipse(0,0,38,13,0,0,TAU); ctx.fill();
    ctx.save(); ctx.translate(0,-10);
    ctx.fillStyle = repaired ? '#d8d2c8' : '#8e8f92'; roundRect(ctx,-26,-10,52,18,5); ctx.fill();
    ctx.fillStyle = '#3a3f46';
    [-18,-6,6,18].forEach(x=>{ctx.beginPath(); ctx.arc(x,10,6,0,TAU); ctx.fill();});
    ctx.strokeStyle = repaired ? '#6feeff' : '#ff9966'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(8,-10); ctx.lineTo(14,-22); ctx.stroke();
    ctx.fillStyle = repaired ? `rgba(111,238,255,${0.6+pulse*0.3})` : `rgba(255,120,80,${0.4+pulse*0.3})`; ctx.beginPath(); ctx.arc(14,-23,2.5,0,TAU); ctx.fill();
    ctx.restore();
  }
  function drawCraterMarker(o, t) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
    ctx.save();
    ctx.strokeStyle = `rgba(255,150,90,${0.25 + pulse * 0.12})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0,0,70,26,0,0,TAU); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0,0,44,16,0,0,TAU); ctx.stroke();
    ctx.fillStyle = `rgba(120,40,20,${0.12 + pulse * 0.05})`;
    ctx.beginPath(); ctx.ellipse(0,0,70,26,0,0,TAU); ctx.fill();
    ctx.restore();
  }

  function drawRoverSite(site, t) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    // base shadow and marker
    ctx.fillStyle = 'rgba(20,10,6,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 0, 22, 8, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(0, -8);
    // small plaque/base
    ctx.fillStyle = '#8e8578';
    roundRect(ctx, -14, -4, 28, 10, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(255,230,200,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
    // flag pole
    ctx.strokeStyle = '#d8d2c8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(10, -4); ctx.lineTo(10, -44); ctx.stroke();
    // USA flag
    const fx = 11, fy = -43, fw = 22, fh = 12;
    ctx.fillStyle = '#fff'; ctx.fillRect(fx, fy, fw, fh);
    ctx.fillStyle = '#b22234';
    for (let i = 0; i < 7; i++) ctx.fillRect(fx, fy + i * (fh / 6.5), fw, fh / 13);
    ctx.fillStyle = '#3c3b6e';
    ctx.fillRect(fx, fy, fw * 0.42, fh * 0.54);
    // simple stars hint
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) ctx.fillRect(fx + 1.5 + c * 2.6, fy + 1.2 + r * 1.8, 0.8, 0.8);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.8; ctx.strokeRect(fx, fy, fw, fh);
    // glow
    ctx.fillStyle = `rgba(255,230,160,${0.25 + pulse * 0.25})`;
    ctx.beginPath(); ctx.arc(10, -46, 2.2, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawOxygenMachine(o, t) {
    const ok = !!game.story?.oxygenRepaired;
    const pulse = 0.5 + 0.5 * Math.sin(t * (ok ? 2.5 : 6));
    ctx.fillStyle = 'rgba(20,10,6,0.35)'; ctx.beginPath(); ctx.ellipse(0,0,28,10,0,0,TAU); ctx.fill();
    ctx.save(); ctx.translate(0,-16);
    ctx.fillStyle = ok ? '#dfe8f0' : '#9aa7b5'; roundRect(ctx,-16,-22,32,38,6); ctx.fill();
    ctx.fillStyle = ok ? `rgba(100,230,255,${0.5+pulse*0.4})` : `rgba(255,90,80,${0.4+pulse*0.4})`;
    roundRect(ctx,-8,-12,16,10,3); ctx.fill();
    ctx.strokeStyle = '#607080'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }
  function drawTransmitter(o, t) {
    const active = !!game.story?.transmitterActivated;
    const ready = !!game.story?.radiationCrossed;
    const pulse = 0.5 + 0.5 * Math.sin(t * (active ? 8 : ready ? 4 : 2));
    ctx.fillStyle = 'rgba(20,10,6,0.35)'; ctx.beginPath(); ctx.ellipse(0,0,34,12,0,0,TAU); ctx.fill();
    ctx.save(); ctx.translate(0,-14);
    ctx.fillStyle = '#d8d0c4'; roundRect(ctx,-18,-18,36,30,6); ctx.fill();
    ctx.strokeStyle = '#8e8376'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = active ? '#8fffd0' : ready ? '#ffe08a' : '#9aa0aa'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0,-18); ctx.lineTo(0,-38); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,-28,10,Math.PI*0.2,Math.PI*0.8); ctx.stroke();
    ctx.fillStyle = active ? `rgba(140,255,200,${0.6+pulse*0.4})` : ready ? `rgba(255,220,120,${0.5+pulse*0.4})` : 'rgba(160,160,170,0.5)';
    ctx.shadowColor = active ? '#8fffd0' : ready ? '#ffe08a' : 'transparent'; ctx.shadowBlur = active || ready ? 12 : 0;
    ctx.beginPath(); ctx.arc(0,-40,4,0,TAU); ctx.fill();
    ctx.shadowBlur = 0;
    if (active) {
      ctx.strokeStyle = `rgba(140,255,210,${0.2+pulse*0.3})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0,-40,18 + pulse*8,Math.PI*1.1,Math.PI*1.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(0,-40,28 + pulse*10,Math.PI*1.12,Math.PI*1.88); ctx.stroke();
    }
    ctx.restore();
  }

  function drawCommArray(ca, t) {
    const restored = game.quest && game.quest.radarRestored;
    const pulse = 0.5 + 0.5 * Math.sin(t * (restored ? 4 : 2));
    ctx.fillStyle = 'rgba(20,10,6,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 0, 60, 20, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(0, -36);
    ctx.fillStyle = '#d8d0c4';
    roundRect(ctx, -38, -16, 76, 36, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(90,80,70,0.45)'; ctx.lineWidth = 2; ctx.stroke();
    // dish
    ctx.save();
    ctx.translate(0, -26);
    ctx.rotate(Math.sin(t * 0.8) * 0.08);
    ctx.strokeStyle = restored ? '#9fffd0' : '#ffd9a0';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 24, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 22); ctx.stroke();
    ctx.restore();
    // mast
    ctx.strokeStyle = '#cfc8bc'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(0, -40); ctx.stroke();
    ctx.fillStyle = restored ? `rgba(140,255,220,${0.5 + pulse * 0.4})` : `rgba(255,120,80,${0.25 + pulse * 0.25})`;
    ctx.shadowColor = restored ? '#8fffd0' : '#ff7040'; ctx.shadowBlur = restored ? 14 : 6;
    ctx.beginPath(); ctx.arc(0, -42, 4, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function drawSpaceCentre(sc, t) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    ctx.fillStyle = 'rgba(20,10,6,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 0, 72, 24, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(0, -42);
    // Main block
    ctx.fillStyle = '#dfeaf2';
    roundRect(ctx, -54, -30, 108, 52, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(80,120,150,0.45)'; ctx.lineWidth = 2; ctx.stroke();
    // Dome/canopy
    ctx.fillStyle = '#9fdfff';
    ctx.beginPath(); ctx.ellipse(0, -30, 34, 18, 0, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
    // Door
    ctx.fillStyle = '#24323d';
    roundRect(ctx, -12, -6, 24, 28, 4); ctx.fill();
    // O2 sign glow
    ctx.fillStyle = `rgba(120,235,255,${0.35 + pulse * 0.45})`;
    ctx.shadowColor = '#6feeff'; ctx.shadowBlur = 12;
    roundRect(ctx, -18, -52, 36, 14, 4); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#083848';
    ctx.font = '700 9px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText('O₂', 0, -42);
    // Antenna
    ctx.strokeStyle = '#c8d8e2'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(34, -30); ctx.lineTo(46, -62); ctx.stroke();
    ctx.fillStyle = `rgba(120,235,255,${0.4 + pulse * 0.5})`;
    ctx.beginPath(); ctx.arc(46, -63, 3, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawFoodCentre(fc, t) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.0 + 1);
    ctx.fillStyle = 'rgba(20,10,6,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 0, 68, 22, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(0, -38);
    ctx.fillStyle = '#efe2c8';
    roundRect(ctx, -50, -28, 100, 48, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(120,90,40,0.45)'; ctx.lineWidth = 2; ctx.stroke();
    // Greenhouse roof
    ctx.fillStyle = 'rgba(120,220,140,0.35)';
    roundRect(ctx, -40, -44, 80, 18, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(180,255,190,0.35)'; ctx.stroke();
    // Door
    ctx.fillStyle = '#3a2a1a';
    roundRect(ctx, -11, -4, 22, 24, 4); ctx.fill();
    // Food sign
    ctx.fillStyle = `rgba(255,220,120,${0.35 + pulse * 0.45})`;
    ctx.shadowColor = '#ffd36e'; ctx.shadowBlur = 10;
    roundRect(ctx, -26, -50, 52, 14, 4); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#4a3200';
    ctx.font = '700 8px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText('FOOD', 0, -40);
    ctx.restore();
  }

  function drawDungeonEntrance(d, t) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
    ctx.fillStyle = 'rgba(18,8,4,0.4)';
    ctx.beginPath(); ctx.ellipse(0, 0, 34, 12, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(0, -8);
    // Cave mouth
    ctx.fillStyle = '#1a120e';
    ctx.beginPath();
    ctx.moveTo(-26, 8); ctx.quadraticCurveTo(0, -42, 26, 8); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2b1c15';
    ctx.beginPath();
    ctx.moveTo(-20, 8); ctx.quadraticCurveTo(0, -30, 20, 8); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(255,190,130,${0.25 + pulse * 0.2})`;
    ctx.lineWidth = 2; ctx.stroke();
    // Glow inside
    ctx.fillStyle = `rgba(255,160,80,${0.08 + pulse * 0.08})`;
    ctx.beginPath(); ctx.ellipse(0, -6, 10, 10, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawLander(t) {
    const L = game.lander;
    const q = game.quest;
    const p = game.player;
    const powered = q.radarRestored;
    const ampReady = q.radarRestored && q.amplifier;
    const lit = q.ampInstalled || ampReady || powered;
    const blink = 0.5 + 0.5 * Math.sin(t * (q.ampInstalled ? 8 : ampReady ? 6 : powered ? 4 : 2.5));

    // Ground shadow
    ctx.fillStyle = 'rgba(26,8,3,0.42)';
    ctx.beginPath();
    ctx.ellipse(5, 0, 54, 18, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(0, -46);

    // Landing legs
    ctx.strokeStyle = '#b7ac9d';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-24, 12); ctx.lineTo(-45, 42); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(24, 12); ctx.lineTo(45, 42); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(0, 45); ctx.stroke();
    ctx.fillStyle = '#5f5045';
    [-45, 45].forEach((x) => { ctx.beginPath(); ctx.ellipse(x, 43, 9, 4, 0, 0, TAU); ctx.fill(); });
    ctx.beginPath(); ctx.ellipse(0, 46, 8, 4, 0, 0, TAU); ctx.fill();

    // Fins
    ctx.fillStyle = '#8d7a68';
    ctx.beginPath(); ctx.moveTo(-30, -16); ctx.lineTo(-46, -2); ctx.lineTo(-28, 10); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(30, -16); ctx.lineTo(46, -2); ctx.lineTo(28, 10); ctx.closePath(); ctx.fill();

    // Body
    ctx.fillStyle = L.bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, -13, 33, 43, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,40,28,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Heat shield band
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, -13, 33, 43, 0, 0, TAU);
    ctx.clip();
    ctx.fillStyle = '#d4551f';
    ctx.fillRect(-34, 2, 68, 9);
    ctx.fillStyle = 'rgba(255,220,180,0.32)';
    ctx.fillRect(-34, -40, 68, 5);
    ctx.restore();

    // Hatch
    ctx.fillStyle = '#3a2e26';
    ctx.beginPath();
    ctx.arc(0, 4, 14, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#ffb16a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 4, 14, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(120,220,240,0.35)';
    ctx.beginPath();
    ctx.arc(0, 4, 9, 0, TAU);
    ctx.fill();

    // Window glint
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(-14, -30, 5, 13, -0.35, 0, TAU);
    ctx.fill();

    // Antenna
    ctx.strokeStyle = '#d8cfc0';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(20, -44);
    ctx.lineTo(31, -80);
    ctx.stroke();
    ctx.fillStyle = lit
      ? `rgba(130,255,175,${0.35 + blink * 0.65})`
      : `rgba(255,175,70,${0.3 + blink * 0.6})`;
    ctx.shadowColor = lit ? '#6dffa3' : '#ffab4a';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(31, -81, 4 + blink * 1.8, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Slight beacon halo once it has power
    if (lit) {
      ctx.strokeStyle = `rgba(120,255,170,${0.12 + blink * 0.18})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -13, 62 + blink * 8, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawParticles() {
    for (const q of game.particles) {
      const s = projectPoint(q.x, q.y, 0);
      if (!s.visible) continue;
      const a0 = clamp(q.life / q.maxLife, 0, 1) *
        Math.min(fogAlpha(s.L), clamp((s.depth - 55) / 120, 0, 1));
      if (a0 < 0.02) continue;
      const r = Math.max(0.7, q.size * (0.5 + a0 * 0.6) * s.scale);
      ctx.globalAlpha = a0 * 0.22;
      ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 2.2, 0, TAU); ctx.fill();
      ctx.globalAlpha = a0;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawMotes(t) {
    const active = game.flare.phase === 'active';
    const zid = zoneAt(game.player.x, game.player.y).id;
    const moteColor = zid === 'jezero' ? '#f1e7dc'
      : zid === 'valles' ? '#ffc2a4'
        : zid === 'gale' ? '#ffe0b6'
          : zid === 'gusev' ? '#ffd0ab'
            : '#ffe0c2'; // Meridiani Planum and fallback
    for (const m of game.motes) {
      const flicker = 0.7 + 0.3 * Math.sin(t * 2.2 + m.x * 0.05);
      ctx.globalAlpha = m.a * flicker;
      if (active) {
        ctx.strokeStyle = moteColor;
        ctx.lineWidth = m.r;
        ctx.beginPath();
        ctx.moveTo(m.x - 14, m.y);
        ctx.lineTo(m.x + 14, m.y);
        ctx.stroke();
      } else {
        ctx.fillStyle = moteColor;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = m.a * flicker * 0.25;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r * 2.4, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  let atmosCache = { key: '', grad: null };

  function drawZoneAtmosphere(t) {
    const p = game.player;
    if (!p) return;
    const zid = zoneAt(p.x, p.y).id;
    const key = `${zid}:${VIEW.w}x${VIEW.h}`;
    if (atmosCache.key !== key) {
      const tints = {
        basin: [255, 140, 80, 0.035],
        canyon: [255, 86, 42, 0.06],
        frost: [150, 210, 240, 0.065],
        maw: [190, 52, 44, 0.085],
        dunes: [255, 176, 104, 0.045]
      };
      const tint = tints[zid] || tints.basin;
      const w = VIEW.w;
      const h = VIEW.h;
      const cx = w / 2;
      const cy = h * 0.48;
      const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.16, cx, cy, Math.max(w, h) * 0.74);
      g.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},0)`);
      g.addColorStop(0.65, `rgba(${tint[0]},${tint[1]},${tint[2]},${tint[3] * 0.45})`);
      g.addColorStop(1, `rgba(${tint[0]},${tint[1]},${tint[2]},${tint[3]})`);
      atmosCache = { key, grad: g };
    }
    ctx.fillStyle = atmosCache.grad;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  }

  function drawFlareFX(t) {
    const f = game.flare;
    if (f.phase === 'idle') return;

    const active = f.phase === 'active';
    ctx.save();
    if (active) {
      ctx.fillStyle = `rgba(220,52,16,${0.045 + Math.sin(t * 3) * 0.012})`;
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      ctx.strokeStyle = 'rgba(255,180,140,0.1)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 46; i++) {
        const y = (i * 47 + Math.sin(t * 3 + i) * 16) % (VIEW.h + 40) - 20;
        const x = ((t * (420 + (i % 5) * 130) + i * 137) % (VIEW.w + 240)) - 120;
        const len = 24 + (i % 6) * 14;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y + Math.sin(i) * 2);
        ctx.stroke();
      }
    } else {
      // Warning: faint edge pulse
      const a = 0.05 + 0.035 * Math.sin(t * 6);
      const g = ctx.createLinearGradient(0, 0, 0, VIEW.h);
      g.addColorStop(0, `rgba(255,140,50,${a})`);
      g.addColorStop(0.2, 'rgba(255,140,50,0)');
      g.addColorStop(1, 'rgba(255,140,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    }
    ctx.restore();
  }

  function drawObjectiveMarker(t) {
    const obj = getObjective();
    if (!obj) return;
    const p = game.player;
    const proj = w2s(obj.x, obj.y);
    let sx = proj.x;
    let sy = proj.y;
    if (!proj.visible || proj.depth <= 55) {
      // Behind the camera: point down toward the bottom edge.
      sx = VIEW.w / 2;
      sy = VIEW.h + 240;
    }
    const mX = 64;
    const hudVisible = !dom.hud.classList.contains('hidden');
    const hudBottom = hudVisible ? dom.hud.getBoundingClientRect().bottom : 0;
    const mTop = clamp(hudBottom + 14, 90, VIEW.h * 0.42);
    const mBottom = VIEW.w < 700 ? 168 : 96;
    const d = dist(p.x, p.y, obj.x, obj.y);
    const distText = d > 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`;

    const onScreen = sx > mX && sx < VIEW.w - mX && sy > mTop && sy < VIEW.h - mBottom;

    ctx.save();
    if (onScreen) {
      // Small floating diamond above the target, so you can see it over terrain
      const bob = Math.sin(t * 3) * 3;
      ctx.translate(sx, sy - 34 + bob);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(255,214,120,0.85)';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.strokeStyle = 'rgba(80,35,10,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-4, -4, 8, 8);
      ctx.rotate(-Math.PI / 4);
      ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,232,190,0.72)';
      ctx.fillText(distText, 0, -12);
    } else {
      const cx = VIEW.w / 2;
      const cy = mTop + (VIEW.h - mTop - mBottom) / 2;
      const dx = sx - VIEW.w / 2;
      const dy = sy - VIEW.h / 2;
      const angle = Math.atan2(dy, dx);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const tx = (VIEW.w / 2 - mX) / Math.max(0.0001, Math.abs(cos));
      const ty = ((VIEW.h - mTop - mBottom) / 2) / Math.max(0.0001, Math.abs(sin));
      const len = Math.min(tx, ty);
      const ax = cx + cos * len;
      const ay = cy + sin * len;

      ctx.translate(ax, ay);
      ctx.rotate(angle);
      ctx.globalAlpha = 0.75 + 0.2 * Math.sin(t * 4);
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(-5, 7);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-5, -7);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,24,6,0.7)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.rotate(-angle);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      ctx.font = '700 9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = 'rgba(255,226,175,0.92)';
      ctx.fillText(obj.label, 0, 22);
      ctx.fillStyle = 'rgba(255,226,175,0.6)';
      ctx.font = '600 8px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(distText, 0, 33);
    }
    ctx.restore();
  }



  function drawMinimap() {
    const w = minimap.width;
    const h = minimap.height;
    const pad = 14;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = '#0e0907';
    mctx.fillRect(0, 0, w, h);

    if (game.location === 'dungeon' && game.dungeon) {
      const d = game.dungeon;
      const sx = (w - pad * 2) / d.interior.w;
      const sy = (h - pad * 2) / d.interior.h;
      const sc = Math.min(sx, sy);
      const ox = (w - d.interior.w * sc) / 2;
      const oy = (h - d.interior.h * sc) / 2;
      const mx = (x) => ox + x * sc;
      const my = (y) => oy + y * sc;
      mctx.fillStyle = '#241712';
      mctx.fillRect(mx(0), my(0), d.interior.w * sc, d.interior.h * sc);
      mctx.fillStyle = '#4a2f26';
      for (const wall of d.walls) mctx.fillRect(mx(wall.x), my(wall.y), wall.w * sc, wall.h * sc);
      mctx.fillStyle = '#7dffb0';
      mctx.beginPath(); mctx.arc(mx(d.interior.exit.x), my(d.interior.exit.y), 4, 0, TAU); mctx.fill();
      mctx.fillStyle = '#ffd36e';
      mctx.beginPath(); mctx.arc(mx(d.foodStation.x), my(d.foodStation.y), 4, 0, TAU); mctx.fill();
      for (const it of d.items) {
        if (it.taken) continue;
        mctx.fillStyle = (ITEM_DEF[it.type] && ITEM_DEF[it.type].color) || '#fff';
        mctx.beginPath(); mctx.arc(mx(it.x), my(it.y), 3, 0, TAU); mctx.fill();
      }
      if (game.player) {
        mctx.fillStyle = '#ffffff';
        mctx.beginPath(); mctx.arc(mx(game.player.x), my(game.player.y), 3.5, 0, TAU); mctx.fill();
      }
      mctx.strokeStyle = 'rgba(255,160,110,0.16)';
      mctx.lineWidth = 2;
      mctx.strokeRect(1, 1, w - 2, h - 2);
      return;
    }

    const px = (x) => pad + (x / WORLD.w) * (w - pad * 2);
    const py = (y) => pad + (y / WORLD.h) * (h - pad * 2);

    for (const z of ZONES) {
      const x = px(z.x);
      const y = py(z.y);
      const r = (z.r / WORLD.w) * (w - pad * 2) * 1.5;
      const grad = mctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${z.rgb[0]},${z.rgb[1]},${z.rgb[2]},0.30)`);
      grad.addColorStop(0.7, `rgba(${z.rgb[0]},${z.rgb[1]},${z.rgb[2]},0.10)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      mctx.fillStyle = grad;
      mctx.fillRect(pad, pad, w - pad * 2, h - pad * 2);
    }

    mctx.strokeStyle = 'rgba(255,180,130,0.055)';
    mctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const x = pad + ((w - pad * 2) * i) / 5;
      const y = pad + ((h - pad * 2) * i) / 5;
      mctx.beginPath(); mctx.moveTo(x, pad); mctx.lineTo(x, h - pad); mctx.stroke();
      mctx.beginPath(); mctx.moveTo(pad, y); mctx.lineTo(w - pad, y); mctx.stroke();
    }

    const pulse = 1 + Math.sin(performance.now() / 260) * 0.25;

    game.shelters.forEach((s) => {
      const x = px(s.x), y = py(s.y);
      mctx.fillStyle = 'rgba(80,235,150,0.16)';
      mctx.beginPath(); mctx.arc(x, y, 9, 0, TAU); mctx.fill();
      mctx.fillStyle = '#59e89a';
      mctx.beginPath(); mctx.arc(x, y, 3.8, 0, TAU); mctx.fill();
    });
    if (game.spaceCentre) {
      const x = px(game.spaceCentre.x), y = py(game.spaceCentre.y);
      mctx.fillStyle = 'rgba(110,235,255,0.22)';
      mctx.beginPath(); mctx.arc(x, y, 11, 0, TAU); mctx.fill();
      mctx.fillStyle = '#7feeff';
      mctx.beginPath(); mctx.arc(x, y, 4.8, 0, TAU); mctx.fill();
    }
    if (game.foodCentre) {
      const x = px(game.foodCentre.x), y = py(game.foodCentre.y);
      mctx.fillStyle = 'rgba(255,210,90,0.22)';
      mctx.beginPath(); mctx.arc(x, y, 11, 0, TAU); mctx.fill();
      mctx.fillStyle = '#ffd36e';
      mctx.beginPath(); mctx.arc(x, y, 4.8, 0, TAU); mctx.fill();
    }
    for (const oc of (game.extraOxygenChambers || [])) {
      const x = px(oc.x), y = py(oc.y);
      mctx.fillStyle = 'rgba(110,235,255,0.18)';
      mctx.beginPath(); mctx.arc(x, y, 10, 0, TAU); mctx.fill();
      mctx.fillStyle = '#7feeff';
      mctx.beginPath(); mctx.arc(x, y, 4.2, 0, TAU); mctx.fill();
    }
    for (const d of (game.dungeons || [])) {
      const x = px(d.entrance.x), y = py(d.entrance.y);
      mctx.fillStyle = 'rgba(255,170,100,0.22)';
      mctx.beginPath(); mctx.arc(x, y, 8, 0, TAU); mctx.fill();
      mctx.fillStyle = '#ffb070';
      mctx.beginPath(); mctx.arc(x, y, 3.4, 0, TAU); mctx.fill();
    }

    const lx = px(game.lander.x), ly = py(game.lander.y);
    mctx.save();
    mctx.translate(lx, ly);
    mctx.rotate(Math.PI / 4);
    mctx.fillStyle = game.quest && game.quest.radarRestored ? '#a7ffc4' : '#e9ddcd';
    mctx.fillRect(-4.5, -4.5, 9, 9);
    mctx.restore();

    if (game.commArray) {
      const x = px(game.commArray.x), y = py(game.commArray.y);
      mctx.fillStyle = game.quest.radarRestored ? 'rgba(140,255,220,0.25)' : 'rgba(255,210,90,0.22)';
      mctx.beginPath(); mctx.arc(x, y, 10, 0, TAU); mctx.fill();
      mctx.fillStyle = game.quest.radarRestored ? '#8fffd0' : '#ffd36e';
      mctx.beginPath(); mctx.arc(x, y, 4.6, 0, TAU); mctx.fill();
    }

    for (const it of game.items) {
      if (it.type !== 'relay' || it.taken) continue;
      const x = px(it.x), y = py(it.y);
      mctx.fillStyle = 'rgba(255,215,60,0.18)';
      mctx.beginPath(); mctx.arc(x, y, 10 * pulse, 0, TAU); mctx.fill();
      mctx.fillStyle = '#ffd23f';
      mctx.beginPath(); mctx.arc(x, y, 4.5, 0, TAU); mctx.fill();
    }

    if (game.probe && (game.probe.active || game.quest.radarRestored)) {
      const x = px(game.probe.x), y = py(game.probe.y);
      mctx.fillStyle = 'rgba(120,240,255,0.2)';
      mctx.beginPath(); mctx.arc(x, y, 9 * pulse, 0, TAU); mctx.fill();
      mctx.save(); mctx.translate(x, y); mctx.rotate(Math.PI / 4);
      mctx.fillStyle = '#8ff2ff'; mctx.fillRect(-3.5, -3.5, 7, 7); mctx.restore();
    }

    for (const l of game.logs) {
      if (!l.taken) continue;
      mctx.fillStyle = 'rgba(150,240,255,0.55)';
      mctx.beginPath(); mctx.arc(px(l.x), py(l.y), 2.2, 0, TAU); mctx.fill();
    }

    const p = game.player;
    if (p) {
      const x = px(p.x), y = py(p.y);
      mctx.save();
      mctx.translate(x, y);
      mctx.rotate(Math.atan2(p.face.y, p.face.x) + Math.PI / 2);
      mctx.fillStyle = '#ff7b3a';
      mctx.beginPath();
      mctx.moveTo(0, -7); mctx.lineTo(5, 6); mctx.lineTo(0, 3); mctx.lineTo(-5, 6);
      mctx.closePath(); mctx.fill();
      mctx.restore();
    }

    mctx.strokeStyle = 'rgba(255,160,110,0.16)';
    mctx.lineWidth = 2;
    mctx.strokeRect(1, 1, w - 2, h - 2);
    if (game.flare.phase === 'active') {
      mctx.strokeStyle = `rgba(255,75,50,${0.45 + Math.sin(performance.now() / 160) * 0.2})`;
      mctx.lineWidth = 4;
      mctx.strokeRect(2, 2, w - 4, h - 4);
    }
  }

  // =========================================================================
  // Sizing, input, boot
  // =========================================================================
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    VIEW.w = w;
    VIEW.h = h;
    VIEW.dpr = Math.min(window.devicePixelRatio || 1, 2);
    VIEW.scale = clamp(Math.min(w / 1280, h / 800), 0.62, 1.35);
    canvas.width = Math.floor(w * VIEW.dpr);
    canvas.height = Math.floor(h * VIEW.dpr);
    ensureGroundPlane();
    if (game.player) updateCamera(0, true);
  }

  function endLook(e) {
    if (!look.active) return;
    if (e && e.pointerId != null && e.pointerId !== look.id) return;
    look.active = false;
    look.id = null;
  }

  function endPointer(e) {
    endLook(e);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    if (e.pointerType === 'mouse') {
      look.active = true;
      look.id = e.pointerId;
      look.lastX = e.clientX;
      look.lastY = e.clientY;
    }
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (look.active && e.pointerId === look.id) {
      const dx = e.clientX - look.lastX;
      const dy = e.clientY - look.lastY;
      look.lastX = e.clientX;
      look.lastY = e.clientY;
      CAM.targetYaw += dx * 0.0052;
      CAM.targetPitch = clamp(CAM.targetPitch - dy * 0.0035, CAM.minPitch, CAM.maxPitch);
      e.preventDefault();
    }
  });

  canvas.addEventListener('wheel', (e) => {
    if (state !== 'playing') return;
    CAM.targetDist = clamp(CAM.targetDist + e.deltaY * 0.45, CAM.minDist, CAM.maxDist);
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright' || k === ' ') {
      e.preventDefault();
    }
    keys[k] = true;

    if (k === 'escape') {
      if (state === 'infopopup') {
        e.preventDefault();
        closeMissionInfo();
      } else if (state === 'journal') {
        e.preventDefault();
        closeJournal();
      } else if (state === 'playing' || state === 'paused') {
        e.preventDefault();
        togglePause();
      }
    } else if (k === 'j') {
      if (state === 'playing') openJournal();
      else if (state === 'journal') closeJournal();
    } else if (k === 'p') {
      if (state === 'playing' || state === 'paused') {
        e.preventDefault();
        togglePause();
      }
    } else if (k === 'm') {
      toggleMute();
    } else if (k === 'e') {
      doInteract();
    } else if (k === 'r' && (state === 'dead' || state === 'won')) {
      startGame();
    } else if (k === 'enter' && state === 'menu') {
      startGame();
    } else if (k === 'enter' && state === 'briefing') {
      e.preventDefault();
      if (game.missionPhase === 'successImage') onMissionSuccessContinue();
      else onMissionPanelContinue();
    } else if (k === 'enter' && state === 'infopopup') {
      e.preventDefault();
      closeMissionInfo();
    }
  });

  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  window.addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    endPointer();
  });

  window.addEventListener('resize', resize);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') togglePause();
  });

  function toggleMute() {
    Sound.muted = !Sound.muted;
    Sound.setMuted(Sound.muted);
    updateMuteLabel();
  }

  function updateMuteLabel() {
    dom.muteBtn.textContent = Sound.muted ? 'SND OFF' : 'SND ON';
  }

  // Game can only be started with Enter key
  dom.startBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  dom.retryBtn.addEventListener('click', startGame);
  dom.resumeBtn.addEventListener('click', togglePause);
  dom.installBtn.addEventListener('click', doInteract);
  dom.muteBtn.addEventListener('click', toggleMute);
  dom.journalBtn.addEventListener('click', openJournal);
  dom.journalClose.addEventListener('click', closeJournal);
  if (dom.missionPanelBtn) dom.missionPanelBtn.addEventListener('click', onMissionPanelContinue);
  if (dom.missionSuccessBtn) dom.missionSuccessBtn.addEventListener('click', onMissionSuccessContinue);
  if (dom.infoCloseBtn) dom.infoCloseBtn.addEventListener('click', closeMissionInfo);



  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.075);
    lastFrame = now;

    if (state === 'playing') {
      update(dt);
    } else if (state === 'menu' || state === 'dead' || state === 'won' || state === 'briefing') {
      updateParticles(dt);
    }
    if (state === 'menu' || state === 'briefing') CAM.targetYaw += dt * 0.03;
    updateCamera(dt);
    if (state === 'menu' || state === 'playing' || state === 'briefing') {
      buildWarmQueue();
      warmGroundStep();
    }
    render(now);
    requestAnimationFrame(frame);
  }

  function enableDevMode() {
    const dev = {
      enabled: true,
      _god: false,
      _noclip: false,
      skipLevel() { return this.skipMission(); },
      skipMission() {
        if (!game.player) return 'No active game';
        const m = currentMission();
        if (!m) return 'No mission';
        const st = game.story || (game.story = {});
        const so = game.storyObjects || {};
        if (m.id === 1) { st.m1Supplies = 1; st.m1PodInspected = true; st.m1RoverRepaired = true; st.m1Complete = true; if (so.crashPod) so.crashPod.inspected = true; if (so.rover) so.rover.repaired = true; }
        if (m.id === 2) { st.m2OldChamberReached = true; if (so.oldSupplyChamber) so.oldSupplyChamber.visited = true; }
        if (m.id === 3) { st.m3HeatShieldsEquipped = true; if (so.heatShieldStation) so.heatShieldStation.equipped = true; }
        if (m.id === 4) { st.m4Obsidian = 3; st.m4ScannedEngine = true; st.m4ScannedTank = true; st.m4ScannedNose = true; st.m4CommsatParts = 3; st.m4CommsatFixed = true; st.m4VijayContact = true; if (so.crashEngine) so.crashEngine.scanned = true; if (so.crashTank) so.crashTank.scanned = true; if (so.crashNose) so.crashNose.scanned = true; if (so.m4Commsat) so.m4Commsat.repaired = true; }
        if (m.id === 5) { st.m5EngineHauled = true; st.m5HullWelded = true; if (so.magneticCrane) so.magneticCrane.used = true; if (so.weldSpot) so.weldSpot.done = true; }
        if (m.id === 6) { st.m6Fuel1 = true; st.m6Fuel2 = true; st.m6Fuel3 = true; if (so.fuelWreck1) so.fuelWreck1.siphoned = true; if (so.fuelWreck2) so.fuelWreck2.siphoned = true; if (so.fuelWreck3) so.fuelWreck3.siphoned = true; }
        if (m.id === 7) { st.m7ThrustersTested = true; if (so.thrusterConsole) so.thrusterConsole.tested = true; }
        if (m.id === 8) { st.m8Rocks = 3; st.m8SolarChecked = true; st.m8WaterIceReached = true; if (so.solarPanel) so.solarPanel.checked = true; if (so.waterIceSpot) so.waterIceSpot.visited = true; }
        if (m.id === 9) { st.m9DishAligned = true; st.m9SuppliesLoaded = true; st.m9ClampsReleased = 4; st.m9Launched = true; if (so.satelliteDish) so.satelliteDish.aligned = true; if (so.supplyLoad) so.supplyLoad.loaded = true; ['launchClamp1','launchClamp2','launchClamp3','launchClamp4'].forEach(k=>{ if(so[k]) so[k].released = true; }); }
        if (state === 'briefing') {
          state = 'playing';
          game.missionPhase = 'active';
          hideMissionPanel(); dom.screen.classList.add('hidden');
          Sound.wind(true); lastFrame = performance.now();
        }
        if (game.missionPhase !== 'after') game.missionPhase = 'active';
        missionCompleteCheck();
        updateHud();
        toast(`[DEV] Skipped ${m.name}`, 'good', 2500);
        return `Mission ${m.id}`;
      },
      skipTo(missionNum) {
        if (!game.player) return 'No active game';
        const n = Math.max(1, Math.min(MISSIONS.length, Math.floor(Number(missionNum) || 1)));
        if (state === 'dead' || state === 'won') this.revive();
        game.missionIndex = n - 1;
        setupMissionWorld(game.missionIndex);
        const st = game.story || (game.story = {});
        const so = game.storyObjects || {};
        // apply progress for missions before n
        st.m1Supplies = n > 1 ? 3 : 0; st.m1PodInspected = n > 1; st.m1RoverRepaired = n > 1; st.m1Complete = n > 1;
        st.m2OldChamberReached = n > 2;
        st.m3HeatShieldsEquipped = n > 3;
        st.m4Obsidian = n > 4 ? 3 : 0; st.m4ScannedEngine = n > 4; st.m4ScannedTank = n > 4; st.m4ScannedNose = n > 4; st.m4CommsatParts = n > 4 ? 3 : 0; st.m4CommsatFixed = n > 4; st.m4VijayContact = n > 4;
        st.m5EngineHauled = n > 5; st.m5HullWelded = n > 5;
        st.m6Fuel1 = n > 6; st.m6Fuel2 = n > 6; st.m6Fuel3 = n > 6;
        st.m7ThrustersTested = n > 7;
        st.m8Rocks = n > 8 ? 3 : 0; st.m8SolarChecked = n > 8; st.m8WaterIceReached = n > 8;
        st.m9DishAligned = false; st.m9SuppliesLoaded = false; st.m9ClampsReleased = 0; st.m9Launched = false;
        if (so.crashPod) so.crashPod.inspected = n > 1;
        if (so.rover) so.rover.repaired = n > 1;
        if (so.oldSupplyChamber) so.oldSupplyChamber.visited = n > 2;
        if (so.heatShieldStation) so.heatShieldStation.equipped = n > 3;
        if (so.crashEngine) so.crashEngine.scanned = n > 4;
        if (so.crashTank) so.crashTank.scanned = n > 4;
        if (so.crashNose) so.crashNose.scanned = n > 4;
        if (so.m4Commsat) so.m4Commsat.repaired = n > 4;
        if (so.magneticCrane) so.magneticCrane.used = n > 5;
        if (so.weldSpot) so.weldSpot.done = n > 5;
        if (so.fuelWreck1) so.fuelWreck1.siphoned = n > 6;
        if (so.fuelWreck2) so.fuelWreck2.siphoned = n > 6;
        if (so.fuelWreck3) so.fuelWreck3.siphoned = n > 6;
        if (so.thrusterConsole) so.thrusterConsole.tested = n > 7;
        if (so.solarPanel) so.solarPanel.checked = n > 8;
        if (so.waterIceSpot) so.waterIceSpot.visited = n > 8;
        state = 'briefing';
        showMissionBriefing('before');
        updateHud();
        toast(`[DEV] Jumped to Mission ${n}: ${MISSIONS[n-1].name}`, 'good', 3000);
        return n;
      },
      refill() {
        if (!game.player) return;
        const p = game.player;
        p.o2 = p.maxO2; p.food = 100; p.power = p.maxPower; p.water = 100; p.suit = p.maxSuit; p.rad = 0;
        p.starveTimer = 0; p.dehydrateTimer = 0; p.powerTimer = 0; p.starving = false;
        updateHud();
        toast('[DEV] All vitals refilled', 'good', 1800);
      },
      god(on = true) {
        dev._god = on !== false;
        if (dev._god) this.refill();
        toast(`[DEV] God mode ${dev._god ? 'ON' : 'OFF'}`, 'good', 1800);
        return dev._god;
      },
      noclip(on = true) {
        dev._noclip = on !== false;
        toast(`[DEV] Noclip ${dev._noclip ? 'ON' : 'OFF'}`, 'good', 1800);
        return dev._noclip;
      },
      revive() {
        if (state === 'dead' || state === 'won') {
          state = 'playing';
          dom.screen.classList.add('hidden');
          dom.pause.classList.add('hidden');
          dom.danger.style.opacity = '0';
          lastFrame = performance.now();
          Sound.wind(true);
        }
        this.refill();
        toast('[DEV] Revived / resumed', 'good', 2000);
        return state;
      },
      teleport(x, y) {
        if (!game.player) return 'No active game';
        game.player.x = Math.max(20, Math.min(WORLD.w - 20, Number(x) || game.player.x));
        game.player.y = Math.max(20, Math.min(WORLD.h - 20, Number(y) || game.player.y));
        updateCamera(0, true);
        toast('[DEV] Teleported', 'good', 1500);
        return { x: game.player.x, y: game.player.y };
      },
      completeMissions() { return this.completeAllMissions(); },
      completeAllMissions() {
        if (!game.player) return 'No active game';
        if (state === 'dead' || state === 'won') this.revive();
        return this.skipTo(MISSIONS.length);
      },
      collectAll() {
        if (!game.player) return 'No active game';
        for (const it of (game.items || [])) it.taken = true;
        for (const d of (game.dungeons || [])) for (const it of d.items) it.taken = true;
        for (const l of (game.logs || [])) { if (!l.taken) { l.taken = true; game.stats.logs++; } }
        const st = game.story || (game.story = {});
        st.m1Supplies = 1; st.m4Obsidian = 3; st.m4CommsatParts = 3; st.m8Rocks = 3;
        updateJournalButton(); updateHud();
        toast('[DEV] Collected all items and logs', 'good', 2500);
        return 'collected';
      },
      giveUpgrades() {
        if (!game.player) return 'No active game';
        const p = game.player;
        p.maxO2 = 175; p.o2 = p.maxO2; p.maxPower = 150; p.power = p.maxPower; p.speed = 260; p.radResist = 0.35;
        updateHud();
        toast('[DEV] Suit systems boosted', 'good', 2200);
        return 'upgraded';
      },
      win() {
        if (!game.player) return 'No active game';
        this.revive();
        this.skipTo(MISSIONS.length);
        const st = game.story || (game.story = {});
        const so = game.storyObjects || {};
        st.m9DishAligned = true; st.m9SuppliesLoaded = true; st.m9ClampsReleased = 4; st.m9Launched = false;
        if (so.satelliteDish) so.satelliteDish.aligned = true;
        if (so.supplyLoad) so.supplyLoad.loaded = true;
        ['launchClamp1','launchClamp2','launchClamp3','launchClamp4'].forEach(k => { if (so[k]) so[k].released = true; });
        if (state === 'briefing') {
          state = 'playing';
          game.missionPhase = 'active';
          hideMissionPanel(); if (dom.screen) dom.screen.classList.add('hidden');
          Sound.wind(true); lastFrame = performance.now();
        } else {
          game.missionPhase = 'active';
        }
        missionCompleteCheck();
        return 'win';
      },
      surpassEverything() {
        this.god(true);
        this.noclip(true);
        this.revive();
        this.collectAll();
        this.completeAllMissions();
        this.giveUpgrades();
        this.refill();
        updateHud();
        toast('[DEV] Surpass Everything: god, noclip, final mission ready, vitals maxed', 'gold', 5000);
        return 'surpassed';
      },
      help() {
        return ['god(on)', 'noclip(on)', 'refill()', 'revive()', 'teleport(x,y)', 'skipMission()', 'skipTo(n)', 'completeAllMissions()', 'collectAll()', 'giveUpgrades()', 'win()', 'surpassEverything()'];
      }
    };
    window.RedDust.dev = dev;
    console.info('[RedDust] Dev mode enabled. Commands:', dev.help().join(', '), '| Quick: RedDust.dev.surpassEverything()');
    toast('Developer mode enabled — RedDust.dev.surpassEverything()', 'gold', 3500);
    return dev;
  }
  // Small debug/experiment handle (also handy for tinkering in the console)
  window.RedDust = {
    game,
    VIEW,
    WORLD,
    ZONES,
    CAM,
    projectPoint,
    startGame,
    endGame,
    installCells,
    togglePause,
    openJournal,
    closeJournal,
    updateHud,
    isSheltered,
    getObjective,
    zoneAt,
    get state() { return state; },
    enableDevMode,
    enableDev: enableDevMode,
    dev: null
  };

  if (new URLSearchParams(location.search).has('dev')) {
    // Enable after init/game objects exist enough to be useful; functions guard anyway.
    setTimeout(enableDevMode, 0);
  }

  // Boot
  resize();
  resetWorld();
  updateMuteLabel();
  updateHud();
  requestAnimationFrame(frame);

})();
