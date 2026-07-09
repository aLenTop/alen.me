// ==UserScript==
// @name         alen.me
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Script for Nekto.me
// @author       aLenTop
// @match        https://nekto.me/*
// @match        https://wayou.github.io/t-rex-runner/*
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';

    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    console.log('[Nekto.me Ultimate] Скрипт версии 1.1 запущен');

    // Безопасное чтение памяти
    function safeGetLocalStorage(key, defaultValue) {
        try { return localStorage.getItem(key) || defaultValue; } 
        catch (e) { return defaultValue; }
    }

    // ==========================================
    // ЛОГИКА ДЛЯ ФРЕЙМА ИГРЫ ДИНОЗАВРИКА
    // ==========================================
    if (win.location.href.includes('wayou.github.io/t-rex-runner')) {
        let hashVol = parseFloat(win.location.hash.replace('#', ''));
        let dinoVolume = isNaN(hashVol) ? 0.5 : hashVol;

        const AC = win.AudioContext || win.webkitAudioContext;
        if (AC) {
            win.AudioContext = win.webkitAudioContext = function(...args) {
                const ctx = new AC(...args);
                const gainNode = ctx.createGain();
                gainNode.gain.setValueAtTime(dinoVolume, ctx.currentTime);
                gainNode.connect(ctx.destination);
                
                const originalConnect = win.AudioNode.prototype.connect;
                win.AudioNode.prototype.connect = function(destination, ...connectArgs) {
                    if (destination === ctx.destination) return originalConnect.call(this, gainNode, ...connectArgs);
                    return originalConnect.call(this, destination, ...connectArgs);
                };
                win.dinoGainNode = gainNode;
                return ctx;
            };
        }
        
        let attempts = 0;
        const fixTimer = setInterval(() => {
            if (win.Runner && win.Runner.config) {
                win.Runner.config.ACCELERATION = 0.00003; 
                win.Runner.config.MAX_SPEED = 6;         
                clearInterval(fixTimer);
            }
            if (attempts++ > 100) clearInterval(fixTimer);
        }, 50);

        win.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'SET_DINO_VOLUME') {
                if (win.dinoGainNode) win.dinoGainNode.gain.setValueAtTime(parseFloat(event.data.volume), win.dinoGainNode.context.currentTime);
            }
        });
        return; 
    }

    // ==========================================
    // НАСТРОЙКИ СЛОВ И ТАЙМЕРОВ (НА НЕКТО МИ)
    // ==========================================
    let wordsSkip = (safeGetLocalStorage('nekto_words_skip', 'арбуз, скип')).split(',').map(s=>s.trim().toLowerCase()).filter(s=>s);
    let wordsStop = (safeGetLocalStorage('nekto_words_stop', 'стоп, хватит')).split(',').map(s=>s.trim().toLowerCase()).filter(s=>s);
    let wordsStart = (safeGetLocalStorage('nekto_words_start', 'старт, поиск')).split(',').map(s=>s.trim().toLowerCase()).filter(s=>s);
    
    let talkTimeLimit = parseInt(safeGetLocalStorage('nekto_talk_time', '0'));
    let cooldownTime = parseFloat(safeGetLocalStorage('nekto_cooldown_time', '1.5'));

    // Таймер общего доступа к сайту (не путать с talkTimeLimit — тот про один диалог).
    // Хранится по абсолютным timestamp'ам в localStorage, поэтому переживает reload/закрытие вкладки.
    let accessSessionMin = parseFloat(safeGetLocalStorage('nekto_access_session_min', '60'));
    let accessCooldownMin = parseFloat(safeGetLocalStorage('nekto_access_cooldown_min', '30'));
    let statsLimit = parseInt(safeGetLocalStorage('nekto_stats_limit', '36000'));
    
    let chatVolume = parseFloat(safeGetLocalStorage('nekto_volume', '1'));
    let dinoVolume = parseFloat(safeGetLocalStorage('nekto_dino_volume', '0.5'));
    let micGainValue = parseFloat(safeGetLocalStorage('nekto_mic_gain', '1.0'));
    let notificationVolume = parseFloat(safeGetLocalStorage('nekto_notification_volume', '0.5'));
    
    let selfListeningActive = safeGetLocalStorage('nekto_self_listening', 'false') === 'true';
    let autoStartActive = safeGetLocalStorage('nekto_auto_start', 'false') === 'true';

    let dialogueHistory = JSON.parse(safeGetLocalStorage('nekto_dialogue_history', '[]'));

    let actionTriggered = false;
    let chatActive = false;
    // Заглушки звука: обе выключены по умолчанию — звук собеседника слышен как обычно,
    // микрофон включён как обычно. Кнопки просто дают возможность заглушить вручную при желании.
    let companionMuted = false;
    let micMuted = false;
    let companionPitch = parseFloat(safeGetLocalStorage('nekto_companion_pitch', '1'));
    let companionEffect = safeGetLocalStorage('nekto_companion_effect', 'none');
    let micEffect = safeGetLocalStorage('nekto_mic_effect', 'none');

    // Горячие клавиши (формат "Alt+KeyS"; пустая строка = хоткей отключён)
    let hotkeys = {
        skip:  safeGetLocalStorage('nekto_hotkey_skip',  'Alt+KeyS'),
        stop:  safeGetLocalStorage('nekto_hotkey_stop',  'Alt+KeyX'),
        start: safeGetLocalStorage('nekto_hotkey_start', 'Alt+KeyA')
    };
    // Темы
    let uiTheme = safeGetLocalStorage('nekto_ui_theme', 'dark');
    let gameTheme = safeGetLocalStorage('nekto_game_theme', 'win98');

    // Общий список эффектов — одинаковый и для голоса собеседника, и для своего микрофона.
    const EFFECT_LIST = [
        { id: 'none', label: 'Без эффекта' },
        { id: 'phone', label: '📞 Телефон' },
        { id: 'radio', label: '📻 Рация' },
        { id: 'robot', label: '🤖 Робот' },
        { id: 'muffled', label: '🌊 Под водой' },
        { id: 'bitcrush', label: '👾 Ретро / 8-бит' },
        { id: 'echo', label: '🏔️ Эхо' },
        { id: 'tremolo', label: '📳 Дрожащий голос' },
        { id: 'megaphone', label: '📢 Мегафон' },
        { id: 'glitch', label: '📶 Плохая связь' },
        { id: 'heavydegrade', label: '💥 Сильное ухудшение' },
        { id: 'cave', label: '🕳️ Пещера (реверб)' },
        { id: 'stadium', label: '🏟️ Стадион' },
        { id: 'flanger', label: '🌀 Флэнжер' },
        { id: 'chorus', label: '🎶 Хор (удвоение)' },
        { id: 'vibrato', label: '🎵 Вибрато' },
        { id: 'wah', label: '🎸 Вау-вау' },
        { id: 'vinyl', label: '📀 Винил (шипение)' },
        { id: 'lofi', label: '📼 Кассета Lo-Fi' },
        { id: 'demon', label: '😈 Демон' },
        { id: 'alien', label: '👽 Пришелец' }
    ];
    let chatStartTime = 0;
    let weInitiatedSkip = false;

    let localAudioCtx = null;
    let localGainNode = null;
    let localDest = null;         // MediaStreamDestination, куда в итоге течёт исходящий звук
    let localEffectOutput = null; // выходной узел текущей цепочки эффекта для микрофона
    let localEffectNodes = [];    // узлы текущей цепочки эффекта для микрофона (для очистки)
    let isSelfListeningConnected = false;

    // ==========================================
    // УПРАВЛЕНИЕ АУДИО И МИКРОФОНОМ (+/-)
    // ==========================================
    // ==========================================
    // ДВИЖОК АУДИО-ЭФФЕКТОВ (общий для собеседника и своего микрофона)
    // ==========================================
    function makeDistortionCurve(amount) {
        const n = 4096, curve = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; curve[i] = (3 + amount) * x * 20 * Math.PI / 180 / (Math.PI + amount * Math.abs(x)); }
        return curve;
    }
    function makeQuantizeCurve(steps) {
        const n = 4096, curve = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; curve[i] = Math.round(x * steps) / steps; }
        return curve;
    }
    // Импульсная характеристика для ConvolverNode: затухающий шум = простой честный реверб
    function makeImpulseResponse(ctx, seconds, decay) {
        const rate = ctx.sampleRate, len = Math.round(rate * seconds);
        const buf = ctx.createBuffer(2, len, rate);
        for (let ch = 0; ch < 2; ch++) {
            const data = buf.getChannelData(ch);
            for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
        return buf;
    }
    // Зацикленный источник белого шума (для эффектов винила/кассеты)
    function makeNoiseSource(ctx) {
        const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 2), ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.start();
        return src;
    }

    // Строит цепочку узлов Web Audio для выбранного эффекта. Возвращает {input, output, nodes}.
    function buildEffectChain(ctx, effectId) {
        switch (effectId) {
            case 'phone': {
                const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400;
                hp.connect(lp);
                return { input: hp, output: lp, nodes: [hp, lp] };
            }
            case 'radio': {
                const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
                const shaper = ctx.createWaveShaper(); shaper.curve = makeDistortionCurve(25);
                hp.connect(lp); lp.connect(shaper);
                return { input: hp, output: shaper, nodes: [hp, lp, shaper] };
            }
            case 'robot': {
                // Кольцевая модуляция: осциллятор подключён прямо к параметру gain (не к сигналу),
                // при базовом gain=0 это даёт классический "роботизированный" тембр.
                const ring = ctx.createGain(); ring.gain.value = 0;
                const carrier = ctx.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = 45;
                carrier.connect(ring.gain); carrier.start();
                return { input: ring, output: ring, nodes: [ring, carrier] };
            }
            case 'muffled': {
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 1;
                return { input: lp, output: lp, nodes: [lp] };
            }
            case 'bitcrush': {
                const shaper = ctx.createWaveShaper(); shaper.curve = makeQuantizeCurve(16);
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
                shaper.connect(lp);
                return { input: shaper, output: lp, nodes: [shaper, lp] };
            }
            case 'echo': {
                const input = ctx.createGain();
                const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.28;
                const feedback = ctx.createGain(); feedback.gain.value = 0.35;
                const output = ctx.createGain();
                input.connect(output);
                input.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(output);
                return { input, output, nodes: [input, delay, feedback, output] };
            }
            case 'tremolo': {
                const gain = ctx.createGain(); gain.gain.value = 0.6;
                const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 6;
                const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.4;
                lfo.connect(lfoGain); lfoGain.connect(gain.gain); lfo.start();
                return { input: gain, output: gain, nodes: [gain, lfo, lfoGain] };
            }
            case 'megaphone': {
                const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2800;
                const shaper = ctx.createWaveShaper(); shaper.curve = makeDistortionCurve(60);
                hp.connect(lp); lp.connect(shaper);
                return { input: hp, output: shaper, nodes: [hp, lp, shaper] };
            }
            case 'glitch': {
                const gain = ctx.createGain(); gain.gain.value = 0.5;
                const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 3;
                const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
                lfo.connect(lfoGain); lfoGain.connect(gain.gain); lfo.start();
                return { input: gain, output: gain, nodes: [gain, lfo, lfoGain] };
            }
            case 'heavydegrade': {
                const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000;
                const shaper = ctx.createWaveShaper(); shaper.curve = makeDistortionCurve(80);
                const crush = ctx.createWaveShaper(); crush.curve = makeQuantizeCurve(8);
                hp.connect(lp); lp.connect(shaper); shaper.connect(crush);
                return { input: hp, output: crush, nodes: [hp, lp, shaper, crush] };
            }
            case 'cave': {
                // Сухой сигнал + свёртка с затухающим шумом = гулкая пещера
                const input = ctx.createGain(), output = ctx.createGain();
                const conv = ctx.createConvolver(); conv.buffer = makeImpulseResponse(ctx, 2.6, 3);
                const dry = ctx.createGain(); dry.gain.value = 0.65;
                const wet = ctx.createGain(); wet.gain.value = 0.7;
                input.connect(dry); dry.connect(output);
                input.connect(conv); conv.connect(wet); wet.connect(output);
                return { input, output, nodes: [input, output, conv, dry, wet] };
            }
            case 'stadium': {
                // Длинное эхо с затемняющимся повтором — как объявление на стадионе
                const input = ctx.createGain(), output = ctx.createGain();
                const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.42;
                const loopLp = ctx.createBiquadFilter(); loopLp.type = 'lowpass'; loopLp.frequency.value = 2400;
                const feedback = ctx.createGain(); feedback.gain.value = 0.45;
                const wet = ctx.createGain(); wet.gain.value = 0.55;
                input.connect(output);
                input.connect(delay); delay.connect(loopLp); loopLp.connect(feedback); feedback.connect(delay);
                delay.connect(wet); wet.connect(output);
                return { input, output, nodes: [input, output, delay, loopLp, feedback, wet] };
            }
            case 'flanger': {
                // Короткая модулируемая задержка с обратной связью — "реактивный" свист
                const input = ctx.createGain(), output = ctx.createGain();
                const delay = ctx.createDelay(0.05); delay.delayTime.value = 0.005;
                const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.25;
                const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.0035;
                lfo.connect(lfoGain); lfoGain.connect(delay.delayTime); lfo.start();
                const feedback = ctx.createGain(); feedback.gain.value = 0.4;
                delay.connect(feedback); feedback.connect(delay);
                const dry = ctx.createGain(); dry.gain.value = 0.7;
                const wet = ctx.createGain(); wet.gain.value = 0.7;
                input.connect(dry); dry.connect(output);
                input.connect(delay); delay.connect(wet); wet.connect(output);
                return { input, output, nodes: [input, output, delay, lfo, lfoGain, feedback, dry, wet] };
            }
            case 'chorus': {
                // Две плавающие задержки поверх сухого сигнала — будто говорят двое-трое
                const input = ctx.createGain(), output = ctx.createGain();
                const dry = ctx.createGain(); dry.gain.value = 0.7; input.connect(dry); dry.connect(output);
                const nodes = [input, output, dry];
                [[0.020, 0.6, 0.004], [0.027, 0.35, 0.005]].forEach(([base, rate, depth]) => {
                    const d = ctx.createDelay(0.1); d.delayTime.value = base;
                    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = rate;
                    const lg = ctx.createGain(); lg.gain.value = depth;
                    lfo.connect(lg); lg.connect(d.delayTime); lfo.start();
                    const w = ctx.createGain(); w.gain.value = 0.5;
                    input.connect(d); d.connect(w); w.connect(output);
                    nodes.push(d, lfo, lg, w);
                });
                return { input, output, nodes };
            }
            case 'vibrato': {
                // Только "мокрый" сигнал через качающуюся задержку — высота плавает вверх-вниз
                const delay = ctx.createDelay(0.05); delay.delayTime.value = 0.006;
                const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.5;
                const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.004;
                lfo.connect(lfoGain); lfoGain.connect(delay.delayTime); lfo.start();
                return { input: delay, output: delay, nodes: [delay, lfo, lfoGain] };
            }
            case 'wah': {
                // Полосовой фильтр, у которого частота ездит LFO — классическая "вау-вау" педаль
                const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 4;
                const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 1.3;
                const lfoGain = ctx.createGain(); lfoGain.gain.value = 550;
                lfo.connect(lfoGain); lfoGain.connect(bp.frequency); lfo.start();
                const makeup = ctx.createGain(); makeup.gain.value = 1.6; // компенсация узкой полосы
                bp.connect(makeup);
                return { input: bp, output: makeup, nodes: [bp, lfo, lfoGain, makeup] };
            }
            case 'vinyl': {
                // Тёплая полоса + постоянное лёгкое шипение пластинки
                const input = ctx.createGain(), output = ctx.createGain();
                const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60;
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7500;
                const shaper = ctx.createWaveShaper(); shaper.curve = makeDistortionCurve(8);
                input.connect(hp); hp.connect(lp); lp.connect(shaper); shaper.connect(output);
                const noise = makeNoiseSource(ctx);
                const noiseBp = ctx.createBiquadFilter(); noiseBp.type = 'bandpass'; noiseBp.frequency.value = 5000; noiseBp.Q.value = 0.6;
                const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.012;
                noise.connect(noiseBp); noiseBp.connect(noiseGain); noiseGain.connect(output);
                return { input, output, nodes: [input, output, hp, lp, shaper, noise, noiseBp, noiseGain] };
            }
            case 'lofi': {
                // Кассета: срезанный верх, лёгкий кранч и медленное "плавание" плёнки + шип
                const input = ctx.createGain(), output = ctx.createGain();
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
                const crush = ctx.createWaveShaper(); crush.curve = makeQuantizeCurve(24);
                const wow = ctx.createDelay(0.05); wow.delayTime.value = 0.004;
                const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.5;
                const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.0015;
                lfo.connect(lfoGain); lfoGain.connect(wow.delayTime); lfo.start();
                input.connect(lp); lp.connect(crush); crush.connect(wow); wow.connect(output);
                const noise = makeNoiseSource(ctx);
                const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.008;
                noise.connect(noiseGain); noiseGain.connect(output);
                return { input, output, nodes: [input, output, lp, crush, wow, lfo, lfoGain, noise, noiseGain] };
            }
            case 'demon': {
                // Тёмный низ + перегруз + медленная кольцевая модуляция = рычащий "демон"
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
                const shaper = ctx.createWaveShaper(); shaper.curve = makeDistortionCurve(40);
                const ring = ctx.createGain(); ring.gain.value = 0.55;
                const carrier = ctx.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = 55;
                const depth = ctx.createGain(); depth.gain.value = 0.45;
                carrier.connect(depth); depth.connect(ring.gain); carrier.start();
                lp.connect(shaper); shaper.connect(ring);
                return { input: lp, output: ring, nodes: [lp, shaper, ring, carrier, depth] };
            }
            case 'alien': {
                // Кольцевая модуляция на "плавающей" несущей — металлический инопланетный тембр
                const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 200;
                const ring = ctx.createGain(); ring.gain.value = 0;
                const carrier = ctx.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = 140;
                const drift = ctx.createOscillator(); drift.type = 'sine'; drift.frequency.value = 0.8;
                const driftGain = ctx.createGain(); driftGain.gain.value = 60;
                drift.connect(driftGain); driftGain.connect(carrier.frequency);
                carrier.connect(ring.gain); carrier.start(); drift.start();
                hp.connect(ring);
                return { input: hp, output: ring, nodes: [hp, ring, carrier, drift, driftGain] };
            }
            case 'none':
            default: {
                const g = ctx.createGain(); g.gain.value = 1;
                return { input: g, output: g, nodes: [g] };
            }
        }
    }

    function teardownEffectNodes(nodesArr) {
        (nodesArr || []).forEach(n => {
            try { n.disconnect(); } catch (e) {}
            if (typeof n.stop === 'function') { try { n.stop(); } catch (e) {} }
        });
    }

    function updateMicSettings() {
        if (localGainNode && localAudioCtx) {
            localGainNode.gain.setValueAtTime(micMuted ? 0 : micGainValue, localAudioCtx.currentTime);
            const listenNode = localEffectOutput || localGainNode; // самопрослушивание тоже должно слышать эффект
            if (selfListeningActive) {
                if (!isSelfListeningConnected) {
                    try { listenNode.connect(localAudioCtx.destination); isSelfListeningConnected = true; } catch(e) {}
                }
            } else {
                if (isSelfListeningConnected) {
                    try { listenNode.disconnect(localAudioCtx.destination); isSelfListeningConnected = false; } catch(e) {}
                }
            }
        }
    }

    // Пересобирает цепочку эффекта для СВОЕГО микрофона (то, что услышит собеседник) и,
    // если включено самопрослушивание, подключает тот же эффект и к себе.
    function applyLocalEffect(effectId) {
        micEffect = effectId;
        localStorage.setItem('nekto_mic_effect', effectId);
        if (!localAudioCtx || !localGainNode || !localDest) return;
        try { localGainNode.disconnect(); } catch (e) {}
        if (localEffectOutput && isSelfListeningConnected) { try { localEffectOutput.disconnect(localAudioCtx.destination); } catch (e) {} }
        teardownEffectNodes(localEffectNodes);
        const chain = buildEffectChain(localAudioCtx, effectId);
        localEffectNodes = chain.nodes;
        localGainNode.connect(chain.input);
        chain.output.connect(localDest);
        localEffectOutput = chain.output;
        if (selfListeningActive) { try { chain.output.connect(localAudioCtx.destination); isSelfListeningConnected = true; } catch (e) {} }
    }

    // Мгновенно применяет текущее состояние заглушек (не дожидаясь очередного тика watchdog'а)
    function applyMuteStates() {
        // Реальный звук собеседника идёт через remotePitchGain (учитывает питч), а не через
        // media.volume — родной <audio> навсегда приглушён в setupRemoteAudioPipeline.
        if (remotePitchGain) {
            try { remotePitchGain.gain.value = companionMuted ? 0 : chatVolume; } catch (e) {}
        }
        if (localGainNode && localAudioCtx) {
            try { localGainNode.gain.setValueAtTime(micMuted ? 0 : micGainValue, localAudioCtx.currentTime); } catch (e) {}
        }
    }

    if (win.navigator.mediaDevices && win.navigator.mediaDevices.getUserMedia) {
        const originalGetUserMedia = win.navigator.mediaDevices.getUserMedia.bind(win.navigator.mediaDevices);
        win.navigator.mediaDevices.getUserMedia = async function(constraints) {
            if (constraints && constraints.audio) {
                if (typeof constraints.audio === 'object') {
                    constraints.audio.echoCancellation = false; constraints.audio.noiseSuppression = false; constraints.audio.autoGainControl = false;
                } else if (constraints.audio === true) {
                    constraints.audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
                }
            }

            const stream = await originalGetUserMedia(constraints);
            
            if (stream && stream.getAudioTracks().length > 0) {
                if (localAudioCtx) {
                    try { if (localGainNode) localGainNode.disconnect(); localAudioCtx.close(); } catch(e) {}
                    localGainNode = null; localAudioCtx = null; isSelfListeningConnected = false; localEffectNodes = []; localEffectOutput = null; localDest = null;
                }

                const AudioCtx = win.AudioContext || win.webkitAudioContext;
                localAudioCtx = new AudioCtx();
                const source = localAudioCtx.createMediaStreamSource(stream);
                localGainNode = localAudioCtx.createGain();
                localGainNode.gain.setValueAtTime(micMuted ? 0 : micGainValue, localAudioCtx.currentTime);

                source.connect(localGainNode);

                localDest = localAudioCtx.createMediaStreamDestination();
                applyLocalEffect(micEffect); // подключает localGainNode -> [эффект] -> localDest (+ самопрослушивание)

                const processedStream = localDest.stream;
                stream.getVideoTracks().forEach(track => processedStream.addTrack(track));
                return processedStream;
            }
            return stream;
        };
    }

    // Перехват системных звуков + подключение анализатора и питч-обработчика для собеседника
    let remoteAudioCtx = null;
    let remoteAnalyser = null;
    let remotePitchGain = null;
    let remotePitchNode = null;   // сам питч-процессор, к которому подключается цепочка эффекта
    let remoteEffectNodes = [];   // узлы текущей цепочки эффекта для собеседника (для очистки)

    // Простой ресэмплер в реальном времени: читает из кольцевого буфера с шагом companionPitch.
    // Шаг >1 — читаем "быстрее" запись → выше и быстрее (эффект бурундука);
    // шаг <1 — читаем "медленнее" → ниже и медленнее (эффект замедленной кассеты).
    // Меняет одновременно и высоту, и темп речи — раздельного питч-шифта (без изменения темпа)
    // здесь нет, для живого потока это требует куда более сложного алгоритма.
    function createPitchShiftNode(ctx) {
        const bufferSize = 4096;
        const node = ctx.createScriptProcessor(bufferSize, 1, 1);
        const ringLen = Math.round(ctx.sampleRate * 2); // ~2 секунды буфера
        const ring = new Float32Array(ringLen);
        let writePos = 0, readPos = 0, filled = 0;

        node.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            const output = e.outputBuffer.getChannelData(0);

            for (let i = 0; i < input.length; i++) {
                ring[writePos] = input[i];
                writePos = (writePos + 1) % ringLen;
                filled = Math.min(filled + 1, ringLen);
            }

            const ratio = companionPitch || 1;
            for (let i = 0; i < output.length; i++) {
                if (filled < 8) { output[i] = 0; continue; }
                const i0 = Math.floor(readPos) % ringLen;
                const i1 = (i0 + 1) % ringLen;
                const frac = readPos - Math.floor(readPos);
                output[i] = ring[i0] * (1 - frac) + ring[i1] * frac;
                readPos = (readPos + ratio) % ringLen;
            }

            // Анти-дрейф: если чтение слишком приблизилось к записи (или слишком отстало),
            // подтягиваем позицию чтения на фиксированное расстояние позади записи, чтобы не
            // читать "будущие" сэмплы и не копить бесконечную задержку при долгом разговоре.
            const gapAhead = ((writePos - readPos) % ringLen + ringLen) % ringLen;
            if (gapAhead < bufferSize || gapAhead > ringLen - bufferSize) {
                readPos = ((writePos - bufferSize * 2) % ringLen + ringLen) % ringLen;
            }
        };
        return node;
    }

    function setupRemoteAudioPipeline(stream, mediaEl) {
        try {
            if (remoteAudioCtx) { try { remoteAudioCtx.close(); } catch (e) {} }
            remoteAudioCtx = new (win.AudioContext || win.webkitAudioContext)();
            const source = remoteAudioCtx.createMediaStreamSource(stream);

            remoteAnalyser = remoteAudioCtx.createAnalyser();
            remoteAnalyser.fftSize = 256;
            remoteAnalyser.smoothingTimeConstant = 0.8;
            source.connect(remoteAnalyser); // только для волны громкости, звук отсюда никуда не идёт

            const pitchNode = createPitchShiftNode(remoteAudioCtx);
            remotePitchNode = pitchNode;
            remotePitchGain = remoteAudioCtx.createGain();
            remotePitchGain.gain.value = companionMuted ? 0 : chatVolume;
            source.connect(pitchNode);
            remoteEffectNodes = [];
            applyRemoteEffect(companionEffect); // подключает pitchNode -> [эффект] -> remotePitchGain
            remotePitchGain.connect(remoteAudioCtx.destination);

            // Реальный звук теперь идёт через Web Audio (с учётом питча и эффекта) — родной
            // <audio> глушим навсегда, чтобы не было дублирования/эха.
            try { mediaEl.volume = 0; } catch (e) {}
        } catch (e) {
            console.log('[Аудио] Не удалось подключить пайплайн собеседника:', e);
        }
    }

    // Пересобирает цепочку эффекта для ГОЛОСА СОБЕСЕДНИКА
    function applyRemoteEffect(effectId) {
        companionEffect = effectId;
        localStorage.setItem('nekto_companion_effect', effectId);
        if (!remoteAudioCtx || !remotePitchNode || !remotePitchGain) return; // звонка сейчас нет — применится при следующем
        try { remotePitchNode.disconnect(); } catch (e) {}
        teardownEffectNodes(remoteEffectNodes);
        const chain = buildEffectChain(remoteAudioCtx, effectId);
        remoteEffectNodes = chain.nodes;
        remotePitchNode.connect(chain.input);
        chain.output.connect(remotePitchGain);
    }

    if (win.HTMLMediaElement && win.HTMLMediaElement.prototype) {
        const originalPlay = win.HTMLMediaElement.prototype.play;
        win.HTMLMediaElement.prototype.play = function() {
            if (this.srcObject && this.srcObject.getAudioTracks && this.srcObject.getAudioTracks().length > 0) {
                setupRemoteAudioPipeline(this.srcObject, this);
            } else {
                try { this.volume = notificationVolume; } catch (e) {}
            }
            return originalPlay.apply(this, arguments);
        };
    }

    // ==========================================
    // ЛОГИКА КНОПОК ЧАТА
    // ==========================================
    function doStop() {
        weInitiatedSkip = true;
        let stopButton = document.querySelector('button.callScreen__cancelCallBtn') || document.querySelector('button.stop-talk-button');
        if (stopButton) {
            stopButton.click();
            setTimeout(() => {
                const confirmButton = document.querySelector('button.swal2-confirm');
                if (confirmButton) confirmButton.click();
            }, 100);
        }
    }

    function doStart() {
        const finishedScreen = document.querySelector('.callScreen.callFinished');
        let button = finishedScreen ? finishedScreen.querySelector('button.callScreen__findBtn') : document.querySelector('button.go-scan-button');
        if (button) {
            button.click();
            weInitiatedSkip = false;
        } else {
            setTimeout(() => {
                let retryBtn = document.querySelector('button.callScreen__findBtn') || document.querySelector('button.go-scan-button');
                if (retryBtn) { retryBtn.click(); weInitiatedSkip = false; }
            }, 300);
        }
    }

    function cmdStop() {
        if (actionTriggered) return; actionTriggered = true;
        doStop(); setTimeout(() => { actionTriggered = false; }, 2000);
    }

    function cmdStart() {
        if (actionTriggered) return; actionTriggered = true;
        doStart(); setTimeout(() => { actionTriggered = false; }, 2000);
    }

    function cmdSkip() {
        if (actionTriggered) return; actionTriggered = true;
        doStop();
        setTimeout(() => { doStart(); setTimeout(() => { actionTriggered = false; }, 2000); }, cooldownTime * 1000);
    }

    // ==========================================
    // ГОРЯЧИЕ КЛАВИШИ (skip/stop/start), переназначаемые в настройках
    // ==========================================
    // Ограничение платформы: страница получает keydown только пока вкладка активна.
    // Глобальные системные хоткеи (при свёрнутом браузере) из userscript'а недоступны —
    // браузер физически не доставляет события клавиатуры фоновым страницам.
    let capturingHotkeyFor = null; // 'skip' | 'stop' | 'start' | null — режим "нажми клавиши" в настройках

    const MODIFIER_CODES = ['ControlLeft','ControlRight','AltLeft','AltRight','ShiftLeft','ShiftRight','MetaLeft','MetaRight'];

    function eventToCombo(e) {
        if (MODIFIER_CODES.includes(e.code)) return null; // одна зажатая Alt/Ctrl — ещё не комбинация
        const mods = [];
        if (e.ctrlKey) mods.push('Ctrl');
        if (e.altKey) mods.push('Alt');
        if (e.shiftKey) mods.push('Shift');
        if (e.metaKey) mods.push('Meta');
        return mods.concat(e.code).join('+');
    }

    function comboToLabel(combo) {
        if (!combo) return '— выкл —';
        return combo.split('+').map(p => p.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '')).join(' + ');
    }

    function saveHotkey(action, combo) {
        hotkeys[action] = combo || '';
        localStorage.setItem('nekto_hotkey_' + action, hotkeys[action]);
        const btn = document.getElementById('nekto-hk-' + action);
        if (btn) { btn.innerText = comboToLabel(hotkeys[action]); btn.dataset.capturing = '0'; }
    }

    win.addEventListener('keydown', (e) => {
        // Режим захвата новой комбинации из настроек
        if (capturingHotkeyFor) {
            e.preventDefault(); e.stopPropagation();
            if (e.code === 'Escape') { // отмена
                const btn = document.getElementById('nekto-hk-' + capturingHotkeyFor);
                if (btn) { btn.innerText = comboToLabel(hotkeys[capturingHotkeyFor]); btn.dataset.capturing = '0'; }
                capturingHotkeyFor = null; return;
            }
            if (e.code === 'Backspace' || e.code === 'Delete') { // очистить (выключить хоткей)
                saveHotkey(capturingHotkeyFor, ''); capturingHotkeyFor = null; return;
            }
            const combo = eventToCombo(e);
            if (combo) { saveHotkey(capturingHotkeyFor, combo); capturingHotkeyFor = null; }
            return;
        }

        // Обычный режим: не срабатываем, когда человек печатает в поле ввода
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        const combo = eventToCombo(e);
        if (!combo) return;
        if (hotkeys.skip && combo === hotkeys.skip)       { e.preventDefault(); e.stopPropagation(); cmdSkip(); }
        else if (hotkeys.stop && combo === hotkeys.stop)  { e.preventDefault(); e.stopPropagation(); cmdStop(); }
        else if (hotkeys.start && combo === hotkeys.start){ e.preventDefault(); e.stopPropagation(); cmdStart(); }
    }, true);

    // ==========================================
    // ИНДИКАТОР ПИНГА (RTT через WebRTC getStats)
    // ==========================================
    // Голос на nekto.me идёт по RTCPeerConnection — перехватываем создание соединений
    // и раз в 2 секунды снимаем currentRoundTripTime у активной пары кандидатов.
    const activePeerConnections = new Set();
    if (win.RTCPeerConnection) {
        const OrigPC = win.RTCPeerConnection;
        const PatchedPC = function(...args) {
            const pc = new OrigPC(...args);
            activePeerConnections.add(pc);
            pc.addEventListener('connectionstatechange', () => {
                if (pc.connectionState === 'closed' || pc.connectionState === 'failed') activePeerConnections.delete(pc);
            });
            return pc;
        };
        PatchedPC.prototype = OrigPC.prototype;
        try { Object.setPrototypeOf(PatchedPC, OrigPC); } catch (e) {}
        // generateCertificate и прочая статика подтянется через прототип-цепочку
        win.RTCPeerConnection = PatchedPC;
        if (win.webkitRTCPeerConnection) win.webkitRTCPeerConnection = PatchedPC;
    }

    function initPingBadge() {
        if (document.getElementById('nekto-ping-badge')) return;
        const badge = document.createElement('div');
        badge.id = 'nekto-ping-badge';
        badge.className = 'nekto-ui-fab';
        badge.style.cssText = 'position: fixed; top: 20px; left: 20px; background: rgba(0,0,0,0.6); color: #fff; padding: 6px 12px; border-radius: 20px; font-family: Tahoma, Arial, sans-serif; font-size: 13px; z-index: 999998; display: none; align-items: center; gap: 6px; pointer-events: none; font-variant-numeric: tabular-nums;';
        badge.innerHTML = '📶 <span id="nekto-ping-value">—</span>';
        document.body.appendChild(badge);
    }

    async function updatePingBadge() {
        const badge = document.getElementById('nekto-ping-badge');
        if (!badge) return;
        if (!chatActive || !win.location.href.includes('/audiochat')) { badge.style.display = 'none'; return; }

        let rttMs = null;
        for (const pc of Array.from(activePeerConnections)) {
            if (pc.connectionState === 'closed') { activePeerConnections.delete(pc); continue; }
            try {
                const stats = await pc.getStats();
                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded' && (report.nominated || report.selected)) {
                        if (typeof report.currentRoundTripTime === 'number') {
                            const ms = Math.round(report.currentRoundTripTime * 1000);
                            if (rttMs === null || ms < rttMs) rttMs = ms;
                        }
                    }
                });
            } catch (e) {}
        }

        const valEl = document.getElementById('nekto-ping-value');
        badge.style.display = 'flex';
        if (rttMs === null) {
            valEl.innerText = '— мс';
            valEl.style.color = '#aaa';
        } else {
            valEl.innerText = rttMs + ' мс';
            valEl.style.color = rttMs < 80 ? '#4cd964' : (rttMs < 200 ? '#ffd60a' : '#ff5e5e');
        }
    }

    // ==========================================
    // ГОЛОСОВОЙ ДВИЖОК 1.0 (WATCHDOG СИСТЕМА)
    // ==========================================
    let recognitionEngine = null;
    let isEngineRunning = false;
    let lastVoiceActivity = Date.now();
    let lastRestartAttempt = 0;
    let engineSessionStart = 0;   // когда стартовала текущая живая сессия распознавания
    let lastStartCallTime = 0;    // когда мы последний раз вызывали .start()

    // Создаёт СВЕЖИЙ объект SpeechRecognition. Это важно: после того как сессия
    // "зависает" (частая беда Chrome примерно на 40-60 секунде continuous-режима),
    // повторный .start() на СТАРОМ объекте иногда не поднимает распознавание,
    // и onend может вообще не сработать. Поэтому чиним не переиспользованием,
    // а полной пересборкой движка.
    function createRecognitionEngine() {
        const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;
        if (!SpeechRecognition) return null;

        const engine = new SpeechRecognition();
        engine.continuous = true;
        engine.interimResults = true; // Возвращаем мгновенную реакцию
        engine.lang = 'ru-RU';

        engine.onstart = () => {
            isEngineRunning = true;
            lastVoiceActivity = Date.now();
            engineSessionStart = Date.now();
            console.log('[Голос] Движок слушает...');
        };

        engine.onend = () => {
            isEngineRunning = false;
            console.log('[Голос] Сессия завершена (onend)');
        };

        engine.onerror = (e) => {
            console.log('[Голос] Ошибка распознавания:', e.error);
            if (e.error === 'not-allowed') {
                lastRestartAttempt = Date.now() + 60000; // Пауза при запрете микрофона
            }
            isEngineRunning = false;
        };

        engine.onresult = (event) => {
            lastVoiceActivity = Date.now();
            if (actionTriggered) return;

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcript = event.results[i][0].transcript.toLowerCase();
                if (wordsSkip.some(w => transcript.includes(w))) { cmdSkip(); break; }
                else if (wordsStop.some(w => transcript.includes(w))) { cmdStop(); break; }
                else if (wordsStart.some(w => transcript.includes(w))) { cmdStart(); break; }
            }
        };

        return engine;
    }

    function startEngine() {
        if (!recognitionEngine) return;
        lastStartCallTime = Date.now();
        try {
            recognitionEngine.start();
        } catch (e) {
            // InvalidStateError и т.п. обычно значит "движок в непонятном состоянии" —
            // не пытаемся чинить его самого, просто пересобираем целиком.
            console.log('[Голос] start() упал, пересобираю движок:', e.message);
            recreateEngine();
        }
    }

    function recreateEngine() {
        if (recognitionEngine) {
            try {
                recognitionEngine.onstart = null;
                recognitionEngine.onend = null;
                recognitionEngine.onerror = null;
                recognitionEngine.onresult = null;
                recognitionEngine.abort();
            } catch (e) {}
        }
        isEngineRunning = false;
        recognitionEngine = createRecognitionEngine();
        startEngine();
    }

    function initVoiceEngine() {
        recognitionEngine = createRecognitionEngine();
        if (!recognitionEngine) { console.log('[Голос] SpeechRecognition не поддерживается в этом браузере'); return; }
        startEngine();
    }

    // ==========================================
    // ГЛАВНЫЙ МОНИТОРИНГ И WATCHDOG
    // ==========================================
    setInterval(() => {
        updateWaveformPlacement();
        updateMuteControlsPlacement();
        if (!win.location.href.includes('/audiochat')) return;
        
        // shadow volume control: звук собеседника теперь всегда идёт через remotePitchGain
        // (с учётом питча), поэтому родной <audio> с собеседником держим навсегда приглушённым,
        // а реальную громкость/заглушку регулируем через сам gain-узел.
        document.querySelectorAll('audio, video').forEach(media => {
            try { media.volume = media.srcObject ? 0 : notificationVolume; } catch(e) {}
        });
        if (remotePitchGain) { try { remotePitchGain.gain.value = companionMuted ? 0 : chatVolume; } catch(e) {} }

        // Детектор чата
        let hasStopButton = !!(document.querySelector('button.callScreen__cancelCallBtn') || document.querySelector('button.stop-talk-button'));
        if (hasStopButton !== chatActive) {
            chatActive = hasStopButton;
            if (chatActive) {
                chatStartTime = Date.now();
                weInitiatedSkip = false;
                // Каждый новый диалог начинается с обычным звуком: собеседник слышен, микрофон включён.
                companionMuted = false; micMuted = false;
                applyMuteStates(); updateMuteButtonsUI();
            } else {
                let duration = (Date.now() - chatStartTime) / 1000;
                if (duration > 1.5) {
                    dialogueHistory.push({ duration: Math.round(duration), timestamp: Date.now() });
                    if (dialogueHistory.length > 5000) dialogueHistory.shift();
                    localStorage.setItem('nekto_dialogue_history', JSON.stringify(dialogueHistory));
                }

                if (autoStartActive && !weInitiatedSkip) {
                    setTimeout(doStart, 100);
                }

                // Диалог закончился — глушим анализатор волны, чтобы не тянуть мёртвый стрим
                if (remoteAudioCtx) { try { remoteAudioCtx.close(); } catch (e) {} remoteAudioCtx = null; remoteAnalyser = null; remotePitchGain = null; remotePitchNode = null; remoteEffectNodes = []; }
            }
        }

        // WATCHDOG 1: Воскрешение уснувшего микрофона (движок сам сообщил, что не работает)
        if (!isEngineRunning && recognitionEngine) {
            if (Date.now() - lastRestartAttempt > 1500) {
                lastRestartAttempt = Date.now();
                startEngine();
            }
        }

        // WATCHDOG 2: Анти-Зависание. Если давно не было ни одного результата, ПОЛНОСТЬЮ
        // пересобираем движок (не просто abort() на старом объекте) — именно "мягкий" abort
        // на одном и том же экземпляре и был причиной того, что распознавание намертво
        // замолкало через минуту и не восстанавливалось.
        if (isEngineRunning && recognitionEngine) {
            if (Date.now() - lastVoiceActivity > 20000) { // Если не было активности 20 секунд
                console.log('[Голос] Долгая тишина — пересобираю движок');
                recreateEngine();
            }
        }

        // WATCHDOG 3: Профилактическое обновление сессии. Chrome обычно "тихо" убивает
        // continuous-сессию распознавания около 55-60 секунды без явной ошибки. Пересобираем
        // движок заранее, не дожидаясь этого зависания.
        if (isEngineRunning && recognitionEngine && engineSessionStart > 0) {
            if (Date.now() - engineSessionStart > 50000) {
                console.log('[Голос] Профилактическое обновление сессии (50с)');
                recreateEngine();
            }
        }

        // WATCHDOG 4: Страховка от "зомби"-состояния. Если .start() был вызван, но движок
        // так и не сообщил ни о старте, ни об ошибке (изредка бывает после сбоя разрешения
        // микрофона) — считаем его мёртвым и пересобираем.
        if (!isEngineRunning && recognitionEngine && lastStartCallTime > 0) {
            if (Date.now() - lastStartCallTime > 8000 && Date.now() - lastRestartAttempt > 1500) {
                lastRestartAttempt = Date.now();
                recreateEngine();
            }
        }

        if (chatActive && talkTimeLimit > 0) {
            let secondsPassed = (Date.now() - chatStartTime) / 1000;
            if (secondsPassed >= talkTimeLimit) cmdSkip();
        }
    }, 500);

    // ==========================================
    // ИНТЕРФЕЙС
    // ==========================================
    function formatSeconds(sec) {
        let h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
        let res = []; if(h>0) res.push(h+' ч'); if(m>0) res.push(m+' мин'); if(s>0||res.length===0) res.push(s+' сек');
        return res.join(' ');
    }
    function parseTimeToSeconds(str) {
        str = str.trim().toLowerCase(); if (/^\d+$/.test(str)) return parseInt(str);
        let s = 0, h = str.match(/(\d+)\s*(h|ч)/), m = str.match(/(\d+)\s*(m|м)/), sm = str.match(/(\d+)\s*(s|с)/);
        if(h) s+=parseInt(h[1])*3600; if(m) s+=parseInt(m[1])*60; if(sm) s+=parseInt(sm[1]); return s||36000;
    }
    function getMinutePlural(n) {
        if (n===0) return 'Менее 1 мин'; let n1=n%10, n2=n%100;
        if(n1===1&&n2!==11) return n+' минута'; if(n1>=2&&n1<=4&&(n2<10||n2>=20)) return n+' минуты'; return n+' минут';
    }

    const RU_MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    function dateKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
    function formatDateRu(ts) { const d = new Date(ts); return d.getDate() + ' ' + RU_MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }

    // ==========================================
    // ТЕМЫ ИНТЕРФЕЙСА СКРИПТА (панели/кнопки самого скрипта, не сайта)
    // ==========================================
    // Каждая тема — не сплошная заливка, а градиент + едва заметный фон из эмодзи в тон.
    function emojiPatternURL(emojiStr) {
        const em = Array.from(emojiStr || '');
        if (!em.length) return '';
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="130" height="130">' +
            '<text x="8"  y="32"  font-size="22" opacity="0.12">' + (em[0] || '') + '</text>' +
            '<text x="74" y="58"  font-size="20" opacity="0.10" transform="rotate(18 84 52)">' + (em[1] || em[0] || '') + '</text>' +
            '<text x="22" y="96"  font-size="21" opacity="0.11" transform="rotate(-14 30 90)">' + (em[2] || em[0] || '') + '</text>' +
            '<text x="86" y="116" font-size="19" opacity="0.10">' + (em[3] || em[1] || em[0] || '') + '</text>' +
            '</svg>';
        return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
    }

    const UI_THEMES = [
        { id: 'dark',   name: 'Тёмная классика', sq: '#2b2b2b', text: '#ffffff', inputBg: '#1e1e1e', accent: '#17a2b8', border: '#555',   grad: 'linear-gradient(160deg, #2b2b2b, #242424)', emoji: '' },
        { id: 'light',  name: 'Светлая',          sq: '#e9e9e9', text: '#222222', inputBg: '#ffffff', accent: '#0d6efd', border: '#bbb',   grad: 'linear-gradient(160deg, #f4f4f4, #e6e6e6)', emoji: '' },
        { id: 'lime',   name: 'Лаймовая',         sq: '#2ecc71', text: '#dcffe6', inputBg: '#0b1f12', accent: '#2ecc71', border: '#1f6e40', grad: 'linear-gradient(160deg, #0e2818, #123a1e 60%, #0d2f17)', emoji: '🥝🍀🐸🌿' },
        { id: 'ocean',  name: 'Океан',            sq: '#3498db', text: '#dff1ff', inputBg: '#081826', accent: '#39a7ff', border: '#1d5a8a', grad: 'linear-gradient(160deg, #0a1e30, #0e2c46 60%, #0a2338)', emoji: '🌊🐬🐳💧' },
        { id: 'violet', name: 'Неоновый фиолет',  sq: '#9b59b6', text: '#f2e4ff', inputBg: '#170a24', accent: '#c084fc', border: '#5b2b82', grad: 'linear-gradient(160deg, #1c0e2e, #2a1246 60%, #200f38)', emoji: '🔮🪄👾💜' },
        { id: 'rose',   name: 'Розовая',          sq: '#e91e8c', text: '#ffe4f2', inputBg: '#24091a', accent: '#ff6bb5', border: '#8a2560', grad: 'linear-gradient(160deg, #2c0c1e, #43122e 60%, #340d24)', emoji: '🌸🦩💗🎀' },
        { id: 'sunset', name: 'Закат',            sq: '#e67e22', text: '#ffeede', inputBg: '#241104', accent: '#ff9f43', border: '#8a4a15', grad: 'linear-gradient(160deg, #2c1506, #46220a 60%, #35190a)', emoji: '🍊🌅🦊🔥' },
        { id: 'berry',  name: 'Ягодная',          sq: '#e74c3c', text: '#ffe3e0', inputBg: '#240808', accent: '#ff6b5e', border: '#8a2721', grad: 'linear-gradient(160deg, #2b0b0b, #451212 60%, #340e0e)', emoji: '🍓🍒🍉❤️' },
        { id: 'mint',   name: 'Бирюзовая',        sq: '#1abc9c', text: '#dcfff7', inputBg: '#07201b', accent: '#2fe0bd', border: '#166e5c', grad: 'linear-gradient(160deg, #082621, #0d3a32 60%, #0a2e28)', emoji: '🐢🍃🫧🌴' },
        { id: 'honey',  name: 'Медовая',          sq: '#f1c40f', text: '#fff6d6', inputBg: '#241d04', accent: '#ffd93d', border: '#8a7415', grad: 'linear-gradient(160deg, #2a2206, #443a0c 60%, #332b08)', emoji: '🍯🐝🌻✨' }
    ];

    function applyUITheme(themeId) {
        const t = UI_THEMES.find(x => x.id === themeId) || UI_THEMES[0];
        uiTheme = t.id;
        localStorage.setItem('nekto_ui_theme', t.id);
        let styleEl = document.getElementById('nekto-ui-theme-style');
        if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'nekto-ui-theme-style'; document.head.appendChild(styleEl); }
        const pattern = emojiPatternURL(t.emoji);
        const bg = (pattern ? pattern + ', ' : '') + t.grad;
        styleEl.textContent = `
            .nekto-ui-panel { background: ${bg} !important; color: ${t.text} !important; }
            .nekto-ui-panel h3 { border-color: ${t.border} !important; color: ${t.text} !important; }
            .nekto-ui-panel input[type="text"], .nekto-ui-panel input[type="number"], .nekto-ui-panel select {
                background: ${t.inputBg} !important; color: ${t.text} !important; border-color: ${t.border} !important;
            }
            .nekto-ui-panel input[type="range"] { accent-color: ${t.accent} !important; }
            .nekto-ui-panel div[style*="background:#1e1e1e"], .nekto-ui-panel div[style*="background: #1e1e1e"] { background: ${t.inputBg} !important; color: ${t.text} !important; }
            .nekto-ui-fab { background: ${t.id === 'light' ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.6)'} !important; box-shadow: 0 0 0 2px ${t.accent}33 !important; }
            .nekto-theme-sq { transition: transform 0.12s, box-shadow 0.12s; }
            .nekto-theme-sq:hover { transform: scale(1.12); }
            .nekto-theme-sq.selected { box-shadow: 0 0 0 2px #fff, 0 0 8px ${t.accent} !important; }
        `;
        // Обновить рамки выбранного квадратика
        document.querySelectorAll('.nekto-theme-sq[data-kind="ui"]').forEach(sq => {
            sq.classList.toggle('selected', sq.dataset.theme === t.id);
        });
    }

    // ==========================================
    // ТЕМЫ ОКОН ИГР (рамка/шапка окна, не содержимое игры)
    // ==========================================
    const GAME_THEMES = [
        { id: 'win98',   name: 'Win98',        sq: 'linear-gradient(180deg,#1084d0,#000080)', css: '' /* базовый inline-стиль окон и есть Win98 */ },
        { id: 'macos',   name: 'macOS',        sq: 'linear-gradient(180deg,#f5f5f5,#d8d8d8)', css: `
            .nekto-game-win { background: #ececec !important; border: 1px solid #b6b6b6 !important; border-radius: 12px !important; box-shadow: 0 14px 40px rgba(0,0,0,0.35) !important; }
            .nekto-game-titlebar { background: linear-gradient(180deg, #f2f2f2, #dcdcdc) !important; color: #333 !important; border-radius: 11px 11px 0 0 !important; padding: 5px 8px !important; }
            .nekto-game-close { background: #ff5f57 !important; border: 1px solid #e0443e !important; border-radius: 50% !important; width: 14px !important; height: 14px !important; color: transparent !important; }
            .nekto-game-close:hover { color: #7a0000 !important; font-size: 9px !important; line-height: 11px !important; }
            .nekto-game-content { border: 1px solid #c8c8c8 !important; border-radius: 0 0 10px 10px !important; margin: 0 4px 4px 4px !important; }
        ` },
        { id: 'macdark', name: 'macOS Dark',   sq: 'linear-gradient(180deg,#4a4a4c,#2c2c2e)', css: `
            .nekto-game-win { background: #2c2c2e !important; border: 1px solid #48484a !important; border-radius: 12px !important; box-shadow: 0 14px 40px rgba(0,0,0,0.6) !important; }
            .nekto-game-titlebar { background: linear-gradient(180deg, #3a3a3c, #2c2c2e) !important; color: #e5e5e7 !important; border-radius: 11px 11px 0 0 !important; padding: 5px 8px !important; }
            .nekto-game-close { background: #ff5f57 !important; border: 1px solid #e0443e !important; border-radius: 50% !important; width: 14px !important; height: 14px !important; color: transparent !important; }
            .nekto-game-close:hover { color: #7a0000 !important; font-size: 9px !important; line-height: 11px !important; }
            .nekto-game-content { border: 1px solid #48484a !important; border-radius: 0 0 10px 10px !important; margin: 0 4px 4px 4px !important; }
        ` },
        { id: 'neon',    name: 'Неон',         sq: 'linear-gradient(135deg,#0ff,#f0f)', css: `
            .nekto-game-win { background: #07070f !important; border: 1px solid #00e5ff !important; border-radius: 10px !important; box-shadow: 0 0 12px rgba(0,229,255,0.55), 0 0 28px rgba(255,0,229,0.25), inset 0 0 8px rgba(0,229,255,0.12) !important; }
            .nekto-game-titlebar { background: linear-gradient(90deg, #001a22, #1a0022) !important; color: #00e5ff !important; text-shadow: 0 0 6px rgba(0,229,255,0.8) !important; border-radius: 9px 9px 0 0 !important; }
            .nekto-game-close { background: #07070f !important; border: 1px solid #ff2fd6 !important; border-radius: 4px !important; color: #ff2fd6 !important; text-shadow: 0 0 5px rgba(255,47,214,0.9) !important; }
            .nekto-game-content { border: 1px solid #133 !important; margin: 3px !important; border-radius: 0 0 8px 8px !important; }
        ` },
        { id: 'terminal', name: 'Терминал',    sq: 'linear-gradient(180deg,#003300,#000)', css: `
            .nekto-game-win { background: #000 !important; border: 1px solid #00cc44 !important; border-radius: 6px !important; box-shadow: 0 0 10px rgba(0,204,68,0.4) !important; font-family: 'Courier New', monospace !important; }
            .nekto-game-titlebar { background: #001a06 !important; color: #00ff55 !important; font-family: 'Courier New', monospace !important; border-radius: 5px 5px 0 0 !important; }
            .nekto-game-close { background: #000 !important; border: 1px solid #00cc44 !important; color: #00ff55 !important; border-radius: 3px !important; }
            .nekto-game-content { border: 1px solid #003311 !important; margin: 3px !important; }
        ` },
        { id: 'vapor',   name: 'Vaporwave',    sq: 'linear-gradient(135deg,#ff71ce,#7873f5)', css: `
            .nekto-game-win { background: linear-gradient(160deg, #1b0f33, #2c1050) !important; border: 2px solid #ff71ce !important; border-radius: 12px !important; box-shadow: 0 10px 30px rgba(120,115,245,0.45) !important; }
            .nekto-game-titlebar { background: linear-gradient(90deg, #ff71ce, #7873f5) !important; color: #fff !important; border-radius: 9px 9px 0 0 !important; }
            .nekto-game-close { background: rgba(255,255,255,0.2) !important; border: 1px solid #fff !important; color: #fff !important; border-radius: 6px !important; }
            .nekto-game-content { border: 1px solid #7873f5 !important; margin: 3px !important; border-radius: 0 0 9px 9px !important; }
        ` }
    ];

    function applyGameTheme(themeId) {
        const t = GAME_THEMES.find(x => x.id === themeId) || GAME_THEMES[0];
        gameTheme = t.id;
        localStorage.setItem('nekto_game_theme', t.id);
        let styleEl = document.getElementById('nekto-game-theme-style');
        if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'nekto-game-theme-style'; document.head.appendChild(styleEl); }
        styleEl.textContent = t.css; // пустой для win98 — остаются исходные inline-стили окна
        document.querySelectorAll('.nekto-theme-sq[data-kind="game"]').forEach(sq => {
            sq.classList.toggle('selected', sq.dataset.theme === t.id);
        });
    }

    function buildThemeSquares(kind, themes, currentId, onPick) {
        return themes.map(t =>
            `<div class="nekto-theme-sq${t.id === currentId ? ' selected' : ''}" data-kind="${kind}" data-theme="${t.id}" title="${t.name}"` +
            ` style="width:28px; height:28px; border-radius:7px; cursor:pointer; background:${t.sq}; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.25);"></div>`
        ).join('');
    }

    function buildUIPanels() {
        if (document.getElementById('nekto-buttons-bar')) return;

        const btnContainer = document.createElement('div');
        btnContainer.id = 'nekto-buttons-bar';
        btnContainer.style.cssText = 'position: fixed; bottom: 20px; left: 20px; display: flex; gap: 15px; z-index: 999998;';
        
        const gear = document.createElement('div'); gear.innerHTML = '⚙️'; gear.style.cssText = 'width: 45px; height: 45px; font-size: 28px; cursor: pointer; background: rgba(0,0,0,0.6); border-radius: 50%; display: flex; justify-content: center; align-items: center; transition: 0.3s; user-select: none;';
        const effectsBtn = document.createElement('div'); effectsBtn.innerHTML = '🎛️'; effectsBtn.style.cssText = 'width: 45px; height: 45px; font-size: 24px; cursor: pointer; background: rgba(0,0,0,0.6); border-radius: 50%; display: flex; justify-content: center; align-items: center; transition: 0.3s; user-select: none;';
        const timerBtn = document.createElement('div'); timerBtn.innerHTML = '⏱️'; timerBtn.style.cssText = 'width: 45px; height: 45px; font-size: 24px; cursor: pointer; background: rgba(0,0,0,0.6); border-radius: 50%; display: flex; justify-content: center; align-items: center; transition: 0.3s; user-select: none;';
        const statsBtn = document.createElement('div'); statsBtn.innerHTML = '📊'; statsBtn.style.cssText = 'width: 45px; height: 45px; font-size: 24px; cursor: pointer; background: rgba(0,0,0,0.6); border-radius: 50%; display: flex; justify-content: center; align-items: center; transition: 0.3s; user-select: none;';
        
        gear.classList.add('nekto-ui-fab'); effectsBtn.classList.add('nekto-ui-fab'); timerBtn.classList.add('nekto-ui-fab'); statsBtn.classList.add('nekto-ui-fab');
        btnContainer.appendChild(gear); btnContainer.appendChild(effectsBtn); btnContainer.appendChild(timerBtn); btnContainer.appendChild(statsBtn); document.body.appendChild(btnContainer);


        const modalWords = document.createElement('div');
        modalWords.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #2b2b2b; color: #fff; padding: 25px; border-radius: 12px; z-index: 999999; display: none; flex-direction: column; gap: 10px; min-width: 320px; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.7); font-family: sans-serif;`;
        modalWords.innerHTML = `
            <h3 style="margin:0 0 5px 0; border-bottom:1px solid #555; padding-bottom:5px;">Настройки</h3>
            <label style="display:flex; flex-direction:column; gap:3px; font-size: 13px;">Слова СКИПА: <input type="text" id="nekto-inp-skip" style="padding:6px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff;"></label>
            <label style="display:flex; flex-direction:column; gap:3px; font-size: 13px;">Слова СТОПА: <input type="text" id="nekto-inp-stop" style="padding:6px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff;"></label>
            <label style="display:flex; flex-direction:column; gap:3px; font-size: 13px;">Слова СТАРТА: <input type="text" id="nekto-inp-start" style="padding:6px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff;"></label>
            <div style="border-top: 1px solid #555; margin: 3px 0; padding-top: 3px;"></div>
            <label style="display:flex; align-items:center; gap:8px; font-size: 13px; user-select:none; cursor:pointer; margin-bottom:5px;">
                <input type="checkbox" id="nekto-inp-auto-start" ${autoStartActive ? 'checked' : ''} style="width:14px; height:14px; cursor:pointer;"> Автоначало диалога
            </label>
            <label style="display:flex; flex-direction:column; gap:3px; font-size: 13px;">
                Громкость чата: <span id="nekto-chat-vol-val" style="color:#17a2b8; font-weight:bold;">${Math.round(chatVolume * 100)}%</span>
                <input type="range" id="nekto-inp-chat-vol" min="0" max="1" step="0.05" value="${chatVolume}" style="accent-color:#000080; height:5px; cursor:pointer;">
            </label>
            <label style="display:flex; flex-direction:column; gap:3px; font-size: 13px;">
                Громкость оповещений: <span id="nekto-notif-vol-val" style="color:#e0a800; font-weight:bold;">${Math.round(notificationVolume * 100)}%</span>
                <input type="range" id="nekto-inp-notif-vol" min="0" max="1" step="0.05" value="${notificationVolume}" style="accent-color:#000080; height:5px; cursor:pointer;">
            </label>
            <label style="display:flex; align-items:center; gap:8px; font-size: 13px; user-select:none; cursor:pointer;">
                <input type="checkbox" id="nekto-inp-self-listen" ${selfListeningActive ? 'checked' : ''} style="width:14px; height:14px; cursor:pointer;"> Самопрослушивание
            </label>
            <label style="display:flex; flex-direction:column; gap:3px; font-size: 13px;">
                Усиление микрофона: <span id="nekto-mic-gain-val" style="color:#28a745; font-weight:bold;">${micGainValue.toFixed(1)}x</span>
                <input type="range" id="nekto-inp-mic-gain" min="0.1" max="4.0" step="0.1" value="${micGainValue}" style="accent-color:#000080; height:5px; cursor:pointer;">
            </label>
            <label style="display:flex; flex-direction:column; gap:3px; font-size: 13px;">
                Питч собеседника: <span id="nekto-pitch-val" style="color:#e83e8c; font-weight:bold;">${companionPitch === 1 ? 'обычный' : (companionPitch > 1 ? 'выше' : 'ниже') + ' (' + companionPitch.toFixed(2) + 'x)'}</span>
                <input type="range" id="nekto-inp-pitch" min="0.5" max="2.0" step="0.05" value="${companionPitch}" style="accent-color:#e83e8c; height:5px; cursor:pointer;">
                <span style="font-size:11px; color:#888;">Меняет и высоту, и скорость голоса собеседника вместе (как перемотка кассеты)</span>
            </label>
            <div style="border-top: 1px solid #555; margin: 3px 0; padding-top: 3px;"></div>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">Макс. время общения с одним человеком (сек, 0 = без лимита): <input type="number" id="nekto-inp-talk" value="${talkTimeLimit}" style="padding:8px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff;"></label>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">Пауза перед поиском следующего (сек): <input type="number" step="0.1" id="nekto-inp-cool" value="${cooldownTime}" style="padding:8px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff;"></label>
            <div style="border-top: 1px solid #555; margin: 3px 0; padding-top: 3px;"></div>
            <div style="font-size:13px; font-weight:bold;">⌨️ Горячие клавиши</div>
            <div style="display:flex; flex-direction:column; gap:6px; font-size:13px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">Скип: <button id="nekto-hk-skip" data-capturing="0" style="min-width:120px; padding:5px 10px; cursor:pointer; background:#444; color:#fff; border:1px solid #666; border-radius:6px;"></button></div>
                <div style="display:flex; justify-content:space-between; align-items:center;">Стоп: <button id="nekto-hk-stop" data-capturing="0" style="min-width:120px; padding:5px 10px; cursor:pointer; background:#444; color:#fff; border:1px solid #666; border-radius:6px;"></button></div>
                <div style="display:flex; justify-content:space-between; align-items:center;">Старт: <button id="nekto-hk-start" data-capturing="0" style="min-width:120px; padding:5px 10px; cursor:pointer; background:#444; color:#fff; border:1px solid #666; border-radius:6px;"></button></div>
            </div>
            <span style="font-size:11px; color:#888;">Клик по кнопке → нажми новую комбинацию. Esc — отмена, Backspace — отключить хоткей. Работает, пока вкладка Nekto.me активна: при свёрнутом браузере страница не получает нажатия клавиш — это ограничение самих браузеров (глобальные хоткеи возможны только внешними средствами вроде AutoHotkey).</span>
            <div style="border-top: 1px solid #555; margin: 3px 0; padding-top: 3px;"></div>
            <div style="font-size:13px; font-weight:bold;">🎨 Тема интерфейса скрипта</div>
            <div id="nekto-ui-theme-squares" style="display:flex; flex-wrap:wrap; gap:8px;"></div>
            <div style="font-size:13px; font-weight:bold; margin-top:4px;">🕹️ Тема окон игр</div>
            <div id="nekto-game-theme-squares" style="display:flex; flex-wrap:wrap; gap:8px;"></div>
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:10px;">
                <button id="nekto-btn-w-cancel" style="padding:6px 12px; cursor:pointer; background:#555; color:#fff; border:none; border-radius:6px;">Отмена</button>
                <button id="nekto-btn-w-save" style="padding:6px 12px; cursor:pointer; background:#28a745; color:#fff; border:none; border-radius:6px;">Сохранить</button>
            </div>
        `;
        document.body.appendChild(modalWords);
        modalWords.classList.add('nekto-ui-panel');

        // --- Горячие клавиши: кнопки переназначения ---
        ['skip', 'stop', 'start'].forEach(action => {
            const btn = document.getElementById('nekto-hk-' + action);
            btn.innerText = comboToLabel(hotkeys[action]);
            btn.onclick = () => {
                // Если уже ловили другую кнопку — вернём ей старый текст
                if (capturingHotkeyFor && capturingHotkeyFor !== action) {
                    const prev = document.getElementById('nekto-hk-' + capturingHotkeyFor);
                    if (prev) { prev.innerText = comboToLabel(hotkeys[capturingHotkeyFor]); prev.dataset.capturing = '0'; }
                }
                capturingHotkeyFor = action;
                btn.innerText = 'Нажми клавиши…';
                btn.dataset.capturing = '1';
            };
        });

        // --- Квадратики тем ---
        const uiSqBox = document.getElementById('nekto-ui-theme-squares');
        uiSqBox.innerHTML = buildThemeSquares('ui', UI_THEMES, uiTheme);
        uiSqBox.querySelectorAll('.nekto-theme-sq').forEach(sq => { sq.onclick = () => applyUITheme(sq.dataset.theme); });

        const gameSqBox = document.getElementById('nekto-game-theme-squares');
        gameSqBox.innerHTML = buildThemeSquares('game', GAME_THEMES, gameTheme);
        gameSqBox.querySelectorAll('.nekto-theme-sq').forEach(sq => { sq.onclick = () => applyGameTheme(sq.dataset.theme); });

        const EFFECT_OPTIONS_HTML = EFFECT_LIST.map(fx => `<option value="${fx.id}">${fx.label}</option>`).join('');
        const modalEffects = document.createElement('div');
        modalEffects.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #2b2b2b; color: #fff; padding: 25px; border-radius: 12px; z-index: 999999; display: none; flex-direction: column; gap: 14px; min-width: 320px; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.7); font-family: sans-serif;`;
        modalEffects.innerHTML = `
            <h3 style="margin:0 0 5px 0; border-bottom:1px solid #555; padding-bottom:5px;">Эффекты голоса</h3>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">
                Эффект для голоса собеседника:
                <select id="nekto-sel-companion-effect" style="padding:8px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff; font-size:14px;">${EFFECT_OPTIONS_HTML}</select>
            </label>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">
                Эффект для своего микрофона:
                <select id="nekto-sel-mic-effect" style="padding:8px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff; font-size:14px;">${EFFECT_OPTIONS_HTML}</select>
            </label>
            <span style="font-size:11px; color:#888;">Применяется мгновенно, даже во время звонка. Сохраняется между диалогами (в отличие от заглушек).</span>
            <div style="display:flex; justify-content:flex-end; margin-top:6px;">
                <button id="nekto-btn-fx-close" style="padding:6px 12px; cursor:pointer; background:#555; color:#fff; border:none; border-radius:6px;">Закрыть</button>
            </div>
        `;
        document.body.appendChild(modalEffects);
        modalEffects.classList.add('nekto-ui-panel');

        const selCompanionEffect = document.getElementById('nekto-sel-companion-effect');
        const selMicEffect = document.getElementById('nekto-sel-mic-effect');
        selCompanionEffect.value = companionEffect; selMicEffect.value = micEffect;
        selCompanionEffect.onchange = () => applyRemoteEffect(selCompanionEffect.value);
        selMicEffect.onchange = () => applyLocalEffect(selMicEffect.value);

        effectsBtn.onclick = () => { selCompanionEffect.value = companionEffect; selMicEffect.value = micEffect; modalEffects.style.display = 'flex'; };
        document.getElementById('nekto-btn-fx-close').onclick = () => { modalEffects.style.display = 'none'; };

        const chatVolInp = document.getElementById('nekto-inp-chat-vol'), chatVolVal = document.getElementById('nekto-chat-vol-val');
        const micGainInp = document.getElementById('nekto-inp-mic-gain'), micGainVal = document.getElementById('nekto-mic-gain-val');
        const notifVolInp = document.getElementById('nekto-inp-notif-vol'), notifVolVal = document.getElementById('nekto-notif-vol-val');

        chatVolInp.oninput = e => { chatVolume = parseFloat(e.target.value); chatVolVal.innerText = Math.round(chatVolume * 100) + '%'; localStorage.setItem('nekto_volume', chatVolume); };
        notifVolInp.oninput = e => { notificationVolume = parseFloat(e.target.value); notifVolVal.innerText = Math.round(notificationVolume * 100) + '%'; localStorage.setItem('nekto_notification_volume', notificationVolume); };
        document.getElementById('nekto-inp-auto-start').onchange = e => { autoStartActive = e.target.checked; localStorage.setItem('nekto_auto_start', autoStartActive); };
        document.getElementById('nekto-inp-self-listen').onchange = e => { selfListeningActive = e.target.checked; localStorage.setItem('nekto_self_listening', selfListeningActive); updateMicSettings(); };
        micGainInp.oninput = e => { micGainValue = parseFloat(e.target.value); micGainVal.innerText = micGainValue.toFixed(1) + 'x'; localStorage.setItem('nekto_mic_gain', micGainValue); updateMicSettings(); };

        const pitchInp = document.getElementById('nekto-inp-pitch'), pitchVal = document.getElementById('nekto-pitch-val');
        pitchInp.oninput = e => {
            companionPitch = parseFloat(e.target.value);
            pitchVal.innerText = companionPitch === 1 ? 'обычный' : (companionPitch > 1 ? 'выше' : 'ниже') + ' (' + companionPitch.toFixed(2) + 'x)';
            localStorage.setItem('nekto_companion_pitch', companionPitch);
        };

        gear.onclick = () => { document.getElementById('nekto-inp-skip').value = wordsSkip.join(', '); document.getElementById('nekto-inp-stop').value = wordsStop.join(', '); document.getElementById('nekto-inp-start').value = wordsStart.join(', '); document.getElementById('nekto-inp-talk').value = talkTimeLimit; document.getElementById('nekto-inp-cool').value = cooldownTime; modalWords.style.display = 'flex'; };
        document.getElementById('nekto-btn-w-cancel').onclick = () => { modalWords.style.display = 'none'; };
        document.getElementById('nekto-btn-w-save').onclick = () => {
            localStorage.setItem('nekto_words_skip', document.getElementById('nekto-inp-skip').value); localStorage.setItem('nekto_words_stop', document.getElementById('nekto-inp-stop').value); localStorage.setItem('nekto_words_start', document.getElementById('nekto-inp-start').value);
            wordsSkip = document.getElementById('nekto-inp-skip').value.split(',').map(s=>s.trim().toLowerCase()).filter(s=>s); wordsStop = document.getElementById('nekto-inp-stop').value.split(',').map(s=>s.trim().toLowerCase()).filter(s=>s); wordsStart = document.getElementById('nekto-inp-start').value.split(',').map(s=>s.trim().toLowerCase()).filter(s=>s);
            talkTimeLimit = parseInt(document.getElementById('nekto-inp-talk').value) || 0; cooldownTime = parseFloat(document.getElementById('nekto-inp-cool').value) || 1.5;
            localStorage.setItem('nekto_talk_time', talkTimeLimit); localStorage.setItem('nekto_cooldown_time', cooldownTime);
            modalWords.style.display = 'none';
        };

        const modalTimer = document.createElement('div');
        modalTimer.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #2b2b2b; color: #fff; padding: 25px; border-radius: 12px; z-index: 999999; display: none; flex-direction: column; gap: 12px; min-width: 340px; box-shadow: 0 10px 30px rgba(0,0,0,0.7); font-family: sans-serif;`;
        modalTimer.innerHTML = `
            <h3 style="margin:0 0 5px 0; border-bottom:1px solid #555; padding-bottom:8px;">Таймер доступа к Nekto.me</h3>
            <div id="nekto-access-status" style="font-size:13px; color:#aaa; background:#1e1e1e; padding:8px; border-radius:6px;"></div>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">Сколько минут можно сидеть на Nekto.me: <input type="number" min="1" id="nekto-inp-access-session" value="${accessSessionMin}" style="padding:8px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff;"></label>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">На сколько минут заблокировать доступ после этого: <input type="number" min="1" id="nekto-inp-access-cooldown" value="${accessCooldownMin}" style="padding:8px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff;"></label>
            <span style="font-size:11px; color:#888;">Таймер переживает обновление и закрытие страницы — отсчёт идёт по реальному времени, а не по открытой вкладке.</span>
            <div style="display:flex; justify-content:space-between; gap:10px; margin-top:8px;">
                <button id="nekto-btn-access-cancel-timer" style="padding:8px 12px; cursor:pointer; background:#d9534f; color:#fff; border:none; border-radius:6px; display:none;">Отменить таймер</button>
                <div style="display:flex; gap:10px; margin-left:auto;">
                    <button id="nekto-btn-t-cancel" style="padding:8px 15px; cursor:pointer; background:#555; color:#fff; border:none; border-radius:6px;">Закрыть</button>
                    <button id="nekto-btn-t-save" style="padding:8px 15px; cursor:pointer; background:#28a745; color:#fff; border:none; border-radius:6px;">Начать</button>
                </div>
            </div>
        `;
        document.body.appendChild(modalTimer);
        modalTimer.classList.add('nekto-ui-panel');

        timerBtn.onclick = () => {
            document.getElementById('nekto-inp-access-session').value = accessSessionMin;
            document.getElementById('nekto-inp-access-cooldown').value = accessCooldownMin;
            const now = Date.now();
            const sessionEnd = parseInt(safeGetLocalStorage('nekto_access_session_end', '0')) || 0;
            const cooldownEnd = parseInt(safeGetLocalStorage('nekto_access_cooldown_end', '0')) || 0;
            const statusEl = document.getElementById('nekto-access-status');
            const cancelBtn = document.getElementById('nekto-btn-access-cancel-timer');
            if (cooldownEnd && now < cooldownEnd) { statusEl.innerText = 'Сейчас идёт блокировка, осталось: ' + formatMMSS(cooldownEnd - now); cancelBtn.style.display = 'inline-block'; }
            else if (sessionEnd && now < sessionEnd) { statusEl.innerText = 'Сессия уже идёт, осталось: ' + formatMMSS(sessionEnd - now); cancelBtn.style.display = 'inline-block'; }
            else { statusEl.innerText = 'Таймер сейчас не запущен.'; cancelBtn.style.display = 'none'; }
            modalTimer.style.display = 'flex';
        };
        document.getElementById('nekto-btn-t-cancel').onclick = () => { modalTimer.style.display = 'none'; };
        document.getElementById('nekto-btn-t-save').onclick = () => {
            accessSessionMin = parseFloat(document.getElementById('nekto-inp-access-session').value) || 60;
            accessCooldownMin = parseFloat(document.getElementById('nekto-inp-access-cooldown').value) || 30;
            localStorage.setItem('nekto_access_session_min', accessSessionMin);
            localStorage.setItem('nekto_access_cooldown_min', accessCooldownMin);
            localStorage.setItem('nekto_access_session_end', String(Date.now() + accessSessionMin * 60000));
            localStorage.removeItem('nekto_access_cooldown_end');
            modalTimer.style.display = 'none';
            tickAccessTimer();
        };
        document.getElementById('nekto-btn-access-cancel-timer').onclick = () => {
            if (confirm('Точно отменить таймер доступа? Ограничение будет снято.')) {
                localStorage.removeItem('nekto_access_session_end'); localStorage.removeItem('nekto_access_cooldown_end');
                const overlay = document.getElementById('nekto-access-overlay'); if (overlay) overlay.remove();
                const widget = document.getElementById('nekto-access-widget'); if (widget) widget.remove();
                modalTimer.style.display = 'none';
            }
        };


        const modalStats = document.createElement('div');
        modalStats.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #2b2b2b; color: #fff; padding: 25px; border-radius: 12px; z-index: 999999; display: none; flex-direction: column; gap: 15px; min-width: 320px; max-width: 450px; max-height: 80vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.7); font-family: sans-serif;`;
        modalStats.innerHTML = `
            <h3 style="margin:0 0 10px 0; border-bottom:1px solid #555; padding-bottom:10px; display:flex; justify-content:space-between; align-items:center;"><span>Статистика</span><button id="nekto-btn-stats-clear" style="font-size:11px; padding:4px 8px; background:#d9534f; color:white; border:none; border-radius:4px; cursor:pointer;">Очистить</button></h3>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px; color:#aaa;">Показать: <select id="nekto-stats-date-select" style="padding:6px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff; font-size:14px;"></select></label>
            <div style="display:flex; flex-direction:column; gap:8px;"><div style="font-size:13px; color:#aaa;">Задать диапазон длительности (до 10ч):</div><div style="display:flex; gap:10px; align-items:center;"><input type="text" id="nekto-stats-limit-input" style="padding:6px; width:120px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff; font-size:14px; text-align:center;"><input type="range" id="nekto-stats-limit-slider" min="1" max="36000" style="flex-grow:1; accent-color:#000080; height:6px; cursor:pointer;"></div></div>
            <div style="background:#1e1e1e; padding:10px; border-radius:6px; margin-top:10px; font-size:14px;"><strong id="nekto-stats-total-label">Общее время во всех диалогах:</strong> <span id="nekto-stats-total" style="color:#17a2b8;">0 сек</span></div>
            <div id="nekto-stats-list" style="max-height:220px; overflow-y:auto; margin-top:10px; padding-right:5px; font-size:13px; display:flex; flex-direction:column; gap:5px;"></div>
            <div style="display:flex; justify-content:flex-end; margin-top:15px;"><button id="nekto-btn-stats-close" style="padding:8px 15px; cursor:pointer; background:#555; color:#fff; border:none; border-radius:6px;">Закрыть</button></div>
        `;
        document.body.appendChild(modalStats);
        modalStats.classList.add('nekto-ui-panel');

        const slider = document.getElementById('nekto-stats-limit-slider'), input = document.getElementById('nekto-stats-limit-input');
        slider.value = statsLimit; input.value = formatSeconds(statsLimit);
        const dateSelect = document.getElementById('nekto-stats-date-select');

        function populateDateOptions() {
            const seen = {};
            dialogueHistory.forEach(d => { const k = dateKey(d.timestamp); if (!(k in seen)) seen[k] = d.timestamp; });
            const sortedKeys = Object.keys(seen).sort((a, b) => seen[b] - seen[a]); // сначала свежие даты
            const prevValue = dateSelect.value || 'all';
            dateSelect.innerHTML = '<option value="all">Общее (за всё время)</option>' +
                sortedKeys.map(k => `<option value="${k}">${formatDateRu(seen[k])}</option>`).join('');
            const stillValid = Array.from(dateSelect.options).some(o => o.value === prevValue);
            dateSelect.value = stillValid ? prevValue : 'all';
        }

        function renderStats() {
            populateDateOptions();
            let limitSec = parseTimeToSeconds(input.value);
            const dateSel = dateSelect.value;
            let filtered = dialogueHistory.filter(d => d.duration <= limitSec && (dateSel === 'all' || dateKey(d.timestamp) === dateSel));

            document.getElementById('nekto-stats-total-label').innerText = dateSel === 'all'
                ? 'Общее время во всех диалогах:'
                : 'Общее время разговоров за ' + formatDateRu(dialogueHistory.find(d => dateKey(d.timestamp) === dateSel).timestamp) + ':';
            document.getElementById('nekto-stats-total').innerText = formatSeconds(filtered.reduce((a, b) => a + b.duration, 0));
            let groups = {}; filtered.forEach(d => { let minBin = Math.floor(d.duration / 60); groups[minBin] = (groups[minBin] || 0) + 1; });
            let sortedBins = Object.keys(groups).map(Number).sort((a,b) => a - b), listHtml = '';
            if (sortedBins.length === 0) listHtml = '<div style="color:#aaa; text-align:center; padding:10px;">Нет данных</div>';
            else sortedBins.forEach(bin => { listHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px solid #444; padding:5px 0;"><span>${getMinutePlural(bin)}:</span><span style="font-weight:bold; color:#28a745;">${groups[bin]}</span></div>`; });
            document.getElementById('nekto-stats-list').innerHTML = listHtml;
        }

        dateSelect.onchange = () => renderStats();

        slider.oninput = e => { let val = parseInt(e.target.value); input.value = formatSeconds(val); localStorage.setItem('nekto_stats_limit', val); renderStats(); };
        input.onchange = e => { let val = parseTimeToSeconds(e.target.value); if (val<1) val=1; if (val>36000) val=36000; slider.value = val; input.value = formatSeconds(val); localStorage.setItem('nekto_stats_limit', val); renderStats(); };
        document.getElementById('nekto-btn-stats-clear').onclick = () => { if (confirm('Очистить всю сохраненную статистику диалогов?')) { dialogueHistory = []; localStorage.setItem('nekto_dialogue_history', JSON.stringify([])); renderStats(); } };
        statsBtn.onclick = () => { modalStats.style.display = 'flex'; renderStats(); };
        document.getElementById('nekto-btn-stats-close').onclick = () => { modalStats.style.display = 'none'; };
    }

    // Универсальная "фабрика" окон в стиле Win98 для дополнительных игр (Дино использует свою
    // отдельную функцию ниже, т.к. у него есть особая регулировка громкости).
    const gamesRegistry = []; // {id, title, icon, open()} — общий список для меню игр

    function createGameWindow(cfg) {
        if (document.getElementById(cfg.id + '-container')) return;

        const winC = document.createElement('div');
        winC.id = cfg.id + '-container';
        winC.style.cssText = `position: fixed; top: ${100 + cfg.offsetIndex * 25}px; left: ${80 + cfg.offsetIndex * 35}px; width: ${cfg.width}px; height: ${cfg.height}px; background-color: #c0c0c0; border-top: 2px solid #dfdfdf; border-left: 2px solid #dfdfdf; border-right: 2px solid #000000; border-bottom: 2px solid #000000; box-shadow: inset -1px -1px #808080, inset 1px 1px #ffffff, 4px 4px 10px rgba(0,0,0,0.3); z-index: 999997; display: none; flex-direction: column; resize: both; overflow: hidden; font-family: Tahoma, Arial, sans-serif; min-width: 220px; min-height: 150px;`;

        winC.classList.add('nekto-game-win');
        const titleBar = document.createElement('div');
        titleBar.classList.add('nekto-game-titlebar');
        titleBar.style.cssText = `background: linear-gradient(90deg, #000080, #1084d0); color: white; padding: 3px 6px; font-size: 12px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; cursor: default; user-select: none;`;
        const titleText = document.createElement('span'); titleText.innerText = cfg.title;
        const closeBtn = document.createElement('button'); closeBtn.innerText = 'X';
        closeBtn.classList.add('nekto-game-close');
        closeBtn.style.cssText = `background: #c0c0c0; border-top: 1px solid #fff; border-left: 1px solid #fff; border-right: 1px solid #000; border-bottom: 1px solid #000; color: black; font-weight: bold; font-size: 11px; width: 18px; height: 16px; line-height: 12px; padding: 0; cursor: pointer;`;

        const content = document.createElement('div');
        content.classList.add('nekto-game-content');
        content.style.cssText = 'flex-grow: 1; margin: 4px; border-top: 2px solid #808080; border-left: 2px solid #808080; border-right: 2px solid #fff; border-bottom: 2px solid #fff; background: white; position: relative;';
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'width: 100%; height: 100%; border: none; display: block; pointer-events: auto;';
        // Специально НЕ грузим src/srcdoc здесь — иначе игра начинает тикать (падают блоки,
        // летает шарик) ещё до того, как окно вообще открыли хоть раз.
        content.appendChild(iframe); winC.appendChild(content); document.body.appendChild(winC);

        function loadGame() { if (cfg.isSrcDoc) iframe.srcdoc = cfg.html; else iframe.src = cfg.src; }
        function unloadGame() { iframe.srcdoc = ''; iframe.src = 'about:blank'; } // полностью останавливает все таймеры/rAF внутри iframe

        closeBtn.onclick = () => { winC.style.display = 'none'; unloadGame(); };
        titleBar.appendChild(titleText); titleBar.appendChild(closeBtn); winC.appendChild(titleBar);

        let isDragging = false, offsetX, offsetY;
        titleBar.addEventListener('mousedown', e => {
            if (e.target === closeBtn) return;
            isDragging = true; offsetX = e.clientX - winC.getBoundingClientRect().left; offsetY = e.clientY - winC.getBoundingClientRect().top;
            const overlay = document.createElement('div'); overlay.className = 'win98-drag-overlay-tmp'; overlay.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; z-index:10;'; content.appendChild(overlay);
        });
        document.addEventListener('mousemove', e => { if (isDragging) { winC.style.left = (e.clientX - offsetX) + 'px'; winC.style.top = (e.clientY - offsetY) + 'px'; } });
        document.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; const overlay = winC.querySelector('.win98-drag-overlay-tmp'); if (overlay) overlay.remove(); } });

        // Вместо своей плавающей иконки — регистрируемся в общем меню игр (иконка-квадрат справа)
        gamesRegistry.push({ id: cfg.id, title: cfg.title, icon: cfg.icon, open: () => { winC.style.display = 'flex'; loadGame(); } });
    }

    // --- Змейка ---
    const GAME_HTML_SNAKE = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{margin:0;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:monospace;color:#0f0;}' +
        'canvas{background:#000;border:2px solid #0f0;}#score{margin:6px 0;font-size:16px;}#msg{color:#fff;font-size:15px;text-align:center;display:none;background:rgba(0,0,0,0.7);padding:6px 14px;border-radius:8px;margin-top:6px;}' +
        '</style></head><body><div id="score">Очки: 0</div><canvas id="c" width="280" height="280"></canvas><div id="msg">Нажмите ПРОБЕЛ, чтобы начать</div><script>' +
        'const canvas=document.getElementById("c"),ctx=canvas.getContext("2d");const grid=14,cells=20;const msgEl=document.getElementById("msg"),scoreEl=document.getElementById("score");' +
        'let snake,dir,food,score,state,loop;' +
        'function isUp(e){return e.key==="ArrowUp"||e.code==="KeyW"||e.key.toLowerCase()==="ц";}' +
        'function isDown(e){return e.key==="ArrowDown"||e.code==="KeyS"||e.key.toLowerCase()==="ы";}' +
        'function isLeft(e){return e.key==="ArrowLeft"||e.code==="KeyA"||e.key.toLowerCase()==="ф";}' +
        'function isRight(e){return e.key==="ArrowRight"||e.code==="KeyD"||e.key.toLowerCase()==="в";}' +
        'function placeFood(){food={x:Math.floor(Math.random()*cells),y:Math.floor(Math.random()*cells)};}' +
        'function showIdle(text){state="idle";clearInterval(loop);msgEl.innerText=text;msgEl.style.display="block";}' +
        'function startGame(){snake=[{x:10,y:10}];dir={x:1,y:0};score=0;placeFood();scoreEl.innerText="Очки: 0";msgEl.style.display="none";state="playing";clearInterval(loop);loop=setInterval(tick,110);draw();}' +
        'function tick(){if(state!=="playing")return;const head={x:snake[0].x+dir.x,y:snake[0].y+dir.y};' +
        'if(head.x<0||head.y<0||head.x>=cells||head.y>=cells||snake.some(s=>s.x===head.x&&s.y===head.y)){showIdle("Игра окончена! Очки: "+score+". Пробел — заново");return;}' +
        'snake.unshift(head);if(head.x===food.x&&head.y===food.y){score++;scoreEl.innerText="Очки: "+score;placeFood();}else snake.pop();draw();}' +
        'function draw(){ctx.fillStyle="#000";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle="#f33";ctx.fillRect(food.x*grid,food.y*grid,grid-1,grid-1);ctx.fillStyle="#0f0";snake.forEach(s=>ctx.fillRect(s.x*grid,s.y*grid,grid-1,grid-1));}' +
        'document.addEventListener("keydown",e=>{' +
        'if(e.code==="Space"){e.preventDefault();if(state==="playing")showIdle("Пауза. Очки: "+score+". Пробел — играть");else startGame();return;}' +
        'if(state!=="playing")return;' +
        'if(isUp(e)&&dir.y===0)dir={x:0,y:-1};else if(isDown(e)&&dir.y===0)dir={x:0,y:1};else if(isLeft(e)&&dir.x===0)dir={x:-1,y:0};else if(isRight(e)&&dir.x===0)dir={x:1,y:0};});' +
        'snake=[{x:10,y:10}];placeFood();draw();showIdle("Нажмите ПРОБЕЛ, чтобы начать");</script></body></html>';

    // --- Сапёр ---
    const GAME_HTML_MINESWEEPER = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{margin:0;background:#c0c0c0;display:flex;flex-direction:column;align-items:center;font-family:Tahoma,Arial;height:100vh;justify-content:center;}' +
        '#grid{display:grid;grid-template-columns:repeat(10,26px);grid-template-rows:repeat(10,26px);gap:1px;background:#808080;border:2px solid #808080;}' +
        '.cell{width:26px;height:26px;background:#c0c0c0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;cursor:pointer;border-top:2px solid #fff;border-left:2px solid #fff;border-right:2px solid #808080;border-bottom:2px solid #808080;user-select:none;}' +
        '.cell.open{border:1px solid #999;background:#d9d9d9;cursor:default;}.cell.mine{background:#f33;}#status{margin-bottom:8px;font-size:14px;font-weight:bold;}#restart{margin-top:8px;padding:4px 12px;cursor:pointer;}' +
        '</style></head><body><div id="status">Мины: 15</div><div id="grid"></div><button id="restart">Заново</button><script>' +
        'const SIZE=10,MINES=15;let board,opened,flagged,gameOver;const gridEl=document.getElementById("grid"),statusEl=document.getElementById("status");' +
        'function init(){board=Array.from({length:SIZE},()=>Array(SIZE).fill(0));opened=Array.from({length:SIZE},()=>Array(SIZE).fill(false));flagged=Array.from({length:SIZE},()=>Array(SIZE).fill(false));gameOver=false;statusEl.innerText="Мины: "+MINES;' +
        'let placed=0;while(placed<MINES){const x=Math.floor(Math.random()*SIZE),y=Math.floor(Math.random()*SIZE);if(board[y][x]!==-1){board[y][x]=-1;placed++;}}' +
        'for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){if(board[y][x]===-1)continue;let c=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const ny=y+dy,nx=x+dx;if(ny>=0&&ny<SIZE&&nx>=0&&nx<SIZE&&board[ny][nx]===-1)c++;}board[y][x]=c;}render();}' +
        'function render(){gridEl.innerHTML="";for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){const d=document.createElement("div");d.className="cell";' +
        'if(opened[y][x]){d.classList.add("open");if(board[y][x]===-1){d.classList.add("mine");d.innerText="\\u{1F4A3}";}else if(board[y][x]>0){d.innerText=board[y][x];}}else if(flagged[y][x])d.innerText="\\u{1F6A9}";' +
        'd.onclick=()=>openCell(x,y);d.oncontextmenu=(e)=>{e.preventDefault();if(!opened[y][x]&&!gameOver){flagged[y][x]=!flagged[y][x];render();}};gridEl.appendChild(d);}}' +
        'function openCell(x,y){if(gameOver||opened[y][x]||flagged[y][x])return;opened[y][x]=true;if(board[y][x]===-1){gameOver=true;statusEl.innerText="Бум!";revealAll();return;}' +
        'if(board[y][x]===0){for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const ny=y+dy,nx=x+dx;if(ny>=0&&ny<SIZE&&nx>=0&&nx<SIZE&&!opened[ny][nx])openCell(nx,ny);}}checkWin();render();}' +
        'function revealAll(){for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++)opened[y][x]=true;render();}' +
        'function checkWin(){let total=SIZE*SIZE,openedCount=0;for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++)if(opened[y][x])openedCount++;if(openedCount===total-MINES){gameOver=true;statusEl.innerText="Победа!";}}' +
        'document.getElementById("restart").onclick=init;init();</script></body></html>';

    // --- Блоки (падающие фигуры) ---
    const GAME_HTML_BLOCKS = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{margin:0;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:monospace;color:#fff;}' +
        'canvas{background:#000;border:2px solid #555;}#score{margin:6px 0;}#msg{color:#fff;margin-top:6px;text-align:center;font-size:14px;display:none;background:rgba(0,0,0,0.7);padding:6px 14px;border-radius:8px;}' +
        '</style></head><body><div id="score">Очки: 0</div><canvas id="c" width="200" height="360"></canvas><div id="msg">Нажмите ПРОБЕЛ, чтобы начать</div><script>' +
        'const COLS=10,ROWS=18,SZ=20;const canvas=document.getElementById("c"),ctx=canvas.getContext("2d");const msgEl=document.getElementById("msg"),scoreEl=document.getElementById("score");' +
        'const SHAPES=[[[1,1,1,1]],[[1,1],[1,1]],[[0,1,0],[1,1,1]],[[1,0,0],[1,1,1]],[[0,0,1],[1,1,1]],[[1,1,0],[0,1,1]],[[0,1,1],[1,1,0]]];' +
        'const COLORS=["#0ff","#ff0","#a0f","#f80","#08f","#0f0","#f00"];let board,cur,curColor,curX,curY,score,state,loop;' +
        'function isUp(e){return e.key==="ArrowUp"||e.code==="KeyW"||e.key.toLowerCase()==="ц";}' +
        'function isDown(e){return e.key==="ArrowDown"||e.code==="KeyS"||e.key.toLowerCase()==="ы";}' +
        'function isLeft(e){return e.key==="ArrowLeft"||e.code==="KeyA"||e.key.toLowerCase()==="ф";}' +
        'function isRight(e){return e.key==="ArrowRight"||e.code==="KeyD"||e.key.toLowerCase()==="в";}' +
        'function showIdle(text){state="idle";clearInterval(loop);msgEl.innerText=text;msgEl.style.display="block";draw();}' +
        'function newPiece(){const i=Math.floor(Math.random()*SHAPES.length);cur=SHAPES[i].map(r=>r.slice());curColor=COLORS[i];curX=Math.floor(COLS/2)-Math.ceil(cur[0].length/2);curY=0;' +
        'if(collide(curX,curY,cur)){showIdle("Игра окончена! Очки: "+score+". Пробел — заново");}}' +
        'function collide(px,py,shape){for(let y=0;y<shape.length;y++)for(let x=0;x<shape[y].length;x++){if(!shape[y][x])continue;const bx=px+x,by=py+y;if(bx<0||bx>=COLS||by>=ROWS)return true;if(by>=0&&board[by][bx])return true;}return false;}' +
        'function rotate(shape){const h=shape.length,w=shape[0].length;const res=Array.from({length:w},()=>Array(h).fill(0));for(let y=0;y<h;y++)for(let x=0;x<w;x++)res[x][h-1-y]=shape[y][x];return res;}' +
        'function merge(){cur.forEach((row,y)=>row.forEach((v,x)=>{if(v)board[curY+y][curX+x]=curColor;}));}' +
        'function clearLines(){let cleared=0;for(let y=ROWS-1;y>=0;y--){if(board[y].every(c=>c)){board.splice(y,1);board.unshift(Array(COLS).fill(0));cleared++;y++;}}if(cleared){score+=cleared*100;scoreEl.innerText="Очки: "+score;}}' +
        'function tick(){if(state!=="playing")return;if(!collide(curX,curY+1,cur))curY++;else{merge();clearLines();newPiece();}draw();}' +
        'function draw(){ctx.fillStyle="#000";ctx.fillRect(0,0,canvas.width,canvas.height);for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){if(board[y][x]){ctx.fillStyle=board[y][x];ctx.fillRect(x*SZ,y*SZ,SZ-1,SZ-1);}}' +
        'if(state==="playing"){ctx.fillStyle=curColor;cur.forEach((row,y)=>row.forEach((v,x)=>{if(v)ctx.fillRect((curX+x)*SZ,(curY+y)*SZ,SZ-1,SZ-1);}));}}' +
        'function startGame(){board=Array.from({length:ROWS},()=>Array(COLS).fill(0));score=0;state="playing";scoreEl.innerText="Очки: 0";msgEl.style.display="none";newPiece();clearInterval(loop);loop=setInterval(tick,500);draw();}' +
        'document.addEventListener("keydown",e=>{' +
        'if(e.code==="Space"){e.preventDefault();if(state==="playing")showIdle("Пауза. Очки: "+score+". Пробел — играть");else startGame();return;}' +
        'if(state!=="playing")return;' +
        'if(isLeft(e)&&!collide(curX-1,curY,cur))curX--;else if(isRight(e)&&!collide(curX+1,curY,cur))curX++;else if(isDown(e))tick();else if(isUp(e)){const r=rotate(cur);if(!collide(curX,curY,r))cur=r;}draw();});' +
        'board=Array.from({length:ROWS},()=>Array(COLS).fill(0));draw();showIdle("Нажмите ПРОБЕЛ, чтобы начать");</script></body></html>';

    // --- Пинг-понг (против простого ИИ) ---
    const GAME_HTML_PONG = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{margin:0;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:monospace;color:#fff;}' +
        'canvas{background:#000;border:2px solid #555;}#score{margin:6px 0;}' +
        '</style></head><body><div id="score">0 : 0</div><canvas id="c" width="360" height="240"></canvas><script>' +
        'const canvas=document.getElementById("c"),ctx=canvas.getContext("2d"),scoreEl=document.getElementById("score");' +
        'const W=360,H=240,PW=10,PH=70,R=7;' +
        'let ball={x:W/2,y:H/2,vx:0,vy:0},player={y:(H-PH)/2},ai={y:(H-PH)/2},scoreP=0,scoreA=0,state="idle";' +
        'document.addEventListener("mousemove",e=>{const r=canvas.getBoundingClientRect();const scaleY=H/r.height;player.y=Math.max(0,Math.min(H-PH,(e.clientY-r.top)*scaleY-PH/2));});' +
        'function reset(){const ang=(Math.random()*0.7-0.35);const dir=Math.random()>0.5?1:-1;const speed=3.2;ball={x:W/2,y:H/2,vx:dir*speed*Math.cos(ang),vy:speed*Math.sin(ang)||1.5};}' +
        'function startGame(){scoreP=0;scoreA=0;scoreEl.innerText="0 : 0";state="playing";reset();}' +
        'function tick(){' +
        'if(state==="playing"){' +
        'ball.x+=ball.vx;ball.y+=ball.vy;' +
        'if(ball.y-R<=0){ball.y=R;ball.vy=Math.abs(ball.vy);}else if(ball.y+R>=H){ball.y=H-R;ball.vy=-Math.abs(ball.vy);}' +
        'if(ball.vx<0&&ball.x-R<=10+PW&&ball.x-R>=4&&ball.y+R>=player.y&&ball.y-R<=player.y+PH){ball.x=10+PW+R;ball.vx=Math.min(Math.abs(ball.vx)*1.05,8);ball.vy+=(ball.y-(player.y+PH/2))*0.06;}' +
        'if(ball.vx>0&&ball.x+R>=W-10-PW&&ball.x+R<=W-4&&ball.y+R>=ai.y&&ball.y-R<=ai.y+PH){ball.x=W-10-PW-R;ball.vx=-Math.min(Math.abs(ball.vx)*1.05,8);ball.vy+=(ball.y-(ai.y+PH/2))*0.06;}' +
        'if(ball.x<0){scoreA++;scoreEl.innerText=scoreP+" : "+scoreA;reset();}' +
        'if(ball.x>W){scoreP++;scoreEl.innerText=scoreP+" : "+scoreA;reset();}' +
        'ai.y+=(ball.y-(ai.y+PH/2))*0.09;ai.y=Math.max(0,Math.min(H-PH,ai.y));' +
        '}' +
        'draw();requestAnimationFrame(tick);}' +
        'function draw(){ctx.fillStyle="#000";ctx.fillRect(0,0,W,H);ctx.fillStyle="#fff";ctx.fillRect(10,player.y,PW,PH);ctx.fillRect(W-10-PW,ai.y,PW,PH);' +
        'if(state==="playing"){ctx.beginPath();ctx.arc(ball.x,ball.y,R,0,Math.PI*2);ctx.fill();}' +
        'if(state==="idle"){ctx.fillStyle="rgba(0,0,0,0.6)";ctx.fillRect(0,0,W,H);ctx.fillStyle="#fff";ctx.font="16px monospace";ctx.textAlign="center";' +
        'ctx.fillText(scoreP===0&&scoreA===0?"Пробел — играть":"Пауза ("+scoreP+" : "+scoreA+"). Пробел — играть",W/2,H/2);ctx.textAlign="left";}}' +
        'document.addEventListener("keydown",e=>{if(e.code==="Space"){e.preventDefault();if(state==="playing")state="idle";else startGame();}});' +
        'tick();</script></body></html>';

    // --- 2048 (самописная версия — внешний сайт не всегда пускает во встроенный iframe) ---
    const GAME_HTML_2048 = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{margin:0;background:#faf8ef;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:Arial,sans-serif;}' +
        '#score{margin:8px 0;font-size:18px;font-weight:bold;color:#776e65;}' +
        '#board{display:grid;grid-template-columns:repeat(4,64px);grid-template-rows:repeat(4,64px);gap:8px;background:#bbada0;padding:8px;border-radius:8px;}' +
        '.cell{width:64px;height:64px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:bold;background:rgba(238,228,218,0.35);color:#776e65;}' +
        '#msg{margin-top:8px;font-size:13px;color:#776e65;text-align:center;display:none;background:rgba(255,255,255,0.85);padding:6px 12px;border-radius:8px;}' +
        '</style></head><body><div id="score">Очки: 0</div><div id="board"></div><div id="msg">Нет ходов! Пробел — заново</div><script>' +
        'const boardEl=document.getElementById("board"),scoreEl=document.getElementById("score"),msgEl=document.getElementById("msg");' +
        'const COLORS={2:"#eee4da",4:"#ede0c8",8:"#f2b179",16:"#f59563",32:"#f67c5f",64:"#f65e3b",128:"#edcf72",256:"#edcc61",512:"#edc850",1024:"#edc53f",2048:"#edc22e"};' +
        'let grid,score,cells=[];' +
        'function isUp(e){return e.key==="ArrowUp"||e.code==="KeyW"||e.key.toLowerCase()==="ц";}' +
        'function isDown(e){return e.key==="ArrowDown"||e.code==="KeyS"||e.key.toLowerCase()==="ы";}' +
        'function isLeft(e){return e.key==="ArrowLeft"||e.code==="KeyA"||e.key.toLowerCase()==="ф";}' +
        'function isRight(e){return e.key==="ArrowRight"||e.code==="KeyD"||e.key.toLowerCase()==="в";}' +
        'function initBoard(){boardEl.innerHTML="";cells=[];for(let i=0;i<16;i++){const d=document.createElement("div");d.className="cell";boardEl.appendChild(d);cells.push(d);}}' +
        'function newGame(){grid=Array.from({length:4},()=>Array(4).fill(0));score=0;msgEl.style.display="none";scoreEl.innerText="Очки: 0";addTile();addTile();render();}' +
        'function addTile(){const empty=[];for(let y=0;y<4;y++)for(let x=0;x<4;x++)if(grid[y][x]===0)empty.push([y,x]);if(!empty.length)return;const p=empty[Math.floor(Math.random()*empty.length)];grid[p[0]][p[1]]=Math.random()<0.9?2:4;}' +
        'function render(){for(let y=0;y<4;y++)for(let x=0;x<4;x++){const v=grid[y][x],d=cells[y*4+x];d.innerText=v||"";d.style.background=v?(COLORS[v]||"#3c3a32"):"rgba(238,228,218,0.35)";d.style.color=v>4?"#f9f6f2":"#776e65";}scoreEl.innerText="Очки: "+score;}' +
        'function slide(row){const arr=row.filter(v=>v!==0);const res=[];for(let i=0;i<arr.length;i++){if(arr[i]===arr[i+1]){res.push(arr[i]*2);score+=arr[i]*2;i++;}else res.push(arr[i]);}while(res.length<4)res.push(0);return res;}' +
        'function move(dir){const before=JSON.stringify(grid);' +
        'if(dir==="left"){for(let y=0;y<4;y++)grid[y]=slide(grid[y]);}' +
        'else if(dir==="right"){for(let y=0;y<4;y++)grid[y]=slide(grid[y].slice().reverse()).reverse();}' +
        'else if(dir==="up"){for(let x=0;x<4;x++){let col=slide([grid[0][x],grid[1][x],grid[2][x],grid[3][x]]);for(let y=0;y<4;y++)grid[y][x]=col[y];}}' +
        'else if(dir==="down"){for(let x=0;x<4;x++){let col=slide([grid[3][x],grid[2][x],grid[1][x],grid[0][x]]);for(let y=0;y<4;y++)grid[3-y][x]=col[y];}}' +
        'if(before!==JSON.stringify(grid)){addTile();render();if(!hasMoves())msgEl.style.display="block";}}' +
        'function hasMoves(){for(let y=0;y<4;y++)for(let x=0;x<4;x++){if(grid[y][x]===0)return true;if(x<3&&grid[y][x]===grid[y][x+1])return true;if(y<3&&grid[y][x]===grid[y+1][x])return true;}return false;}' +
        'document.addEventListener("keydown",e=>{if(e.code==="Space"){e.preventDefault();newGame();return;}' +
        'if(isLeft(e)){e.preventDefault();move("left");}else if(isRight(e)){e.preventDefault();move("right");}else if(isUp(e)){e.preventDefault();move("up");}else if(isDown(e)){e.preventDefault();move("down");}});' +
        'initBoard();newGame();</script></body></html>';

    // --- Флэппи (оригинальный, без чужих ассетов) ---
    const GAME_HTML_FLAP = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{margin:0;background:#4ec0ca;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:monospace;color:#fff;}' +
        'canvas{background:#4ec0ca;border:2px solid #333;}#score{margin:6px 0;font-size:18px;}#msg{margin-top:6px;font-size:13px;text-align:center;display:none;background:rgba(0,0,0,0.6);padding:6px 12px;border-radius:8px;}' +
        '</style></head><body><div id="score">Очки: 0</div><canvas id="c" width="300" height="380"></canvas><div id="msg">Нажмите ПРОБЕЛ, чтобы начать</div><script>' +
        'const canvas=document.getElementById("c"),ctx=canvas.getContext("2d"),msgEl=document.getElementById("msg"),scoreEl=document.getElementById("score");' +
        'const W=300,H=380,GAP=110,PIPE_W=44;let bird,pipes,score,state,frame;' +
        'function showIdle(text){state="idle";msgEl.innerText=text;msgEl.style.display="block";}' +
        'function startGame(){bird={y:H/2,vy:0};pipes=[{x:W+40,gapY:100+Math.random()*150}];score=0;frame=0;scoreEl.innerText="Очки: 0";msgEl.style.display="none";state="playing";}' +
        'function flap(){if(state==="playing")bird.vy=-6.5;}' +
        'function tick(){' +
        'if(state==="playing"){' +
        'frame++; bird.vy+=0.35; bird.y+=bird.vy;' +
        'if(frame%95===0)pipes.push({x:W+20,gapY:80+Math.random()*180,passed:false});' +
        'pipes.forEach(p=>p.x-=2.4); while(pipes.length&&pipes[0].x<-PIPE_W)pipes.shift();' +
        'pipes.forEach(p=>{if(!p.passed&&p.x+PIPE_W<40){p.passed=true;score++;scoreEl.innerText="Очки: "+score;}});' +
        'let dead=bird.y<0||bird.y>H;' +
        'pipes.forEach(p=>{if(40+14>p.x&&40-14<p.x+PIPE_W){if(bird.y-14<p.gapY-GAP/2||bird.y+14>p.gapY+GAP/2)dead=true;}});' +
        'if(dead)showIdle("Разбился! Очки: "+score+". Пробел — заново");' +
        '}' +
        'draw();requestAnimationFrame(tick);}' +
        'function draw(){ctx.fillStyle="#4ec0ca";ctx.fillRect(0,0,W,H);' +
        'ctx.fillStyle="#4a934a";pipes.forEach(p=>{ctx.fillRect(p.x,0,PIPE_W,p.gapY-GAP/2);ctx.fillRect(p.x,p.gapY+GAP/2,PIPE_W,H-(p.gapY+GAP/2));});' +
        'if(state==="playing"){ctx.fillStyle="#f5d547";ctx.beginPath();ctx.arc(40,bird.y,14,0,Math.PI*2);ctx.fill();}' +
        'if(state==="idle"){ctx.fillStyle="rgba(0,0,0,0.3)";ctx.fillRect(0,0,W,H);}}' +
        'document.addEventListener("keydown",e=>{if(e.code==="Space"){e.preventDefault();if(state==="playing")flap();else startGame();}});' +
        'canvas.addEventListener("mousedown",()=>{if(state==="playing")flap();else startGame();});' +
        'pipes=[];bird={y:H/2,vy:0};draw();showIdle("Нажмите ПРОБЕЛ (или клик), чтобы начать");tick();</script></body></html>';

    // --- Арканоид (Breakout) ---
    const GAME_HTML_BREAKOUT = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{margin:0;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:monospace;color:#fff;}' +
        'canvas{background:#000;border:2px solid #555;}#score{margin:6px 0;}' +
        '</style></head><body><div id="score">Очки: 0</div><canvas id="c" width="300" height="320"></canvas><script>' +
        'const canvas=document.getElementById("c"),ctx=canvas.getContext("2d"),scoreEl=document.getElementById("score");' +
        'const W=300,H=320,PW=60,PH=10,R=6,ROWS=5,COLS=8,BW=32,BH=14;' +
        'let paddleX,ball,bricks,score,state;' +
        'function isLeft(e){return e.key==="ArrowLeft"||e.code==="KeyA"||e.key.toLowerCase()==="ф";}' +
        'function isRight(e){return e.key==="ArrowRight"||e.code==="KeyD"||e.key.toLowerCase()==="в";}' +
        'document.addEventListener("mousemove",e=>{const r=canvas.getBoundingClientRect();paddleX=Math.max(0,Math.min(W-PW,(e.clientX-r.left)*(W/r.width)-PW/2));});' +
        'let keyDir=0; document.addEventListener("keydown",e=>{if(isLeft(e))keyDir=-1;else if(isRight(e))keyDir=1;}); document.addEventListener("keyup",e=>{if(isLeft(e)||isRight(e))keyDir=0;});' +
        'function makeBricks(){bricks=[];for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)bricks.push({x:x*(BW+4)+8,y:y*(BH+4)+30,alive:true,color:["#f00","#f80","#ff0","#0f0","#0af"][y%5]});}' +
        'function startGame(){paddleX=(W-PW)/2;ball={x:W/2,y:H-40,vx:2.6,vy:-2.6};score=0;scoreEl.innerText="Очки: 0";makeBricks();state="playing";}' +
        'function showIdle(text){state="idle";document.title=text;}' +
        'function tick(){' +
        'if(state==="playing"){' +
        'paddleX=Math.max(0,Math.min(W-PW,paddleX+keyDir*4));' +
        'ball.x+=ball.vx;ball.y+=ball.vy;' +
        'if(ball.x-R<=0||ball.x+R>=W)ball.vx*=-1;' +
        'if(ball.y-R<=0)ball.vy=Math.abs(ball.vy);' +
        'if(ball.y+R>=H-20&&ball.y+R<=H-10&&ball.x>=paddleX&&ball.x<=paddleX+PW){ball.vy=-Math.abs(ball.vy);ball.vx+=(ball.x-(paddleX+PW/2))*0.05;}' +
        'if(ball.y>H){showIdle("Мяч упал! Очки: "+score+". Пробел — заново");}' +
        'bricks.forEach(b=>{if(b.alive&&ball.x+R>b.x&&ball.x-R<b.x+BW&&ball.y+R>b.y&&ball.y-R<b.y+BH){b.alive=false;ball.vy*=-1;score+=10;scoreEl.innerText="Очки: "+score;}});' +
        'if(bricks.every(b=>!b.alive))showIdle("Победа! Очки: "+score+". Пробел — заново");' +
        '}' +
        'draw();requestAnimationFrame(tick);}' +
        'function draw(){ctx.fillStyle="#000";ctx.fillRect(0,0,W,H);' +
        'bricks.forEach(b=>{if(b.alive){ctx.fillStyle=b.color;ctx.fillRect(b.x,b.y,BW,BH);}});' +
        'ctx.fillStyle="#fff";ctx.fillRect(paddleX,H-20,PW,PH);' +
        'if(state==="playing"){ctx.beginPath();ctx.arc(ball.x,ball.y,R,0,Math.PI*2);ctx.fill();}' +
        'if(state==="idle"){ctx.fillStyle="rgba(0,0,0,0.65)";ctx.fillRect(0,0,W,H);ctx.fillStyle="#fff";ctx.font="13px monospace";ctx.textAlign="center";ctx.fillText("Пробел — играть",W/2,H/2);ctx.textAlign="left";}}' +
        'document.addEventListener("keydown",e=>{if(e.code==="Space"){e.preventDefault();if(state!=="playing")startGame();}});' +
        'paddleX=(W-PW)/2;ball={x:W/2,y:H-40,vx:0,vy:0};makeBricks();draw();showIdle("");tick();</script></body></html>';

    // --- Саймон (повтори последовательность) ---
    const GAME_HTML_SIMON = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{margin:0;background:#222;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:Arial,sans-serif;color:#fff;}' +
        '#status{margin-bottom:10px;font-size:14px;}#pad{display:grid;grid-template-columns:80px 80px;grid-template-rows:80px 80px;gap:6px;}' +
        '.btn{border-radius:10px;cursor:pointer;opacity:0.5;transition:opacity 0.1s;} .lit{opacity:1;box-shadow:0 0 20px #fff;}' +
        '#start{margin-top:12px;padding:6px 14px;cursor:pointer;border-radius:6px;border:none;background:#28a745;color:#fff;}' +
        '</style></head><body><div id="status">Нажми "Старт"</div><div id="pad">' +
        '<div class="btn" id="b0" style="background:#e74c3c;"></div><div class="btn" id="b1" style="background:#3498db;"></div>' +
        '<div class="btn" id="b2" style="background:#f1c40f;"></div><div class="btn" id="b3" style="background:#2ecc71;"></div></div>' +
        '<button id="start">Старт</button><script>' +
        'const status=document.getElementById("status");const btns=[0,1,2,3].map(i=>document.getElementById("b"+i));' +
        'let seq=[],userStep=0,accepting=false;' +
        'function lit(i,ms){btns[i].classList.add("lit");setTimeout(()=>btns[i].classList.remove("lit"),ms||300);}' +
        'function playSeq(){accepting=false;status.innerText="Смотри...";let i=0;' +
        'const iv=setInterval(()=>{lit(seq[i]);i++;if(i>=seq.length){clearInterval(iv);setTimeout(()=>{accepting=true;userStep=0;status.innerText="Повтори! ("+seq.length+")";},400);}},600);}' +
        'function nextRound(){seq.push(Math.floor(Math.random()*4));playSeq();}' +
        'btns.forEach((b,i)=>b.addEventListener("click",()=>{if(!accepting)return;lit(i,200);' +
        'if(seq[userStep]===i){userStep++;if(userStep===seq.length){accepting=false;status.innerText="Верно! Дальше...";setTimeout(nextRound,700);}}' +
        'else{accepting=false;status.innerText="Ошибка! Счёт: "+(seq.length-1)+". Жми Старт";seq=[];}}));' +
        'document.getElementById("start").onclick=()=>{seq=[];status.innerText="Приготовься...";setTimeout(nextRound,500);};' +
        '</script></body></html>';

    // --- Камень-ножницы-бумага ---
    const GAME_HTML_RPS = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{margin:0;background:#1e1e2e;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:Arial,sans-serif;color:#fff;text-align:center;}' +
        '#score{font-size:15px;margin-bottom:10px;}#result{font-size:16px;min-height:24px;margin:10px 0;font-weight:bold;}' +
        '#choices button{font-size:30px;margin:0 8px;cursor:pointer;background:#333;border:2px solid #555;border-radius:12px;padding:10px 16px;color:#fff;}' +
        '#choices button:hover{background:#444;}' +
        '</style></head><body><div id="score">Победы: 0 | Ничьи: 0 | Поражения: 0</div><div id="result">Выбери ход</div>' +
        '<div id="choices"><button data-c="rock">🪨</button><button data-c="paper">📄</button><button data-c="scissors">✂️</button></div><script>' +
        'let w=0,d=0,l=0;const scoreEl=document.getElementById("score"),resEl=document.getElementById("result");' +
        'const beats={rock:"scissors",paper:"rock",scissors:"paper"};const names={rock:"Камень 🪨",paper:"Бумага 📄",scissors:"Ножницы ✂️"};' +
        'document.querySelectorAll("#choices button").forEach(b=>b.onclick=()=>{' +
        'const you=b.dataset.c;const opts=["rock","paper","scissors"];const cpu=opts[Math.floor(Math.random()*3)];' +
        'let outcome;if(you===cpu){outcome="Ничья!";d++;}else if(beats[you]===cpu){outcome="Ты выиграл!";w++;}else{outcome="Ты проиграл!";l++;}' +
        'resEl.innerText=names[you]+" против "+names[cpu]+" — "+outcome;scoreEl.innerText="Победы: "+w+" | Ничьи: "+d+" | Поражения: "+l;});' +
        '</script></body></html>';

    // --- Memory (найди пары) ---
    const GAME_HTML_MEMORY = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{margin:0;background:#222;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:Arial,sans-serif;color:#fff;}' +
        '#status{margin-bottom:8px;font-size:14px;}#grid{display:grid;grid-template-columns:repeat(4,60px);grid-template-rows:repeat(4,60px);gap:6px;}' +
        '.card{background:#456;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:26px;cursor:pointer;user-select:none;}' +
        '.card.open{background:#89a;}.card.done{background:#2a5;opacity:0.6;}' +
        '</style></head><body><div id="status">Ходы: 0</div><div id="grid"></div><script>' +
        'const EMOJI=["🍎","🍌","🍇","🍉","🍒","🍋","🍓","🥝"];let cards,flipped,moves,lockBoard;' +
        'const gridEl=document.getElementById("grid"),statusEl=document.getElementById("status");' +
        'function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}' +
        'function init(){const deck=shuffle([...EMOJI,...EMOJI].map((e,i)=>({id:i,val:e,open:false,done:false})));cards=deck;flipped=[];moves=0;lockBoard=false;statusEl.innerText="Ходы: 0";render();}' +
        'function render(){gridEl.innerHTML="";cards.forEach((c,i)=>{const d=document.createElement("div");d.className="card"+(c.open||c.done?" open":"")+(c.done?" done":"");' +
        'd.innerText=(c.open||c.done)?c.val:"❓";d.onclick=()=>flip(i);gridEl.appendChild(d);});}' +
        'function flip(i){if(lockBoard||cards[i].open||cards[i].done||flipped.length>=2)return;cards[i].open=true;flipped.push(i);render();' +
        'if(flipped.length===2){moves++;statusEl.innerText="Ходы: "+moves;lockBoard=true;' +
        'setTimeout(()=>{const [a,b]=flipped;if(cards[a].val===cards[b].val){cards[a].done=true;cards[b].done=true;}else{cards[a].open=false;cards[b].open=false;}' +
        'flipped=[];lockBoard=false;render();if(cards.every(c=>c.done))statusEl.innerText="Готово за "+moves+" ходов!";},700);}}' +
        'init();</script></body></html>';

    // --- Кроты (Whack-a-mole) ---
    const GAME_HTML_MOLE = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{margin:0;background:#3a2a1a;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:Arial,sans-serif;color:#fff;}' +
        '#score{margin-bottom:8px;font-size:15px;}#timeleft{margin-bottom:8px;font-size:13px;color:#ffd;}' +
        '#grid{display:grid;grid-template-columns:repeat(3,80px);grid-template-rows:repeat(3,80px);gap:8px;}' +
        '.hole{background:#5a3a20;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:34px;cursor:pointer;overflow:hidden;}' +
        '#msg{margin-top:10px;font-size:14px;display:none;}#start{margin-top:10px;padding:6px 14px;cursor:pointer;border-radius:6px;border:none;background:#28a745;color:#fff;}' +
        '</style></head><body><div id="score">Очки: 0</div><div id="timeleft">Время: 20</div><div id="grid"></div><div id="msg"></div><button id="start">Старт</button><script>' +
        'const gridEl=document.getElementById("grid"),scoreEl=document.getElementById("score"),timeEl=document.getElementById("timeleft"),msgEl=document.getElementById("msg");' +
        'let holes=[],score,timeLeft,gameIv,moleIv,active=-1;' +
        'function render(){gridEl.innerHTML="";for(let i=0;i<9;i++){const d=document.createElement("div");d.className="hole";d.innerText=i===active?"🐹":"";' +
        'd.onclick=()=>{if(i===active){score++;scoreEl.innerText="Очки: "+score;active=-1;render();}};gridEl.appendChild(d);}}' +
        'function startGame(){score=0;timeLeft=20;scoreEl.innerText="Очки: 0";timeEl.innerText="Время: 20";msgEl.style.display="none";active=-1;render();' +
        'clearInterval(gameIv);clearInterval(moleIv);' +
        'moleIv=setInterval(()=>{active=Math.floor(Math.random()*9);render();},800);' +
        'gameIv=setInterval(()=>{timeLeft--;timeEl.innerText="Время: "+timeLeft;if(timeLeft<=0){clearInterval(gameIv);clearInterval(moleIv);active=-1;render();msgEl.style.display="block";msgEl.innerText="Финиш! Очки: "+score;}},1000);}' +
        'document.getElementById("start").onclick=startGame;render();</script></body></html>';

    // --- Тест реакции ---
    const GAME_HTML_REACTION = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:Arial,sans-serif;color:#fff;background:#333;transition:background 0.1s;}' +
        '#box{width:260px;height:180px;border-radius:12px;background:#555;display:flex;align-items:center;justify-content:center;font-size:16px;text-align:center;padding:10px;box-sizing:border-box;cursor:pointer;user-select:none;}' +
        '#best{margin-top:10px;font-size:13px;color:#ccc;}' +
        '</style></head><body><div id="box">Нажми, чтобы начать</div><div id="best">Лучший результат: —</div><script>' +
        'const box=document.getElementById("box"),bestEl=document.getElementById("best");let state="idle",timeoutId,startTime,best=null;' +
        'function toIdle(text){state="idle";box.style.background="#555";box.innerText=text;}' +
        'function toWaiting(){state="waiting";box.style.background="#a33";box.innerText="Жди зелёного...";' +
        'const delay=800+Math.random()*2500;timeoutId=setTimeout(()=>{state="go";box.style.background="#2a6";box.innerText="ЖМИ!";startTime=performance.now();},delay);}' +
        'box.onclick=()=>{if(state==="idle"){toWaiting();}' +
        'else if(state==="waiting"){clearTimeout(timeoutId);toIdle("Рано! Жми, чтобы начать заново");}' +
        'else if(state==="go"){const ms=Math.round(performance.now()-startTime);if(best===null||ms<best){best=ms;bestEl.innerText="Лучший результат: "+best+" мс";}' +
        'toIdle("Реакция: "+ms+" мс. Жми ещё раз");}};' +
        '</script></body></html>';

    // --- Крестики-нолики (против ИИ) ---
    const GAME_HTML_TICTACTOE = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
        'body{margin:0;background:#222;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:Arial,sans-serif;color:#fff;}' +
        '#status{margin-bottom:8px;font-size:14px;}#grid{display:grid;grid-template-columns:repeat(3,70px);grid-template-rows:repeat(3,70px);gap:5px;}' +
        '.cell{background:#444;display:flex;align-items:center;justify-content:center;font-size:32px;cursor:pointer;border-radius:6px;}' +
        '#restart{margin-top:10px;padding:6px 14px;cursor:pointer;border-radius:6px;border:none;background:#28a745;color:#fff;}' +
        '</style></head><body><div id="status">Ты — X. Твой ход.</div><div id="grid"></div><button id="restart">Заново</button><script>' +
        'const gridEl=document.getElementById("grid"),statusEl=document.getElementById("status");let board,over;' +
        'const LINES=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];' +
        'function winner(b){for(const l of LINES){if(b[l[0]]&&b[l[0]]===b[l[1]]&&b[l[1]]===b[l[2]])return b[l[0]];}return b.every(c=>c)?"draw":null;}' +
        'function init(){board=Array(9).fill(null);over=false;statusEl.innerText="Ты — X. Твой ход.";render();}' +
        'function render(){gridEl.innerHTML="";board.forEach((v,i)=>{const d=document.createElement("div");d.className="cell";d.innerText=v||"";d.onclick=()=>userMove(i);gridEl.appendChild(d);});}' +
        'function userMove(i){if(over||board[i])return;board[i]="X";const w=winner(board);if(w){finish(w);return;}setTimeout(aiMove,300);}' +
        'function aiMove(){const empty=board.map((v,i)=>v?null:i).filter(v=>v!==null);if(!empty.length)return;' +
        'let move=empty[Math.floor(Math.random()*empty.length)];' +
        'for(const i of empty){const t=board.slice();t[i]="O";if(winner(t)==="O"){move=i;break;}}' +
        'for(const i of empty){const t=board.slice();t[i]="X";if(winner(t)==="X"){move=i;break;}}' +
        'board[move]="O";const w=winner(board);render();if(w)finish(w);else statusEl.innerText="Твой ход.";}' +
        'function finish(w){over=true;render();statusEl.innerText=w==="draw"?"Ничья!":(w==="X"?"Ты выиграл!":"Компьютер выиграл!");}' +
        'document.getElementById("restart").onclick=init;init();</script></body></html>';

    function initExtraGames() {
        createGameWindow({ id: 'game-2048', title: '2048.exe', icon: '\u{1F522}', isSrcDoc: true, html: GAME_HTML_2048, width: 420, height: 480, offsetIndex: 0 });
        createGameWindow({ id: 'game-snake', title: 'Snake.exe', icon: '\u{1F40D}', isSrcDoc: true, html: GAME_HTML_SNAKE, width: 320, height: 360, offsetIndex: 1 });
        createGameWindow({ id: 'game-mines', title: 'Miner.exe', icon: '\u{1F4A3}', isSrcDoc: true, html: GAME_HTML_MINESWEEPER, width: 300, height: 380, offsetIndex: 2 });
        createGameWindow({ id: 'game-blocks', title: 'Blocks.exe', icon: '\u{1F9E9}', isSrcDoc: true, html: GAME_HTML_BLOCKS, width: 240, height: 440, offsetIndex: 3 });
        createGameWindow({ id: 'game-pong', title: 'Pong.exe', icon: '\u{1F3D3}', isSrcDoc: true, html: GAME_HTML_PONG, width: 400, height: 320, offsetIndex: 4 });
        createGameWindow({ id: 'game-flap', title: 'Flap.exe', icon: '\u{1F426}', isSrcDoc: true, html: GAME_HTML_FLAP, width: 320, height: 460, offsetIndex: 5 });
        createGameWindow({ id: 'game-breakout', title: 'Breakout.exe', icon: '\u{1F9F1}', isSrcDoc: true, html: GAME_HTML_BREAKOUT, width: 320, height: 400, offsetIndex: 6 });
        createGameWindow({ id: 'game-simon', title: 'Simon.exe', icon: '\u{1F3AE}', isSrcDoc: true, html: GAME_HTML_SIMON, width: 260, height: 340, offsetIndex: 7 });
        createGameWindow({ id: 'game-rps', title: 'RPS.exe', icon: '\u270A', isSrcDoc: true, html: GAME_HTML_RPS, width: 320, height: 260, offsetIndex: 8 });
        createGameWindow({ id: 'game-memory', title: 'Memory.exe', icon: '\u{1F9E0}', isSrcDoc: true, html: GAME_HTML_MEMORY, width: 300, height: 380, offsetIndex: 9 });
        createGameWindow({ id: 'game-mole', title: 'Mole.exe', icon: '\u{1F439}', isSrcDoc: true, html: GAME_HTML_MOLE, width: 320, height: 420, offsetIndex: 10 });
        createGameWindow({ id: 'game-reaction', title: 'Reaction.exe', icon: '\u26A1', isSrcDoc: true, html: GAME_HTML_REACTION, width: 320, height: 320, offsetIndex: 11 });
        createGameWindow({ id: 'game-tictactoe', title: 'TicTacToe.exe', icon: '\u274C', isSrcDoc: true, html: GAME_HTML_TICTACTOE, width: 280, height: 380, offsetIndex: 12 });
    }

    // Иконка-квадрат справа — открывает меню со всеми играми (вместо кучи отдельных иконок)
    function initGamesLauncher() {
        if (document.getElementById('nekto-games-launcher')) return;

        const launcher = document.createElement('div');
        launcher.id = 'nekto-games-launcher';
        launcher.innerHTML = '🎮';
        launcher.style.cssText = 'position: fixed; top: 20px; right: 20px; width: 48px; height: 48px; font-size: 24px; cursor: pointer; background: rgba(0,0,0,0.6); border-radius: 10px; display: flex; justify-content: center; align-items: center; transition: 0.2s; user-select: none; z-index: 999998;';
        launcher.classList.add('nekto-ui-fab');
        document.body.appendChild(launcher);

        const menu = document.createElement('div');
        menu.id = 'nekto-games-menu';
        menu.style.cssText = 'position: fixed; top: 76px; right: 20px; background: #2b2b2b; color: #fff; padding: 12px; border-radius: 12px; z-index: 999999; display: none; grid-template-columns: repeat(3, 72px); gap: 8px; max-height: 80vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.7); font-family: Tahoma, Arial, sans-serif;';
        menu.classList.add('nekto-ui-panel');
        document.body.appendChild(menu);

        function renderMenu() {
            menu.innerHTML = '';
            gamesRegistry.forEach(g => {
                const item = document.createElement('div');
                item.style.cssText = 'width: 72px; height: 72px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: pointer; border-radius: 8px; background: rgba(255,255,255,0.05); transition: background 0.15s;';
                item.innerHTML = `<span style="font-size:26px;">${g.icon}</span><span style="font-size:9px; text-align:center; color:#ccc;">${g.title}</span>`;
                item.onmouseenter = () => item.style.background = 'rgba(255,255,255,0.15)';
                item.onmouseleave = () => item.style.background = 'rgba(255,255,255,0.05)';
                item.onclick = () => { g.open(); menu.style.display = 'none'; };
                menu.appendChild(item);
            });
        }

        launcher.onclick = () => {
            if (menu.style.display === 'grid') { menu.style.display = 'none'; return; }
            renderMenu();
            menu.style.display = 'grid';
        };
        document.addEventListener('click', e => {
            if (menu.style.display === 'grid' && !menu.contains(e.target) && e.target !== launcher) menu.style.display = 'none';
        });
    }

    function initWin98Dino() {
        if (document.getElementById('win98-dino-container')) return;

        const winC = document.createElement('div');
        winC.id = 'win98-dino-container';
        winC.classList.add('nekto-game-win');
        winC.style.cssText = `position: fixed; top: 80px; left: 50px; width: 600px; height: 250px; background-color: #c0c0c0; border-top: 2px solid #dfdfdf; border-left: 2px solid #dfdfdf; border-right: 2px solid #000000; border-bottom: 2px solid #000000; box-shadow: inset -1px -1px #808080, inset 1px 1px #ffffff, 4px 4px 10px rgba(0,0,0,0.3); z-index: 999997; display: none; flex-direction: column; resize: both; overflow: hidden; font-family: Tahoma, Arial, sans-serif; min-width: 300px; min-height: 150px;`;
        
        const titleBar = document.createElement('div');
        titleBar.classList.add('nekto-game-titlebar');
        titleBar.style.cssText = `background: linear-gradient(90deg, #000080, #1084d0); color: white; padding: 3px 6px; font-size: 12px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; cursor: default; user-select: none;`;
        const titleText = document.createElement('span'); titleText.innerText = 'Dino.exe';
        
        const controlsDiv = document.createElement('div'); controlsDiv.style.cssText = 'display: flex; align-items: center; gap: 8px;';
        const volContainer = document.createElement('div'); volContainer.style.cssText = 'display: flex; align-items: center; gap: 4px; position: relative;';
        const volIcon = document.createElement('span'); volIcon.innerText = '🔊'; volIcon.style.cssText = 'cursor: pointer; font-size: 14px;';
        const volSlider = document.createElement('input'); volSlider.type = 'range'; volSlider.min = '0'; volSlider.max = '1'; volSlider.step = '0.05'; volSlider.value = dinoVolume; volSlider.title = 'Громкость Дино'; volSlider.style.cssText = 'width: 70px; height: 10px; cursor: pointer; display: none; accent-color: #000080;';

        let sliderTimeout;
        volContainer.onmouseenter = () => { volSlider.style.display = 'block'; clearTimeout(sliderTimeout); };
        volContainer.onmouseleave = () => { sliderTimeout = setTimeout(() => volSlider.style.display = 'none', 800); };
        volSlider.addEventListener('mousedown', e => e.stopPropagation());
        
        volSlider.oninput = e => {
            dinoVolume = parseFloat(e.target.value); localStorage.setItem('nekto_dino_volume', dinoVolume);
            const iframe = document.querySelector('#win98-dino-container iframe');
            if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'SET_DINO_VOLUME', volume: dinoVolume }, '*');
        };

        volContainer.appendChild(volIcon); volContainer.appendChild(volSlider);
        const closeBtn = document.createElement('button'); closeBtn.innerText = 'X'; closeBtn.style.cssText = `background: #c0c0c0; border-top: 1px solid #fff; border-left: 1px solid #fff; border-right: 1px solid #000; border-bottom: 1px solid #000; color: black; font-weight: bold; font-size: 11px; width: 18px; height: 16px; line-height: 12px; padding: 0; cursor: pointer;`;
        closeBtn.classList.add('nekto-game-close');

        controlsDiv.appendChild(volContainer); controlsDiv.appendChild(closeBtn); titleBar.appendChild(titleText); titleBar.appendChild(controlsDiv); winC.appendChild(titleBar);

        const content = document.createElement('div'); content.classList.add('nekto-game-content'); content.style.cssText = 'flex-grow: 1; margin: 4px; border-top: 2px solid #808080; border-left: 2px solid #808080; border-right: 2px solid #fff; border-bottom: 2px solid #fff; background: white; position: relative;';
        const iframe = document.createElement('iframe'); iframe.style.cssText = 'width: 100%; height: 100%; border: none; display: block; pointer-events: auto;';
        // Не грузим src сразу — иначе Дино бегает в фоне ещё до того, как окно открыли

        content.appendChild(iframe); winC.appendChild(content); document.body.appendChild(winC);

        function loadDino() { iframe.src = 'https://wayou.github.io/t-rex-runner/#' + dinoVolume; }
        function unloadDino() { iframe.src = 'about:blank'; }
        closeBtn.onclick = () => { winC.style.display = 'none'; unloadDino(); };

        let isDragging = false, offsetX, offsetY;
        titleBar.addEventListener('mousedown', e => {
            if (e.target === closeBtn || e.target === volSlider || e.target === volIcon) return;
            isDragging = true; offsetX = e.clientX - winC.getBoundingClientRect().left; offsetY = e.clientY - winC.getBoundingClientRect().top;
            const overlay = document.createElement('div'); overlay.id = 'win98-drag-overlay'; overlay.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; z-index:10;'; content.appendChild(overlay);
        });
        document.addEventListener('mousemove', e => { if (isDragging) { winC.style.left = (e.clientX - offsetX) + 'px'; winC.style.top = (e.clientY - offsetY) + 'px'; }});
        document.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; const overlay = document.getElementById('win98-drag-overlay'); if (overlay) overlay.remove(); }});

        gamesRegistry.push({ id: 'dino', title: 'Dino.exe', icon: '🦖', open: () => { winC.style.display = 'flex'; loadDino(); } });
    }

    // Стиль по умолчанию — плавающий блок в углу, используется, когда лого собеседника не найдено на странице
    const DEFAULT_WAVE_STYLE = 'position: fixed; bottom: 80px; left: 20px; width: 220px; height: 56px; background: rgba(0,0,0,0.55); border-radius: 10px; z-index: 500; display:flex; align-items:center; justify-content:center; padding: 6px; box-sizing:border-box; backdrop-filter: blur(2px);';

    let iconCoverEl = null; // квадратик фона, перекрывающий круглое лого "?"

    // Ищем круглую иконку-заглушку собеседника без привязки к конкретным CSS-классам сайта
    // (они могут поменяться) — по факту, что рядом лежит текст "Разговор с ...".
    function findCallIcon() {
        const candidates = document.querySelectorAll('div, span, p, h1, h2, h3, h4');
        for (const el of candidates) {
            if (el.children.length === 0 && /Разговор\s+с/i.test(el.textContent || '')) {
                let container = el.parentElement;
                for (let level = 0; level < 4 && container; level++) {
                    const icon = container.querySelector('img, svg, [class*="avatar" i], [class*="icon" i], [class*="photo" i], [class*="pic" i]');
                    if (icon) return icon;
                    container = container.parentElement;
                }
            }
        }
        return null;
    }

    // Модалка подтверждения завершения диалога содержит кнопку "Отменить" (обычный экран звонка — нет).
    // Пока она открыта — прячем нашу волну и заглушку, чтобы не наслаиваться на попап.
    function isConfirmModalOpen() {
        const buttons = document.querySelectorAll('button, a, div[role="button"], span');
        for (const b of buttons) {
            if (/^Отменить$/i.test((b.textContent || '').trim())) {
                const rect = b.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) return true;
            }
        }
        return false;
    }

    function hideWaveOverlay() {
        const waveContainer = document.getElementById('nekto-wave-container');
        if (waveContainer) waveContainer.style.visibility = 'hidden';
        if (iconCoverEl) iconCoverEl.style.visibility = 'hidden';
        const muteBar = document.getElementById('nekto-mute-controls');
        if (muteBar) muteBar.style.visibility = 'hidden';
    }

    // Находит кнопку "Завершить" (та же, что определяет активный звонок в watchdog'е)
    function findCancelCallButton() {
        return document.querySelector('button.callScreen__cancelCallBtn') || document.querySelector('button.stop-talk-button');
    }

    function makeMuteButton(id) {
        const btn = document.createElement('button');
        btn.id = id;
        btn.style.cssText = 'font-family: Tahoma, Arial, sans-serif; font-size: 12px; font-weight: bold; padding: 8px 12px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.25); cursor: pointer; display: flex; align-items: center; gap: 6px; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.4); transition: background 0.15s;';
        return btn;
    }

    function updateMuteButtonsUI() {
        const btnCompanion = document.getElementById('nekto-btn-mute-companion');
        const btnMic = document.getElementById('nekto-btn-mute-mic');
        if (btnCompanion) {
            btnCompanion.innerHTML = companionMuted ? '🔇 Собеседник заглушён' : '🔊 Собеседник слышен';
            btnCompanion.style.background = companionMuted ? '#5a1f1f' : '#1f5a2e';
            btnCompanion.style.color = '#fff';
        }
        if (btnMic) {
            btnMic.innerHTML = micMuted ? '🚫 Мой микрофон заглушён' : '🎤 Мой микрофон включён';
            btnMic.style.background = micMuted ? '#5a1f1f' : '#1f5a2e';
            btnMic.style.color = '#fff';
        }
    }

    function initMuteControls() {
        if (document.getElementById('nekto-mute-controls')) return;

        const bar = document.createElement('div');
        bar.id = 'nekto-mute-controls';
        bar.style.cssText = 'position: fixed; z-index: 500; display: none; flex-direction: row; gap: 10px; visibility: hidden;';

        const btnCompanion = makeMuteButton('nekto-btn-mute-companion');
        btnCompanion.onclick = () => { companionMuted = !companionMuted; applyMuteStates(); updateMuteButtonsUI(); };

        const btnMic = makeMuteButton('nekto-btn-mute-mic');
        btnMic.onclick = () => { micMuted = !micMuted; applyMuteStates(); updateMuteButtonsUI(); };

        bar.appendChild(btnCompanion); bar.appendChild(btnMic);
        document.body.appendChild(bar);
        updateMuteButtonsUI();
    }

    function updateMuteControlsPlacement() {
        const bar = document.getElementById('nekto-mute-controls');
        if (!bar) return;

        if (!win.location.href.includes('/audiochat') || isConfirmModalOpen()) { bar.style.visibility = 'hidden'; return; }

        const cancelBtn = findCancelCallButton();
        if (!cancelBtn) { bar.style.visibility = 'hidden'; return; }

        const rect = cancelBtn.getBoundingClientRect();
        if (rect.width < 5 || rect.height < 5) { bar.style.visibility = 'hidden'; return; }

        bar.style.display = 'flex';
        bar.style.visibility = 'visible';
        bar.style.top = (rect.bottom + 12) + 'px';
        bar.style.left = rect.left + 'px';
    }

    function updateWaveformPlacement() {
        const waveContainer = document.getElementById('nekto-wave-container');
        if (!waveContainer) return;

        if (!win.location.href.includes('/audiochat')) {
            if (waveContainer.dataset.overlay === '1') {
                waveContainer.style.cssText = DEFAULT_WAVE_STYLE;
                waveContainer.dataset.overlay = '0';
                if (iconCoverEl) { iconCoverEl.remove(); iconCoverEl = null; }
            }
            return;
        }

        if (isConfirmModalOpen()) { hideWaveOverlay(); return; }

        const icon = findCallIcon();
        if (icon) {
            const rect = icon.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) return; // иконка ещё не отрисовалась нормально

            if (!iconCoverEl || !document.body.contains(iconCoverEl)) {
                iconCoverEl = document.createElement('div');
                iconCoverEl.id = 'nekto-icon-cover';
                iconCoverEl.style.cssText = 'position: fixed; z-index: 495; pointer-events: none;';
                document.body.appendChild(iconCoverEl);
            }

            // Берём цвет фона у одного из родителей иконки, чтобы квадрат-заглушка сливался незаметно
            let bg = 'rgb(18, 21, 28)';
            try {
                let node = icon.parentElement;
                for (let i = 0; i < 6 && node; i++) {
                    const cs = win.getComputedStyle(node);
                    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') { bg = cs.backgroundColor; break; }
                    node = node.parentElement;
                }
            } catch (e) {}

            iconCoverEl.style.visibility = 'visible';
            iconCoverEl.style.top = rect.top + 'px';
            iconCoverEl.style.left = rect.left + 'px';
            iconCoverEl.style.width = rect.width + 'px';
            iconCoverEl.style.height = rect.height + 'px';
            iconCoverEl.style.background = bg;
            try { iconCoverEl.style.borderRadius = win.getComputedStyle(icon).borderRadius || '0px'; } catch (e) {}

            // Ставим волну ровно на месте лого, чуть уменьшив, чтобы аккуратно вписаться в круг
            const padX = rect.width * 0.16, padY = rect.height * 0.32;
            waveContainer.style.cssText = `position: fixed; top: ${rect.top + padY}px; left: ${rect.left + padX}px; width: ${rect.width - padX * 2}px; height: ${rect.height - padY * 2}px; background: transparent; border-radius: 6px; z-index: 499; display:flex; align-items:center; justify-content:center; padding: 0; box-sizing:border-box; visibility: visible;`;
            waveContainer.dataset.overlay = '1';
        } else if (waveContainer.dataset.overlay === '1') {
            waveContainer.style.cssText = DEFAULT_WAVE_STYLE;
            waveContainer.dataset.overlay = '0';
            if (iconCoverEl) { iconCoverEl.remove(); iconCoverEl = null; }
        }
    }

    // Мгновенная реакция на появление иконки/модалки — без этого 500мс-интервал даёт
    // заметный "мигающий" кадр со значком "?" до того, как волна встанет на место.
    let waveObserverScheduled = false;
    function scheduleWaveformUpdate() {
        if (waveObserverScheduled) return;
        waveObserverScheduled = true;
        requestAnimationFrame(() => {
            waveObserverScheduled = false;
            try { updateWaveformPlacement(); } catch (e) {}
            try { updateMuteControlsPlacement(); } catch (e) {}
        });
    }

    // visualizer creation
    function initWaveformVisualizer() {
        if (document.getElementById('nekto-wave-container')) return;

        const container = document.createElement('div');
        container.id = 'nekto-wave-container';
        container.dataset.overlay = '0';
        container.style.cssText = DEFAULT_WAVE_STYLE;

        const canvas = document.createElement('canvas');
        canvas.width = 208; canvas.height = 44;
        canvas.style.cssText = 'width:100%; height:100%; display:block;';
        container.appendChild(canvas);
        container.appendChild(canvas);
        document.body.appendChild(container);

        const ctx2d = canvas.getContext('2d');
        const barCount = 32;

        // Подгоняем внутреннее разрешение canvas под реальный размер контейнера (он меняется,
        // когда виджет садится на лого собеседника разного размера).
        let lastW = 0, lastH = 0;
        function syncCanvasSize() {
            const w = Math.max(1, Math.round(container.clientWidth));
            const h = Math.max(1, Math.round(container.clientHeight));
            if (w !== lastW || h !== lastH) {
                canvas.width = w; canvas.height = h;
                lastW = w; lastH = h;
            }
        }

        function draw() {
            requestAnimationFrame(draw);
            syncCanvasSize();
            ctx2d.clearRect(0, 0, canvas.width, canvas.height);

            if (!remoteAnalyser || !chatActive) {
                // Нет собеседника — рисуем спокойную плоскую линию
                ctx2d.strokeStyle = 'rgba(255,255,255,0.15)';
                ctx2d.lineWidth = 2;
                ctx2d.beginPath();
                ctx2d.moveTo(0, canvas.height / 2);
                ctx2d.lineTo(canvas.width, canvas.height / 2);
                ctx2d.stroke();
                return;
            }

            const data = new Uint8Array(remoteAnalyser.frequencyBinCount);
            remoteAnalyser.getByteFrequencyData(data);

            const step = Math.max(1, Math.floor(data.length / barCount));
            const barWidth = canvas.width / barCount;

            for (let i = 0; i < barCount; i++) {
                let sum = 0;
                for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
                const avg = sum / step;
                const barHeight = Math.max(2, (avg / 255) * canvas.height);
                const hue = 150 + (avg / 255) * 60; // от зелёного к бирюзовому на пиках
                ctx2d.fillStyle = `hsl(${hue}, 80%, 55%)`;
                ctx2d.fillRect(i * barWidth + 1, canvas.height - barHeight, barWidth - 2, barHeight);
            }
        }
        draw();
    }

    // ==========================================
    // ТАЙМЕР ДОСТУПА К САЙТУ (переживает reload — считает по абсолютному времени)
    // ==========================================
    function formatMMSS(ms) {
        const totalSec = Math.max(0, Math.ceil(ms / 1000));
        const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
        return (h > 0 ? String(h).padStart(2, '0') + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function showAccessBlockOverlay(cooldownEnd) {
        if (document.getElementById('nekto-access-overlay')) { updateAccessOverlayCountdown(cooldownEnd); return; }
        const overlay = document.createElement('div');
        overlay.id = 'nekto-access-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:#0a0a0f; color:#fff; z-index:2147483647; display:flex; flex-direction:column; align-items:center; justify-content:center; font-family: Tahoma, Arial, sans-serif; text-align:center; gap:14px;';
        overlay.innerHTML = `
            <div style="font-size:52px;">⏳</div>
            <div style="font-size:22px; font-weight:bold;">Доступ к Nekto.me временно ограничен</div>
            <div style="font-size:15px; color:#aaa; max-width:400px;">Таймер поставлен по твоей же настройке. Осталось подождать:</div>
            <div id="nekto-access-countdown" style="font-size:40px; font-weight:bold; color:#ff5e5e; font-variant-numeric: tabular-nums;">--:--</div>
        `;
        document.body.appendChild(overlay);
        updateAccessOverlayCountdown(cooldownEnd);
    }
    function updateAccessOverlayCountdown(cooldownEnd) {
        const el = document.getElementById('nekto-access-countdown');
        if (el) el.innerText = formatMMSS(cooldownEnd - Date.now());
    }

    function showAccessSessionWidget(sessionEnd) {
        if (document.getElementById('nekto-access-widget')) { updateAccessWidgetCountdown(sessionEnd); return; }
        const w = document.createElement('div');
        w.id = 'nekto-access-widget';
        w.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.6); color:#fff; padding:6px 14px; border-radius:20px; font-family: Tahoma, Arial; font-size:13px; z-index:999998; display:flex; align-items:center; gap:8px; pointer-events:none;';
        w.innerHTML = '⏳ <span id="nekto-access-widget-time">--:--</span>';
        document.body.appendChild(w);
        updateAccessWidgetCountdown(sessionEnd);
    }
    function updateAccessWidgetCountdown(sessionEnd) {
        const el = document.getElementById('nekto-access-widget-time');
        if (el) el.innerText = formatMMSS(sessionEnd - Date.now());
    }

    // Проверяется каждую секунду, а не только на загрузке — чтобы переход сессия→блокировка
    // случился сразу, даже если вкладка всё это время была открыта.
    function tickAccessTimer() {
        const now = Date.now();
        let sessionEnd = parseInt(safeGetLocalStorage('nekto_access_session_end', '0')) || 0;
        let cooldownEnd = parseInt(safeGetLocalStorage('nekto_access_cooldown_end', '0')) || 0;
        const overlay = document.getElementById('nekto-access-overlay');
        const widget = document.getElementById('nekto-access-widget');

        if (cooldownEnd) {
            if (now < cooldownEnd) {
                showAccessBlockOverlay(cooldownEnd);
                if (widget) widget.remove();
                return;
            } else {
                localStorage.removeItem('nekto_access_cooldown_end');
                if (overlay) overlay.remove();
                cooldownEnd = 0;
            }
        }

        if (sessionEnd) {
            if (now < sessionEnd) {
                showAccessSessionWidget(sessionEnd);
            } else {
                // Сессия только что истекла (в т.ч. могла истечь пока вкладка была закрыта) — включаем блокировку.
                const cdMin = parseFloat(safeGetLocalStorage('nekto_access_cooldown_min', '30')) || 30;
                const newCooldownEnd = now + cdMin * 60000;
                localStorage.setItem('nekto_access_cooldown_end', String(newCooldownEnd));
                localStorage.removeItem('nekto_access_session_end');
                if (widget) widget.remove();
                showAccessBlockOverlay(newCooldownEnd);
            }
        } else if (overlay) {
            overlay.remove();
        }
    }

    function init() {
        tickAccessTimer(); // проверяем блокировку/сессию максимально рано, до остального UI
        setInterval(tickAccessTimer, 1000);

        buildUIPanels();
        applyUITheme(uiTheme);
        applyGameTheme(gameTheme);
        initPingBadge();
        setInterval(updatePingBadge, 2000);
        initWin98Dino();
        initExtraGames();
        initGamesLauncher();
        initVoiceEngine();
        initWaveformVisualizer();
        initMuteControls();

        // Мгновенно реагируем на появление/исчезновение иконки собеседника и модалок,
        // чтобы значок "?" не успевал промелькнуть перед глазами до того, как встанет волна.
        const waveObserver = new MutationObserver(scheduleWaveformUpdate);
        waveObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    win.addEventListener('resize', () => { try { updateWaveformPlacement(); updateMuteControlsPlacement(); } catch (e) {} });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();