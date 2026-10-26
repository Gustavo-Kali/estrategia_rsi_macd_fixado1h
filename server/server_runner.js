const fs = require('fs');
const path = require('path');
const https = require('https');

// Utiliza o WebSocket nativo do Node 22 (ou fallback para global)
const WS = globalThis.WebSocket;

const PROJECT_ID = "automacao-inteligente-com-ia";
const API_KEY = "AIzaSyAgd4yzIFRSCrb6QI2LSskjMuxraigmwRE";

// --- Funções Matemáticas de Indicadores ---
function calculateSMA(closes, period) {
    const sma = new Array(closes.length).fill(null);
    if (closes.length < period) return sma;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += closes[i];
    sma[period - 1] = sum / period;
    for (let i = period; i < closes.length; i++) {
        sum += closes[i] - closes[i - period];
        sma[i] = sum / period;
    }
    return sma;
}

function calculateEMA(values, period) {
    const ema = new Array(values.length).fill(null);
    if (values.length < period) return ema;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    let prevEma = sum / period;
    ema[period - 1] = prevEma;
    const k = 2 / (period + 1);
    for (let i = period; i < values.length; i++) {
        const cur = (values[i] - prevEma) * k + prevEma;
        ema[i] = cur;
        prevEma = cur;
    }
    return ema;
}

function calculateRSIWilder(closes, period = 14) {
    const rsi = new Array(closes.length).fill(null);
    if (closes.length < period + 1) return rsi;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) gains += d; else losses += Math.abs(d);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        const g = d >= 0 ? d : 0;
        const l = d < 0 ? Math.abs(d) : 0;
        avgGain = (avgGain * (period - 1) + g) / period;
        avgLoss = (avgLoss * (period - 1) + l) / period;
        rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }
    return rsi;
}

function calculateMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
    const emaFast = calculateEMA(closes, fast);
    const emaSlow = calculateEMA(closes, slow);
    const macdLine = new Array(closes.length).fill(null);
    for (let i = 0; i < closes.length; i++) {
        if (emaFast[i] !== null && emaSlow[i] !== null) macdLine[i] = emaFast[i] - emaSlow[i];
    }
    const validIdx = macdLine.findIndex(v => v !== null);
    if (validIdx === -1) return { macdLine, signalLine: new Array(closes.length).fill(null) };
    const sigValues = calculateEMA(macdLine.slice(validIdx), signalPeriod);
    const signalLine = new Array(validIdx).fill(null).concat(sigValues);
    return { macdLine, signalLine };
}

function calculateSlTpByMa9(type, price, candles, ma9Array, currentIdx) {
    const tpMult = 2;
    const lookback = 20;
    const minStopDistance = 1000.0;
    const idx = (typeof currentIdx === 'number' && currentIdx >= 0) ? currentIdx : Math.max(0, candles.length - 2);
    const startIdx = Math.max(0, idx - lookback + 1);
    const windowCandles = candles.slice(startIdx, idx + 1);

    if (type === 'long') {
        let lowestLow = Math.min(...windowCandles.map(c => c.low));
        if (!isFinite(lowestLow) || lowestLow >= price) lowestLow = price - minStopDistance;
        let sl = Math.floor((lowestLow - 1.00) * 10) / 10;
        let risk = Math.max(price - sl, minStopDistance);
        sl = Math.floor((price - risk) * 10) / 10;
        const tp = Math.round((price + (risk * tpMult)) * 10) / 10;
        return { sl, tp };
    } else {
        let highestHigh = Math.max(...windowCandles.map(c => c.high));
        if (!isFinite(highestHigh) || highestHigh <= price) highestHigh = price + minStopDistance;
        let sl = Math.ceil((highestHigh + 1.00) * 10) / 10;
        let risk = Math.max(sl - price, minStopDistance);
        sl = Math.ceil((price + risk) * 10) / 10;
        const tp = Math.round((price - (risk * tpMult)) * 10) / 10;
        return { sl, tp };
    }
}

