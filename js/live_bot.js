/* ============================================================
   js/live_bot.js — Engine do bot ao vivo (execução e polling)
   ============================================================ */

let realPosInterval = null;
let isCheckingPosition = false;

// --- Polling: lê posição, ordens e algo-ordens da corretora a cada 1 segundo ---
async function checkRealPositionFromBinance() {
    if (!botState.running || isCheckingPosition) return;
    isCheckingPosition = true;
    const env = botState.environment;
    let apiKey, apiSecret;
    if (env === 'testnet') {
        apiKey = document.getElementById('bot-api-key-testnet').value.trim();
        apiSecret = document.getElementById('bot-api-secret-testnet').value.trim();
    } else {
        apiKey = document.getElementById('bot-api-key-prod').value.trim();
        apiSecret = document.getElementById('bot-api-secret-prod').value.trim();
    }
    if (!apiKey || !apiSecret) { isCheckingPosition = false; return; }

    try {
        // 1) Posição
        const posRes = await fetch('/api/position', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, apiSecret, testnet: env === 'testnet', symbol: state.symbol })
        });
        if (!posRes.ok) return;
        const posData = await posRes.json();
        const pos = posData.position;

        if (!pos || parseFloat(pos.positionAmt) === 0) {
            // Sem posição aberta
            if (botState.position !== null) {
                botLogAdd('🔒 Posição encerrada na corretora! Cancelando ordens restantes...', 'yellow');

                // Cancelar ordens restantes (evita que o Stop Loss ou Take Profit fique órfão)
                try {
                    fetch('/api/cancel', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ apiKey, apiSecret, testnet: env === 'testnet', symbol: state.symbol })
                    });
                } catch (e) {
                    console.error('Erro ao cancelar ordens órfãs:', e);
                }

                botState.position = null;
                botState.entryPrice = 0;
                botState.stopLoss = 0;
                botState.takeProfit = 0;
                botClearSlTpLines();
                updateBotSessionUI();
            }
            return;
        }

        const posAmt = parseFloat(pos.positionAmt);
        const entryPrice = parseFloat(pos.entryPrice);
        const side = posAmt > 0 ? 'long' : 'short';

        // 2) Ordens abertas (Padrão + Algo Orders da Binance)
        const ordRes = await fetch('/api/openorders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, apiSecret, testnet: env === 'testnet', symbol: state.symbol })
        });
        let slPrice = botState.stopLoss || 0;
        let tpPrice = botState.takeProfit || 0;

        if (ordRes.ok) {
            const ordData = await ordRes.json();
            const orders = Array.isArray(ordData.orders) ? ordData.orders : [];
            for (const o of orders) {
                const type = (o.type || o.orderType || '').toUpperCase();
                const algoType = (o.algoType || '').toUpperCase();

                // Stop Loss: STOP_MARKET ou CONDITIONAL
                if (type.includes('STOP') || algoType === 'CONDITIONAL') {
                    const p = parseFloat(o.triggerPrice || o.stopPrice || o.price);
                    if (p > 0) slPrice = p;
                }
                // Take Profit: LIMIT ou TAKE_PROFIT
                else if (type.includes('LIMIT') || type.includes('TAKE_PROFIT')) {
                    const p = parseFloat(o.price || o.triggerPrice || o.stopPrice);
                    if (p > 0) tpPrice = p;
                }
            }
        }

        // 3) Atualiza estado interno
        botState.position = side;
        botState.entryPrice = entryPrice;
        botState.stopLoss = slPrice;
        botState.takeProfit = tpPrice;

        // 4) Desenha/atualiza linhas tracejadas no gráfico espelhando a Binance
        botClearSlTpLines();
        if (state.series.candles) {
            botState.entryPriceLine = state.series.candles.createPriceLine({
                price: entryPrice, color: side === 'long' ? '#0ecb81' : '#f6465d',
                lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Solid,
                axisLabelVisible: true, title: side === 'long' ? '▲ LONG' : '▼ SHORT'
            });
            if (slPrice > 0) {
                botState.slPriceLine = state.series.candles.createPriceLine({
                    price: slPrice, color: '#f6465d', lineWidth: 1,
                    lineStyle: LightweightCharts.LineStyle.Dashed,
                    axisLabelVisible: true, title: 'SL'
                });
            }
            if (tpPrice > 0) {
                botState.tpPriceLine = state.series.candles.createPriceLine({
                    price: tpPrice, color: '#0ecb81', lineWidth: 1,
                    lineStyle: LightweightCharts.LineStyle.Dashed,
                    axisLabelVisible: true, title: 'TP'
                });
            }
        }
        updateBotSessionUI();
    } catch (err) {
        console.error("Erro ao consultar posição:", err);
    } finally {
        isCheckingPosition = false;
    }
}

