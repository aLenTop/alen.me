// ==UserScript==
// @name         alen.me
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Script for Nekto.me
// @author       aLenTop
// @match        https://nekto.me/*
// @match        https://wayou.github.io/t-rex-runner/*
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';

    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    console.log('[Nekto.me Ultimate] Скрипт версии 2.0 запущен');

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

    // Дальше идёт основная часть. Запускаем её ТОЛЬКО в главном окне вкладки:
    // если скрипт исполнится ещё и внутри iframe (окна игр, любые вложенные фреймы),
    // поднимется второй движок распознавания, и два экземпляра начнут глушить друг друга
    // — в консоли это выглядит как бесконечный цикл 'aborted'.
    try {
        if (win.top !== win.self) {
            console.log('[alen.me] Пропуск запуска во вложенном фрейме');
            return;
        }
    } catch (e) { /* кросс-доменный фрейм — тоже не наш случай */ return; }

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
    let mediaKeysActive = safeGetLocalStorage('nekto_media_keys', 'false') === 'true';
    let micFxStrength = parseInt(safeGetLocalStorage('nekto_mic_fx_strength', '50')) || 50;
    let compFxStrength = parseInt(safeGetLocalStorage('nekto_comp_fx_strength', '50')) || 50;
    let momentDuration = parseFloat(safeGetLocalStorage('nekto_moment_duration', '3')) || 3;
    let iconOpacity = parseInt(safeGetLocalStorage('nekto_icon_opacity', '45')) || 45;
    let panelOpacity = parseInt(safeGetLocalStorage('nekto_panel_opacity', '100')) || 100;
    let siteTheme = safeGetLocalStorage('nekto_site_theme', 'default');
    let dbMeterOn = safeGetLocalStorage('nekto_db_meter', 'false') === 'true';
    // Движок «сбоев связи» держит ScriptProcessor в ГЛАВНОМ потоке и постоянно пишет
    // кольцевой буфер. Это заметная нагрузка, из-за которой звук собеседника может рваться,
    // поэтому по умолчанию он выключен и включается только когда фича реально нужна.
    let momentsEngineOn = safeGetLocalStorage('nekto_moments_engine', 'false') === 'true';
    // Безопасный режим: отключает ВСЁ необязательное (анимации, темы, метр, игры, пинг,
    // волну), оставляя только голосовые команды и скип/стоп/старт. Нужен, чтобы быстро
    // проверить, мешает ли распознаванию что-то из оформления.
    let safeMode = safeGetLocalStorage('nekto_safe_mode', 'false') === 'true';
    let glitchStyle = safeGetLocalStorage('nekto_glitch_style', 'cyber'); // 'cyber' | 'lain' | 'legacy'
    let dbMeterPos = null;
    try { dbMeterPos = JSON.parse(safeGetLocalStorage('nekto_db_meter_pos', 'null')); } catch (e) { dbMeterPos = null; }
    let iconEditMode = false; // не сохраняется: сбрасывается сам при обновлении вкладки
    let iconPositions = {}, hiddenIcons = [];
    try { iconPositions = JSON.parse(safeGetLocalStorage('nekto_icon_positions', '{}')) || {}; } catch (e) { iconPositions = {}; }
    try { hiddenIcons = JSON.parse(safeGetLocalStorage('nekto_hidden_icons', '[]')) || []; } catch (e) { hiddenIcons = []; }
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
    // intensity: 0..1 (50% = прежнее звучание). Каждый эффект интерполирует свои
    // ключевые параметры между "едва заметно" и "экстремально".
    function buildEffectChain(ctx, effectId, intensity) {
        const t = (typeof intensity === 'number' && !isNaN(intensity)) ? Math.max(0, Math.min(1, intensity)) : 0.5;
        const L = (a, b) => a + (b - a) * t;
        switch (effectId) {
            case 'phone': {
                const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = L(150, 500);
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = L(5000, 2000);
                hp.connect(lp);
                return { input: hp, output: lp, nodes: [hp, lp] };
            }
            case 'radio': {
                const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = L(300, 800);
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = L(4000, 2200);
                const shaper = ctx.createWaveShaper(); shaper.curve = makeDistortionCurve(L(5, 60));
                hp.connect(lp); lp.connect(shaper);
                return { input: hp, output: shaper, nodes: [hp, lp, shaper] };
            }
            case 'robot': {
                const ring = ctx.createGain(); ring.gain.value = 0;
                const carrier = ctx.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = L(25, 90);
                carrier.connect(ring.gain); carrier.start();
                return { input: ring, output: ring, nodes: [ring, carrier] };
            }
            case 'muffled': {
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = L(1000, 220); lp.Q.value = 1;
                return { input: lp, output: lp, nodes: [lp] };
            }
            case 'bitcrush': {
                const shaper = ctx.createWaveShaper(); shaper.curve = makeQuantizeCurve(Math.round(L(32, 4)));
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = L(6000, 2000);
                shaper.connect(lp);
                return { input: shaper, output: lp, nodes: [shaper, lp] };
            }
            case 'echo': {
                const input = ctx.createGain();
                const delay = ctx.createDelay(1.0); delay.delayTime.value = L(0.15, 0.45);
                const feedback = ctx.createGain(); feedback.gain.value = L(0.15, 0.6);
                const output = ctx.createGain();
                input.connect(output);
                input.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(output);
                return { input, output, nodes: [input, delay, feedback, output] };
            }
            case 'tremolo': {
                const depth = L(0.1, 0.7);
                const gain = ctx.createGain(); gain.gain.value = 1 - depth;
                const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 6;
                const lfoGain = ctx.createGain(); lfoGain.gain.value = depth;
                lfo.connect(lfoGain); lfoGain.connect(gain.gain); lfo.start();
                return { input: gain, output: gain, nodes: [gain, lfo, lfoGain] };
            }
            case 'megaphone': {
                const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = L(3400, 2200);
                const shaper = ctx.createWaveShaper(); shaper.curve = makeDistortionCurve(L(20, 120));
                hp.connect(lp); lp.connect(shaper);
                return { input: hp, output: shaper, nodes: [hp, lp, shaper] };
            }
            case 'glitch': {
                const depth = L(0.2, 0.8);
                const gain = ctx.createGain(); gain.gain.value = depth;
                const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = L(1.5, 6);
                const lfoGain = ctx.createGain(); lfoGain.gain.value = depth;
                lfo.connect(lfoGain); lfoGain.connect(gain.gain); lfo.start();
                return { input: gain, output: gain, nodes: [gain, lfo, lfoGain] };
            }
            case 'heavydegrade': {
                const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = L(3000, 1200);
                const shaper = ctx.createWaveShaper(); shaper.curve = makeDistortionCurve(L(30, 150));
                const crush = ctx.createWaveShaper(); crush.curve = makeQuantizeCurve(Math.round(L(16, 4)));
                hp.connect(lp); lp.connect(shaper); shaper.connect(crush);
                return { input: hp, output: crush, nodes: [hp, lp, shaper, crush] };
            }
            case 'cave': {
                const input = ctx.createGain(), output = ctx.createGain();
                const conv = ctx.createConvolver(); conv.buffer = makeImpulseResponse(ctx, L(1.2, 4), 3);
                const dry = ctx.createGain(); dry.gain.value = 0.65;
                const wet = ctx.createGain(); wet.gain.value = L(0.3, 1.1);
                input.connect(dry); dry.connect(output);
                input.connect(conv); conv.connect(wet); wet.connect(output);
                return { input, output, nodes: [input, output, conv, dry, wet] };
            }
            case 'stadium': {
                const input = ctx.createGain(), output = ctx.createGain();
                const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.42;
                const loopLp = ctx.createBiquadFilter(); loopLp.type = 'lowpass'; loopLp.frequency.value = 2400;
                const feedback = ctx.createGain(); feedback.gain.value = L(0.2, 0.68);
                const wet = ctx.createGain(); wet.gain.value = L(0.3, 0.85);
                input.connect(output);
                input.connect(delay); delay.connect(loopLp); loopLp.connect(feedback); feedback.connect(delay);
                delay.connect(wet); wet.connect(output);
                return { input, output, nodes: [input, output, delay, loopLp, feedback, wet] };
            }
            case 'flanger': {
                const input = ctx.createGain(), output = ctx.createGain();
                const delay = ctx.createDelay(0.05); delay.delayTime.value = 0.005;
                const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.25;
                const lfoGain = ctx.createGain(); lfoGain.gain.value = L(0.001, 0.006);
                lfo.connect(lfoGain); lfoGain.connect(delay.delayTime); lfo.start();
                const feedback = ctx.createGain(); feedback.gain.value = L(0.15, 0.6);
                delay.connect(feedback); feedback.connect(delay);
                const dry = ctx.createGain(); dry.gain.value = 0.7;
                const wet = ctx.createGain(); wet.gain.value = L(0.4, 0.9);
                input.connect(dry); dry.connect(output);
                input.connect(delay); delay.connect(wet); wet.connect(output);
                return { input, output, nodes: [input, output, delay, lfo, lfoGain, feedback, dry, wet] };
            }
            case 'chorus': {
                const input = ctx.createGain(), output = ctx.createGain();
                const dry = ctx.createGain(); dry.gain.value = 0.7; input.connect(dry); dry.connect(output);
                const nodes = [input, output, dry];
                [[0.020, 0.6, 0.004], [0.027, 0.35, 0.005]].forEach(([base, rate, depth]) => {
                    const d = ctx.createDelay(0.1); d.delayTime.value = base;
                    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = rate;
                    const lg = ctx.createGain(); lg.gain.value = depth * t * 2;
                    lfo.connect(lg); lg.connect(d.delayTime); lfo.start();
                    const w = ctx.createGain(); w.gain.value = L(0.3, 0.7);
                    input.connect(d); d.connect(w); w.connect(output);
                    nodes.push(d, lfo, lg, w);
                });
                return { input, output, nodes };
            }
            case 'vibrato': {
                const delay = ctx.createDelay(0.05); delay.delayTime.value = 0.008;
                const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = L(3, 8);
                const lfoGain = ctx.createGain(); lfoGain.gain.value = L(0.001, 0.007);
                lfo.connect(lfoGain); lfoGain.connect(delay.delayTime); lfo.start();
                return { input: delay, output: delay, nodes: [delay, lfo, lfoGain] };
            }
            case 'wah': {
                const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = L(2, 8);
                const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 1.3;
                const lfoGain = ctx.createGain(); lfoGain.gain.value = L(200, 900);
                lfo.connect(lfoGain); lfoGain.connect(bp.frequency); lfo.start();
                const makeup = ctx.createGain(); makeup.gain.value = 1.6;
                bp.connect(makeup);
                return { input: bp, output: makeup, nodes: [bp, lfo, lfoGain, makeup] };
            }
            case 'vinyl': {
                const input = ctx.createGain(), output = ctx.createGain();
                const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60;
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = L(9000, 5500);
                const shaper = ctx.createWaveShaper(); shaper.curve = makeDistortionCurve(L(3, 15));
                input.connect(hp); hp.connect(lp); lp.connect(shaper); shaper.connect(output);
                const noise = makeNoiseSource(ctx);
                const noiseBp = ctx.createBiquadFilter(); noiseBp.type = 'bandpass'; noiseBp.frequency.value = 5000; noiseBp.Q.value = 0.6;
                const noiseGain = ctx.createGain(); noiseGain.gain.value = L(0.004, 0.02);
                noise.connect(noiseBp); noiseBp.connect(noiseGain); noiseGain.connect(output);
                return { input, output, nodes: [input, output, hp, lp, shaper, noise, noiseBp, noiseGain] };
            }
            case 'lofi': {
                const input = ctx.createGain(), output = ctx.createGain();
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = L(5500, 2200);
                const crush = ctx.createWaveShaper(); crush.curve = makeQuantizeCurve(Math.round(L(40, 10)));
                const wow = ctx.createDelay(0.05); wow.delayTime.value = 0.004;
                const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.5;
                const lfoGain = ctx.createGain(); lfoGain.gain.value = L(0.0005, 0.0028);
                lfo.connect(lfoGain); lfoGain.connect(wow.delayTime); lfo.start();
                input.connect(lp); lp.connect(crush); crush.connect(wow); wow.connect(output);
                const noise = makeNoiseSource(ctx);
                const noiseGain = ctx.createGain(); noiseGain.gain.value = L(0.003, 0.014);
                noise.connect(noiseGain); noiseGain.connect(output);
                return { input, output, nodes: [input, output, lp, crush, wow, lfo, lfoGain, noise, noiseGain] };
            }
            case 'demon': {
                const depth = L(0.25, 0.65);
                const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = L(2400, 1200);
                const shaper = ctx.createWaveShaper(); shaper.curve = makeDistortionCurve(L(15, 70));
                const ring = ctx.createGain(); ring.gain.value = 1 - depth;
                const carrier = ctx.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = 55;
                const depthG = ctx.createGain(); depthG.gain.value = depth;
                carrier.connect(depthG); depthG.connect(ring.gain); carrier.start();
                lp.connect(shaper); shaper.connect(ring);
                return { input: lp, output: ring, nodes: [lp, shaper, ring, carrier, depthG] };
            }
            case 'alien': {
                const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 200;
                const ring = ctx.createGain(); ring.gain.value = 0;
                const carrier = ctx.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = L(80, 220);
                const drift = ctx.createOscillator(); drift.type = 'sine'; drift.frequency.value = 0.8;
                const driftGain = ctx.createGain(); driftGain.gain.value = L(20, 120);
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
        const chain = buildEffectChain(localAudioCtx, effectId, micFxStrength / 100);
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
        } else if (rawMicStream) {
            // Пайплайна нет (обработка не нужна) — глушим сам трек
            try { rawMicStream.getAudioTracks().forEach(t => { t.enabled = !micMuted; }); } catch (e) {}
        }
    }

    // Сайт вызывает getUserMedia на КАЖДОМ поиске собеседника ("searcging initUserMedia").
    // Раньше мы на каждый вызов захватывали микрофон заново, не отпуская предыдущий захват,
    // и пересобирали весь аудиограф. Устройство постоянно передёргивалось, из-за чего
    // Chrome обрывал сессию распознавания речи ('aborted') и голосовые команды не работали.
    // Теперь исходный поток микрофона захватывается ОДИН раз и переиспользуется.
    let rawMicStream = null;      // живой захват устройства (наш, сайту не отдаётся)
    let processedMicStream = null; // то, что отдаём сайту (после усиления/эффектов)

    // Пайплайн микрофона (AudioContext + MediaStreamSource поверх живого захвата)
    // нужен ТОЛЬКО если мы реально что-то делаем со звуком. Раньше он строился всегда,
    // и лишний аудиограф поверх микрофона мешал движку распознавания речи — сессия
    // обрывалась с 'aborted'. Если обработки нет, отдаём сайту исходный поток как есть.
    function micPipelineNeeded() {
        return micEffect !== 'none'
            || Math.abs(micGainValue - 1) > 0.01
            || selfListeningActive
            || micMuted;
    }

    function micTrackLive(stream) {
        return !!(stream && stream.getAudioTracks().some(t => t.readyState === 'live'));
    }

    if (win.navigator.mediaDevices && win.navigator.mediaDevices.getUserMedia) {
        const originalGetUserMedia = win.navigator.mediaDevices.getUserMedia.bind(win.navigator.mediaDevices);
        win.navigator.mediaDevices.getUserMedia = async function(constraints) {
            const wantsAudio = !!(constraints && constraints.audio);
            const wantsVideo = !!(constraints && constraints.video);

            if (!wantsAudio) return originalGetUserMedia(constraints); // не про микрофон — не вмешиваемся
            if (safeMode) return originalGetUserMedia(constraints);     // безопасный режим: не трогаем микрофон вообще

            // ВАЖНО: автоусиление (AGC) и шумодав отключаем ТОЛЬКО если сами строим цепочку
            // и компенсируем громкость своим усилением. Если цепочки нет, а AGC отключён,
            // сайт получает «сырой» тихий микрофон — собеседники жалуются на тихий голос,
            // хотя самопрослушивание (оно идёт после нашего усиления) звучит громко.
            if (micPipelineNeeded()) {
                if (typeof constraints.audio === 'object') {
                    constraints.audio.echoCancellation = false; constraints.audio.noiseSuppression = false; constraints.audio.autoGainControl = false;
                } else if (constraints.audio === true) {
                    constraints.audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
                }
            }

            // 1) Обработанный поток ещё жив — отдаём тот же самый, устройство не трогаем вовсе
            if (!wantsVideo && micPipelineNeeded() && micTrackLive(processedMicStream) && micTrackLive(rawMicStream)) {
                return processedMicStream;
            }
            // Если цепочка нужна, но раньше мы отдали сырой поток (AGC был включён) —
            // захватываем заново с нужными параметрами, иначе усиление ни на что не повлияет.
            if (micPipelineNeeded() && !processedMicStream && rawMicStream) {
                try { rawMicStream.getTracks().forEach(t => t.stop()); } catch (e) {}
                rawMicStream = null;
            }

            // 2) Живой захват устройства есть, но сайт остановил выданный ему поток —
            //    пересобираем только граф, БЕЗ нового обращения к микрофону
            let stream = micTrackLive(rawMicStream) ? rawMicStream : null;
            if (!stream) {
                stream = await originalGetUserMedia(constraints);
                rawMicStream = stream;
            }

            // Обработка не требуется (эффект «без эффекта», усиление 1.0x, самопрослушивание
            // выключено) — отдаём сайту чистый микрофон и НЕ строим аудиограф.
            if (stream && !micPipelineNeeded()) {
                if (localAudioCtx) {
                    try { if (localGainNode) localGainNode.disconnect(); localAudioCtx.close(); } catch(e) {}
                    localGainNode = null; localAudioCtx = null; isSelfListeningConnected = false; localEffectNodes = []; localEffectOutput = null; localDest = null;
                }
                processedMicStream = null;
                try { stream.getAudioTracks().forEach(t => { t.enabled = !micMuted; }); } catch (e) {}
                return stream;
            }

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
                processedMicStream = processedStream;
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
        const bufferSize = 8192; // крупнее буфер = устойчивее к подвисаниям главного потока
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

    // ==========================================
    // ВРЕМЕННЫЕ СБОИ ЗВУКА СОБЕСЕДНИКА ("залагало")
    // ==========================================
    // ScriptProcessor непрерывно пишет последние ~8 секунд голоса собеседника в
    // кольцевой буфер. Когда сбой активен, вместо живого звука отдаётся
    // манипуляция этим буфером: повтор последних слов, зажёванная плёнка,
    // перемотка и т.д. Поэтому "лагают" именно УЖЕ СКАЗАННЫЕ слова.
    let remoteMomentNode = null;
    let momentActive = null; // { id, durSamples, startN, endTime, data }

    const MOMENT_LIST = [
        { id: 'lagloop',    label: 'Залагало' },
        { id: 'stutter',    label: 'Заикание' },
        { id: 'randlag',    label: 'Рваный лаг' },
        { id: 'tapestop',   label: 'Зажевало плёнку' },
        { id: 'tapestart',  label: 'Разгон плёнки' },
        { id: 'rewind',     label: 'Перемотка' },
        { id: 'slowmo',     label: 'Замедление' },
        { id: 'fastfwd',    label: 'Ускорение' },
        { id: 'dropout',    label: 'Обрыв связи' },
        { id: 'packetloss', label: 'Потеря пакетов' },
        { id: 'freeze',     label: 'Зависание' },
        { id: 'echoburst',  label: 'Внезапное эхо' },
        { id: 'underwater', label: 'Нырок под воду' },
        { id: 'bitratedrop',label: 'Упал битрейт' },
        { id: 'wobble',     label: 'Плывёт скорость' },
        { id: 'reverseecho',label: 'Обратное эхо' },
        { id: 'gatechop',   label: 'Нарезка' },
        { id: 'scratch',    label: 'Скретч' },
        { id: 'staticburst',label: 'Треск помех' },
        { id: 'shuffle',    label: 'Перемешивание' }
    ];

    function createMomentFxNode(ctx) {
        const sr = ctx.sampleRate;
        const len = Math.round(sr * 8);
        const ring = new Float32Array(len);
        let n = 0;
        let lpY = 0; // состояние однополюсного фильтра для 'underwater'
        const node = ctx.createScriptProcessor(4096, 1, 1);

        function readAbs(pos) { // чтение из кольца по абсолютному индексу с интерполяцией
            if (pos >= n || n - pos >= len - 8) return 0;
            const i0 = Math.floor(pos), frac = pos - i0;
            const a = ring[((i0 % len) + len) % len];
            const b = ring[(((i0 + 1) % len) + len) % len];
            return a + (b - a) * frac;
        }

        node.onaudioprocess = (e) => {
            const inp = e.inputBuffer.getChannelData(0);
            const out = e.outputBuffer.getChannelData(0);
            for (let i = 0; i < inp.length; i++) {
                const live = inp[i];
                ring[n % len] = live;
                const st = momentActive;
                if (!st) { out[i] = live; lpY = live; n++; continue; }
                if (st.startN < 0) { st.startN = n; st.data = {}; }
                const el = n - st.startN;
                if (el >= st.durSamples) { momentActive = null; out[i] = live; n++; continue; }
                const d = st.data;
                let wet = live;
                switch (st.id) {
                    case 'lagloop': { const ch = Math.round(sr * 0.4); wet = readAbs(st.startN - ch + (el % ch)); break; }
                    case 'stutter': { const ch = Math.round(sr * 0.085); wet = readAbs(st.startN - ch + (el % ch)); break; }
                    case 'randlag': {
                        if (d.ch === undefined || el >= d.next) { d.ch = Math.round(sr * (0.06 + Math.random() * 0.24)); d.base = el; d.next = el + d.ch; }
                        wet = readAbs(st.startN - d.ch + ((el - d.base) % d.ch)); break;
                    }
                    case 'tapestop': {
                        if (d.pos === undefined) d.pos = st.startN;
                        const r = Math.max(0, 1 - (el / st.durSamples) * 1.15);
                        d.pos += r; wet = readAbs(d.pos) * (0.2 + 0.8 * r); break;
                    }
                    case 'tapestart': {
                        if (d.pos === undefined) d.pos = st.startN - sr * 0.7;
                        if (!st.done) {
                            const r = Math.min(1.35, 0.05 + (el / (st.durSamples * 0.8)) * 1.3);
                            d.pos += r;
                            if (d.pos >= n) st.done = true; else wet = readAbs(d.pos);
                        }
                        break;
                    }
                    case 'rewind': { if (d.pos === undefined) d.pos = st.startN; d.pos -= 2.2; wet = readAbs(d.pos) * 0.9; break; }
                    case 'slowmo': { if (d.pos === undefined) d.pos = st.startN; d.pos += 0.55; wet = readAbs(d.pos); break; }
                    case 'fastfwd': {
                        if (d.pos === undefined) d.pos = st.startN - sr * 1.5;
                        if (!st.done) { d.pos += 1.8; if (d.pos >= n) st.done = true; else wet = readAbs(d.pos); }
                        break;
                    }
                    case 'dropout': { const ph = (el / sr) % 0.8; wet = ph < 0.07 ? live * 0.6 : 0; break; }
                    case 'packetloss': {
                        const fr = Math.floor(el / (sr * 0.04));
                        if (d.fr !== fr) { d.fr = fr; d.mute = Math.random() < 0.55; }
                        wet = d.mute ? 0 : live; break;
                    }
                    case 'freeze': { const g = Math.round(sr * 0.03); wet = readAbs(st.startN - g + (el % g)); break; }
                    case 'echoburst': {
                        wet = live * 0.8 + readAbs(n - sr * 0.18) * 0.5 + readAbs(n - sr * 0.36) * 0.32 + readAbs(n - sr * 0.54) * 0.2;
                        break;
                    }
                    case 'underwater': {
                        const half = st.durSamples / 2;
                        const f = el < half ? 4000 - 3700 * (el / half) : 300 + 3700 * ((el - half) / half);
                        const k = 1 - Math.exp(-6.2832 * f / sr);
                        lpY += k * (live - lpY); wet = lpY; break;
                    }
                    case 'bitratedrop': {
                        if (d.h === undefined || el % 6 === 0) d.h = live;
                        wet = Math.round(d.h * 12) / 12; break;
                    }
                    case 'wobble': {
                        if (d.pos === undefined) d.pos = n - sr * 0.03;
                        d.pos += 1 + 0.25 * Math.sin(6.2832 * 1.7 * el / sr);
                        if (d.pos > n - 4) d.pos = n - 4;
                        wet = readAbs(d.pos); break;
                    }
                    case 'reverseecho': { wet = live * 0.7 + (el < sr * 2 ? readAbs(st.startN - el) * 0.55 : 0); break; }
                    case 'gatechop': { const per = Math.round(sr / 9); wet = (el % per) < per / 2 ? live : 0; break; }
                    case 'scratch': {
                        if (d.pos === undefined) { d.pos = st.startN - sr * 0.3; d.next = 0; d.r = 2; }
                        if (el >= d.next) {
                            const rates = [2.5, -2.5, 1.6, -1.2, 3.2];
                            d.r = rates[Math.floor(Math.random() * rates.length)];
                            d.next = el + Math.round(sr * (0.09 + Math.random() * 0.13));
                        }
                        d.pos += d.r;
                        if (d.pos > n - 4) d.pos = n - 4;
                        if (n - d.pos > len - sr) d.pos = n - len + sr;
                        wet = readAbs(d.pos) * 0.9; break;
                    }
                    case 'staticburst': {
                        const fr = Math.floor(el / (sr * 0.05));
                        if (d.fr !== fr) { d.fr = fr; d.noisy = Math.random() < 0.45; }
                        const v = live * 0.65 + (d.noisy ? (Math.random() * 2 - 1) * 0.4 : 0);
                        wet = Math.max(-1, Math.min(1, v * 1.8)); break;
                    }
                    case 'shuffle': {
                        const g = Math.round(sr * 0.15);
                        const gi = Math.floor(el / g);
                        if (d.g !== gi) { d.g = gi; d.off = Math.round(Math.random() * sr * 2) + 4; }
                        wet = readAbs(n - d.off); break;
                    }
                }
                // короткие кроссфейды в начале/конце, чтобы не щёлкало
                const fadeLen = Math.round(sr * 0.03);
                let mix = 1;
                if (el < fadeLen) mix = el / fadeLen;
                const tail = st.durSamples - el;
                if (tail < fadeLen) mix = Math.min(mix, tail / fadeLen);
                if (st.done) mix = 0;
                out[i] = wet * mix + live * (1 - mix);
                n++;
            }
        };
        return node;
    }

    // Включает/выключает узел сбоев в живой цепочке звука собеседника.
    // Вставка/удаление узла делается пересборкой хвоста цепочки через applyRemoteEffect.
    function setMomentsEngine(on) {
        if (!remoteAudioCtx || !remotePitchNode || !remotePitchGain) return; // разговор не идёт — применится при подключении
        if (on) {
            if (!remoteMomentNode) {
                try {
                    remoteMomentNode = createMomentFxNode(remoteAudioCtx);
                    remoteMomentNode.connect(remotePitchGain);
                } catch (e) { remoteMomentNode = null; }
            }
        } else {
            momentActive = null;
            if (remoteMomentNode) {
                try { remoteMomentNode.disconnect(); } catch (e) {}
                try { remoteMomentNode.onaudioprocess = null; } catch (e) {}
                remoteMomentNode = null;
            }
        }
        // пересобираем хвост: pitch -> [эффект] -> [сбои или напрямую] -> громкость
        try { applyRemoteEffect(companionEffect); } catch (e) {}
    }

    function triggerMoment(id) {
        if (momentActive && momentActive.id === id) { momentActive = null; return; } // повторный клик = отмена
        if (!remoteMomentNode || !remoteAudioCtx) { momentActive = null; return; }   // нет активного звонка
        const sr = remoteAudioCtx.sampleRate;
        momentActive = { id, durSamples: Math.round(momentDuration * sr), startN: -1, endTime: Date.now() + momentDuration * 1000, data: {} };
        console.log('[alen.me] Сбой запущен:', id, momentDuration + 'с');
    }

    let remoteSourceNode = null; // текущий источник (пересоздаётся под новый поток)

    function setupRemoteAudioPipeline(stream, mediaEl) {
        if (safeMode) return; // безопасный режим: звук собеседника идёт напрямую, без обработки
        try {
            // ВАЖНО: раньше на КАЖДЫЙ новый диалог контекст закрывался и создавался заново.
            // Создание/закрытие AudioContext — это операция с аудиоустройством, и Chrome
            // при ней обрывает активную сессию распознавания речи ('aborted'). Именно поэтому
            // голосовой скип работал только на первом собеседнике. Теперь контекст один
            // на всю страницу: под новый поток пересобираем только узлы внутри него.
            if (!remoteAudioCtx || remoteAudioCtx.state === 'closed') {
                remoteAudioCtx = new (win.AudioContext || win.webkitAudioContext)();
            }
            if (remoteSourceNode) { try { remoteSourceNode.disconnect(); } catch (e) {} remoteSourceNode = null; }
            if (remotePitchNode) { try { remotePitchNode.disconnect(); remotePitchNode.onaudioprocess = null; } catch (e) {} remotePitchNode = null; }
            if (remoteMomentNode) { try { remoteMomentNode.disconnect(); remoteMomentNode.onaudioprocess = null; } catch (e) {} remoteMomentNode = null; }
            if (remotePitchGain) { try { remotePitchGain.disconnect(); } catch (e) {} remotePitchGain = null; }
            teardownEffectNodes(remoteEffectNodes); remoteEffectNodes = [];

            const source = remoteAudioCtx.createMediaStreamSource(stream);
            remoteSourceNode = source;

            remoteAnalyser = remoteAudioCtx.createAnalyser();
            remoteAnalyser.fftSize = 256;
            remoteAnalyser.smoothingTimeConstant = 0.8;
            source.connect(remoteAnalyser); // только для волны громкости, звук отсюда никуда не идёт

            const pitchNode = createPitchShiftNode(remoteAudioCtx);
            remotePitchNode = pitchNode;
            remotePitchGain = remoteAudioCtx.createGain();
            remotePitchGain.gain.value = companionMuted ? 0 : chatVolume;
            source.connect(pitchNode);
            // Узел сбоев вставляем в цепочку только если движок включён — иначе он зря
            // молотит в главном потоке на каждом буфере и добавляет рывки звуку.
            remoteMomentNode = null;
            if (momentsEngineOn) {
                try { remoteMomentNode = createMomentFxNode(remoteAudioCtx); remoteMomentNode.connect(remotePitchGain); } catch (e) { remoteMomentNode = null; }
            }
            remoteEffectNodes = [];
            applyRemoteEffect(companionEffect); // подключает pitchNode -> [эффект] -> [сбои] -> remotePitchGain
            remotePitchGain.connect(remoteAudioCtx.destination);

            // Реальный звук теперь идёт через Web Audio (с учётом питча и эффекта) — родной
            // <audio> глушим навсегда, чтобы не было дублирования/эха.
            try { mediaEl.volume = 0; } catch (e) {}

            // Autoplay-политика может создать контекст в состоянии suspended — тогда весь
            // пайплайн молчит. Будим сразу и, на всякий случай, по первому клику.
            if (remoteAudioCtx.state === 'suspended') {
                remoteAudioCtx.resume().catch(() => {});
                const wake = () => { try { remoteAudioCtx && remoteAudioCtx.resume(); } catch (e) {} };
                document.addEventListener('click', wake, { once: true, capture: true });
            }
            console.log('[alen.me] Пайплайн собеседника подключён (питч/эффекты/сбои активны)');
            // Не ждём фоновый цикл — ставим волну на место немедленно
            try { scheduleWaveformUpdate(); } catch (e) {}
            setTimeout(() => { try { scheduleWaveformUpdate(); } catch (e) {} }, 60);
        } catch (e) {
            console.log('[Аудио] Не удалось подключить пайплайн собеседника:', e);
        }
    }

    // Подцепляет элемент к пайплайну, если в нём живёт аудиопоток собеседника и он ещё
    // не подцеплен (или поток сменился). Вызывается и из хука play(), и из сторожа.
    function pipeRemoteIfNeeded(mediaEl) {
        try {
            const st = mediaEl.srcObject;
            if (!st || !st.getAudioTracks || st.getAudioTracks().length === 0) return false;
            if (mediaEl._nektoPipedStream === st && remoteSourceNode) return true; // уже в работе
            mediaEl._nektoPipedStream = st;
            setupRemoteAudioPipeline(st, mediaEl);
            return true;
        } catch (e) { return false; }
    }

    // Пересобирает цепочку эффекта для ГОЛОСА СОБЕСЕДНИКА
    function applyRemoteEffect(effectId) {
        companionEffect = effectId;
        localStorage.setItem('nekto_companion_effect', effectId);
        if (!remoteAudioCtx || !remotePitchNode || !remotePitchGain) return; // звонка сейчас нет — применится при следующем
        try { remotePitchNode.disconnect(); } catch (e) {}
        teardownEffectNodes(remoteEffectNodes);
        const chain = buildEffectChain(remoteAudioCtx, effectId, compFxStrength / 100);
        remoteEffectNodes = chain.nodes;
        remotePitchNode.connect(chain.input);
        chain.output.connect(remoteMomentNode || remotePitchGain);
    }

    if (win.HTMLMediaElement && win.HTMLMediaElement.prototype) {
        const originalPlay = win.HTMLMediaElement.prototype.play;
        win.HTMLMediaElement.prototype.play = function() {
            if (this.srcObject && this.srcObject.getAudioTracks && this.srcObject.getAudioTracks().length > 0) {
                pipeRemoteIfNeeded(this);
            } else {
                try { this.volume = notificationVolume; } catch (e) {}
            }
            return originalPlay.apply(this, arguments);
        };
    }

    // Страховка №1: перехватываем присвоение srcObject — некоторые плееры стартуют через
    // autoplay-атрибут, вообще не вызывая play() из JS.
    try {
        const proto = win.HTMLMediaElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'srcObject');
        if (desc && desc.set) {
            Object.defineProperty(proto, 'srcObject', {
                get: desc.get,
                set: function(v) {
                    desc.set.call(this, v);
                    const el = this;
                    pipeRemoteIfNeeded(el);                     // пробуем сразу
                    setTimeout(() => pipeRemoteIfNeeded(el), 30); // и страховкой, если трек ещё не добавлен
                },
                configurable: true
            });
        }
    } catch (e) {}

    // Страховка №2: сторож — раз в 800 мс осматриваем все audio/video на странице.
    // Ловит случаи, когда элемент создан/запущен до загрузки скрипта или любым обходным путём.
    setInterval(() => {
        document.querySelectorAll('audio, video').forEach(el => {
            if (el.getAttribute && el.getAttribute('data-nekto-media-anchor')) return; // наш тихий якорь медиа-клавиш
            pipeRemoteIfNeeded(el);
        });
    }, 250);

    // ==========================================
    // ЛОГИКА КНОПОК ЧАТА
    // ==========================================
    function doStop() {
        weInitiatedSkip = true;
        try { suppressWave(1500); } catch (e) {} // волна исчезает в момент нажатия, а не после перерисовки
        let stopButton = document.querySelector('button.stop-talk-button') || document.querySelector('button.stop-and-complain-button') || document.querySelector('button.callScreen__cancelCallBtn');
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
        if (actionTriggered) { console.log('[Голос] Команда «стоп» пропущена: предыдущая ещё выполняется'); return; }
        actionTriggered = true;
        armActionFailsafe(8000);
        doStop(); setTimeout(releaseAction, 2000);
    }

    function cmdStart() {
        if (actionTriggered) { console.log('[Голос] Команда «старт» пропущена: предыдущая ещё выполняется'); return; }
        actionTriggered = true;
        armActionFailsafe(8000);
        doStart(); setTimeout(releaseAction, 2000);
    }

    // actionTriggered — блокировка повторных команд. Её главная опасность: если любой шаг
    // (doStop/doStart) бросит исключение, цепочка setTimeout не выполнится и флаг залипнет
    // навсегда — после этого КАЖДОЕ распознанное слово молча игнорируется, и складывается
    // ощущение «распознавание сломалось», хотя движок исправно слышит. Поэтому здесь:
    // 1) каждый шаг обёрнут в try/catch, 2) есть страховочный таймер, который снимает флаг
    // при любом исходе.
    let actionFailsafeTimer = null;
    function armActionFailsafe(ms) {
        clearTimeout(actionFailsafeTimer);
        actionFailsafeTimer = setTimeout(() => {
            if (actionTriggered) {
                console.log('[Голос] Страховка: снимаю зависшую блокировку команд');
                actionTriggered = false;
            }
        }, ms);
    }
    function releaseAction() {
        actionTriggered = false;
        clearTimeout(actionFailsafeTimer);
    }

    function cmdSkip() {
        if (actionTriggered) { console.log('[Голос] Команда «скип» пропущена: предыдущая ещё выполняется'); return; }
        actionTriggered = true;
        armActionFailsafe(cooldownTime * 1000 + 6000);
        try { suppressWave(1500); } catch (e) {}
        try { doStop(); } catch (e) { console.log('[Голос] Ошибка в doStop:', e); }
        setTimeout(() => {
            try { doStart(); } catch (e) { console.log('[Голос] Ошибка в doStart:', e); }
            setTimeout(releaseAction, 2000);
        }, cooldownTime * 1000);
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
    // ГЛОБАЛЬНЫЕ МЕДИА-КЛАВИШИ (работают даже при свёрнутом браузере)
    // ==========================================
    // Обычные клавиши фоновой вкладке недоступны в принципе, но медиа-клавиши
    // (⏭ ⏮ ⏯) ОС доставляет активному медиа-источнику через MediaSession API.
    // Трюк: крутим в фоне беззвучный WAV, чтобы вкладка считалась "играющей музыку",
    // и вешаем обработчики: ⏭ = скип, ⏮ = старт, ⏯ (пауза) = стоп.
    // Побочный эффект: пока опция включена, эти клавиши перехватываются у плееров
    // (Spotify и т.п.) — поэтому по умолчанию выключено.
    const SILENT_WAV = 'data:audio/wav;base64,UklGRmQfAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUAfAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
    let mediaAnchorAudio = null;
    let mediaKeysArmed = false;      // обработчики уже навешаны
    let mediaKeysWaitingGesture = false; // ждём первый клик, т.к. autoplay без жеста запрещён

    function armMediaSessionHandlers() {
        if (!('mediaSession' in navigator)) return;
        try {
            navigator.mediaSession.metadata = new win.MediaMetadata({
                title: 'alen.me — управление чатом',
                artist: '⏭ скип · ⏮ старт · ⏯ стоп',
                album: 'Nekto.me'
            });
        } catch (e) {}
        try { navigator.mediaSession.setActionHandler('nexttrack', () => cmdSkip()); } catch (e) {}
        try { navigator.mediaSession.setActionHandler('previoustrack', () => cmdStart()); } catch (e) {}
        try { navigator.mediaSession.setActionHandler('pause', () => {
            cmdStop();
            // не даём сессии "запаузиться" и умереть — тихий якорь должен играть дальше
            setTimeout(() => { try { mediaAnchorAudio && mediaAnchorAudio.play(); } catch (e) {} }, 200);
            try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
        }); } catch (e) {}
        try { navigator.mediaSession.setActionHandler('play', () => {
            cmdStart();
            try { mediaAnchorAudio && mediaAnchorAudio.play(); } catch (e) {}
            try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
        }); } catch (e) {}
        try { navigator.mediaSession.playbackState = 'playing'; } catch (e) {}
        mediaKeysArmed = true;
    }

    function disarmMediaSession() {
        if ('mediaSession' in navigator) {
            ['nexttrack', 'previoustrack', 'pause', 'play'].forEach(a => {
                try { navigator.mediaSession.setActionHandler(a, null); } catch (e) {}
            });
            try { navigator.mediaSession.metadata = null; } catch (e) {}
        }
        if (mediaAnchorAudio) { try { mediaAnchorAudio.pause(); mediaAnchorAudio.remove(); } catch (e) {} mediaAnchorAudio = null; }
        mediaKeysArmed = false;
    }

    function startMediaKeys() {
        if (mediaKeysArmed) return;
        if (!mediaAnchorAudio) {
            mediaAnchorAudio = document.createElement('audio');
            mediaAnchorAudio.src = SILENT_WAV;
            mediaAnchorAudio.loop = true;
            mediaAnchorAudio.volume = 0.01; // полностью muted-аудио Chrome игнорирует для media session
            mediaAnchorAudio.setAttribute('data-nekto-media-anchor', '1');
            document.body.appendChild(mediaAnchorAudio);
        }
        mediaAnchorAudio.play().then(() => {
            armMediaSessionHandlers();
            mediaKeysWaitingGesture = false;
        }).catch(() => {
            // Autoplay заблокирован до первого взаимодействия со страницей — взводим одноразовый триггер
            if (!mediaKeysWaitingGesture) {
                mediaKeysWaitingGesture = true;
                const onGesture = () => {
                    document.removeEventListener('click', onGesture, true);
                    document.removeEventListener('keydown', onGesture, true);
                    mediaKeysWaitingGesture = false;
                    if (mediaKeysActive) startMediaKeys();
                };
                document.addEventListener('click', onGesture, true);
                document.addEventListener('keydown', onGesture, true);
            }
        });
    }

    function setMediaKeys(active) {
        mediaKeysActive = active;
        localStorage.setItem('nekto_media_keys', active);
        if (active) startMediaKeys(); else disarmMediaSession();
    }

    // ==========================================
    // ИНДИКАТОР ПИНГА (RTT через WebRTC getStats)
    // ==========================================
    // Голос на nekto.me идёт по RTCPeerConnection — перехватываем создание соединений
    // и раз в 2 секунды снимаем currentRoundTripTime у активной пары кандидатов.
    const activePeerConnections = new Set();
    if (win.RTCPeerConnection && !safeMode) {
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
    let quickRestartTimer = null; // мгновенный подъём сессии сразу после её закрытия
    // Короткоживущий флаг: .start() уже вызван, ответа ещё нет. Нужен только чтобы
    // сторож и быстрый перезапуск не дёрнули start() одновременно — иначе Chrome
    // отвечает 'already started'. Снимается по любому событию и по таймауту.
    let startInFlight = false;
    let startInFlightTimer = null;
    // ВНИМАНИЕ: никакого «умного» отката здесь быть не должно.
    // В этом окружении Chrome регулярно обрывает сессию распознавания с 'aborted'
    // (по причинам вне скрипта). Рабочее поведение — продавливать это частыми
    // безусловными перезапусками раз в 1.5 секунды: тогда движок почти всегда живой
    // и успевает поймать команду. Экспоненциальный откат (3→6→12→15 с), который я
    // добавлял ранее, заставлял движок молчать по 15 секунд — команды терялись.

    // Создаёт СВЕЖИЙ объект SpeechRecognition. Это важно: после того как сессия
    // "зависает" (частая беда Chrome примерно на 40-60 секунде continuous-режима),
    // повторный .start() на СТАРОМ объекте иногда не поднимает распознавание,
    // и onend может вообще не сработать. Поэтому чиним не переиспользованием,
    // а полной пересборкой движка.
    // ==========================================
    // СОВРЕМЕННЫЕ ВОЗМОЖНОСТИ WEB SPEECH API
    // ==========================================
    // 1) processLocally — распознавание прямо НА УСТРОЙСТВЕ, без отправки звука на сервер.
    //    Именно серверные сессии рвутся, упираются в таймауты и зависят от сети — отсюда
    //    были постоянные обрывы и глухие паузы между перезапусками.
    // 2) phrases (контекстное смещение) — подсказываем движку наши командные слова,
    //    он узнаёт их приоритетно и заметно быстрее.
    // Обе возможности новые, поэтому всё под проверками: на старом браузере скрипт
    // просто продолжит работать как раньше.
    let localModeReady = false;

    async function prepareLocalRecognition() {
        const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
        if (!SR || typeof SR.available !== 'function') return;
        try {
            const status = await SR.available({ langs: ['ru-RU'], processLocally: true });
            if (status === 'available') {
                localModeReady = true;
                console.log('[Голос] Локальное распознавание доступно — работаем без сервера');
            } else if (status === 'downloadable' || status === 'downloading') {
                console.log('[Голос] Скачиваю языковой пакет для локального распознавания...');
                if (typeof SR.install === 'function') {
                    const ok = await SR.install({ langs: ['ru-RU'], processLocally: true });
                    if (ok) {
                        localModeReady = true;
                        console.log('[Голос] Языковой пакет установлен — перехожу на локальное распознавание');
                        recreateEngine(); // пересобираем движок уже в локальном режиме
                    }
                }
            }
        } catch (e) { /* браузер не поддерживает — не страшно */ }
    }

    // Подсказываем движку командные слова, чтобы он узнавал их увереннее
    function applyCommandPhrases(engine) {
        try {
            if (!win.SpeechRecognitionPhrase) return;
            const words = [].concat(wordsSkip, wordsStop, wordsStart).filter(Boolean);
            if (!words.length) return;
            engine.phrases = words.map(w => new win.SpeechRecognitionPhrase(w, 5.0));
        } catch (e) { /* свойство не поддерживается */ }
    }

    function createRecognitionEngine() {
        const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;
        if (!SpeechRecognition) return null;

        const engine = new SpeechRecognition();
        engine.continuous = true;
        engine.interimResults = true; // Возвращаем мгновенную реакцию
        engine.lang = 'ru-RU';
        engine.maxAlternatives = 1;

        // Локальный режим: сессия не зависит от сети и живёт куда стабильнее
        if (localModeReady) { try { engine.processLocally = true; } catch (e) {} }
        applyCommandPhrases(engine);

        engine.onstart = () => {
            startInFlight = false;
            isEngineRunning = true;
            lastVoiceActivity = Date.now();
            engineSessionStart = Date.now();
            console.log('[Голос] Движок слушает...');
        };

        engine.onend = () => {
            startInFlight = false;
            isEngineRunning = false;
            // Сессия распознавания в этом окружении живёт недолго и обрывается сама.
            // Раньше её поднимал только сторож — а он ждёт до 1.5 секунды, и всё это
            // время микрофон глухой: сказанное в паузу слово просто терялось. Отсюда
            // и ощущение «срабатывает сразу после обновления движка».
            // Теперь поднимаем сессию сразу же, как только она закрылась.
            if (engine === recognitionEngine) {
                clearTimeout(quickRestartTimer);
                // В локальном режиме перезапуск почти мгновенный, в серверном нужна
                // небольшая пауза — иначе Chrome отвечает 'already started'.
                quickRestartTimer = setTimeout(() => {
                    if (!isEngineRunning && recognitionEngine === engine) {
                        lastRestartAttempt = Date.now();
                        startEngine();
                    }
                }, localModeReady ? 60 : 120);
            }
        };

        engine.onerror = (e) => {
            startInFlight = false;
            if (e.error !== 'aborted') console.log('[Голос] Ошибка распознавания:', e.error);
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
        if (isEngineRunning || startInFlight) return; // уже слушает или запуск в процессе
        lastStartCallTime = Date.now();
        startInFlight = true;
        clearTimeout(startInFlightTimer);
        startInFlightTimer = setTimeout(() => { startInFlight = false; }, 1000); // страховка
        try {
            recognitionEngine.start();
        } catch (e) {
            // 'recognition has already started' значит, что сессия ЖИВА и слушает.
            // Раньше здесь шла пересборка через abort() — то есть мы своими руками
            // убивали рабочую сессию и запускали лавину перезапусков. Просто выходим.
            if (/already started/i.test(e.message || '')) {
                isEngineRunning = true;
                startInFlight = false;
                return;
            }
            console.log('[Голос] start() упал, пересобираю движок:', e.message);
            startInFlight = false;
            recreateEngine();
        }
    }

    // Защита от размножения экземпляров: если движок уже сообщил, что слушает,
    // повторный start() приведёт к 'already started' и лавине пересборок.
    function safeStartEngine() {
        if (isEngineRunning) return;
        startEngine();
    }

    function recreateEngine() {
        clearTimeout(quickRestartTimer);
        startInFlight = false;
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
        // Асинхронно выясняем, доступно ли локальное распознавание, и при необходимости
        // ставим языковой пакет. Пока идёт проверка, движок уже работает в обычном режиме.
        prepareLocalRecognition();
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
            try { media.volume = (media.srcObject && !safeMode) ? 0 : notificationVolume; } catch(e) {}
        });
        if (remotePitchGain) { try { remotePitchGain.gain.value = companionMuted ? 0 : chatVolume; } catch(e) {} }

        // Детектор чата
        let hasStopButton = !!(document.querySelector('button.stop-talk-button') || document.querySelector('button.stop-and-complain-button') || document.querySelector('button.callScreen__cancelCallBtn'));
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
                    // byMe: true — скипнул я, false — скипнул собеседник (или связь оборвалась)
                    dialogueHistory.push({ duration: Math.round(duration), timestamp: Date.now(), byMe: !!weInitiatedSkip });
                    if (dialogueHistory.length > 5000) dialogueHistory.shift();
                    localStorage.setItem('nekto_dialogue_history', JSON.stringify(dialogueHistory));
                }

                if (autoStartActive && !weInitiatedSkip) {
                    setTimeout(doStart, 100);
                }

                // Диалог закончился — глушим анализатор волны, чтобы не тянуть мёртвый стрим
                // Контекст оставляем жить — его закрытие/пересоздание рвёт распознавание речи.
                // Отключаем только узлы: звук мёртвого потока через них всё равно не идёт.
                if (remoteSourceNode) { try { remoteSourceNode.disconnect(); } catch (e) {} remoteSourceNode = null; }
                if (remotePitchNode) { try { remotePitchNode.disconnect(); remotePitchNode.onaudioprocess = null; } catch (e) {} remotePitchNode = null; }
                if (remoteMomentNode) { try { remoteMomentNode.disconnect(); remoteMomentNode.onaudioprocess = null; } catch (e) {} remoteMomentNode = null; }
                if (remotePitchGain) { try { remotePitchGain.disconnect(); } catch (e) {} remotePitchGain = null; }
                teardownEffectNodes(remoteEffectNodes); remoteEffectNodes = [];
                remoteAnalyser = null; momentActive = null;
            }
        }

        // WATCHDOG 1: Воскрешение уснувшего микрофона (движок сам сообщил, что не работает)
        if (!isEngineRunning && !startInFlight && recognitionEngine) {
            // Основной подъём делает onend; сторож — страховка на случай, если
            // onend не пришёл вовсе (Chrome изредка «теряет» событие).
            if (Date.now() - lastRestartAttempt > 1200) {
                lastRestartAttempt = Date.now();
                safeStartEngine();
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
    }, 300);

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
    // РЕТРО-НЕОН СКИН (единый вид всего интерфейса скрипта)
    // ==========================================
    // Чёрный фон, пиксельный шрифт, малиновые рамки со свечением, радужная полоса
    // сверху и глитч-заголовки — в стиле README проекта. Цвет неона задаётся
    // переменной --nk-accent, которую переключают 10 цветовых тем ниже.
    function injectRetroSkin() {
        if (document.getElementById('nekto-retro-skin')) return;
        const st = document.createElement('style');
        st.id = 'nekto-retro-skin';
        st.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;600;700&family=Press+Start+2P&display=swap');
            :root {
                --nk-white: #ffffff;
                --nk-red:   #ff4b4b;
                --nk-green: #3fdc5c;
                --nk-accent: #3fdc5c;               /* "цветной акцент" = по умолчанию зелёный */
                --nk-bg: #0a0a0f;
                --nk-input: #000000;
                --nk-font-head: 'Pixelify Sans','Courier New',monospace;
                --nk-font-body: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
            }

            /* ---- панели/модалки: чёрный фон, белая чёткая рамка, без свечения ---- */
            .nekto-ui-panel {
                background: rgba(10, 10, 15, var(--nk-panel-op, 1)) !important;
                color: var(--nk-white) !important;
                border: 2px solid var(--nk-white) !important;
                border-radius: 12px !important;
                box-shadow: none !important;
                font-family: var(--nk-font-body) !important;
                position: relative;
            }
            .nekto-ui-panel * { font-family: var(--nk-font-body); }

            /* ---- заголовки: пиксельный шрифт, белый, без сглаживания и без свечения ---- */
            .nekto-ui-panel h3 {
                color: var(--nk-white) !important;
                text-transform: uppercase; letter-spacing: 2px; font-weight: 700;
                border-bottom: 2px solid var(--nk-white) !important;
                text-align: center; position: relative;   /* центрируем; линия статична, не глитчится */
            }
            /* заголовок: глитч только на тексте; по умолчанию покоится, приступы вешает JS */
            .nekto-ui-panel h3 .nk-title {
                display: inline-block;
                font-family: var(--nk-font-head) !important;
                text-shadow: none;
                -webkit-font-smoothing: none; font-smooth: never; image-rendering: pixelated;
                will-change: transform, text-shadow;
            }
            .nekto-ui-panel h3 button { position: absolute; right: 0; top: 50%; transform: translateY(-50%); }
            /* Логотип сайта, переименованный в alen.me: пиксель + глитч, inline-block чтобы не двигать шапку */
            .nk-logo {
                /* только лого — Press Start 2P: в нём нет кириллицы, но "alen.me" латиница */
                font-family: 'Press Start 2P', var(--nk-font-head) !important;
                font-weight: 700 !important;
                font-size: 24px !important;
                line-height: 1 !important;
                letter-spacing: 1px !important;
                color: #ffffff !important;
                display: inline-block; position: relative; white-space: nowrap; vertical-align: middle;
                -webkit-font-smoothing: none; font-smooth: never; image-rendering: pixelated;
                will-change: transform, text-shadow;
            }

            /* ===== 10 вариантов глитча заголовка (по одному прогону) ===== */
            .nk-title.nkg1, .nk-logo.nkg1 { animation: nkG1 .5s steps(1) 1; }
            .nk-title.nkg2, .nk-logo.nkg2 { animation: nkG2 .55s steps(1) 1; }
            .nk-title.nkg3, .nk-logo.nkg3 { animation: nkG3 .45s steps(2) 1; }
            .nk-title.nkg4, .nk-logo.nkg4 { animation: nkG4 .6s steps(1) 1; }
            .nk-title.nkg5, .nk-logo.nkg5 { animation: nkG5 .4s steps(1) 1; }
            .nk-title.nkg6, .nk-logo.nkg6 { animation: nkG6 .5s steps(1) 1; }
            .nk-title.nkg7, .nk-logo.nkg7 { animation: nkG7 .6s steps(1) 1; }
            .nk-title.nkg8, .nk-logo.nkg8 { animation: nkG8 .5s steps(3) 1; }
            .nk-title.nkg9, .nk-logo.nkg9 { animation: nkG9 .55s steps(1) 1; }
            .nk-title.nkg10, .nk-logo.nkg10 { animation: nkG10 .6s steps(1) 1; }

            @keyframes nkG1 { /* RGB-раздвоение + тряска */
                0%,100%{transform:translate(0,0);text-shadow:none;}
                20%{transform:translate(-4px,0);text-shadow:-4px 0 var(--nk-red),4px 0 var(--nk-green);}
                40%{transform:translate(4px,0);text-shadow:4px 0 var(--nk-red),-4px 0 var(--nk-green);}
                60%{transform:translate(-3px,0);text-shadow:-3px 0 var(--nk-green),3px 0 var(--nk-red);}
                80%{transform:translate(2px,0);text-shadow:2px 0 var(--nk-red),-2px 0 var(--nk-green);}
            }
            @keyframes nkG2 { /* горизонтальная нарезка строки */
                0%,100%{clip-path:none;transform:translate(0,0);text-shadow:none;}
                25%{clip-path:inset(0 0 65% 0);transform:translate(-6px,0);text-shadow:-3px 0 var(--nk-red);}
                50%{clip-path:inset(60% 0 0 0);transform:translate(6px,0);text-shadow:3px 0 var(--nk-green);}
                75%{clip-path:inset(35% 0 35% 0);transform:translate(-4px,0);text-shadow:-3px 0 var(--nk-red),3px 0 var(--nk-green);}
            }
            @keyframes nkG3 { /* перекос */
                0%,100%{transform:skewX(0) translate(0,0);text-shadow:none;}
                50%{transform:skewX(-16deg) translate(3px,0);text-shadow:-3px 0 var(--nk-green),3px 0 var(--nk-red);}
            }
            @keyframes nkG4 { /* вертикальный прыжок */
                0%,100%{transform:translate(0,0);text-shadow:none;}
                30%{transform:translate(0,-4px);text-shadow:0 -3px var(--nk-red),0 3px var(--nk-green);}
                60%{transform:translate(0,3px);text-shadow:0 3px var(--nk-red),0 -3px var(--nk-green);}
            }
            @keyframes nkG5 { /* мерцание */
                0%,100%{opacity:1;text-shadow:none;}
                20%{opacity:.2;}
                40%{opacity:1;text-shadow:-3px 0 var(--nk-red),3px 0 var(--nk-green);}
                60%{opacity:.35;}
                80%{opacity:1;}
            }
            @keyframes nkG6 { /* сжатие/растяжение по ширине */
                0%,100%{transform:scaleX(1);text-shadow:none;}
                30%{transform:scaleX(1.25) translate(-3px,0);text-shadow:-4px 0 var(--nk-green);}
                60%{transform:scaleX(.8) translate(3px,0);text-shadow:4px 0 var(--nk-red);}
            }
            @keyframes nkG7 { /* резкий слэм влево-вправо */
                0%,100%{transform:translate(0,0);text-shadow:none;}
                25%{transform:translate(-9px,0);text-shadow:-6px 0 var(--nk-red),6px 0 var(--nk-green);}
                50%{transform:translate(9px,0);text-shadow:6px 0 var(--nk-red),-6px 0 var(--nk-green);}
                75%{transform:translate(-5px,0);}
            }
            @keyframes nkG8 { /* тяжёлое дрожание с нарезкой */
                0%,100%{transform:translate(0,0);clip-path:none;text-shadow:none;}
                20%{transform:translate(-3px,1px);clip-path:inset(0 0 70% 0);text-shadow:-4px 0 var(--nk-red),4px 0 var(--nk-green);}
                40%{transform:translate(3px,-1px);clip-path:inset(50% 0 20% 0);}
                60%{transform:translate(-2px,1px);clip-path:inset(20% 0 60% 0);text-shadow:4px 0 var(--nk-green),-4px 0 var(--nk-red);}
                80%{transform:translate(2px,0);clip-path:inset(75% 0 0 0);}
            }
            @keyframes nkG9 { /* растяжение по ширине (без letter-spacing — чтобы не двигать соседей) */
                0%,100%{transform:scaleX(1) translate(0,0);text-shadow:none;}
                40%{transform:scaleX(1.3) translate(-3px,0);text-shadow:-3px 0 var(--nk-red),3px 0 var(--nk-green);}
                70%{transform:scaleX(.8) translate(3px,0);}
            }
            @keyframes nkG10 { /* инверсия-вспышка */
                0%,100%{filter:none;transform:translate(0,0);text-shadow:none;}
                25%{filter:invert(1);transform:translate(-4px,0);}
                50%{filter:none;text-shadow:-4px 0 var(--nk-green),4px 0 var(--nk-red);transform:translate(4px,0);}
                75%{filter:invert(1);transform:translate(-2px,0);}
            }

            /* ===== ОБЫЧНАЯ смена вкладок (плавно, без глитча) ===== */
            @keyframes nkPaneFade { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform:none; } }
            .nk-pane-in { animation: nkPaneFade .18s ease; }

            /* ===== нажатие вкладки: мягко продавливается и возвращается ===== */
            .nekto-ui-panel .nk-tab:active { transform: scale(.96); }

            /* ===== CRT/глитч-появление окна (точка → яркая линия → раскрытие) ===== */
            @keyframes nkPanelOpen {
                0%{transform:var(--nkc,translate(-50%,-50%)) scale(0,.02); opacity:.4; filter:brightness(2.2);}
                40%{transform:var(--nkc,translate(-50%,-50%)) scale(1.18,.03); opacity:1; filter:brightness(2.2);}
                55%{transform:var(--nkc,translate(-50%,-50%)) scale(1.12,.04) translate(-4px,0); filter:drop-shadow(-6px 0 var(--nk-red)) drop-shadow(6px 0 var(--nk-green)) brightness(1.6);}
                72%{transform:var(--nkc,translate(-50%,-50%)) scale(1.04,.7) translate(3px,0); filter:none;}
                88%{transform:var(--nkc,translate(-50%,-50%)) scale(.98,1.06); }
                100%{transform:var(--nkc,translate(-50%,-50%)) scale(1,1); opacity:1; filter:none;}
            }
            .nekto-ui-panel.nk-open { animation: nkPanelOpen .3s cubic-bezier(.2,.85,.2,1); }

            /* ===== глитч-сворачивание окна при закрытии ===== */
            @keyframes nkPanelClose {
                0%{opacity:1; clip-path: inset(0 0 0 0); filter:none;}
                18%{clip-path: inset(0 0 62% 0);}
                34%{clip-path: inset(56% 0 0 0);}
                50%{clip-path: inset(22% 0 22% 0); filter: invert(1);}
                70%{clip-path: inset(38% 0 38% 0); filter:none; opacity:.7;}
                100%{opacity:0; clip-path: inset(49% 0 49% 0);}
            }
            .nekto-ui-panel.nk-close { animation: nkPanelClose .28s steps(4) forwards; }

            /* ===== 10 вариантов полноэкранного глитча ВСЕГО окна =====
               (двигаем сам .nekto-ui-panel; var(--nkc) держит центрирование, чтобы окно не улетало) */

            /* ==========================================================
               ДВА НАБОРА С ПРИНЦИПИАЛЬНО РАЗНОЙ МЕХАНИКОЙ ДВИЖЕНИЯ
               (раньше оба использовали одно и то же: сдвиг + скос + clip-path,
                менялись только цвета — отсюда ощущение одинаковости)

               LAIN   — непрерывное РАСТВОРЕНИЕ: окно проявляется и тает через
                        маску-градиент, фосфорное расплывание (blur), медленный
                        дрейф. Плавные ease-кривые, длительность 1.8–3 сек,
                        никаких рывков и мгновенных скачков.

               CYBER  — дискретные ТЕЛЕПОРТЫ: timing-function steps(1), то есть
                        значения ДЕРЖАТСЯ и меняются мгновенно, без интерполяции
                        вообще. Окно режется маской на десятки полос, которые
                        пропадают и возвращаются. Длительность 0.5–0.9 сек.
               ========================================================== */

            /* ===================== LAIN ===================== */

            /* Слой: мягкая статика, медленно проступает и уходит. Без дёрганья. */
            .nk-lain-ov {
                position: absolute; inset: 0; pointer-events: none; z-index: 2147483000;
                border-radius: inherit; overflow: hidden; opacity: 0;
                background:
                    repeating-linear-gradient(0deg, rgba(0,0,0,.5) 0 1px, rgba(0,0,0,0) 1px 3px),
                    radial-gradient(120% 80% at 50% 50%, rgba(224,160,74,.28), rgba(138,111,255,.20) 60%, rgba(0,0,0,.45));
                background-size: 100% 3px, 100% 100%;
                animation: nkLainOv 2.4s ease-in-out 1;
            }
            @keyframes nkLainOv {
                0%   { opacity: 0;   background-position: 0 0, 0 0; }
                25%  { opacity: .85; background-position: 0 -60px, 0 0; }
                60%  { opacity: .55; background-position: 0 -150px, 0 0; }
                100% { opacity: 0;   background-position: 0 -260px, 0 0; }
            }

            .nekto-ui-panel.nkl1  { animation: nkLain1  2.4s ease-in-out 1; }
            .nekto-ui-panel.nkl2  { animation: nkLain2  2.8s ease-in-out 1; }
            .nekto-ui-panel.nkl3  { animation: nkLain3  2.2s ease-in-out 1; }
            .nekto-ui-panel.nkl4  { animation: nkLain4  2.6s ease-out 1; }
            .nekto-ui-panel.nkl5  { animation: nkLain5  3s   linear 1; }
            .nekto-ui-panel.nkl6  { animation: nkLain6  2s   ease-in-out 1; }
            .nekto-ui-panel.nkl7  { animation: nkLain7  2.6s ease-in-out 1; }
            .nekto-ui-panel.nkl8  { animation: nkLain8  1.8s ease-out 1; }
            .nekto-ui-panel.nkl9  { animation: nkLain9  2.4s ease-in-out 1; }
            .nekto-ui-panel.nkl10 { animation: nkLain10 3s   ease-in-out 1; }

            /* 1. Растворение сверху вниз: окно исчезает и проступает обратно */
            @keyframes nkLain1 {
                0%   { -webkit-mask-image:linear-gradient(180deg,transparent 0%,#000 28%,#000 72%,transparent 100%);mask-image:linear-gradient(180deg,transparent 0%,#000 28%,#000 72%,transparent 100%);-webkit-mask-size:100% 260%;mask-size:100% 260%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat; -webkit-mask-position:0 -140%; mask-position:0 -140%; filter:none; }
                45%  { -webkit-mask-position:0 40%; mask-position:0 40%; filter:brightness(1.2) sepia(.25); }
                100% { -webkit-mask-position:0 200%; mask-position:0 200%; filter:none; }
            }

            /* 2. Фосфорное расплывание: изображение плывёт и медленно собирается */
            @keyframes nkLain2 {
                0%,100% { filter:none; opacity:1; transform:var(--nkc,translate(-50%,-50%)); }
                30%  { filter:blur(3px) brightness(1.5) sepia(.4); opacity:.85; transform:var(--nkc,translate(-50%,-50%)) translate(0,-4px); }
                55%  { filter:blur(6px) brightness(1.8) sepia(.6); opacity:.6; }
                80%  { filter:blur(2px) brightness(1.2); opacity:.9; transform:var(--nkc,translate(-50%,-50%)) translate(0,3px); }
            }

            /* 3. Медленный дрейф развёртки: кадр плавно ползёт, маска идёт следом */
            @keyframes nkLain3 {
                0%   { transform:var(--nkc,translate(-50%,-50%)) translate(0,0); -webkit-mask-image:linear-gradient(180deg,#000,#000);mask-image:linear-gradient(180deg,#000,#000);-webkit-mask-size:100% 200%;mask-size:100% 200%; -webkit-mask-position:0 0; mask-position:0 0; }
                50%  { transform:var(--nkc,translate(-50%,-50%)) translate(0,-10px); -webkit-mask-position:0 60px; mask-position:0 60px; filter:brightness(1.25); }
                100% { transform:var(--nkc,translate(-50%,-50%)) translate(0,0); -webkit-mask-position:0 130px; mask-position:0 130px; }
            }

            /* 4. Послесвечение: вспышка и долгое затухание следа */
            @keyframes nkLain4 {
                0%   { filter:none; }
                12%  { filter:brightness(2.2) drop-shadow(0 0 10px rgba(224,160,74,.95)); }
                40%  { filter:brightness(1.4) blur(1.5px) drop-shadow(0 0 26px rgba(224,160,74,.7)); }
                70%  { filter:brightness(1.15) drop-shadow(0 0 34px rgba(138,111,255,.5)); }
                100% { filter:none; }
            }

            /* 5. Оседание в статику: окно тонет в помехах и выныривает */
            @keyframes nkLain5 {
                0%,100% { opacity:1; filter:none; }
                20%  { opacity:.75; filter:contrast(.7) saturate(.4) blur(1px); }
                45%  { opacity:.35; filter:contrast(.45) saturate(.15) blur(3px) brightness(1.3); }
                70%  { opacity:.7;  filter:contrast(.8) saturate(.5) blur(1px); }
            }

            /* 6. Дыхание: очень медленная пульсация яркости и масштаба */
            @keyframes nkLain6 {
                0%,100% { transform:var(--nkc,translate(-50%,-50%)) scale(1); filter:none; }
                50%  { transform:var(--nkc,translate(-50%,-50%)) scale(1.02); filter:brightness(1.3) sepia(.3) saturate(.7); }
            }

            /* 7. Выгорание: янтарный отпечаток проступает и медленно уходит */
            @keyframes nkLain7 {
                0%,100% { filter:none; }
                25%  { filter:sepia(.8) saturate(2) brightness(1.35); }
                55%  { filter:sepia(1) saturate(2.6) brightness(1.5) drop-shadow(0 0 18px rgba(224,160,74,.8)); }
                80%  { filter:sepia(.5) brightness(1.2); }
            }

            /* 8. Дематериализация: окно растворяется вверх и возвращается */
            @keyframes nkLain8 {
                0%   { -webkit-mask-image:linear-gradient(180deg,transparent 0%,#000 28%,#000 72%,transparent 100%);mask-image:linear-gradient(180deg,transparent 0%,#000 28%,#000 72%,transparent 100%);-webkit-mask-size:100% 260%;mask-size:100% 260%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat; -webkit-mask-position:0 200%; mask-position:0 200%; filter:brightness(1.6); }
                55%  { -webkit-mask-position:0 30%; mask-position:0 30%; filter:brightness(1.2) blur(1px); }
                100% { -webkit-mask-position:0 -140%; mask-position:0 -140%; filter:none; }
            }

            /* 9. Цветовое растекание: каналы медленно расходятся и сходятся */
            @keyframes nkLain9 {
                0%,100% { filter:none; }
                35%  { filter:drop-shadow(-5px 0 rgba(224,160,74,.55)) drop-shadow(5px 0 rgba(138,111,255,.55)) blur(.6px); }
                65%  { filter:drop-shadow(-9px 0 rgba(224,160,74,.4)) drop-shadow(9px 0 rgba(138,111,255,.4)) blur(1.4px) brightness(1.2); }
            }

            /* 10. Полное истаивание: уходит в ничто и медленно собирается */
            @keyframes nkLain10 {
                0%   { -webkit-mask-image:linear-gradient(180deg,transparent 0%,#000 28%,#000 72%,transparent 100%);mask-image:linear-gradient(180deg,transparent 0%,#000 28%,#000 72%,transparent 100%);-webkit-mask-size:100% 260%;mask-size:100% 260%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat; -webkit-mask-position:0 -140%; mask-position:0 -140%; filter:none; opacity:1; }
                30%  { -webkit-mask-position:0 20%; mask-position:0 20%; filter:blur(2px) brightness(1.4) sepia(.4); }
                50%  { -webkit-mask-position:0 90%; mask-position:0 90%; filter:blur(5px) brightness(1.7) sepia(.7); opacity:.5; }
                72%  { -webkit-mask-position:0 30%; mask-position:0 30%; filter:blur(2px) brightness(1.3); opacity:.85; }
                100% { -webkit-mask-position:0 -140%; mask-position:0 -140%; filter:none; opacity:1; }
            }

            /* ===================== CYBER ===================== */

            /* Слой: жёсткие блоки, меняются мгновенно (steps) */
            .nk-cyber-ov {
                position: absolute; inset: 0; pointer-events: none; z-index: 2147483000;
                border-radius: inherit; overflow: hidden;
                background:
                    repeating-linear-gradient(90deg, rgba(0,240,255,.20) 0 10px, rgba(0,0,0,0) 10px 26px),
                    linear-gradient(180deg, rgba(252,238,10,0) 46%, rgba(252,238,10,.65) 50%, rgba(252,238,10,0) 54%),
                    linear-gradient(180deg, rgba(255,0,60,.35), rgba(214,0,255,.35));
                background-size: 100% 100%, 100% 28%, 100% 100%;
                background-repeat: repeat, no-repeat, no-repeat;
                animation: nkCyOv .8s steps(1) 1;
            }
            @keyframes nkCyOv {
                0%   { background-position: 0 0, 0 -30%; opacity: 1; }
                14%  { background-position: 40px 0, 0 25%; opacity: .5; }
                28%  { background-position: -26px 0, 0 60%; opacity: 1; }
                42%  { background-position: 60px 0, 0 15%; opacity: .35; }
                58%  { background-position: -40px 0, 0 95%; opacity: 1; }
                72%  { background-position: 20px 0, 0 130%; opacity: .6; }
                88%  { background-position: -10px 0, 0 160%; opacity: .25; }
                100% { opacity: 0; }
            }

            /* steps(1) = значения ДЕРЖАТСЯ и переключаются мгновенно, без плавности */
            .nekto-ui-panel.nkc1  { animation: nkCy1  .7s  steps(1) 1; }
            .nekto-ui-panel.nkc2  { animation: nkCy2  .75s steps(1) 1; }
            .nekto-ui-panel.nkc3  { animation: nkCy3  .6s  steps(1) 1; }
            .nekto-ui-panel.nkc4  { animation: nkCy4  .55s steps(1) 1; }
            .nekto-ui-panel.nkc5  { animation: nkCy5  .8s  steps(1) 1; }
            .nekto-ui-panel.nkc6  { animation: nkCy6  .65s steps(1) 1; }
            .nekto-ui-panel.nkc7  { animation: nkCy7  .7s  steps(1) 1; }
            .nekto-ui-panel.nkc8  { animation: nkCy8  .75s steps(1) 1; }
            .nekto-ui-panel.nkc9  { animation: nkCy9  .6s  steps(1) 1; }
            .nekto-ui-panel.nkc10 { animation: nkCy10 .9s  steps(1) 1; }

            /* 1. НАРЕЗКА: окно распадается на горизонтальные полосы */
            @keyframes nkCy1 {
                0%,100% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)); filter:none; }
                12% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(-30px,0); }
                24% { -webkit-mask-image:repeating-linear-gradient(0deg,transparent 0 13px,#000 13px 26px);mask-image:repeating-linear-gradient(0deg,transparent 0 13px,#000 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(28px,0); }
                36% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(-16px,0); filter:saturate(4); }
                50% { -webkit-mask-image:repeating-linear-gradient(0deg,transparent 0 13px,#000 13px 26px);mask-image:repeating-linear-gradient(0deg,transparent 0 13px,#000 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(34px,0); filter:invert(1); }
                64% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(-22px,0); filter:none; }
                80% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)) translate(10px,0); filter:brightness(1.8); }
            }

            /* 2. ВЕРТИКАЛЬНЫЙ ШРЕД: колонки выпадают и возвращаются */
            @keyframes nkCy2 {
                0%,100% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)); filter:none; }
                14% { -webkit-mask-image:repeating-linear-gradient(90deg,#000 0 34px,transparent 34px 68px);mask-image:repeating-linear-gradient(90deg,#000 0 34px,transparent 34px 68px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(0,-18px); filter:drop-shadow(-14px 0 #ff003c); }
                28% { -webkit-mask-image:repeating-linear-gradient(90deg,#000 0 34px,transparent 34px 68px);mask-image:repeating-linear-gradient(90deg,#000 0 34px,transparent 34px 68px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(0,16px); filter:drop-shadow(14px 0 #00f0ff); }
                44% { -webkit-mask-image:repeating-linear-gradient(45deg,#000 0 18px,transparent 18px 36px);mask-image:repeating-linear-gradient(45deg,#000 0 18px,transparent 18px 36px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)); filter:saturate(5) hue-rotate(80deg); }
                58% { -webkit-mask-image:repeating-linear-gradient(90deg,#000 0 34px,transparent 34px 68px);mask-image:repeating-linear-gradient(90deg,#000 0 34px,transparent 34px 68px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(0,-10px); filter:invert(1); }
                74% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)); filter:brightness(2); }
                88% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 4px,transparent 4px 8px);mask-image:repeating-linear-gradient(0deg,#000 0 4px,transparent 4px 8px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)); filter:none; }
            }

            /* 3. ДИАГОНАЛЬНЫЙ РАЗРЕЗ */
            @keyframes nkCy3 {
                0%,100% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)); filter:none; }
                16% { -webkit-mask-image:repeating-linear-gradient(45deg,#000 0 18px,transparent 18px 36px);mask-image:repeating-linear-gradient(45deg,#000 0 18px,transparent 18px 36px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(-26px,10px); filter:saturate(4); }
                34% { -webkit-mask-image:repeating-linear-gradient(45deg,#000 0 18px,transparent 18px 36px);mask-image:repeating-linear-gradient(45deg,#000 0 18px,transparent 18px 36px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(26px,-10px); filter:invert(1) contrast(2); }
                52% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)); filter:drop-shadow(0 0 22px #fcee0a); }
                70% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)) translate(-12px,0); filter:brightness(2.2); }
                86% { -webkit-mask-image:repeating-linear-gradient(45deg,#000 0 18px,transparent 18px 36px);mask-image:repeating-linear-gradient(45deg,#000 0 18px,transparent 18px 36px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)); filter:none; }
            }

            /* 4. СТОП-КАДР: держит, потом мгновенный скачок */
            @keyframes nkCy4 {
                0%,100% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)); filter:none; }
                55% { transform:var(--nkc,translate(-50%,-50%)); filter:none; }
                60% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 4px,transparent 4px 8px);mask-image:repeating-linear-gradient(0deg,#000 0 4px,transparent 4px 8px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(-40px,0); filter:invert(1) saturate(5); }
                68% { transform:var(--nkc,translate(-50%,-50%)) translate(38px,0); filter:brightness(3); }
                76% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(-20px,0); filter:sepia(1) saturate(9) hue-rotate(-35deg); }
                88% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)); filter:none; }
            }

            /* 5. РАЗВАЛ БЛОКАМИ: половины окна расходятся мгновенными скачками */
            @keyframes nkCy5 {
                0%,100% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)); filter:none; }
                10% { -webkit-mask-image:linear-gradient(180deg,#000 0 50%,transparent 50% 100%); mask-image:linear-gradient(180deg,#000 0 50%,transparent 50% 100%); transform:var(--nkc,translate(-50%,-50%)) translate(-44px,0); }
                24% { -webkit-mask-image:linear-gradient(180deg,transparent 0 50%,#000 50% 100%); mask-image:linear-gradient(180deg,transparent 0 50%,#000 50% 100%); transform:var(--nkc,translate(-50%,-50%)) translate(42px,0); }
                38% { -webkit-mask-image:linear-gradient(90deg,#000 0 50%,transparent 50% 100%); mask-image:linear-gradient(90deg,#000 0 50%,transparent 50% 100%); transform:var(--nkc,translate(-50%,-50%)) translate(0,-26px); filter:saturate(5); }
                52% { -webkit-mask-image:linear-gradient(90deg,transparent 0 50%,#000 50% 100%); mask-image:linear-gradient(90deg,transparent 0 50%,#000 50% 100%); transform:var(--nkc,translate(-50%,-50%)) translate(0,24px); filter:invert(1); }
                68% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)); filter:brightness(2.4); }
                84% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)); filter:none; }
            }

            /* 6. ЧЕРЕДОВАНИЕ ПОЛОС: чётные и нечётные мигают по очереди */
            @keyframes nkCy6 {
                0%,100% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)); filter:none; }
                10% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)); filter:sepia(1) saturate(9) hue-rotate(-35deg); }
                22% { -webkit-mask-image:repeating-linear-gradient(0deg,transparent 0 13px,#000 13px 26px);mask-image:repeating-linear-gradient(0deg,transparent 0 13px,#000 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)); filter:hue-rotate(170deg) saturate(6); }
                34% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(-14px,0); }
                46% { -webkit-mask-image:repeating-linear-gradient(0deg,transparent 0 13px,#000 13px 26px);mask-image:repeating-linear-gradient(0deg,transparent 0 13px,#000 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(14px,0); filter:invert(1); }
                58% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)); filter:brightness(2.6); }
                70% { -webkit-mask-image:repeating-linear-gradient(0deg,transparent 0 13px,#000 13px 26px);mask-image:repeating-linear-gradient(0deg,transparent 0 13px,#000 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)); filter:none; }
                84% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 4px,transparent 4px 8px);mask-image:repeating-linear-gradient(0deg,#000 0 4px,transparent 4px 8px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)); filter:saturate(4); }
            }

            /* 7. СТРОБ БЕЗ ДВИЖЕНИЯ: окно мигает кусками на месте */
            @keyframes nkCy7 {
                0%,100% { -webkit-mask-image:none;mask-image:none; opacity:1; filter:none; }
                8%  { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 4px,transparent 4px 8px);mask-image:repeating-linear-gradient(0deg,#000 0 4px,transparent 4px 8px);-webkit-mask-size:100% 100%;mask-size:100% 100%; opacity:1; filter:sepia(1) saturate(10) hue-rotate(-40deg) brightness(1.8); }
                18% { -webkit-mask-image:none;mask-image:none; opacity:.25; }
                26% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; opacity:1; filter:invert(1); }
                36% { -webkit-mask-image:none;mask-image:none; opacity:.4; filter:brightness(3); }
                46% { -webkit-mask-image:repeating-linear-gradient(90deg,#000 0 34px,transparent 34px 68px);mask-image:repeating-linear-gradient(90deg,#000 0 34px,transparent 34px 68px);-webkit-mask-size:100% 100%;mask-size:100% 100%; opacity:1; filter:hue-rotate(180deg) saturate(7); }
                58% { -webkit-mask-image:none;mask-image:none; opacity:.2; }
                68% { -webkit-mask-image:repeating-linear-gradient(0deg,transparent 0 13px,#000 13px 26px);mask-image:repeating-linear-gradient(0deg,transparent 0 13px,#000 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; opacity:1; filter:sepia(1) saturate(8) hue-rotate(-35deg); }
                80% { -webkit-mask-image:none;mask-image:none; opacity:1; filter:brightness(2); }
                92% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 4px,transparent 4px 8px);mask-image:repeating-linear-gradient(0deg,#000 0 4px,transparent 4px 8px);-webkit-mask-size:100% 100%;mask-size:100% 100%; opacity:1; filter:none; }
            }

            /* 8. ПЕРЕЗАПУСК: полоса развёртки стирает и восстанавливает окно */
            @keyframes nkCy8 {
                0%,100% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)); filter:none; }
                12% { -webkit-mask-image:linear-gradient(180deg,#000 0 12%,transparent 12%); mask-image:linear-gradient(180deg,#000 0 12%,transparent 12%); filter:brightness(2.6); }
                26% { -webkit-mask-image:linear-gradient(180deg,#000 0 38%,transparent 38%); mask-image:linear-gradient(180deg,#000 0 38%,transparent 38%); }
                40% { -webkit-mask-image:linear-gradient(180deg,#000 0 66%,transparent 66%); mask-image:linear-gradient(180deg,#000 0 66%,transparent 66%); filter:saturate(5); }
                54% { -webkit-mask-image:linear-gradient(180deg,#000 0 92%,transparent 92%); mask-image:linear-gradient(180deg,#000 0 92%,transparent 92%); }
                66% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; filter:invert(1); }
                80% { -webkit-mask-image:none;mask-image:none; filter:brightness(1.8); }
            }

            /* 9. ТЕЛЕПОРТ: окно скачками появляется в разных местах */
            @keyframes nkCy9 {
                0%,100% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)); filter:none; }
                14% { transform:var(--nkc,translate(-50%,-50%)) translate(-52px,-18px); filter:drop-shadow(-18px 0 #ff003c) drop-shadow(18px 0 #00f0ff); }
                28% { transform:var(--nkc,translate(-50%,-50%)) translate(48px,16px); filter:saturate(6); }
                42% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(-30px,22px); filter:invert(1); }
                56% { transform:var(--nkc,translate(-50%,-50%)) translate(36px,-24px); filter:brightness(2.8); }
                72% { -webkit-mask-image:repeating-linear-gradient(90deg,#000 0 34px,transparent 34px 68px);mask-image:repeating-linear-gradient(90deg,#000 0 34px,transparent 34px 68px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(-14px,0); filter:hue-rotate(150deg) saturate(5); }
                88% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)) translate(6px,0); filter:none; }
            }

            /* 10. ПОЛНЫЙ ОТКАЗ: нарезка, стирание, темнота, сборка */
            @keyframes nkCy10 {
                0%,100% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)); filter:none; opacity:1; }
                8%  { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(-46px,0); filter:drop-shadow(-20px 0 #ff003c) drop-shadow(20px 0 #00f0ff); }
                18% { -webkit-mask-image:repeating-linear-gradient(0deg,transparent 0 13px,#000 13px 26px);mask-image:repeating-linear-gradient(0deg,transparent 0 13px,#000 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(44px,0); filter:invert(1) contrast(2.4); }
                28% { -webkit-mask-image:repeating-linear-gradient(90deg,#000 0 34px,transparent 34px 68px);mask-image:repeating-linear-gradient(90deg,#000 0 34px,transparent 34px 68px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(0,-30px); filter:saturate(7) hue-rotate(90deg); }
                38% { -webkit-mask-image:repeating-linear-gradient(45deg,#000 0 18px,transparent 18px 36px);mask-image:repeating-linear-gradient(45deg,#000 0 18px,transparent 18px 36px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(0,26px); filter:brightness(3); }
                48% { -webkit-mask-image:linear-gradient(180deg,#000 0 20%,transparent 20%); mask-image:linear-gradient(180deg,#000 0 20%,transparent 20%); filter:sepia(1) saturate(10) hue-rotate(-35deg); }
                58% { -webkit-mask-image:none;mask-image:none; opacity:.15; filter:brightness(.1); }
                68% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 4px,transparent 4px 8px);mask-image:repeating-linear-gradient(0deg,#000 0 4px,transparent 4px 8px);-webkit-mask-size:100% 100%;mask-size:100% 100%; opacity:1; filter:brightness(3); }
                78% { -webkit-mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);mask-image:repeating-linear-gradient(0deg,#000 0 13px,transparent 13px 26px);-webkit-mask-size:100% 100%;mask-size:100% 100%; transform:var(--nkc,translate(-50%,-50%)) translate(-18px,0); filter:hue-rotate(200deg) saturate(6); }
                90% { -webkit-mask-image:none;mask-image:none; transform:var(--nkc,translate(-50%,-50%)) translate(8px,0); filter:brightness(1.6); }
            }

            .nekto-ui-panel.nkf1 { animation: nkFull1 .8s steps(2) 1; }
            .nekto-ui-panel.nkf2 { animation: nkFull2 .8s steps(2) 1; }
            .nekto-ui-panel.nkf3 { animation: nkFull3 .75s steps(3) 1; }
            .nekto-ui-panel.nkf4 { animation: nkFull4 .8s steps(2) 1; }
            .nekto-ui-panel.nkf5 { animation: nkFull5 .7s steps(2) 1; }
            .nekto-ui-panel.nkf6 { animation: nkFull6 .85s steps(2) 1; }
            .nekto-ui-panel.nkf7 { animation: nkFull7 .8s steps(3) 1; }
            .nekto-ui-panel.nkf8 { animation: nkFull8 .8s steps(2) 1; }
            .nekto-ui-panel.nkf9 { animation: nkFull9 .75s steps(2) 1; }
            .nekto-ui-panel.nkf10 { animation: nkFull10 .9s steps(2) 1; }

            @keyframes nkFull1 {
                0%,100%{transform:var(--nkc,translate(-50%,-50%));filter:none;clip-path:none;}
                12%{transform:var(--nkc,translate(-50%,-50%)) translate(-14px,3px);filter:drop-shadow(-8px 0 var(--nk-red)) drop-shadow(8px 0 var(--nk-green));}
                28%{transform:var(--nkc,translate(-50%,-50%)) translate(14px,-3px);clip-path:inset(0 0 72% 0);}
                45%{transform:var(--nkc,translate(-50%,-50%)) translate(-10px,0);clip-path:inset(45% 0 25% 0);}
                62%{transform:var(--nkc,translate(-50%,-50%)) translate(12px,2px);filter:invert(1);clip-path:none;}
                80%{transform:var(--nkc,translate(-50%,-50%)) translate(-6px,0);filter:none;}
            }
            @keyframes nkFull2 {
                0%,100%{transform:var(--nkc,translate(-50%,-50%));clip-path:none;filter:none;}
                15%{transform:var(--nkc,translate(-50%,-50%)) translate(0,-10px);clip-path:inset(0 0 60% 0);filter:drop-shadow(0 -6px var(--nk-red));}
                35%{transform:var(--nkc,translate(-50%,-50%)) translate(3px,10px);clip-path:inset(55% 0 0 0);}
                55%{transform:var(--nkc,translate(-50%,-50%)) translate(-3px,-6px);clip-path:inset(30% 0 40% 0);filter:invert(1);}
                75%{transform:var(--nkc,translate(-50%,-50%)) translate(0,6px);filter:none;}
            }
            @keyframes nkFull3 {
                0%,100%{transform:var(--nkc,translate(-50%,-50%)) skewX(0);filter:none;}
                33%{transform:var(--nkc,translate(-50%,-50%)) skewX(-12deg) translate(-8px,0);filter:drop-shadow(-6px 0 var(--nk-green)) drop-shadow(6px 0 var(--nk-red));}
                66%{transform:var(--nkc,translate(-50%,-50%)) skewX(10deg) translate(8px,0);clip-path:inset(35% 0 35% 0);}
            }
            @keyframes nkFull4 {
                0%,100%{filter:none;transform:var(--nkc,translate(-50%,-50%));}
                20%{filter:invert(1);transform:var(--nkc,translate(-50%,-50%)) translate(-6px,0);}
                40%{filter:none;transform:var(--nkc,translate(-50%,-50%)) translate(6px,0);}
                60%{filter:invert(1) hue-rotate(90deg);transform:var(--nkc,translate(-50%,-50%)) translate(-4px,2px);}
                80%{filter:none;}
            }
            @keyframes nkFull5 {
                0%,100%{clip-path:none;transform:var(--nkc,translate(-50%,-50%));filter:none;}
                20%{clip-path:inset(0 0 85% 0);transform:var(--nkc,translate(-50%,-50%)) translate(-12px,0);}
                40%{clip-path:inset(30% 0 55% 0);transform:var(--nkc,translate(-50%,-50%)) translate(12px,0);}
                60%{clip-path:inset(60% 0 20% 0);transform:var(--nkc,translate(-50%,-50%)) translate(-8px,0);}
                80%{clip-path:inset(80% 0 0 0);transform:var(--nkc,translate(-50%,-50%)) translate(8px,0);}
            }
            @keyframes nkFull6 {
                0%,100%{transform:var(--nkc,translate(-50%,-50%));filter:none;}
                10%{transform:var(--nkc,translate(-50%,-50%)) translate(-4px,2px);filter:drop-shadow(-8px 0 var(--nk-red)) drop-shadow(8px 0 var(--nk-green));}
                25%{transform:var(--nkc,translate(-50%,-50%)) translate(5px,-2px);}
                40%{transform:var(--nkc,translate(-50%,-50%)) translate(-5px,1px);filter:drop-shadow(8px 0 var(--nk-green)) drop-shadow(-8px 0 var(--nk-red));}
                55%{transform:var(--nkc,translate(-50%,-50%)) translate(4px,-1px);}
                70%{transform:var(--nkc,translate(-50%,-50%)) translate(-3px,0);filter:invert(1);}
                85%{transform:var(--nkc,translate(-50%,-50%)) translate(3px,0);filter:none;}
            }
            @keyframes nkFull7 {
                0%,100%{transform:var(--nkc,translate(-50%,-50%)) scale(1);filter:none;}
                30%{transform:var(--nkc,translate(-50%,-50%)) scale(1.06,.9) translate(-6px,0);filter:drop-shadow(-6px 0 var(--nk-red));}
                60%{transform:var(--nkc,translate(-50%,-50%)) scale(.94,1.08) translate(6px,0);filter:drop-shadow(6px 0 var(--nk-green));}
            }
            @keyframes nkFull8 {
                0%,100%{transform:var(--nkc,translate(-50%,-50%));clip-path:none;filter:none;}
                14%{transform:var(--nkc,translate(-50%,-50%)) translate(-16px,0);clip-path:inset(0 0 70% 0);}
                28%{transform:var(--nkc,translate(-50%,-50%)) translate(16px,0);clip-path:inset(50% 0 25% 0);filter:invert(1);}
                42%{transform:var(--nkc,translate(-50%,-50%)) translate(-12px,3px);clip-path:none;filter:none;}
                56%{transform:var(--nkc,translate(-50%,-50%)) translate(12px,-3px);filter:drop-shadow(6px 0 var(--nk-green)) drop-shadow(-6px 0 var(--nk-red));}
                70%{transform:var(--nkc,translate(-50%,-50%)) translate(-8px,0);}
                85%{transform:var(--nkc,translate(-50%,-50%)) translate(5px,0);}
            }
            @keyframes nkFull9 {
                0%,100%{transform:var(--nkc,translate(-50%,-50%));filter:none;}
                25%{transform:var(--nkc,translate(-50%,-50%)) translate(-10px,-6px);filter:drop-shadow(-6px -4px var(--nk-red));}
                50%{transform:var(--nkc,translate(-50%,-50%)) translate(10px,6px);filter:drop-shadow(6px 4px var(--nk-green));}
                75%{transform:var(--nkc,translate(-50%,-50%)) translate(-6px,4px);filter:invert(1);}
            }
            @keyframes nkFull10 {
                0%,100%{transform:var(--nkc,translate(-50%,-50%)) skewX(0);clip-path:none;filter:none;}
                10%{transform:var(--nkc,translate(-50%,-50%)) translate(-12px,4px) skewX(-6deg);filter:drop-shadow(-8px 0 var(--nk-red)) drop-shadow(8px 0 var(--nk-green));}
                22%{transform:var(--nkc,translate(-50%,-50%)) translate(12px,-4px);clip-path:inset(0 0 78% 0);}
                34%{transform:var(--nkc,translate(-50%,-50%)) translate(-8px,0);clip-path:inset(42% 0 30% 0);filter:invert(1);}
                46%{transform:var(--nkc,translate(-50%,-50%)) translate(10px,3px) skewX(5deg);filter:none;clip-path:none;}
                58%{transform:var(--nkc,translate(-50%,-50%)) translate(-6px,0);filter:drop-shadow(-8px 0 var(--nk-red)) drop-shadow(8px 0 var(--nk-green));}
                70%{transform:var(--nkc,translate(-50%,-50%)) translate(8px,-2px);clip-path:inset(60% 0 0 0);}
                82%{transform:var(--nkc,translate(-50%,-50%)) translate(-4px,0);filter:invert(1);}
                92%{transform:var(--nkc,translate(-50%,-50%)) translate(3px,0);filter:none;}
            }

            /* ===== 10 CRT/глитч-схлопываний при закрытии (растяжение → сжатие в точку, быстро) ===== */
            .nekto-ui-panel.nkcl1  { animation: nkClose1  .26s cubic-bezier(.5,0,.9,.3) forwards; }
            .nekto-ui-panel.nkcl2  { animation: nkClose2  .26s cubic-bezier(.5,0,.9,.3) forwards; }
            .nekto-ui-panel.nkcl3  { animation: nkClose3  .26s cubic-bezier(.5,0,.9,.3) forwards; }
            .nekto-ui-panel.nkcl4  { animation: nkClose4  .28s cubic-bezier(.5,0,.9,.3) forwards; }
            .nekto-ui-panel.nkcl5  { animation: nkClose5  .26s steps(4) forwards; }
            .nekto-ui-panel.nkcl6  { animation: nkClose6  .26s ease-in forwards; transform-origin: center bottom; }
            .nekto-ui-panel.nkcl7  { animation: nkClose7  .26s ease-in forwards; transform-origin: center top; }
            .nekto-ui-panel.nkcl8  { animation: nkClose8  .26s ease-in forwards; transform-origin: left center; }
            .nekto-ui-panel.nkcl9  { animation: nkClose9  .26s ease-in forwards; transform-origin: right center; }
            .nekto-ui-panel.nkcl10 { animation: nkClose10 .3s steps(5) forwards; }

            @keyframes nkClose1 { /* классический CRT-off: линия → точка */
                0%{transform:var(--nkc,translate(-50%,-50%)) scale(1,1);opacity:1;filter:none;}
                45%{transform:var(--nkc,translate(-50%,-50%)) scale(1.25,.06);filter:brightness(2);}
                75%{transform:var(--nkc,translate(-50%,-50%)) scale(1.3,.02);filter:brightness(2.4);}
                100%{transform:var(--nkc,translate(-50%,-50%)) scale(0,.02);opacity:.5;filter:brightness(3);}
            }
            @keyframes nkClose2 { /* растянуть по ширине → схлоп в точку */
                0%{transform:var(--nkc,translate(-50%,-50%)) scale(1,1);opacity:1;}
                45%{transform:var(--nkc,translate(-50%,-50%)) scale(1.45,.8);filter:drop-shadow(-6px 0 var(--nk-red)) drop-shadow(6px 0 var(--nk-green));}
                100%{transform:var(--nkc,translate(-50%,-50%)) scale(0,0);opacity:.5;filter:none;}
            }
            @keyframes nkClose3 { /* растянуть по высоте → схлоп */
                0%{transform:var(--nkc,translate(-50%,-50%)) scale(1,1);opacity:1;}
                45%{transform:var(--nkc,translate(-50%,-50%)) scale(.8,1.45);filter:drop-shadow(0 -6px var(--nk-red));}
                100%{transform:var(--nkc,translate(-50%,-50%)) scale(0,0);opacity:.5;filter:none;}
            }
            @keyframes nkClose4 { /* раздуться → имплозия в точку */
                0%{transform:var(--nkc,translate(-50%,-50%)) scale(1,1);opacity:1;filter:none;}
                40%{transform:var(--nkc,translate(-50%,-50%)) scale(1.35,1.35);filter:brightness(1.6);}
                100%{transform:var(--nkc,translate(-50%,-50%)) scale(0,0);opacity:.4;filter:none;}
            }
            @keyframes nkClose5 { /* перекос-глитч → линия */
                0%{transform:var(--nkc,translate(-50%,-50%)) skewX(0) scale(1,1);opacity:1;}
                30%{transform:var(--nkc,translate(-50%,-50%)) skewX(-18deg) scale(1.1,.7);filter:drop-shadow(-8px 0 var(--nk-red)) drop-shadow(8px 0 var(--nk-green));}
                60%{transform:var(--nkc,translate(-50%,-50%)) skewX(14deg) scale(1.2,.2);filter:invert(1);}
                100%{transform:var(--nkc,translate(-50%,-50%)) skewX(0) scale(0,.04);opacity:.4;filter:none;}
            }
            @keyframes nkClose6 { /* схлоп вниз */
                0%{transform:var(--nkc,translate(-50%,-50%)) scaleY(1);opacity:1;}
                55%{transform:var(--nkc,translate(-50%,-50%)) scaleY(.4) scaleX(1.1);filter:brightness(1.6);}
                100%{transform:var(--nkc,translate(-50%,-50%)) scaleY(0) scaleX(.6);opacity:.5;}
            }
            @keyframes nkClose7 { /* схлоп вверх */
                0%{transform:var(--nkc,translate(-50%,-50%)) scaleY(1);opacity:1;}
                55%{transform:var(--nkc,translate(-50%,-50%)) scaleY(.4) scaleX(1.1);filter:brightness(1.6);}
                100%{transform:var(--nkc,translate(-50%,-50%)) scaleY(0) scaleX(.6);opacity:.5;}
            }
            @keyframes nkClose8 { /* схлоп влево */
                0%{transform:var(--nkc,translate(-50%,-50%)) scaleX(1);opacity:1;}
                55%{transform:var(--nkc,translate(-50%,-50%)) scaleX(.4) scaleY(1.1);filter:drop-shadow(-6px 0 var(--nk-red));}
                100%{transform:var(--nkc,translate(-50%,-50%)) scaleX(0) scaleY(.6);opacity:.5;}
            }
            @keyframes nkClose9 { /* схлоп вправо */
                0%{transform:var(--nkc,translate(-50%,-50%)) scaleX(1);opacity:1;}
                55%{transform:var(--nkc,translate(-50%,-50%)) scaleX(.4) scaleY(1.1);filter:drop-shadow(6px 0 var(--nk-green));}
                100%{transform:var(--nkc,translate(-50%,-50%)) scaleX(0) scaleY(.6);opacity:.5;}
            }
            @keyframes nkClose10 { /* дрожь-глитч → точка */
                0%{transform:var(--nkc,translate(-50%,-50%)) scale(1,1);opacity:1;filter:none;}
                20%{transform:var(--nkc,translate(-50%,-50%)) translate(-8px,0) scale(1.05,.9);filter:drop-shadow(-8px 0 var(--nk-red)) drop-shadow(8px 0 var(--nk-green));}
                40%{transform:var(--nkc,translate(-50%,-50%)) translate(8px,0) scale(1.1,.5);filter:invert(1);}
                60%{transform:var(--nkc,translate(-50%,-50%)) translate(-5px,0) scale(1.2,.2);filter:none;}
                80%{transform:var(--nkc,translate(-50%,-50%)) scale(1.25,.05);filter:brightness(2);}
                100%{transform:var(--nkc,translate(-50%,-50%)) scale(0,.03);opacity:.4;filter:none;}
            }

            /* ---- подписи-разделы жирным = красные; значения жирным = акцент(зелёный) ---- */
            /* весь текст белый; цвет темы влияет только на полоски-ползунки */
            .nekto-ui-panel div[style*="font-weight:bold"],
            .nekto-ui-panel span[style*="font-weight:bold"],
            .nekto-ui-panel label, .nekto-ui-panel span, .nekto-ui-panel div {
                color: var(--nk-white) !important; text-shadow: none !important;
            }
            .nekto-ui-panel span[style*="color:#888"], .nekto-ui-panel span[style*="color: #888"] { color: #9a9a9a !important; }

            /* ---- поля ввода: чёрные, белая рамка ---- */
            .nekto-ui-panel input[type="text"],
            .nekto-ui-panel input[type="number"],
            .nekto-ui-panel select,
            .nekto-ui-panel textarea {
                background: var(--nk-input) !important;
                color: var(--nk-white) !important;
                border: 2px solid var(--nk-white) !important;
                border-radius: 7px !important;
                font-family: var(--nk-font-body) !important;
                font-size: 14px !important;
                box-shadow: none !important;
            }
            .nekto-ui-panel input:focus, .nekto-ui-panel select:focus, .nekto-ui-panel textarea:focus {
                outline: none !important; border-color: var(--nk-green) !important;
            }
            .nekto-ui-panel input[type="range"] { accent-color: var(--nk-accent) !important; }
            .nekto-ui-panel input[type="checkbox"] { accent-color: var(--nk-green) !important; width: 15px; height: 15px; }

            /* ---- кнопки: белая рамка, при наведении заливка белым ---- */
            .nekto-ui-panel button {
                background: #000 !important;
                color: var(--nk-white) !important;
                border: 2px solid var(--nk-white) !important;
                border-radius: 9px !important;
                font-family: var(--nk-font-head) !important;
                text-transform: uppercase; letter-spacing: 1px;
                text-shadow: none !important;
                -webkit-font-smoothing: none;
                transition: background .12s, color .12s !important;
            }
            .nekto-ui-panel button:hover { background: var(--nk-white) !important; color: #000 !important; box-shadow: none !important; }

            /* сетка сбоев: обычный шрифт (читаемо), активная = зелёная */
            .nekto-ui-panel #nekto-moment-grid button {
                font-family: var(--nk-font-body) !important; text-transform: none; letter-spacing: 0;
                text-align: left !important; font-size: 12px !important; padding: 6px 7px !important; border-radius: 8px !important;
            }
            .nekto-ui-panel #nekto-moment-grid button.active {
                background: var(--nk-green) !important; color: #000 !important; border-color: var(--nk-green) !important;
            }

            /* ---- квадратики тем ---- */
            .nekto-theme-sq { transition: transform .12s; image-rendering: pixelated; }
            .nekto-theme-sq:hover { transform: scale(1.12); }
            .nekto-theme-sq.selected { box-shadow: 0 0 0 2px var(--nk-white) !important; }

            /* ---- нижние кнопки → чёрные плитки с белой рамкой ---- */
            .nekto-ui-fab {
                background: #000 !important;
                border: 2px solid var(--nk-white) !important;
                border-radius: 12px !important;
                box-shadow: none !important;
                color: #fff !important;
                transition: opacity .25s ease, transform .15s, border-color .15s !important;
            }
            .nekto-ui-fab:hover { transform: translateY(-2px) scale(1.05); border-color: var(--nk-green) !important; box-shadow: none !important; }

            /* ---- затемнение вместе с фоном сайта (попапы/поиск собеседника) ---- */
            .nk-dimmed { filter: brightness(.32) saturate(.7) !important; transition: filter .18s ease; }
            .nekto-ui-panel, .nekto-ui-fab, #nekto-ping-badge, #nekto-mute-controls, #nekto-games-launcher { transition: filter .18s ease; }

            /* ---- режим перемещения значков ---- */
            .nk-icon-editing { outline: 2px dashed var(--nk-green) !important; cursor: grab !important; }
            .nk-icon-editing:active { cursor: grabbing !important; }

            /* ---- индикатор пинга ---- */
            #nekto-ping-badge {
                background: #000 !important;
                border: 2px solid var(--nk-white) !important;
                border-radius: 8px !important;
                box-shadow: none !important;
                font-family: var(--nk-font-body) !important;
                font-size: 14px !important;
            }

            /* ---- скроллбары ---- */
            .nekto-ui-panel { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.22) transparent; }
            .nekto-ui-panel::-webkit-scrollbar { width: 6px; height: 6px; }
            .nekto-ui-panel::-webkit-scrollbar-track { background: transparent; }
            .nekto-ui-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.22); border-radius: 6px; }
            .nekto-ui-panel::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.4); }

            /* ---- вкладки настроек ---- */
            .nekto-ui-panel .nk-tabs { display:grid; grid-template-columns:1fr 1fr; gap:6px; border-bottom:2px solid var(--nk-white); padding-bottom:8px; margin-bottom:2px; }
            .nekto-ui-panel .nk-tab:last-child { grid-column: 1 / -1; }
            .nekto-ui-panel .nk-tab {
                font-family: var(--nk-font-body) !important; text-transform:none !important; letter-spacing:0 !important;
                font-size:12px !important; padding:6px 8px !important; border:2px solid var(--nk-white) !important;
                background:#000 !important; color:var(--nk-white) !important; border-radius:10px !important;
                -webkit-font-smoothing:auto; cursor:pointer; text-align:center; width:100%; box-sizing:border-box;
                transition: background .15s, color .15s, transform .1s;
            }
            .nekto-ui-panel .nk-tab:hover { background:var(--nk-white) !important; color:#000 !important; }
            .nekto-ui-panel .nk-tab.active { background:var(--nk-white) !important; color:#000 !important; }
            .nekto-ui-panel .nk-tabpane { flex-direction:column; gap:10px; }

            /* ---- ресайз окон ---- */
            .nekto-ui-panel { min-width: 240px; min-height: 120px; }
            .nekto-game-win { resize: both; overflow: hidden; min-width: 220px; min-height: 160px; }
        `;
        (document.head || document.documentElement).appendChild(st);
    }

    // ==========================================
    // ТЕМЫ ИНТЕРФЕЙСА СКРИПТА (панели/кнопки самого скрипта, не сайта)
    // ==========================================
    // Каждая тема теперь = цвет неонового акцента поверх общего ретро-скина.
    function emojiPatternURL(emojiStr) {
        const em = Array.from(emojiStr || '');
        if (!em.length) return '';
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="130" height="130">' +
            '<text x="8"  y="32"  font-size="22" opacity="0.20">' + (em[0] || '') + '</text>' +
            '<text x="74" y="58"  font-size="20" opacity="0.16" transform="rotate(18 84 52)">' + (em[1] || em[0] || '') + '</text>' +
            '<text x="22" y="96"  font-size="21" opacity="0.18" transform="rotate(-14 30 90)">' + (em[2] || em[0] || '') + '</text>' +
            '<text x="86" y="116" font-size="19" opacity="0.16">' + (em[3] || em[1] || em[0] || '') + '</text>' +
            '</svg>';
        return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
    }

    const UI_THEMES = [
        { id: 'dark',   name: 'Классика (белый+зелёный)', sq: '#3fdc5c', text: '#ffffff', inputBg: '#000000', accent: '#3fdc5c', border: '#fff', grad: 'linear-gradient(160deg, #2b2b2b, #242424)', emoji: '' },
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
        injectRetroSkin(); // скин рисует белую структуру; тема меняет только "цветной акцент"
        // (ползунки, значения, активные кнопки). Рамки и текст всегда белые.
        document.documentElement.style.setProperty('--nk-accent', t.accent);
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
            ` style="width:28px; height:28px; border-radius:7px; cursor:pointer; background:${kind === 'ui' ? (t.accent || t.sq) : t.sq}; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.25), 0 0 6px ${kind === 'ui' ? (t.accent || t.sq) : 'transparent'};"></div>`
        ).join('');
    }

    // ==========================================
    // АНИМАЦИИ ГЛИТЧА (заголовки, полноэкранный, планировщики)
    // ==========================================
    const GLITCH_CLASSES = ['nkg1','nkg2','nkg3','nkg4','nkg5','nkg6','nkg7','nkg8','nkg9','nkg10'];

    // Разовый приступ глитча на всех видимых заголовках (случайный из 10 вариантов).
    let currentTitleGlitch = null; // какой вариант сейчас крутится на заголовках (лого возьмёт другой)

    function anyPanelOpen() {
        for (const p of document.querySelectorAll('.nekto-ui-panel')) {
            if (p.style.display === 'flex') return true;
        }
        return false;
    }

    function fireHeaderGlitch() {
        if (!anyPanelOpen()) return; // окна закрыты — не жжём главный поток анимациями
        const cls = GLITCH_CLASSES[Math.floor(Math.random() * GLITCH_CLASSES.length)];
        currentTitleGlitch = cls;
        setTimeout(() => { if (currentTitleGlitch === cls) currentTitleGlitch = null; }, 750);
        // только заголовки окон; у логотипа свой независимый планировщик
        document.querySelectorAll('.nk-title').forEach(el => {
            const panel = el.closest('.nekto-ui-panel');
            if (panel && (panel.style.display === 'none' || !panel.style.display)) return; // закрытые окна пропускаем
            el.classList.remove(...GLITCH_CLASSES);
            void el.offsetWidth; // рестарт анимации
            el.classList.add(cls);
            setTimeout(() => el.classList.remove(cls), 700);
        });
    }

    // Переименование логотипа сайта «Nekto.me» → «alen.me» (с глитчем). Работает и после
    // перерисовок страницы; ищем именно короткий логотип (ровно текст "Nekto.me"), не подписи.
    function applyLogoBrand() {
        try {
            // Логотип сайта в шапке: <a class="navbar-brand"><span>Nekto.</span>me</a>
            document.querySelectorAll('a.navbar-brand').forEach(el => {
                if (el.dataset.nkBrand) return;
                const t = (el.textContent || '').replace(/\s+/g, '');
                if (t.toLowerCase().includes('nekto.me')) {
                    el.dataset.nkBrand = '1';
                    el.innerHTML = '<span class="nk-logo">alen.me</span>';
                }
            });
            // Подпись "от Nekto.me" в шапке аудиочата (текстовый узел внутри .header > div)
            document.querySelectorAll('.audio-chat .header div').forEach(el => {
                if (el.dataset.nkBrandSub) return;
                for (const node of Array.from(el.childNodes)) {
                    if (node.nodeType === 3 && /Nekto\.me/i.test(node.nodeValue)) {
                        el.dataset.nkBrandSub = '1';
                        node.nodeValue = node.nodeValue.replace(/Nekto\.me/ig, 'alen.me');
                    }
                }
            });
        } catch (e) {}
    }
    // Планировщик: следующий приступ через случайные 3–5 секунд, бесконечно.
    function scheduleHeaderGlitch() {
        fireHeaderGlitch();
        setTimeout(scheduleHeaderGlitch, 3000 + Math.random() * 2000);
    }

    // Глитч логотипа — независимый: свой таймер и всегда ДРУГОЙ вариант,
    // чтобы лого и заголовки никогда не глитчили одинаково одновременно.
    function fireLogoGlitch() {
        const pool = GLITCH_CLASSES.filter(c => c !== currentTitleGlitch);
        const cls = pool[Math.floor(Math.random() * pool.length)];
        document.querySelectorAll('.nk-logo').forEach(el => {
            el.classList.remove(...GLITCH_CLASSES);
            void el.offsetWidth;
            el.classList.add(cls);
            setTimeout(() => el.classList.remove(cls), 700);
        });
    }
    function scheduleLogoGlitch() {
        fireLogoGlitch();
        setTimeout(scheduleLogoGlitch, 3400 + Math.random() * 2600); // сдвинутый диапазон — реже совпадают
    }

    // Старый набор глитчей окон временно отключён — он остался в CSS и здесь,
    // вернуть можно одной строкой: FULLGLITCH_CLASSES = LEGACY_GLITCH_CLASSES.
    const LEGACY_GLITCH_CLASSES = ['nkf1','nkf2','nkf3','nkf4','nkf5','nkf6','nkf7','nkf8','nkf9','nkf10'];
    // Набор в эстетике «Serial Experiments Lain».
    const LAIN_GLITCH_CLASSES = ['nkl1','nkl2','nkl3','nkl4','nkl5','nkl6','nkl7','nkl8','nkl9','nkl10'];
    // Набор «киберпсихоз» — самый жёсткий: датамош, блочные разрывы, строб.
    const CYBER_GLITCH_CLASSES = ['nkc1','nkc2','nkc3','nkc4','nkc5','nkc6','nkc7','nkc8','nkc9','nkc10'];
    const ALL_GLITCH_CLASSES = LEGACY_GLITCH_CLASSES.concat(LAIN_GLITCH_CLASSES, CYBER_GLITCH_CLASSES);
    // Активный набор выбирается настройкой «Стиль глитча окон» и меняется на лету.
    function activeGlitchClasses() {
        if (glitchStyle === 'legacy') return LEGACY_GLITCH_CLASSES;
        if (glitchStyle === 'lain') return LAIN_GLITCH_CLASSES;
        return CYBER_GLITCH_CLASSES;
    }
    // Страховка: если анимация прервалась, маска не должна остаться на окне
    setInterval(() => {
        document.querySelectorAll('.nekto-ui-panel').forEach(p => {
            const stuck = ALL_GLITCH_CLASSES.some(c => p.classList.contains(c));
            if (!stuck && (p.style.webkitMaskImage || p.style.maskImage)) {
                p.style.webkitMaskImage = ''; p.style.maskImage = '';
            }
        });
    }, 2000);

    const CLOSE_CLASSES = ['nkcl1','nkcl2','nkcl3','nkcl4','nkcl5','nkcl6','nkcl7','nkcl8','nkcl9','nkcl10'];
    // Полноэкранный глитч всей вкладки (случайный из 10). Если panel не задан — на всех открытых.
    function fireFullGlitch(panel) {
        const targets = panel ? [panel] : Array.from(document.querySelectorAll('.nekto-ui-panel'));
        const pool = activeGlitchClasses();
        const cls = pool[Math.floor(Math.random() * pool.length)];
        targets.forEach(p => {
            if (!p || p.style.display === 'none' || !p.style.display) return;
            p.classList.remove(...ALL_GLITCH_CLASSES, 'nk-scan');
            p.querySelectorAll('.nk-cyber-ov').forEach(o => o.remove());
            void p.offsetWidth;

            p.classList.add(cls);
            // У каждого набора свой слой помех и своя длительность:
            // Lain тянется 2–3 секунды, киберпанк отрабатывает меньше секунды.
            let life = 1300;
            if (glitchStyle === 'lain' || glitchStyle === 'cyber') {
                const ov = document.createElement('div');
                ov.className = (glitchStyle === 'lain') ? 'nk-lain-ov' : 'nk-cyber-ov';
                p.appendChild(ov);
                life = (glitchStyle === 'lain') ? 3100 : 950;
                setTimeout(() => { try { ov.remove(); } catch (e) {} }, life);
            }
            setTimeout(() => {
                p.classList.remove(cls, 'nk-scan');
                // маску, выставленную кадрами анимации, снимаем явно
                p.style.webkitMaskImage = ''; p.style.maskImage = '';
            }, life + 150);
        });
    }

    // Наблюдатель: глитч-появление при открытии и глитч-сворачивание при закрытии.
    function watchPanelOpenAnim() {
        document.querySelectorAll('.nekto-ui-panel').forEach(p => {
            if (p.dataset.openObs) return; p.dataset.openObs = '1';
            let last = p.style.display;
            new MutationObserver(() => {
                const d = p.style.display;
                if (d === last) return;
                if (p.dataset.anim) return; // игнорируем изменения, которые делаем сами
                last = d;
                if (d === 'flex') {
                    p.classList.remove('nk-close', 'nk-open'); void p.offsetWidth;
                    p.classList.add('nk-open');
                    setTimeout(() => p.classList.remove('nk-open'), 360);
                } else if (d === 'none') {
                    // перехватываем закрытие: проигрываем случайное сворачивание из 10
                    const cl = CLOSE_CLASSES[Math.floor(Math.random() * CLOSE_CLASSES.length)];
                    p.dataset.anim = '1';
                    p.style.display = 'flex'; last = 'flex';
                    p.classList.remove('nk-open'); void p.offsetWidth;
                    p.classList.add(cl);
                    setTimeout(() => {
                        p.classList.remove(cl);
                        p.style.display = 'none'; last = 'none';
                        setTimeout(() => { p.dataset.anim = ''; }, 30);
                    }, 300);
                }
            }).observe(p, { attributes: true, attributeFilter: ['style'] });
        });
    }

    // Делает окно перетаскиваемым за ручку (заголовок) и ресайзящимся за угол.
    function makeMovableResizable(panel, handle) {
        if (!panel || panel.dataset.mrInit) return;
        panel.dataset.mrInit = '1';
        panel.style.resize = 'both';
        panel.style.overflow = 'auto';
        if (handle) {
            handle.style.cursor = 'move';
            handle.style.userSelect = 'none';
            handle.addEventListener('mousedown', e => {
                if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
                e.preventDefault();
                const rect = panel.getBoundingClientRect();
                panel.style.transform = 'none';   // уходим от центрирования через translate к абсолютным координатам
                panel.style.setProperty('--nkc', 'translate(0,0)');
                panel.style.margin = '0';
                panel.style.left = rect.left + 'px';
                panel.style.top = rect.top + 'px';
                const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
                const mv = ev => {
                    panel.style.left = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - offX)) + 'px';
                    panel.style.top = Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - offY)) + 'px';
                };
                const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
                document.addEventListener('mousemove', mv);
                document.addEventListener('mouseup', up);
            });
        }
    }

    function buildUIPanels() {
        if (document.getElementById('nekto-buttons-bar')) return;

        const btnContainer = document.createElement('div');
        btnContainer.id = 'nekto-buttons-bar';
        // opacity:0 на старте — значки не мигают до того, как страница отрисуется и они встанут на место
        btnContainer.style.cssText = 'position: fixed; top: 108px; left: 50%; transform: translateX(-50%); display: flex; gap: 14px; z-index: 999998; opacity: 0; transition: opacity .25s ease;';
        btnContainer.id = 'nekto-buttons-bar';
        
        const gear = document.createElement('div'); gear.id = 'nekto-fab-gear'; gear.innerHTML = '⚙️'; gear.style.cssText = 'width: 45px; height: 45px; font-size: 28px; cursor: pointer; background: rgba(0,0,0,0.6); border-radius: 50%; display: flex; justify-content: center; align-items: center; transition: 0.3s; user-select: none;';
        const effectsBtn = document.createElement('div'); effectsBtn.id = 'nekto-fab-effects'; effectsBtn.innerHTML = '🎛️'; effectsBtn.style.cssText = 'width: 45px; height: 45px; font-size: 24px; cursor: pointer; background: rgba(0,0,0,0.6); border-radius: 50%; display: flex; justify-content: center; align-items: center; transition: 0.3s; user-select: none;';
        const timerBtn = document.createElement('div'); timerBtn.id = 'nekto-fab-timer'; timerBtn.innerHTML = '⏱️'; timerBtn.style.cssText = 'width: 45px; height: 45px; font-size: 24px; cursor: pointer; background: rgba(0,0,0,0.6); border-radius: 50%; display: flex; justify-content: center; align-items: center; transition: 0.3s; user-select: none;';
        const momentBtn = document.createElement('div'); momentBtn.id = 'nekto-fab-moments'; momentBtn.innerHTML = '📡'; momentBtn.style.cssText = 'width: 45px; height: 45px; font-size: 24px; cursor: pointer; background: rgba(0,0,0,0.6); border-radius: 50%; display: flex; justify-content: center; align-items: center; transition: 0.3s; user-select: none;';
        const statsBtn = document.createElement('div'); statsBtn.id = 'nekto-fab-stats'; statsBtn.innerHTML = '📊'; statsBtn.style.cssText = 'width: 45px; height: 45px; font-size: 24px; cursor: pointer; background: rgba(0,0,0,0.6); border-radius: 50%; display: flex; justify-content: center; align-items: center; transition: 0.3s; user-select: none;';
        
        gear.classList.add('nekto-ui-fab'); effectsBtn.classList.add('nekto-ui-fab'); timerBtn.classList.add('nekto-ui-fab'); statsBtn.classList.add('nekto-ui-fab'); momentBtn.classList.add('nekto-ui-fab');
        btnContainer.appendChild(gear); btnContainer.appendChild(effectsBtn); btnContainer.appendChild(momentBtn); btnContainer.appendChild(timerBtn); btnContainer.appendChild(statsBtn); document.body.appendChild(btnContainer);

        // --- Модалка временных сбоев ---
        const modalMoments = document.createElement('div');
        modalMoments.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #2b2b2b; color: #fff; padding: 16px; border-radius: 12px; z-index: 999999; display: none; flex-direction: column; gap: 8px; width: 345px; max-width: 92vw; max-height: 88vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.7); font-family: sans-serif;`;
        modalMoments.innerHTML = `
            <h3 style="margin:0 0 5px 0; border-bottom:1px solid #555; padding-bottom:5px;">📡 Сбои связи (звук собеседника)</h3>
            <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                <input type="checkbox" id="nekto-inp-moments-engine" ${momentsEngineOn ? 'checked' : ''} style="width:14px; height:14px; cursor:pointer;"> Включить движок сбоев
            </label>
            <span style="font-size:11px; color:#888;">Пока выключен — обработка звука собеседника не ведётся вовсе (меньше нагрузка, звук чище). Включается со следующего диалога.</span>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">
                Длительность сбоя: <span id="nekto-moment-dur-val">${momentDuration.toFixed(1)} сек</span>
                <input type="range" id="nekto-inp-moment-dur" min="0.5" max="10" step="0.5" value="${momentDuration}" style="cursor:pointer;">
            </label>
            <div id="nekto-moment-grid" style="display:grid; grid-template-columns: repeat(2, 1fr); gap:8px;"></div>
            <div id="nekto-moment-status" style="font-size:12px; color:#888; min-height: 16px;">Работает во время звонка: жмёшь кнопку — звук собеседника "ломается" на заданное время (лагают уже сказанные слова). Повторный клик — отмена.</div>
            <div style="display:flex; justify-content:center; margin-top:6px;">
                <button id="nekto-btn-mm-close" style="padding:6px 12px; cursor:pointer; background:#555; color:#fff; border:none; border-radius:6px;">Закрыть</button>
            </div>
        `;
        document.body.appendChild(modalMoments);
        modalMoments.classList.add('nekto-ui-panel');
        makeMovableResizable(modalMoments, modalMoments.querySelector('h3'));

        const momentGrid = document.getElementById('nekto-moment-grid');
        MOMENT_LIST.forEach(m => {
            const b = document.createElement('button');
            b.dataset.moment = m.id;
            b.innerText = m.label;
            b.style.cssText = 'padding:8px 6px; cursor:pointer; background:#3a3a3a; color:#fff; border:1px solid #555; border-radius:8px; font-size:12px; text-align:left; transition: 0.15s;';
            b.onclick = () => { triggerMoment(m.id); refreshMomentUI(); };
            momentGrid.appendChild(b);
        });

        function refreshMomentUI() {
            const status = document.getElementById('nekto-moment-status');
            momentGrid.querySelectorAll('button').forEach(b => {
                const active = momentActive && momentActive.id === b.dataset.moment;
                b.classList.toggle('active', !!active);
            });
            if (momentActive) {
                const left = Math.max(0, (momentActive.endTime - Date.now()) / 1000);
                const m = MOMENT_LIST.find(x => x.id === momentActive.id);
                status.innerText = `Активно: ${m ? m.label : ''} — ещё ${left.toFixed(1)} сек (клик по кнопке = отмена)`;
                status.style.color = '#4cd964';
            } else if (!momentsEngineOn) {
                status.innerText = 'Движок сбоев выключен. Поставь галочку выше, чтобы эффекты заработали.';
                status.style.color = '#ff9f43';
            } else if (!remoteMomentNode || !remoteAudioCtx) {
                status.innerText = '⛔ Поток собеседника не подключён. Скрипт ищет его автоматически — если идёт разговор, а тут всё ещё ⛔, кликни в любом месте страницы (браузер мог заморозить звук) и подожди пару секунд.';
                status.style.color = '#ff9f43';
            } else if (remoteAudioCtx.state === 'suspended') {
                status.innerText = '⏸ Аудиоконтекст приостановлен браузером — кликни в любом месте страницы, чтобы разбудить.';
                status.style.color = '#ff9f43';
            } else {
                status.innerText = '🔗 Звонок подключён. Жмёшь кнопку — голос собеседника "ломается" на заданное время (лагают уже сказанные им слова). Слышишь это только ты. Повторный клик — отмена.';
                status.style.color = '#888';
            }
        }
        setInterval(() => { if (modalMoments.style.display !== 'none') refreshMomentUI(); }, 250);

        document.getElementById('nekto-inp-moments-engine').onchange = e => {
            momentsEngineOn = e.target.checked;
            localStorage.setItem('nekto_moments_engine', momentsEngineOn);
            setMomentsEngine(momentsEngineOn); // применяем прямо сейчас, не ожидая нового диалога
            refreshMomentUI();
        };
        document.getElementById('nekto-inp-moment-dur').oninput = e => {
            momentDuration = parseFloat(e.target.value);
            document.getElementById('nekto-moment-dur-val').innerText = momentDuration.toFixed(1) + ' сек';
            localStorage.setItem('nekto_moment_duration', momentDuration);
        };
        momentBtn.onclick = () => { refreshMomentUI(); modalMoments.style.display = modalMoments.style.display === 'flex' ? 'none' : 'flex'; };
        document.getElementById('nekto-btn-mm-close').onclick = () => { modalMoments.style.display = 'none'; };


        const modalWords = document.createElement('div');
        modalWords.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #2b2b2b; color: #fff; padding: 16px; border-radius: 12px; z-index: 999999; display: none; flex-direction: column; gap: 8px; width: 330px; max-width: 92vw; max-height: 88vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.7); font-family: sans-serif; box-sizing: border-box;`;
        modalWords.innerHTML = `
            <h3 style="margin:0 0 8px 0; border-bottom:2px solid #fff; padding-bottom:6px;">Настройки</h3>
            <div class="nk-tabs">
                <button class="nk-tab active" data-tab="vol">🔊 Громкость</button>
                <button class="nk-tab" data-tab="keys">⌨️ Клавиши</button>
                <button class="nk-tab" data-tab="voice">🎤 Голос</button>
                <button class="nk-tab" data-tab="custom">🎨 Вид</button>
                <button class="nk-tab" data-tab="misc">⚙️ Разное</button>
            </div>

            <div class="nk-tabpane" data-pane="vol" style="display:flex;">
                <label style="display:flex; flex-direction:column; gap:3px; font-size: 13px;">
                    Громкость чата: <span id="nekto-chat-vol-val" style="color:#17a2b8; font-weight:bold;">${Math.round(chatVolume * 100)}%</span>
                    <input type="range" id="nekto-inp-chat-vol" min="0" max="1" step="0.05" value="${chatVolume}" style="height:5px; cursor:pointer;">
                </label>
                <label style="display:flex; flex-direction:column; gap:3px; font-size: 13px;">
                    Громкость оповещений: <span id="nekto-notif-vol-val" style="color:#e0a800; font-weight:bold;">${Math.round(notificationVolume * 100)}%</span>
                    <input type="range" id="nekto-inp-notif-vol" min="0" max="1" step="0.05" value="${notificationVolume}" style="height:5px; cursor:pointer;">
                </label>
                <label style="display:flex; flex-direction:column; gap:3px; font-size: 13px;">
                    Усиление микрофона: <span id="nekto-mic-gain-val" style="color:#28a745; font-weight:bold;">${micGainValue.toFixed(1)}x</span>
                    <input type="range" id="nekto-inp-mic-gain" min="0.1" max="4.0" step="0.1" value="${micGainValue}" style="height:5px; cursor:pointer;">
                </label>
                <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                    <input type="checkbox" id="nekto-inp-db-meter" ${dbMeterOn ? 'checked' : ''} style="width:14px; height:14px; cursor:pointer;"> 📈 Измеритель уровня микрофона (дБ)
                </label>
                <span style="font-size:11px; color:#888;">Плавающая шкала с зелёной / жёлтой / красной зоной. Её можно перетаскивать мышью в любое место экрана.</span>
            </div>

            <div class="nk-tabpane" data-pane="keys" style="display:none;">
                <div style="font-size:13px; font-weight:bold;">⌨️ Горячие клавиши</div>
                <div style="display:flex; flex-direction:column; gap:6px; font-size:13px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">Скип: <button id="nekto-hk-skip" data-capturing="0" style="min-width:120px; padding:5px 10px; cursor:pointer; background:#444; color:#fff; border:1px solid #666; border-radius:6px;"></button></div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">Стоп: <button id="nekto-hk-stop" data-capturing="0" style="min-width:120px; padding:5px 10px; cursor:pointer; background:#444; color:#fff; border:1px solid #666; border-radius:6px;"></button></div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">Старт: <button id="nekto-hk-start" data-capturing="0" style="min-width:120px; padding:5px 10px; cursor:pointer; background:#444; color:#fff; border:1px solid #666; border-radius:6px;"></button></div>
                </div>
                <span style="font-size:11px; color:#888;">Клик по кнопке → нажми новую комбинацию. Esc — отмена, Backspace — отключить хоткей. Обычные хоткеи работают, пока вкладка активна — фоновым страницам браузер нажатия не отдаёт.</span>
                <label style="display:flex; align-items:center; gap:8px; font-size: 13px; cursor:pointer; margin-top:2px;">
                    <input type="checkbox" id="nekto-inp-media-keys" ${mediaKeysActive ? 'checked' : ''} style="width:14px; height:14px; cursor:pointer;"> 🌐 Глобальные медиа-клавиши (работают при свёрнутом браузере)
                </label>
                <span style="font-size:11px; color:#888;">⏭ след. трек = скип, ⏮ пред. трек = старт, ⏯ пауза = стоп. Работает через системные медиа-кнопки клавиатуры (Chrome/Edge), даже когда браузер свёрнут. Пока включено — эти кнопки перехватываются у музыкальных плееров.</span>
            </div>

            <div class="nk-tabpane" data-pane="voice" style="display:none;">
                <label style="display:flex; flex-direction:column; gap:3px; font-size: 13px;">Слова СКИПА: <input type="text" id="nekto-inp-skip"></label>
                <label style="display:flex; flex-direction:column; gap:3px; font-size: 13px;">Слова СТОПА: <input type="text" id="nekto-inp-stop"></label>
                <label style="display:flex; flex-direction:column; gap:3px; font-size: 13px;">Слова СТАРТА: <input type="text" id="nekto-inp-start"></label>
                <label style="display:flex; flex-direction:column; gap:3px; font-size: 13px;">
                    Питч собеседника: <span id="nekto-pitch-val" style="color:#e83e8c; font-weight:bold;">${companionPitch === 1 ? 'обычный' : (companionPitch > 1 ? 'выше' : 'ниже') + ' (' + companionPitch.toFixed(2) + 'x)'}</span>
                    <input type="range" id="nekto-inp-pitch" min="0.5" max="2.0" step="0.05" value="${companionPitch}" style="height:5px; cursor:pointer;">
                    <span style="font-size:11px; color:#888;">Меняет и высоту, и скорость голоса собеседника вместе (как перемотка кассеты)</span>
                </label>
                <label style="display:flex; align-items:center; gap:8px; font-size: 13px; user-select:none; cursor:pointer;">
                    <input type="checkbox" id="nekto-inp-self-listen" ${selfListeningActive ? 'checked' : ''} style="width:14px; height:14px; cursor:pointer;"> Самопрослушивание
                </label>
                <label style="display:flex; align-items:center; gap:8px; font-size: 13px; user-select:none; cursor:pointer;">
                    <input type="checkbox" id="nekto-inp-auto-start" ${autoStartActive ? 'checked' : ''} style="width:14px; height:14px; cursor:pointer;"> Автоначало диалога
                </label>
            </div>

            <div class="nk-tabpane" data-pane="custom" style="display:none;">
                <div style="font-size:13px; font-weight:bold;">🎨 Тема интерфейса скрипта</div>
                <div id="nekto-ui-theme-squares" style="display:flex; flex-wrap:wrap; gap:8px;"></div>
                <div style="font-size:13px; font-weight:bold; margin-top:4px;">🕹️ Тема окон игр</div>
                <div id="nekto-game-theme-squares" style="display:flex; flex-wrap:wrap; gap:8px;"></div>

                <div style="border-top:1px solid #333; margin:6px 0 2px;"></div>
                <div style="font-size:13px; font-weight:bold;">🧩 Значки</div>
                <label style="display:flex; flex-direction:column; gap:3px; font-size:13px;">
                    Прозрачность значков: <span id="nekto-icon-op-val" style="font-weight:bold;">${iconOpacity}%</span>
                    <input type="range" id="nekto-inp-icon-opacity" min="20" max="100" step="5" value="${iconOpacity}" style="cursor:pointer;">
                </label>
                <label style="display:flex; flex-direction:column; gap:3px; font-size:13px;">
                    Прозрачность окон: <span id="nekto-panel-op-val" style="font-weight:bold;">${panelOpacity}%</span>
                    <input type="range" id="nekto-inp-panel-opacity" min="30" max="100" step="5" value="${panelOpacity}" style="cursor:pointer;">
                </label>
                <button id="nekto-btn-icon-edit" style="padding:7px; cursor:pointer;">✋ Режим перемещения: выкл</button>
                <button id="nekto-btn-icon-reset" style="padding:7px; cursor:pointer;">↩️ Сбросить позиции</button>
                <span style="font-size:11px; color:#888;">Во включённом режиме зажми ЛКМ на значке и перетащи — позиция закрепится. Режим сам выключается при обновлении вкладки.</span>

                <div style="font-size:13px; font-weight:bold; margin-top:4px;">👁️ Показывать меню</div>
                <div id="nekto-icon-visibility" style="display:flex; flex-direction:column; gap:5px;"></div>

                <div style="border-top:1px solid #333; margin:6px 0 2px;"></div>
                <div style="font-size:13px; font-weight:bold;">⚡ Стиль глитча окон</div>
                <select id="nekto-sel-glitch-style" style="padding:7px;">
                    <option value="cyber">Киберпсихоз — датамош, блоки, строб (жёстко)</option>
                    <option value="lain">Lain — ЭЛТ, срыв развёртки, помехи</option>
                    <option value="legacy">Классика — сдвиги и раздвоение</option>
                </select>

                <div style="border-top:1px solid #333; margin:6px 0 2px;"></div>
                <div style="font-size:13px; font-weight:bold;">🌐 Тема самого сайта</div>
                <select id="nekto-sel-site-theme" style="padding:7px;">
                    <option value="default">Обычная (как на сайте)</option>
                    <option value="midnight">Полночь + летающие крестики</option>
                </select>
                <span style="font-size:11px; color:#888;">Чёрная шапка, тёмно-синий фон по бокам и белые крестики, летящие как снежинки.</span>
            </div>

            <div class="nk-tabpane" data-pane="misc" style="display:none;">
                <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">Макс. время общения с одним человеком (сек, 0 = без лимита): <input type="number" id="nekto-inp-talk" value="${talkTimeLimit}"></label>
                <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">Пауза перед поиском следующего (сек): <input type="number" step="0.1" id="nekto-inp-cool" value="${cooldownTime}"></label>
                <div style="border-top:1px solid #333; margin:6px 0 2px;"></div>
                <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                    <input type="checkbox" id="nekto-inp-safe-mode" ${safeMode ? 'checked' : ''} style="width:14px; height:14px; cursor:pointer;"> 🩺 Безопасный режим
                </label>
                <span style="font-size:11px; color:#888;">Полностью отключает вмешательство в звук: обработку микрофона, обработку голоса собеседника, эффекты, питч, пинг, волну, анимации, игры. Остаются только голосовые команды и горячие клавиши. Если в этом режиме команды работают — виновата обработка звука; если нет — дело не в скрипте. Применяется после перезагрузки страницы.</span>
                <button id="nekto-force-glitch" style="display:none; margin-top:6px; padding:8px; cursor:pointer;">⚡ Тест глитча на всю вкладку</button>
            </div>

            <div style="display:flex; justify-content:center; gap:10px; margin-top:10px; border-top:1px solid #333; padding-top:10px;">
                <button id="nekto-btn-w-cancel" style="padding:6px 12px; cursor:pointer; background:#555; color:#fff; border:none; border-radius:6px; min-width:110px;">Отмена</button>
                <button id="nekto-btn-w-save" style="padding:6px 12px; cursor:pointer; background:#28a745; color:#fff; border:none; border-radius:6px; min-width:110px;">Сохранить</button>
            </div>
        `;
        document.body.appendChild(modalWords);
        modalWords.classList.add('nekto-ui-panel');
        makeMovableResizable(modalWords, modalWords.querySelector('h3'));

        // Переключение вкладок с глитч-анимацией
        const nkTabs = modalWords.querySelectorAll('.nk-tab');
        const nkPanes = modalWords.querySelectorAll('.nk-tabpane');
        let miscClicks = 0;
        nkTabs.forEach(btn => btn.onclick = () => {
            // секрет: 5 кликов по вкладке «Разное» открывают тестовую кнопку глитча
            if (btn.dataset.tab === 'misc') {
                miscClicks++;
                if (miscClicks >= 5) {
                    const fb = document.getElementById('nekto-force-glitch');
                    if (fb) fb.style.display = 'block';
                }
            } else miscClicks = 0;

            const target = [...nkPanes].find(p => p.dataset.pane === btn.dataset.tab);
            nkTabs.forEach(b => b.classList.toggle('active', b === btn));
            if (!target || target.style.display !== 'none') return;

            // Плавное растяжение/сжатие окна под высоту новой вкладки
            const startH = modalWords.getBoundingClientRect().height;
            nkPanes.forEach(p => p.style.display = 'none');
            target.style.display = 'flex';
            modalWords.style.height = 'auto';
            const endH = modalWords.getBoundingClientRect().height;
            modalWords.style.height = startH + 'px';
            void modalWords.offsetHeight;               // рефлоу, чтобы стартовая высота применилась
            modalWords.style.transition = 'height .22s ease';
            modalWords.style.height = endH + 'px';
            setTimeout(() => { modalWords.style.height = ''; modalWords.style.transition = ''; }, 250);
        });
        const forceBtn = document.getElementById('nekto-force-glitch');
        if (forceBtn) forceBtn.onclick = () => fireFullGlitch(modalWords);

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

        document.getElementById('nekto-inp-media-keys').onchange = e => setMediaKeys(e.target.checked);
        document.getElementById('nekto-inp-safe-mode').onchange = e => {
            safeMode = e.target.checked;
            localStorage.setItem('nekto_safe_mode', safeMode);
        };
        document.getElementById('nekto-inp-db-meter').onchange = e => {
            dbMeterOn = e.target.checked;
            localStorage.setItem('nekto_db_meter', dbMeterOn);
            buildDbMeter();
            if (dbMeterOn) ensureLocalAnalyser();
            updateDbMeter();
        };

        // --- Квадратики тем ---
        const uiSqBox = document.getElementById('nekto-ui-theme-squares');
        uiSqBox.innerHTML = buildThemeSquares('ui', UI_THEMES, uiTheme);
        uiSqBox.querySelectorAll('.nekto-theme-sq').forEach(sq => { sq.onclick = () => applyUITheme(sq.dataset.theme); });

        const gameSqBox = document.getElementById('nekto-game-theme-squares');
        gameSqBox.innerHTML = buildThemeSquares('game', GAME_THEMES, gameTheme);
        gameSqBox.querySelectorAll('.nekto-theme-sq').forEach(sq => { sq.onclick = () => applyGameTheme(sq.dataset.theme); });

        // --- Значки: прозрачность / перемещение / скрытие ---
        document.getElementById('nekto-inp-icon-opacity').oninput = e => {
            iconOpacity = parseInt(e.target.value);
            document.getElementById('nekto-icon-op-val').innerText = iconOpacity + '%';
            localStorage.setItem('nekto_icon_opacity', iconOpacity);
            applyIconSettings();
        };
        document.getElementById('nekto-inp-panel-opacity').oninput = e => {
            panelOpacity = parseInt(e.target.value);
            document.getElementById('nekto-panel-op-val').innerText = panelOpacity + '%';
            localStorage.setItem('nekto_panel_opacity', panelOpacity);
            applyPanelOpacity();
        };
        const glitchSel = document.getElementById('nekto-sel-glitch-style');
        if (glitchSel) {
            glitchSel.value = glitchStyle;
            glitchSel.onchange = () => {
                glitchStyle = glitchSel.value;
                localStorage.setItem('nekto_glitch_style', glitchStyle);
                fireFullGlitch(modalWords); // сразу показываем выбранный стиль
            };
        }

        const siteSel = document.getElementById('nekto-sel-site-theme');
        siteSel.value = siteTheme;
        siteSel.onchange = () => applySiteTheme(siteSel.value);

        document.getElementById('nekto-btn-icon-edit').onclick = () => setIconEditMode(!iconEditMode);
        document.getElementById('nekto-btn-icon-reset').onclick = () => {
            iconPositions = {}; saveIconPositions();
            const homeBar = document.getElementById('nekto-buttons-bar');
            ICON_REGISTRY.forEach(r => {
                const el = document.getElementById(r.id);
                if (!el) return;
                el.style.position = ''; el.style.left = ''; el.style.top = ''; el.style.zIndex = '';
                if (r.key !== 'games' && homeBar && el.parentElement !== homeBar) homeBar.appendChild(el);
            });
            applyIconSettings();
        };

        const visBox = document.getElementById('nekto-icon-visibility');
        visBox.innerHTML = ICON_REGISTRY.map(r =>
            `<label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                <input type="checkbox" class="nk-icon-vis" data-key="${r.key}" ${hiddenIcons.includes(r.key) ? '' : 'checked'} style="width:14px; height:14px; cursor:pointer;"> ${r.label}
            </label>`
        ).join('');
        visBox.querySelectorAll('.nk-icon-vis').forEach(cb => cb.onchange = () => {
            const k = cb.dataset.key;
            if (cb.checked) hiddenIcons = hiddenIcons.filter(x => x !== k);
            else if (!hiddenIcons.includes(k)) hiddenIcons.push(k);
            saveHiddenIcons();
            applyIconSettings();
        });

        const EFFECT_OPTIONS_HTML = EFFECT_LIST.map(fx => `<option value="${fx.id}">${fx.label}</option>`).join('');
        const modalEffects = document.createElement('div');
        modalEffects.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #2b2b2b; color: #fff; padding: 16px; border-radius: 12px; z-index: 999999; display: none; flex-direction: column; gap: 10px; min-width: 260px; max-height: 88vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.7); font-family: sans-serif;`;
        modalEffects.innerHTML = `
            <h3 style="margin:0 0 5px 0; border-bottom:1px solid #555; padding-bottom:5px;">Эффекты голоса</h3>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">
                Эффект для голоса собеседника:
                <select id="nekto-sel-companion-effect" style="padding:8px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff; font-size:14px;">${EFFECT_OPTIONS_HTML}</select>
            </label>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">
                Сила эффекта собеседника: <span id="nekto-comp-fx-str-val">${compFxStrength}%</span>
                <input type="range" id="nekto-inp-comp-fx-str" min="0" max="100" step="5" value="${compFxStrength}" style="cursor:pointer;">
            </label>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">
                Эффект для своего микрофона:
                <select id="nekto-sel-mic-effect" style="padding:8px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff; font-size:14px;">${EFFECT_OPTIONS_HTML}</select>
            </label>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">
                Сила эффекта микрофона: <span id="nekto-mic-fx-str-val">${micFxStrength}%</span>
                <input type="range" id="nekto-inp-mic-fx-str" min="0" max="100" step="5" value="${micFxStrength}" style="cursor:pointer;">
            </label>
            <span style="font-size:11px; color:#888;">Пока стоит «Без эффекта», усиление 1.0x и выключено самопрослушивание, скрипт вообще не вмешивается в микрофон — так надёжнее работают голосовые команды. Применяется мгновенно, даже во время звонка. Сохраняется между диалогами (в отличие от заглушек).</span>
            <div style="display:flex; justify-content:center; margin-top:6px;">
                <button id="nekto-btn-fx-close" style="padding:6px 12px; cursor:pointer; background:#555; color:#fff; border:none; border-radius:6px;">Закрыть</button>
            </div>
        `;
        document.body.appendChild(modalEffects);
        modalEffects.classList.add('nekto-ui-panel');
        makeMovableResizable(modalEffects, modalEffects.querySelector('h3'));

        const selCompanionEffect = document.getElementById('nekto-sel-companion-effect');
        const selMicEffect = document.getElementById('nekto-sel-mic-effect');
        selCompanionEffect.value = companionEffect; selMicEffect.value = micEffect;
        selCompanionEffect.onchange = () => applyRemoteEffect(selCompanionEffect.value);
        selMicEffect.onchange = () => applyLocalEffect(selMicEffect.value);

        // Сила эффектов: цепочка пересобирается с задержкой 150 мс, чтобы не дёргать
        // Web Audio на каждый пиксель движения ползунка
        let fxRebuildTimerC = null, fxRebuildTimerM = null;
        const compStrInp = document.getElementById('nekto-inp-comp-fx-str');
        compStrInp.oninput = e => {
            compFxStrength = parseInt(e.target.value);
            document.getElementById('nekto-comp-fx-str-val').innerText = compFxStrength + '%';
            localStorage.setItem('nekto_comp_fx_strength', compFxStrength);
            clearTimeout(fxRebuildTimerC);
            fxRebuildTimerC = setTimeout(() => applyRemoteEffect(companionEffect), 150);
        };
        const micStrInp = document.getElementById('nekto-inp-mic-fx-str');
        micStrInp.oninput = e => {
            micFxStrength = parseInt(e.target.value);
            document.getElementById('nekto-mic-fx-str-val').innerText = micFxStrength + '%';
            localStorage.setItem('nekto_mic_fx_strength', micFxStrength);
            clearTimeout(fxRebuildTimerM);
            fxRebuildTimerM = setTimeout(() => applyLocalEffect(micEffect), 150);
        };

        effectsBtn.onclick = () => { if (modalEffects.style.display === 'flex') { modalEffects.style.display = 'none'; return; } selCompanionEffect.value = companionEffect; selMicEffect.value = micEffect; modalEffects.style.display = 'flex'; };
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

        gear.onclick = () => { if (modalWords.style.display === 'flex') { modalWords.style.display = 'none'; return; } document.getElementById('nekto-inp-skip').value = wordsSkip.join(', '); document.getElementById('nekto-inp-stop').value = wordsStop.join(', '); document.getElementById('nekto-inp-start').value = wordsStart.join(', '); document.getElementById('nekto-inp-talk').value = talkTimeLimit; document.getElementById('nekto-inp-cool').value = cooldownTime; modalWords.style.display = 'flex'; };
        document.getElementById('nekto-btn-w-cancel').onclick = () => { modalWords.style.display = 'none'; };
        document.getElementById('nekto-btn-w-save').onclick = () => {
            setTimeout(() => { if (recognitionEngine) applyCommandPhrases(recognitionEngine); }, 50);
            localStorage.setItem('nekto_words_skip', document.getElementById('nekto-inp-skip').value); localStorage.setItem('nekto_words_stop', document.getElementById('nekto-inp-stop').value); localStorage.setItem('nekto_words_start', document.getElementById('nekto-inp-start').value);
            wordsSkip = document.getElementById('nekto-inp-skip').value.split(',').map(s=>s.trim().toLowerCase()).filter(s=>s); wordsStop = document.getElementById('nekto-inp-stop').value.split(',').map(s=>s.trim().toLowerCase()).filter(s=>s); wordsStart = document.getElementById('nekto-inp-start').value.split(',').map(s=>s.trim().toLowerCase()).filter(s=>s);
            talkTimeLimit = parseInt(document.getElementById('nekto-inp-talk').value) || 0; cooldownTime = parseFloat(document.getElementById('nekto-inp-cool').value) || 1.5;
            localStorage.setItem('nekto_talk_time', talkTimeLimit); localStorage.setItem('nekto_cooldown_time', cooldownTime);
            modalWords.style.display = 'none';
        };

        const modalTimer = document.createElement('div');
        modalTimer.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #2b2b2b; color: #fff; padding: 16px; border-radius: 12px; z-index: 999999; display: none; flex-direction: column; gap: 8px; min-width: 260px; box-shadow: 0 10px 30px rgba(0,0,0,0.7); font-family: sans-serif;`;
        modalTimer.innerHTML = `
            <h3 style="margin:0 0 5px 0; border-bottom:1px solid #555; padding-bottom:8px;">Таймер доступа к Nekto.me</h3>
            <div id="nekto-access-status" style="font-size:13px; color:#aaa; background:#1e1e1e; padding:8px; border-radius:6px;"></div>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">Сколько минут можно сидеть на Nekto.me: <input type="number" min="1" id="nekto-inp-access-session" value="${accessSessionMin}" style="padding:8px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff;"></label>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px;">На сколько минут заблокировать доступ после этого: <input type="number" min="1" id="nekto-inp-access-cooldown" value="${accessCooldownMin}" style="padding:8px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff;"></label>
            <span style="font-size:11px; color:#888;">Таймер переживает обновление и закрытие страницы — отсчёт идёт по реальному времени, а не по открытой вкладке.</span>
            <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:10px; margin-top:8px;">
                <button id="nekto-btn-access-cancel-timer" style="padding:8px 12px; cursor:pointer; background:#d9534f; color:#fff; border:none; border-radius:6px; display:none;">Отменить таймер</button>
                <div style="display:flex; gap:10px;">
                    <button id="nekto-btn-t-cancel" style="padding:8px 15px; cursor:pointer; background:#555; color:#fff; border:none; border-radius:6px;">Закрыть</button>
                    <button id="nekto-btn-t-save" style="padding:8px 15px; cursor:pointer; background:#28a745; color:#fff; border:none; border-radius:6px;">Начать</button>
                </div>
            </div>
        `;
        document.body.appendChild(modalTimer);
        modalTimer.classList.add('nekto-ui-panel');
        makeMovableResizable(modalTimer, modalTimer.querySelector('h3'));

        timerBtn.onclick = () => {
            if (modalTimer.style.display === 'flex') { modalTimer.style.display = 'none'; return; }
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
        timerBtn.dataset.toggle = '1';
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
        modalStats.style.cssText = `position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #2b2b2b; color: #fff; padding: 16px; border-radius: 12px; z-index: 999999; display: none; flex-direction: column; gap: 10px; min-width: 250px; max-width: 380px; max-height: 82vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.7); font-family: sans-serif;`;
        modalStats.innerHTML = `
            <h3 style="margin:0 0 10px 0; border-bottom:1px solid #555; padding-bottom:10px;"><span>Статистика</span><button id="nekto-btn-stats-clear" style="font-size:11px; padding:4px 8px; background:#d9534f; color:white; border:none; border-radius:4px; cursor:pointer;">Очистить</button></h3>
            <label style="display:flex; flex-direction:column; gap:5px; font-size: 13px; color:#aaa;">Показать: <select id="nekto-stats-date-select" style="padding:6px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff; font-size:14px;"></select></label>
            <div style="display:flex; flex-direction:column; gap:8px;"><div style="font-size:13px; color:#aaa;">Задать диапазон длительности (до 10ч):</div><div style="display:flex; gap:10px; align-items:center;"><input type="text" id="nekto-stats-limit-input" style="padding:6px; width:120px; border-radius:6px; border:1px solid #555; background:#1e1e1e; color:#fff; font-size:14px; text-align:center;"><input type="range" id="nekto-stats-limit-slider" min="1" max="36000" style="flex-grow:1; accent-color:#000080; height:6px; cursor:pointer;"></div></div>
            <div style="background:#1e1e1e; padding:10px; border-radius:6px; margin-top:10px; font-size:14px;"><strong id="nekto-stats-total-label">Общее время во всех диалогах:</strong> <span id="nekto-stats-total" style="color:#17a2b8;">0 сек</span></div>
            <div id="nekto-stats-list" style="max-height:220px; overflow-y:auto; margin-top:10px; padding-right:5px; font-size:13px; display:flex; flex-direction:column; gap:5px;"></div>
            <div id="nekto-stats-skips" style="display:flex; gap:8px; margin-top:6px;"></div>
            <div style="display:flex; gap:8px; margin-top:8px;">
                <button id="nekto-btn-stats-export" style="flex:1; padding:7px; cursor:pointer;">Экспорт</button>
                <button id="nekto-btn-stats-import" style="flex:1; padding:7px; cursor:pointer;">Импорт</button>
            </div>
            <input type="file" id="nekto-stats-file" accept="application/json,.json" style="display:none;">
            <div style="display:flex; justify-content:center; margin-top:15px;"><button id="nekto-btn-stats-close" style="padding:8px 15px; cursor:pointer; background:#555; color:#fff; border:none; border-radius:6px;">Закрыть</button></div>
        `;
        document.body.appendChild(modalStats);
        modalStats.classList.add('nekto-ui-panel');
        makeMovableResizable(modalStats, modalStats.querySelector('h3'));

        // Оборачиваем текст каждого заголовка в .nk-title (глитч только на тексте),
        // не трогая кнопки внутри (например «Очистить» в статистике).
        document.querySelectorAll('.nekto-ui-panel h3').forEach(h3 => {
            if (h3.dataset.nkHead) return; h3.dataset.nkHead = '1';
            let titleEl = h3.querySelector('span');
            if (!titleEl) {
                titleEl = document.createElement('span');
                while (h3.firstChild) titleEl.appendChild(h3.firstChild);
                h3.appendChild(titleEl);
            }
            titleEl.classList.add('nk-title');
        });

        // Оборачиваем содержимое каждого окна в .nk-inner — на неё вешаются
        // трансформ-глитчи, чтобы само окно не смещалось из центра.
        document.querySelectorAll('.nekto-ui-panel').forEach(p => {
            if (p.dataset.nkInner) return; p.dataset.nkInner = '1';
            const inner = document.createElement('div');
            inner.className = 'nk-inner';
            inner.style.cssText = 'display:flex; flex-direction:column; gap:inherit; width:100%;';
            while (p.firstChild) inner.appendChild(p.firstChild);
            p.appendChild(inner);
            p.style.setProperty('--nkc', 'translate(-50%,-50%)');
        });

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

            // Кто кого скипал
            const mine = filtered.filter(d => d.byMe === true).length;
            const theirs = filtered.filter(d => d.byMe === false).length;
            const unknown = filtered.length - mine - theirs; // старые записи без пометки
            document.getElementById('nekto-stats-skips').innerHTML =
                `<div style="flex:1; text-align:center; border:1px solid #444; border-radius:8px; padding:7px;">
                    <div style="font-size:11px; color:#9a9a9a;">Скипнул я</div>
                    <div style="font-size:17px; font-weight:bold;">${mine}</div>
                </div>
                <div style="flex:1; text-align:center; border:1px solid #444; border-radius:8px; padding:7px;">
                    <div style="font-size:11px; color:#9a9a9a;">Скипнули меня</div>
                    <div style="font-size:17px; font-weight:bold;">${theirs}</div>
                </div>` +
                (unknown > 0 ? `<div style="flex:1; text-align:center; border:1px solid #444; border-radius:8px; padding:7px;">
                    <div style="font-size:11px; color:#9a9a9a;">Без данных</div>
                    <div style="font-size:17px; font-weight:bold;">${unknown}</div>
                </div>` : '');
        }

        dateSelect.onchange = () => renderStats();

        slider.oninput = e => { let val = parseInt(e.target.value); input.value = formatSeconds(val); localStorage.setItem('nekto_stats_limit', val); renderStats(); };
        input.onchange = e => { let val = parseTimeToSeconds(e.target.value); if (val<1) val=1; if (val>36000) val=36000; slider.value = val; input.value = formatSeconds(val); localStorage.setItem('nekto_stats_limit', val); renderStats(); };
        // --- Экспорт статистики в JSON-файл ---
        document.getElementById('nekto-btn-stats-export').onclick = () => {
            const payload = { app: 'alen.me', type: 'stats', version: 1, exportedAt: Date.now(), dialogues: dialogueHistory };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'alenme-stats-' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        };

        // --- Импорт с выбором: объединить или заменить ---
        const statsFileInput = document.getElementById('nekto-stats-file');
        document.getElementById('nekto-btn-stats-import').onclick = () => statsFileInput.click();
        statsFileInput.onchange = () => {
            const file = statsFileInput.files && statsFileInput.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data = JSON.parse(reader.result);
                    const incoming = Array.isArray(data) ? data : (data.dialogues || []);
                    if (!Array.isArray(incoming) || !incoming.length) { alert('В файле нет записей статистики.'); return; }

                    const merge = confirm(
                        'Найдено записей в файле: ' + incoming.length + '\n' +
                        'Сейчас сохранено: ' + dialogueHistory.length + '\n\n' +
                        'ОК — объединить время из обоих сохранений\n' +
                        'Отмена — заменить текущую статистику импортируемой'
                    );

                    if (merge) {
                        // объединяем, отсеивая полные дубликаты (одинаковые длительность+время)
                        const seen = new Set(dialogueHistory.map(d => d.timestamp + '_' + d.duration));
                        let added = 0;
                        incoming.forEach(d => {
                            if (typeof d.duration !== 'number' || typeof d.timestamp !== 'number') return;
                            const key = d.timestamp + '_' + d.duration;
                            if (seen.has(key)) return;
                            seen.add(key); dialogueHistory.push(d); added++;
                        });
                        dialogueHistory.sort((a, b) => a.timestamp - b.timestamp);
                        alert('Объединено. Добавлено новых записей: ' + added);
                    } else {
                        dialogueHistory = incoming.filter(d => typeof d.duration === 'number' && typeof d.timestamp === 'number');
                        alert('Статистика заменена. Записей: ' + dialogueHistory.length);
                    }

                    if (dialogueHistory.length > 5000) dialogueHistory = dialogueHistory.slice(-5000);
                    localStorage.setItem('nekto_dialogue_history', JSON.stringify(dialogueHistory));
                    renderStats();
                } catch (e) {
                    alert('Не удалось прочитать файл: ' + e.message);
                }
                statsFileInput.value = '';
            };
            reader.readAsText(file);
        };

        document.getElementById('nekto-btn-stats-clear').onclick = () => { if (confirm('Очистить всю сохраненную статистику диалогов?')) { dialogueHistory = []; localStorage.setItem('nekto_dialogue_history', JSON.stringify([])); renderStats(); } };
        statsBtn.onclick = () => { if (modalStats.style.display === 'flex') { modalStats.style.display = 'none'; return; } modalStats.style.display = 'flex'; renderStats(); };
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
        gamesRegistry.push({ id: cfg.id, title: cfg.title, icon: cfg.icon, __real: true, open: () => { winC.style.display = 'flex'; loadGame(); } });
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

    // Раньше все 11 игровых окон строились СРАЗУ при загрузке страницы — это давало
    // затык главного потока на сотни миллисекунд ([Violation] requestIdleCallback took 419ms)
    // и рвало сессию распознавания речи. Теперь регистрируем только карточки в меню,
    // а само окно создаётся при первом открытии игры.
    function registerLazyGame(cfg) {
        let built = false;
        gamesRegistry.push({
            id: cfg.id, title: cfg.title, icon: cfg.icon,
            open: () => {
                if (!built) { built = true; createGameWindow(cfg); }
                const entry = gamesRegistry.find(g => g.id === cfg.id && g.__real);
                if (entry) entry.open();
            }
        });
    }

    function initExtraGamesLazy() {
        const defs = [
            { id: 'game-2048', title: '2048.exe', icon: '\u{1F522}', isSrcDoc: true, html: GAME_HTML_2048, width: 420, height: 480, offsetIndex: 0 },
            { id: 'game-snake', title: 'Snake.exe', icon: '\u{1F40D}', isSrcDoc: true, html: GAME_HTML_SNAKE, width: 320, height: 360, offsetIndex: 1 },
            { id: 'game-mines', title: 'Miner.exe', icon: '\u{1F4A3}', isSrcDoc: true, html: GAME_HTML_MINESWEEPER, width: 300, height: 380, offsetIndex: 2 },
            { id: 'game-blocks', title: 'Blocks.exe', icon: '\u{1F9E9}', isSrcDoc: true, html: GAME_HTML_BLOCKS, width: 240, height: 440, offsetIndex: 3 },
            { id: 'game-pong', title: 'Pong.exe', icon: '\u{1F3D3}', isSrcDoc: true, html: GAME_HTML_PONG, width: 400, height: 320, offsetIndex: 4 },
            { id: 'game-flap', title: 'Flap.exe', icon: '\u{1F426}', isSrcDoc: true, html: GAME_HTML_FLAP, width: 320, height: 460, offsetIndex: 5 },
            { id: 'game-breakout', title: 'Breakout.exe', icon: '\u{1F9F1}', isSrcDoc: true, html: GAME_HTML_BREAKOUT, width: 320, height: 400, offsetIndex: 6 },
            { id: 'game-simon', title: 'Simon.exe', icon: '\u{1F3AE}', isSrcDoc: true, html: GAME_HTML_SIMON, width: 260, height: 340, offsetIndex: 7 },
            { id: 'game-rps', title: 'RPS.exe', icon: '\u270A', isSrcDoc: true, html: GAME_HTML_RPS, width: 320, height: 260, offsetIndex: 8 },
            { id: 'game-memory', title: 'Memory.exe', icon: '\u{1F9E0}', isSrcDoc: true, html: GAME_HTML_MEMORY, width: 300, height: 380, offsetIndex: 9 },
            { id: 'game-mole', title: 'Mole.exe', icon: '\u{1F439}', isSrcDoc: true, html: GAME_HTML_MOLE, width: 320, height: 420, offsetIndex: 10 }
        ];
        defs.forEach(registerLazyGame);
    }

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
            const seen = new Set();
            gamesRegistry.filter(g => { if (seen.has(g.id)) return false; seen.add(g.id); return true; }).forEach(g => {
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
    const DEFAULT_WAVE_STYLE = 'position: fixed; bottom: 80px; left: 20px; width: 220px; height: 56px; background: rgba(0,0,0,0.55); border-radius: 10px; z-index: 500; display:none; align-items:center; justify-content:center; padding: 6px; box-sizing:border-box;';

    let iconCoverEl = null; // квадратик фона, перекрывающий круглое лого "?"

    // Ищем круглую иконку-заглушку собеседника без привязки к конкретным CSS-классам сайта
    // (они могут поменяться) — по факту, что рядом лежит текст "Разговор с ...".
    function findCallIcon() {
        // Настоящий круг звонка на nekto.me.
        // ВАЖНО: у крутилки поиска тот же класс + .search_loader_circle — её исключаем,
        // иначе волна лезет на «Ищем свободного собеседника…».
        const round = document.querySelector('.callScreen__roundSvg:not(.search_loader_circle), .call-big-round__circle:not(.search_loader_circle), .call-big-round:not(.search_loader_circle)');
        if (round) {
            const rr = round.getBoundingClientRect();
            if (rr.width > 10 && rr.height > 10) return round;
        }
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

    // Сайт использует SweetAlert2 для попапов подтверждения. Пока такой попап открыт —
    // прячем нашу волну/заглушку, чтобы не наслаиваться. Проверяем видимый .swal2-container.
    function isConfirmModalOpen() {
        if (document.body && document.body.classList.contains('swal2-shown')) return true;
        const c = document.querySelector('.swal2-container');
        if (c) {
            const rect = c.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return true;
        }
        return false;
    }

    let waveSuppressed = false; // скип/стоп: гасим волну мгновенно, до перерисовки сайта
    function suppressWave(ms) {
        waveSuppressed = true;
        try { hideWaveOverlay(); } catch (e) {}
        setTimeout(() => { waveSuppressed = false; try { updateWaveformPlacement(); } catch (e) {} }, ms || 1200);
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
        return document.querySelector('button.stop-talk-button') || document.querySelector('button.stop-and-complain-button') || document.querySelector('button.callScreen__cancelCallBtn');
    }

    function makeMuteButton(id) {
        const btn = document.createElement('button');
        btn.id = id;
        btn.style.cssText = 'font-family: -apple-system, "Segoe UI", Arial, sans-serif; font-size: 12px; font-weight: bold; padding: 8px 10px; border-radius: 20px; border: 2px solid #fff; background:#0a0a0f; color:#fff; cursor: pointer; display: flex; align-items: center; justify-content:center; gap: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-sizing:border-box; box-shadow: none; transition: background .15s, border-color .15s, transform .1s;';
        return btn;
    }

    function updateMuteButtonsUI() {
        const btnCompanion = document.getElementById('nekto-btn-mute-companion');
        const btnMic = document.getElementById('nekto-btn-mute-mic');
        if (btnCompanion) {
            btnCompanion.innerHTML = companionMuted ? '🔇 Мут собеседника' : '🔊 Мут собеседника';
            btnCompanion.style.background = '#0a0a0f';
            btnCompanion.style.borderColor = companionMuted ? 'var(--nk-red,#ff4b4b)' : 'var(--nk-green,#3fdc5c)';
            btnCompanion.style.color = '#ffffff';
        }
        if (btnMic) {
            btnMic.innerHTML = micMuted ? '🚫 Мут микрофона' : '🎤 Мут микрофона';
            btnMic.style.background = '#0a0a0f';
            btnMic.style.borderColor = micMuted ? 'var(--nk-red,#ff4b4b)' : 'var(--nk-green,#3fdc5c)';
            btnMic.style.color = '#ffffff';
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

        bar.appendChild(btnMic); bar.appendChild(btnCompanion); // слева микрофон, справа собеседник
        document.body.appendChild(bar);
        updateMuteButtonsUI();
    }

    // ==========================================
    // ЗНАЧКИ: прозрачность, перемещение, скрытие
    // ==========================================
    const ICON_REGISTRY = [
        { key: 'gear',    id: 'nekto-fab-gear',       label: '⚙️ Настройки' },
        { key: 'effects', id: 'nekto-fab-effects',    label: '🎛️ Эффекты голоса' },
        { key: 'moments', id: 'nekto-fab-moments',    label: '📡 Сбои связи' },
        { key: 'timer',   id: 'nekto-fab-timer',      label: '⏱️ Таймер доступа' },
        { key: 'stats',   id: 'nekto-fab-stats',      label: '📊 Статистика' },
        { key: 'games',   id: 'nekto-games-launcher', label: '🎮 Игры' }
    ];

    let iconDragKey = null;    // какой значок сейчас тащим (его позицию фоновый цикл не трогает)
    let iconsRevealed = false; // до первой корректной раскладки значки не показываем
    function revealIcons() {
        if (iconsRevealed) return;
        iconsRevealed = true;
        applyIconSettings();
        const bar = document.getElementById('nekto-buttons-bar');
        if (bar) bar.style.opacity = '1';
    }

    function saveIconPositions() { localStorage.setItem('nekto_icon_positions', JSON.stringify(iconPositions)); }
    function saveHiddenIcons() { localStorage.setItem('nekto_hidden_icons', JSON.stringify(hiddenIcons)); }

    // Применяет прозрачность, скрытие и закреплённые позиции ко всем значкам.
    function applyIconSettings() {
        ICON_REGISTRY.forEach(r => {
            const el = document.getElementById(r.id);
            if (!el) return;
            const hidden = hiddenIcons.includes(r.key);
            if (hidden) { el.style.display = 'none'; return; }
            if (el.style.display === 'none') el.style.display = 'flex';
            el.style.opacity = iconsRevealed ? (iconOpacity / 100).toString() : '0';
            el.style.pointerEvents = iconsRevealed ? '' : 'none';
            // Пока значок тащат — не перезаписываем его координаты, иначе он
            // «телепортируется» на прошлое сохранённое место прямо под курсором.
            if (iconDragKey === r.key) return;
            const pos = iconPositions[r.key];
            if (pos) {
                if (el.parentElement !== document.body) document.body.appendChild(el);
                el.style.position = 'fixed';
                el.style.left = pos.left + 'px';
                el.style.top = pos.top + 'px';
                el.style.zIndex = '999999';
            }
            el.classList.toggle('nk-icon-editing', iconEditMode);
        });
    }

    // Перетаскивание значков (работает только пока включён режим редактирования).
    function initIconDragging() {
        ICON_REGISTRY.forEach(r => {
            const el = document.getElementById(r.id);
            if (!el || el.dataset.dragInit) return;
            el.dataset.dragInit = '1';

            // в режиме редактирования клик не должен открывать окно
            el.addEventListener('click', e => {
                if (iconEditMode) { e.preventDefault(); e.stopPropagation(); }
            }, true);

            el.addEventListener('mousedown', e => {
                if (!iconEditMode) return;
                e.preventDefault(); e.stopPropagation();
                const rect = el.getBoundingClientRect();
                // ВАЖНО: у контейнера значков есть transform, а position:fixed внутри
                // трансформированного предка отсчитывается от него, а не от экрана —
                // из-за этого значок «улетал». Выносим его в body.
                if (el.parentElement !== document.body) document.body.appendChild(el);
                iconDragKey = r.key; // блокируем фоновое перепозиционирование
                const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
                el.style.position = 'fixed';
                el.style.left = rect.left + 'px';
                el.style.top = rect.top + 'px';
                el.style.zIndex = '1000000';
                const mv = ev => {
                    const l = Math.max(0, Math.min(win.innerWidth - rect.width, ev.clientX - offX));
                    const t = Math.max(0, Math.min(win.innerHeight - rect.height, ev.clientY - offY));
                    el.style.left = l + 'px'; el.style.top = t + 'px';
                };
                const up = () => {
                    document.removeEventListener('mousemove', mv);
                    document.removeEventListener('mouseup', up);
                    iconPositions[r.key] = { left: parseInt(el.style.left) || 0, top: parseInt(el.style.top) || 0 };
                    saveIconPositions();
                    iconDragKey = null; // снимаем блокировку
                };
                document.addEventListener('mousemove', mv);
                document.addEventListener('mouseup', up);
            }, true);
        });
    }

    // Сайт затемняет фон при попапах (SweetAlert2) и в момент поиска собеседника.
    // Наши окна/значки живут выше подложки, поэтому гасим их сами, чтобы не выбивались.
    function isSiteDimmed() {
        if (document.body && document.body.classList.contains('swal2-shown')) return true;
        const sel = '.swal2-container, .modal-backdrop, .v-overlay--active, .overlay';
        for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width > 50 && r.height > 50) {
                const st = getComputedStyle(el);
                if (st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity || '1') > 0.05) return true;
            }
        }
        return false;
    }

    function applyDimState() {
        const dim = isSiteDimmed();
        document.querySelectorAll('.nekto-ui-panel, .nekto-ui-fab, #nekto-ping-badge, #nekto-mute-controls, #nekto-games-launcher, #nekto-buttons-bar')
            .forEach(el => el.classList.toggle('nk-dimmed', dim));
    }

    function applyPanelOpacity() {
        document.documentElement.style.setProperty('--nk-panel-op', (panelOpacity / 100).toString());
    }

    // ==========================================
    // ТЕМА САМОГО САЙТА (не только интерфейса скрипта)
    // ==========================================
    // 'default' — как есть; 'midnight' — чёрная шапка, тёмно-синие поля по бокам
    // и летающие белые крестики на фоне.
    function applySiteTheme(id) {
        siteTheme = id;
        localStorage.setItem('nekto_site_theme', id);

        let st = document.getElementById('nekto-site-theme-style');
        if (!st) { st = document.createElement('style'); st.id = 'nekto-site-theme-style'; (document.head || document.documentElement).appendChild(st); }

        if (id !== 'midnight') {
            st.textContent = '';
            const layer = document.getElementById('nekto-xsnow');
            if (layer) layer.remove();
            clearMidnightTransparency();
            return;
        }

        st.textContent = `
            body { background-color: #070b16 !important; background-image: none !important; }
            .navbar, .navbar-default, .navbar-fixed-top, nav.navbar { background: #000000 !important; background-color: #000000 !important; border-color: #15161c !important; }
            /* Убираем прямоугольник центральной колонки — текст и кнопки остаются на месте.
               У сайта есть правило «.night_theme .chat_container .audio-chat {...!important}»
               со специфичностью 0-3-0, поэтому дублируем классы, чтобы гарантированно перебить. */
            html body .chat_container .audio-chat.audio-chat,
            html body .chat_container .audio-chat.audio-chat > div,
            html body .chat_container .outer-container.outer-container,
            html body #audio-chat-container#audio-chat-container,
            html body .audio-chat.audio-chat .header.header,
            html body .audio-chat.audio-chat .chat-step.chat-step,
            html body .audio-chat.audio-chat .chat-step .main-panel.main-panel,
            html body .audio-chat.audio-chat .buttons-panel.buttons-panel {
                background: transparent !important; background-color: transparent !important;
                border-color: transparent !important; box-shadow: none !important;
            }
            #nekto-xsnow { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
            .nk-x { position: absolute; top: -8%; color: #ffffff; font-weight: 700; line-height: 1; user-select: none; opacity: 0; animation-name: nkXFall; animation-timing-function: linear; animation-iteration-count: infinite; }
            @keyframes nkXFall {
                0%   { transform: translate(0, -10vh) rotate(0deg); opacity: 0; }
                10%  { opacity: .85; }
                50%  { transform: translate(22px, 55vh) rotate(180deg); }
                90%  { opacity: .7; }
                100% { transform: translate(-16px, 112vh) rotate(360deg); opacity: 0; }
            }
        `;
        buildCrossLayer();
        applyMidnightTransparency();
    }

    // Стили сайта расставлены с !important и высокой специфичностью, поэтому
    // прозрачность центральной колонки надёжнее всего проставлять инлайново
    // с приоритетом important — он выше любого правила из таблиц стилей.
    const MIDNIGHT_CLEAR_SELECTORS = [
        '.chat_container', '.outer-container', '#audio-chat-container',
        '.audio-chat', '.audio-chat > div', '.audio-chat .header',
        '.audio-chat .chat-step', '.audio-chat .chat-step > div',
        '.audio-chat .main-panel', '.audio-chat .buttons-panel',
        '.callScreen', '.talk-screen', '.audio-chat .adv-block', '.advState'
    ];

    function clearBg(el) {
        el.style.setProperty('background', 'transparent', 'important');
        el.style.setProperty('background-color', 'transparent', 'important');
        el.style.setProperty('background-image', 'none', 'important');
        el.style.setProperty('box-shadow', 'none', 'important');
        el.dataset.nkClear = '1';
    }

    let lastHeavyScan = 0, lastScreenSig = '';
    function applyMidnightTransparency() {
        // Дешёвая часть: фиксированный список селекторов, без getComputedStyle
        document.querySelectorAll(MIDNIGHT_CLEAR_SELECTORS.join(',')).forEach(clearBg);

        const root = document.getElementById('audio-chat-container');
        if (!root) return;

        // Тяжёлая часть (обход всех блоков с getComputedStyle) грузит главный поток,
        // а он же обрабатывает звук собеседника. Поэтому запускаем её только когда
        // экран действительно изменился, и не чаще раза в секунду.
        const sig = root.className + '|' + root.getElementsByTagName('div').length;
        const now = Date.now();
        if (sig === lastScreenSig && now - lastHeavyScan < 3000) return;
        lastScreenSig = sig; lastHeavyScan = now;

        root.querySelectorAll('div, section, aside').forEach(el => {
            if (el.dataset.nkClear === '1') return;
            if (el.tagName === 'BUTTON' || el.closest('button')) return;
            // Проверяем КЛАССЫ-ТОКЕНЫ, а не подстроку: раньше «buttons-panel» само себя
            // защищало из-за вхождения «button», поэтому панель под кнопками не гасла.
            const cl = el.classList;
            if (cl.contains('btn') || cl.contains('round') || cl.contains('avatar') ||
                cl.contains('call-big-round') || cl.contains('callScreen__roundSvg')) return;
            const r = el.getBoundingClientRect();
            if (r.width < 200 || r.height < 20) return;   // контейнер, а не декоративный элемент
            const bc = win.getComputedStyle(el).backgroundColor;
            if (bc && bc !== 'rgba(0, 0, 0, 0)' && bc !== 'transparent') clearBg(el);
        });
    }

    function clearMidnightTransparency() {
        document.querySelectorAll('[data-nk-clear="1"]').forEach(el => {
            el.style.removeProperty('background');
            el.style.removeProperty('background-color');
            el.style.removeProperty('background-image');
            el.style.removeProperty('box-shadow');
            delete el.dataset.nkClear;
        });
    }

    // ==========================================
    // ИЗМЕРИТЕЛЬ УРОВНЯ МИКРОФОНА (дБ)
    // ==========================================
    // Считаем RMS с анализатора своего потока и переводим в dBFS, затем маппим
    // в удобную шкалу 0..100 «дБ» с зелёной / жёлтой / красной зонами.
    function buildDbMeter() {
        if (document.getElementById('nekto-db-meter')) return;
        const box = document.createElement('div');
        box.id = 'nekto-db-meter';
        box.style.cssText = 'position: fixed; left: 20px; bottom: 90px; z-index: 999997; display: none; flex-direction: column; align-items: center; gap: 7px; padding: 9px 10px; background: #0a0a0f; border: 2px solid #fff; border-radius: 10px; cursor: move; user-select: none; font-family: -apple-system, "Segoe UI", Arial, sans-serif;';
        // Цифра сверху, вертикальная шкала под ней: заполнение растёт снизу вверх
        box.innerHTML = `
            <span id="nekto-db-value" style="font-size:14px; font-weight:bold; color:#fff; font-variant-numeric: tabular-nums; white-space:nowrap;">0 дБ</span>
            <div style="position:relative; width:18px; height:110px; border:1px solid #444; border-radius:9px; overflow:hidden; background:#000;">
                <div style="position:absolute; inset:0; background: linear-gradient(0deg, #3fdc5c 0%, #3fdc5c 55%, #ffd60a 55%, #ffd60a 80%, #ff4b4b 80%, #ff4b4b 100%); opacity:.20;"></div>
                <div id="nekto-db-fill" style="position:absolute; left:0; right:0; bottom:0; height:0%; background: linear-gradient(0deg, #3fdc5c 0%, #3fdc5c 45%, #ffd60a 72%, #ff4b4b 100%); background-size: 100% 110px; background-position: bottom; transition: height .05s linear;"></div>
                <div id="nekto-db-peak" style="position:absolute; left:0; right:0; height:2px; background:#fff; bottom:0; opacity:.85;"></div>
            </div>
        `;
        document.body.appendChild(box);

        if (dbMeterPos) { box.style.left = dbMeterPos.left + 'px'; box.style.top = dbMeterPos.top + 'px'; box.style.bottom = 'auto'; }

        // перетаскивание
        box.addEventListener('mousedown', e => {
            e.preventDefault();
            const r = box.getBoundingClientRect();
            const offX = e.clientX - r.left, offY = e.clientY - r.top;
            box.style.bottom = 'auto';
            const mv = ev => {
                const l = Math.max(0, Math.min(win.innerWidth - r.width, ev.clientX - offX));
                const t = Math.max(0, Math.min(win.innerHeight - r.height, ev.clientY - offY));
                box.style.left = l + 'px'; box.style.top = t + 'px';
            };
            const up = () => {
                document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
                dbMeterPos = { left: parseInt(box.style.left) || 0, top: parseInt(box.style.top) || 0 };
                localStorage.setItem('nekto_db_meter_pos', JSON.stringify(dbMeterPos));
            };
            document.addEventListener('mousemove', mv);
            document.addEventListener('mouseup', up);
        });
    }

    // ВАЖНО: собственный getUserMedia для измерителя УБРАН. Второй одновременный захват
    // микрофона заставлял аудиоустройство переконфигурироваться, из-за чего у собеседника
    // начинал лагать звук. Измеряем строго по уже существующему пайплайну сайта.







    // ==========================================
    // УРОВЕНЬ МИКРОФОНА ИЗ СТАТИСТИКИ WebRTC
    // ==========================================
    // Никаких подключений к аудиографу: MediaStreamSource поверх микрофонного трека
    // заставлял браузер ресемплировать звук (эффект «бассбуста») и конфликтовал с
    // движком распознавания речи. Здесь мы просто ЧИТАЕМ готовое число audioLevel,
    // которое браузер и так считает для исходящего аудио. Влияния на звук — ноль.
    let currentAudioLevel = 0;      // 0..1
    let hasLevelSource = false;
    let levelPollBusy = false;

    async function pollAudioLevel() {
        if (levelPollBusy) return;
        levelPollBusy = true;
        let found = false, level = 0;
        for (const pc of Array.from(activePeerConnections)) {
            if (pc.connectionState === 'closed') { activePeerConnections.delete(pc); continue; }
            try {
                const stats = await pc.getStats();
                stats.forEach(r => {
                    // media-source — это наш микрофон до отправки; outbound-rtp — запасной вариант
                    if ((r.type === 'media-source' && r.kind === 'audio') ||
                        (r.type === 'outbound-rtp' && r.kind === 'audio')) {
                        if (typeof r.audioLevel === 'number') { found = true; level = Math.max(level, r.audioLevel); }
                    }
                });
            } catch (e) {}
        }
        hasLevelSource = found;
        if (found) currentAudioLevel = level;
        levelPollBusy = false;
    }

    // Цикл на requestAnimationFrame: не зависит от троттлинга таймеров в фоне
    // и переживает исключения — иначе окно «замирало» и обновлялось только по тоггу.
    let dbLoopStarted = false, dbErrLogged = false;
    function startDbMeterLoop() {
        if (dbLoopStarted) return;
        dbLoopStarted = true;
        // Не rAF: он будит главный поток каждый кадр, а тот же поток обрабатывает звук.
        setInterval(() => {
            if (!dbMeterOn) return;
            try { updateDbMeter(); }
            catch (e) {
                if (!dbErrLogged) { dbErrLogged = true; console.log('[alen.me] Ошибка измерителя:', e); }
            }
        }, 120);
    }

    let dbPeak = 0, dbPeakTime = 0;
    function updateDbMeter() {
        const box = document.getElementById('nekto-db-meter');
        if (!box) return;
        if (!dbMeterOn) { box.style.display = 'none'; return; }
        box.style.display = 'flex';

        // Источник — готовое значение audioLevel из статистики WebRTC (только чтение)
        const an = hasLevelSource;
        let pct = 0, dbShown = 0;
        if (an) {
            const lvl = currentAudioLevel;
            const dbfs = lvl > 0 ? 20 * Math.log10(lvl) : -100;        // -100..0 dBFS
            pct = Math.max(0, Math.min(100, (dbfs + 60) / 60 * 100));  // -60 dBFS = 0%, 0 dBFS = 100%
            dbShown = Math.round(Math.max(0, dbfs + 100));             // «бытовая» шкала 0..100 дБ
        }

        const fill = document.getElementById('nekto-db-fill');
        const val = document.getElementById('nekto-db-value');
        const peak = document.getElementById('nekto-db-peak');
        if (fill) fill.style.height = pct.toFixed(1) + '%';
        if (val) {
            if (!an) { val.innerText = 'нет\u00A0сигнала'; val.style.fontSize = '11px'; val.style.color = '#9a9a9a'; }
            else {
                val.innerText = dbShown + ' дБ';
                val.style.fontSize = '14px';
                val.style.color = pct < 55 ? '#3fdc5c' : (pct < 80 ? '#ffd60a' : '#ff4b4b');
            }
        }
        // маркер пикового значения, медленно сползает вниз
        const now = Date.now();
        if (pct >= dbPeak) { dbPeak = pct; dbPeakTime = now; }
        else if (now - dbPeakTime > 700) dbPeak = Math.max(pct, dbPeak - 1.5);
        if (peak) peak.style.bottom = 'calc(' + dbPeak.toFixed(1) + '% - 1px)';
    }

    function buildCrossLayer() {
        if (document.getElementById('nekto-xsnow')) return;
        const layer = document.createElement('div');
        layer.id = 'nekto-xsnow';
        const COUNT = 24;
        let html = '';
        for (let i = 0; i < COUNT; i++) {
            const size = 6 + Math.random() * 16;             // разный размер, как снежинки
            const left = Math.random() * 100;
            const dur = 9 + Math.random() * 16;
            const delay = -Math.random() * dur;               // отрицательная задержка = уже в полёте
            html += `<span class="nk-x" style="left:${left.toFixed(2)}%; font-size:${size.toFixed(1)}px; animation-duration:${dur.toFixed(1)}s; animation-delay:${delay.toFixed(1)}s;">✕</span>`;
        }
        layer.innerHTML = html;
        document.body.appendChild(layer);
    }

    function setIconEditMode(on) {
        iconEditMode = on;
        applyIconSettings();
        const b = document.getElementById('nekto-btn-icon-edit');
        if (b) b.innerText = on ? '✋ Режим перемещения: ВКЛ' : '✋ Режим перемещения: выкл';
    }

    // Ставим ряд значков ровно в пустую полосу шапки аудиочата (.audio-chat .header).
    // Если шапки нет (другая страница) — держим фикс сверху по центру.
    function positionButtonsBar() {
        const bar = document.getElementById('nekto-buttons-bar');
        if (!bar) return;
        const header = document.querySelector('.audio-chat .header');
        if (header) {
            const r = header.getBoundingClientRect();
            if (r.width > 5 && r.height > 5) {
                bar.style.top = (r.bottom + 10) + 'px';
                bar.style.left = (r.left + r.width / 2) + 'px';
                bar.style.transform = 'translateX(-50%)';
                revealIcons(); // раскладка готова — можно показывать
                return;
            }
        }
        // фолбэк
        bar.style.top = '108px';
        bar.style.left = '50%';
        bar.style.transform = 'translateX(-50%)';
    }

    function updateMuteControlsPlacement() {
        const bar = document.getElementById('nekto-mute-controls');
        if (!bar) return;

        if (!win.location.href.includes('/audiochat') || isConfirmModalOpen()) { bar.style.visibility = 'hidden'; return; }

        const cancelBtn = findCancelCallButton();
        if (!cancelBtn) { bar.style.visibility = 'hidden'; return; }

        const cr = cancelBtn.getBoundingClientRect();
        if (cr.width < 5 || cr.height < 5) { bar.style.visibility = 'hidden'; return; }

        // Опорный ряд = контейнер нативных кнопок (Завершить + круглые), если он вменяемого размера.
        let left = cr.left, width = cr.width * 1.5;
        const parent = cancelBtn.parentElement;
        if (parent) {
            const pr = parent.getBoundingClientRect();
            if (pr.width >= cr.width && pr.width <= cr.width * 2.4 && Math.abs(pr.left - cr.left) < cr.width) {
                left = pr.left; width = pr.width;
            }
        }
        width = Math.min(width, win.innerWidth - 16);
        left = Math.max(8, Math.min(win.innerWidth - width - 8, left));

        bar.style.display = 'flex';
        bar.style.visibility = 'visible';
        bar.style.width = width + 'px';
        bar.style.top = (cr.bottom + 10) + 'px';
        bar.style.left = left + 'px';

        // Обе кнопки ровно в половину ширины ряда — встают по размеру под нативными.
        const gap = 10;
        const halfW = Math.floor((width - gap) / 2);
        ['nekto-btn-mute-mic', 'nekto-btn-mute-companion'].forEach(id => {
            const b = document.getElementById(id);
            if (b) { b.style.width = halfW + 'px'; b.style.flex = '0 0 ' + halfW + 'px'; }
        });
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

        // Волну ставим СРАЗУ, как только появился экран звонка (есть кнопка завершения),
        // не дожидаясь поднятия аудиопайплайна — иначе она заметно «вползает» с задержкой.
        // До прихода звука она просто плоская. Плюс ручная блокировка на время скипа.
        if (waveSuppressed) { hideWaveOverlay(); return; }
        const callLive = !!findCancelCallButton();
        if (!callLive) { hideWaveOverlay(); return; }

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

            // Квадрат-заглушка должен сливаться с тем, что реально позади иконки.
            // Ищем ближайший непрозрачный фон вверх по дереву; если вся колонка прозрачная
            // (тема «Полночь»), берём фон body — иначе получался тёмный квадрат.
            let bg = null;
            try {
                if (siteTheme === 'midnight') {
                    // В «Полночи» колонка всегда прозрачная, поэтому опрашивать родителей нельзя:
                    // на новом экране они ещё не успели очиститься и заглушка мигала тёмным квадратом.
                    const bodyBg = win.getComputedStyle(document.body).backgroundColor;
                    bg = (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent') ? bodyBg : 'transparent';
                } else {
                    let node = icon.parentElement;
                    for (let i = 0; i < 8 && node; i++) {
                        const cs = win.getComputedStyle(node);
                        if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') { bg = cs.backgroundColor; break; }
                        node = node.parentElement;
                    }
                    if (!bg) {
                        const bodyBg = win.getComputedStyle(document.body).backgroundColor;
                        bg = (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)') ? bodyBg : 'transparent';
                    }
                }
            } catch (e) { bg = 'transparent'; }

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
    let lastMidnightRun = 0;
    function scheduleWaveformUpdate() {
        if (waveObserverScheduled) return;
        waveObserverScheduled = true;
        requestAnimationFrame(() => {
            waveObserverScheduled = false;
            try { updateWaveformPlacement(); } catch (e) {}
            try { updateMuteControlsPlacement(); } catch (e) {}
            // Экран меняется (нашли собеседника / завершили) — гасим фон сразу,
            // не дожидаясь фонового цикла, иначе прямоугольник успевает мелькнуть.
            if (siteTheme === 'midnight') {
                const now = Date.now();
                if (now - lastMidnightRun > 90) { // лёгкий троттлинг, чтобы не грузить рендер
                    lastMidnightRun = now;
                    try { applyMidnightTransparency(); } catch (e) {}
                }
            }
        });
    }

    // visualizer creation
    function initWaveformVisualizer() {

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

        // ==========================================================
        // ПОРЯДОК ЗАПУСКА (важно для голосовых команд)
        // ==========================================================
        // Раньше вся сборка интерфейса шла ОДНИМ синхронным куском: окна, темы,
        // iframe'ы игр, фон с крестиками. Главный поток вставал на ~600 мс
        // ([Violation] 'setTimeout' handler took 595ms в консоли), а движок распознавания
        // стартовал ровно в середине этого блока — и тут же умирал с 'aborted'.
        // Теперь: движок стартует ПЕРВЫМ, а тяжёлый UI собирается порциями,
        // между которыми браузер успевает дышать.
        initVoiceEngine();

        const bootSteps = [
            () => { buildUIPanels(); },
            () => { injectRetroSkin(); applyUITheme(uiTheme); applyGameTheme(gameTheme); },
            () => { if (!safeMode) { initPingBadge(); setInterval(updatePingBadge, 2000); } if (mediaKeysActive) startMediaKeys(); },
            () => { if (!safeMode) { initWaveformVisualizer(); initMuteControls(); } },
            () => { if (!safeMode) initExtraGamesLazy(); },
            () => { if (!safeMode) initGamesLauncher(); },
            () => { applyPanelOpacity(); if (!safeMode) { buildDbMeter(); startDbMeterLoop(); } },
            () => { if (!safeMode) applySiteTheme(siteTheme); },
            () => { positionButtonsBar(); initIconDragging(); applyIconSettings(); watchPanelOpenAnim(); applyLogoBrand(); },
            () => {
                // Периодические задачи поднимаем в самом конце, когда UI уже собран
                setInterval(() => {
                    positionButtonsBar(); initIconDragging(); applyIconSettings();
                    if (!safeMode && siteTheme === 'midnight') { buildCrossLayer(); applyMidnightTransparency(); }
                }, 600);
                if (!safeMode) {
                    setInterval(applyLogoBrand, 1500);
                    setInterval(applyDimState, 400);
                    setInterval(() => { if (dbMeterOn) pollAudioLevel(); }, 150);
                    setInterval(() => { if (Math.random() < 0.1) fireFullGlitch(); }, 20000);
                    scheduleHeaderGlitch();
                    setTimeout(scheduleLogoGlitch, 1700);
                }
                revealIcons();
                // Движок распознавания уже поднят в начале init() — трогать его не нужно.
                // Любой дополнительный startEngine() поверх работающей сессии вызывает
                // ошибку 'recognition has already started', та ведёт к пересборке движка,
                // и в итоге плодятся параллельные экземпляры, которые дерутся за микрофон.
            }
        ];

        let stepIndex = 0;
        const idle = win.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 8 }), 16));
        function runNextStep() {
            if (stepIndex >= bootSteps.length) return;
            try { bootSteps[stepIndex++](); } catch (e) { console.log('[alen.me] Ошибка на шаге запуска', stepIndex, e); }
            idle(runNextStep, { timeout: 300 });
        }
        idle(runNextStep, { timeout: 300 });

        setTimeout(revealIcons, 2500); // страховка, если шапка сайта так и не нашлась
        win.addEventListener('resize', positionButtonsBar);
        win.addEventListener('scroll', positionButtonsBar, true);

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