function calculateOrionSlTp(side, price, candles, idx) {
    const tpMult = 3; // Relação 1:3 para ORION
    const lookback = 20;
    const startIdx = Math.max(0, idx - lookback + 1);
    const windowCandles = candles.slice(startIdx, idx + 1);

    if (side === 'long') {
        let lowestLow = Math.min(...windowCandles.map(c => c.low));
        if (!isFinite(lowestLow) || lowestLow >= price) lowestLow = price * 0.99;
        let sl = Math.floor((lowestLow - 1.00) * 10) / 10;
        let risk = Math.max(price - sl, price * 0.003);
        sl = Math.floor((price - risk) * 10) / 10;
        const tp = Math.round((price + (risk * tpMult)) * 10) / 10;
        return { sl, tp };
    } else {
        let highestHigh = Math.max(...windowCandles.map(c => c.high));
        if (!isFinite(highestHigh) || highestHigh <= price) highestHigh = price * 1.01;
        let sl = Math.ceil((highestHigh + 1.00) * 10) / 10;
        let risk = Math.max(sl - price, price * 0.003);
        sl = Math.ceil((price + risk) * 10) / 10;
        const tp = Math.round((price - (risk * tpMult)) * 10) / 10;
        return { sl, tp };
    }
}

function formatDate(timestampSeconds) {
    const d = new Date(timestampSeconds * 1000);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

// --- Integração Firebase REST API ---
function syncFirebaseBot(botId, data) {
    try {
        const fields = {};
        for (const key of Object.keys(data)) {
            const val = data[key];
            if (typeof val === 'string') fields[key] = { stringValue: val };
            else if (typeof val === 'number') fields[key] = Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
            else if (typeof val === 'boolean') fields[key] = { booleanValue: val };
            else if (val && typeof val === 'object') {
                const mapFields = {};
                for (const subKey of Object.keys(val)) {
                    const subVal = val[subKey];
                    if (typeof subVal === 'string') mapFields[subKey] = { stringValue: subVal };
                    else if (typeof subVal === 'number') mapFields[subKey] = Number.isInteger(subVal) ? { integerValue: String(subVal) } : { doubleValue: subVal };
                    else if (typeof subVal === 'boolean') mapFields[subKey] = { booleanValue: subVal };
                    else mapFields[subKey] = { stringValue: String(subVal) };
                }
                fields[key] = { mapValue: { fields: mapFields } };
            }
            else fields[key] = { stringValue: String(val) };
        }

        const postData = JSON.stringify({ fields });
        const options = {
            hostname: 'firestore.googleapis.com',
            port: 443,
            path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/bots/${botId}?key=${API_KEY}`,
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        };

        const req = https.request(options, () => {});
        req.on('error', () => {});
        req.write(postData);
        req.end();
    } catch (e) {
        console.error(`[Firebase REST Error] Bot ${botId}:`, e);
    }
}

function syncFirebaseTradeLog(botName, botId, trade) {
    try {
        const data = {
            bot: botName,
            botId: botId,
            tipo: "LIVE_TRADE_MONITOR",
            ambiente: "SIMULACAO_247",
            symbol: "BTCUSDT",
            side: trade.side,
            entryPrice: trade.entryPrice,
            exitPrice: trade.exitPrice,
            stopLoss: trade.stopLoss,
            takeProfit: trade.takeProfit,
            lucroUsdt: trade.profit,
            pnlPct: trade.pnlPct,
            status: "CLOSED"
        };

        const fields = {};
        for (const key of Object.keys(data)) {
            const val = data[key];
            if (typeof val === 'string') fields[key] = { stringValue: val };
            else if (typeof val === 'number') fields[key] = Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
            else if (typeof val === 'boolean') fields[key] = { booleanValue: val };
            else if (val === null) fields[key] = { nullValue: null };
            else fields[key] = { stringValue: String(val) };
        }
        fields.timestamp = { timestampValue: new Date().toISOString() };

        const postData = JSON.stringify({ fields });
        const options = {
            hostname: 'firestore.googleapis.com',
            port: 443,
            path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/historico_trader?key=${API_KEY}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        };

        const req = https.request(options, () => {});
        req.on('error', () => {});
        req.write(postData);
        req.end();
    } catch (e) {}
}

// --- Engine de Monitoramento ---
class ServerRunner {
    constructor() {
        this.candles = [];
        this.ws = null;

        // Estado Zenith (RSI + MACD)
        this.zenith = {
            botId: "bot_1_rsi_macd",
            name: "ZENITH — RSI (14) + MACD",
            balance: 10000,
            initialBalance: 10000,
            trades: 0,
            wins: 0,
            losses: 0,
            position: null,
            entryPrice: 0,
            stopLoss: 0,
            takeProfit: 0,
            alertBuy: false,
            alertSell: false
        };

        // Estado Orion (SMA 20/50 + RSI)
        this.orion = {
            botId: "bot_2_tendencias_medias",
            name: "ORION — Tendências Médias Móveis (SMA 20/50 + RSI)",
            balance: 10000,
            initialBalance: 10000,
            trades: 0,
            wins: 0,
            losses: 0,
            position: null,
            entryPrice: 0,
            stopLoss: 0,
            takeProfit: 0,
            alertBuy: false,
            alertSell: false,
            alertBuyIdx: -1,
            alertSellIdx: -1
        };

        this.startDateFormatted = "";
    }

    async init() {
        console.log("[ZENITH & ORION Server Runner] Iniciando backtest histórico de 3 anos...");
        const dataPath = path.join(__dirname, '..', 'data', 'btcusdt_30m_3years.json');
        
        if (!fs.existsSync(dataPath)) {
            console.error(`[Error] Arquivo de dados ${dataPath} não encontrado.`);
            return;
        }

        const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        this.candles = raw.map(c => ({
            time: c[0],
            open: c[1],
            high: c[2],
            low: c[3],
            close: c[4],
            volume: c[5]
        }));

        this.startDateFormatted = formatDate(this.candles[0].time);
        console.log(`[Server Runner] Carregados ${this.candles.length} candles desde ${this.startDateFormatted}.`);

        // Executa Backtests Iniciais no Servidor
        this.runZenithBacktest();
        this.runOrionBacktest();

        console.log(`[Zenith Backtest] Balance: $${this.zenith.balance.toFixed(2)} | Trades: ${this.zenith.trades}`);
        console.log(`[Orion Backtest] Balance: $${this.orion.balance.toFixed(2)} | Trades: ${this.orion.trades}`);

        // Grava baseline no Firebase
        this.syncBotToFirebase(this.zenith);
        this.syncBotToFirebase(this.orion);

        // Inicia conexão WebSocket para manter monitoramento ativo 24/7
        this.connectWebSocket();
    }

    runZenithBacktest() {
        const closes = this.candles.map(c => c.close);
        const ma9 = calculateSMA(closes, 9);
        const rsi = calculateRSIWilder(closes, 14);
        const macdObj = calculateMACD(closes, 12, 26, 9);
        const macd = macdObj.macdLine;
        const signal = macdObj.signalLine;

        const stateCandles = [];
        let position = null;
        let entryPrice = 0;
        let stopLoss = 0;
        let takeProfit = 0;
        let alertBuy = false;
        let alertSell = false;
        let balance = 10000;
        let trades = 0;
        let wins = 0;
        let losses = 0;

        for (let i = 0; i < this.candles.length; i++) {
            const curCandle = this.candles[i];
            stateCandles.push(curCandle);

            // Verifica Exits
            if (position !== null) {
                if (position === 'long') {
                    if (curCandle.low <= stopLoss) {
                        const profit = 0.002 * (stopLoss - entryPrice);
                        balance += profit; trades++;
                        if (profit > 0) wins++; else losses++;
                        position = null;
                    } else if (curCandle.high >= takeProfit) {
                        const profit = 0.002 * (takeProfit - entryPrice);
                        balance += profit; trades++;
                        if (profit > 0) wins++; else losses++;
                        position = null;
                    }
                } else {
                    if (curCandle.high >= stopLoss) {
                        const profit = 0.002 * (entryPrice - stopLoss);
                        balance += profit; trades++;
                        if (profit > 0) wins++; else losses++;
                        position = null;
                    } else if (curCandle.low <= takeProfit) {
                        const profit = 0.002 * (entryPrice - takeProfit);
                        balance += profit; trades++;
                        if (profit > 0) wins++; else losses++;
                        position = null;
                    }
                }
            }

            // Verifica Sinais
            if (i < 3) continue;
            const prevIdx = i - 1;
            const rsiPrev = rsi[prevIdx];
            const rsiCur = rsi[i];
            const macdPrev = macd[prevIdx];
            const macdCur = macd[i];
            const sigPrev = signal[prevIdx];
            const sigCur = signal[i];

            if (rsiPrev === null || macdPrev === null || sigPrev === null || macdCur === null || sigCur === null) continue;

            if (rsiPrev < 30 && !alertBuy) { alertBuy = true; alertSell = false; }
            if (rsiPrev > 70 && !alertSell) { alertSell = true; alertBuy = false; }

            const crossUp = (macdPrev <= sigPrev) && (macdCur > sigCur);
            const crossDown = (macdPrev >= sigPrev) && (macdCur < sigCur);

            if (alertBuy && crossUp) {
                if (position !== 'long') {
                    if (position === 'short') {
                        const profit = 0.002 * (entryPrice - curCandle.open);
                        balance += profit; trades++;
                        if (profit > 0) wins++; else losses++;
                    }
                    position = 'long';
                    entryPrice = curCandle.open;
                    const calc = calculateSlTpByMa9('long', entryPrice, stateCandles, ma9, i);
                    stopLoss = calc.sl;
                    takeProfit = calc.tp;
                    alertBuy = false; alertSell = false;
                }
            } else if (alertSell && crossDown) {
                if (position !== 'short') {
                    if (position === 'long') {
                        const profit = 0.002 * (curCandle.open - entryPrice);
                        balance += profit; trades++;
                        if (profit > 0) wins++; else losses++;
                    }
                    position = 'short';
                    entryPrice = curCandle.open;
                    const calc = calculateSlTpByMa9('short', entryPrice, stateCandles, ma9, i);
                    stopLoss = calc.sl;
                    takeProfit = calc.tp;
                    alertSell = false; alertBuy = false;
                }
            }
        }

        // Salva estado final do backtest
        this.zenith.balance = balance;
        this.zenith.trades = trades;
        this.zenith.wins = wins;
        this.zenith.losses = losses;
        this.zenith.position = position;
        this.zenith.entryPrice = entryPrice;
        this.zenith.stopLoss = stopLoss;
        this.zenith.takeProfit = takeProfit;
        this.zenith.alertBuy = alertBuy;
        this.zenith.alertSell = alertSell;
    }

    runOrionBacktest() {
        const closes = this.candles.map(c => c.close);
        const sma8 = calculateSMA(closes, 8);
        const sma20 = calculateSMA(closes, 20);
        const sma50 = calculateSMA(closes, 50);
        const rsi = calculateRSIWilder(closes, 14);

        const stateCandles = [];
        let position = null;
        let entryPrice = 0;
        let stopLoss = 0;
        let takeProfit = 0;
        let balance = 10000;
        let trades = 0;
        let wins = 0;
        let losses = 0;
        let alertBuy = false, alertSell = false;
        let alertBuyIdx = -1, alertSellIdx = -1;
        let trendUpDuration = 0, trendDownDuration = 0;
        let validPullbackBuy = false, validPullbackSell = false;

        for (let i = 0; i < this.candles.length; i++) {
            const curCandle = this.candles[i];
            stateCandles.push(curCandle);

            // Verifica Exits
            if (position !== null) {
                if (position === 'long') {
                    if (curCandle.low <= stopLoss) {
                        const profit = 0.002 * (stopLoss - entryPrice);
                        balance += profit; trades++;
                        if (profit > 0) wins++; else losses++;
                        position = null;
                    } else if (curCandle.high >= takeProfit) {
                        const profit = 0.002 * (takeProfit - entryPrice);
                        balance += profit; trades++;
                        if (profit > 0) wins++; else losses++;
                        position = null;
                    }
                } else {
                    if (curCandle.high >= stopLoss) {
                        const profit = 0.002 * (entryPrice - stopLoss);
                        balance += profit; trades++;
                        if (profit > 0) wins++; else losses++;
                        position = null;
                    } else if (curCandle.low <= takeProfit) {
                        const profit = 0.002 * (entryPrice - takeProfit);
                        balance += profit; trades++;
                        if (profit > 0) wins++; else losses++;
                        position = null;
                    }
                }
            }

            // Verifica Sinais Orion (SMA 8/20/50 + RSI)
            if (i < 3) continue;
            const prevIdx = i - 1;
            const sma8Prev = sma8[prevIdx], sma8Cur = sma8[i];
            const sma20Prev = sma20[prevIdx], sma20Cur = sma20[i];
            const sma50Prev = sma50[prevIdx], sma50Cur = sma50[i];
            const rsiCur = rsi[i];

            if (sma8Prev === null || sma8Cur === null || sma20Prev === null || sma20Cur === null || sma50Prev === null || sma50Cur === null || rsiCur === null) continue;

            const minTrendCandles = 6; // 3 horas para timeframe padrão de 30m

            // 1. Tendência em andamento (Médias alinhadas e preço sustentado)
            const isTrendUp   = (sma8Prev > sma20Prev && sma20Prev > sma50Prev && curCandle.close > sma20Prev);
            const isTrendDown = (sma8Prev < sma20Prev && sma20Prev < sma50Prev && curCandle.close < sma20Prev);

            if (isTrendUp) {
                trendUpDuration = (trendUpDuration || 0) + 1;
            } else if (sma8Prev < sma20Prev && sma8Prev > sma50Prev && sma20Prev > sma50Prev) {
                // 2. Pullback válido (após ter tendência prévia estabelecida por >= 3h)
                if ((trendUpDuration || 0) >= minTrendCandles) {
                    validPullbackBuy = true;
                }
            } else if (sma8Prev < sma50Prev || sma20Prev < sma50Prev) {
                trendUpDuration = 0;
                validPullbackBuy = false;
            }

            if (isTrendDown) {
                trendDownDuration = (trendDownDuration || 0) + 1;
            } else if (sma8Prev > sma20Prev && sma8Prev < sma50Prev && sma20Prev < sma50Prev) {
                // 2. Pullback de venda válido
                if ((trendDownDuration || 0) >= minTrendCandles) {
                    validPullbackSell = true;
                }
            } else if (sma8Prev > sma50Prev || sma20Prev > sma50Prev) {
                trendDownDuration = 0;
                validPullbackSell = false;
            }

            // 3. Gatilho de Retomada: Preço e SMA 8 fecham acima da SMA 20
            const buySignal  = validPullbackBuy  && (sma8Cur > sma20Cur) && (curCandle.close > sma20Cur) && (sma20Cur > sma50Cur) && (rsiCur >= 50);
            const sellSignal = validPullbackSell && (sma8Cur < sma20Cur) && (curCandle.close < sma20Cur) && (sma20Cur < sma50Cur) && (rsiCur <= 50);

            if (buySignal) {
                validPullbackBuy = false;
                trendUpDuration = 0;
                if (position !== 'long') {
                    if (position === 'short') {
                        const profit = 0.002 * (entryPrice - curCandle.open);
                        balance += profit; trades++;
                        if (profit > 0) wins++; else losses++;
                    }
                    position = 'long';
                    entryPrice = curCandle.open;
                    const calc = calculateOrionSlTp('long', entryPrice, stateCandles, i);
                    stopLoss = calc.sl;
                    takeProfit = calc.tp;
                }
            } else if (sellSignal) {
                validPullbackSell = false;
                trendDownDuration = 0;
                if (position !== 'short') {
                    if (position === 'long') {
                        const profit = 0.002 * (curCandle.open - entryPrice);
                        balance += profit; trades++;
                        if (profit > 0) wins++; else losses++;
                    }
                    position = 'short';
                    entryPrice = curCandle.open;
                    const calc = calculateOrionSlTp('short', entryPrice, stateCandles, i);
                    stopLoss = calc.sl;
                    takeProfit = calc.tp;
                }
            }
        }

        // Salva estado final do backtest
        this.orion.balance = balance;
        this.orion.trades = trades;
        this.orion.wins = wins;
        this.orion.losses = losses;
        this.orion.position = position;
        this.orion.entryPrice = entryPrice;
        this.orion.stopLoss = stopLoss;
        this.orion.takeProfit = takeProfit;
    }

    syncBotToFirebase(botState) {
        const totalPnl = botState.balance - botState.initialBalance;
        const pnlPct = (totalPnl / botState.initialBalance) * 100;
        const winRate = botState.trades > 0 ? (botState.wins / botState.trades) * 100 : 0;
        const endFormatted = formatDate(this.candles[this.candles.length - 1].time);

        const payload = {
            symbol: "BTCUSDT",
            interval: "30m",
            pnl: Number(totalPnl.toFixed(2)),
            pnlPct: Number(pnlPct.toFixed(2)),
            winRate: Number(winRate.toFixed(1)),
            trades: botState.trades,
            wins: botState.wins,
            losses: botState.losses,
            finalBalance: Number(botState.balance.toFixed(2)),
            initialBalance: Number(botState.initialBalance.toFixed(2)),
            isPartial: false,
            updatedAt: new Date().toISOString(),
            startDate: this.startDateFormatted,
            endDate: endFormatted
        };

        syncFirebaseBot(botState.botId, {
            name: botState.name,
            backtest: payload
        });
    }

    connectWebSocket() {
        if (!WS) {
            console.error("[WS Error] WebSocket nativo não disponível no ambiente NodeJS.");
            return;
        }

        const streamUrl = `wss://fstream.binance.com/ws/btcusdt@kline_30m`;
        console.log(`[Server Runner] Conectando WebSocket com Binance em ${streamUrl}...`);

        try {
            this.ws = new WS(streamUrl);

            this.ws.onopen = () => {
                console.log(`[Server Runner] WebSocket Conectado! Monitorando BTCUSDT 30m para Zenith & Orion.`);
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.e === 'kline') {
                        const k = msg.k;
                        const upd = {
                            time: Math.floor(k.t / 1000),
                            open: parseFloat(k.o),
                            high: parseFloat(k.h),
                            low: parseFloat(k.l),
                            close: parseFloat(k.c),
                            volume: parseFloat(k.v)
                        };

                        const lastCandle = this.candles[this.candles.length - 1];

                        if (upd.time === lastCandle.time) {
                            // Atualiza candle atual
                            this.candles[this.candles.length - 1] = upd;
                            this.checkRealtimeExits(upd);
                        } else if (upd.time > lastCandle.time) {
                            // Fecha candle anterior e abre o novo
                            this.candles.push(upd);
                            if (this.candles.length > 2000) this.candles.shift();

                            console.log(`[Server Runner] Candle Fechado: ${formatDate(lastCandle.time)} Close: $${lastCandle.close}`);
                            
                            this.checkRealtimeEntries(lastCandle);
                        }
                    }
                } catch (e) {
                    console.error("[WS Message Parse Exception]", e);
                }
            };

            this.ws.onerror = (err) => {
                console.error('[Server Runner WS Error]', err);
            };

            this.ws.onclose = () => {
                console.log('🔄 Server Runner WS desconectado. Reconectando em 5 segundos...');
                setTimeout(() => this.connectWebSocket(), 5000);
            };

        } catch (e) {
            console.error('[Server Runner WS Exception]', e);
        }
    }

    checkRealtimeExits(candle) {
        // Verifica Zenith
        if (this.zenith.position !== null) {
            let hit = false;
            let profit = 0;
            let exitPrice = 0;
            let reason = "";

            if (this.zenith.position === 'long') {
                if (candle.low <= this.zenith.stopLoss) {
                    hit = true; exitPrice = this.zenith.stopLoss; reason = "sl";
                    profit = 0.002 * (this.zenith.stopLoss - this.zenith.entryPrice);
                } else if (candle.high >= this.zenith.takeProfit) {
                    hit = true; exitPrice = this.zenith.takeProfit; reason = "tp";
                    profit = 0.002 * (this.zenith.takeProfit - this.zenith.entryPrice);
                }
            } else {
                if (candle.high >= this.zenith.stopLoss) {
                    hit = true; exitPrice = this.zenith.stopLoss; reason = "sl";
                    profit = 0.002 * (this.zenith.entryPrice - this.zenith.stopLoss);
                } else if (candle.low <= this.zenith.takeProfit) {
                    hit = true; exitPrice = this.zenith.takeProfit; reason = "tp";
                    profit = 0.002 * (this.zenith.entryPrice - this.zenith.takeProfit);
                }
            }

            if (hit) {
                this.zenith.balance += profit;
                this.zenith.trades++;
                if (profit > 0) this.zenith.wins++; else this.zenith.losses++;
                
                console.log(`[ZENITH Simulação] Posição ${this.zenith.position.toUpperCase()} fechada em tempo real via ${reason.toUpperCase()}! Lucro: $${profit.toFixed(2)}`);
                
                syncFirebaseTradeLog(this.zenith.name, this.zenith.botId, {
                    side: this.zenith.position === 'long' ? 'SELL' : 'BUY',
                    entryPrice: this.zenith.entryPrice,
                    exitPrice: exitPrice,
                    stopLoss: this.zenith.stopLoss,
                    takeProfit: this.zenith.takeProfit,
                    profit: profit,
                    pnlPct: (profit / (this.zenith.entryPrice * 0.002)) * 100
                });

                this.zenith.position = null;
                this.syncBotToFirebase(this.zenith);
            }
        }

        // Verifica Orion
        if (this.orion.position !== null) {
            let hit = false;
            let profit = 0;
            let exitPrice = 0;
            let reason = "";

            if (this.orion.position === 'long') {
                if (candle.low <= this.orion.stopLoss) {
                    hit = true; exitPrice = this.orion.stopLoss; reason = "sl";
                    profit = 0.002 * (this.orion.stopLoss - this.orion.entryPrice);
                } else if (candle.high >= this.orion.takeProfit) {
                    hit = true; exitPrice = this.orion.takeProfit; reason = "tp";
                    profit = 0.002 * (this.orion.takeProfit - this.orion.entryPrice);
                }
            } else {
                if (candle.high >= this.orion.stopLoss) {
                    hit = true; exitPrice = this.orion.stopLoss; reason = "sl";
                    profit = 0.002 * (this.orion.entryPrice - this.orion.stopLoss);
                } else if (candle.low <= this.orion.takeProfit) {
                    hit = true; exitPrice = this.orion.takeProfit; reason = "tp";
                    profit = 0.002 * (this.orion.entryPrice - this.orion.takeProfit);
                }
            }

            if (hit) {
                this.orion.balance += profit;
                this.orion.trades++;
                if (profit > 0) this.orion.wins++; else this.orion.losses++;

                console.log(`[ORION Simulação] Posição ${this.orion.position.toUpperCase()} fechada em tempo real via ${reason.toUpperCase()}! Lucro: $${profit.toFixed(2)}`);

                syncFirebaseTradeLog(this.orion.name, this.orion.botId, {
                    side: this.orion.position === 'long' ? 'SELL' : 'BUY',
                    entryPrice: this.orion.entryPrice,
                    exitPrice: exitPrice,
                    stopLoss: this.orion.stopLoss,
                    takeProfit: this.orion.takeProfit,
                    profit: profit,
                    pnlPct: (profit / (this.orion.entryPrice * 0.002)) * 100
                });

                this.orion.position = null;
                this.syncBotToFirebase(this.orion);
            }
        }
    }

    checkRealtimeEntries(candle) {
        const closes = this.candles.map(c => c.close);
        const len = closes.length;
        if (len < 100) return;

        const currentIdx = len - 1;
        const prevIdx = len - 2;

        // Zenith
        const ma9 = calculateSMA(closes, 9);
        const rsi = calculateRSIWilder(closes, 14);
        const macdObj = calculateMACD(closes, 12, 26, 9);
        const macd = macdObj.macdLine;
        const signal = macdObj.signalLine;

        const rsiPrev = rsi[prevIdx];
        const rsiCur = rsi[currentIdx];
        const macdPrev = macd[prevIdx];
        const macdCur = macd[currentIdx];
        const sigPrev = signal[prevIdx];
        const sigCur = signal[currentIdx];

        if (rsiPrev !== null && rsiCur !== null && macdPrev !== null && macdCur !== null && sigPrev !== null && sigCur !== null) {
            if (rsiPrev < 30 && !this.zenith.alertBuy) {
                this.zenith.alertBuy = true; this.zenith.alertSell = false;
            }
            if (rsiPrev > 70 && !this.zenith.alertSell) {
                this.zenith.alertSell = true; this.zenith.alertBuy = false;
            }

            const crossUp = macdPrev <= sigPrev && macdCur > sigCur;
            const crossDown = macdPrev >= sigPrev && macdCur < sigCur;

            if (this.zenith.alertBuy && crossUp) {
                if (this.zenith.position !== 'long') {
                    if (this.zenith.position === 'short') {
                        const profit = 0.002 * (this.zenith.entryPrice - candle.open);
                        this.zenith.balance += profit; this.zenith.trades++;
                        if (profit > 0) this.zenith.wins++; else this.zenith.losses++;
                    }
                    this.zenith.position = 'long';
                    this.zenith.entryPrice = candle.open;
                    const calc = calculateSlTpByMa9('long', this.zenith.entryPrice, this.candles, ma9, currentIdx);
                    this.zenith.stopLoss = calc.sl;
                    this.zenith.takeProfit = calc.tp;
                    this.zenith.alertBuy = false; this.zenith.alertSell = false;
                    console.log(`[ZENITH Simulação] Compra ativada em tempo real! Entrada: $${this.zenith.entryPrice}`);
                    this.syncBotToFirebase(this.zenith);
                }
            } else if (this.zenith.alertSell && crossDown) {
                if (this.zenith.position !== 'short') {
                    if (this.zenith.position === 'long') {
                        const profit = 0.002 * (candle.open - this.zenith.entryPrice);
                        this.zenith.balance += profit; this.zenith.trades++;
                        if (profit > 0) this.zenith.wins++; else this.zenith.losses++;
                    }
                    this.zenith.position = 'short';
                    this.zenith.entryPrice = candle.open;
                    const calc = calculateSlTpByMa9('short', this.zenith.entryPrice, this.candles, ma9, currentIdx);
                    this.zenith.stopLoss = calc.sl;
                    this.zenith.takeProfit = calc.tp;
                    this.zenith.alertSell = false; this.zenith.alertBuy = false;
                    console.log(`[ZENITH Simulação] Venda ativada em tempo real! Entrada: $${this.zenith.entryPrice}`);
                    this.syncBotToFirebase(this.zenith);
                }
            }
        }

        // Orion (SMA 8/20/50 + RSI)
        const sma8 = calculateSMA(closes, 8);
        const sma20 = calculateSMA(closes, 20);
        const sma50 = calculateSMA(closes, 50);
        const rsiOrion = calculateRSIWilder(closes, 14);

        const sma8Prev = sma8[prevIdx], sma8Cur = sma8[currentIdx];
        const sma20Prev = sma20[prevIdx], sma20Cur = sma20[currentIdx];
        const sma50Prev = sma50[prevIdx], sma50Cur = sma50[currentIdx];
        const rsiCurOrion = rsiOrion[currentIdx];

        if (sma8Prev !== null && sma8Cur !== null && sma20Prev !== null && sma20Cur !== null && sma50Prev !== null && sma50Cur !== null && rsiCurOrion !== null) {
            const minTrendCandles = 6;

            // 1. Tendência em andamento (Médias alinhadas e preço sustentado)
            const isTrendUp   = (sma8Prev > sma20Prev && sma20Prev > sma50Prev && candle.close > sma20Prev);
            const isTrendDown = (sma8Prev < sma20Prev && sma20Prev < sma50Prev && candle.close < sma20Prev);

            if (isTrendUp) {
                this.orion.trendUpDuration = (this.orion.trendUpDuration || 0) + 1;
            } else if (sma8Prev < sma20Prev && sma8Prev > sma50Prev && sma20Prev > sma50Prev) {
                // 2. Pullback válido (após ter tendência prévia estabelecida por >= 3h)
                if ((this.orion.trendUpDuration || 0) >= minTrendCandles) {
                    this.orion.validPullbackBuy = true;
                }
            } else if (sma8Prev < sma50Prev || sma20Prev < sma50Prev) {
                this.orion.trendUpDuration = 0;
                this.orion.validPullbackBuy = false;
            }

            if (isTrendDown) {
                this.orion.trendDownDuration = (this.orion.trendDownDuration || 0) + 1;
            } else if (sma8Prev > sma20Prev && sma8Prev < sma50Prev && sma20Prev < sma50Prev) {
                // 2. Pullback de venda válido
                if ((this.orion.trendDownDuration || 0) >= minTrendCandles) {
                    this.orion.validPullbackSell = true;
                }
            } else if (sma8Prev > sma50Prev || sma20Prev > sma50Prev) {
                this.orion.trendDownDuration = 0;
                this.orion.validPullbackSell = false;
            }

            // 3. Gatilho de Retomada: Preço e SMA 8 fecham acima da SMA 20
            const buySignal  = this.orion.validPullbackBuy  && (sma8Cur > sma20Cur) && (candle.close > sma20Cur) && (sma20Cur > sma50Cur) && (rsiCurOrion >= 50);
            const sellSignal = this.orion.validPullbackSell && (sma8Cur < sma20Cur) && (candle.close < sma20Cur) && (sma20Cur < sma50Cur) && (rsiCurOrion <= 50);

            if (buySignal) {
                this.orion.validPullbackBuy = false;
                this.orion.trendUpDuration = 0;
                if (this.orion.position !== 'long') {
                    if (this.orion.position === 'short') {
                        const profit = 0.002 * (this.orion.entryPrice - candle.open);
                        this.orion.balance += profit; this.orion.trades++;
                        if (profit > 0) this.orion.wins++; else this.orion.losses++;
                    }
                    this.orion.position = 'long';
                    this.orion.entryPrice = candle.open;
                    const calc = calculateOrionSlTp('long', this.orion.entryPrice, this.candles, currentIdx);
                    this.orion.stopLoss = calc.sl;
                    this.orion.takeProfit = calc.tp;
                    console.log(`[ORION Simulação] Compra ativada em tempo real! Entrada: $${this.orion.entryPrice}`);
                    this.syncBotToFirebase(this.orion);
                }
            } else if (sellSignal) {
                this.orion.validPullbackSell = false;
                this.orion.trendDownDuration = 0;
                if (this.orion.position !== 'short') {
                    if (this.orion.position === 'long') {
                        const profit = 0.002 * (candle.open - this.orion.entryPrice);
                        this.orion.balance += profit; this.orion.trades++;
                        if (profit > 0) this.orion.wins++; else this.orion.losses++;
                    }
                    this.orion.position = 'short';
                    this.orion.entryPrice = candle.open;
                    const calc = calculateOrionSlTp('short', this.orion.entryPrice, this.candles, currentIdx);
                    this.orion.stopLoss = calc.sl;
                    this.orion.takeProfit = calc.tp;
                    console.log(`[ORION Simulação] Venda ativada em tempo real! Entrada: $${this.orion.entryPrice}`);
                    this.syncBotToFirebase(this.orion);
                }
            }
        }
    }
}

const serverRunner = new ServerRunner();

module.exports = {
    serverRunner
};