// --- Execução de trade real ---
async function executeRealTrade(side, price, qty, closedIdx) {
    const env = botState.environment;
    let apiKey, apiSecret;
    if (env === 'testnet') {
        apiKey = document.getElementById('bot-api-key-testnet').value.trim();
        apiSecret = document.getElementById('bot-api-secret-testnet').value.trim();
    } else {
        apiKey = document.getElementById('bot-api-key-prod').value.trim();
        apiSecret = document.getElementById('bot-api-secret-prod').value.trim();
    }
    if (!apiKey || !apiSecret) { botLogAdd('❌ Credenciais não configuradas.', 'red'); return; }

    const slTp = calculateSlTpByMa9(side, price, state.candles, state.ma9, closedIdx);
    botLogAdd(`📊 SL: $${slTp.sl} | TP (2x Risco): $${slTp.tp} | Risco: $${slTp.risk}`, 'cyan');

    const orderSide = side === 'long' ? 'BUY' : 'SELL';

    // Fechar posição oposta se existir
    if (botState.position && botState.position !== side) {
        try {
            await fetch('/api/order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey, apiSecret, testnet: env === 'testnet', symbol: state.symbol,
                    side: side === 'long' ? 'BUY' : 'SELL',
                    type: 'MARKET', quantity: qty, reduceOnly: true
                })
            });
        } catch (e) { console.error('Erro ao fechar posição oposta:', e); }
    }

    // Ordem principal de entrada com Stop Loss e Take Profit acoplados
    try {
        const res = await fetch('/api/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apiKey, apiSecret, testnet: env === 'testnet', symbol: state.symbol,
                side: orderSide, type: 'MARKET', quantity: qty,
                stopLoss: slTp.sl, takeProfit: slTp.tp
            })
        });
        const data = await res.json();
        if (!res.ok || data.error) {
            botLogAdd(`❌ Erro ao abrir ${side.toUpperCase()}: ${data.error || JSON.stringify(data)}`, 'red');
            return;
        }
        const execPrice = Number(data.realFillPrice) > 0 ? Number(data.realFillPrice) : price;
        const actualSl   = Number(data.stopLoss) > 0 ? Number(data.stopLoss) : slTp.sl;
        const actualTp   = Number(data.takeProfit) > 0 ? Number(data.takeProfit) : slTp.tp;

        botLogAdd(`✅ ${side.toUpperCase()} aberto! Preço: $${execPrice.toFixed(2)}, Qty: ${qty}`, 'green');
        if (actualSl > 0) botLogAdd(`🔒 Stop Loss enviado: $${actualSl.toFixed(2)} (1 USDT do pivô)`, 'cyan');
        if (actualTp > 0) botLogAdd(`🎯 Take Profit enviado: $${actualTp.toFixed(2)} (2x risco exato)`, 'cyan');
        botState.position = side;
        botState.entryPrice = execPrice;
        botState.stopLoss = actualSl;
        botState.takeProfit = actualTp;
        botState.trades++;

        // Desenha as linhas tracejadas imediatamente no gráfico
        botClearSlTpLines();
        if (state.series.candles) {
            botState.entryPriceLine = state.series.candles.createPriceLine({
                price: execPrice, color: side === 'long' ? '#0ecb81' : '#f6465d',
                lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Solid,
                axisLabelVisible: true, title: side === 'long' ? '▲ LONG' : '▼ SHORT'
            });
            if (actualSl > 0) {
                botState.slPriceLine = state.series.candles.createPriceLine({
                    price: actualSl, color: '#f6465d', lineWidth: 1,
                    lineStyle: LightweightCharts.LineStyle.Dashed,
                    axisLabelVisible: true, title: 'SL'
                });
            }
            if (actualTp > 0) {
                botState.tpPriceLine = state.series.candles.createPriceLine({
                    price: actualTp, color: '#0ecb81', lineWidth: 1,
                    lineStyle: LightweightCharts.LineStyle.Dashed,
                    axisLabelVisible: true, title: 'TP'
                });
            }
        }

        // Sincronizar trade aberto com Firebase
        if (window.FirebaseSync && typeof window.FirebaseSync.saveLiveTrade === 'function') {
            window.FirebaseSync.saveLiveTrade({
                status: 'IN_POSITION',
                ambiente: env === 'testnet' ? 'TESTNET' : 'PRODUCAO',
                symbol: state.symbol || 'BTCUSDT',
                side: side.toUpperCase(),
                entryPrice: execPrice,
                stopLoss: actualSl,
                takeProfit: actualTp,
                tradesCount: botState.trades,
                sessionPnl: botState.sessionPnl,
                position: side.toUpperCase()
            });
        }

        updateBotSessionUI();
    } catch (err) {
        botLogAdd(`❌ Exceção ao executar trade: ${err.message}`, 'red');
    }
}

