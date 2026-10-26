/* ============================================================
   js/indicators.js — Indicadores técnicos e cálculo de SL/TP
   ============================================================ */

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

function calculateSlTpByMa9(type, price, candles, ma9Array, currentIdx, tpMultiplier) {
    const isTrendStrategy = (typeof window !== 'undefined' && window.PAGE_STRATEGY === 'trend_sma');
    const tpMult = tpMultiplier || (isTrendStrategy ? 3 : 2); // Relação Risco:Retorno 1:3 para ORION (1:2 para outras)
    const lookback = 20; // Janela de 20 candles para capturar o topo/fundo de referência
    const idx = (typeof currentIdx === 'number' && currentIdx >= 0) ? currentIdx : Math.max(0, candles.length - 2);
    
    // Fatia dos últimos 20 candles até o candle de sinal
    const startIdx = Math.max(0, idx - lookback + 1);
    const windowCandles = candles.slice(startIdx, idx + 1);

    if (type === 'long') {
        // Busca a menor mínima nos últimos 20 candles (Fundo)
        let lowestLow = Math.min(...windowCandles.map(c => c.low));
        if (!isFinite(lowestLow) || lowestLow >= price) {
            lowestLow = price * 0.99; // Fallback de 1% se candle atual for a mínima
        }
        
        let sl = Math.floor((lowestLow - 1.00) * 10) / 10;
        let risk = Math.max(price - sl, price * 0.003); // Risco real mínimo de 0.3%
        sl = Math.floor((price - risk) * 10) / 10;
        
        // Take Profit (1:3 no ORION)
        const tp = Math.round((price + (risk * tpMult)) * 10) / 10;
        return {
            sl: Number(sl.toFixed(1)),
            tp: Number(tp.toFixed(1)),
            risk: Number(risk.toFixed(1)),
            pivot: lowestLow
        };
    } else {
        // Busca a maior máxima nos últimos 20 candles (Topo)
        let highestHigh = Math.max(...windowCandles.map(c => c.high));
        if (!isFinite(highestHigh) || highestHigh <= price) {
            highestHigh = price * 1.01; // Fallback de 1% se candle atual for a máxima
        }
        
        let sl = Math.ceil((highestHigh + 1.00) * 10) / 10;
        let risk = Math.max(sl - price, price * 0.003); // Risco real mínimo de 0.3%
        sl = Math.ceil((price + risk) * 10) / 10;
        
        // Take Profit (1:3 no ORION)
        const tp = Math.round((price - (risk * tpMult)) * 10) / 10;
        return {
            sl: Number(sl.toFixed(1)),
            tp: Number(tp.toFixed(1)),
            risk: Number(risk.toFixed(1)),
            pivot: highestHigh
        };
    }
}

function calculateBollingerBands(closes, period = 20, stdDevMultiplier = 2) {
    const middle = calculateSMA(closes, period);
    const upper = new Array(closes.length).fill(null);
    const lower = new Array(closes.length).fill(null);

    for (let i = period - 1; i < closes.length; i++) {
        const slice = closes.slice(i - period + 1, i + 1);
        const mean = middle[i];
        const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
        const stdDev = Math.sqrt(variance);

        upper[i] = mean + (stdDevMultiplier * stdDev);
        lower[i] = mean - (stdDevMultiplier * stdDev);
    }

    return { middle, upper, lower };
}

