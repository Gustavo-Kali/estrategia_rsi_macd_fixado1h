/* ============================================================
   js/backtest.js — Engine de simulação histórica (Backtest)
   ============================================================ */

async function backtestLoadData() {
    if (bt.allCandles.length > 0 && bt.loadedInterval === state.interval && bt.loadedSymbol === state.symbol) return true;
    try {
        const sym = state.symbol.toLowerCase();
        updateBtProgress(`Carregando dados históricos (${state.symbol} ${state.interval})...`);

        // Timeframes com arquivo local disponível
        const localIntervals = ['15m', '30m', '1h', '1d'];
        let loaded = false;
        if (localIntervals.includes(state.interval)) {
            const fileName = `/data/${sym}_${state.interval}_3years.json`;
            try {
                const res = await fetch(fileName);
                if (res.ok) {
                    const raw = await res.json();
                    bt.allCandles = raw.map(c => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
                    loaded = true;
                }
            } catch (e) {
                loaded = false;
            }
        }
        
        if (!loaded) {
            const res = await fetch(`${API_URL_KLINES}?symbol=${state.symbol}&interval=${state.interval}&limit=1500`);
            if (!res.ok) throw new Error(`Não foi possível carregar dados da Binance para ${state.symbol}`);
            const data = await res.json();
            bt.allCandles = data.map(c => ({
                time: Math.floor(c[0] / 1000),
                open: parseFloat(c[1]), high: parseFloat(c[2]),
                low: parseFloat(c[3]),  close: parseFloat(c[4]),
                volume: parseFloat(c[5])
            }));
        }
        bt.loadedInterval = state.interval;
        bt.loadedSymbol   = state.symbol;
        console.log(`Backtest carregado (${state.symbol} ${state.interval}): ${bt.allCandles.length} candles.`);
        return true;
    } catch(e) {
        console.error('Erro ao carregar backtest:', e);
        updateBtProgress(`ERRO: ${e.message}`);
        return false;
    }
}

function toggleBacktestBar() {
    const btBar = document.getElementById('backtest-bar');
    const btBtn = document.getElementById('btn-toggle-backtest');
    if (!btBar) return;
    const isVisible = btBar.classList.toggle('visible');
    if (btBtn) btBtn.classList.toggle('active', isVisible);
    const btStats = document.getElementById('bt-stats');
    if (!isVisible && btStats && !bt.running) btStats.classList.remove('visible');
    const saved = localStorage.getItem('bot_layout_preset') || 'binance';
    applyPreset(saved, false);
}

async function backtestStart() {
    if (bt.running && !bt.paused) return;
    if (bt.paused) {
        bt.paused = false;
        document.getElementById('btn-bt-pause').textContent = '⏸ Pausar';
        backtestSchedule();
        return;
    }
    const ok = await backtestLoadData();
    if (!ok) return;

    const stratKey = (typeof botState !== 'undefined' && botState.strategy) || 'rsi_macd';
    const botId = btGetBotId();
    let loaded = false;

    // 1. Tenta carregar estado do Firebase (prioritário — funciona entre browsers/máquinas)
    updateBtProgress('Verificando estado salvo no Firebase...');
    if (window.FirebaseSync && typeof window.FirebaseSync.loadBacktestState === 'function') {
        try {
            const fbState = await window.FirebaseSync.loadBacktestState(botId, state.symbol, state.interval);
            if (fbState && fbState.cursor > 0) {
                // Reconstrói bt.candles a partir dos dados históricos até o cursor salvo
                bt.cursor = Math.min(fbState.cursor, bt.allCandles.length);
                bt.candles = bt.allCandles.slice(0, bt.cursor);
                bt.balance = fbState.balance;
                bt.trades = fbState.trades;
                bt.wins = fbState.wins;
                bt.losses = fbState.losses;
                bt.grossPnl = fbState.grossPnl || 0;
                bt.netPnl = fbState.netPnl || 0;
                bt.peakBalance = fbState.peakBalance || fbState.initialBalance || 10000;
                bt.feesPaid = fbState.feesPaid || 0;
                bt.maxDrawdown = fbState.maxDrawdown || 0;
                bt.maxDrawdownPct = fbState.maxDrawdownPct || 0;
                bt.maxWin = fbState.maxWin || 0;
                bt.maxLoss = fbState.maxLoss || 0;
                bt.grossWinsTotal = fbState.grossWinsTotal || 0;
                bt.grossLossesTotal = fbState.grossLossesTotal || 0;
                bt.consecutiveWins = fbState.consecutiveWins || 0;
                bt.maxConsecutiveWins = fbState.maxConsecutiveWins || 0;
                bt.consecutiveLosses = fbState.consecutiveLosses || 0;
                bt.maxConsecutiveLosses = fbState.maxConsecutiveLosses || 0;
                bt.longTrades = fbState.longTrades || 0;
                bt.longWins = fbState.longWins || 0;
                bt.longLosses = fbState.longLosses || 0;
                bt.shortTrades = fbState.shortTrades || 0;
                bt.shortWins = fbState.shortWins || 0;
                bt.shortLosses = fbState.shortLosses || 0;
                bt.tradeHistory = fbState.tradeHistory || [];

                bt.position = fbState.position || null;
                bt.entryPrice = fbState.entryPrice || 0;
                bt.entryIdx = fbState.entryIdx || 0;
                bt.stopLoss = fbState.stopLoss || 0;
                bt.takeProfit = fbState.takeProfit || 0;
                bt.alertBuy = fbState.alertBuy || false;
                bt.alertSell = fbState.alertSell || false;
                bt.bbShortPhase = fbState.bbShortPhase || 0;
                bt.bbLongPhase = fbState.bbLongPhase || 0;
                bt.bbDownDuration = fbState.bbDownDuration || 0;
                bt.bbUpDuration = fbState.bbUpDuration || 0;
                bt.markers = [];
                bt.rsiMarkers = [];
                bt.macdMarkers = [];
                btRecalcIndicators();
                loaded = true;
                console.log(`🔄 [Backtest] Retomando do Firebase: cursor=${bt.cursor}/${bt.allCandles.length}, trades=${bt.trades}`);
            }
        } catch (e) {
            console.warn('[Backtest] Falha ao carregar do Firebase, tentando localStorage:', e);
        }
    }

    // 2. Fallback: localStorage (mesmo browser)
    if (!loaded) {
        const savedStr = localStorage.getItem(`bt_state_${stratKey}_${state.symbol}_${state.interval}`);
        if (savedStr) {
            try {
                const saved = JSON.parse(savedStr);
                if (saved.symbol === state.symbol && saved.interval === state.interval && saved.cursor > 0) {
                    bt.cursor = Math.min(saved.cursor, bt.allCandles.length);
                    bt.candles = bt.allCandles.slice(0, bt.cursor);
                    bt.balance = saved.balance;
                    bt.trades = saved.trades;
                    bt.wins = saved.wins;
                    bt.losses = saved.losses;
                bt.grossPnl = saved.grossPnl || 0;
                bt.netPnl = saved.netPnl || 0;
                bt.peakBalance = saved.peakBalance || saved.initialBalance || 10000;
                bt.feesPaid = saved.feesPaid || 0;
                bt.maxDrawdown = saved.maxDrawdown || 0;
                bt.maxDrawdownPct = saved.maxDrawdownPct || 0;
                bt.maxWin = saved.maxWin || 0;
                bt.maxLoss = saved.maxLoss || 0;
                bt.grossWinsTotal = saved.grossWinsTotal || 0;
                bt.grossLossesTotal = saved.grossLossesTotal || 0;
                bt.consecutiveWins = saved.consecutiveWins || 0;
                bt.maxConsecutiveWins = saved.maxConsecutiveWins || 0;
                bt.consecutiveLosses = saved.consecutiveLosses || 0;
                bt.maxConsecutiveLosses = saved.maxConsecutiveLosses || 0;
                bt.longTrades = saved.longTrades || 0;
                bt.longWins = saved.longWins || 0;
                bt.longLosses = saved.longLosses || 0;
                bt.shortTrades = saved.shortTrades || 0;
                bt.shortWins = saved.shortWins || 0;
                bt.shortLosses = saved.shortLosses || 0;
                bt.tradeHistory = saved.tradeHistory || [];

                    bt.position = saved.position;
                    bt.entryPrice = saved.entryPrice;
                    bt.entryIdx = saved.entryIdx;
                    bt.stopLoss = saved.stopLoss;
                    bt.takeProfit = saved.takeProfit;
                    bt.alertBuy = saved.alertBuy || false;
                    bt.alertSell = saved.alertSell || false;
                    bt.bbShortPhase = saved.bbShortPhase || 0;
                    bt.bbLongPhase = saved.bbLongPhase || 0;
                    bt.bbDownDuration = saved.bbDownDuration || 0;
                    bt.bbUpDuration = saved.bbUpDuration || 0;
                    bt.markers = saved.markers || [];
                    bt.rsiMarkers = saved.rsiMarkers || [];
                    bt.macdMarkers = saved.macdMarkers || [];
                    btRecalcIndicators();
                    loaded = true;
                    console.log(`🔄 [Backtest] Retomando do localStorage: cursor=${bt.cursor}/${bt.allCandles.length}`);
                }
            } catch (e) {
                console.error('Erro ao carregar backtest salvo do localStorage:', e);
            }
        }
    }

    if (!loaded) {
        btReset();
    }

    if (state.ws) { state.ws.onclose = null; state.ws.onerror = null; state.ws.close(); state.ws = null; }
    state.series.candles.setData([]);
    if (state.series.ma8) state.series.ma8.setData([]);
    if (state.series.ma9) state.series.ma9.setData([]);
    if (state.series.ma96) state.series.ma96.setData([]);
    if (state.series.ma200) state.series.ma200.setData([]);
    if (state.series.rsi) state.series.rsi.setData([]);
    if (state.series.macd) state.series.macd.setData([]);
    if (state.series.signal) state.series.signal.setData([]);
    state.series.candles.setMarkers([]);
    document.getElementById('bt-stats').classList.add('visible');
    setTimeout(() => applyPreset(localStorage.getItem('bot_layout_preset') || 'binance', false), 50);
    document.getElementById('btn-bt-start').style.display = 'none';
    document.getElementById('btn-bt-pause').style.display = 'inline-flex';
    document.getElementById('btn-bt-stop').style.display  = 'inline-flex';
    const resumeLabel = loaded
        ? `↩️ Retomando do candle ${bt.cursor} de ${bt.allCandles.length}...`
        : 'Iniciando simulação do zero...';
    updateBtProgress(resumeLabel);
    updateBtUI();
    bt.running = true; bt.paused = false;

    if (!loaded) {
        const WARMUP = 200;
        bt.cursor = 0;
        for (let i = 0; i < WARMUP && i < bt.allCandles.length; i++) { bt.candles.push(bt.allCandles[i]); bt.cursor++; }
        btRecalcIndicators();
    }

    btRenderAllSeries();
    
    // Desenha as linhas SL/TP se houver posição ativa restaurada
    if (bt.position) {
        btRenderSlTpLines();
    }

    state.charts.main.timeScale().scrollToPosition(5, false);
    backtestSchedule();
}

function backtestPause() {
    if (!bt.running) return;
    if (!bt.paused) {
        bt.paused = true; clearInterval(bt.intervalId); bt.intervalId = null;
        document.getElementById('btn-bt-pause').textContent = '▶ Retomar';
    } else {
        bt.paused = false;
        document.getElementById('btn-bt-pause').textContent = '⏸ Pausar';
        backtestSchedule();
    }
}

function syncBacktestToFirebase(isPartial = false) {
    if (window.FirebaseSync && typeof window.FirebaseSync.saveBacktestResults === 'function' && bt.trades > 0) {
        const netPnl   = bt.balance - bt.initialBalance;
        const grossPnl = bt.grossPnl || netPnl;
        const pnlPct   = (netPnl / bt.initialBalance) * 100;
        const grossPnlPct = (grossPnl / bt.initialBalance) * 100;
        const winRate  = bt.trades > 0 ? (bt.wins / bt.trades) * 100 : 0;
        
        const firstCandle = bt.candles[0] || bt.allCandles[0];
        const lastCandle = bt.candles[bt.candles.length - 1] || bt.allCandles[bt.allCandles.length - 1];

        const formatDateLocal = (timestampSeconds) => {
            if (!timestampSeconds) return '---';
            const d = new Date(timestampSeconds * 1000);
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}/${month}/${year}`;
        };

        const startDate = formatDateLocal(firstCandle?.time);
        const endDate = formatDateLocal(lastCandle?.time);
        const botId = btGetBotId();

        // Cálculos quantitativos avançados
        const avgWin = bt.wins > 0 ? (bt.grossWinsTotal / bt.wins) : 0;
        const avgLoss = bt.losses > 0 ? (bt.grossLossesTotal / bt.losses) : 0;
        const profitFactor = bt.grossLossesTotal > 0 ? (bt.grossWinsTotal / bt.grossLossesTotal) : (bt.grossWinsTotal > 0 ? 99.9 : 0);
        const payoffRatio = avgLoss > 0 ? (avgWin / avgLoss) : (avgWin > 0 ? 99.9 : 0);
        const expectancy = bt.trades > 0 ? ((winRate / 100) * avgWin - ((1 - winRate / 100) * avgLoss)) : 0;

        // Sharpe, Sortino e Calmar estimados
        let sharpeRatio = 0;
        let sortinoRatio = 0;
        let calmarRatio = 0;
        if (bt.tradeHistory && bt.tradeHistory.length > 1) {
            const returns = bt.tradeHistory.map(t => t.roi);
            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
            
            // Sharpe
            const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1);
            const stdDev = Math.sqrt(variance);
            sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(Math.min(bt.trades, 252)) : 0;
            
            // Sortino (apenas downside)
            const negativeReturns = returns.filter(r => r < 0);
            const downsideDeviation = negativeReturns.length > 1 
                ? Math.sqrt(negativeReturns.reduce((sum, val) => sum + Math.pow(val, 2), 0) / returns.length)
                : 0;
            sortinoRatio = downsideDeviation > 0 ? (mean / downsideDeviation) * Math.sqrt(Math.min(bt.trades, 252)) : 0;
            
            // Calmar
            const totalReturnPct = (netPnl / bt.initialBalance) * 100;
            calmarRatio = bt.maxDrawdownPct > 0 ? (totalReturnPct / bt.maxDrawdownPct) : 0;
        }

        const qtyOperated = parseFloat(document.getElementById('bt-qty')?.value) || 0.002;

        // Salva e captura o ID do documento criado/atualizado (para reutilizar na próxima chamada)
        window.FirebaseSync.saveBacktestResults({
            symbol: state.symbol || 'BTCUSDT',
            interval: state.interval || '30m',
            qtyOperated: qtyOperated,
            initialBalance: bt.initialBalance,
            finalBalance: bt.balance,
            // Performance
            pnl: netPnl,
            pnlPct: pnlPct,
            grossPnl: grossPnl,
            grossPnlPct: grossPnlPct,
            profitFactor: profitFactor,
            expectancy: expectancy,
            // Custos
            feesPaid: bt.feesPaid || 0,
            feeMaker: bt.feeRateMaker || 0.0002,
            feeTaker: bt.feeRateTaker || 0.0004,
            // Risco & Drawdown
            maxDrawdown: bt.maxDrawdown || 0,
            maxDrawdownPct: bt.maxDrawdownPct || 0,
            sharpeRatio: Number(sharpeRatio.toFixed(2)),
            sortinoRatio: Number(sortinoRatio.toFixed(2)),
            calmarRatio: Number(calmarRatio.toFixed(2)),
            // Trades
            trades: bt.trades,
            wins: bt.wins,
            losses: bt.losses,
            winRate: winRate,
            maxWin: bt.maxWin || 0,
            maxLoss: bt.maxLoss || 0,
            avgWin: avgWin,
            avgLoss: avgLoss,
            payoffRatio: payoffRatio,
            maxConsecutiveWins: bt.maxConsecutiveWins || 0,
            maxConsecutiveLosses: bt.maxConsecutiveLosses || 0,
            longTrades: bt.longTrades || 0,
            longWins: bt.longWins || 0,
            longLosses: bt.longLosses || 0,
            shortTrades: bt.shortTrades || 0,
            shortWins: bt.shortWins || 0,
            shortLosses: bt.shortLosses || 0,
            isPartial: isPartial,
            startDate: startDate,
            endDate: endDate,
            tradeHistory: bt.tradeHistory || [],
            sameCandlePolicy: 'sl_priority',
            slippagePct: 0,
            // ID da sessão ativa: garante que todos os trades atualizem o mesmo documento
            liveDocId: bt.liveDocId || null
        }, botId).then(docId => {
            if (docId) bt.liveDocId = docId;
        });
    }
}


function backtestStop() {
    clearInterval(bt.intervalId); bt.intervalId = null;

    // Salva estado intermediário no Firebase e localStorage ao parar
    saveBacktestState();
    if (window.FirebaseSync && typeof window.FirebaseSync.saveBacktestState === 'function') {
        const botId = btGetBotId();
        window.FirebaseSync.saveBacktestState(botId, {
            cursor: bt.cursor,
            balance: bt.balance,
            trades: bt.trades,
            wins: bt.wins,
            losses: bt.losses,
            position: bt.position,
            entryPrice: bt.entryPrice,
            entryIdx: bt.entryIdx,
            stopLoss: bt.stopLoss,
            takeProfit: bt.takeProfit,
            alertBuy: bt.alertBuy,
            alertSell: bt.alertSell,
            symbol: state.symbol,
            interval: state.interval,
            bbShortPhase: bt.bbShortPhase || 0,
            bbLongPhase: bt.bbLongPhase || 0,
            bbDownDuration: bt.bbDownDuration || 0,
            bbUpDuration: bt.bbUpDuration || 0
        });
    }

    // Se houve operações, sincroniza resultado — trata como completo para gravar no histórico
    if (bt.trades > 0) {
        syncBacktestToFirebase(false); // false = grava em historico_trader
    }

    bt.running = false; bt.paused = false;
    document.getElementById('btn-bt-start').style.display = 'inline-flex';
    document.getElementById('btn-bt-pause').style.display = 'none';
    document.getElementById('btn-bt-stop').style.display  = 'none';
    const btnReset = document.getElementById('btn-bt-reset');
    if (btnReset) btnReset.style.display = 'inline-flex';
    document.getElementById('btn-bt-pause').textContent = '⏸ Pausar';
    btClearSlTpLines();
    try { state.series.candles.setMarkers([]); } catch(e) {}
    try { state.series.rsi.setMarkers([]); } catch(e) {}
    try { state.series.macd.setMarkers([]); } catch(e) {}
    document.getElementById('bt-stats').classList.remove('visible');
    setTimeout(() => applyPreset(localStorage.getItem('bot_layout_preset') || 'binance', false), 50);
    updateBtProgress('Reconectando ao mercado ao vivo...');
    fetchHistoricalData().then(() => {
        updateBtProgress('Aguardando início...');
        setTimeout(() => state.charts.main.timeScale().fitContent(), 500);
    });
}

function setSpeed(btn) {
    document.querySelectorAll('.btn-speed').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    bt.speed = parseInt(btn.dataset.speed);
    if (bt.running && !bt.paused) { clearInterval(bt.intervalId); bt.intervalId = null; backtestSchedule(); }
}

function backtestSchedule() {
    if (bt.speed === 0) backtestRunInstant();
    else bt.intervalId = setInterval(backtestTick, bt.speed);
}

function backtestRunInstant() {
    updateBtProgress('Processando em modo instantâneo...');
    function runBatch() {
        if (!bt.running || bt.paused || bt.cursor >= bt.allCandles.length) {
            if (bt.cursor >= bt.allCandles.length) backtestFinish();
            return;
        }
        const BATCH = 500;
        const end = Math.min(bt.cursor + BATCH, bt.allCandles.length);
        while (bt.cursor < end) { bt.candles.push(bt.allCandles[bt.cursor]); bt.cursor++; }
        btRecalcIndicators();
        btCheckStrategyAtCurrentCandle();
        btRenderAllSeries();
        updateBtProgress(`Processando... ${Math.round((bt.cursor / bt.allCandles.length) * 100)}%`);
        saveBacktestState();
        setTimeout(runBatch, 0);
    }
    runBatch();
}

function backtestTick() {
    if (bt.cursor >= bt.allCandles.length) {
        clearInterval(bt.intervalId); bt.intervalId = null; backtestFinish(); return;
    }
    bt.candles.push(bt.allCandles[bt.cursor]); bt.cursor++;
    btRecalcIndicators();
    btCheckStrategyAtCurrentCandle();
    btUpdateLastCandle();
    const pct = Math.round((bt.cursor / bt.allCandles.length) * 100);
    document.getElementById('bt-progress-bar').style.width = pct + '%';
    updateBtProgress(`Candle ${bt.cursor} / ${bt.allCandles.length} (${pct}%)`);
    state.charts.main.timeScale().scrollToPosition(5, false);
    saveBacktestState();
}

function backtestFinish() {
    bt.running = false;
    if (bt.position !== null) { const lc = bt.candles[bt.candles.length-1]; btClosePosition(lc.close, lc.time, 'fim'); }
    document.getElementById('bt-progress-bar').style.width = '100%';
    updateBtProgress(`✅ Simulação concluída! ${bt.trades} operações realizadas.`);
    document.getElementById('btn-bt-start').style.display = 'inline-flex';
    document.getElementById('btn-bt-pause').style.display = 'none';
    document.getElementById('btn-bt-stop').style.display  = 'none';
    const btnReset = document.getElementById('btn-bt-reset');
    if (btnReset) btnReset.style.display = 'inline-flex';
    updateBtUI();

    // Limpa estado salvo local ao concluir (backtest completo)
    const stratKey = (typeof botState !== 'undefined' && botState.strategy) || 'rsi_macd';
    localStorage.removeItem(`bt_state_${stratKey}_${state.symbol}_${state.interval}`);

    // Limpa backtestState no Firebase (backtest completo, não é mais parcial)
    const botId = btGetBotId();
    if (window.FirebaseSync && typeof window.FirebaseSync.clearBacktestState === 'function') {
        window.FirebaseSync.clearBacktestState(botId);
    }

    // Sincronizar resultado final com o Firebase Cloud Firestore
    syncBacktestToFirebase(false);
}

function btReset() {
    clearInterval(bt.intervalId); bt.intervalId = null;
    bt.cursor = 0; bt.candles = [];
    bt.ma8=[]; bt.ma9=[]; bt.ma96=[]; bt.ma200=[]; bt.rsi=[]; bt.macd=[]; bt.signal=[];
    bt.bbUpper=[]; bt.bbMiddle=[]; bt.bbLower=[];
    bt.alertBuy=false; bt.alertSell=false; bt.alertBuyIdx=-1; bt.alertSellIdx=-1;
    bt.trendUpDuration=0; bt.trendDownDuration=0; bt.validPullbackBuy=false; bt.validPullbackSell=false;
    bt.bbShortPhase=0; bt.bbLongPhase=0; bt.bbDownDuration=0; bt.bbUpDuration=0;
    bt.position=null; bt.entryPrice=0; bt.entryIdx=0; bt.stopLoss=0; bt.takeProfit=0; bt.entryTime=0;
    bt.balance = bt.initialBalance;
    bt.peakBalance = bt.initialBalance;
    bt.feesPaid = 0;
    bt.grossPnl = 0;
    bt.netPnl = 0;
    bt.maxDrawdown = 0;
    bt.maxDrawdownPct = 0;
    bt.currentDrawdown = 0;
    bt.currentDrawdownPct = 0;
    bt.trades = 0; bt.wins = 0; bt.losses = 0;
    bt.maxWin = 0; bt.maxLoss = 0;
    bt.grossWinsTotal = 0; bt.grossLossesTotal = 0;
    bt.consecutiveWins = 0; bt.maxConsecutiveWins = 0;
    bt.consecutiveLosses = 0; bt.maxConsecutiveLosses = 0;
    bt.longTrades = 0; bt.longWins = 0; bt.longLosses = 0;
    bt.shortTrades = 0; bt.shortWins = 0; bt.shortLosses = 0;
    bt.tradeHistory = [];
    bt.liveDocId = null;  // ID do documento ativo no Firebase para esta sessão de backtest
    bt.markers=[]; bt.rsiMarkers=[]; bt.macdMarkers=[];
    btClearSlTpLines();
    if (state.series.rsi) { try { state.series.rsi.setMarkers([]); } catch(e) {} }
    if (state.series.macd) { try { state.series.macd.setMarkers([]); } catch(e) {} }
}

function btRecalcIndicators() {
    const closes = bt.candles.map(c => c.close);
    const isTrend = (window.PAGE_STRATEGY === 'trend_sma');
    const isBollinger = (window.PAGE_STRATEGY === 'bollinger_bands');

    if (isBollinger) {
        const bb = calculateBollingerBands(closes, 20, 2);
        bt.bbUpper = bb.upper;
        bt.bbMiddle = bb.middle;
        bt.bbLower = bb.lower;
        bt.ma9 = bb.middle;
        bt.ma8 = calculateSMA(closes, 8);
        bt.ma200 = calculateSMA(closes, 200);
        bt.ma96 = []; bt.rsi = []; bt.macd = []; bt.signal = [];
    } else {
        bt.ma8   = isTrend ? calculateSMA(closes, 8) : [];
        bt.ma9   = calculateSMA(closes, isTrend ? 20 : 9);
        bt.ma96  = calculateSMA(closes, isTrend ? 50 : 96);
        bt.ma200 = [];
        bt.rsi   = calculateRSIWilder(closes, 14);
        if (!isTrend) {
            const mc = calculateMACD(closes, 12, 26, 9);
            bt.macd = mc.macdLine; bt.signal = mc.signalLine;
        }
    }
}

function btUpdateLastCandle() {
    const n = bt.candles.length; if (n < 2) return;
    const cur = bt.candles[n-1]; const t = cur.time;
    const isTrend = (window.PAGE_STRATEGY === 'trend_sma');
    const isBollinger = (window.PAGE_STRATEGY === 'bollinger_bands');
    safeUpdateCandle(state.series.candles, cur);

    if (isBollinger) {
        if (state.series.ma9 && bt.bbMiddle && bt.bbMiddle[n-1] !== null) safeUpdateSeries(state.series.ma9, t, bt.bbMiddle[n-1]);
        if (state.series.bbUpper && bt.bbUpper && bt.bbUpper[n-1] !== null) safeUpdateSeries(state.series.bbUpper, t, bt.bbUpper[n-1]);
        if (state.series.bbLower && bt.bbLower && bt.bbLower[n-1] !== null) safeUpdateSeries(state.series.bbLower, t, bt.bbLower[n-1]);
        if (state.series.ma8 && bt.ma8 && bt.ma8[n-1] !== null) safeUpdateSeries(state.series.ma8, t, bt.ma8[n-1]);
        if (state.series.ma200 && bt.ma200 && bt.ma200[n-1] !== null) safeUpdateSeries(state.series.ma200, t, bt.ma200[n-1]);
    } else {
        if (isTrend && state.series.ma8 && bt.ma8 && bt.ma8[n-1] !== null && bt.ma8[n-1] !== undefined) {
            safeUpdateSeries(state.series.ma8, t, bt.ma8[n-1]);
        }
        if (bt.ma9[n-1]    !== null && bt.ma9[n-1]    !== undefined) safeUpdateSeries(state.series.ma9,    t, bt.ma9[n-1]);
        if (bt.ma96[n-1]   !== null && bt.ma96[n-1]   !== undefined) safeUpdateSeries(state.series.ma96,   t, bt.ma96[n-1]);
        if (bt.rsi[n-1]    !== null && bt.rsi[n-1]    !== undefined) safeUpdateSeries(state.series.rsi,    t, bt.rsi[n-1]);
        if (!isTrend && state.series.macd) {
            if (bt.macd[n-1]   !== null) safeUpdateSeries(state.series.macd,   t, bt.macd[n-1]);
            if (bt.signal[n-1] !== null) safeUpdateSeries(state.series.signal, t, bt.signal[n-1]);
        }
    }
    state.series.candles.setMarkers(bt.markers);
    if (state.series.rsi) { try { state.series.rsi.setMarkers(bt.rsiMarkers); } catch(e) {} }
    if (!isTrend && !isBollinger && state.series.macd) { try { state.series.macd.setMarkers(bt.macdMarkers); } catch(e) {} }
}

function btRenderAllSeries() {
    const isTrend = (window.PAGE_STRATEGY === 'trend_sma');
    const isBollinger = (window.PAGE_STRATEGY === 'bollinger_bands');

    if (isBollinger) {
        const bbUpD=[], bbMidD=[], bbLowD=[], ma8D=[], ma200D=[];
        for (let i=0; i<bt.candles.length; i++) {
            const t = bt.candles[i].time;
            if (bt.bbUpper && bt.bbUpper[i] !== null) bbUpD.push({ time:t, value:bt.bbUpper[i] });
            if (bt.bbMiddle && bt.bbMiddle[i] !== null) bbMidD.push({ time:t, value:bt.bbMiddle[i] });
            if (bt.bbLower && bt.bbLower[i] !== null) bbLowD.push({ time:t, value:bt.bbLower[i] });
            if (bt.ma8 && bt.ma8[i] !== null) ma8D.push({ time:t, value:bt.ma8[i] });
            if (bt.ma200 && bt.ma200[i] !== null) ma200D.push({ time:t, value:bt.ma200[i] });
        }
        if (state.series.candles) state.series.candles.setData(bt.candles);
        if (state.series.ma9) state.series.ma9.setData(bbMidD);
        if (state.series.bbUpper) state.series.bbUpper.setData(bbUpD);
        if (state.series.bbLower) state.series.bbLower.setData(bbLowD);
        if (state.series.ma8) state.series.ma8.setData(ma8D);
        if (state.series.ma200) state.series.ma200.setData(ma200D);
    } else {
        const ma8D=[], ma9D=[], ma96D=[], rsiD=[], macdD=[], sigD=[];
        for (let i=0; i<bt.candles.length; i++) {
            const t = bt.candles[i].time;
            if (isTrend && bt.ma8 && bt.ma8[i] !== null) ma8D.push({ time:t, value:bt.ma8[i] });
            if (bt.ma9 && bt.ma9[i]    !== null) ma9D.push({ time:t, value:bt.ma9[i] });
            if (bt.ma96 && bt.ma96[i]   !== null) ma96D.push({ time:t, value:bt.ma96[i] });
            if (bt.rsi && bt.rsi[i]    !== null) rsiD.push({ time:t, value:bt.rsi[i] });
            if (!isTrend && bt.macd && bt.macd[i]   !== null) macdD.push({ time:t, value:bt.macd[i] });
            if (!isTrend && bt.signal && bt.signal[i] !== null) sigD.push({ time:t, value:bt.signal[i] });
        }
        if (state.series.candles) state.series.candles.setData(bt.candles);
        if (isTrend && state.series.ma8) state.series.ma8.setData(ma8D);
        if (state.series.ma9) state.series.ma9.setData(ma9D);
        if (state.series.ma96) state.series.ma96.setData(ma96D);
        if (state.series.rsi) state.series.rsi.setData(rsiD);
        if (!isTrend && state.series.macd) {
            state.series.macd.setData(macdD);
            if (state.series.signal) state.series.signal.setData(sigD);
        }
    }
    if (state.series.candles) state.series.candles.setMarkers(bt.markers);
    if (state.series.rsi) { try { state.series.rsi.setMarkers(bt.rsiMarkers); } catch(e) {} }
    if (!isTrend && !isBollinger && state.series.macd) {
        try { state.series.macd.setMarkers(bt.macdMarkers); } catch(e) {}
    }
}

function btCheckStrategyAtCurrentCandle() {
    const n = bt.candles.length; if (n < 3) return;
    const curIdx=n-1, prevIdx=n-2;
    const curCandle=bt.candles[curIdx], prevCandle=bt.candles[prevIdx];

    if (bt.position !== null) {
        if (bt.position==='long') {
            if (curCandle.low  <= bt.stopLoss)  { btClosePosition(bt.stopLoss,   curCandle.time, 'sl'); return; }
            if (curCandle.high >= bt.takeProfit) { btClosePosition(bt.takeProfit, curCandle.time, 'tp'); return; }
        } else {
            if (curCandle.high >= bt.stopLoss)  { btClosePosition(bt.stopLoss,   curCandle.time, 'sl'); return; }
            if (curCandle.low  <= bt.takeProfit) { btClosePosition(bt.takeProfit, curCandle.time, 'tp'); return; }
        }
    }

    const isTrendStrategy = (window.PAGE_STRATEGY === 'trend_sma');
    const isBollingerStrategy = (window.PAGE_STRATEGY === 'bollinger_bands');

    if (isBollingerStrategy) {
        const sma8Cur    = bt.ma8[curIdx];
        const sma20Cur   = bt.ma9[curIdx];   // ma9 = bbMiddle = SMA 20
        const sma8Prev   = bt.ma8[prevIdx];
        const sma20Prev  = bt.ma9[prevIdx];
        const sma200Cur  = bt.ma200[curIdx];
        const bbUpperCur = bt.bbUpper[curIdx];
        const bbLowerCur = bt.bbLower[curIdx];

        if (!sma8Cur || !sma20Cur || !sma200Cur || !bbUpperCur || !bbLowerCur) return;
        if (sma8Prev === null || sma8Prev === undefined) return;
        if (sma20Prev === null || sma20Prev === undefined) return;

        // ─── Mínimo de candles para 2h de tendência, por timeframe ─────────
        const tfMap2 = { '1m':120, '3m':40, '5m':24, '15m':8, '30m':4, '1h':2, '4h':1, '1d':1, '1w':1 };
        const minDuration = tfMap2[state.interval] || 8;

        // ==========================================
        // 📉 STRATEGY: SHORT (VENDA)
        // ==========================================

        // FASE 0: acumulando tendência de baixa
        if ((bt.bbShortPhase || 0) === 0) {
            // MAs alinhadas para baixa + preço abaixo da MA20
            const isDownTrend = sma8Cur < sma20Cur
                             && sma20Cur < sma200Cur
                             && curCandle.close < sma20Cur;

            if (isDownTrend) {
                bt.bbDownDuration = (bt.bbDownDuration || 0) + 1;
            } else {
                bt.bbDownDuration = 0;
            }

            if (bt.bbDownDuration === minDuration) {
                bt.bbShortPhase = 1;
                bt.markers.push({
                    time: curCandle.time,
                    position: 'aboveBar',
                    color: '#f0b90b',
                    shape: 'arrowDown',
                    text: '🟡 S1 Short',
                    size: 2
                });
            }

        // FASE 1: aguardando repique na banda superior
        } else if ((bt.bbShortPhase || 0) === 1) {
            if (curCandle.close > sma200Cur) {
                bt.bbShortPhase = 0;
                bt.bbDownDuration = 0;
            } else {
                // Checa se tocou a banda superior nos últimos 3 candles
                let touchedUpperRecent = false;
                for (let j = 0; j < 3; j++) {
                    const idx = curIdx - j;
                    if (idx >= 0 && bt.candles[idx] && bt.bbUpper[idx] !== null) {
                        if (bt.candles[idx].high >= bt.bbUpper[idx]) {
                            touchedUpperRecent = true;
                            break;
                        }
                    }
                }

                const priceAboveMa20 = curCandle.close > sma20Cur;
                const ma8AboveMa20   = sma8Cur > sma20Cur;
                const belowMa200     = curCandle.close < sma200Cur;

                if (priceAboveMa20 && ma8AboveMa20 && touchedUpperRecent && belowMa200) {
                    bt.bbShortPhase = 2;
                    bt.markers.push({
                        time: curCandle.time,
                        position: 'aboveBar',
                        color: '#ff7700',
                        shape: 'arrowDown',
                        text: '🟠 S2 Short',
                        size: 2
                    });
                }
            }

        // FASE 2: aguardando fechamento abaixo da MA20 para SHORT
        } else if ((bt.bbShortPhase || 0) === 2) {
            if (curCandle.close > sma200Cur) {
                bt.bbShortPhase = 0;
                bt.bbDownDuration = 0;
            } else {
                const priceBelowMa20 = curCandle.close < sma20Cur;
                const ma8BelowMa20   = sma8Cur < sma20Cur;

                if (priceBelowMa20 && ma8BelowMa20) {
                    bt.bbShortPhase = 0;
                    bt.bbDownDuration = 0;
                    bt.markers.push({
                        time: curCandle.time,
                        position: 'aboveBar',
                        color: '#f6465d',
                        shape: 'arrowDown',
                        text: '🔴 VENDA',
                        size: 2
                    });
                    if (bt.position === 'long') btClosePosition(curCandle.open, curCandle.time, 'flip');
                    bt.lastEntrySignal = 'Bollinger_Fase3_Fechamento_Abaixo_MA20_SHORT';
                    if (bt.position !== 'short') btOpenPosition('short', curIdx, curCandle);
                }
            }
        }

        // ==========================================
        // 📈 STRATEGY: LONG (COMPRA)
        // ==========================================

        // FASE 0: acumulando tendência de alta
        if ((bt.bbLongPhase || 0) === 0) {
            // MAs alinhadas para alta + preço acima da MA20
            const isUpTrend = sma8Cur > sma20Cur
                           && sma20Cur > sma200Cur
                           && curCandle.close > sma20Cur;

            if (isUpTrend) {
                bt.bbUpDuration = (bt.bbUpDuration || 0) + 1;
            } else {
                bt.bbUpDuration = 0;
            }

            if (bt.bbUpDuration === minDuration) {
                bt.bbLongPhase = 1;
                bt.markers.push({
                    time: curCandle.time,
                    position: 'belowBar',
                    color: '#f0b90b',
                    shape: 'arrowUp',
                    text: '🟡 S1 Long',
                    size: 2
                });
            }

        // FASE 1: aguardando repique na banda inferior
        } else if ((bt.bbLongPhase || 0) === 1) {
            if (curCandle.close < sma200Cur) {
                bt.bbLongPhase = 0;
                bt.bbUpDuration = 0;
            } else {
                // Checa se tocou a banda inferior nos últimos 3 candles
                let touchedLowerRecent = false;
                for (let j = 0; j < 3; j++) {
                    const idx = curIdx - j;
                    if (idx >= 0 && bt.candles[idx] && bt.bbLower[idx] !== null) {
                        if (bt.candles[idx].low <= bt.bbLower[idx]) {
                            touchedLowerRecent = true;
                            break;
                        }
                    }
                }

                const priceBelowMa20 = curCandle.close < sma20Cur;
                const ma8BelowMa20   = sma8Cur < sma20Cur;
                const aboveMa200     = curCandle.close > sma200Cur;

                if (priceBelowMa20 && ma8BelowMa20 && touchedLowerRecent && aboveMa200) {
                    bt.bbLongPhase = 2;
                    bt.markers.push({
                        time: curCandle.time,
                        position: 'belowBar',
                        color: '#ff7700',
                        shape: 'arrowUp',
                        text: '🟠 S2 Long',
                        size: 2
                    });
                }
            }

        // FASE 2: aguardando fechamento acima da MA20 para LONG
        } else if ((bt.bbLongPhase || 0) === 2) {
            if (curCandle.close < sma200Cur) {
                bt.bbLongPhase = 0;
                bt.bbUpDuration = 0;
            } else {
                const priceAboveMa20 = curCandle.close > sma20Cur;
                const ma8AboveMa20   = sma8Cur > sma20Cur;

                if (priceAboveMa20 && ma8AboveMa20) {
                    bt.bbLongPhase = 0;
                    bt.bbUpDuration = 0;
                    bt.markers.push({
                        time: curCandle.time,
                        position: 'belowBar',
                        color: '#0ecb81',
                        shape: 'arrowUp',
                        text: '🟢 COMPRA',
                        size: 2
                    });
                    if (bt.position === 'short') btClosePosition(curCandle.open, curCandle.time, 'flip');
                    bt.lastEntrySignal = 'Bollinger_Fase3_Fechamento_Acima_MA20_LONG';
                    if (bt.position !== 'long') btOpenPosition('long', curIdx, curCandle);
                }
            }
        }
    } else if (isTrendStrategy) {
        const sma8Prev  = bt.ma8[prevIdx],  sma8Cur  = bt.ma8[curIdx];
        const sma20Prev = bt.ma9[prevIdx],  sma20Cur = bt.ma9[curIdx];
        const sma50Prev = bt.ma96[prevIdx], sma50Cur = bt.ma96[curIdx];
        const rsiCur    = bt.rsi[curIdx];

        if (sma8Prev === null || sma8Cur === null || sma20Prev === null || sma20Cur === null || sma50Prev === null || sma50Cur === null || rsiCur === null) return;

        // ═══════════════════════════════════════════════════════════════
        // LÓGICA ORION: Tendência Prévia (>= 3h) + Pullback + Retomada
        //
        // 1. TENDÊNCIA EM ANDAMENTO: Preço > SMA 8 > SMA 20 > SMA 50 por >= 3h
        // 2. PULLBACK: Preço e SMA 8 caem abaixo da SMA 20, mas ACIMA da SMA 50
        // 3. RETOMADA: Preço e SMA 8 fecham acima da SMA 20 (+ RSI >= 50) => COMPRA
        // ═══════════════════════════════════════════════════════════════

        const intervalMap = {
            '1m': 180,
            '3m': 60,
            '5m': 36,
            '15m': 12,
            '30m': 6,
            '1h': 3,
            '2h': 2,
            '4h': 3,
            '1d': 3
        };
        const minTrendCandles = intervalMap[state.interval] || 6;

        // 1. Tendência em andamento (Médias alinhadas e preço sustentado)
        const isTrendUp   = (sma8Prev > sma20Prev && sma20Prev > sma50Prev && prevCandle.close > sma20Prev);
        const isTrendDown = (sma8Prev < sma20Prev && sma20Prev < sma50Prev && prevCandle.close < sma20Prev);

        if (isTrendUp) {
            bt.trendUpDuration = (bt.trendUpDuration || 0) + 1;
        } else if (sma8Prev < sma20Prev && sma8Prev > sma50Prev && sma20Prev > sma50Prev) {
            // 2. Pullback válido (após ter tendência prévia estabelecida por >= 3h)
            if ((bt.trendUpDuration || 0) >= minTrendCandles) {
                bt.validPullbackBuy = true;
            }
        } else if (sma8Prev < sma50Prev || sma20Prev < sma50Prev) {
            bt.trendUpDuration = 0;
            bt.validPullbackBuy = false;
        }

        if (isTrendDown) {
            bt.trendDownDuration = (bt.trendDownDuration || 0) + 1;
        } else if (sma8Prev > sma20Prev && sma8Prev < sma50Prev && sma20Prev < sma50Prev) {
            // 2. Pullback de venda válido
            if ((bt.trendDownDuration || 0) >= minTrendCandles) {
                bt.validPullbackSell = true;
            }
        } else if (sma8Prev > sma50Prev || sma20Prev > sma50Prev) {
            bt.trendDownDuration = 0;
            bt.validPullbackSell = false;
        }

        // 3. Gatilho de Retomada: Preço e SMA 8 fecham acima da SMA 20
        const buySignal  = bt.validPullbackBuy  && (sma8Cur > sma20Cur) && (curCandle.close > sma20Cur) && (sma20Cur > sma50Cur) && (rsiCur >= 50);
        const sellSignal = bt.validPullbackSell && (sma8Cur < sma20Cur) && (curCandle.close < sma20Cur) && (sma20Cur < sma50Cur) && (rsiCur <= 50);

        if (buySignal) {
            bt.validPullbackBuy = false;
            bt.trendUpDuration = 0;
            if (bt.position === 'long') return;
            if (bt.position === 'short') btClosePosition(curCandle.open, curCandle.time, 'flip');
            bt.lastEntrySignal = 'Tendencia_Alta+Pullback+Retomada_SMA20';
            btOpenPosition('long', curIdx, curCandle);
        } else if (sellSignal) {
            bt.validPullbackSell = false;
            bt.trendDownDuration = 0;
            if (bt.position === 'short') return;
            if (bt.position === 'long') btClosePosition(curCandle.open, curCandle.time, 'flip');
            bt.lastEntrySignal = 'Tendencia_Baixa+Pullback+Retomada_SMA20';
            btOpenPosition('short', curIdx, curCandle);
        }

    } else {
        // ZENITH (RSI + MACD)
        const rsiPrev=bt.rsi[prevIdx], macdPrev=bt.macd[prevIdx], sigPrev=bt.signal[prevIdx];
        const macdCur=bt.macd[curIdx], sigCur=bt.signal[curIdx];
        if (rsiPrev===null||macdPrev===null||sigPrev===null||macdCur===null||sigCur===null) return;

        if (rsiPrev < 30 && !bt.alertBuy)  { bt.alertBuy=true; bt.alertSell=false; bt.rsiMarkers.push({time:prevCandle.time,position:'belowBar',color:'#0ecb81',shape:'arrowUp',text:'RSI < 30',size:1}); }
        if (rsiPrev > 70 && !bt.alertSell) { bt.alertSell=true; bt.alertBuy=false; bt.rsiMarkers.push({time:prevCandle.time,position:'aboveBar',color:'#f6465d',shape:'arrowDown',text:'RSI > 70',size:1}); }

        const crossUp   = (macdPrev <= sigPrev) && (macdCur > sigCur);
        const crossDown = (macdPrev >= sigPrev) && (macdCur < sigCur);

        if (bt.alertBuy && crossUp) {
            if (bt.position==='long') { bt.alertBuy=false; }
            else {
                if (bt.position==='short') btClosePosition(curCandle.open, curCandle.time, 'flip');
                bt.lastEntrySignal = 'RSI<30+MACD_crossUp';
                btOpenPosition('long', curIdx, curCandle);
                bt.alertBuy=false; bt.alertSell=false;
                bt.macdMarkers.push({time:curCandle.time,position:'belowBar',color:'#0ecb81',shape:'arrowUp',text:'MACD ▲ Entrada',size:1});
            }
        } else if (bt.alertSell && crossDown) {
            if (bt.position==='short') { bt.alertSell=false; }
            else {
                if (bt.position==='long') btClosePosition(curCandle.open, curCandle.time, 'flip');
                bt.lastEntrySignal = 'RSI>70+MACD_crossDown';
                btOpenPosition('short', curIdx, curCandle);
                bt.alertSell=false; bt.alertBuy=false;
                bt.macdMarkers.push({time:curCandle.time,position:'aboveBar',color:'#f6465d',shape:'arrowDown',text:'MACD ▼ Entrada',size:1});
            }
        }
    }
}

function btOpenPosition(type, idx, candle) {
    bt.position   = type;
    bt.entryPrice = candle.open;
    bt.entryIdx   = idx;
    bt.entryTime  = candle.time; // Fase 1: timestamp de entrada (segundos Unix)
    const calc    = calculateSlTpByMa9(type, bt.entryPrice, bt.candles, bt.ma9, idx);
    bt.stopLoss   = calc.sl;
    bt.takeProfit = calc.tp;
    const qty = parseFloat(document.getElementById('bt-qty').value) || 0.002;

    // Taxa de entrada (Taker 0.04% ordem a mercado)
    const entryFee = qty * bt.entryPrice * (bt.feeRateTaker || 0.0004);
    bt.currentEntryFee = entryFee;
    bt.feesPaid = (bt.feesPaid || 0) + entryFee;
    bt.balance -= entryFee; // Deduz taxa no saldo

    bt.markers.push({
        time: candle.time, position: type==='long'?'belowBar':'aboveBar',
        color: type==='long'?'#0ecb81':'#f6465d', shape: type==='long'?'arrowUp':'arrowDown',
        text: type==='long'?`▲ COMPRA ${qty} BTC @ $${bt.entryPrice.toFixed(0)} (Taxa: -$${entryFee.toFixed(3)})`:`▼ VENDA ${qty} BTC @ $${bt.entryPrice.toFixed(0)} (Taxa: -$${entryFee.toFixed(3)})`,
        size: 1
    });
    btClearSlTpLines();
    bt.entryPriceLine = state.series.candles.createPriceLine({price:bt.entryPrice,color:'#ffffff',lineWidth:1,lineStyle:LightweightCharts.LineStyle.Dashed,axisLabelVisible:true,title:'Entrada'});
    bt.slPriceLine    = state.series.candles.createPriceLine({price:bt.stopLoss,color:'#f6465d',lineWidth:1,lineStyle:LightweightCharts.LineStyle.Dashed,axisLabelVisible:true,title:'SL'});
    bt.tpPriceLine    = state.series.candles.createPriceLine({price:bt.takeProfit,color:'#0ecb81',lineWidth:1,lineStyle:LightweightCharts.LineStyle.Dashed,axisLabelVisible:true,title:'TP'});
    updateBtUI();
    saveBacktestState();
}

function btClosePosition(exitPrice, exitTime, reason) {
    if (bt.position === null) return;
    const qty = parseFloat(document.getElementById('bt-qty').value) || 0.002;
    
    // P&L Bruto (sem taxas)
    let grossProfit;
    if (bt.position === 'long') {
        grossProfit = qty * (exitPrice - bt.entryPrice);
    } else {
        grossProfit = qty * (bt.entryPrice - exitPrice);
    }

    // Taxa de saída (Maker 0.02% para TP com ordem limite, Taker 0.04% para Stop Loss ou flip a mercado)
    const feeRateExit = (reason === 'tp') ? (bt.feeRateMaker || 0.0002) : (bt.feeRateTaker || 0.0004);
    const exitFee = qty * exitPrice * feeRateExit;
    const totalTradeFees = (bt.currentEntryFee || 0) + exitFee;
    bt.feesPaid = (bt.feesPaid || 0) + exitFee;

    // P&L Líquido (descontando saída; a taxa de entrada já foi deduzida em btOpenPosition)
    const netTradePnl = grossProfit - totalTradeFees;
    bt.balance += grossProfit - exitFee;
    bt.grossPnl = (bt.grossPnl || 0) + grossProfit;
    bt.netPnl = bt.balance - bt.initialBalance;

    bt.trades++;
    const isWin = netTradePnl > 0;

    // Rastreamento por lado (Long vs Short)
    if (bt.position === 'long') {
        bt.longTrades = (bt.longTrades || 0) + 1;
        if (isWin) bt.longWins = (bt.longWins || 0) + 1;
        else bt.longLosses = (bt.longLosses || 0) + 1;
    } else {
        bt.shortTrades = (bt.shortTrades || 0) + 1;
        if (isWin) bt.shortWins = (bt.shortWins || 0) + 1;
        else bt.shortLosses = (bt.shortLosses || 0) + 1;
    }

    // Streaks e vitórias/derrotas
    if (isWin) {
        bt.wins++;
        bt.grossWinsTotal = (bt.grossWinsTotal || 0) + netTradePnl;
        bt.maxWin = Math.max(bt.maxWin || 0, netTradePnl);
        bt.consecutiveWins = (bt.consecutiveWins || 0) + 1;
        bt.maxConsecutiveWins = Math.max(bt.maxConsecutiveWins || 0, bt.consecutiveWins);
        bt.consecutiveLosses = 0;
    } else {
        bt.losses++;
        bt.grossLossesTotal = (bt.grossLossesTotal || 0) + Math.abs(netTradePnl);
        bt.maxLoss = Math.min(bt.maxLoss || 0, netTradePnl);
        bt.consecutiveLosses = (bt.consecutiveLosses || 0) + 1;
        bt.maxConsecutiveLosses = Math.max(bt.maxConsecutiveLosses || 0, bt.consecutiveLosses);
        bt.consecutiveWins = 0;
    }

    // Rastreamento de Max Drawdown Pico-a-Vale
    if (bt.balance > (bt.peakBalance || bt.initialBalance)) {
        bt.peakBalance = bt.balance;
    }
    const curDD = Math.max(0, (bt.peakBalance || bt.initialBalance) - bt.balance);
    const curDDPct = (bt.peakBalance > 0) ? (curDD / bt.peakBalance) * 100 : 0;
    bt.currentDrawdown = curDD;
    bt.currentDrawdownPct = curDDPct;
    bt.maxDrawdown = Math.max(bt.maxDrawdown || 0, curDD);
    bt.maxDrawdownPct = Math.max(bt.maxDrawdownPct || 0, curDDPct);

    // Registro do trade no histórico (Fase 1: campos expandidos)
    if (!bt.tradeHistory) bt.tradeHistory = [];
    const initialRisk = Math.abs(bt.entryPrice - bt.stopLoss) * qty;
    const rMultiple   = initialRisk > 0 ? +(netTradePnl / initialRisk).toFixed(4) : null;
    const tradeDuration = (bt.entryTime > 0) ? (exitTime - bt.entryTime) : null; // segundos
    const tradeRoi    = +((netTradePnl / (bt.entryPrice * qty)) * 100).toFixed(4);
    bt.tradeHistory.push({
        id:           bt.tradeHistory.length + 1,
        symbol:       state.symbol || 'BTCUSDT',
        type:         bt.position,
        entryTime:    bt.entryTime,
        exitTime:     exitTime,
        entryPrice:   bt.entryPrice,
        exitPrice:    exitPrice,
        stopLoss:     bt.stopLoss,
        takeProfit:   bt.takeProfit,
        quantity:     qty,
        leverage:     1,
        grossProfit:  +grossProfit.toFixed(4),
        fees:         +totalTradeFees.toFixed(4),
        slippageCost: 0,    // implementação futura — atualmente zero
        netProfit:    +netTradePnl.toFixed(4),
        roi:          tradeRoi,
        rMultiple:    rMultiple,
        duration:     tradeDuration,
        reason:       reason,
        entrySignal:  bt.lastEntrySignal || null,
        // Metadados da política de execução (para auditoria)
        sameCandlePolicy: 'sl_priority'
    });

    const pnlPct = ((exitPrice - bt.entryPrice) / bt.entryPrice) * 100 * (bt.position === 'long' ? 1 : -1);
    const txt = `${isWin ? '✓' : '✗'} ${reason.toUpperCase()} ${netTradePnl >= 0 ? '+' : ''}$${netTradePnl.toFixed(2)} (Taxas: $${totalTradeFees.toFixed(2)})`;
    bt.markers.push({
        time: exitTime,
        position: bt.position === 'long' ? 'aboveBar' : 'belowBar',
        color: isWin ? '#0ecb81' : '#f6465d',
        shape: 'circle',
        text: txt,
        size: 0.6
    });

    bt.position = null;
    bt.entryPrice = 0;
    bt.stopLoss = 0;
    bt.takeProfit = 0;
    bt.currentEntryFee = 0;
    btClearSlTpLines();
    updateBtUI();

    // Salva cada trade imediatamente no Firebase (atualiza o mesmo documento da sessão)
    syncBacktestToFirebase(true);

    saveBacktestState();
}

function updateBtUI() {
    const totalPnl = bt.balance - bt.initialBalance;
    const pct      = (totalPnl / bt.initialBalance) * 100;
    const isProfit = bt.balance >= bt.initialBalance;
    const wr       = bt.trades > 0 ? ((bt.wins / bt.trades) * 100).toFixed(1) : '---';
    const sign     = totalPnl >= 0 ? '+' : '';
    setEl('bt-balance', '$' + bt.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const balEl = document.getElementById('bt-balance');
    if (balEl) balEl.style.color = isProfit ? 'var(--color-green)' : 'var(--color-red)';
    const pnlEl = document.getElementById('bt-pnl');
    if (pnlEl) {
        const feesText = bt.feesPaid > 0 ? ` | Taxas: -$${bt.feesPaid.toFixed(2)}` : '';
        pnlEl.innerHTML = `P&L Líq: <strong style="color:${isProfit?'var(--color-green)':'var(--color-red)'}">${sign}$${totalPnl.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} (${sign}${pct.toFixed(2)}%)</strong><span style="font-size:10px;color:var(--text-muted);">${feesText}</span>`;
    }
    const posEl = document.getElementById('bt-position');
    if (posEl) {
        if (bt.position === 'long')       { posEl.className = 'bt-badge long';  posEl.textContent = '📈 COMPRADO'; }
        else if (bt.position === 'short') { posEl.className = 'bt-badge short'; posEl.textContent = '📉 VENDIDO'; }
        else                              { posEl.className = 'bt-badge flat';  posEl.textContent = 'FORA'; }
    }
    setEl('bt-entry-price', bt.entryPrice > 0 ? `Entrada: $${bt.entryPrice.toFixed(2)}` : 'Entrada: ---');
    setEl('bt-sl-tp',       bt.stopLoss > 0   ? `SL: $${bt.stopLoss.toFixed(0)} | TP: $${bt.takeProfit.toFixed(0)}` : 'SL: --- | TP: ---');
    const risk = bt.stopLoss > 0 ? Math.abs(bt.entryPrice - bt.stopLoss).toFixed(0) : '---';
    setEl('bt-risk-label', `Risco: $${risk} | MaxDD: -${(bt.maxDrawdownPct || 0).toFixed(1)}%`);
    setEl('bt-trades', bt.trades);
    setEl('bt-winrate', `Win Rate: ${typeof wr === 'string' ? wr : wr + '%'}`);
    const winsEl = document.getElementById('bt-wins');
    if (winsEl) winsEl.innerHTML = `&#9989; ${bt.wins} &nbsp;&#10060; ${bt.losses}`;
}

function updateBtProgress(text) { setEl('bt-progress-label', text); }

// Contador para sincronização periódica com o Firebase (a cada N candles)
let _btFirebaseSyncCounter = 0;
const BT_FIREBASE_SYNC_INTERVAL = 100; // salva no Firebase a cada 100 candles

function saveBacktestState() {
    if (!state.symbol || !state.interval) return;
    const stratKey = (typeof botState !== 'undefined' && botState.strategy) || 'rsi_macd';

    // Salva estado leve no localStorage (sem bt.candles para economizar espaço)
    const dataToSave = {
        symbol: state.symbol,
        interval: state.interval,
        cursor: bt.cursor,
        balance: bt.balance,
        feesPaid: bt.feesPaid || 0,
        maxDrawdown: bt.maxDrawdown || 0,
        maxDrawdownPct: bt.maxDrawdownPct || 0,
        trades: bt.trades,
        wins: bt.wins,
        losses: bt.losses,
        grossPnl: bt.grossPnl || 0,
        netPnl: bt.netPnl || 0,
        peakBalance: bt.peakBalance || bt.initialBalance || 10000,
        maxWin: bt.maxWin || 0,
        maxLoss: bt.maxLoss || 0,
        grossWinsTotal: bt.grossWinsTotal || 0,
        grossLossesTotal: bt.grossLossesTotal || 0,
        consecutiveWins: bt.consecutiveWins || 0,
        maxConsecutiveWins: bt.maxConsecutiveWins || 0,
        consecutiveLosses: bt.consecutiveLosses || 0,
        maxConsecutiveLosses: bt.maxConsecutiveLosses || 0,
        longTrades: bt.longTrades || 0,
        longWins: bt.longWins || 0,
        longLosses: bt.longLosses || 0,
        shortTrades: bt.shortTrades || 0,
        shortWins: bt.shortWins || 0,
        shortLosses: bt.shortLosses || 0,
        tradeHistory: bt.tradeHistory || [],

        position: bt.position,
        entryPrice: bt.entryPrice,
        entryIdx: bt.entryIdx,
        stopLoss: bt.stopLoss,
        takeProfit: bt.takeProfit,
        alertBuy: bt.alertBuy || false,
        alertSell: bt.alertSell || false,
        bbShortPhase: bt.bbShortPhase || 0,
        bbLongPhase: bt.bbLongPhase || 0,
        bbDownDuration: bt.bbDownDuration || 0,
        bbUpDuration: bt.bbUpDuration || 0
    };
    try {
        localStorage.setItem(`bt_state_${stratKey}_${state.symbol}_${state.interval}`, JSON.stringify(dataToSave));
    } catch(e) { /* localStorage cheio — ignora */ }

    // Salva no Firebase a cada N candles (assíncrono, não bloqueia a simulação)
    _btFirebaseSyncCounter++;
    if (_btFirebaseSyncCounter >= BT_FIREBASE_SYNC_INTERVAL) {
        _btFirebaseSyncCounter = 0;
        if (window.FirebaseSync && typeof window.FirebaseSync.saveBacktestState === 'function') {
            const botId = btGetBotId();
            window.FirebaseSync.saveBacktestState(botId, {
                cursor: bt.cursor,
                balance: bt.balance,
                feesPaid: bt.feesPaid || 0,
                maxDrawdown: bt.maxDrawdown || 0,
                maxDrawdownPct: bt.maxDrawdownPct || 0,
                trades: bt.trades,
                wins: bt.wins,
                losses: bt.losses,
        grossPnl: bt.grossPnl || 0,
        netPnl: bt.netPnl || 0,
        peakBalance: bt.peakBalance || bt.initialBalance || 10000,
        maxWin: bt.maxWin || 0,
        maxLoss: bt.maxLoss || 0,
        grossWinsTotal: bt.grossWinsTotal || 0,
        grossLossesTotal: bt.grossLossesTotal || 0,
        consecutiveWins: bt.consecutiveWins || 0,
        maxConsecutiveWins: bt.maxConsecutiveWins || 0,
        consecutiveLosses: bt.consecutiveLosses || 0,
        maxConsecutiveLosses: bt.maxConsecutiveLosses || 0,
        longTrades: bt.longTrades || 0,
        longWins: bt.longWins || 0,
        longLosses: bt.longLosses || 0,
        shortTrades: bt.shortTrades || 0,
        shortWins: bt.shortWins || 0,
        shortLosses: bt.shortLosses || 0,
        tradeHistory: bt.tradeHistory || [],

                position: bt.position,
                entryPrice: bt.entryPrice,
                entryIdx: bt.entryIdx,
                stopLoss: bt.stopLoss,
                takeProfit: bt.takeProfit,
                alertBuy: bt.alertBuy || false,
                alertSell: bt.alertSell || false,
                symbol: state.symbol,
                interval: state.interval
            });
        }
    }
}

/**
 * Retorna o botId correto baseado na estratégia da página
 */
function btGetBotId() {
    if (typeof window.PAGE_STRATEGY !== 'undefined') {
        if (window.PAGE_STRATEGY === 'trend_sma') return 'bot_2_tendencias_medias';
        if (window.PAGE_STRATEGY === 'bollinger_bands') return 'bot_3_bollinger';
    }
    if (typeof botState !== 'undefined') {
        if (botState.strategy === 'trend_sma') return 'bot_2_tendencias_medias';
        if (botState.strategy === 'bollinger_bands') return 'bot_3_bollinger';
    }
    return 'bot_1_rsi_macd';
}

/**
 * Reinicia o backtest completamente do zero:
 * 1. Limpa o backtestState no Firebase
 * 2. Limpa o localStorage
 * 3. Para qualquer simulação em andamento
 * 4. Reposiciona cursor no candle 0
 */
async function backtestReset() {
    if (bt.running) {
        clearInterval(bt.intervalId);
        bt.intervalId = null;
        bt.running = false;
        bt.paused = false;
    }

    updateBtProgress('🔄 Reiniciando backtest do zero...');

    const botId = btGetBotId();

    // 1. Limpa estado intermediário (cursor/posição) no Firebase
    if (window.FirebaseSync && typeof window.FirebaseSync.clearBacktestState === 'function') {
        await window.FirebaseSync.clearBacktestState(botId);
    }

    // 2. Zera também os dados de backtest exibidos no painel (resultados finais)
    if (window.FirebaseSync && typeof window.FirebaseSync.saveBacktestResults === 'function') {
        await window.FirebaseSync.saveBacktestResults({
            symbol: state.symbol || 'BTCUSDT',
            interval: state.interval || '30m',
            initialBalance: 10000, finalBalance: 10000,
            pnl: 0, pnlPct: 0, grossPnl: 0, grossPnlPct: 0,
            profitFactor: 0, expectancy: 0,
            feesPaid: 0, maxDrawdown: 0, maxDrawdownPct: 0, sharpeRatio: 0,
            trades: 0, wins: 0, losses: 0, winRate: 0,
            maxWin: 0, maxLoss: 0, avgWin: 0, avgLoss: 0,
            payoffRatio: 0, maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
            longTrades: 0, longWins: 0, longLosses: 0,
            shortTrades: 0, shortWins: 0, shortLosses: 0,
            isPartial: true, startDate: '---', endDate: '---'
        }, botId);
    }

    // 3. Limpa localStorage
    const stratKey = (typeof botState !== 'undefined' && botState.strategy) || 'rsi_macd';
    localStorage.removeItem(`bt_state_${stratKey}_${state.symbol}_${state.interval}`);
    _btFirebaseSyncCounter = 0;

    // 4. Reseta estado local
    btReset();

    // 5. Atualiza botões
    document.getElementById('btn-bt-start').style.display = 'inline-flex';
    document.getElementById('btn-bt-pause').style.display = 'none';
    document.getElementById('btn-bt-stop').style.display  = 'none';
    const btnReset = document.getElementById('btn-bt-reset');
    if (btnReset) btnReset.style.display = 'none';
    document.getElementById('bt-stats').classList.remove('visible');

    updateBtProgress('✅ Backtest reiniciado. Clique em Iniciar para começar do zero.');
    updateBtUI();

    console.log(`🔄 [Backtest] Reiniciado do zero para ${botId} (${state.symbol} ${state.interval}).`);
}

function btRenderSlTpLines() {
    btClearSlTpLines();
    if (bt.position && state.series.candles) {
        bt.entryPriceLine = state.series.candles.createPriceLine({price:bt.entryPrice,color:'#ffffff',lineWidth:1,lineStyle:LightweightCharts.LineStyle.Dashed,axisLabelVisible:true,title:'Entrada'});
        if (bt.stopLoss > 0) bt.slPriceLine = state.series.candles.createPriceLine({price:bt.stopLoss,color:'#f6465d',lineWidth:1,lineStyle:LightweightCharts.LineStyle.Dashed,axisLabelVisible:true,title:'SL'});
        if (bt.takeProfit > 0) bt.tpPriceLine = state.series.candles.createPriceLine({price:bt.takeProfit,color:'#0ecb81',lineWidth:1,lineStyle:LightweightCharts.LineStyle.Dashed,axisLabelVisible:true,title:'TP'});
    }
}
