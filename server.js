const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Motor autônomo 24/7 ZENITH
const { botEngine } = require('./server/bot_engine');
const { serverRunner } = require('./server/server_runner');

const PORT = 8000;
const PUBLIC_DIR = __dirname;

// Helper para fazer requisições à Binance Futures API
function binanceRequest(method, apiPath, params, apiKey, apiSecret, isTestnet) {
    return new Promise((resolve, reject) => {
        const baseUrl = isTestnet ? 'testnet.binancefuture.com' : 'fapi.binance.com';

        // Configura parâmetros básicos obrigatórios
        params.recvWindow = 20000; // Tolerância para atraso de rede
        params.timestamp = Date.now();

        // Constrói a query string
        const queryString = Object.keys(params)
            .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
            .join('&');

        // Calcula a assinatura HMAC-SHA256 com o Secret
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

        console.log(`[Binance Outbound] ${method} https://${baseUrl}${apiPath}`);

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(json);
                    } else {
                        console.error(`[Binance Outbound Error] Status ${res.statusCode}:`, json);
                        reject({ statusCode: res.statusCode, body: json });
                    }
                } catch (e) {
                    console.error(`[Binance JSON Parse Error] Raw response:`, data);
                    reject({ statusCode: res.statusCode, error: 'Erro ao parsear JSON', raw: data });
                }
            });
        });

        req.on('error', (err) => {
            console.error(`[Binance Connection Error]:`, err.message);
            reject({ error: err.message });
        });

        req.end();
    });
}

