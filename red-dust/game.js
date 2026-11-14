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
  // one simple pinhole camera. Drag the mouse / right side of the screen to
  // orbit, and scroll (or pinch) to change the orbit distance.
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
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        if (this.bgmWanted) this.syncMusic();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        if (this.bgmWanted) this.syncMusic();
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
          const v = a.volume || 0;
          const diff = target - v;
          if (Math.abs(diff) < 0.02) {
            a.volume = target;
            a.muted = !!this.muted;
            if (target === 0 && !this.muted) {
              // pause when fully faded out and not wanted
            }
            return;
          }
          done = false;
          a.volume = v + Math.sign(diff) * 0.03;
          a.muted = !!this.muted;
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

    enterCave() {
      this.inCave = true;
      this.syncMusic();
    },

    exitCave() {
      this.inCave = false;
      this.syncMusic();
    },

    playBgm() { this.syncMusic(); },
    pauseBgm() {
      this.bgmWanted = false;
      this.syncMusic();
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
      this.syncMusic();
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
    intro: `Year 2030. Humanity launches an ambitious expedition to Mars led by Captain Vijay with crew members Sristi, Bhavyesh, Bikramaditya, Anurag, Saswati — and a young, curious astronaut named Pico.\n\nWhile approaching Mars, the spacecraft is hit by an asteroid storm. Pico's landing pod separates and crashes on a distant part of the Red Planet. He survives... but he is alone.\n\nA weak signal reaches him: Captain Vijay is out there, guiding Pico from afar. To get home, Pico must learn to survive, explore Mars, brave underground dungeons, and repair his spacecraft for the final escape.`
  };

  const CHAPTERS = [
    { id: 1, title: 'MISSION MARS', subtitle: 'PROLOGUE & THE DISASTER' },
    { id: 2, title: 'STRANDED ON MARS', subtitle: 'LEARNING TO SURVIVE' },
    { id: 3, title: 'THE UNKNOWN', subtitle: 'EXPLORATION & CHALLENGES' },
    { id: 4, title: 'THE DARKEST HOURS', subtitle: 'HOPE AND REPAIR' },
    { id: 5, title: 'THE RETURN', subtitle: 'ESCAPE AND REUNION' }
  ];

  const MISSIONS = [
    {
      id: 1, chapter: 1, name: 'BROKEN COMMSAT',
      before: `The year is 2030.\n\nAfter months in space, Mars fills the viewport — until an asteroid storm tears through the ship.\nSYSTEM: "WARNING! NAVIGATION SYSTEM FAILURE!"\n\nPico's landing pod crashes on the Martian surface. He survives... but the impact has shattered the commsat.\n\nPICO: "The commsat is broken! I have to fix it if I want to reach Captain Vijay."\n\nSearch the crash site for the missing components, bring them to the broken commsat, and restore communication.`,
      objective: 'Find 3 commsat components near the crash site and repair the broken commsat.',
      after: `With the components installed, the commsat powers back to life.\n\nA clear signal breaks through the static.\nCAPTAIN VIJAY: "Pico! Pico! Can you hear me?"\nPICO: "CAPTAIN! I'M HERE! I'M ALIVE!"\nCAPTAIN VIJAY: "Good work fixing the commsat. Don't panic — I'll guide you from here."`,
      accomplished: 'COMMSAT REPAIRED — Communication restored.'
    },
    {
      id: 2, chapter: 2, name: 'THE FIRST DAY',
      before: `Pico is stranded in an enormous red desert. Supplies are limited and the landing pod is badly damaged.\n\nCAPTAIN VIJAY: "First things first, Pico. Check your suit and secure what you need around the crash site."\nPICO: "What am I supposed to do now?"\nCAPTAIN VIJAY: "Start by collecting resources and finding water. Every small step matters."`,
      objective: 'Collect 3 resources near the crash site and secure a water source.',
      after: `Pico gathers vital supplies and stabilises his situation for now.\n\nCAPTAIN VIJAY: "Good work. Keep an eye on oxygen, power, water, food, radiation, and suit integrity."\nPICO: "I'll manage, Captain."`,
      accomplished: 'SURVIVAL BEGINS — You are learning to endure Mars.'
    },
    {
      id: 3, chapter: 2, name: 'CAPTAIN VIJAY\'S TRAINING',
      before: `Whenever the signal holds, Captain Vijay teaches Pico how to survive on Mars.\n\nCAPTAIN VIJAY: "Monitor your oxygen and energy. Use shelters, refill stations, and equipment wisely. If something breaks, repair it."\nPICO: "How much oxygen do I have left?"\nCAPTAIN VIJAY: "Not enough to waste. Learn the land and keep moving smart."`,
      objective: 'Calibrate and boost the repaired commsat near the pod.',
      after: `Pico calibrates the repaired commsat and strengthens the signal.\n\nCAPTAIN VIJAY: "You're learning fast, Pico. This is how you stay alive out there."`,
      accomplished: 'TRAINING COMPLETE — Core survival skills learned.'
    },
    {
      id: 4, chapter: 3, name: 'EXPLORING THE UNKNOWN',
      before: `Mars stretches far beyond the crash site: massive mountains, deep craters, rocky valleys, and mysterious structures.\n\nCAPTAIN VIJAY: "Don't wander too far without checking your equipment."\nPICO: "Don't worry, Captain. I'll be careful!"\n\nPico must explore the surrounding regions to understand this world.`,
      objective: 'Explore Mars and reach the distant crater landmark.',
      after: `Pico reaches the distant crater and surveys the unknown terrain.\n\nEvery location reveals something new — and new dangers.\nCAPTAIN VIJAY: "Stay focused, Pico. Mars is more dangerous than it looks."`,
      accomplished: 'EXPLORATION UNDERWAY — The Red Planet opens up.'
    },
    {
      id: 5, chapter: 3, name: 'UNEXPECTED PROBLEMS',
      before: `As days pass, survival gets harder. Supplies drop, equipment malfunctions, and the environment turns hostile. Sometimes the signal cuts out.\n\nPICO: "Captain? Captain Vijay? Can you hear me?"\nStatic noise.\nPICO: "Oh no... Not again!"\n\nPico must push through and restore stability on his own.`,
      objective: 'Repair failing life-support equipment and stabilise your situation.',
      after: `Pico fixes critical systems despite failing comms and harsh conditions.\n\nCAPTAIN VIJAY (faint): "You're doing well, Pico... every small discovery brings you closer to home."\nPICO: "I won't give up, Captain!"`,
      accomplished: 'PROBLEMS OVERCOME — Independence in the face of silence.'
    },
    {
      id: 6, chapter: 3, name: 'THE UNDERGROUND DUNGEONS',
      before: `Pico discovers mysterious underground dungeons hidden across Mars.\n\nCAPTAIN VIJAY: "Those structures could hold resources and equipment you need. Be careful inside."\n\nEach dungeon holds obstacles, supplies, and clues that may help Pico survive and repair his spacecraft.`,
      objective: 'Enter an underground dungeon and recover vital equipment/resources inside.',
      after: `Pico braves the underground and secures useful resources.\n\nCAPTAIN VIJAY: "Remember, every small discovery brings you closer to home."`,
      accomplished: 'DUNGEONS EXPLORED — Valuable resources recovered.'
    },
    {
      id: 7, chapter: 4, name: 'LOSING HOPE',
      before: `Days have passed. Pico has travelled far, but home still feels impossible. The comms are unreliable and supplies are dangerously low.\n\nPICO: "Captain... Do you think I'll ever see Earth again?"\nCAPTAIN VIJAY: "You're stronger than you think. Don't lose hope."\nPICO: "But I'm tired, Captain."\n\nPico realises: if he wants to return, he must repair his spacecraft himself.`,
      objective: 'Reach your damaged spacecraft and begin the repair plan.',
      after: `Pico stands before the damaged spacecraft with renewed resolve.\n\nNobody is coming to rescue him from the surface.\nHis ultimate mission is clear: repair the spacecraft and launch himself home.`,
      accomplished: 'RESOLVE RESTORED — The road to freedom begins.'
    },
    {
      id: 8, chapter: 4, name: 'REPAIRING THE SPACECRAFT',
      before: `Pico examines the landing pod/spacecraft and identifies damaged components.\n\nCAPTAIN VIJAY: "Check the systems. Collect materials and parts from across Mars. We'll get you home step by step."\n\nThis is the hardest work yet — exploration, scavenging, and repairs.`,
      objective: 'Gather repair materials/parts and restore the spacecraft systems.',
      after: `After countless difficulties, Pico restores the spacecraft.\n\nCAPTAIN VIJAY: "Pico, check the propulsion system. We need it working before you attempt take-off."\nPICO: "Understood, Captain!"\n\nEngines operational. Navigation online. The spacecraft is ready.`,
      accomplished: 'SPACECRAFT REPAIRED — One final challenge remains.'
    },
    {
      id: 9, chapter: 5, name: 'THE FINAL ESCAPE',
      before: `Pico climbs into the repaired spacecraft and runs final checks.\n\nCAPTAIN VIJAY: "Pico, this is it. You've made it this far. Now bring yourself home."\nPICO: "Thank you, Captain. I couldn't have done this without you."\nCAPTAIN VIJAY: "We're waiting for you, son. Safe travels."\n\nSYSTEM: "ENGINE ACTIVATION."`,
      objective: 'Launch the spacecraft and escape Mars.',
      after: `The engines roar. The spacecraft lifts from the Martian surface as the red planet shrinks below.\n\nPico survived the crash, explored an unfamiliar world, overcame countless challenges, and repaired his spacecraft with his own hands.\n\nHe is finally heading home.`,
      accomplished: 'ESCAPE SUCCESSFUL — Pico is on his way back.'
    },
    {
      id: 10, chapter: 5, name: 'A HERO RETURNS',
      before: `After a long and difficult journey, Pico approaches the main spacecraft.\n\nThe crew waits — anxious, hopeful, proud.`,
      objective: 'Reunite with Captain Vijay and the crew.',
      after: `SRISTI: "PICO! YOU MADE IT!"\nBHAVYESH: "We were so worried about you!"\nBIKRAMADITYA: "That's incredible! You actually repaired your spacecraft!"\nANURAG: "Welcome back, buddy!"\nSASWATI: "We knew you could do it!"\n\nCAPTAIN VIJAY: "You did something extraordinary, Pico."\nPICO: "I just wanted to come home, Captain."\nCAPTAIN VIJAY: "You didn't just survive Mars. You proved that courage has nothing to do with age."\n\nTHE END.`,
      accomplished: 'MISSION COMPLETE — A hero returns.'
    }
  ];

  // =========================================================================
  // Constants
  // =========================================================================
  const WORLD = { w: 6000, h: 4200 };
  const LANDER_POS = { x: 3000, y: 2100 };
  const SHELTER_DEFS = [
    { x: 2400, y: 1780, name: 'HAB-01' },
    { x: 3600, y: 1660, name: 'HAB-02' },
    { x: 1480, y: 2060, name: 'HAB-03' },
    { x: 3000, y: 900, name: 'HAB-04' },
    { x: 4680, y: 2480, name: 'HAB-05' },
    { x: 2150, y: 3260, name: 'HAB-06' }
  ];
  const SPACE_CENTRE = { x: 5200, y: 1200, name: 'ARES SPACE CENTRE', r: 64, safeR: 110, refillR: 86, padR: 148 };
  const FOOD_CENTRE = { x: 1400, y: 3000, name: 'HYDROPONICS BAY', r: 58, safeR: 104, refillR: 82, padR: 142 };
  const COMM_ARRAY = { x: 2600, y: 2400, name: 'COMM ARRAY', r: 54, safeR: 96, padR: 132 };
  const RELAY_SPOTS = [
    { x: 900, y: 1050 },
    { x: 5000, y: 900 },
    { x: 5050, y: 3480 }
  ];
  const PROBE_POS = { x: 3000, y: 420 };
  // Dungeon interiors: separate local cave mazes entered from outdoor entrances.
  // Layouts are randomized every run and each dungeon gets a different maze.
  const DUNGEON_CONFIGS = [
    {
      id: 'basalt',
      name: 'Basalt Cave',
      entrance: { x: 820, y: 1760, r: 26 },
      cols: 11, rows: 9, cell: 78,
      items: [
        { type: 'part', partId: 'valve' },
        { type: 'knowledge', knowledgeId: 'gravity' }
      ]
    },
    {
      id: 'ice',
      name: 'Ice Crevasse',
      entrance: { x: 3600, y: 620, r: 26 },
      cols: 12, rows: 9, cell: 74,
      items: [
        { type: 'knowledge', knowledgeId: 'ice' }
      ]
    },
    {
      id: 'maw',
      name: 'Maw Ruin',
      entrance: { x: 4680, y: 3180, r: 26 },
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
    { id: 'gusev', name: 'Gusev Crater', x: 1000, y: 1500, r: 1450, rgb: [126, 72, 42], rad: 0.45 },
    { id: 'meridiani', name: 'Meridiani Planum', x: 3000, y: 2100, r: 1450, rgb: [152, 80, 48], rad: 0.4 },
    { id: 'jezero', name: 'Jezero Crater', x: 3000, y: 420, r: 1450, rgb: [150, 126, 110], rad: 0.36 },
    { id: 'valles', name: 'Valles Marineris', x: 4950, y: 3450, r: 1500, rgb: [96, 44, 28], rad: 0.72 },
    { id: 'gale', name: 'Gale Crater', x: 1200, y: 3300, r: 1400, rgb: [170, 110, 66], rad: 0.38 }
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
      x: 900, y: 1400, r: 28,
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
      x: 3200, y: 2200, r: 28,
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
      x: 3000, y: 520, r: 28,
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
      x: 1200, y: 3300, r: 30,
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
      x: 3000, y: 300, r: 30,
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
      x: 2760, y: 1980, title: 'LOG 01 — THE DOOR',
      text: 'Ares Horizon, Sol 0. The threshold test failed in a way we cannot explain. The door opened onto a place with red sky and no wind. Corporal Reyes went through. She did not come back. The child in the observation room was not on the manifest.'
    },
    {
      x: 1680, y: 1380, title: 'LOG 02 — WATER DISCIPLINE',
      text: 'Sol 14. Rationing is holding. The recyclers in the canyon habitats still work, but the dust gets into everything. If you are reading this, use the domes. They buy you minutes. Minutes are the whole game out here.'
    },
    {
      x: 820, y: 2600, title: 'LOG 03 — THE SURVEYOR',
      text: 'Sol 31. K-9 went down north of the flats with the long-range amplifier still in its bay. Without it our beacon is a flashlight pointed at the ground. Someone has to walk to the probe. Nobody volunteers.'
    },
    {
      x: 2840, y: 780, title: 'LOG 04 — JEZERO SILENCE',
      text: 'Sol 47. Jezero Crater at night is the quietest place I have ever stood. The ancient sediment under the dust is real. So is the radiation coming off the scarp. Keep your tabs close and your visits short.'
    },
    {
      x: 4230, y: 560, title: 'LOG 05 — WHAT WE HEARD',
      text: 'Sol 58. The probe kept transmitting after it died. Not telemetry. A voice, reading numbers, then a child counting backward from ten. I am writing this down because I do not trust my own ears anymore.'
    },
    {
      x: 4640, y: 3220, title: 'LOG 06 — VALLES MARINERIS',
      text: 'Sol 66. Do not cross the black crater field without shielding. The regolith there is hot enough to cook a suit. The crew calls it the Maw. I call it the place that is winning.'
    },
    {
      x: 2280, y: 3180, title: 'LOG 07 — CAMP PICTURE',
      text: 'Sol 71. Found an old camp in the dunes. Six bunks, one child-sized boot, and a drawing pinned to the wall: a red circle, a small figure, and a door standing open in the middle of nowhere. We are not the first ones here.'
    },
    {
      x: 3720, y: 2920, title: 'LOG 08 — LAST ENTRY',
      text: 'Sol 80. If the beacon is rebuilt, the door will open again. I do not know if that is rescue or something worse. But there is a kid on this planet now, and kids deserve a way home. — I. Vale'
    }
  ];
  const UPGRADE_SPOTS = [
    { type: 'tank', x: 1180, y: 1160 },
    { type: 'tank', x: 4210, y: 980 },
    { type: 'lining', x: 4560, y: 3300 },
    { type: 'boots', x: 2380, y: 3070 }
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
  const touch = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0 };
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
    for (const r of game.rocks) {
      if (dist(x, y, r.x, r.y) < r.r + 30 + pad) return false;
    }
    for (const it of game.items) {
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

  function nearLandmark(x, y, pad) {
    if (dist(x, y, PROBE_POS.x, PROBE_POS.y) < 180 + pad) return true;
    for (const l of LOG_DEFS) if (dist(x, y, l.x, l.y) < 70 + pad) return true;
    for (const u of UPGRADE_SPOTS) if (dist(x, y, u.x, u.y) < 80 + pad) return true;
    return false;
  }

  function makeRocks() {
    const rocks = [];
    let guard = 0;
    while (rocks.length < 230 && guard < 7000) {
      guard++;
      const r = rnd(13, 40);
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
    // A handful of boulder landmarks
    for (let i = 0; i < 18; i++) {
      let placed = false;
      for (let a = 0; a < 200 && !placed; a++) {
        const r = rnd(46, 82);
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
    // Relay modules to restore the comm/radar array (needed to contact Captain Vijay)
    RELAY_SPOTS.forEach((p) => addItem('relay', p.x, p.y));

    // Compulsory mission: collect Mars rocks for study
    addItem('sample', 1800, 3200, { sampleId: 'dune' });
    addItem('sample', 1100, 1400, { sampleId: 'iron' });
    addItem('sample', 3400, 500, { sampleId: 'frost' });

    // Compulsory mission: find water sources/canisters
    addItem('water', 2600, 800);
    addItem('water', 4300, 2900);

    // Supplies and adventure pickups
    for (let i = 0; i < 8; i++) {
      const p = spotNear(LANDER_POS.x, LANDER_POS.y, 350, 2600);
      if (p) addItem('rad', p.x, p.y);
    }
    for (let i = 0; i < 5; i++) {
      const p = spotNear(LANDER_POS.x, LANDER_POS.y, 450, 2800);
      if (p) addItem('power', p.x, p.y);
    }
    for (let i = 0; i < 3; i++) {
      const p = spotNear(LANDER_POS.x, LANDER_POS.y, 500, 3000);
      if (p) addItem('repair', p.x, p.y);
    }

    // Optional suit upgrades hidden at the edges of the map
    UPGRADE_SPOTS.forEach((u) => addItem(u.type, u.x, u.y));

    // Extra samples / knowledge
    addItem('sample', 900, 1900, { sampleId: 'basalt' });
    addItem('sample', 4500, 3400, { sampleId: 'maw' });
    addItem('knowledge', 2450, 2280, { knowledgeId: 'sky' });
    addItem('knowledge', 4300, 1500, { knowledgeId: 'olympus' });
    addItem('knowledge', 5200, 3000, { knowledgeId: 'day' });
  }

  function makePlayer() {
    return {
      x: LANDER_POS.x + 95,
      y: LANDER_POS.y + 152,
      r: 14,
      speed: 200,
      o2: 100,
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
    game.warnings = { o2: 0, food: 0, rad: 0, power: 0, water: 0, suit: 0 };
    game.sheltered = false;
    game.o2Refill = false;
    game.foodRefill = false;
    game.powerRefill = false;
    game.waterRefill = false;
    game.nearBeacon = false;
    game.nearAction = '';
    game.hudTimer = 0;
    game.lastMapDraw = 0;
    game.flags = {};
    game.tips = [];
    game.nearPart = { x: LANDER_POS.x - 160, y: LANDER_POS.y + 120, r: 28, repaired: false };
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

    game.rocks = makeRocks();
    game.items = [];
    makeItems();
    // Story state and mission objects — PICO: THE MARTIAN SURVIVOR (2030)
    game.missionIndex = 0;
    game.missionPhase = 'before';
    game.story = {
      crashContact: false,
      commsatParts: 0,
      commsatFixed: false,
      resourcesCollected: 0,
      waterSecured: false,
      commsRepaired: false,
      craterReached: false,
      roverUsed: false,
      lifeSupportStabilised: false,
      dungeonExplored: false,
      dungeonLooted: false,
      repairPlanStarted: false,
      spacecraftParts: 0,
      spacecraftRepaired: false,
      launched: false,
      reunited: false,
      commsStatic: false,
      m1Timer: 0
    };
    game.storyObjects = {
      // Reused/repurposed interactables for the new story
      crashPod: { x: LANDER_POS.x, y: LANDER_POS.y, r: 50 },
      commsUnit: { x: LANDER_POS.x - 240, y: LANDER_POS.y - 120, r: 30, repaired: false }, // damaged communications equipment
      waterSource: { x: 4500, y: 900, r: 36, secured: false },
      rover: { x: LANDER_POS.x + 120, y: LANDER_POS.y + 220, r: 32 },
      crater: { x: 5200, y: 3400, r: 70 },
      lifeSupport: { x: LANDER_POS.x - 60, y: LANDER_POS.y + 200, r: 30, repaired: false }, // failing life-support equipment
      spacecraft: { x: LANDER_POS.x + 20, y: LANDER_POS.y - 40, r: 40, repaired: false, launched: false }
    };
    // Ensure dungeons are present (randomized earlier) for Chapter 3
    game._dungeonVisited = false;
    setupMissionWorld(0);
    game.player = makePlayer();
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
    return !!(game.spaceCentre && dist(x, y, game.spaceCentre.x, game.spaceCentre.y) < game.spaceCentre.refillR);
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

  // Mission helpers — PICO: THE MARTIAN SURVIVOR
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
      dom.missionPanelHint.innerHTML = 'Press <kbd>Enter</kbd> or click to continue';
    } else {
      dom.missionPanelText.textContent = `${m.after}\n\n${m.accomplished}`;
      const next = MISSIONS[game.missionIndex + 1];
      dom.missionPanelObjective.innerHTML = next ? `<b>Next:</b> ${next.name}` : `<b>Final:</b> Pico's journey home is complete.`;
      dom.missionPanelBtn.textContent = next ? `Continue` : 'See Ending';
      dom.missionPanelHint.innerHTML = 'Press <kbd>Enter</kbd> or click to continue';
    }
    dom.screen.classList.remove('hidden');
    dom.startPanel.classList.add('hidden');
    dom.endPanel.classList.add('hidden');
    dom.missionPanel.classList.remove('hidden');
    dom.pause.classList.add('hidden');
  }
  function hideMissionPanel() {
    dom.missionPanel.classList.add('hidden');
  }
  function startMissionBriefing() {
    if (!game.player) return;
    showMissionBriefing('before');
  }
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
      // Mission-specific activation cues
      if (m.id === 1) game.story.m1Timer = 0;
      if (m.id === 5) { game.story.commsStatic = true; toast('PICO: "Captain? ... Static."', 'danger', 4200); }
      if (m.id === 10) { game.story.reunionTimer = 0; }
    } else if (game.missionPhase === 'after') {
      if ((game.missionIndex || 0) >= MISSIONS.length - 1) {
        hideMissionPanel();
        endGame('won', 'A HERO RETURNS',
          `After a long and difficult journey, Pico reunites with the main spacecraft.\n\nSRISTI: "PICO! YOU MADE IT!"\nBHAVYESH: "We were so worried about you!"\nBIKRAMADITYA: "That's incredible! You actually repaired your spacecraft!"\nANURAG: "Welcome back, buddy!"\nSASWATI: "We knew you could do it!"\n\nCAPTAIN VIJAY: "You did something extraordinary, Pico."\nPICO: "I just wanted to come home, Captain."\nCAPTAIN VIJAY: "You didn't just survive Mars. You proved that courage has nothing to do with age."\n\nTHE END.`);
        return;
      }
      game.missionIndex = (game.missionIndex || 0) + 1;
      setupMissionWorld(game.missionIndex);
      state = 'briefing';
      showMissionBriefing('before');
    }
  }
  function showMissionSuccessImage(m) {
    if (!m) return;
    state = 'briefing';
    game.missionPhase = 'successImage';
    if (dom.screen) dom.screen.classList.add('hidden');
    hideMissionPanel();
    if (dom.missionSuccessKicker) dom.missionSuccessKicker.textContent = `CHAPTER ${m.chapter} · ${m.accomplished || 'MISSION COMPLETE'}`;
    if (dom.missionSuccessText) dom.missionSuccessText.textContent = 'Broken commsat repaired. Communication link restored with Captain Vijay.';
    if (dom.missionSuccessPopup) dom.missionSuccessPopup.classList.remove('hidden');
    Sound.wind(false);
  }
  function onMissionSuccessContinue() {
    if (game.missionPhase !== 'successImage') return;
    if (dom.missionSuccessPopup) dom.missionSuccessPopup.classList.add('hidden');
    if ((game.missionIndex || 0) >= MISSIONS.length - 1) {
      endGame('won', 'A HERO RETURNS',
        `After a long and difficult journey, Pico reunites with the main spacecraft.\n\nSRISTI: "PICO! YOU MADE IT!"\nBHAVYESH: "We were so worried about you!"\nBIKRAMADITYA: "That's incredible! You actually repaired your spacecraft!"\nANURAG: "Welcome back, buddy!"\nSASWATI: "We knew you could do it!"\n\nCAPTAIN VIJAY: "You did something extraordinary, Pico."\nPICO: "I just wanted to come home, Captain."\nCAPTAIN VIJAY: "You didn't just survive Mars. You proved that courage has nothing to do with age."\n\nTHE END.`);
      return;
    }
    game.missionIndex = (game.missionIndex || 0) + 1;
    setupMissionWorld(game.missionIndex);
    state = 'briefing';
    showMissionBriefing('before');
  }

  function missionCompleteCheck() {
    if (!game.player || game.missionPhase !== 'active') return;
    const m = currentMission();
    if (!m) return;
    const s = game.story || {};
    let done = false;
    switch (m.id) {
      case 1: done = !!s.commsatFixed && !!s.crashContact; break;
      case 2: done = (s.resourcesCollected || 0) >= 3 && !!s.waterSecured; break;
      case 3: done = !!s.commsRepaired; break;
      case 4: done = !!s.craterReached; break;
      case 5: done = !!s.lifeSupportStabilised; break;
      case 6: done = !!s.dungeonLooted; break;
      case 7: done = !!s.repairPlanStarted; break;
      case 8: done = !!s.spacecraftRepaired; break;
      case 9: done = !!s.launched; break;
      case 10: done = !!s.reunited; break;
    }
    if (done) {
      game.missionPhase = 'completing';
      Sound.cell();
      burst(game.player.x, game.player.y, '#8dffb0', 40, 160);
      setTimeout(() => {
        if (m.id === 1) showMissionSuccessImage(m);
        else showMissionBriefing('after');
      }, 900);
    }
  }
  function setupMissionWorld(index) {
    const m = MISSIONS[index] || MISSIONS[0];
    if (!game.story) game.story = {};
    // Mission-specific setup
    if (m.id === 1) {
      game.story.crashContact = false;
      game.story.commsatParts = 0;
      game.story.commsatFixed = false;
      game.story.m1Timer = 0;
      if (game.storyObjects.commsUnit) game.storyObjects.commsUnit.repaired = false;
      // Spawn 3 commsat components near the crash site
      game.items = (game.items || []).filter(it => it.storyTag !== 'm1comms');
      const commsParts = [
        { x: LANDER_POS.x - 170, y: LANDER_POS.y - 40, label: 'Antenna Module' },
        { x: LANDER_POS.x + 150, y: LANDER_POS.y - 160, label: 'Signal Chip' },
        { x: LANDER_POS.x - 60, y: LANDER_POS.y + 170, label: 'Power Coupler' }
      ];
      commsParts.forEach((p, i) => {
        game.items.push({ type: 'part', partId: 'comms_' + i, x: p.x, y: p.y, r: 14, taken: false, phase: rnd(0, TAU), storyTag: 'm1comms', label: p.label });
      });
    }
    if (m.id === 2) {
      // spawn 3 resources near crash site and require securing a water source
      game.items = game.items.filter(it => it.storyTag !== 'm2res');
      const pts = [
        { x: LANDER_POS.x - 180, y: LANDER_POS.y + 60 },
        { x: LANDER_POS.x + 140, y: LANDER_POS.y - 120 },
        { x: LANDER_POS.x - 40, y: LANDER_POS.y - 200 }
      ];
      pts.forEach((p, i) => {
        game.items.push({ type: 'sample', x: p.x, y: p.y, r: 13, taken: false, phase: rnd(0, TAU), storyTag: 'm2res', sampleId: 'm2_' + i });
      });
      game.story.resourcesCollected = 0;
      game.story.waterSecured = false;
      if (game.storyObjects.waterSource) game.storyObjects.waterSource.secured = false;
    }
    if (m.id === 3) {
      // Commsat was fixed in Mission 1; calibrate/boost it in Mission 3
      game.story.commsRepaired = false;
      // keep commsUnit visually repaired state until calibration completes
      if (game.storyObjects.commsUnit) game.storyObjects.commsUnit.repaired = !!game.story.commsatFixed;
    }
    if (m.id === 4) {
      game.story.craterReached = false;
      game.story.roverUsed = false;
    }
    if (m.id === 5) {
      game.story.lifeSupportStabilised = false;
      if (game.storyObjects.lifeSupport) game.storyObjects.lifeSupport.repaired = false;
      game.story.commsStatic = true;
    }
    if (m.id === 6) {
      game.story.dungeonLooted = false;
      game.story.dungeonExplored = !!game._dungeonVisited;
    }
    if (m.id === 7) {
      game.story.repairPlanStarted = false;
    }
    if (m.id === 8) {
      // require gathering 3 spacecraft parts (repurpose existing part items) and repairing at spacecraft
      game.story.spacecraftParts = 0;
      game.story.spacecraftRepaired = false;
      if (game.storyObjects.spacecraft) game.storyObjects.spacecraft.repaired = false;
      // place 3 repair parts around Mars if not already present
      game.items = game.items.filter(it => it.storyTag !== 'm8part');
      const partSpots = [
        { x: 900, y: 1500, partId: 'valve' },
        { x: 4700, y: 3100, partId: 'chip' },
        { x: 1200, y: 3300, partId: 'seal' }
      ];
      partSpots.forEach((p) => {
        game.items.push({ type: 'part', partId: p.partId, x: p.x, y: p.y, r: 13, taken: false, phase: rnd(0, TAU), storyTag: 'm8part' });
      });
      game.side.partIds = {};
      game.side.parts = 0;
    }
    if (m.id === 9) {
      game.story.launched = false;
      if (game.storyObjects.spacecraft) game.storyObjects.spacecraft.launched = false;
    }
    if (m.id === 10) {
      game.story.reunited = false;
      game.story.reunionTimer = 0;
    }
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

    // Opening guidance (Captain Vijay)
    if (!game.flags.tip1 && game.time > 0.8) {
      game.flags.tip1 = true;
      toast('CAPTAIN VIJAY: "Pico! Can you hear me? Stay calm — I\'ll guide you."', 'good', 5200);
    }
    if (!game.flags.tip2 && game.time > 5.0) {
      game.flags.tip2 = true;
      toast('Monitor oxygen, power, water, food, radiation, and suit integrity. The yellow arrow points to your objective.', '', 5200);
    }
    // Mission 1: establish contact shortly after beginning (survive crash and make contact)
    if (game.missionIndex === 0 && game.missionPhase === 'active' && !game.story.crashContact) {
      game.story.m1Timer = (game.story.m1Timer || 0) + dt;
      if (game.story.m1Timer > 4.5) {
        game.story.crashContact = true;
        toast('Weak signal established with Captain Vijay.', 'good', 4200);
      }
    }
    // Occasional comms static during unexpected-problems chapter
    if (game.missionIndex === 4 && game.missionPhase === 'active' && !game.flags.m5static && game.time % 18 < dt) {
      game.flags.m5static = true;
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
    if (touch.active) {
      ix += touch.dx;
      iy += touch.dy;
    }
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
        if (game.location === 'outdoor') puff(p.x, p.y + 13);
      }
    } else {
      p.stepT = 0;
    }

    resolveCollisions(p);

    // Suit life support: O₂, food, power, water, radiation, and suit integrity.
    const sheltered = isRadSheltered(p.x, p.y);
    const o2Refill = isO2Refill(p.x, p.y);
    const foodRefill = isFoodRefill(p.x, p.y);
    const powerRefill = isPowerRefill(p.x, p.y);
    const waterRefill = isWaterRefill(p.x, p.y);
    const suitRepair = isSuitRepair(p.x, p.y);
    if (o2Refill && !game.o2Refill && p.o2 < p.maxO2 - 1) toast('Oxygen refilling.', 'good', 2200);
    if (foodRefill && !game.foodRefill && p.food < 99) toast('Food refilling.', 'good', 2200);
    if (powerRefill && !game.powerRefill && p.power < p.maxPower - 1) toast('Power charging.', 'good', 2200);
    if (waterRefill && !game.waterRefill && p.water < 99) toast('Water supply refilling.', 'good', 2200);
    if (suitRepair && p.suit < p.maxSuit - 1) game._suitRepairToastT = (game._suitRepairToastT || 0) + dt;
    else game._suitRepairToastT = 0;
    if (game._suitRepairToastT > 1.2) { toast('Suit integrity being repaired.', 'good', 2200); game._suitRepairToastT = -6; }
    game.sheltered = sheltered;
    game.o2Refill = o2Refill;
    game.foodRefill = foodRefill;
    game.powerRefill = powerRefill;
    game.waterRefill = waterRefill;

    let o2Rate = -RATES.o2;
    if (sprinting) o2Rate -= RATES.o2Sprint;
    if (p.starving) o2Rate *= RATES.o2Starve;
    if (p.suit < 35) o2Rate -= 0.25;
    if (o2Refill) o2Rate = RATES.o2Refill;
    p.o2 = clamp(p.o2 + o2Rate * dt, 0, p.maxO2);

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
      // During active solar flare, radiation rises extremely fast: +2 points every 2.5ms (800/s)
      const base = flareActive ? 800 : zoneRad;
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

    // Mission 6 (new story): entering any dungeon and recovering loot counts as progress
    if (game.missionIndex === 5 && game.missionPhase === 'active') {
      if (game.location === 'dungeon') game._dungeonVisited = true;
      if (game._dungeonVisited) game.story.dungeonExplored = true;
    }
    // Mission 10: automatic reunion shortly after it begins
    if (game.missionIndex === 9 && game.missionPhase === 'active' && !game.story.reunited) {
      game.story.reunionTimer = (game.story.reunionTimer || 0) + dt;
      if (game.story.reunionTimer > 1.2) game.story.reunited = true;
    }

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
    // Collide with centres and comm array
    for (const c of [game.spaceCentre, game.foodCentre, game.commArray]) {
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
        if (game.quest.rocksCollected < game.quest.rocksRequired) game.quest.rocksCollected++;
        if (it.storyTag === 'm2res') {
          game.story.resourcesCollected = (game.story.resourcesCollected || 0) + 1;
          toast(`Resource collected near crash site (${game.story.resourcesCollected}/3)`, 'gold', 3200);
        } else {
          const info = SAMPLE_DEFS.find((s) => s.id === it.sampleId);
          toast(`Mars sample collected: ${info ? info.name : 'Sample'}`, 'gold', 3600);
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
        p.suit = clamp(p.suit + 35, 0, p.maxSuit);
        toast('Suit repaired with field kit', 'good', 2600);
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
        if (it.storyTag === 'm1comms') {
          game.story.commsatParts = (game.story.commsatParts || 0) + 1;
          toast(`${it.label || 'Commsat component'} found (${game.story.commsatParts}/3)`, 'gold', 3600);
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

      // Mission 6: recovering anything valuable inside a dungeon counts
      if (game.location === 'dungeon' && game.missionIndex === 5 && game.missionPhase === 'active') {
        game._dungeonVisited = true;
        game.story.dungeonExplored = true;
        game.story.dungeonLooted = true;
      }
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

    if (a === 'story:comms') {
      if (so.commsUnit && !s.commsRepaired) {
        s.commsRepaired = true; so.commsUnit.repaired = true;
        burst(so.commsUnit.x, so.commsUnit.y, '#7ef0ff', 30, 150);
        toast('CAPTAIN VIJAY: "Equipment restored. You\'re learning fast, Pico."', 'good', 4800);
        Sound.cell(); updateHud();
      } return;
    }
    if (a === 'story:water') {
      if (so.waterSource && !s.waterSecured) {
        s.waterSecured = true; so.waterSource.secured = true;
        p.water = clamp(p.water + 50, 0, 100);
        burst(so.waterSource.x, so.waterSource.y, '#7fdcff', 35, 150);
        toast('Water source secured. Survival chances improved.', 'good', 4500);
        Sound.cell(); updateHud();
      } return;
    }
    if (a === 'story:roverToCrater') {
      if (so.rover && !s.craterReached) {
        s.roverUsed = true;
        p.x = so.crater.x - 60; p.y = so.crater.y + 40;
        s.craterReached = true;
        updateCamera(0, true);
        burst(p.x, p.y, '#ffd08a', 28, 140);
        toast('You reached the distant crater.', 'good', 4500);
        Sound.cell(); updateHud();
      } return;
    }
    if (a === 'story:lifeSupport') {
      if (so.lifeSupport && !s.lifeSupportStabilised) {
        s.lifeSupportStabilised = true; so.lifeSupport.repaired = true;
        p.o2 = p.maxO2; p.power = clamp(p.power + 25, 0, p.maxPower);
        burst(so.lifeSupport.x, so.lifeSupport.y, '#63e7f4', 35, 150);
        toast('Failing life-support equipment stabilised.', 'good', 4800);
        Sound.cell(); updateHud();
      } return;
    }
    if (a === 'story:repairPlan') {
      if (so.spacecraft && !s.repairPlanStarted) {
        s.repairPlanStarted = true;
        burst(so.spacecraft.x, so.spacecraft.y, '#ffe08a', 30, 150);
        toast('PICO: "If I want to return home, I must repair my spacecraft myself."', 'gold', 5200);
        Sound.cell(); updateHud();
      } return;
    }
    if (a === 'story:repairSpacecraft') {
      if (so.spacecraft && !s.spacecraftRepaired && (s.spacecraftParts || 0) >= 3) {
        s.spacecraftRepaired = true; so.spacecraft.repaired = true;
        burst(so.spacecraft.x, so.spacecraft.y, '#ffe08a', 50, 190);
        toast('CAPTAIN VIJAY: "Propulsion and navigation look good. The spacecraft is ready."', 'gold', 6500);
        Sound.win(); updateHud();
      } else {
        toast(`Collect spacecraft components first (${s.spacecraftParts || 0}/3).`, '', 3000);
      } return;
    }
    if (a === 'story:launch') {
      if (so.spacecraft && s.spacecraftRepaired && !s.launched) {
        s.launched = true; so.spacecraft.launched = true;
        game.shake = 10;
        burst(so.spacecraft.x, so.spacecraft.y - 20, '#ffd36e', 70, 240);
        toast('SYSTEM: "ENGINE ACTIVATION." Pico lifts off from Mars.', 'gold', 6000);
        Sound.win(); updateHud();
      } else if (!s.spacecraftRepaired) {
        toast('Repair the spacecraft before launch.', 'danger', 2800);
      } return;
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
      if (id === 1 && so.commsUnit && !s.commsatFixed && dist(p.x,p.y,so.commsUnit.x,so.commsUnit.y) < 60) {
        action = 'story:comms'; prompt = (s.commsatParts||0)>=3 ? 'Press E to repair the broken commsat' : `Find commsat components (${s.commsatParts||0}/3), then press E to repair`;
      } else if (id === 2 && so.waterSource && !s.waterSecured && dist(p.x,p.y,so.waterSource.x,so.waterSource.y) < 60) {
        action = 'story:water'; prompt = 'Press E to secure the water source';
      } else if (id === 3 && so.commsUnit && !s.commsRepaired && dist(p.x,p.y,so.commsUnit.x,so.commsUnit.y) < 60) {
        action = 'story:comms'; prompt = 'Press E to calibrate the repaired commsat';
      } else if (id === 4 && so.rover && !s.craterReached && dist(p.x,p.y,so.rover.x,so.rover.y) < 60) {
        action = 'story:roverToCrater'; prompt = 'Press E to travel by rover to the distant crater';
      } else if (id === 5 && so.lifeSupport && !s.lifeSupportStabilised && dist(p.x,p.y,so.lifeSupport.x,so.lifeSupport.y) < 60) {
        action = 'story:lifeSupport'; prompt = 'Press E to repair failing life-support equipment';
      } else if (id === 7 && so.spacecraft && !s.repairPlanStarted && dist(p.x,p.y,so.spacecraft.x,so.spacecraft.y) < 70) {
        action = 'story:repairPlan'; prompt = 'Press E to examine the damaged spacecraft and begin repairs';
      } else if (id === 8 && so.spacecraft && !s.spacecraftRepaired && dist(p.x,p.y,so.spacecraft.x,so.spacecraft.y) < 70) {
        action = 'story:repairSpacecraft'; prompt = (s.spacecraftParts||0)>=3 ? 'Press E to restore spacecraft systems' : `Collect parts (${s.spacecraftParts||0}/3) then press E to repair`;
      } else if (id === 9 && so.spacecraft && s.spacecraftRepaired && !s.launched && dist(p.x,p.y,so.spacecraft.x,so.spacecraft.y) < 70) {
        action = 'story:launch'; prompt = 'Press E to initiate launch sequence';
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
      if (dist(p.x, p.y, ex.x, ex.y) < ex.r + 10) {
        action = 'exitDungeon';
        prompt = 'Press E to exit to the surface';
      }
    } else if (!action && game.location === 'outdoor') {
      for (const d of game.dungeons || []) {
        if (dist(p.x, p.y, d.entrance.x, d.entrance.y) < d.entrance.r + 18) {
          action = 'enterDungeon:' + d.id;
          prompt = `Press E to enter ${d.name}`;
          break;
        }
      }
    }

    if (action && action !== game.nearAction && prompt) toast(prompt, 'gold', 2600);
    game.nearAction = action;
    document.body.classList.toggle('can-install', !!action);
    if (dom.installBtn) {
      if (action === 'story:water') dom.installBtn.textContent = 'Secure water';
      else if (action === 'story:comms') dom.installBtn.textContent = 'Repair comms';
      else if (action === 'story:roverToCrater') dom.installBtn.textContent = 'Travel to crater';
      else if (action === 'story:lifeSupport') dom.installBtn.textContent = 'Repair life support';
      else if (action === 'story:repairPlan') dom.installBtn.textContent = 'Begin repair plan';
      else if (action === 'story:repairSpacecraft') dom.installBtn.textContent = 'Repair spacecraft';
      else if (action === 'story:launch') dom.installBtn.textContent = 'Launch';
      else if (action === 'exitDungeon') dom.installBtn.textContent = 'Exit';
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
    if (m) {
      switch (m.id) {
        case 1:
          if (!s.commsatFixed) {
            if ((s.commsatParts || 0) < 3) {
              let best = null, bd = Infinity;
              for (const it of (game.items || [])) {
                if (it.taken || it.storyTag !== 'm1comms') continue;
                const d = dist(p.x, p.y, it.x, it.y);
                if (d < bd) { bd = d; best = it; }
              }
              if (best) return { x: best.x, y: best.y, label: 'COMMSAT PART', kind: 'item' };
            }
            if (so.commsUnit) return { x: so.commsUnit.x, y: so.commsUnit.y, label: 'BROKEN COMMSAT', kind: 'cell' };
          }
          return { x: LANDER_POS.x, y: LANDER_POS.y, label: 'CRASH SITE', kind: 'lander' };
        case 2: {
          if ((s.resourcesCollected || 0) < 3) {
            let best = null, bd = Infinity;
            for (const it of game.items) {
              if (it.taken || it.storyTag !== 'm2res') continue;
              const d = dist(p.x, p.y, it.x, it.y);
              if (d < bd) { bd = d; best = it; }
            }
            if (best) return { x: best.x, y: best.y, label: 'RESOURCE', kind: 'cell' };
          }
          if (!s.waterSecured && so.waterSource) return { x: so.waterSource.x, y: so.waterSource.y, label: 'SECURE WATER', kind: 'cell' };
          return { x: LANDER_POS.x, y: LANDER_POS.y, label: 'CRASH SITE', kind: 'lander' };
        }
        case 3:
          return so.commsUnit ? { x: so.commsUnit.x, y: so.commsUnit.y, label: s.commsRepaired ? 'COMMSAT' : 'CALIBRATE COMMSAT', kind: 'cell' } : null;
        case 4:
          if (!s.craterReached && so.rover) return { x: so.rover.x, y: so.rover.y, label: 'ROVER', kind: 'amp' };
          return so.crater ? { x: so.crater.x, y: so.crater.y, label: 'DISTANT CRATER', kind: 'cell' } : null;
        case 5:
          return so.lifeSupport ? { x: so.lifeSupport.x, y: so.lifeSupport.y, label: s.lifeSupportStabilised ? 'LIFE SUPPORT' : 'STABILISE LIFE SUPPORT', kind: 'cell' } : null;
        case 6: {
          if (s.dungeonLooted) return { x: LANDER_POS.x, y: LANDER_POS.y, label: 'CRASH SITE', kind: 'lander' };
          let best = null, bd = Infinity;
          for (const d of (game.dungeons || [])) {
            const dd = dist(p.x, p.y, d.entrance.x, d.entrance.y);
            if (dd < bd) { bd = dd; best = d; }
          }
          if (best) return { x: best.entrance.x, y: best.entrance.y, label: 'UNDERGROUND DUNGEON', kind: 'cell' };
          return { x: LANDER_POS.x, y: LANDER_POS.y, label: 'EXPLORE', kind: 'lander' };
        }
        case 7:
          return so.spacecraft ? { x: so.spacecraft.x, y: so.spacecraft.y, label: s.repairPlanStarted ? 'SPACECRAFT' : 'EXAMINE SPACECRAFT', kind: 'lander' } : null;
        case 8: {
          if ((s.spacecraftParts || 0) < 3) {
            let best = null, bd = Infinity;
            for (const it of game.items) {
              if (it.taken || it.storyTag !== 'm8part') continue;
              const d = dist(p.x, p.y, it.x, it.y);
              if (d < bd) { bd = d; best = it; }
            }
            if (best) return { x: best.x, y: best.y, label: 'SPACECRAFT PART', kind: 'cell' };
          }
          return so.spacecraft ? { x: so.spacecraft.x, y: so.spacecraft.y, label: s.spacecraftRepaired ? 'SPACECRAFT READY' : 'REPAIR SPACECRAFT', kind: 'lander' } : null;
        }
        case 9:
          return so.spacecraft ? { x: so.spacecraft.x, y: so.spacecraft.y, label: s.launched ? 'LAUNCHED' : 'LAUNCH SPACECRAFT', kind: 'lander' } : null;
        case 10:
          return { x: LANDER_POS.x, y: LANDER_POS.y, label: 'CREW', kind: 'lander' };
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
    for (const m of game.motes) {
      m.x += (m.vx + (active ? 90 : 0)) * dt;
      m.y += m.vy * dt;
      if (m.x < -30) m.x += vw + 60;
      if (m.x > vw + 30) m.x -= vw + 60;
      if (m.y < -30) m.y += vh + 60;
      if (m.y > vh + 30) m.y -= vh + 60;
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

    const m = currentMission();
    if (m) {
      const ch = CHAPTERS.find(c => c.id === m.chapter) || CHAPTERS[0];
      const s = game.story || {};
      dom.missionEyebrow.textContent = `CHAPTER ${ch.id} · ${m.id}/${MISSIONS.length}`;
      let text = '', hint = m.objective, progress = 0;
      switch (m.id) {
        case 1: {
          const cp = s.commsatParts || 0;
          progress = s.commsatFixed ? 1 : clamp(cp / 3 * 0.8 + (cp >= 3 ? 0.1 : 0), 0, 0.95);
          text = s.commsatFixed ? 'Commsat <b>repaired</b> · Contact <b>restored</b>' : `Commsat parts <b>${cp}</b>/3 · Commsat <b>broken</b>`;
          hint = s.commsatFixed ? 'Communication link restored.' : (cp >= 3 ? 'All components found. Go to the broken commsat and press E to repair it.' : 'Find 3 commsat components near the crash site, then repair the broken commsat.');
          break;
        }
        case 2: {
          const rc = s.resourcesCollected || 0;
          progress = clamp((rc / 3) * 0.6 + (s.waterSecured ? 0.4 : 0), 0, 1);
          text = `Resources <b>${rc}</b>/3 · Water <b>${s.waterSecured ? 'secured' : 'needed'}</b>`;
          hint = (rc >= 3 && s.waterSecured) ? 'Survival basics secured.' : 'Collect 3 resources near the crash site and secure a water source.';
          break;
        }
        case 3:
          progress = s.commsRepaired ? 1 : 0.25;
          text = s.commsRepaired ? 'Commsat <b>calibrated</b>' : 'Commsat <b>needs calibration</b>';
          hint = s.commsRepaired ? 'Training objective complete.' : 'Calibrate and boost the repaired commsat near the pod.';
          break;
        case 4:
          progress = s.craterReached ? 1 : 0.35;
          text = s.craterReached ? 'Distant crater <b>reached</b>' : 'Distant crater <b>not reached</b>';
          hint = s.craterReached ? 'Exploration complete.' : 'Explore Mars and reach the distant crater landmark.';
          break;
        case 5:
          progress = s.lifeSupportStabilised ? 1 : 0.3;
          text = s.lifeSupportStabilised ? 'Life support <b>stabilised</b>' : 'Life support <b>failing</b>';
          hint = s.lifeSupportStabilised ? 'Situation stabilised despite comms issues.' : 'Repair failing life-support equipment and stabilise your situation.';
          break;
        case 6:
          progress = s.dungeonLooted ? 1 : (s.dungeonExplored ? 0.6 : 0.2);
          text = s.dungeonLooted ? 'Dungeon resources <b>recovered</b>' : (s.dungeonExplored ? 'Dungeon <b>entered</b>' : 'Find an <b>underground dungeon</b>');
          hint = s.dungeonLooted ? 'Valuable equipment secured.' : 'Enter an underground dungeon and recover vital equipment/resources inside.';
          break;
        case 7:
          progress = s.repairPlanStarted ? 1 : 0.25;
          text = s.repairPlanStarted ? 'Repair plan <b>started</b>' : 'Resolve <b>not set</b>';
          hint = s.repairPlanStarted ? 'You know what must be done.' : 'Reach your damaged spacecraft and begin the repair plan.';
          break;
        case 8: {
          const parts = s.spacecraftParts || 0;
          progress = s.spacecraftRepaired ? 1 : clamp(parts / 3 * 0.75 + 0.1, 0, 0.95);
          text = s.spacecraftRepaired ? 'Spacecraft <b>repaired</b>' : `Parts <b>${parts}</b>/3 · Systems <b>offline</b>`;
          hint = s.spacecraftRepaired ? 'Ready for final checks.' : 'Gather repair materials/parts and restore the spacecraft systems.';
          break;
        }
        case 9:
          progress = s.launched ? 1 : (s.spacecraftRepaired ? 0.7 : 0.2);
          text = s.launched ? 'Launch <b>successful</b>' : 'Spacecraft <b>ready to launch</b>';
          hint = s.launched ? 'Escaping Mars...' : 'Launch the spacecraft and escape Mars.';
          break;
        case 10:
          progress = s.reunited ? 1 : 0.8;
          text = s.reunited ? 'Crew <b>reunited</b>' : 'Approaching <b>main spacecraft</b>';
          hint = s.reunited ? 'Welcome home, Pico.' : 'Reunite with Captain Vijay and the crew.';
          break;
        default:
          text = m.name;
          break;
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

    dom.hud.classList.remove('hidden');
    dom.minimapWrap.classList.remove('hidden');
    dom.installBtn.classList.add('hidden');
    dom.shelterChip.classList.remove('show');
    dom.flareBanner.classList.add('hidden');
    dom.regionBanner.classList.remove('show');
    dom.journal.classList.add('hidden');
    if (dom.infoPopup) dom.infoPopup.classList.add('hidden');
    if (dom.missionSuccessPopup) dom.missionSuccessPopup.classList.add('hidden');
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
    if (kind === 'won') Sound.win();
    else Sound.death();

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
      `<b>Resources (current):</b> ${(s.resourcesCollected || 0)}/3 collected, water ${s.waterSecured ? 'secured' : 'not secured'}.`,
      `<b>Spacecraft parts:</b> ${(s.spacecraftParts || 0)}/3 recovered.`,
      `<b>Field logs:</b> ${game.stats.logs || 0}/${(game.logs || []).length} found.`,
      `<b>Real Mars regions:</b> Gusev Crater, Meridiani Planum, Gale Crater, Jezero Crater, Valles Marineris (with Spirit & Opportunity landing sites marked by USA flags).`
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
    for (const d of (game.dungeons || [])) push(d.entrance.x, d.entrance.y, drawDungeonEntrance, d);
    for (const it of game.items) if (!it.taken) push(it.x, it.y, drawItem, it);
    for (const l of game.logs) if (!l.taken) push(l.x, l.y, drawLog, l);
    if (game.nearPart) push(game.nearPart.x, game.nearPart.y, drawNearPart, game.nearPart);
    if (game.storyObjects) {
      const so = game.storyObjects;
      if (so.commsUnit) push(so.commsUnit.x, so.commsUnit.y, drawAntenna, so.commsUnit);
      if (so.waterSource) push(so.waterSource.x, so.waterSource.y, drawWaterIce, so.waterSource);
      if (so.rover) push(so.rover.x, so.rover.y, drawRover, so.rover);
      if (so.crater) push(so.crater.x, so.crater.y, drawCraterMarker, so.crater);
      if (so.lifeSupport) push(so.lifeSupport.x, so.lifeSupport.y, drawOxygenMachine, so.lifeSupport);
      if (so.spacecraft) push(so.spacecraft.x, so.spacecraft.y, drawTransmitter, so.spacecraft);
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

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawZoneAtmosphere(t);
    drawFlareFX(t);
    drawObjectiveMarker(t);
    drawTouchStick();

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
    g.addColorStop(0, '#0b0610');
    g.addColorStop(0.28, '#1a0d14');
    g.addColorStop(0.55, '#331611');
    g.addColorStop(0.82, '#6a311f');
    g.addColorStop(1, '#9a4a29');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.w, skyBottom);

    // Stars
    ctx.save();
    for (let i = 0; i < 70; i++) {
      const sx = (i * 137.5) % VIEW.w;
      const sy = ((i * 97.3) % Math.max(60, skyBottom - 20)) + 8;
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (0.7 + (i % 5) * 0.23) + i));
      ctx.globalAlpha = 0.12 + tw * 0.38;
      ctx.fillStyle = i % 7 === 0 ? '#ffd9bf' : '#fff7f0';
      ctx.beginPath();
      ctx.arc(sx, sy, i % 9 === 0 ? 1.4 : 0.8, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Ground base under the warped plane
    ctx.fillStyle = '#24140e';
    ctx.fillRect(0, skyBottom, VIEW.w, VIEW.h - skyBottom);

    // Dual horizon glow
    const sunX = VIEW.w * 0.62;
    const rg = ctx.createRadialGradient(sunX, horizon - 18, 10, sunX, horizon + 10, VIEW.w * 0.35);
    rg.addColorStop(0, 'rgba(255,210,150,0.22)');
    rg.addColorStop(0.45, 'rgba(255,140,80,0.14)');
    rg.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, Math.max(0, horizon - 140), VIEW.w, 200);

    const glow = ctx.createLinearGradient(0, horizon - 120, 0, horizon + 30);
    glow.addColorStop(0, 'rgba(255,132,72,0)');
    glow.addColorStop(0.6, 'rgba(255,128,68,0.12)');
    glow.addColorStop(1, 'rgba(255,174,114,0.28)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, Math.max(0, horizon - 120), VIEW.w, 160);
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
    for (const d of (game.dungeons || [])) {
      label(w2s(d.entrance.x, d.entrance.y), `${d.name.toUpperCase()} · DUNGEON`, 92, 'rgba(255,210,170,0.72)');
    }

    if (game.nearPart) {
      const np = w2s(game.nearPart.x, game.nearPart.y);
      label(np, 'DAMAGED EQUIPMENT', 58, 'rgba(255,210,150,0.72)');
    }

    if (game.commArray) {
      const ca = game.commArray;
      const cs = w2s(ca.x, ca.y);
      label(cs, 'COMM ARRAY', 132, 'rgba(150,255,220,0.75)');
    }

    const L = game.lander;
    const s = game.story || {};
    const ls = w2s(L.x, L.y);
    const beaconLabel = s.launched ? 'CRASH SITE · LAUNCHED' : (s.spacecraftRepaired ? 'CRASH SITE · SPACECRAFT READY' : 'CRASH SITE / LANDER');
    label(ls, beaconLabel, 138, s.spacecraftRepaired ? 'rgba(150,255,190,0.9)' : 'rgba(255,224,196,0.62)');

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

    // Story objects — PICO: THE MARTIAN SURVIVOR
    if (game.storyObjects) {
      const so = game.storyObjects;
      const s = game.story || {};
      if (so.commsUnit) {
        const m1 = (game.missionIndex === 0);
        const fixed = !!s.commsatFixed || !!s.commsRepaired;
        let commsLabel = fixed ? 'COMMSAT · ONLINE' : 'BROKEN COMMSAT';
        if (m1 && !s.commsatFixed && (s.commsatParts || 0) >= 3) commsLabel = 'BROKEN COMMSAT · READY TO REPAIR';
        label(w2s(so.commsUnit.x, so.commsUnit.y), commsLabel, 90, fixed ? 'rgba(170,255,220,0.85)' : 'rgba(255,210,150,0.85)');
      }
      if (so.waterSource) label(w2s(so.waterSource.x, so.waterSource.y), s.waterSecured ? 'WATER SOURCE · SECURED' : 'WATER SOURCE', 68, s.waterSecured ? 'rgba(170,255,230,0.85)' : 'rgba(180,240,255,0.85)');
      if (so.rover) label(w2s(so.rover.x, so.rover.y), s.craterReached ? 'ROVER' : 'ROVER · READY', 58, 'rgba(255,235,210,0.8)');
      if (so.crater) label(w2s(so.crater.x, so.crater.y), s.craterReached ? 'DISTANT CRATER · REACHED' : 'DISTANT CRATER', 90, s.craterReached ? 'rgba(170,255,210,0.85)' : 'rgba(255,220,170,0.8)');
      if (so.lifeSupport) label(w2s(so.lifeSupport.x, so.lifeSupport.y), s.lifeSupportStabilised ? 'LIFE SUPPORT · STABLE' : 'LIFE SUPPORT · FAILING', 72, s.lifeSupportStabilised ? 'rgba(170,240,255,0.85)' : 'rgba(255,180,160,0.88)');
      if (so.spacecraft) {
        let txt = 'DAMAGED SPACECRAFT';
        let col = 'rgba(255,220,170,0.85)';
        if (s.launched) { txt = 'SPACECRAFT · LAUNCHED'; col = 'rgba(170,255,210,0.9)'; }
        else if (s.spacecraftRepaired) { txt = 'SPACECRAFT · READY'; col = 'rgba(170,255,220,0.9)'; }
        else if (s.repairPlanStarted) { txt = 'SPACECRAFT · REPAIR IN PROGRESS'; col = 'rgba(255,230,170,0.88)'; }
        label(w2s(so.spacecraft.x, so.spacecraft.y), txt, 80, col);
      }
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
    const repaired = game.quest && game.quest.nearPartRepaired;
    const pulse = 0.5 + 0.5 * Math.sin(t * (repaired ? 3 : 6));
    ctx.fillStyle = 'rgba(20,10,6,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 0, 26, 9, 0, 0, TAU); ctx.fill();
    ctx.save();
    ctx.translate(0, -10);
    ctx.fillStyle = repaired ? '#9a9588' : '#7a6a58';
    roundRect(ctx, -18, -10, 36, 18, 4); ctx.fill();
    ctx.strokeStyle = repaired ? 'rgba(180,255,210,0.5)' : 'rgba(255,160,120,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = repaired ? `rgba(120,255,180,${0.4 + pulse * 0.4})` : `rgba(255,120,80,${0.35 + pulse * 0.35})`;
    ctx.beginPath(); ctx.arc(0, -2, 3.2, 0, TAU); ctx.fill();
    if (!repaired) {
      ctx.strokeStyle = `rgba(255,210,120,${0.4 + pulse * 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-10, -14); ctx.lineTo(10, 4); ctx.stroke();
    }
    ctx.restore();
  }

  function drawSolarPanels(o, t) {
    const ok = !!game.story?.solarRepaired;
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
    const ok = !!game.story?.waterIceSecured;
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
    const used = !!game.story?.craterReached;
    ctx.fillStyle = 'rgba(20,10,6,0.35)'; ctx.beginPath(); ctx.ellipse(0,0,38,13,0,0,TAU); ctx.fill();
    ctx.save(); ctx.translate(0,-10);
    ctx.fillStyle = used ? '#8e8f92' : '#d8d2c8'; roundRect(ctx,-26,-10,52,18,5); ctx.fill();
    ctx.fillStyle = '#3a3f46';
    [-18,-6,6,18].forEach(x=>{ctx.beginPath(); ctx.arc(x,10,6,0,TAU); ctx.fill();});
    ctx.strokeStyle = '#6feeff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(8,-10); ctx.lineTo(14,-22); ctx.stroke();
    ctx.fillStyle = '#6feeff'; ctx.beginPath(); ctx.arc(14,-23,2.5,0,TAU); ctx.fill();
    ctx.restore();
  }
  function drawCraterMarker(o, t) {
    const reached = !!game.story?.craterReached;
    ctx.save();
    ctx.strokeStyle = reached ? 'rgba(140,255,190,0.35)' : 'rgba(255,210,140,0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0,0,70,26,0,0,TAU); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0,0,44,16,0,0,TAU); ctx.stroke();
    if (reached) { ctx.fillStyle='rgba(140,255,190,0.12)'; ctx.beginPath(); ctx.ellipse(0,0,70,26,0,0,TAU); ctx.fill(); }
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

  function drawTouchStick() {
    if (!touch.active) return;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#ffd0a8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(touch.ox, touch.oy, 44, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = 'rgba(255,160,90,0.5)';
    ctx.beginPath();
    ctx.arc(touch.ox + touch.dx * 36, touch.oy + touch.dy * 36, 17, 0, TAU);
    ctx.fill();
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

  function endTouch(e) {
    if (!touch.active) return;
    if (e && e.pointerId != null && e.pointerId !== touch.id) return;
    touch.active = false;
    touch.id = null;
    touch.dx = 0;
    touch.dy = 0;
  }

  function endLook(e) {
    if (!look.active) return;
    if (e && e.pointerId != null && e.pointerId !== look.id) return;
    look.active = false;
    look.id = null;
  }

  function endPointer(e) {
    endTouch(e);
    endLook(e);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'playing') return;
    if (e.pointerType === 'mouse') {
      look.active = true;
      look.id = e.pointerId;
      look.lastX = e.clientX;
      look.lastY = e.clientY;
    } else if (e.clientX < VIEW.w * 0.46) {
      touch.active = true;
      touch.id = e.pointerId;
      touch.ox = e.clientX;
      touch.oy = e.clientY;
      touch.dx = 0;
      touch.dy = 0;
    } else {
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
    if (touch.active && e.pointerId === touch.id) {
      touch.dx = clamp((e.clientX - touch.ox) / 55, -1, 1);
      touch.dy = clamp((e.clientY - touch.oy) / 55, -1, 1);
      e.preventDefault();
      return;
    }
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

  dom.startBtn.addEventListener('click', startGame);
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
        if (m.id === 1) { st.commsatParts = 3; st.commsatFixed = true; st.crashContact = true; st.commsRepaired = true; st.m1Timer = 99; if (game.storyObjects && game.storyObjects.commsUnit) game.storyObjects.commsUnit.repaired = true; }
        if (m.id === 2) { st.resourcesCollected = 3; st.waterSecured = true; if (game.storyObjects && game.storyObjects.waterSource) game.storyObjects.waterSource.secured = true; }
        if (m.id === 3) { st.commsRepaired = true; st.commsatFixed = true; st.crashContact = true; if (game.storyObjects && game.storyObjects.commsUnit) game.storyObjects.commsUnit.repaired = true; }
        if (m.id === 4) { st.craterReached = true; }
        if (m.id === 5) { st.lifeSupportStabilised = true; if (game.storyObjects && game.storyObjects.lifeSupport) game.storyObjects.lifeSupport.repaired = true; }
        if (m.id === 6) { st.dungeonExplored = true; st.dungeonLooted = true; game._dungeonVisited = true; }
        if (m.id === 7) { st.repairPlanStarted = true; }
        if (m.id === 8) { st.spacecraftParts = 3; st.spacecraftRepaired = true; if (game.storyObjects && game.storyObjects.spacecraft) game.storyObjects.spacecraft.repaired = true; }
        if (m.id === 9) { st.launched = true; if (game.storyObjects && game.storyObjects.spacecraft) { game.storyObjects.spacecraft.repaired = true; game.storyObjects.spacecraft.launched = true; } }
        if (m.id === 10) { st.reunited = true; }
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
        const st = game.story || (game.story = {});
        const so = game.storyObjects || {};
        st.commsatParts = n > 1 ? 3 : 0; st.commsatFixed = n > 1; st.crashContact = n > 1; st.m1Timer = n > 1 ? 99 : 0;
        st.resourcesCollected = n > 2 ? 3 : 0; st.waterSecured = n > 2; if (so.waterSource) so.waterSource.secured = n > 2;
        st.commsRepaired = n > 1; if (so.commsUnit) so.commsUnit.repaired = n > 1;
        st.craterReached = n > 4;
        st.lifeSupportStabilised = n > 5; if (so.lifeSupport) so.lifeSupport.repaired = n > 5;
        st.dungeonExplored = n > 6; st.dungeonLooted = n > 6; game._dungeonVisited = n > 6;
        st.repairPlanStarted = n > 7;
        st.spacecraftParts = n > 8 ? 3 : 0; st.spacecraftRepaired = n > 8; if (so.spacecraft) so.spacecraft.repaired = n > 8;
        st.launched = n > 9; if (so.spacecraft) so.spacecraft.launched = n > 9;
        st.reunited = false; st.reunionTimer = 0;
        if (state === 'dead' || state === 'won') this.revive();
        game.missionIndex = n - 1;
        setupMissionWorld(game.missionIndex);
        // reapply progress flags after setup resets
        st.commsatParts = n > 1 ? 3 : 0; st.commsatFixed = n > 1; st.crashContact = n > 1;
        st.resourcesCollected = n > 2 ? 3 : 0; st.waterSecured = n > 2;
        st.commsRepaired = n > 1; st.craterReached = n > 4; st.lifeSupportStabilised = n > 5;
        st.dungeonExplored = n > 6; st.dungeonLooted = n > 6; st.repairPlanStarted = n > 7;
        st.spacecraftParts = n > 8 ? 3 : 0; st.spacecraftRepaired = n > 8; st.launched = n > 9;
        if (so.waterSource) so.waterSource.secured = n > 2;
        if (so.commsUnit) so.commsUnit.repaired = n > 1;
        if (so.lifeSupport) so.lifeSupport.repaired = n > 5;
        if (so.spacecraft) { so.spacecraft.repaired = n > 8; so.spacecraft.launched = n > 9; }
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
        } else if (state === 'briefing') {
          // keep briefing but ensure alive
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
        // jump to final mission and mark previous progress complete
        return this.skipTo(MISSIONS.length);
      },
      collectAll() {
        if (!game.player) return 'No active game';
        for (const it of (game.items || [])) it.taken = true;
        for (const d of (game.dungeons || [])) for (const it of d.items) it.taken = true;
        for (const l of (game.logs || [])) { if (!l.taken) { l.taken = true; game.stats.logs++; } }
        const st = game.story || (game.story = {});
        st.resourcesCollected = 3;
        st.spacecraftParts = 3;
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
        const st = game.story || (game.story = {});
        const so = game.storyObjects || {};
        st.commsatParts = 3; st.commsatFixed = true; st.crashContact = true; st.resourcesCollected = 3; st.waterSecured = true;
        st.commsRepaired = true; st.craterReached = true; st.lifeSupportStabilised = true;
        st.dungeonExplored = true; st.dungeonLooted = true; game._dungeonVisited = true;
        st.repairPlanStarted = true; st.spacecraftParts = 3; st.spacecraftRepaired = true;
        st.launched = true; st.reunited = true;
        if (so.waterSource) so.waterSource.secured = true;
        if (so.commsUnit) so.commsUnit.repaired = true;
        if (so.lifeSupport) so.lifeSupport.repaired = true;
        if (so.spacecraft) { so.spacecraft.repaired = true; so.spacecraft.launched = true; }
        game.missionIndex = MISSIONS.length - 1;
        game.missionPhase = 'after';
        hideMissionPanel();
        endGame('won', 'A HERO RETURNS', 'Pico survives Mars, repairs the spacecraft, escapes, and reunites with Captain Vijay and the crew.');
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