// --- Processar novo candle fechado: verificar sinais ao vivo ---
function processNewCandle(ci) {
    if (ci < 3) return;
    const closedIdx = ci - 1;
    const prevIdx = ci - 2;
    const closedCandle = state.candles[closedIdx];
    const prevCandle = state.candles[prevIdx];
    const qty = parseFloat(document.getElementById('bot-qty').value) || 0.002;

    const isTrendStrategy = (window.PAGE_STRATEGY === 'trend_sma');
    const isBollingerStrategy = (window.PAGE_STRATEGY === 'bollinger_bands');

    if (isBollingerStrategy) {
        if (!state.bbLower || !state.bbUpper || !state.ma8 || !state.ma200) return;

        const sma8Cur    = state.ma8[closedIdx];
        const sma20Cur   = state.ma9[closedIdx];   // ma9 = bbMiddle = SMA 20
        const sma8Prev   = state.ma8[prevIdx];
        const sma20Prev  = state.ma9[prevIdx];
        const sma200Cur  = state.ma200[closedIdx];
        const bbUpperCur = state.bbUpper[closedIdx];
        const bbLowerCur = state.bbLower[closedIdx];

        if (sma8Cur === null || sma20Cur === null || sma200Cur === null || bbUpperCur === null || bbLowerCur === null) return;
        if (sma8Prev === null || sma20Prev === null) return;

        // ─── Mínimo de candles para 2h de tendência, por timeframe ─────────
        const tfMap = { '1m':120, '3m':40, '5m':24, '15m':8, '30m':4, '1h':2, '4h':1, '1d':1, '1w':1 };
        const minDurationCandles = tfMap[state.interval] || 8;

        // ==========================================
        // 📉 STRATEGY: SHORT (VENDA)
        // ==========================================

        // FASE 0: acumulando tendência de baixa
        if (botState.bbShortPhase === 0) {
            // MAs alinhadas para baixa + preço abaixo da MA20
            const isDownTrend = sma8Cur < sma20Cur
                             && sma20Cur < sma200Cur
                             && closedCandle.close < sma20Cur;

            if (isDownTrend) {
                botState.bbDownDuration++;
            } else {
                botState.bbDownDuration = 0;
            }

            if (botState.bbDownDuration === minDurationCandles) {
                botState.bbShortPhase = 1;
                botState.markers.push({
                    time: closedCandle.time,
                    position: 'aboveBar',
                    color: '#f0b90b',
                    shape: 'arrowDown',
                    text: '🟡 S1 Short',
                    size: 2
                });
                state.series.candles.setMarkers(botState.markers);
                botLogAdd(`🟡 S1 SHORT: Tendência de baixa confirmada (${minDurationCandles} candles abaixo das MAs 8/20/200)`, 'yellow');
            }

        // FASE 1: aguardando repique na banda superior
        } else if (botState.bbShortPhase === 1) {
            if (closedCandle.close > sma200Cur) {
                botState.bbShortPhase = 0;
                botState.bbDownDuration = 0;
                botLogAdd(`⚠️ S1 Short invalidado: preço subiu acima da SMA200`, 'yellow');
            } else {
                // Checa se tocou a banda superior nos últimos 3 candles
                let touchedUpperRecent = false;
                for (let j = 0; j < 3; j++) {
                    const idx = closedIdx - j;
                    if (idx >= 0 && state.candles[idx] && state.bbUpper[idx] !== null) {
                        if (state.candles[idx].high >= state.bbUpper[idx]) {
                            touchedUpperRecent = true;
                            break;
                        }
                    }
                }

                const priceAboveMa20 = closedCandle.close > sma20Cur;
                const ma8AboveMa20   = sma8Cur > sma20Cur;
                const belowMa200     = closedCandle.close < sma200Cur;

                if (priceAboveMa20 && ma8AboveMa20 && touchedUpperRecent && belowMa200) {
                    botState.bbShortPhase = 2;
                    botState.markers.push({
                        time: closedCandle.time,
                        position: 'aboveBar',
                        color: '#ff7700',
                        shape: 'arrowDown',
                        text: '🟠 S2 Short',
                        size: 2
                    });
                    state.series.candles.setMarkers(botState.markers);
                    botLogAdd(`🟠 S2 SHORT: Preço+MA8 acima da MA20, repique na Banda Sup detectado.`, 'orange');
                }
            }

        // FASE 2: aguardando cruzamento abaixo da MA20 para SHORT
        } else if (botState.bbShortPhase === 2) {
            if (closedCandle.close > sma200Cur) {
                botState.bbShortPhase = 0;
                botState.bbDownDuration = 0;
                botLogAdd(`⚠️ S2 Short invalidado: preço subiu acima da SMA200`, 'yellow');
            } else {
                const priceBelowMa20 = closedCandle.close < sma20Cur;
                const ma8BelowMa20   = sma8Cur < sma20Cur;

                if (priceBelowMa20 && ma8BelowMa20 && botState.position !== 'short') {
                    botState.bbShortPhase = 0;
                    botState.bbDownDuration = 0;
                    botState.markers.push({
                        time: closedCandle.time,
                        position: 'aboveBar',
                        color: '#f6465d',
                        shape: 'arrowDown',
                        text: '🔴 VENDA',
                        size: 2
                    });
                    state.series.candles.setMarkers(botState.markers);
                    botLogAdd(`🔴 S3 SHORT: Preço+MA8 cruzaram MA20 pra baixo. Executando VENDA SHORT...`, 'red');
                    executeRealTrade('short', closedCandle.close, qty, closedIdx);
                }
            }
        }

        // ==========================================
        // 📈 STRATEGY: LONG (COMPRA)
        // ==========================================

        // FASE 0: acumulando tendência de alta
        if (botState.bbLongPhase === 0) {
            // MAs alinhadas para alta + preço acima da MA20
            const isUpTrend = sma8Cur > sma20Cur
                           && sma20Cur > sma200Cur
                           && closedCandle.close > sma20Cur;

            if (isUpTrend) {
                botState.bbUpDuration++;
            } else {
                botState.bbUpDuration = 0;
            }

            if (botState.bbUpDuration === minDurationCandles) {
                botState.bbLongPhase = 1;
                botState.markers.push({
                    time: closedCandle.time,
                    position: 'belowBar',
                    color: '#f0b90b',
                    shape: 'arrowUp',
                    text: '🟡 S1 Long',
                    size: 2
                });
                state.series.candles.setMarkers(botState.markers);
                botLogAdd(`🟡 S1 LONG: Tendência de alta confirmada (${minDurationCandles} candles acima das MAs 8/20/200)`, 'yellow');
            }

        // FASE 1: aguardando repique na banda inferior
        } else if (botState.bbLongPhase === 1) {
            if (closedCandle.close < sma200Cur) {
                botState.bbLongPhase = 0;
                botState.bbUpDuration = 0;
                botLogAdd(`⚠️ S1 Long invalidado: preço caiu abaixo da SMA200`, 'yellow');
            } else {
                // Checa se tocou a banda inferior nos últimos 3 candles
                let touchedLowerRecent = false;
                for (let j = 0; j < 3; j++) {
                    const idx = closedIdx - j;
                    if (idx >= 0 && state.candles[idx] && state.bbLower[idx] !== null) {
                        if (state.candles[idx].low <= state.bbLower[idx]) {
                            touchedLowerRecent = true;
                            break;
                        }
                    }
                }

                const priceBelowMa20 = closedCandle.close < sma20Cur;
                const ma8BelowMa20   = sma8Cur < sma20Cur;
                const aboveMa200     = closedCandle.close > sma200Cur;

                if (priceBelowMa20 && ma8BelowMa20 && touchedLowerRecent && aboveMa200) {
                    botState.bbLongPhase = 2;
                    botState.markers.push({
                        time: closedCandle.time,
                        position: 'belowBar',
                        color: '#ff7700',
                        shape: 'arrowUp',
                        text: '🟠 S2 Long',
                        size: 2
                    });
                    state.series.candles.setMarkers(botState.markers);
                    botLogAdd(`🟠 S2 LONG: Preço+MA8 abaixo da MA20, repique na Banda Inf detectado.`, 'orange');
                }
            }

        // FASE 2: aguardando fechamento acima da MA20 para LONG
        } else if (botState.bbLongPhase === 2) {
            if (closedCandle.close < sma200Cur) {
                botState.bbLongPhase = 0;
                botState.bbUpDuration = 0;
                botLogAdd(`⚠️ S2 Long invalidado: preço caiu abaixo da SMA200`, 'yellow');
            } else {
                const priceAboveMa20 = closedCandle.close > sma20Cur;
                const ma8AboveMa20   = sma8Cur > sma20Cur;

                if (priceAboveMa20 && ma8AboveMa20 && botState.position !== 'long') {
                    botState.bbLongPhase = 0;
                    botState.bbUpDuration = 0;
                    botState.markers.push({
                        time: closedCandle.time,
                        position: 'belowBar',
                        color: '#0ecb81',
                        shape: 'arrowUp',
                        text: '🟢 COMPRA',
                        size: 2
                    });
                    state.series.candles.setMarkers(botState.markers);
                    botLogAdd(`🟢 S3 LONG: Preço+MA8 cruzaram MA20 pra cima. Executando COMPRA LONG...`, 'green');
                    executeRealTrade('long', closedCandle.close, qty, closedIdx);
                }
            }
        }
    } else if (isTrendStrategy) {
        if (!state.ma8 || !state.ma9 || !state.ma96 || !state.rsi) return;
        const sma8Prev  = state.ma8[prevIdx],  sma8Cur  = state.ma8[closedIdx];
        const sma20Prev = state.ma9[prevIdx],  sma20Cur = state.ma9[closedIdx];
        const sma50Prev = state.ma96[prevIdx], sma50Cur = state.ma96[closedIdx];
        const rsiCur    = state.rsi[closedIdx];

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
            botState.trendUpDuration = (botState.trendUpDuration || 0) + 1;
        } else if (sma8Prev < sma20Prev && sma8Prev > sma50Prev && sma20Prev > sma50Prev) {
            // 2. Pullback válido (após ter tendência prévia estabelecida por >= 3h)
            if ((botState.trendUpDuration || 0) >= minTrendCandles) {
                botState.validPullbackBuy = true;
            }
        } else if (sma8Prev < sma50Prev || sma20Prev < sma50Prev) {
            botState.trendUpDuration = 0;
            botState.validPullbackBuy = false;
        }

        if (isTrendDown) {
            botState.trendDownDuration = (botState.trendDownDuration || 0) + 1;
        } else if (sma8Prev > sma20Prev && sma8Prev < sma50Prev && sma20Prev < sma50Prev) {
            // 2. Pullback de venda válido
            if ((botState.trendDownDuration || 0) >= minTrendCandles) {
                botState.validPullbackSell = true;
            }
        } else if (sma8Prev > sma50Prev || sma20Prev > sma50Prev) {
            botState.trendDownDuration = 0;
            botState.validPullbackSell = false;
        }

        // 3. Gatilho de Retomada: Preço e SMA 8 fecham acima da SMA 20
        const buySignal  = botState.validPullbackBuy  && (sma8Cur > sma20Cur) && (closedCandle.close > sma20Cur) && (sma20Cur > sma50Cur) && (rsiCur >= 50);
        const sellSignal = botState.validPullbackSell && (sma8Cur < sma20Cur) && (closedCandle.close < sma20Cur) && (sma20Cur < sma50Cur) && (rsiCur <= 50);

        if (buySignal && botState.position !== 'long') {
            botState.validPullbackBuy = false;
            botState.trendUpDuration = 0;
            botLogAdd(`📈 Sinal ORION: Retomada de Alta pós Pullback (SMA 8/20/50 + RSI=${fmt(rsiCur)})`, 'green');
            executeRealTrade('long', closedCandle.close, qty, closedIdx);
        } else if (sellSignal && botState.position !== 'short') {
            botState.validPullbackSell = false;
            botState.trendDownDuration = 0;
            botLogAdd(`📉 Sinal ORION: Retomada de Baixa pós Pullback (SMA 8/20/50 + RSI=${fmt(rsiCur)})`, 'red');
            executeRealTrade('short', closedCandle.close, qty, closedIdx);
        }

    } else {
        // ZENITH (RSI + MACD)
        const rsiPrev = state.rsi[prevIdx];
        const macdPrev = state.macd[prevIdx];
        const sigPrev = state.signal[prevIdx];
        const macdCur = state.macd[closedIdx];
        const sigCur = state.signal[closedIdx];
        const rsiCur = state.rsi[closedIdx];

        if (rsiPrev === null || macdPrev === null || sigPrev === null || macdCur === null || sigCur === null) return;

        // Gatilho RSI
        if ((rsiCur < 30 || rsiPrev < 30) && !botState.alertBuy) {
            botState.alertBuy = true; botState.alertSell = false;
            botState.rsiMarkers.push({ time: closedCandle.time, position: 'belowBar', color: '#0ecb81', shape: 'arrowUp', text: 'RSI < 30', size: 1 });
            if (state.series.rsi) { try { state.series.rsi.setMarkers(botState.rsiMarkers); } catch (e) { } }
            botLogAdd(`⚠️ Gatilho RSI: Sobrevenda (RSI=${fmt(rsiCur)}). Aguardando MACD...`, 'green');
        }
        if ((rsiCur > 70 || rsiPrev > 70) && !botState.alertSell) {
            botState.alertSell = true; botState.alertBuy = false;
            botState.rsiMarkers.push({ time: closedCandle.time, position: 'aboveBar', color: '#f6465d', shape: 'arrowDown', text: 'RSI > 70', size: 1 });
            if (state.series.rsi) { try { state.series.rsi.setMarkers(botState.rsiMarkers); } catch (e) { } }
            botLogAdd(`⚠️ Gatilho RSI: Sobrecompra (RSI=${fmt(rsiCur)}). Aguardando MACD...`, 'red');
        }

        // Confirmação MACD
        const crossUp = macdPrev <= sigPrev && macdCur > sigCur;
        const crossDown = macdPrev >= sigPrev && macdCur < sigCur;

        if (botState.alertBuy && crossUp && botState.position !== 'long') {
            executeRealTrade('long', closedCandle.close, qty, closedIdx);
            botState.alertBuy = false; botState.alertSell = false;
            botState.macdMarkers.push({ time: closedCandle.time, position: 'belowBar', color: '#0ecb81', shape: 'arrowUp', text: 'MACD ▲ Entrada', size: 1 });
            if (state.series.macd) { try { state.series.macd.setMarkers(botState.macdMarkers); } catch (e) { } }
        } else if (botState.alertSell && crossDown && botState.position !== 'short') {
            executeRealTrade('short', closedCandle.close, qty, closedIdx);
            botState.alertSell = false; botState.alertBuy = false;
            botState.macdMarkers.push({ time: closedCandle.time, position: 'aboveBar', color: '#f6465d', shape: 'arrowDown', text: 'MACD ▼ Entrada', size: 1 });
            if (state.series.macd) { try { state.series.macd.setMarkers(botState.macdMarkers); } catch (e) { } }
        }
    }
}

