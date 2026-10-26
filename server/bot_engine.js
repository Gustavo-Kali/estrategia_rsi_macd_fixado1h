const https = require('https');
const crypto = require('crypto');

// Utiliza o WebSocket nativo do Node 22
const WS = globalThis.WebSocket;

// Helper para chamadas autenticadas à Binance
function binanceRequest(method, apiPath, params, apiKey, apiSecret, isTestnet) {
    return new Promise((resolve, reject) => {
        const baseUrl = isTestnet ? 'testnet.binancefuture.com' : 'fapi.binance.com';
        params.recvWindow = 20000;
        params.timestamp = Date.now();

        const queryString = Object.keys(params)
            .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
            .join('&');

        const signature = crypto
            .createHmac('sha256', apiSecret)
            .update(queryString)
            .digest('hex');

        const fullPath = `${apiPath}?${queryString}&signature=${signature}`;

        const options = {
            hostname: baseUrl,
            port: 443,
            path: fullPath,
            method: method,
            headers: {
                'X-MBX-APIKEY': apiKey,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(json);
                    } else {
                        reject({ statusCode: res.statusCode, body: json });
                    }
                } catch (e) {
                    reject({ statusCode: res.statusCode, error: 'JSON Parse Error', raw: data });
                }
            });
        });

        req.on('error', err => reject({ error: err.message }));
        req.end();
    });
}

// Formatação respeitando regras da Binance
function formatPrice(sym, p) {
    const num = Number(p);
    if (isNaN(num)) return '0.0';
    const s = String(sym || '').toUpperCase();
    if (s.startsWith('BTC')) return (Math.round(num * 10) / 10).toFixed(1);
    if (s.startsWith('ETH')) return (Math.round(num * 100) / 100).toFixed(2);
    if (s.startsWith('SOL') || s.startsWith('BNB')) return (Math.round(num * 100) / 100).toFixed(2);
    if (s.startsWith('XRP')) return (Math.round(num * 10000) / 10000).toFixed(4);
    return (Math.round(num * 10) / 10).toFixed(1);
}

function formatQuantity(sym, q) {
    const num = Number(q);
    if (isNaN(num)) return '0.001';
    const s = String(sym || '').toUpperCase();
    if (s.startsWith('BTC') || s.startsWith('ETH')) return num.toFixed(3);
    if (s.startsWith('XRP')) return Math.round(num).toFixed(0);
    return num.toFixed(2);
}

// Grava evento no Firebase Firestore via REST API
function syncFirebase(collectionName, data) {
    try {
        const PROJECT_ID = "automacao-inteligente-com-ia";
        const API_KEY = "AIzaSyAgd4yzIFRSCrb6QI2LSskjMuxraigmwRE";

        const fields = {};
        for (const key of Object.keys(data)) {
            const val = data[key];
            if (typeof val === 'string') fields[key] = { stringValue: val };
            else if (typeof val === 'number') fields[key] = Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
            else if (typeof val === 'boolean') fields[key] = { booleanValue: val };
            else if (val === null) fields[key] = { nullValue: null };
            else fields[key] = { stringValue: JSON.stringify(val) };
        }
        fields.timestamp = { timestampValue: new Date().toISOString() };

        const postData = JSON.stringify({ fields });
        const options = {
            hostname: 'firestore.googleapis.com',
            port: 443,
            path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionName}?key=${API_KEY}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        };

        const req = https.request(options, () => {});
        req.on('error', () => {});
        req.write(postData);
        req.end();
    } catch (e) { }
}

// --- Motor do Robô 24/7 ---
class BotEngine {
    constructor() {
        this.state = {
            running: false,
            symbol: 'BTCUSDT',
            interval: '1m',
            qty: 0.002,
            environment: 'testnet',
            apiKey: '',
            apiSecret: '',
            position: null,
            entryPrice: 0,
            stopLoss: 0,
            takeProfit: 0,
            trades: 0,
            sessionPnl: 0,
            alertBuy: false,
            alertSell: false,
            lastPrice: 0,
            logs: []
        };

        this.candles = [];
        this.ws = null;
        this.posInterval = null;
        this.isCheckingPosition = false;
    }

    addLog(msg, type = 'info') {
        const time = new Date().toLocaleTimeString('pt-BR');
        const entry = { time, msg, type };
        this.state.logs.unshift(entry);
        if (this.state.logs.length > 80) this.state.logs.pop();
        console.log(`[ZENITH 24/7] [${time}] ${msg}`);
    }

