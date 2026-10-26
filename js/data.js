/* ============================================================
   js/data.js — Carregamento de histórico, WebSocket e séries dos gráficos
   ============================================================ */

async function fetchHistoricalData() {
    updateStatus("online", `Carregando dados (${state.interval})...`);
    try {
        const res = await fetch(`${API_URL_KLINES}?symbol=${state.symbol}&interval=${state.interval}&limit=1000`);
        if (!res.ok) throw new Error("Erro na API");
        const data = await res.json();
        state.candles = data.map(c => ({
            time: Math.floor(c[0] / 1000),
            open: parseFloat(c[1]), high: parseFloat(c[2]),
            low: parseFloat(c[3]),  close: parseFloat(c[4]),
            volume: parseFloat(c[5])
        }));
        recalculateFullIndicators();
        renderAllSeries();
        connectWebSocket();
    } catch (err) {
        console.error("Erro histórico:", err);
        updateStatus("offline", "Erro ao carregar histórico");
    }
}

function recalculateFullIndicators() {
    const closes = state.candles.map(c => c.close);
    const isTrend = (window.PAGE_STRATEGY === 'trend_sma');
    const isBollinger = (window.PAGE_STRATEGY === 'bollinger_bands');

    if (isBollinger) {
        const bb = calculateBollingerBands(closes, 20, 2);
        state.bbUpper = bb.upper;
        state.bbMiddle = bb.middle;
        state.bbLower = bb.lower;
        state.ma9 = bb.middle; // reutilizado como linha média (SMA 20)
        state.ma8 = calculateSMA(closes, 8); // SMA 8 aritmética
        state.ma200 = calculateSMA(closes, 200); // SMA 200 aritmética
        state.ma96 = [];
        state.rsi = [];
        state.macd = [];
        state.signal = [];
    } else {
        state.ma8    = isTrend ? calculateSMA(closes, 8) : [];
        state.ma9    = calculateSMA(closes, isTrend ? 20 : 9);
        state.ma96   = calculateSMA(closes, isTrend ? 50 : 96);
        state.ma200  = [];
        state.rsi    = calculateRSIWilder(closes, 14);
        if (!isTrend) {
            const mc     = calculateMACD(closes, 12, 26, 9);
            state.macd   = mc.macdLine;
            state.signal = mc.signalLine;
        }
    }
}

function renderAllSeries() {
    const isTrend = (window.PAGE_STRATEGY === 'trend_sma');
    const isBollinger = (window.PAGE_STRATEGY === 'bollinger_bands');

    if (isBollinger) {
        const bbUpperD = [], bbMidD = [], bbLowerD = [], ma8D = [], ma200D = [];
        for (let i = 0; i < state.candles.length; i++) {
            const t = state.candles[i].time;
            if (state.bbUpper && state.bbUpper[i] !== null) bbUpperD.push({ time: t, value: state.bbUpper[i] });
            if (state.bbMiddle && state.bbMiddle[i] !== null) bbMidD.push({ time: t, value: state.bbMiddle[i] });
            if (state.bbLower && state.bbLower[i] !== null) bbLowerD.push({ time: t, value: state.bbLower[i] });
            if (state.ma8 && state.ma8[i] !== null) ma8D.push({ time: t, value: state.ma8[i] });
            if (state.ma200 && state.ma200[i] !== null) ma200D.push({ time: t, value: state.ma200[i] });
        }
        if (state.series.candles) state.series.candles.setData(state.candles);
        if (state.series.ma9) state.series.ma9.setData(bbMidD);
        if (state.series.bbUpper) state.series.bbUpper.setData(bbUpperD);
        if (state.series.bbLower) state.series.bbLower.setData(bbLowerD);
        if (state.series.ma8) state.series.ma8.setData(ma8D);
        if (state.series.ma200) state.series.ma200.setData(ma200D);
    } else {
        const ma8D = [], ma9D = [], ma96D = [], rsiD = [], macdD = [], sigD = [];
        for (let i = 0; i < state.candles.length; i++) {
            const t = state.candles[i].time;
            if (isTrend && state.ma8[i] !== null) ma8D.push({ time: t, value: state.ma8[i] });
            if (state.ma9[i]    !== null) ma9D.push({ time: t, value: state.ma9[i] });
            if (state.ma96[i]   !== null) ma96D.push({ time: t, value: state.ma96[i] });
            if (state.rsi[i]    !== null) rsiD.push({ time: t, value: state.rsi[i] });
            if (!isTrend) {
                if (state.macd[i]   !== null) macdD.push({ time: t, value: state.macd[i] });
                if (state.signal[i] !== null) sigD.push({ time: t, value: state.signal[i] });
            }
        }
        state.series.candles.setData(state.candles);
        if (isTrend && state.series.ma8) state.series.ma8.setData(ma8D);
        if (state.series.ma9) state.series.ma9.setData(ma9D);
        if (state.series.ma96) state.series.ma96.setData(ma96D);
        if (state.series.rsi) state.series.rsi.setData(rsiD);
        if (!isTrend && state.series.macd) {
            state.series.macd.setData(macdD);
            state.series.signal.setData(sigD);
        }
    }

    if (typeof botState !== 'undefined' && botState.running) {
        state.series.candles.setMarkers(botState.markers);
        if (state.series.rsi) { try { state.series.rsi.setMarkers(botState.rsiMarkers); } catch(e) {} }
        if (!isTrend && !isBollinger && state.series.macd) {
            try { state.series.macd.setMarkers(botState.macdMarkers); } catch(e) {}
        }
    }
    updateMetricsUI();
}