// --- Sincronização com o motor do servidor ---
let serverSyncInterval = null;
let _lastSrvPosition  = null;
let _lastSrvEntryPrice = 0;
let _lastSrvStopLoss   = 0;
let _lastSrvTakeProfit = 0;

async function syncWithServerBot() {
    try {
        const res = await fetch('/api/bot/status');
        if (!res.ok) return;
        const srv = await res.json();

        // Sincroniza estado local com o servidor
        botState.running    = srv.running;
        botState.position   = srv.position;
        botState.entryPrice = srv.entryPrice  || 0;
        botState.stopLoss   = srv.stopLoss    || 0;
        botState.takeProfit = srv.takeProfit  || 0;
        botState.trades     = srv.trades      || 0;
        botState.sessionPnl = srv.sessionPnl  || 0;

        // Atualiza badge
        setBotStatusBadge(
            srv.running ? 'running' : 'stopped',
            srv.running ? '● BOT RODANDO NO SERVIDOR' : '● Bot Inativo'
        );

        // Sincroniza apenas os logs NOVOS do servidor
        if (Array.isArray(srv.logs) && srv.logs.length > 0) {
            const topLog = srv.logs[0];
            if (topLog.msg !== botState._lastSrvLog) {
                botState._lastSrvLog = topLog.msg;
                // Descobre quantos logs são novos (até 5)
                const newLogs = [];
                for (const l of srv.logs) {
                    if (l.msg === botState._lastSrvLogPrev) break;
                    newLogs.push(l);
                    if (newLogs.length >= 5) break;
                }
                botState._lastSrvLogPrev = botState._lastSrvLog;
                newLogs.reverse().forEach(l => botLogAdd(`[Servidor] ${l.msg}`, l.type || 'info'));
            }
        }

        // Redesenha as linhas no gráfico se os valores mudaram OU se as linhas ainda não foram desenhadas
        const linesMissing = srv.position && srv.entryPrice > 0 && (
            !botState.entryPriceLine ||
            (srv.stopLoss > 0 && !botState.slPriceLine) ||
            (srv.takeProfit > 0 && !botState.tpPriceLine)
        );

        const posChanged = srv.position   !== _lastSrvPosition
                        || srv.entryPrice !== _lastSrvEntryPrice
                        || srv.stopLoss   !== _lastSrvStopLoss
                        || srv.takeProfit !== _lastSrvTakeProfit;

        if ((posChanged || linesMissing) && state.series.candles) {
            _lastSrvPosition   = srv.position;
            _lastSrvEntryPrice = srv.entryPrice;
            _lastSrvStopLoss   = srv.stopLoss;
            _lastSrvTakeProfit = srv.takeProfit;

            // Limpa linhas antigas
            botClearSlTpLines();

            if (srv.position && srv.entryPrice > 0) {
                const isLong = srv.position === 'long';

                // Linha de Entrada sólida
                botState.entryPriceLine = state.series.candles.createPriceLine({
                    price: srv.entryPrice,
                    color: isLong ? '#0ecb81' : '#f6465d',
                    lineWidth: 2,
                    lineStyle: LightweightCharts.LineStyle.Solid,
                    axisLabelVisible: true,
                    title: isLong ? '▲ LONG' : '▼ SHORT'
                });

                // Linha de Stop Loss tracejada vermelha
                if (srv.stopLoss > 0) {
                    botState.slPriceLine = state.series.candles.createPriceLine({
                        price: srv.stopLoss,
                        color: '#f6465d',
                        lineWidth: 1,
                        lineStyle: LightweightCharts.LineStyle.Dashed,
                        axisLabelVisible: true,
                        title: `SL $${Number(srv.stopLoss).toFixed(1)}`
                    });
                }

                // Linha de Take Profit tracejada verde
                if (srv.takeProfit > 0) {
                    botState.tpPriceLine = state.series.candles.createPriceLine({
                        price: srv.takeProfit,
                        color: '#0ecb81',
                        lineWidth: 1,
                        lineStyle: LightweightCharts.LineStyle.Dashed,
                        axisLabelVisible: true,
                        title: `TP $${Number(srv.takeProfit).toFixed(1)}`
                    });
                }
            }
        } else if (!srv.position && _lastSrvPosition !== null) {
            _lastSrvPosition = null;
            botClearSlTpLines();
        }

        updateBotSessionUI();
    } catch (e) {
        console.error('[syncWithServerBot] Erro:', e);
    }
}