    async start(config) {
        if (this.state.running) {
            this.stop();
        }

        this.state.symbol = (config.symbol || 'BTCUSDT').toUpperCase();
        this.state.interval = config.interval || '1m';
        this.state.qty = parseFloat(config.qty) || 0.002;
        this.state.environment = config.environment || 'testnet';
        this.state.apiKey = config.apiKey || '';
        this.state.apiSecret = config.apiSecret || '';
        this.state.running = true;
        this.state.alertBuy = false;
        this.state.alertSell = false;

        this.addLog(`🚀 ZENITH Motor 24/7 Iniciado no Servidor! (${this.state.symbol} - ${this.state.interval} - ${this.state.environment.toUpperCase()})`, 'green');

        // Carrega histórico para aquecer os indicadores
        await this.loadHistoricalData();

        // Conecta WebSocket autônomo com a Binance
        this.connectWebSocket();

        // Inicia monitoramento de posição e cancelamento de ordens órfãs
        this.startPositionMonitor();
    }

    stop() {
        this.state.running = false;
        if (this.ws) {
            try { this.ws.close(); } catch (e) { }
            this.ws = null;
        }
        if (this.posInterval) {
            clearInterval(this.posInterval);
            this.posInterval = null;
        }
        this.addLog('🛑 ZENITH Motor 24/7 Parado.', 'red');
    }

    async loadHistoricalData() {
        return new Promise((resolve) => {
            const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${this.state.symbol}&interval=${this.state.interval}&limit=1500`;
            https.get(url, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const raw = JSON.parse(data);
                        if (Array.isArray(raw)) {
                            this.candles = raw.map(c => ({
                                time: Math.floor(c[0] / 1000),
                                open: parseFloat(c[1]),
                                high: parseFloat(c[2]),
                                low: parseFloat(c[3]),
                                close: parseFloat(c[4]),
                                volume: parseFloat(c[5])
                            }));
                            this.addLog(`📊 Histórico carregado: ${this.candles.length} candles aquecidos.`, 'cyan');
                        }
                    } catch (e) { }
                    resolve();
                });
            }).on('error', () => resolve());
        });
    }

    connectWebSocket() {
        if (!WS) {
            this.addLog('⚠️ WebSocket nativo não disponível no ambiente.', 'red');
            return;
        }

        const isTestnet = this.state.environment === 'testnet';
        // Testnet Futures usa host diferente da produção
        const wsHost = isTestnet
            ? 'stream.binancefuture.com'
            : 'fstream.binance.com';
        const streamUrl = `wss://${wsHost}/ws/${this.state.symbol.toLowerCase()}@kline_${this.state.interval}`;
        this.addLog(`🌐 Conectando WebSocket 24/7 com Binance (${isTestnet ? 'TESTNET' : 'PRODUÇÃO'})...`, 'cyan');

        try {
            this.ws = new WS(streamUrl);

            this.ws.onopen = () => {
                this.addLog(`✅ WebSocket Conectado e Monitorando ${this.state.symbol} (${this.state.interval})`, 'green');
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.e === 'kline') {
                        const k = msg.k;
                        this.state.lastPrice = parseFloat(k.c);

                        const upd = {
                            time: Math.floor(k.t / 1000),
                            open: parseFloat(k.o),
                            high: parseFloat(k.h),
                            low: parseFloat(k.l),
                            close: parseFloat(k.c),
                            volume: parseFloat(k.v)
                        };

                        if (this.candles.length === 0) {
                            this.candles.push(upd);
                            return;
                        }

                        const last = this.candles[this.candles.length - 1];
                        if (upd.time === last.time) {
                            this.candles[this.candles.length - 1] = upd;
                        } else if (upd.time > last.time) {
                            this.candles.push(upd);
                            if (this.candles.length > 2000) this.candles.shift();
                            // Novo candle fechado: calcular RSI + MACD
                            this.processCandleClosed();
                        }
                    }
                } catch (e) { }
            };

            this.ws.onerror = (err) => {
                console.error('[WS Error]', err);
            };

            this.ws.onclose = () => {
                if (this.state.running) {
                    this.addLog('🔄 WebSocket reconectando em 3 segundos...', 'yellow');
                    setTimeout(() => { if (this.state.running) this.connectWebSocket(); }, 3000);
                }
            };
        } catch (e) {
            console.error('[WS Connection Exception]', e);
        }
    }

