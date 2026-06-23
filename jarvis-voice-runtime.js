/**
 * OCTAGON OMNISYSTEM - jarvis-voice-runtime.js
 *
 * JARVIS Voice Runtime V2 - A robust hands-free voice engine with a strict state machine,
 * barge-in (interruption) handling, multi-layered echo/self-loop prevention,
 * and end-of-turn detection.
 */
(function () {
  'use strict';

  const JARVIS_STATES = {
    IDLE: 'idle',
    LISTENING: 'listening',
    USER_SPEAKING: 'user_speaking',
    THINKING: 'thinking',
    STREAMING: 'streaming',
    SPEAKING: 'speaking',
    INTERRUPTED: 'interrupted',
    ERROR: 'error'
  };

  const JARVIS_LANGUAGE_MODE = {
    primaryLocale: 'ar-IQ',
    mixedLanguage: true,
    allowEmbeddedEnglishTerms: true,
    autoSwitchThreshold: 'high_confidence_full_utterance_only'
  };

  // Immediate stop commands to halt assistant TTS
  const STOP_COMMANDS = [
    'توقف', 'وقف', 'اسكت', 'بس', 'كافي',
    'stop', 'cancel', 'shut up', 'quiet'
  ];

  let currentState = JARVIS_STATES.IDLE;
  let recognition = null;
  let activeAudio = null;
  let activeAbortController = null;
  let watchdogInterval = null;

  // Echo and self-listening prevention registers
  let lastAssistantSpeech = '';
  let lastAssistantSpeechTime = 0;
  let lastUserUtterance = '';
  let consecutiveEchosCount = 0;
  let speechMuteGateActive = false;
  let ignoreMicUntil = 0;

  // End of turn buffers and configuration
  let interimBuffer = '';
  let finalBuffer = '';
  let turnId = 0;
  let runId = 0;
  let silenceTimer = null;
  let silenceDebounceMs = 950; // Between 700 - 1200ms
  let minUtteranceLength = 2;

  // Settings
  let currentProvider = 'auto'; // 'auto' | 'openrouter' | 'gemini' | 'offline'
  let currentVoiceMode = 'continuous'; // 'continuous' | 'push_to_talk' | 'text'

  let wakeWordRequired = false;
  let isArmed = false;
  let armedTimer = null;

  // Wake words list
  const JARVIS_WAKE_WORDS = [
    'يا جارفيس', 'هاي جارفيس', 'هلو جارفيس', 'مرحبا جارفيس', 'اوكتاجون', 'أوكتاجون', 'اوكتاغون', 'أوكتاغون', 'جارفيس',
    'hello jarvis', 'hey jarvis', 'hi jarvis', 'okay jarvis', 'ok jarvis', 'octagon', 'jarvis'
  ];

  function logEvent(type, detail) {
    console.log(`[JarvisVoiceRuntime] [${currentState.toUpperCase()}] ${type}:`, detail);
    try {
      if (window.OctagonAIGovernance && typeof window.OctagonAIGovernance.audit === 'function') {
        window.OctagonAIGovernance.audit(`voice.${type}`, detail);
      }
    } catch (_) {}
  }

  function setState(newState) {
    if (currentState === newState) return;
    const oldState = currentState;
    currentState = newState;
    logEvent('state_change', { from: oldState, to: newState });
    
    // Broadcast state change to UI/Orb
    window.dispatchEvent(new CustomEvent('jarvis:state-change', { detail: { state: newState } }));
    
    // Drive Orb if available
    try {
      if (window.JarvisOrb) {
        if (newState === JARVIS_STATES.LISTENING) {
          window.JarvisOrb.setMode('listening');
          window.JarvisOrb.say('يستمع', 'تحدث الآن...');
        } else if (newState === JARVIS_STATES.THINKING) {
          window.JarvisOrb.setMode('thinking');
          window.JarvisOrb.say('يفكر', 'أعالج طلبك...');
        } else if (newState === JARVIS_STATES.SPEAKING) {
          window.JarvisOrb.setMode('speaking');
          window.JarvisOrb.say('يتحدث', 'جارفيس يردّ');
        } else if (newState === JARVIS_STATES.IDLE) {
          window.JarvisOrb.setMode('idle');
          window.JarvisOrb.say('جاهز', 'انتظر أمرك');
        }
      }
    } catch (_) {}
  }

  function normalizeText(text) {
    return String(text || '')
      .trim()
      .toLowerCase()
      // Remove punctuation
      .replace(/[؟?!.,،:;]/g, ' ')
      // Normalize Arabic characters
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // strip diacritics
      .replace(/[\u0622\u0623\u0625\u0671]/g, 'ا')
      .replace(/\u0629/g, 'ه')
      .replace(/\u0649/g, 'ي')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isStopCommand(text) {
    const norm = normalizeText(text);
    return STOP_COMMANDS.some(cmd => norm === cmd || norm.includes(cmd));
  }

  // Which language should we LISTEN in? Honor the assistant's AR/EN listen chip
  // (getJarvisListenFamily) first — that toggle is what the user actually flips — and
  // only fall back to the page's UI language when the chip getter isn't available.
  function listenIsEnglish() {
    try {
      const a = window.octagonAIAssistant;
      if (a && typeof a.getJarvisListenFamily === 'function') return a.getJarvisListenFamily() === 'en';
    } catch (_) {}
    return (document.documentElement.lang || 'ar').startsWith('en');
  }

  function playBeep(frequency = 587.33, duration = 0.12, type = 'sine') {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (_) {}
  }

  function detectWakeWord(text) {
    const norm = normalizeText(text);
    if (!norm) return null;
    for (const w of JARVIS_WAKE_WORDS) {
      const nw = normalizeText(w);
      const idx = norm.indexOf(nw);
      if (idx !== -1) {
        const normWords = norm.split(' ');
        const nwWords = nw.split(' ');
        
        let matchIdx = -1;
        for (let i = 0; i <= normWords.length - nwWords.length; i++) {
          let match = true;
          for (let j = 0; j < nwWords.length; j++) {
            if (normWords[i+j] !== nwWords[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            matchIdx = i;
            break;
          }
        }
        
        if (matchIdx !== -1) {
          const origWords = text.trim().split(/\s+/);
          const remainderWords = origWords.slice(matchIdx + nwWords.length);
          return {
            word: w,
            remainder: remainderWords.join(' ').trim()
          };
        }
      }
    }
    return null;
  }

  function checkFuzzyEcho(transcript) {
    if (!lastAssistantSpeech) return false;
    const normTranscript = normalizeText(transcript);
    const normAssistant = normalizeText(lastAssistantSpeech);
    if (!normTranscript) return false;
    
    // If it's too short, don't trigger fuzzy check to avoid blocking short commands
    if (normTranscript.length < 3) return false;

    // Direct overlap checks
    if (normAssistant.includes(normTranscript) && normTranscript.length >= 4) return true;
    if (normTranscript.includes(normAssistant) && normAssistant.length >= 6) return true;

    // Simple Levenshtein-like word overlap
    const transWords = normTranscript.split(' ');
    const asstWords = normAssistant.split(' ');
    let matches = 0;
    transWords.forEach(w => {
      if (asstWords.includes(w)) matches++;
    });
    const overlapRatio = matches / transWords.length;
    return overlapRatio > 0.7; // 70% word overlap is highly indicative of echo
  }

  function init() {
    logEvent('init', { provider: currentProvider, mode: currentVoiceMode });
    try {
      wakeWordRequired = localStorage.getItem('jarvisWakeRequired') === '1';
    } catch (_) {}
    startWatchdog();
    // Connect document key listeners for interruption via keyboard (e.g. Space/Escape)
    document.addEventListener('keydown', function (e) {
      if (currentState !== JARVIS_STATES.SPEAKING) return;
      // Don't hijack the spacebar while the user is typing in a field — only Escape is a
      // global stop. Otherwise typing a space in the chat box would cut Jarvis off.
      const tgt = e.target;
      const typing = tgt && (/^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName || '') || tgt.isContentEditable);
      if (e.key === 'Escape' || (e.key === ' ' && !typing)) {
        interrupt('keyboard_stop');
      }
    });
  }

  function start() {
    if (currentState === JARVIS_STATES.LISTENING) return;
    logEvent('start', {});
    ignoreMicUntil = 0;
    consecutiveEchosCount = 0;
    speechMuteGateActive = false; // ensure mute gate is reset
    setupSpeechRecognition();
  }

  function stop() {
    logEvent('stop', {});
    isArmed = false;
    if (armedTimer) clearTimeout(armedTimer);
    armedTimer = null;
    speechMuteGateActive = false; // ensure mute gate is reset
    stopSpeechRecognition();
    setState(JARVIS_STATES.IDLE);
  }

  // Pause capturing for the duration of a turn WITHOUT tearing down the state machine.
  // Used while a request is being thought about / spoken, so the orb keeps showing
  // THINKING/SPEAKING instead of flashing back to IDLE. speak() re-arms the mic at the end.
  function holdMic() {
    logEvent('hold_mic', {});
    stopSpeechRecognition();
  }

  function interrupt(reason = 'user_barge_in', resumeListening = true) {
    if (currentState !== JARVIS_STATES.SPEAKING && currentState !== JARVIS_STATES.THINKING) return false;
    logEvent('interrupt', { reason, resumeListening });

    // Invalidate any in-flight speak() run so its pending safety timer / async TTS resolve
    // becomes a no-op (myRun !== runId) and cannot re-touch the mic after we resume here.
    runId++;
    
    // Reset mute gate
    speechMuteGateActive = false;

    // Stop playing audio
    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.src = '';
      } catch (_) {}
      activeAudio = null;
    }
    
    // Cancel browser native synthesis
    try {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    } catch (_) {}

    // Abort active LLM call
    if (activeAbortController) {
      try {
        activeAbortController.abort();
      } catch (_) {}
      activeAbortController = null;
    }

    setState(JARVIS_STATES.INTERRUPTED);
    
    // Ignore microphone momentarily to avoid capturing the residual sound of speech stopping
    ignoreMicUntil = Date.now() + 400;

    // Reset buffer & state
    finalBuffer = '';
    interimBuffer = '';

    // Switch back to listening mode
    if (resumeListening) {
      setTimeout(() => {
        if (currentState === JARVIS_STATES.INTERRUPTED) {
          setState(JARVIS_STATES.LISTENING);
          setupSpeechRecognition();
        }
      }, 500);
    }

    return true;
  }

  function setupSpeechRecognition() {
    if (recognition) {
      try { recognition.abort(); } catch (_) {}
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setState(JARVIS_STATES.ERROR);
      logEvent('error', { type: 'no_web_speech_support' });
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    
    // Set locale from the listen chip (ar-IQ preferred for Arabic; en-US for English).
    recognition.lang = listenIsEnglish() ? 'en-US' : 'ar-IQ';

    recognition.onstart = function () {
      logEvent('recognition_start', { lang: recognition.lang });
      if (currentState !== JARVIS_STATES.SPEAKING) {
        setState(JARVIS_STATES.LISTENING);
      }
    };

    recognition.onresult = function (event) {
      const now = Date.now();
      
      // Mute gate & Ignore windows check
      if (now < ignoreMicUntil || speechMuteGateActive) {
        return;
      }

      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) final += text;
        else interim += text;
      }

      const rawHear = (final || interim).trim();
      if (!rawHear) return;

      // Handle immediate barge-in interruption check
      if (currentState === JARVIS_STATES.SPEAKING && isStopCommand(rawHear)) {
        interrupt('user_barge_in');
        return;
      }

      // If JARVIS is speaking and user says anything else, check if it's an interruption
      if (currentState === JARVIS_STATES.SPEAKING) {
        // Only trigger barge-in if it is clearly not an echo
        if (!checkFuzzyEcho(rawHear) && rawHear.length > minUtteranceLength) {
          interrupt('user_barge_in');
        }
        return;
      }

      // Live transcript update during speech
      const liveText = (finalBuffer + ' ' + (final || interim)).trim();
      window.dispatchEvent(new CustomEvent('jarvis:transcript-update', { detail: { text: liveText } }));

      if (final) {
        // Echo loop prevention filter
        if (checkFuzzyEcho(final)) {
          consecutiveEchosCount++;
          logEvent('echo_rejected', { text: final, streak: consecutiveEchosCount });
          
          if (consecutiveEchosCount >= 3) {
            consecutiveEchosCount = 0;
            ignoreMicUntil = Date.now() + 1500; // block mic for 1.5s
            try {
              if (window.showToast) window.showToast('تم تجاهل صدى صوت المساعد', 'warning');
            } catch (_) {}
          }
          return;
        }

        consecutiveEchosCount = 0; // reset on clean input
        const cleanFinal = final.trim();

        if (wakeWordRequired) {
          if (isArmed) {
            // Armed mode: accept the next finalized speech as the command
            isArmed = false;
            if (armedTimer) clearTimeout(armedTimer);
            armedTimer = null;
            
            finalBuffer = cleanFinal;
            interimBuffer = '';
            setState(JARVIS_STATES.USER_SPEAKING);
            resetSilenceTimer();
          } else {
            // Unarmed mode: check for wake word
            const wake = detectWakeWord(cleanFinal);
            if (wake) {
              if (wake.remainder) {
                // Command in one breath after the wake word
                finalBuffer = wake.remainder;
                interimBuffer = '';
                setState(JARVIS_STATES.USER_SPEAKING);
                resetSilenceTimer();
              } else {
                // Wake word only: arm for 8 seconds
                isArmed = true;
                if (armedTimer) clearTimeout(armedTimer);
                armedTimer = setTimeout(() => {
                  isArmed = false;
                  armedTimer = null;
                  logEvent('armed_timeout', {});
                  // Reset indicator back to listening/idle
                  window.dispatchEvent(new CustomEvent('jarvis:state-change', { detail: { state: currentState } }));
                }, 8000);
                
                playBeep(587.33, 0.12);
                
                // Show visual prompt cue
                const isEn = listenIsEnglish();
                const label = isEn ? 'Yes? Go ahead...' : 'نعم؟ تفضّل...';
                window.dispatchEvent(new CustomEvent('jarvis:transcript-update', { detail: { text: label } }));
                
                try {
                  if (window.JarvisOrb) {
                    window.JarvisOrb.setMode('listening');
                    window.JarvisOrb.say(isEn ? 'YES?' : 'نعم؟', isEn ? 'Go ahead' : 'تفضّل');
                  }
                } catch (_) {}
                
                finalBuffer = '';
                interimBuffer = '';
              }
            } else {
              // No wake word and not armed: ignore speech
              const isEn = listenIsEnglish();
              const label = isEn ? 'Say "Hey Jarvis" or "Octagon" to command' : 'قل "يا جارفيس" أو "أوكتاجون" للأمر';
              window.dispatchEvent(new CustomEvent('jarvis:transcript-update', { detail: { text: label } }));
              
              finalBuffer = '';
              interimBuffer = '';
            }
          }
        } else {
          // Direct mode (default): run every command immediately. Wake word is optional and stripped.
          const wake = detectWakeWord(cleanFinal);
          const command = wake ? wake.remainder : cleanFinal;
          if (command) {
            finalBuffer = command;
            interimBuffer = '';
            setState(JARVIS_STATES.USER_SPEAKING);
            resetSilenceTimer();
          } else {
            // Only wake word in direct mode: acknowledge and keep listening
            playBeep(587.33, 0.10);
            try {
              if (window.JarvisOrb) {
                const isEn = listenIsEnglish();
                window.JarvisOrb.say(isEn ? 'YES?' : 'نعم؟', isEn ? 'Go ahead' : 'تفضّل');
              }
            } catch (_) {}
            finalBuffer = '';
            interimBuffer = '';
          }
        }
      }
    };

    recognition.onerror = function (event) {
      logEvent('recognition_error', { error: event.error });
      if (event.error === 'not-allowed') {
        setState(JARVIS_STATES.ERROR);
      }
    };

    recognition.onend = function () {
      logEvent('recognition_end', {});
      if (currentState === JARVIS_STATES.LISTENING || currentState === JARVIS_STATES.USER_SPEAKING) {
        // Auto-restart if in hands-free mode
        if (currentVoiceMode === 'continuous') {
          setTimeout(() => {
            if (currentState === JARVIS_STATES.LISTENING || currentState === JARVIS_STATES.USER_SPEAKING) {
              start();
            }
          }, 150);
        }
      }
    };

    try {
      recognition.start();
    } catch (e) {
      logEvent('recognition_start_exception', { message: e.message });
    }
  }

  function stopSpeechRecognition() {
    if (recognition) {
      try {
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
      } catch (_) {}
      recognition = null;
    }
  }

  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      submitUserTurn();
    }, silenceDebounceMs);
  }
  async function submitUserTurn() {
    isArmed = false;
    if (armedTimer) clearTimeout(armedTimer);
    armedTimer = null;

    const text = finalBuffer.trim();
    finalBuffer = '';
    interimBuffer = '';
    if (silenceTimer) clearTimeout(silenceTimer);

    if (text.length < minUtteranceLength) {
      if (currentState === JARVIS_STATES.USER_SPEAKING) {
        setState(JARVIS_STATES.LISTENING);
      }
      return;
    }

    turnId++;
    logEvent('submit_turn', { turnId, text });
    setState(JARVIS_STATES.THINKING);
    // Stop capturing while we think — keeps the mic from hearing ambient noise or the
    // tail of the user's own sentence during processing. speak() re-arms it afterwards.
    stopSpeechRecognition();

    // Cancel existing abort controller if any
    if (activeAbortController) activeAbortController.abort();
    activeAbortController = new AbortController();

    // Check if we should delegate to assistant module's processJarvisTranscript
    const assistant = window.octagonAIAssistant;
    if (assistant && typeof assistant.processJarvisTranscript === 'function') {
      try {
        await assistant.processJarvisTranscript(text);
      } catch (err) {
        logEvent('turn_error', { turnId, error: err.message });
        setState(JARVIS_STATES.ERROR);
      }
      return;
    }

    try {
      // Build internal action/intent execution map context
      const context = {};
      if (window.JarvisBrain && typeof window.JarvisBrain.handle === 'function') {
        const response = await window.JarvisBrain.handle(text, { 
          turnId, 
          abortSignal: activeAbortController.signal 
        });
        
        // Expose a way to pass result back
        speak(response.text);
      } else {
        // Fallback simple response
        speak('نظام جارفيس جاهز، لكن مكتبة عقل النظام غير متصلة.');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        logEvent('turn_aborted', { turnId });
      } else {
        setState(JARVIS_STATES.ERROR);
        logEvent('turn_error', { turnId, error: err.message });
      }
    }
  }
  async function speak(text, resumeListening = true) {
    if (!text) return;
    
    // Tag source: "assistant"
    lastAssistantSpeech = text;
    lastAssistantSpeechTime = Date.now();
    
    runId++;
    const myRun = runId;
    logEvent('speak', { runId, text });

    // Stop recording while speaking to prevent self-triggering
    stopSpeechRecognition();
    setState(JARVIS_STATES.SPEAKING);
    speechMuteGateActive = true;

    // Interruption / barge-in command listener is kept armed by ignoreMicUntil being 0
    // but we use speechMuteGateActive to stop transcribing normal words

    let finished = false;
    let safetyTimer = null;
    const speakFinished = () => {
      // Idempotent + turn-guarded: never let a stale/duplicate finish from an old turn
      // re-open the mic after a newer turn has already started.
      if (finished || myRun !== runId) return;
      finished = true;
      if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
      speechMuteGateActive = false;
      // Added a 600ms safety ignore window after TTS ends to absorb echoes/reverberations
      ignoreMicUntil = Date.now() + 600;

      if (currentState === JARVIS_STATES.SPEAKING) {
        setState(JARVIS_STATES.LISTENING);
        if (resumeListening && currentVoiceMode === 'continuous') {
          start();
        }
      }
    };
    // SAFETY: estimate how long the reply takes to speak and force-finish if the TTS
    // engine never fires onended/onerror (some embedded WebViews + stalled audio do this).
    // Without this, a single silent TTS would wedge Jarvis in SPEAKING and the mic would
    // never come back — the worst possible failure for a hands-free assistant.
    // Generous estimate: the backstop must outlast even a long reply so it can never
    // resume the mic mid-sentence (which would make Jarvis hear himself). Cloud-TTS
    // tightens this to the real clip length below via onloadedmetadata.
    const estMs = Math.min(48000, Math.max(2500, String(text).length * 95));
    const armSafety = (ms) => {
      if (safetyTimer) clearTimeout(safetyTimer);
      safetyTimer = setTimeout(() => { logEvent('speak_safety_timeout', { runId: myRun }); speakFinished(); }, ms);
    };
    armSafety(estMs + 4000);

    // Synthesize Cloud Audio TTS (natural Arabic voice fallback)
    try {
      const assistantModule = window.octagonAIAssistant;
      if (assistantModule && typeof assistantModule.synthesizeCloudTTS === 'function') {
        const url = await assistantModule.synthesizeCloudTTS(text);
        if (myRun !== runId) { if (url) { try { URL.revokeObjectURL(url); } catch (_) {} } return; }
        if (url) {
          if (activeAudio) {
            try { activeAudio.pause(); } catch (_) {}
          }
          activeAudio = new Audio(url);
          activeAudio.onended = speakFinished;
          activeAudio.onerror = speakFinished;
          // Tighten the safety timer to the real clip length once it's known.
          activeAudio.onloadedmetadata = () => {
            if (myRun === runId && isFinite(activeAudio.duration) && activeAudio.duration > 0) {
              armSafety(activeAudio.duration * 1000 + 2500);
            }
          };
          await activeAudio.play();
          return;
        }
      }
    } catch (_) {}

    // Native Browser Fallback (if cloud TTS fails or is not present)
    if (window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
      const utterance = new SpeechSynthesisUtterance(text);

      // Determine language
      const hasArabic = /[؀-ۿ]/.test(text);
      utterance.lang = hasArabic ? 'ar-SA' : 'en-US';

      utterance.onend = speakFinished;
      utterance.onerror = speakFinished;

      try { window.speechSynthesis.speak(utterance); }
      catch (_) { speakFinished(); }
    } else {
      speakFinished();
    }
  }

  function startWatchdog() {
    stopWatchdog();
    watchdogInterval = setInterval(() => {
      // Watchdog: If state is LISTENING but recognition is not active, restart it
      if (currentState === JARVIS_STATES.LISTENING && !recognition) {
        logEvent('watchdog_revive', {});
        start();
      }
    }, 4000);
  }

  function stopWatchdog() {
    if (watchdogInterval) {
      clearInterval(watchdogInterval);
      watchdogInterval = null;
    }
  }

  function getState() {
    return currentState;
  }

  function setProvider(provider) {
    currentProvider = provider;
    logEvent('set_provider', { provider });
  }

  function setVoiceMode(mode) {
    currentVoiceMode = mode; // 'continuous' | 'push_to_talk' | 'text'
    logEvent('set_voice_mode', { mode });
    if (mode === 'continuous') {
      start();
    } else {
      stopSpeechRecognition();
      setState(JARVIS_STATES.IDLE);
    }
  }

  function setWakeWordRequired(val) {
    wakeWordRequired = !!val;
    try {
      localStorage.setItem('jarvisWakeRequired', val ? '1' : '0');
    } catch (_) {}
    logEvent('set_wake_word_required', { value: wakeWordRequired });
    if (!wakeWordRequired) {
      isArmed = false;
      if (armedTimer) clearTimeout(armedTimer);
      armedTimer = null;
    }
  }

  // Export module
  window.JarvisVoiceRuntime = {
    init,
    start,
    stop,
    holdMic,
    interrupt,
    speak,
    submitUserTurn,
    getState,
    setProvider,
    setVoiceMode,
    setWakeWordRequired,
    STATES: JARVIS_STATES,
    LANGUAGE_MODE: JARVIS_LANGUAGE_MODE
  };

  // Auto-init on load if in browser environment
  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      window.JarvisVoiceRuntime.init();
    });
  }

})();