// Servidor HTTP
const server = http.createServer((req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MBX-APIKEY');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // ─── ZENITH 24/7 BOT CONTROL ENDPOINTS ─────────────────────────────────

    // Inicia o motor do bot no servidor
    if (req.method === 'POST' && req.url === '/api/bot/start') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const config = JSON.parse(body);
                if (!config.apiKey || !config.apiSecret) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'apiKey e apiSecret são obrigatórios.' }));
                    return;
                }
                await botEngine.start(config);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: '🚀 ZENITH Motor 24/7 iniciado no servidor!' }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // Para o motor do bot no servidor
    if (req.method === 'POST' && req.url === '/api/bot/stop') {
        botEngine.stop();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '🛑 ZENITH Motor parado.' }));
        return;
    }

    // Status/state atual do bot (para o frontend sincronizar a tela)
    if (req.method === 'GET' && req.url === '/api/bot/status') {
        const status = botEngine.getStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
        return;
    }

    // ─────────────────────────────────────────────────────────────────────────

    // Endpoint API para consultar posição real e ordens abertas na Binance
    if (req.method === 'POST' && req.url === '/api/position') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const config = JSON.parse(body);
                const { apiKey, apiSecret, testnet, symbol } = config;

                if (!apiKey || !apiSecret || !symbol) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes.' }));
                    return;
                }

                // 1. Consultar Posição Real (positionRisk)
                const posData = await binanceRequest(
                    'GET',
                    '/fapi/v2/positionRisk',
                    { symbol },
                    apiKey,
                    apiSecret,
                    testnet
                );

                // 2. Consultar Ordens Abertas e Algo Orders (openOrders + openAlgoOrders)
                let openOrders = [];
                try {
                    const standardOrders = await binanceRequest(
                        'GET',
                        '/fapi/v1/openOrders',
                        { symbol },
                        apiKey,
                        apiSecret,
                        testnet
                    );
                    if (Array.isArray(standardOrders)) openOrders.push(...standardOrders);
                } catch (e) {
                    console.log('[OpenOrders Info]:', e.body || e);
                }

                try {
                    const algoOrders = await binanceRequest(
                        'GET',
                        '/fapi/v1/openAlgoOrders',
                        { symbol },
                        apiKey,
                        apiSecret,
                        testnet
                    );
                    if (Array.isArray(algoOrders)) openOrders.push(...algoOrders);
                    else if (algoOrders && Array.isArray(algoOrders.orders)) openOrders.push(...algoOrders.orders);
                } catch (e) {
                    // Endpoint pode variar conforme a versão da API da Binance
                }

                const btcPos = Array.isArray(posData) ? posData.find(p => p.symbol === symbol) : null;
                const positionAmt = btcPos ? parseFloat(btcPos.positionAmt) : 0;
                const entryPrice = btcPos ? parseFloat(btcPos.entryPrice) : 0;
                const unRealizedProfit = btcPos ? parseFloat(btcPos.unRealizedProfit) : 0;

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    positionAmt,
                    entryPrice,
                    unRealizedProfit,
                    position: { positionAmt, entryPrice, unRealizedProfit },
                    openOrders
                }));

            } catch (err) {
                console.error('[Position check error]:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Falha ao consultar posição.', detail: err.body || err }));
            }
        });
        return;
    }

    // Endpoint API para consultar ordens abertas (Padrão + Algo Orders)
    if (req.method === 'POST' && (req.url === '/api/openorders' || req.url === '/api/algoorders')) {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const config = JSON.parse(body);
                const { apiKey, apiSecret, testnet, symbol } = config;
                let standardOrders = [];
                let algoOrders = [];

                try {
                    const resStd = await binanceRequest('GET', '/fapi/v1/openOrders', { symbol }, apiKey, apiSecret, testnet);
                    if (Array.isArray(resStd)) standardOrders = resStd;
                } catch (e) {}

                try {
                    const resAlgo = await binanceRequest('GET', '/fapi/v1/openAlgoOrders', { symbol }, apiKey, apiSecret, testnet);
                    if (Array.isArray(resAlgo)) algoOrders = resAlgo;
                    else if (resAlgo && Array.isArray(resAlgo.orders)) algoOrders = resAlgo.orders;
                } catch (e) {}

                const allOrders = [...standardOrders, ...algoOrders];
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, orders: allOrders }));
            } catch (err) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, orders: [] }));
            }
        });
        return;
    }

    // Endpoint API para cancelar todas as ordens abertas
    if (req.method === 'POST' && req.url === '/api/cancel') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const config = JSON.parse(body);
                const { apiKey, apiSecret, testnet, symbol } = config;

                if (!apiKey || !apiSecret || !symbol) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes.' }));
                    return;
                }

                console.log(`\n--- [Cancelamento de Ordens] ${symbol} (Testnet: ${testnet}) ---`);
                let result = null;
                try {
                    result = await binanceRequest(
                        'DELETE',
                        '/fapi/v1/allOpenOrders',
                        { symbol },
                        apiKey,
                        apiSecret,
                        testnet
                    );
                } catch (e) { }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, result }));

            } catch (err) {
                console.error('[Cancel error]:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Falha ao cancelar ordens.', detail: err.body || err }));
            }
        });
        return;
    }

    // Endpoint API para executar as ordens
    if (req.method === 'POST' && req.url === '/api/order') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const config = JSON.parse(body);
                const { apiKey, apiSecret, testnet, symbol, side, quantity, stopLoss, takeProfit, type } = config;

                if (!apiKey || !apiSecret || !symbol || !side || !quantity) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes.' }));
                    return;
                }

                const oppositeSide = side === 'BUY' ? 'SELL' : 'BUY';

                // Caso A: Executar Ordem Única Individual (ex: live_bot enviando um SL ou TP direto)
                if (type && type !== 'MARKET') {
                    console.log(`\n--- [Ordem Única ${type}] ${side} ${quantity} ${symbol} (Testnet: ${testnet}) ---`);
                    const orderParams = {
                        symbol,
                        side,
                        type,
                        quantity: String(quantity)
                    };
                    if (config.stopPrice) orderParams.stopPrice = String(config.stopPrice);
                    if (config.price) orderParams.price = String(config.price);
                    if (config.reduceOnly) orderParams.reduceOnly = 'true';
                    if (config.closePosition) orderParams.closePosition = 'true';
                    if (config.timeInForce) orderParams.timeInForce = config.timeInForce;

                    try {
                        const singleResult = await binanceRequest(
                            'POST',
                            '/fapi/v1/order',
                            orderParams,
                            apiKey,
                            apiSecret,
                            testnet
                        );
                        console.log(`[Ordem Única Sucesso] ID: ${singleResult.orderId}`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, result: singleResult }));
                    } catch (errSingle) {
                        console.error(`[Ordem Única Erro]:`, errSingle.body || errSingle);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Falha ao enviar ordem única.', detail: errSingle.body || errSingle }));
                    }
                    return;
                }

                // Caso B: Ordem Principal MARKET (com cancelamento prévio e Stop Loss / Take Profit acoplados)
                console.log(`\n--- [Ordem Recebida] ${side} ${quantity} ${symbol} (Testnet: ${testnet}) ---`);
                const results = { cancel: null, main: null, stopLoss: null, takeProfit: null };

                // 1. Cancelar todas as ordens abertas existentes do símbolo (para limpar SL/TP antigos)
                try {
                    console.log(`[Passo 1] Cancelando ordens abertas antigas para ${symbol}...`);
                    results.cancel = await binanceRequest(
                        'DELETE',
                        '/fapi/v1/allOpenOrders',
                        { symbol },
                        apiKey,
                        apiSecret,
                        testnet
                    );
                    console.log(`[Passo 1 Sucesso] Ordens padrão limpas.`);
                } catch (err) {
                    console.log(`[Passo 1 Info] Sem ordens abertas padrão para cancelar:`, err.body || err);
                    results.cancel = { info: 'Nenhuma ordem aberta limpa.' };
                }

                try {
                    await binanceRequest('DELETE', '/fapi/v1/algo/allOpenOrders', { symbol }, apiKey, apiSecret, testnet);
                } catch (e) {}
                try {
                    await binanceRequest('DELETE', '/fapi/v1/algoOrders', { symbol }, apiKey, apiSecret, testnet);
                } catch (e) {}

                // Funções auxiliares para formatação de preço e quantidade respeitando o Tick Size da Binance Futures
                function formatPrice(sym, p) {
                    const num = Number(p);
                    if (isNaN(num)) return '0.0';
                    const s = String(sym || '').toUpperCase();
                    if (s.startsWith('BTC')) {
                        // BTC tick size é 0.10 (1 casa decimal)
                        return (Math.round(num * 10) / 10).toFixed(1);
                    } else if (s.startsWith('ETH')) {
                        return (Math.round(num * 100) / 100).toFixed(2);
                    } else {
                        return (Math.round(num * 10) / 10).toFixed(1);
                    }
                }

                function formatQuantity(sym, q) {
                    const num = Number(q);
                    if (isNaN(num)) return '0.001';
                    const s = String(sym || '').toUpperCase();
                    if (s.startsWith('BTC') || s.startsWith('ETH')) {
                        return num.toFixed(3);
                    } else {
                        return num.toFixed(2);
                    }
                }

                const formattedQty = formatQuantity(symbol, quantity);

                // 2. Enviar a ordem de mercado principal (MARKET)
                let realFillPrice = 0;
                try {
                    console.log(`[Passo 2] Enviando ordem principal MARKET ${side} ${formattedQty} ${symbol}...`);
                    results.main = await binanceRequest(
                        'POST',
                        '/fapi/v1/order',
                        {
                            symbol,
                            side,
                            type: 'MARKET',
                            quantity: String(formattedQty)
                        },
                        apiKey,
                        apiSecret,
                        testnet
                    );
                    realFillPrice = parseFloat(results.main.avgPrice || results.main.price || 0);
                    console.log(`[Passo 2 Sucesso] Ordem executada: ID ${results.main.orderId} a $${realFillPrice}`);
                } catch (err) {
                    console.error(`[Passo 2 Falha] Erro na ordem principal:`, err);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Falha ao colocar ordem principal.', detail: err.body || err }));
                    return;
                }

                // 3. Stop Loss via Binance Futures Algo Order API (algoType=CONDITIONAL)
                let finalSl = stopLoss;
                if (stopLoss && Number(stopLoss) > 0) {
                    const slPrice = formatPrice(symbol, stopLoss);
                    finalSl = Number(slPrice);
                    console.log(`[Passo 3] Enviando Stop Loss a $${slPrice}...`);
                    let slSuccess = false;

                    const slAttempts = [
                        // Tentativa 3A: AlgoOrder CONDITIONAL com triggerPrice e quantity
                        {
                            path: '/fapi/v1/algoOrder',
                            params: {
                                algoType: 'CONDITIONAL',
                                symbol,
                                side: oppositeSide,
                                type: 'STOP_MARKET',
                                triggerPrice: String(slPrice),
                                quantity: String(formattedQty),
                                reduceOnly: 'true'
                            }
                        },
                        // Tentativa 3B: AlgoOrder CONDITIONAL com triggerPrice e closePosition=true
                        {
                            path: '/fapi/v1/algoOrder',
                            params: {
                                algoType: 'CONDITIONAL',
                                symbol,
                                side: oppositeSide,
                                type: 'STOP_MARKET',
                                triggerPrice: String(slPrice),
                                closePosition: 'true'
                            }
                        },
                        // Tentativa 3C: AlgoOrder CONDITIONAL com stopPrice e quantity
                        {
                            path: '/fapi/v1/algoOrder',
                            params: {
                                algoType: 'CONDITIONAL',
                                symbol,
                                side: oppositeSide,
                                type: 'STOP_MARKET',
                                stopPrice: String(slPrice),
                                quantity: String(formattedQty),
                                reduceOnly: 'true'
                            }
                        },
                        // Tentativa 3D: AlgoOrder CONDITIONAL com stopPrice e closePosition=true
                        {
                            path: '/fapi/v1/algoOrder',
                            params: {
                                algoType: 'CONDITIONAL',
                                symbol,
                                side: oppositeSide,
                                type: 'STOP_MARKET',
                                stopPrice: String(slPrice),
                                closePosition: 'true'
                            }
                        },
                        // Tentativa 3E: Fallback legado para /fapi/v1/order
                        {
                            path: '/fapi/v1/order',
                            params: {
                                symbol,
                                side: oppositeSide,
                                type: 'STOP_MARKET',
                                stopPrice: String(slPrice),
                                quantity: String(formattedQty)
                            }
                        }
                    ];

                    for (let i = 0; i < slAttempts.length; i++) {
                        const item = slAttempts[i];
                        try {
                            console.log(`[Passo 3.T${i + 1}] Enviando SL (${item.params.type}) para ${item.path}...`);
                            results.stopLoss = await binanceRequest(
                                'POST',
                                item.path,
                                item.params,
                                apiKey, apiSecret, testnet
                            );
                            console.log(`[Passo 3 Sucesso!] SL Criado:`, JSON.stringify(results.stopLoss));
                            slSuccess = true;
                            break;
                        } catch (err) {
                            console.log(`[Passo 3.T${i + 1} Falhou]:`, err.body || err.message || err);
                        }
                    }

                    if (!slSuccess) {
                        console.error(`[Passo 3 ERRO FATAL] Não foi possível registrar o Stop Loss na Binance.`);
                        // Trava de Emergência: Não deixa o usuário exposto sem Stop Loss
                        console.log(`[EMERGÊNCIA] Fechando posição imediatamente por falta de proteção SL...`);
                        try {
                            await binanceRequest('POST', '/fapi/v1/order', {
                                symbol, side: oppositeSide, type: 'MARKET', quantity: String(formattedQty), reduceOnly: 'true'
                            }, apiKey, apiSecret, testnet);
                        } catch (eKill) { }
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Ordem cancelada por segurança: Stop Loss não pôde ser ativado na Binance.' }));
                        return;
                    }
                }

                // 4. Recalcular Take Profit com base no preço REAL de execução (respeitando risco real)
                let finalTp = takeProfit;
                if (realFillPrice > 0 && finalSl && Number(finalSl) > 0) {
                    const realRisk = Math.abs(realFillPrice - Number(finalSl));
                    if (side === 'BUY') {
                        finalTp = realFillPrice + (2 * realRisk);
                    } else {
                        finalTp = realFillPrice - (2 * realRisk);
                    }
                    console.log(`[Cálculo 2x Risco Real] Execução: $${realFillPrice} | SL: $${finalSl} | Risco: $${realRisk.toFixed(2)} | TP 2x: $${finalTp.toFixed(2)}`);
                }

                // 5. Take Profit via Binance Futures /fapi/v1/order (LIMIT) e fallback AlgoOrder (TAKE_PROFIT_MARKET)
                if (finalTp && Number(finalTp) > 0) {
                    const tpPrice = formatPrice(symbol, finalTp);
                    console.log(`[Passo 4] Enviando Take Profit a $${tpPrice}...`);
                    let tpSuccess = false;

                    const tpAttempts = [
                        // Tentativa 4A: Padrão LIMIT GTC em /fapi/v1/order com reduceOnly
                        {
                            path: '/fapi/v1/order',
                            params: {
                                symbol,
                                side: oppositeSide,
                                type: 'LIMIT',
                                timeInForce: 'GTC',
                                price: String(tpPrice),
                                quantity: String(formattedQty),
                                reduceOnly: 'true'
                            }
                        },
                        // Tentativa 4B: LIMIT sem reduceOnly
                        {
                            path: '/fapi/v1/order',
                            params: {
                                symbol,
                                side: oppositeSide,
                                type: 'LIMIT',
                                timeInForce: 'GTC',
                                price: String(tpPrice),
                                quantity: String(formattedQty)
                            }
                        },
                        // Tentativa 4C: AlgoOrder CONDITIONAL com TAKE_PROFIT_MARKET e triggerPrice
                        {
                            path: '/fapi/v1/algoOrder',
                            params: {
                                algoType: 'CONDITIONAL',
                                symbol,
                                side: oppositeSide,
                                type: 'TAKE_PROFIT_MARKET',
                                triggerPrice: String(tpPrice),
                                quantity: String(formattedQty),
                                reduceOnly: 'true'
                            }
                        },
                        // Tentativa 4D: AlgoOrder CONDITIONAL com TAKE_PROFIT_MARKET e closePosition=true
                        {
                            path: '/fapi/v1/algoOrder',
                            params: {
                                algoType: 'CONDITIONAL',
                                symbol,
                                side: oppositeSide,
                                type: 'TAKE_PROFIT_MARKET',
                                triggerPrice: String(tpPrice),
                                closePosition: 'true'
                            }
                        }
                    ];

                    for (let i = 0; i < tpAttempts.length; i++) {
                        const item = tpAttempts[i];
                        try {
                            console.log(`[Passo 4.T${i + 1}] Enviando TP (${item.params.type}) para ${item.path}...`);
                            results.takeProfit = await binanceRequest(
                                'POST',
                                item.path,
                                item.params,
                                apiKey, apiSecret, testnet
                            );
                            console.log(`[Passo 4 Sucesso!] TP Criado:`, JSON.stringify(results.takeProfit));
                            tpSuccess = true;
                            break;
                        } catch (err) {
                            console.log(`[Passo 4.T${i + 1} Falhou]:`, err.body || err.message || err);
                        }
                    }

                    if (!tpSuccess) {
                        console.error(`[Passo 4 ERRO FATAL] Não foi possível registrar o Take Profit na Binance.`);
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    results,
                    realFillPrice: realFillPrice || Number(results.main?.avgPrice || 0),
                    stopLoss: finalSl,
                    takeProfit: finalTp
                }));

            } catch (err) {
                console.error('[Internal server error]:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Erro interno no servidor backend.', message: err.message }));
            }
        });
        return;
    }

    // Servir arquivos estáticos do dashboard
    // Remove query string do URL antes de resolver o caminho (evita ?id=... virar nome de arquivo)
    const _parsedUrl = new URL(req.url, 'http://localhost');
    const _cleanPath = _parsedUrl.pathname;
    let filePath = path.join(PUBLIC_DIR, _cleanPath === '/' ? 'index.html' : _cleanPath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Acesso proibido.');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Arquivo nao encontrado.');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.parquet': 'application/octet-stream'
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`============================================================`);
    console.log(`   ⚡ ZENITH AI TRADING BOT — SERVIDOR ONLINE`);
    console.log(`   🌐 Dashboard:  http://127.0.0.1:${PORT}`);
    console.log(`   🤖 Bot Engine: http://127.0.0.1:${PORT}/api/bot/status`);
    console.log(`   📁 Arquivos:   ${PUBLIC_DIR}`);
    console.log(`============================================================`);

    // Inicializa o runner autônomo de monitoramento
    serverRunner.init().catch(err => {
        console.error("[Server Runner Error]:", err);
    });
});