    // Cálculo dos indicadores no Backend
    calculateIndicators() {
        const closes = this.candles.map(c => c.close);
        const len = closes.length;
        if (len < 50) return null;

        // RSI Wilder 14
        let gains = 0, losses = 0;
        for (let i = 1; i <= 14; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff >= 0) gains += diff; else losses -= diff;
        }
        let avgGain = gains / 14;
        let avgLoss = losses / 14;
        const rsiArr = [null];
        for (let i = 14; i < len; i++) {
            if (i > 14) {
                const diff = closes[i] - closes[i - 1];
                const gain = diff > 0 ? diff : 0;
                const loss = diff < 0 ? -diff : 0;
                avgGain = (avgGain * 13 + gain) / 14;
                avgLoss = (avgLoss * 13 + loss) / 14;
            }
            if (avgLoss === 0) rsiArr.push(100);
            else {
                const rs = avgGain / avgLoss;
                rsiArr.push(100 - (100 / (1 + rs)));
            }
        }

        // MACD (12, 26, 9)
        const calcEMA = (data, period) => {
            const k = 2 / (period + 1);
            const ema = [data[0]];
            for (let i = 1; i < data.length; i++) {
                ema.push(data[i] * k + ema[i - 1] * (1 - k));
            }
            return ema;
        };

        const ema12 = calcEMA(closes, 12);
        const ema26 = calcEMA(closes, 26);
        const macdLine = [];
        for (let i = 0; i < len; i++) macdLine.push(ema12[i] - ema26[i]);
        const signalLine = calcEMA(macdLine, 9);

