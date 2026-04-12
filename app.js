/* ============================================
   Bilateral — EMDR Bilateral Stimulation Tool
   Core application logic
   ============================================ */

(function () {
  'use strict';

  // ---- State ----
  const state = {
    running: false,
    paused: false,

    // Modes (can combine)
    visual: true,
    audio: false,
    haptic: false,

    // Speed
    speed: 1.0, // Hz (cycles per second)

    // Set timer
    setDuration: 30,
    restDuration: 10,
    numSets: 6,
    autoAdvance: true,
    currentSet: 0,
    timeRemaining: 30,
    resting: false,

    // Audio
    toneType: 'sine',
    audioFreq: 440,
    audioVol: 0.5,

    // Visual
    dotSize: 22,
    dotColour: '#F5A623',
    trail: 'none',

    // Animation
    animFrame: null,
    dotPosition: 0, // 0 to 1
    dotDirection: 1, // 1 = right, -1 = left
    lastTimestamp: 0,

    // Timer
    timerInterval: null,

    // Audio context
    audioCtx: null,
    oscillator: null,
    panner: null,
    gainNode: null,
    noiseSource: null,
    noiseGain: null,
  };

  // ---- DOM References ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    stimArea: $('#stimulation-area'),
    track: $('#track'),
    dot: $('#dot'),
    restOverlay: $('#rest-overlay'),
    setProgress: $('#set-progress'),
    setDots: $('#set-dots'),
    timerDisplay: $('#timer-display'),
    startBtn: $('#start-btn'),
    pauseBtn: $('#pause-btn'),
    stopBtn: $('#stop-btn'),
    fullscreenBtn: $('#fullscreen-btn'),
    speedSlider: $('#speed-slider'),
    speedValue: $('#speed-value'),
    setDurationSlider: $('#set-duration'),
    setDurationVal: $('#set-duration-val'),
    restDurationSlider: $('#rest-duration'),
    restDurationVal: $('#rest-duration-val'),
    numSetsSlider: $('#num-sets'),
    numSetsVal: $('#num-sets-val'),
    autoAdvance: $('#auto-advance'),
    audioFreqSlider: $('#audio-freq'),
    audioFreqVal: $('#audio-freq-val'),
    audioVolSlider: $('#audio-vol'),
    audioVolVal: $('#audio-vol-val'),
    dotSizeSlider: $('#dot-size'),
    dotSizeVal: $('#dot-size-val'),
  };

  // ---- Load settings from localStorage ----
  function loadSettings() {
    try {
      const saved = localStorage.getItem('bilateral-settings');
      if (saved) {
        const s = JSON.parse(saved);
        Object.assign(state, {
          speed: s.speed ?? 1.0,
          visual: s.visual ?? true,
          audio: s.audio ?? false,
          haptic: s.haptic ?? false,
          setDuration: s.setDuration ?? 30,
          restDuration: s.restDuration ?? 10,
          numSets: s.numSets ?? 6,
          autoAdvance: s.autoAdvance ?? true,
          toneType: s.toneType ?? 'sine',
          audioFreq: s.audioFreq ?? 440,
          audioVol: s.audioVol ?? 0.5,
          dotSize: s.dotSize ?? 22,
          dotColour: s.dotColour ?? '#F5A623',
          trail: s.trail ?? 'none',
        });
      }
    } catch (e) { /* ignore */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem('bilateral-settings', JSON.stringify({
        speed: state.speed,
        visual: state.visual,
        audio: state.audio,
        haptic: state.haptic,
        setDuration: state.setDuration,
        restDuration: state.restDuration,
        numSets: state.numSets,
        autoAdvance: state.autoAdvance,
        toneType: state.toneType,
        audioFreq: state.audioFreq,
        audioVol: state.audioVol,
        dotSize: state.dotSize,
        dotColour: state.dotColour,
        trail: state.trail,
      }));
    } catch (e) { /* ignore */ }
  }

  // ---- Sync UI from state ----
  function syncUI() {
    // Speed
    dom.speedSlider.value = state.speed;
    dom.speedValue.textContent = state.speed.toFixed(1) + ' Hz';

    // Set timer
    dom.setDurationSlider.value = state.setDuration;
    dom.setDurationVal.textContent = state.setDuration + 's';
    dom.restDurationSlider.value = state.restDuration;
    dom.restDurationVal.textContent = state.restDuration + 's';
    dom.numSetsSlider.value = state.numSets;
    dom.numSetsVal.textContent = state.numSets;
    dom.autoAdvance.checked = state.autoAdvance;

    // Audio
    dom.audioFreqSlider.value = state.audioFreq;
    dom.audioFreqVal.textContent = state.audioFreq + ' Hz';
    dom.audioVolSlider.value = state.audioVol * 100;
    dom.audioVolVal.textContent = Math.round(state.audioVol * 100) + '%';

    // Visual
    dom.dotSizeSlider.value = state.dotSize;
    dom.dotSizeVal.textContent = state.dotSize + 'px';
    document.documentElement.style.setProperty('--dot-size', state.dotSize + 'px');
    document.documentElement.style.setProperty('--dot-colour', state.dotColour);

    // Mode buttons
    $$('.mode-btn').forEach((btn) => {
      const mode = btn.dataset.mode;
      btn.classList.toggle('active', state[mode]);
    });

    // Tone chips
    $$('[data-tone]').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.tone === state.toneType);
    });

    // Trail chips
    $$('[data-trail]').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.trail === state.trail);
    });

    // Colour swatches
    $$('.colour-swatch').forEach((sw) => {
      sw.classList.toggle('active', sw.dataset.colour === state.dotColour);
    });

    // Freq row visibility (only for sine tone)
    const freqRow = $('#freq-row');
    if (freqRow) {
      freqRow.style.display = state.toneType === 'sine' ? '' : 'none';
    }

    // Dot trail class
    dom.dot.className = '';
    if (state.trail !== 'none') {
      dom.dot.classList.add('trail-' + state.trail);
    }
  }

  // ---- Mode toggling ----
  function initModes() {
    $$('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        state[mode] = !state[mode];

        // Ensure at least one mode is active
        if (!state.visual && !state.audio && !state.haptic) {
          state[mode] = true;
        }

        btn.classList.toggle('active', state[mode]);
        syncUI();
        saveSettings();

        // If running, update engines
        if (state.running) {
          if (state.audio && !state.audioCtx) initAudio();
          if (!state.audio) stopAudio();
        }
      });
    });
  }

  // ---- Visual Engine ----
  function animateDot(timestamp) {
    if (!state.running || state.paused || state.resting) {
      state.animFrame = requestAnimationFrame(animateDot);
      return;
    }

    if (!state.lastTimestamp) state.lastTimestamp = timestamp;
    const delta = (timestamp - state.lastTimestamp) / 1000;
    state.lastTimestamp = timestamp;

    // Move dot: full cycle = 1/speed seconds
    // One cycle = left to right to left
    const cycleSpeed = state.speed * 2; // factor of 2 because 1 Hz = 1 full L-R-L
    state.dotPosition += delta * cycleSpeed * state.dotDirection;

    if (state.dotPosition >= 1) {
      state.dotPosition = 1;
      state.dotDirection = -1;
      triggerBilateral('right');
    } else if (state.dotPosition <= 0) {
      state.dotPosition = 0;
      state.dotDirection = 1;
      triggerBilateral('left');
    }

    // Update visual position
    if (state.visual) {
      dom.dot.style.left = (state.dotPosition * 100) + '%';

      // Trail direction class
      if (state.trail !== 'none') {
        dom.dot.classList.toggle('moving-left', state.dotDirection === -1);
      }
    }

    state.animFrame = requestAnimationFrame(animateDot);
  }

  function triggerBilateral(side) {
    // Audio panning
    if (state.audio && state.panner) {
      state.panner.pan.setTargetAtTime(side === 'left' ? -1 : 1, state.audioCtx.currentTime, 0.02);
    }

    // Haptic
    if (state.haptic && navigator.vibrate) {
      navigator.vibrate(50);
    }
  }

  // ---- Audio Engine ----
  function initAudio() {
    if (state.audioCtx) return;

    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    state.gainNode = state.audioCtx.createGain();
    state.panner = state.audioCtx.createStereoPanner();

    state.gainNode.gain.value = state.audioVol;
    state.gainNode.connect(state.panner);
    state.panner.connect(state.audioCtx.destination);

    startTone();
  }

  function startTone() {
    if (!state.audioCtx) return;
    stopTone();

    if (state.toneType === 'sine') {
      state.oscillator = state.audioCtx.createOscillator();
      state.oscillator.type = 'sine';
      state.oscillator.frequency.value = state.audioFreq;
      state.oscillator.connect(state.gainNode);
      state.oscillator.start();
    } else if (state.toneType === 'click') {
      // Click: short burst oscillator on each side change
      // We'll generate clicks in triggerBilateral instead
      startClickEngine();
    } else if (state.toneType === 'nature') {
      startNatureEngine();
    }
  }

  function startClickEngine() {
    // Click mode uses a softer approach: filtered noise bursts
    // We override triggerBilateral to add click sounds
    state._originalTrigger = triggerBilateral;
  }

  function startNatureEngine() {
    // Gentle brown noise for rain-like ambience
    if (!state.audioCtx) return;

    const bufferSize = 2 * state.audioCtx.sampleRate;
    const buffer = state.audioCtx.createBuffer(2, bufferSize, state.audioCtx.sampleRate);

    // Generate brownian noise for both channels
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (last + 0.02 * white) / 1.02;
        last = data[i];
        data[i] *= 3.5;
      }
    }

    state.noiseSource = state.audioCtx.createBufferSource();
    state.noiseSource.buffer = buffer;
    state.noiseSource.loop = true;

    // Filter to make it rain-like
    const filter = state.audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;

    state.noiseGain = state.audioCtx.createGain();
    state.noiseGain.gain.value = state.audioVol * 0.5;

    state.noiseSource.connect(filter);
    filter.connect(state.noiseGain);
    state.noiseGain.connect(state.panner);

    state.noiseSource.start();
  }

  function stopTone() {
    if (state.oscillator) {
      try { state.oscillator.stop(); } catch (e) { /* */ }
      state.oscillator = null;
    }
    if (state.noiseSource) {
      try { state.noiseSource.stop(); } catch (e) { /* */ }
      state.noiseSource = null;
      state.noiseGain = null;
    }
  }

  function stopAudio() {
    stopTone();
    if (state.audioCtx) {
      state.audioCtx.close();
      state.audioCtx = null;
      state.panner = null;
      state.gainNode = null;
    }
  }

  // Enhanced triggerBilateral for click mode
  const _baseTriggerBilateral = triggerBilateral;

  function playClick(side) {
    if (!state.audioCtx || state.toneType !== 'click') return;

    const osc = state.audioCtx.createOscillator();
    const env = state.audioCtx.createGain();
    const clickPanner = state.audioCtx.createStereoPanner();

    osc.type = 'sine';
    osc.frequency.value = 800;

    env.gain.setValueAtTime(state.audioVol * 0.3, state.audioCtx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, state.audioCtx.currentTime + 0.08);

    clickPanner.pan.value = side === 'left' ? -1 : 1;

    osc.connect(env);
    env.connect(clickPanner);
    clickPanner.connect(state.audioCtx.destination);

    osc.start();
    osc.stop(state.audioCtx.currentTime + 0.08);
  }

  // Monkey-patch triggerBilateral to include click sounds
  // We redefine it with both visual + click support
  function triggerBilateralFull(side) {
    // Audio panning (for sine & nature)
    if (state.audio && state.panner && state.toneType !== 'click') {
      state.panner.pan.setTargetAtTime(side === 'left' ? -1 : 1, state.audioCtx.currentTime, 0.02);
    }

    // Click sound
    if (state.audio && state.toneType === 'click') {
      playClick(side);
    }

    // Haptic
    if (state.haptic && navigator.vibrate) {
      navigator.vibrate(50);
    }
  }

  // Override
  function triggerBilateral(side) {
    triggerBilateralFull(side);
  }

  // ---- Rest Chime ----
  function playChime() {
    if (!state.audioCtx) return;

    const osc1 = state.audioCtx.createOscillator();
    const osc2 = state.audioCtx.createOscillator();
    const env = state.audioCtx.createGain();

    osc1.type = 'sine';
    osc1.frequency.value = 523; // C5
    osc2.type = 'sine';
    osc2.frequency.value = 659; // E5

    env.gain.setValueAtTime(0.15, state.audioCtx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, state.audioCtx.currentTime + 1.5);

    osc1.connect(env);
    osc2.connect(env);
    env.connect(state.audioCtx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(state.audioCtx.currentTime + 1.5);
    osc2.stop(state.audioCtx.currentTime + 1.5);
  }

  // ---- Set Timer ----
  function updateTimerDisplay() {
    const mins = Math.floor(state.timeRemaining / 60);
    const secs = state.timeRemaining % 60;
    dom.timerDisplay.textContent = mins + ':' + String(secs).padStart(2, '0');
  }

  function renderSetDots() {
    dom.setDots.innerHTML = '';
    for (let i = 0; i < state.numSets; i++) {
      const dot = document.createElement('div');
      dot.className = 'set-dot';
      if (i < state.currentSet) dot.classList.add('completed');
      if (i === state.currentSet && state.running) dot.classList.add('active');
      dom.setDots.appendChild(dot);
    }
  }

  function startTimer() {
    clearInterval(state.timerInterval);
    state.timeRemaining = state.setDuration;
    updateTimerDisplay();

    state.timerInterval = setInterval(() => {
      if (state.paused) return;

      if (state.resting) {
        state.timeRemaining--;
        updateTimerDisplay();
        if (state.timeRemaining <= 0) {
          endRest();
        }
        return;
      }

      state.timeRemaining--;
      updateTimerDisplay();

      if (state.timeRemaining <= 0) {
        endSet();
      }
    }, 1000);
  }

  function endSet() {
    state.currentSet++;
    renderSetDots();

    if (state.currentSet >= state.numSets) {
      completeSession();
      return;
    }

    // Begin rest
    state.resting = true;
    state.timeRemaining = state.restDuration;
    updateTimerDisplay();
    dom.restOverlay.classList.remove('hidden');

    // Pause engines during rest
    if (state.audio) {
      if (state.gainNode) state.gainNode.gain.setTargetAtTime(0, state.audioCtx.currentTime, 0.1);
      if (state.noiseGain) state.noiseGain.gain.setTargetAtTime(0, state.audioCtx.currentTime, 0.1);
    }

    playChime();
  }

  function endRest() {
    state.resting = false;
    dom.restOverlay.classList.add('hidden');

    if (state.autoAdvance) {
      state.timeRemaining = state.setDuration;
      updateTimerDisplay();
      renderSetDots();

      // Resume audio
      if (state.audio && state.gainNode) {
        state.gainNode.gain.setTargetAtTime(state.audioVol, state.audioCtx.currentTime, 0.1);
      }
      if (state.audio && state.noiseGain) {
        state.noiseGain.gain.setTargetAtTime(state.audioVol * 0.5, state.audioCtx.currentTime, 0.1);
      }
    } else {
      // Wait for user to manually advance
      state.paused = true;
      dom.pauseBtn.classList.add('hidden');
      dom.startBtn.classList.remove('hidden');
      dom.startBtn.querySelector('span').textContent = 'Next Set';
    }
  }

  function completeSession() {
    stopSession();

    // Show completion message
    let complete = document.getElementById('session-complete');
    if (!complete) {
      complete = document.createElement('div');
      complete.id = 'session-complete';
      dom.stimArea.parentNode.insertBefore(complete, dom.stimArea.nextSibling);
    }
    complete.innerHTML = '<h2>Session complete</h2><p>You did ' + state.numSets + ' sets. Notice how you feel.</p>';
    complete.className = 'visible';

    setTimeout(() => {
      complete.className = '';
    }, 8000);
  }

  // ---- Session Control ----
  function startSession() {
    if (state.running && state.paused) {
      // Resume
      state.paused = false;
      dom.startBtn.classList.add('hidden');
      dom.pauseBtn.classList.remove('hidden');

      if (state.audio && state.gainNode) {
        state.gainNode.gain.setTargetAtTime(state.audioVol, state.audioCtx.currentTime, 0.1);
      }
      return;
    }

    state.running = true;
    state.paused = false;
    state.currentSet = 0;
    state.dotPosition = 0;
    state.dotDirection = 1;
    state.lastTimestamp = 0;
    state.resting = false;

    document.body.classList.add('running');
    dom.stimArea.classList.add('active');
    dom.startBtn.classList.add('hidden');
    dom.pauseBtn.classList.remove('hidden');
    dom.stopBtn.classList.remove('hidden');
    dom.setProgress.classList.remove('hidden');

    // Hide session complete if visible
    const complete = document.getElementById('session-complete');
    if (complete) complete.className = '';

    renderSetDots();
    startTimer();

    // Start visual animation
    state.animFrame = requestAnimationFrame(animateDot);

    // Start audio if needed
    if (state.audio) {
      initAudio();
    }
  }

  function pauseSession() {
    state.paused = true;
    dom.pauseBtn.classList.add('hidden');
    dom.startBtn.classList.remove('hidden');
    dom.startBtn.querySelector('span').textContent = 'Resume';

    if (state.audio && state.gainNode) {
      state.gainNode.gain.setTargetAtTime(0, state.audioCtx.currentTime, 0.1);
    }
  }

  function stopSession() {
    state.running = false;
    state.paused = false;
    state.resting = false;
    state.dotPosition = 0;

    clearInterval(state.timerInterval);
    if (state.animFrame) cancelAnimationFrame(state.animFrame);

    document.body.classList.remove('running');
    dom.stimArea.classList.remove('active');
    dom.restOverlay.classList.add('hidden');
    dom.startBtn.classList.remove('hidden');
    dom.startBtn.querySelector('span').textContent = 'Start';
    dom.pauseBtn.classList.add('hidden');
    dom.stopBtn.classList.add('hidden');
    dom.setProgress.classList.add('hidden');

    dom.dot.style.left = '0%';

    stopAudio();
  }

  // ---- Event Binding ----
  function initEvents() {
    // Transport
    dom.startBtn.addEventListener('click', startSession);
    dom.pauseBtn.addEventListener('click', pauseSession);
    dom.stopBtn.addEventListener('click', stopSession);

    // Fullscreen
    dom.fullscreenBtn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
        document.body.classList.remove('fullscreen-mode');
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
        document.body.classList.add('fullscreen-mode');
      }
    });

    // Exit fullscreen on tap (when in fullscreen)
    dom.stimArea.addEventListener('click', (e) => {
      if (document.body.classList.contains('fullscreen-mode') && !state.running) {
        document.exitFullscreen().catch(() => {});
        document.body.classList.remove('fullscreen-mode');
      }
    });

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) {
        document.body.classList.remove('fullscreen-mode');
      }
    });

    // Speed slider
    dom.speedSlider.addEventListener('input', () => {
      state.speed = parseFloat(dom.speedSlider.value);
      dom.speedValue.textContent = state.speed.toFixed(1) + ' Hz';
      saveSettings();
    });

    // Set timer sliders
    dom.setDurationSlider.addEventListener('input', () => {
      state.setDuration = parseInt(dom.setDurationSlider.value);
      dom.setDurationVal.textContent = state.setDuration + 's';
      saveSettings();
    });

    dom.restDurationSlider.addEventListener('input', () => {
      state.restDuration = parseInt(dom.restDurationSlider.value);
      dom.restDurationVal.textContent = state.restDuration + 's';
      saveSettings();
    });

    dom.numSetsSlider.addEventListener('input', () => {
      state.numSets = parseInt(dom.numSetsSlider.value);
      dom.numSetsVal.textContent = state.numSets;
      saveSettings();
    });

    dom.autoAdvance.addEventListener('change', () => {
      state.autoAdvance = dom.autoAdvance.checked;
      saveSettings();
    });

    // Audio settings
    dom.audioFreqSlider.addEventListener('input', () => {
      state.audioFreq = parseInt(dom.audioFreqSlider.value);
      dom.audioFreqVal.textContent = state.audioFreq + ' Hz';
      if (state.oscillator) {
        state.oscillator.frequency.setTargetAtTime(state.audioFreq, state.audioCtx.currentTime, 0.02);
      }
      saveSettings();
    });

    dom.audioVolSlider.addEventListener('input', () => {
      state.audioVol = parseInt(dom.audioVolSlider.value) / 100;
      dom.audioVolVal.textContent = Math.round(state.audioVol * 100) + '%';
      if (state.gainNode) {
        state.gainNode.gain.setTargetAtTime(state.audioVol, state.audioCtx.currentTime, 0.02);
      }
      if (state.noiseGain) {
        state.noiseGain.gain.setTargetAtTime(state.audioVol * 0.5, state.audioCtx.currentTime, 0.02);
      }
      saveSettings();
    });

    // Tone type chips
    $$('[data-tone]').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.toneType = chip.dataset.tone;
        $$('[data-tone]').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        syncUI();

        if (state.running && state.audio) {
          stopTone();
          startTone();
        }
        saveSettings();
      });
    });

    // Visual settings
    dom.dotSizeSlider.addEventListener('input', () => {
      state.dotSize = parseInt(dom.dotSizeSlider.value);
      dom.dotSizeVal.textContent = state.dotSize + 'px';
      document.documentElement.style.setProperty('--dot-size', state.dotSize + 'px');
      saveSettings();
    });

    // Colour swatches
    $$('.colour-swatch').forEach((sw) => {
      sw.addEventListener('click', () => {
        state.dotColour = sw.dataset.colour;
        document.documentElement.style.setProperty('--dot-colour', state.dotColour);
        $$('.colour-swatch').forEach((s) => s.classList.remove('active'));
        sw.classList.add('active');
        saveSettings();
      });
    });

    // Trail chips
    $$('[data-trail]').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.trail = chip.dataset.trail;
        $$('[data-trail]').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');

        dom.dot.className = '';
        if (state.trail !== 'none') {
          dom.dot.classList.add('trail-' + state.trail);
        }
        saveSettings();
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!state.running || state.paused) {
          startSession();
        } else {
          pauseSession();
        }
      }
      if (e.key === 'Escape') {
        if (state.running) stopSession();
        if (document.body.classList.contains('fullscreen-mode')) {
          document.exitFullscreen().catch(() => {});
        }
      }
      if (e.key === 'f' || e.key === 'F') {
        dom.fullscreenBtn.click();
      }
    });
  }

  // ---- Init ----
  function init() {
    loadSettings();
    syncUI();
    initModes();
    initEvents();

    // Position dot at start
    dom.dot.style.left = '0%';
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
