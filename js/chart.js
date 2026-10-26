/* ============================================================
   js/chart.js — Criação e controle dos gráficos (Lightweight Charts)
   ============================================================ */

function initCharts() {
    const mainContainer = document.getElementById('chart-main');
    const rsiContainer  = document.getElementById('chart-rsi');
    const macdContainer = document.getElementById('chart-macd');

    const base = {
        layout: { background: { type: 'solid', color: '#0b0e11' }, textColor: '#848e9c', fontSize: 11 },
        grid: { vertLines: { color: '#181a20' }, horzLines: { color: '#181a20' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        timeScale: { borderColor: '#2b313a', timeVisible: true, secondsVisible: false }
    };

    state.charts.main = LightweightCharts.createChart(mainContainer, {
        ...base, width: mainContainer.clientWidth, height: mainContainer.clientHeight,
        rightPriceScale: { borderColor: '#2b313a', autoScale: true }
    });
    state.series.candles = state.charts.main.addCandlestickSeries({
        upColor: '#0ecb81', downColor: '#f6465d',
        borderUpColor: '#0ecb81', borderDownColor: '#f6465d',
        wickUpColor: '#0ecb81', wickDownColor: '#f6465d'
    });
    const isTrendStrategy = (window.PAGE_STRATEGY === 'trend_sma');
    const isBollingerStrategy = (window.PAGE_STRATEGY === 'bollinger_bands');
    const maLabel1 = isTrendStrategy ? 'SMA 20' : (isBollingerStrategy ? 'Banda Média (SMA 20)' : 'MA 9');
    const maLabel2 = isTrendStrategy ? 'SMA 50' : 'MA 96';

    state.series.ma9  = state.charts.main.addLineSeries({ 
        color: isBollingerStrategy ? '#f0b90b' : '#38b6ff', 
        lineWidth: isBollingerStrategy ? 1 : 2, 
        lineStyle: isBollingerStrategy ? LightweightCharts.LineStyle.Dotted : LightweightCharts.LineStyle.Solid,
        title: maLabel1, 
        visible: state.maVisible 
    });

    if (!isBollingerStrategy) {
        state.series.ma96 = state.charts.main.addLineSeries({ color: '#f0b90b', lineWidth: 2, title: maLabel2, visible: state.maVisible });
    }

    if (isTrendStrategy) {
        // SMA 8 — linha de sinal de entrada ORION
        state.series.ma8 = state.charts.main.addLineSeries({ color: '#00ff88', lineWidth: 2, title: 'SMA 8', visible: state.maVisible });
    }

    if (isBollingerStrategy) {
        // SMA 8 Aritmética (Verde Neon)
        state.series.ma8 = state.charts.main.addLineSeries({
            color: '#00ff88',
            lineWidth: 1.5,
            title: 'SMA 8',
            visible: state.maVisible
        });

        // SMA 200 Aritmética (Laranja)
        state.series.ma200 = state.charts.main.addLineSeries({
            color: '#ff7700',
            lineWidth: 2,
            title: 'SMA 200',
            visible: state.maVisible
        });

        // Bandas de Bollinger Superior e Inferior
        state.series.bbUpper = state.charts.main.addLineSeries({
            color: '#38b6ff',
            lineWidth: 2,
            title: 'Banda Sup (+2σ)',
            visible: state.maVisible
        });
        state.series.bbLower = state.charts.main.addLineSeries({
            color: '#38b6ff',
            lineWidth: 2,
            title: 'Banda Inf (-2σ)',
            visible: state.maVisible
        });
    }

    if (!isBollingerStrategy && rsiContainer) {
        state.charts.rsi = LightweightCharts.createChart(rsiContainer, {
            ...base, width: rsiContainer.clientWidth, height: rsiContainer.clientHeight,
            rightPriceScale: { borderColor: '#2b313a', autoScale: true }
        });
        state.series.rsi = state.charts.rsi.addLineSeries({ color: '#a259ff', lineWidth: 2, title: 'RSI 14' });
        state.series.rsi.createPriceLine({ price: 70, color: '#f6465d', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
        state.series.rsi.createPriceLine({ price: 50, color: '#848e9c', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
        state.series.rsi.createPriceLine({ price: 30, color: '#0ecb81', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
    }

    if (!isTrendStrategy && !isBollingerStrategy && macdContainer) {
        state.charts.macd = LightweightCharts.createChart(macdContainer, {
            ...base, width: macdContainer.clientWidth, height: macdContainer.clientHeight,
            rightPriceScale: { borderColor: '#2b313a', autoScale: true }
        });
        state.series.macd   = state.charts.macd.addLineSeries({ color: '#ffffff', lineWidth: 2, title: 'MACD' });
        state.series.signal = state.charts.macd.addLineSeries({ color: '#f6465d', lineWidth: 2, title: 'Signal' });
    }

    // Sincronização de tempo entre gráficos
    let isSyncing = false;
    function sync(source, targets) {
        source.timeScale().subscribeVisibleLogicalRangeChange(range => {
            if (isSyncing || !range) return;
            isSyncing = true;
            targets.forEach(t => { if (t) t.timeScale().setVisibleLogicalRange(range); });
            isSyncing = false;
        });
    }
    if (state.charts.rsi) {
        sync(state.charts.main, [state.charts.rsi]);
        sync(state.charts.rsi,  [state.charts.main]);
    }
    if (!isTrendStrategy && !isBollingerStrategy && state.charts.macd && state.charts.rsi) {
        sync(state.charts.main, [state.charts.rsi, state.charts.macd]);
        sync(state.charts.rsi,  [state.charts.main, state.charts.macd]);
        sync(state.charts.macd, [state.charts.main, state.charts.rsi]);
    }

    // Crosshair inspector
    const handleCrosshairMove = (param) => {
        if (!param || !param.time) { state.isHovering = false; updateMetricsUI(); return; }
        const idx = findCandleIndexByTime(param.time);
        if (idx === -1) { state.isHovering = false; updateMetricsUI(); return; }
        state.isHovering = true;
        renderHoverMetrics(
            state.candles[idx], 
            state.ma9 ? state.ma9[idx] : null, 
            state.ma96 ? state.ma96[idx] : null, 
            state.rsi ? state.rsi[idx] : null, 
            state.macd ? state.macd[idx] : null, 
            state.signal ? state.signal[idx] : null
        );
    };
    state.charts.main.subscribeCrosshairMove(handleCrosshairMove);
    if (state.charts.rsi) state.charts.rsi.subscribeCrosshairMove(handleCrosshairMove);
    if (state.charts.macd) state.charts.macd.subscribeCrosshairMove(handleCrosshairMove);

    // Auto-resize
    const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
            const { width, height } = entry.contentRect;
            const id = entry.target.id;
            if (id === 'chart-main' && state.charts.main)  state.charts.main.resize(width, height);
            if (id === 'chart-rsi'  && state.charts.rsi)   state.charts.rsi.resize(width, height);
            if (id === 'chart-macd' && state.charts.macd)  state.charts.macd.resize(width, height);
        }
    });
    ro.observe(mainContainer);
    if (rsiContainer) ro.observe(rsiContainer);
    if (macdContainer && state.charts.macd) ro.observe(macdContainer);

    // Sincroniza estado visual inicial do botão de médias
    const btn = document.getElementById('btn-toggle-ma');
    const isBollinger = (window.PAGE_STRATEGY === 'bollinger_bands');
    const isTrend = (window.PAGE_STRATEGY === 'trend_sma');
    const maLbl = isBollinger ? 'Bandas + SMAs' : (isTrend ? 'SMA 8/20/50' : 'MA 9/96');
    if (btn) {
        btn.textContent = state.maVisible ? `${maLbl}: ON` : `${maLbl}: OFF`;
        state.maVisible ? btn.classList.add('active') : btn.classList.remove('active');
    }
}

function findCandleIndexByTime(time) {
    if (!time || state.candles.length === 0) return -1;
    let lo = 0, hi = state.candles.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (state.candles[mid].time === time) return mid;
        if (state.candles[mid].time < time) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
}

function botClearSlTpLines() {
    if (botState.entryPriceLine && state.series.candles) { try { state.series.candles.removePriceLine(botState.entryPriceLine); } catch(e){} botState.entryPriceLine = null; }
    if (botState.slPriceLine    && state.series.candles) { try { state.series.candles.removePriceLine(botState.slPriceLine); }    catch(e){} botState.slPriceLine = null; }
    if (botState.tpPriceLine    && state.series.candles) { try { state.series.candles.removePriceLine(botState.tpPriceLine); }    catch(e){} botState.tpPriceLine = null; }
}

function btClearSlTpLines() {
    if (bt.entryPriceLine && state.series.candles) { try { state.series.candles.removePriceLine(bt.entryPriceLine); } catch(e){} bt.entryPriceLine = null; }
    if (bt.slPriceLine    && state.series.candles) { try { state.series.candles.removePriceLine(bt.slPriceLine); }    catch(e){} bt.slPriceLine = null; }
    if (bt.tpPriceLine    && state.series.candles) { try { state.series.candles.removePriceLine(bt.tpPriceLine); }    catch(e){} bt.tpPriceLine = null; }
}

function toggleMovingAverages() {
    state.maVisible = !state.maVisible;
    localStorage.setItem('maVisible', state.maVisible);
    if (state.series.ma8)     state.series.ma8.applyOptions({ visible: state.maVisible });
    if (state.series.ma9)     state.series.ma9.applyOptions({ visible: state.maVisible });
    if (state.series.ma96)    state.series.ma96.applyOptions({ visible: state.maVisible });
    if (state.series.ma200)   state.series.ma200.applyOptions({ visible: state.maVisible });
    if (state.series.bbUpper) state.series.bbUpper.applyOptions({ visible: state.maVisible });
    if (state.series.bbLower) state.series.bbLower.applyOptions({ visible: state.maVisible });
    const btn = document.getElementById('btn-toggle-ma');
    const isBollinger = (window.PAGE_STRATEGY === 'bollinger_bands');
    const isTrend = (window.PAGE_STRATEGY === 'trend_sma');
    const maLbl = isBollinger ? 'Bandas + SMAs' : (isTrend ? 'SMA 8/20/50' : 'MA 9/96');
    if (btn) {
        btn.textContent = state.maVisible ? `${maLbl}: ON` : `${maLbl}: OFF`;
        state.maVisible ? btn.classList.add('active') : btn.classList.remove('active');
    }
}