// --- Iniciar / Parar bot (ZENITH 24/7 Server Engine) ---
async function startBot() {
    const env = botState.environment;
    const apiKey = env === 'testnet'
        ? document.getElementById('bot-api-key-testnet').value.trim()
        : document.getElementById('bot-api-key-prod').value.trim();
    const apiSecret = env === 'testnet'
        ? document.getElementById('bot-api-secret-testnet').value.trim()
        : document.getElementById('bot-api-secret-prod').value.trim();

    if (!apiKey || !apiSecret) {
        botLogAdd('❌ Configure as credenciais antes de iniciar.', 'red');
        return;
    }
    saveCredentials();

    botLogAdd('⏳ Iniciando ZENITH no servidor...', 'cyan');

    try {
        const res = await fetch('/api/bot/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apiKey,
                apiSecret,
                environment: env,
                symbol: state.symbol || 'BTCUSDT',
                interval: state.interval || '1m',
                qty: parseFloat(document.getElementById('bot-qty')?.value) || 0.002
            })
        });
        const data = await res.json();
        if (!res.ok) {
            botLogAdd(`❌ Erro ao iniciar: ${data.error}`, 'red');
            return;
        }

        botState.running = true;
        botState.markers = [];
        botState.rsiMarkers = [];
        botState.macdMarkers = [];

        setBotStatusBadge('running', '● BOT RODANDO NO SERVIDOR');
        botLogAdd(`🚀 ZENITH Motor 24/7 iniciado no servidor! (${env.toUpperCase()}) — Você pode navegar livremente.`, 'green');

        const btnStart = document.getElementById('btn-bot-start') || document.getElementById('btn-start-bot');
        const btnStop  = document.getElementById('btn-bot-stop')  || document.getElementById('btn-stop-bot');
        if (btnStart) btnStart.style.display = 'none';
        if (btnStop)  btnStop.style.display  = 'flex';

        // Inicia polling de sincronização com o servidor (1s)
        if (serverSyncInterval) clearInterval(serverSyncInterval);
        serverSyncInterval = setInterval(syncWithServerBot, 1000);

    } catch (err) {
        botLogAdd(`❌ Falha ao contactar servidor: ${err.message}`, 'red');
    }
}

