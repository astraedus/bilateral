/* ============================================
   Bilateral — EMDR Bilateral Stimulation
   ============================================
   Design from the science:
   - Bilateral stimulation works via working memory taxation
   - The dot MUST be the sole attentional demand
   - Sine-wave easing at edges (pendulum, not mechanical)
   - Rest periods are where processing happens
   - Breathing guide during rest aids parasympathetic shift
   ============================================ */

(function () {
  'use strict';

  // ---- State ----
  const S = {
    running: false,
    paused: false,
    visual: true,
    audio: false,
    haptic: false,
    speed: 1.0,
    setDuration: 30,
    restDuration: 10,
    numSets: 6,
    autoAdvance: true,
    currentSet: 0,
    timeLeft: 30,
    resting: false,
    toneType: 'sine',
    freq: 440,
    vol: 0.5,
    dotSize: 22,
    dotColor: '#F5A623',
    // internal
    phase: 0, // 0..2π for sine wave position
    lastTs: 0,
    raf: null,
    timer: null,
    // audio
    ctx: null,
    osc: null,
    pan: null,
    gain: null,
    noise: null,
    noiseGain: null,
    // touch
    touchTimer: null,
    firstVisit: true,
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ---- DOM ----
  const el = {
    canvas: $('#canvas'),
    dot: $('#dot'),
    restScreen: $('#rest-screen'),
    completeScreen: $('#complete-screen'),
    completeMsg: $('#complete-msg'),
    intro: $('#intro'),
    startBtn: $('#start-btn'),
    pauseBtn: $('#pause-btn'),
    stopBtn: $('#stop-btn'),
    restartBtn: $('#restart-btn'),
    introDismiss: $('#intro-dismiss'),
    setBar: $('#set-bar'),
    setDots: $('#set-dots'),
    timerEl: $('#timer'),
    speedSlider: $('#speed-slider'),
    speedVal: $('#speed-val'),
    settingsToggle: $('#settings-toggle'),
    infoToggle: $('#info-toggle'),
    settingsDrawer: $('#settings-drawer'),
    infoDrawer: $('#info-drawer'),
    drawerClose: $('#drawer-close'),
    infoClose: $('#info-close'),
    // settings
    setDur: $('#set-dur'), setDurV: $('#set-dur-v'),
    restDur: $('#rest-dur'), restDurV: $('#rest-dur-v'),
    numSets: $('#num-sets'), numSetsV: $('#num-sets-v'),
    autoAdv: $('#auto-adv'),
    freq: $('#freq'), freqV: $('#freq-v'),
    vol: $('#vol'), volV: $('#vol-v'),
    dotSizeEl: $('#dot-size'), dotSizeV: $('#dot-size-v'),
    freqRow: $('#freq-row'),
  };

  // ---- Persistence ----
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem('bilateral') || '{}');
      Object.assign(S, {
        speed: d.speed ?? 1.0,
        visual: d.visual ?? true,
        audio: d.audio ?? false,
        haptic: d.haptic ?? false,
        setDuration: d.setDuration ?? 30,
        restDuration: d.restDuration ?? 10,
        numSets: d.numSets ?? 6,
        autoAdvance: d.autoAdvance ?? true,
        toneType: d.toneType ?? 'sine',
        freq: d.freq ?? 440,
        vol: d.vol ?? 0.5,
        dotSize: d.dotSize ?? 22,
        dotColor: d.dotColor ?? '#F5A623',
        firstVisit: d.firstVisit ?? true,
      });
    } catch (e) { /* */ }
  }

  function save() {
    try {
      localStorage.setItem('bilateral', JSON.stringify({
        speed: S.speed, visual: S.visual, audio: S.audio, haptic: S.haptic,
        setDuration: S.setDuration, restDuration: S.restDuration, numSets: S.numSets,
        autoAdvance: S.autoAdvance, toneType: S.toneType, freq: S.freq, vol: S.vol,
        dotSize: S.dotSize, dotColor: S.dotColor, firstVisit: false,
      }));
    } catch (e) { /* */ }
  }

  // ---- Sync UI ----
  function sync() {
    el.speedSlider.value = S.speed;
    el.speedVal.textContent = S.speed.toFixed(1);
    el.setDur.value = S.setDuration;
    el.setDurV.textContent = S.setDuration + 's';
    el.restDur.value = S.restDuration;
    el.restDurV.textContent = S.restDuration + 's';
    el.numSets.value = S.numSets;
    el.numSetsV.textContent = S.numSets;
    el.autoAdv.checked = S.autoAdvance;
    el.freq.value = S.freq;
    el.freqV.textContent = S.freq + ' Hz';
    el.vol.value = S.vol * 100;
    el.volV.textContent = Math.round(S.vol * 100) + '%';
    el.dotSizeEl.value = S.dotSize;
    el.dotSizeV.textContent = S.dotSize + 'px';

    document.documentElement.style.setProperty('--dot-size', S.dotSize + 'px');
    document.documentElement.style.setProperty('--dot-color', S.dotColor);

    $$('.mode-pill').forEach(b => b.classList.toggle('active', S[b.dataset.mode]));
    $$('[data-tone]').forEach(c => c.classList.toggle('active', c.dataset.tone === S.toneType));
    $$('.swatch').forEach(s => s.classList.toggle('active', s.dataset.c === S.dotColor));

    el.freqRow.style.display = S.toneType === 'sine' ? '' : 'none';
  }

  // ---- Visual Engine ----
  // Sine-wave motion: position = sin(phase)
  // This gives natural deceleration at the edges, like a pendulum.
  // More calming than linear, and closer to clinical light bars.

  function animate(ts) {
    if (!S.running) return;
    if (!S.lastTs) S.lastTs = ts;
    const dt = (ts - S.lastTs) / 1000;
    S.lastTs = ts;

    if (!S.paused && !S.resting) {
      // phase advances: speed Hz = speed full cycles/sec
      // full cycle = 2π, so dPhase = 2π * speed * dt
      S.phase += 2 * Math.PI * S.speed * dt;

      // position: 0..1 from sine
      const pos = 0.5 + 0.5 * Math.sin(S.phase);

      // trigger bilateral at extremes
      const sinVal = Math.sin(S.phase);
      const prevSin = Math.sin(S.phase - 2 * Math.PI * S.speed * dt);
      if (prevSin < 0 && sinVal >= 0) bilateral('left');
      if (prevSin > 0 && sinVal <= 0) bilateral('right');

      // Update dot position
      if (S.visual) {
        const pad = 40; // px padding from edges
        const w = el.canvas.clientWidth - pad * 2;
        el.dot.style.left = (pad + pos * w) + 'px';
        el.dot.style.display = '';
      } else {
        el.dot.style.display = 'none';
      }
    }

    S.raf = requestAnimationFrame(animate);
  }

  function bilateral(side) {
    // Audio panning
    if (S.audio && S.pan && S.toneType !== 'click') {
      S.pan.pan.setTargetAtTime(side === 'left' ? -1 : 1, S.ctx.currentTime, 0.015);
    }
    // Click sound
    if (S.audio && S.toneType === 'click' && S.ctx) {
      const o = S.ctx.createOscillator();
      const g = S.ctx.createGain();
      const p = S.ctx.createStereoPanner();
      o.type = 'sine';
      o.frequency.value = 700;
      g.gain.setValueAtTime(S.vol * 0.25, S.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, S.ctx.currentTime + 0.06);
      p.pan.value = side === 'left' ? -1 : 1;
      o.connect(g).connect(p).connect(S.ctx.destination);
      o.start();
      o.stop(S.ctx.currentTime + 0.06);
    }
    // Haptic
    if (S.haptic && navigator.vibrate) {
      navigator.vibrate(40);
    }
  }

  // ---- Audio Engine ----
  function audioStart() {
    if (S.ctx) return;
    S.ctx = new (window.AudioContext || window.webkitAudioContext)();
    S.gain = S.ctx.createGain();
    S.pan = S.ctx.createStereoPanner();
    S.gain.gain.value = S.vol;
    S.gain.connect(S.pan).connect(S.ctx.destination);
    toneStart();
  }

  function toneStart() {
    if (!S.ctx) return;
    toneStop();
    if (S.toneType === 'sine') {
      S.osc = S.ctx.createOscillator();
      S.osc.type = 'sine';
      S.osc.frequency.value = S.freq;
      S.osc.connect(S.gain);
      S.osc.start();
    } else if (S.toneType === 'nature') {
      // Brown noise (rain-like)
      const len = 2 * S.ctx.sampleRate;
      const buf = S.ctx.createBuffer(2, len, S.ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let last = 0;
        for (let i = 0; i < len; i++) {
          d[i] = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
          last = d[i];
          d[i] *= 3.5;
        }
      }
      S.noise = S.ctx.createBufferSource();
      S.noise.buffer = buf;
      S.noise.loop = true;
      const filt = S.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 700;
      S.noiseGain = S.ctx.createGain();
      S.noiseGain.gain.value = S.vol * 0.4;
      S.noise.connect(filt).connect(S.noiseGain).connect(S.pan);
      S.noise.start();
    }
    // 'click' mode handled in bilateral()
  }

  function toneStop() {
    try { S.osc?.stop(); } catch (_) {}
    try { S.noise?.stop(); } catch (_) {}
    S.osc = null;
    S.noise = null;
    S.noiseGain = null;
  }

  function audioStop() {
    toneStop();
    S.ctx?.close();
    S.ctx = null;
    S.pan = null;
    S.gain = null;
  }

  // ---- Rest chime ----
  function chime() {
    if (!S.ctx) return;
    const o1 = S.ctx.createOscillator();
    const o2 = S.ctx.createOscillator();
    const g = S.ctx.createGain();
    o1.type = o2.type = 'sine';
    o1.frequency.value = 523;
    o2.frequency.value = 659;
    g.gain.setValueAtTime(0.12, S.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, S.ctx.currentTime + 1.2);
    o1.connect(g);
    o2.connect(g);
    g.connect(S.ctx.destination);
    o1.start(); o2.start();
    o1.stop(S.ctx.currentTime + 1.2);
    o2.stop(S.ctx.currentTime + 1.2);
  }

  // ---- Set Timer ----
  function renderDots() {
    el.setDots.innerHTML = '';
    for (let i = 0; i < S.numSets; i++) {
      const d = document.createElement('div');
      d.className = 'sdot';
      if (i < S.currentSet) d.classList.add('done');
      if (i === S.currentSet && S.running) d.classList.add('now');
      el.setDots.appendChild(d);
    }
  }

  function fmtTime(s) {
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function tickTimer() {
    if (S.paused) return;

    S.timeLeft--;
    el.timerEl.textContent = fmtTime(Math.max(0, S.timeLeft));

    if (S.timeLeft <= 0) {
      if (S.resting) {
        endRest();
      } else {
        endSet();
      }
    }
  }

  function startTimer() {
    clearInterval(S.timer);
    S.timeLeft = S.setDuration;
    el.timerEl.textContent = fmtTime(S.timeLeft);
    S.timer = setInterval(tickTimer, 1000);
  }

  function endSet() {
    S.currentSet++;
    renderDots();

    if (S.currentSet >= S.numSets) {
      sessionComplete();
      return;
    }

    // Enter rest
    S.resting = true;
    S.timeLeft = S.restDuration;
    el.timerEl.textContent = fmtTime(S.timeLeft);
    el.restScreen.classList.remove('hidden');
    el.dot.style.display = 'none';

    // Mute audio during rest
    if (S.gain) S.gain.gain.setTargetAtTime(0, S.ctx.currentTime, 0.1);
    if (S.noiseGain) S.noiseGain.gain.setTargetAtTime(0, S.ctx.currentTime, 0.1);

    if (S.audio) chime();
  }

  function endRest() {
    S.resting = false;
    el.restScreen.classList.add('hidden');
    el.dot.style.display = '';

    if (S.autoAdvance) {
      S.timeLeft = S.setDuration;
      el.timerEl.textContent = fmtTime(S.timeLeft);
      renderDots();
      // Unmute
      if (S.gain) S.gain.gain.setTargetAtTime(S.vol, S.ctx.currentTime, 0.1);
      if (S.noiseGain) S.noiseGain.gain.setTargetAtTime(S.vol * 0.4, S.ctx.currentTime, 0.1);
    } else {
      pause();
    }
  }

  function sessionComplete() {
    stop();
    el.completeMsg.textContent = S.numSets + ' sets. Notice how you feel.';
    el.completeScreen.classList.remove('hidden');
  }

  // ---- Session Control ----
  function start() {
    // Resume from pause
    if (S.running && S.paused) {
      S.paused = false;
      el.startBtn.classList.add('hidden');
      el.pauseBtn.classList.remove('hidden');
      if (S.gain) S.gain.gain.setTargetAtTime(S.vol, S.ctx.currentTime, 0.1);
      return;
    }

    S.running = true;
    S.paused = false;
    S.currentSet = 0;
    S.phase = -Math.PI / 2; // start at left edge (sin = -1)
    S.lastTs = 0;
    S.resting = false;

    el.startBtn.classList.add('hidden');
    el.pauseBtn.classList.remove('hidden');
    el.stopBtn.classList.remove('hidden');
    el.setBar.classList.remove('hidden');
    el.completeScreen.classList.add('hidden');
    el.dot.classList.remove('idle');

    document.body.classList.add('immersed');

    renderDots();
    startTimer();
    S.raf = requestAnimationFrame(animate);

    if (S.audio) audioStart();
  }

  function pause() {
    S.paused = true;
    el.pauseBtn.classList.add('hidden');
    el.startBtn.classList.remove('hidden');
    if (S.gain) S.gain.gain.setTargetAtTime(0, S.ctx.currentTime, 0.1);
  }

  function stop() {
    S.running = false;
    S.paused = false;
    S.resting = false;
    clearInterval(S.timer);
    if (S.raf) cancelAnimationFrame(S.raf);

    document.body.classList.remove('immersed');
    el.startBtn.classList.remove('hidden');
    el.pauseBtn.classList.add('hidden');
    el.stopBtn.classList.add('hidden');
    el.setBar.classList.add('hidden');
    el.restScreen.classList.add('hidden');
    el.dot.classList.add('idle');

    // Reset dot to center
    el.dot.style.left = '50%';
    el.dot.style.display = '';

    audioStop();
  }

  // ---- Drawers ----
  function openDrawer(drawer) {
    // Close any open drawer first
    $$('.drawer').forEach(d => d.classList.add('hidden'));
    drawer.classList.remove('hidden');
  }

  function closeDrawers() {
    $$('.drawer').forEach(d => d.classList.add('hidden'));
    el.settingsToggle.classList.remove('open');
    el.infoToggle.classList.remove('open');
  }

  // ---- Touch reveal (mobile: tap to show controls while immersed) ----
  function setupTouchReveal() {
    el.canvas.addEventListener('pointerdown', () => {
      if (!document.body.classList.contains('immersed')) return;
      document.body.classList.add('touch-reveal');
      clearTimeout(S.touchTimer);
      S.touchTimer = setTimeout(() => {
        document.body.classList.remove('touch-reveal');
      }, 3000);
    });
  }

  // ---- Events ----
  function bind() {
    el.startBtn.addEventListener('click', start);
    el.pauseBtn.addEventListener('click', pause);
    el.stopBtn.addEventListener('click', stop);
    el.restartBtn.addEventListener('click', () => {
      el.completeScreen.classList.add('hidden');
      start();
    });

    // Intro dismiss
    el.introDismiss.addEventListener('click', () => {
      el.intro.classList.add('hidden');
      S.firstVisit = false;
      save();
    });

    // Mode pills
    $$('.mode-pill').forEach(b => {
      b.addEventListener('click', () => {
        const m = b.dataset.mode;
        S[m] = !S[m];
        if (!S.visual && !S.audio && !S.haptic) S[m] = true;
        sync();
        save();
        if (S.running) {
          if (S.audio && !S.ctx) audioStart();
          if (!S.audio) audioStop();
        }
      });
    });

    // Speed
    el.speedSlider.addEventListener('input', () => {
      S.speed = parseFloat(el.speedSlider.value);
      el.speedVal.textContent = S.speed.toFixed(1);
      save();
    });

    // Settings drawer
    el.settingsToggle.addEventListener('click', () => {
      const isOpen = !el.settingsDrawer.classList.contains('hidden');
      closeDrawers();
      if (!isOpen) {
        openDrawer(el.settingsDrawer);
        el.settingsToggle.classList.add('open');
      }
    });

    el.infoToggle.addEventListener('click', () => {
      const isOpen = !el.infoDrawer.classList.contains('hidden');
      closeDrawers();
      if (!isOpen) {
        openDrawer(el.infoDrawer);
        el.infoToggle.classList.add('open');
      }
    });

    el.drawerClose.addEventListener('click', closeDrawers);
    el.infoClose.addEventListener('click', closeDrawers);

    // Close drawer on outside click
    el.canvas.addEventListener('click', (e) => {
      if (e.target === el.canvas) closeDrawers();
    });

    // Settings sliders
    el.setDur.addEventListener('input', () => {
      S.setDuration = +el.setDur.value;
      el.setDurV.textContent = S.setDuration + 's';
      save();
    });
    el.restDur.addEventListener('input', () => {
      S.restDuration = +el.restDur.value;
      el.restDurV.textContent = S.restDuration + 's';
      save();
    });
    el.numSets.addEventListener('input', () => {
      S.numSets = +el.numSets.value;
      el.numSetsV.textContent = S.numSets;
      save();
    });
    el.autoAdv.addEventListener('change', () => {
      S.autoAdvance = el.autoAdv.checked;
      save();
    });

    // Audio
    el.freq.addEventListener('input', () => {
      S.freq = +el.freq.value;
      el.freqV.textContent = S.freq + ' Hz';
      if (S.osc) S.osc.frequency.setTargetAtTime(S.freq, S.ctx.currentTime, 0.02);
      save();
    });
    el.vol.addEventListener('input', () => {
      S.vol = +el.vol.value / 100;
      el.volV.textContent = Math.round(S.vol * 100) + '%';
      if (S.gain && !S.paused && !S.resting) S.gain.gain.setTargetAtTime(S.vol, S.ctx.currentTime, 0.02);
      if (S.noiseGain && !S.paused && !S.resting) S.noiseGain.gain.setTargetAtTime(S.vol * 0.4, S.ctx.currentTime, 0.02);
      save();
    });

    // Tone chips
    $$('[data-tone]').forEach(c => {
      c.addEventListener('click', () => {
        S.toneType = c.dataset.tone;
        sync();
        if (S.running && S.audio) { toneStop(); toneStart(); }
        save();
      });
    });

    // Visual
    el.dotSizeEl.addEventListener('input', () => {
      S.dotSize = +el.dotSizeEl.value;
      el.dotSizeV.textContent = S.dotSize + 'px';
      document.documentElement.style.setProperty('--dot-size', S.dotSize + 'px');
      save();
    });

    // Color swatches
    $$('.swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        S.dotColor = sw.dataset.c;
        document.documentElement.style.setProperty('--dot-color', S.dotColor);
        $$('.swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        save();
      });
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!S.running || S.paused) start();
        else pause();
      }
      if (e.key === 'Escape') {
        if (S.running) stop();
        closeDrawers();
      }
    });

    setupTouchReveal();
  }

  // ---- Init ----
  function init() {
    load();
    sync();
    bind();

    // Dot starts centered, breathing
    el.dot.style.left = '50%';
    el.dot.classList.add('idle');

    // Show intro on first visit
    if (S.firstVisit) {
      el.intro.classList.remove('hidden');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