function safeUpdateSeries(series, time, value) {
    if (series && time && value !== null && !isNaN(value)) {
        try { series.update({ time, value }); } catch(e) {}
    }
}

function safeUpdateCandle(series, candle) {
    if (series && candle && candle.time && !isNaN(candle.close)) {
        try { series.update(candle); } catch(e) {}
    }
}

function connectWebSocket() {
    if (state.ws) { state.ws.onclose = null; state.ws.onerror = null; state.ws.close(); }
    const sym = state.symbol.toLowerCase();
    const url = `${WS_BASE_URL}${sym}@kline_${state.interval}`;
    updateStatus("online", `Conectando WS (${state.interval})...`);
    state.ws = new WebSocket(url);

    state.ws.onopen = () => updateStatus("online", `Ao Vivo WebSocket (${state.interval})`);

    state.ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (!msg || msg.e !== 'kline' || !msg.k) return;
            const k = msg.k;
            const candleTime = Math.floor(k.t / 1000);
            const upd = {
                time: candleTime,
                open: parseFloat(k.o)||0, high: parseFloat(k.h)||0,
                low:  parseFloat(k.l)||0, close: parseFloat(k.c)||0,
                volume: parseFloat(k.v)||0
            };
            if (isNaN(upd.close) || upd.close === 0) return;
            const lastIdx = state.candles.length - 1;
            if (lastIdx < 0) return;
            const last = state.candles[lastIdx];
            let newCandle = false;
            if (candleTime === last.time) {
                state.candles[lastIdx] = upd;
            } else if (candleTime > last.time) {
                state.candles.push(upd);
                newCandle = true;
            } else {
                return;
            }
            recalculateFullIndicators();
            const ci = state.candles.length - 1;
            const cc = state.candles[ci];
            safeUpdateCandle(state.series.candles, cc);

            const isBollinger = (window.PAGE_STRATEGY === 'bollinger_bands');
            if (isBollinger) {
                if (state.series.ma9 && state.bbMiddle) safeUpdateSeries(state.series.ma9, cc.time, state.bbMiddle[ci]);
                if (state.series.bbUpper && state.bbUpper) safeUpdateSeries(state.series.bbUpper, cc.time, state.bbUpper[ci]);
                if (state.series.bbLower && state.bbLower) safeUpdateSeries(state.series.bbLower, cc.time, state.bbLower[ci]);
                if (state.series.ma8 && state.ma8) safeUpdateSeries(state.series.ma8, cc.time, state.ma8[ci]);
                if (state.series.ma200 && state.ma200) safeUpdateSeries(state.series.ma200, cc.time, state.ma200[ci]);
            } else {
                if (window.PAGE_STRATEGY === 'trend_sma' && state.series.ma8) {
                    safeUpdateSeries(state.series.ma8, cc.time, state.ma8[ci]);
                }
                if (state.series.ma9) safeUpdateSeries(state.series.ma9, cc.time, state.ma9[ci]);
                if (state.series.ma96) safeUpdateSeries(state.series.ma96, cc.time, state.ma96[ci]);
                if (state.series.rsi) safeUpdateSeries(state.series.rsi, cc.time, state.rsi[ci]);
                if (window.PAGE_STRATEGY !== 'trend_sma' && state.series.macd) {
                    safeUpdateSeries(state.series.macd,   cc.time, state.macd[ci]);
                    safeUpdateSeries(state.series.signal, cc.time, state.signal[ci]);
                }
            }
            if (!state.isHovering) updateMetricsUI();

            // Sinais do bot real-time
            if (botState.running && newCandle) {
                processNewCandle(ci);
            }
        } catch(err) { console.error("Erro WS tick:", err); }
    };

    state.ws.onerror = () => updateStatus("offline", "Erro WS - Reconectando...");
    state.ws.onclose = () => {
        updateStatus("offline", "Desconectado. Reconectando...");
        setTimeout(connectWebSocket, 3000);
    };
}