async function stopBot() {
    try {
        await fetch('/api/bot/stop', { method: 'POST' });
    } catch (e) { }

    botState.running = false;
    if (realPosInterval)    { clearInterval(realPosInterval);    realPosInterval    = null; }
    if (serverSyncInterval) { clearInterval(serverSyncInterval); serverSyncInterval = null; }

    botClearSlTpLines();
    setBotStatusBadge('stopped', '● Bot Inativo');
    botLogAdd('🛑 ZENITH Motor parado no servidor.', 'red');

    const btnStart = document.getElementById('btn-bot-start') || document.getElementById('btn-start-bot');
    const btnStop  = document.getElementById('btn-bot-stop')  || document.getElementById('btn-stop-bot');
    if (btnStart) btnStart.style.display = 'flex';
    if (btnStop)  btnStop.style.display  = 'none';
}

// Ao carregar a página, verifica se o bot já está rodando no servidor
// Usa DOMContentLoaded para garantir que todos os elementos HTML já existem
document.addEventListener('DOMContentLoaded', async function checkBotOnPageLoad() {

    // Helper: ativa o botão de timeframe correto
    function restoreInterval(interval) {
        if (!interval) return;
        document.querySelectorAll('[data-interval]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.interval === interval);
        });
        state.interval = interval;
        bt.allCandles = [];
        bt.loadedInterval = null;
        fetchHistoricalData();
    }

    // Helper: restaura a quantidade
    function restoreQty(qty) {
        const qtyEl = document.getElementById('bot-qty');
        if (qtyEl && qty) qtyEl.value = qty;
    }

    // --- 1. Restaura do localStorage imediatamente ---
    const savedQty      = localStorage.getItem('bot_qty');
    const savedInterval = localStorage.getItem('bot_selected_interval') || localStorage.getItem('bot_interval');
    if (savedQty)      restoreQty(savedQty);
    if (savedInterval) restoreInterval(savedInterval);

    // --- 2. Consulta o servidor (fonte da verdade quando o bot está ativo) ---
    try {
        const res = await fetch('/api/bot/status');
        if (!res.ok) return;
        const srv = await res.json();

        if (srv.running) {
            if (srv.qty)      restoreQty(srv.qty);
            if (srv.interval) restoreInterval(srv.interval);
            botState.running = true;
            setBotStatusBadge('running', '● BOT RODANDO NO SERVIDOR');
            botLogAdd(`✅ ZENITH ativo no servidor — ${srv.symbol || 'BTCUSDT'} (${srv.interval || '1m'}) | Qty: ${srv.qty || '?'} BTC | ${(srv.environment || 'testnet').toUpperCase()}`, 'green');

            const btnStart = document.getElementById('btn-bot-start') || document.getElementById('btn-start-bot');
            const btnStop  = document.getElementById('btn-bot-stop')  || document.getElementById('btn-stop-bot');
            if (btnStart) btnStart.style.display = 'none';
            if (btnStop)  btnStop.style.display  = 'flex';

            if (serverSyncInterval) clearInterval(serverSyncInterval);
            serverSyncInterval = setInterval(syncWithServerBot, 1000);
        }
    } catch (e) { }
});