        return {
            rsi: rsiArr,
            macd: macdLine,
            signal: signalLine
        };
    }

    // Processamento de sinais de entrada
    processCandleClosed() {
        if (!this.state.running || this.candles.length < 30) return;

        const ind = this.calculateIndicators();
        if (!ind) return;

        const len = this.candles.length;
        const closedIdx = len - 2;
        const prevIdx = len - 3;

        const rsiCur = ind.rsi[ind.rsi.length - 2];
        const rsiPrev = ind.rsi[ind.rsi.length - 3];
        const macdCur = ind.macd[ind.macd.length - 2];
        const macdPrev = ind.macd[ind.macd.length - 3];
        const sigCur = ind.signal[ind.signal.length - 2];
        const sigPrev = ind.signal[ind.signal.length - 3];

        if (rsiCur === null || macdCur === null || sigCur === null) return;

        // Gatilho RSI
        if ((rsiCur < 30 || rsiPrev < 30) && !this.state.alertBuy) {
            this.state.alertBuy = true;
            this.state.alertSell = false;
            this.addLog(`⚠️ Gatilho RSI: Sobrevenda (${rsiCur.toFixed(1)}). Aguardando MACD...`, 'green');
        }
        if ((rsiCur > 70 || rsiPrev > 70) && !this.state.alertSell) {
            this.state.alertSell = true;
            this.state.alertBuy = false;
            this.addLog(`⚠️ Gatilho RSI: Sobrecompra (${rsiCur.toFixed(1)}). Aguardando MACD...`, 'red');
        }

        // Confirmação MACD
        const crossUp = macdPrev <= sigPrev && macdCur > sigCur;
        const crossDown = macdPrev >= sigPrev && macdCur < sigCur;

        if (this.state.alertBuy && crossUp && this.state.position !== 'long') {
            this.executeBackendTrade('long', closedIdx);
            this.state.alertBuy = false;
        } else if (this.state.alertSell && crossDown && this.state.position !== 'short') {
            this.executeBackendTrade('short', closedIdx);
            this.state.alertSell = false;
        }
    }

    // Executa trade autônomo na Binance
    async executeBackendTrade(side, closedIdx) {
        const { apiKey, apiSecret, environment, symbol, qty } = this.state;
        if (!apiKey || !apiSecret) return;

        const isTestnet = environment === 'testnet';
        const orderSide = side === 'long' ? 'BUY' : 'SELL';
        const oppositeSide = side === 'long' ? 'SELL' : 'BUY';

        // Calcula SL pelo pivô dos últimos 20 candles com segurança mínima de 1000 USDT
        const lookback = 20;
        const minStopDistance = 1000.0;
        const startIdx = Math.max(0, closedIdx - lookback + 1);
        const windowCandles = this.candles.slice(startIdx, closedIdx + 1);

        let sl = 0;
        if (side === 'long') {
            let lowestLow = Math.min(...windowCandles.map(c => c.low));
            if (!isFinite(lowestLow) || lowestLow >= this.state.lastPrice) lowestLow = this.state.lastPrice - minStopDistance;
            let rawSl = Math.floor((lowestLow - 1.0) * 10) / 10;
            let risk = Math.max(this.state.lastPrice - rawSl, minStopDistance);
            sl = Number(formatPrice(symbol, this.state.lastPrice - risk));
        } else {
            let highestHigh = Math.max(...windowCandles.map(c => c.high));
            if (!isFinite(highestHigh) || highestHigh <= this.state.lastPrice) highestHigh = this.state.lastPrice + minStopDistance;
            let rawSl = Math.ceil((highestHigh + 1.0) * 10) / 10;
            let risk = Math.max(rawSl - this.state.lastPrice, minStopDistance);
            sl = Number(formatPrice(symbol, this.state.lastPrice + risk));
        }

        try {
            // Cancela todas as ordens abertas anteriores
            await binanceRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol }, apiKey, apiSecret, isTestnet);
            const formattedQty = formatQuantity(symbol, qty);

            // Ordem principal MARKET
            await binanceRequest('POST', '/fapi/v1/order', {
                symbol, side: orderSide, type: 'MARKET', quantity: String(formattedQty)
            }, apiKey, apiSecret, isTestnet);

            // Aguarda 600ms e busca preço real de execução via positionRisk
            await new Promise(r => setTimeout(r, 600));
            const posList = await binanceRequest('GET', '/fapi/v2/positionRisk', { symbol }, apiKey, apiSecret, isTestnet);
            const pos = Array.isArray(posList) ? posList.find(p => p.symbol === symbol) : null;
            const realFillPrice = (pos && parseFloat(pos.entryPrice) > 0)
                ? parseFloat(pos.entryPrice)
                : this.state.lastPrice;
            
            this.addLog(`✅ Ordem ${orderSide} Executada! Preço real: $${realFillPrice}, Qty: ${formattedQty}`, 'green');

            // Recalcula SL e TP baseados no preço real de execução com stop mínimo
            let realRisk = Math.max(Math.abs(realFillPrice - sl), minStopDistance);
            const slPrice = formatPrice(symbol, side === 'long' ? (realFillPrice - realRisk) : (realFillPrice + realRisk));
            const tpPrice = formatPrice(symbol, side === 'long' ? (realFillPrice + (2 * realRisk)) : (realFillPrice - (2 * realRisk)));

            // Envio e Confirmação de Stop Loss (com retry automático)
            let slActive = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await binanceRequest('POST', '/fapi/v1/order', {
                        symbol, side: oppositeSide, type: 'STOP_MARKET', stopPrice: String(slPrice),
                        quantity: String(formattedQty), reduceOnly: 'true',
                        workingType: 'CONTRACT_PRICE'
                    }, apiKey, apiSecret, isTestnet);
                    slActive = true;
                    this.addLog(`🔒 Stop Loss ativo a $${slPrice} (Confirmado)`, 'cyan');
                    break;
                } catch (eSl) {
                    this.addLog(`⚠️ Tentativa ${attempt}/3 de Stop Loss falhou: ${eSl.body?.msg || eSl.message}`, 'yellow');
                    await new Promise(r => setTimeout(r, 500));
                }
            }

            // Envio e Confirmação de Take Profit (com retry automático)
            let tpActive = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await binanceRequest('POST', '/fapi/v1/order', {
                        symbol, side: oppositeSide, type: 'TAKE_PROFIT_MARKET', stopPrice: String(tpPrice),
                        quantity: String(formattedQty), reduceOnly: 'true',
                        workingType: 'CONTRACT_PRICE'
                    }, apiKey, apiSecret, isTestnet);
                    tpActive = true;
                    this.addLog(`🎯 Take Profit ativo a $${tpPrice} (Confirmado - Risco: $${realRisk.toFixed(2)})`, 'cyan');
                    break;
                } catch (eTp) {
                    this.addLog(`⚠️ Tentativa ${attempt}/3 de Take Profit falhou: ${eTp.body?.msg || eTp.message}`, 'yellow');
                    await new Promise(r => setTimeout(r, 500));
                }
            }

            // Sistema de Emergência: Se o Stop Loss não puder ser colocado, encerra posição a mercado
            if (!slActive) {
                this.addLog(`🚨 EMERGÊNCIA: Não foi possível fixar Stop Loss na corretora! Fechando posição imediatamente por segurança...`, 'red');
                try {
                    await binanceRequest('POST', '/fapi/v1/order', {
                        symbol, side: oppositeSide, type: 'MARKET', quantity: String(formattedQty), reduceOnly: 'true'
                    }, apiKey, apiSecret, isTestnet);
                } catch (eExit) { }
                return;
            }

            this.state.position = side;
            this.state.entryPrice = realFillPrice;
            this.state.stopLoss = Number(slPrice);
            this.state.takeProfit = Number(tpPrice);
            this.state.trades++;

            syncFirebase("historico_trader", {
                bot: "ZENITH — RSI + MACD",
                tipo: "LIVE_TRADE",
                ambiente: isTestnet ? "TESTNET" : "PRODUCAO",
                symbol: symbol,
                side: orderSide,
                entryPrice: realFillPrice,
                stopLoss: Number(slPrice),
                takeProfit: Number(tpPrice),
                status: "IN_POSITION"
            });

        } catch (err) {
            this.addLog(`❌ Erro na execução do trade: ${err.body?.msg || err.message || JSON.stringify(err)}`, 'red');
        }
    }

    // Monitoramento 1x por segundo para cancelar ordens órfãs quando posição encerra
    startPositionMonitor() {
        if (this.posInterval) clearInterval(this.posInterval);
        this.posInterval = setInterval(async () => {
            if (!this.state.running || !this.state.apiKey || !this.state.apiSecret || this.isCheckingPosition) return;
            this.isCheckingPosition = true;

            try {
                const isTestnet = this.state.environment === 'testnet';
                const posList = await binanceRequest('GET', '/fapi/v2/positionRisk', { symbol: this.state.symbol }, this.state.apiKey, this.state.apiSecret, isTestnet);
                const pos = Array.isArray(posList) ? posList.find(p => p.symbol === this.state.symbol) : null;

                if (!pos || parseFloat(pos.positionAmt) === 0) {
                    if (this.state.position !== null) {
                        this.addLog('🔒 Posição encerrada na corretora! Cancelando ordens restantes...', 'yellow');

                        // Cancela ordens restantes de SL/TP (apenas endpoint válido)
                        try {
                            await binanceRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol: this.state.symbol }, this.state.apiKey, this.state.apiSecret, isTestnet);
                        } catch (e) { }

                        this.state.position = null;
                        this.state.entryPrice = 0;
                        this.state.stopLoss = 0;
                        this.state.takeProfit = 0;
                    }
                } else {
                    const posAmt = parseFloat(pos.positionAmt);
                    this.state.position = posAmt > 0 ? 'long' : 'short';
                    this.state.entryPrice = parseFloat(pos.entryPrice);

                    // Consulta ordens abertas na Binance para recuperar Stop Loss e Take Profit reais
                    try {
                        let slPrice = this.state.stopLoss || 0;
                        let tpPrice = this.state.takeProfit || 0;

                        const stdOrders = await binanceRequest('GET', '/fapi/v1/openOrders', { symbol: this.state.symbol }, this.state.apiKey, this.state.apiSecret, isTestnet);
                        const orders = Array.isArray(stdOrders) ? [...stdOrders] : [];

                        try {
                            const algoRes = await binanceRequest('GET', '/fapi/v1/openAlgoOrders', { symbol: this.state.symbol }, this.state.apiKey, this.state.apiSecret, isTestnet);
                            if (Array.isArray(algoRes)) orders.push(...algoRes);
                            else if (algoRes && Array.isArray(algoRes.orders)) orders.push(...algoRes.orders);
                        } catch (eAlgo) { }

                        for (const o of orders) {
                            const type = (o.type || o.orderType || '').toUpperCase();
                            const algoType = (o.algoType || '').toUpperCase();
                            if (type.includes('STOP') || algoType === 'CONDITIONAL') {
                                const p = parseFloat(o.triggerPrice || o.stopPrice || o.price);
                                if (p > 0) slPrice = p;
                            } else if (type.includes('LIMIT') || type.includes('TAKE_PROFIT')) {
                                const p = parseFloat(o.price || o.triggerPrice || o.stopPrice);
                                if (p > 0) tpPrice = p;
                            }
                        }

                        if (slPrice > 0) this.state.stopLoss = slPrice;
                        if (tpPrice > 0) this.state.takeProfit = tpPrice;
                    } catch (eOrd) { }
                }
            } catch (e) { } finally {
                this.isCheckingPosition = false;
            }
        }, 1000);
    }

    getStatus() {
        return {
            ...this.state,
            candlesCount: this.candles.length
        };
    }
}

// Instância global do motor no backend
const botEngine = new BotEngine();

module.exports = {
    botEngine
};
