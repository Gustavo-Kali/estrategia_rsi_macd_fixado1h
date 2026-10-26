import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getFirestore, 
    doc, 
    setDoc, 
    getDoc, 
    getDocs,
    onSnapshot, 
    collection, 
    addDoc, 
    updateDoc,
    deleteField,
    serverTimestamp,
    query,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Credenciais do Firebase - Projeto: automacao-inteligente-com-ia
const firebaseConfig = {
    apiKey: "AIzaSyAgd4yzIFRSCrb6QI2LSskjMuxraigmwRE",
    authDomain: "automacao-inteligente-com-ia.firebaseapp.com",
    projectId: "automacao-inteligente-com-ia",
    storageBucket: "automacao-inteligente-com-ia.firebasestorage.app",
    messagingSenderId: "724988191950",
    appId: "1:724988191950:web:8cda6520913e8f0b58dc9f"
};

// Inicialização
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export const FirebaseSync = {
    db,

    /**
     * Salva ou atualiza os resultados de Backtest no Firestore
     */
    async saveBacktestResults(data, botId = "bot_1_rsi_macd") {
        try {
            const botRef = doc(db, "bots", botId);
            let botName = "ZENITH — RSI (14) + MACD";
            if (botId === "bot_2_tendencias_medias") {
                botName = "ORION — Tendências Médias Móveis (SMA 20/50 + RSI)";
            } else if (botId === "bot_3_bollinger") {
                botName = "AURA — Bandas de Bollinger (SMA 20)";
            }

            const backtestPayload = {
                symbol: data.symbol || "BTCUSDT",
                interval: data.interval || "30m",
                qtyOperated: data.qtyOperated || 0.002,
                initialBalance: Number((data.initialBalance || 10000).toFixed(2)),
                finalBalance: Number((data.finalBalance || 10000).toFixed(2)),
                // Performance
                pnl: Number((data.pnl || 0).toFixed(2)),
                pnlPct: Number((data.pnlPct || 0).toFixed(2)),
                grossPnl: Number((data.grossPnl || data.pnl || 0).toFixed(2)),
                grossPnlPct: Number((data.grossPnlPct || data.pnlPct || 0).toFixed(2)),
                profitFactor: Number((data.profitFactor || 0).toFixed(2)),
                expectancy: Number((data.expectancy || 0).toFixed(2)),
                // Custos
                feesPaid: Number((data.feesPaid || 0).toFixed(2)),
                feeMaker: data.feeMaker || 0.0002,
                feeTaker: data.feeTaker || 0.0004,
                // Risco
                maxDrawdown: Number((data.maxDrawdown || 0).toFixed(2)),
                maxDrawdownPct: Number((data.maxDrawdownPct || 0).toFixed(2)),
                sharpeRatio: Number((data.sharpeRatio || 0).toFixed(2)),
                sortinoRatio: Number((data.sortinoRatio || 0).toFixed(2)),
                calmarRatio: Number((data.calmarRatio || 0).toFixed(2)),
                // Trades
                trades: data.trades || 0,
                wins: data.wins || 0,
                losses: data.losses || 0,
                winRate: Number((data.winRate || 0).toFixed(1)),
                maxWin: Number((data.maxWin || 0).toFixed(2)),
                maxLoss: Number((data.maxLoss || 0).toFixed(2)),
                avgWin: Number((data.avgWin || 0).toFixed(2)),
                avgLoss: Number((data.avgLoss || 0).toFixed(2)),
                payoffRatio: Number((data.payoffRatio || 0).toFixed(2)),
                maxConsecutiveWins: data.maxConsecutiveWins || 0,
                maxConsecutiveLosses: data.maxConsecutiveLosses || 0,
                longTrades: data.longTrades || 0,
                longWins: data.longWins || 0,
                longLosses: data.longLosses || 0,
                shortTrades: data.shortTrades || 0,
                shortWins: data.shortWins || 0,
                shortLosses: data.shortLosses || 0,
                isPartial: !!data.isPartial,
                updatedAt: new Date().toISOString(),
                startDate: data.startDate || "---",
                endDate: data.endDate || "---",
                // Lista de trades e políticas de execução
                tradeHistory: data.tradeHistory || [],
                sameCandlePolicy: data.sameCandlePolicy || 'sl_priority',
                slippagePct: data.slippagePct || 0
            };

            // 1. Atualiza documento principal do Bot (sempre, para manter progresso)
            await setDoc(botRef, {
                name: botName,
                backtest: backtestPayload,
                lastUpdate: serverTimestamp()
            }, { merge: true });

            // 2. Cria ou atualiza o documento de histórico desde o primeiro trade
            const histPayload = {
                bot: botName,
                botId: botId,
                tipo: "BACKTEST",
                symbol: backtestPayload.symbol,
                interval: backtestPayload.interval,
                rentabilidadePct: backtestPayload.pnlPct,
                lucroUsdt: backtestPayload.pnl,
                winRate: backtestPayload.winRate,
                totalTrades: backtestPayload.trades,
                vitorias: backtestPayload.wins,
                derrotas: backtestPayload.losses,
                saldoFinal: backtestPayload.finalBalance,
                isPartial: backtestPayload.isPartial,
                startDate: backtestPayload.startDate,
                endDate: backtestPayload.endDate,
                feesPaid: backtestPayload.feesPaid || 0,
                maxDrawdownPct: backtestPayload.maxDrawdownPct || 0,
                profitFactor: backtestPayload.profitFactor || 0,
                sharpeRatio: backtestPayload.sharpeRatio || 0,
                sortinoRatio: backtestPayload.sortinoRatio || 0,
                calmarRatio: backtestPayload.calmarRatio || 0,
                maxWin: backtestPayload.maxWin || 0,
                maxLoss: backtestPayload.maxLoss || 0,
                tradesList: backtestPayload.tradeHistory,
                sameCandlePolicy: backtestPayload.sameCandlePolicy,
                slippagePct: backtestPayload.slippagePct,
                timestamp: serverTimestamp()
            };

            let returnedDocId = data.liveDocId || null;

            if (data.liveDocId) {
                // Sessão já existe: atualiza o mesmo documento (não cria um novo)
                const existingRef = doc(db, "historico_trader", data.liveDocId);
                await setDoc(existingRef, histPayload, { merge: true });
                console.log(`🔄 [Firebase] Backtest atualizado em historico_trader/${data.liveDocId} (${backtestPayload.trades} trades)`);
            } else {
                // Primeira chamada da sessão: cria novo documento e captura o ID
                const histRef = collection(db, "historico_trader");
                const newDoc = await addDoc(histRef, histPayload);
                returnedDocId = newDoc.id;
                console.log(`✅ [Firebase] Backtest criado em historico_trader/${returnedDocId} (trade #1)`);
            }

            // Retorna o ID do documento para que backtest.js possa reutilizá-lo
            return returnedDocId;

        } catch (error) {
            console.error("❌ [Firebase] Erro ao salvar backtest:", error);
            return data.liveDocId || null;
        }
    },

    /**
     * Registra um trade real e atualiza os totais ao vivo
     */
    async saveLiveTrade(tradeData, botId = "bot_1_rsi_macd") {
        try {
            const botRef = doc(db, "bots", botId);
            let botName = "ZENITH — RSI (14) + MACD";
            if (botId === "bot_2_tendencias_medias") {
                botName = "ORION — Tendências Médias Móveis (SMA 20/50 + RSI)";
            } else if (botId === "bot_3_bollinger") {
                botName = "AURA — Bandas de Bollinger (SMA 20)";
            }
            
            // 1. Atualiza dados agregados do bot ao vivo
            await setDoc(botRef, {
                name: botName,
                live: {
                    status: tradeData.status || "RUNNING",
                    lastSymbol: tradeData.symbol || "BTCUSDT",
                    sessionPnl: Number(tradeData.sessionPnl || 0),
                    tradesCount: Number(tradeData.tradesCount || 0),
                    wins: Number(tradeData.wins || 0),
                    losses: Number(tradeData.losses || 0),
                    currentPosition: tradeData.position || null,
                    updatedAt: new Date().toISOString()
                },
                lastUpdate: serverTimestamp()
            }, { merge: true });

            // 2. Grava na coleção historico_trader
            const histRef = collection(db, "historico_trader");
            await addDoc(histRef, {
                bot: botName,
                botId: botId,
                tipo: "LIVE_TRADE",
                ambiente: tradeData.ambiente || "TESTNET",
                symbol: tradeData.symbol,
                side: tradeData.side,
                entryPrice: tradeData.entryPrice,
                exitPrice: tradeData.exitPrice || null,
                stopLoss: tradeData.stopLoss || null,
                takeProfit: tradeData.takeProfit || null,
                lucroUsdt: tradeData.profit || 0,
                pnlPct: tradeData.pnlPct || 0,
                status: tradeData.status,
                timestamp: serverTimestamp()
            });

            console.log(`✅ [Firebase] Trade ao vivo (${tradeData.ambiente || 'TESTNET'}) gravado em 'historico_trader' para ${botId}!`);
        } catch (error) {
            console.error("❌ [Firebase] Erro ao sincronizar trade ao vivo:", error);
        }
    },

    /**
     * Escuta em tempo real as métricas do bot (para a página index e dashboards)
     */
    listenToBot(botIdOrCallback, maybeCallback) {
        let botId = "bot_1_rsi_macd";
        let callback = botIdOrCallback;
        if (typeof botIdOrCallback === 'string') {
            botId = botIdOrCallback;
            callback = maybeCallback;
        }

        const botRef = doc(db, "bots", botId);
        return onSnapshot(botRef, (docSnap) => {
            if (docSnap.exists()) {
                if (typeof callback === 'function') callback(docSnap.data());
            } else {
                if (typeof callback === 'function') callback(null);
            }
        }, (error) => {
            console.error(`❌ [Firebase] Erro ao escutar métricas de ${botId}:`, error);
        });
    },

    /**
     * Escuta em tempo real o histórico de backtests e trades ao vivo
     */
    subscribeToHistorico(callback, maxItems = 100) {
        const histRef = collection(db, 'historico_trader');
        const q = query(histRef, orderBy('timestamp', 'desc'), limit(maxItems));
        
        let unsubFallback = null;
        
        const unsubPrimary = onSnapshot(q, (snap) => {
            let rows = [];
            snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
            if (typeof callback === 'function') callback(rows);
        }, (err) => {
            console.warn('[Firebase] Erro no listener ordenado (tentando sem ordenação):', err.message);
            if (typeof unsubPrimary === 'function') unsubPrimary();
            unsubFallback = onSnapshot(histRef, (snap2) => {
                let rows2 = [];
                snap2.forEach(d => rows2.push({ id: d.id, ...d.data() }));
                rows2.sort((a, b) => {
                    const ta = a.timestamp?.toMillis?.() || (a.timestamp?.seconds || 0) * 1000;
                    const tb = b.timestamp?.toMillis?.() || (b.timestamp?.seconds || 0) * 1000;
                    return tb - ta;
                });
                rows2 = rows2.slice(0, maxItems);
                if (typeof callback === 'function') callback(rows2);
            });
        });
        
        return () => {
            if (unsubPrimary) unsubPrimary();
            if (unsubFallback) unsubFallback();
        };
    },

    /**
     * Salva o estado intermediário do backtest no documento do bot
     * Permite retomar de onde parou em qualquer browser/máquina
     */
    async saveBacktestState(botId, stateData) {
        try {
            const botRef = doc(db, "bots", botId);
            await setDoc(botRef, {
                backtestState: {
                    cursor: stateData.cursor,
                    balance: stateData.balance,
                    feesPaid: stateData.feesPaid || 0,
                    maxDrawdown: stateData.maxDrawdown || 0,
                    maxDrawdownPct: stateData.maxDrawdownPct || 0,
                    trades: stateData.trades,
                    wins: stateData.wins,
                    losses: stateData.losses,
                    grossPnl: stateData.grossPnl || 0,
                    netPnl: stateData.netPnl || 0,
                    peakBalance: stateData.peakBalance || 10000,
                    maxWin: stateData.maxWin || 0,
                    maxLoss: stateData.maxLoss || 0,
                    grossWinsTotal: stateData.grossWinsTotal || 0,
                    grossLossesTotal: stateData.grossLossesTotal || 0,
                    consecutiveWins: stateData.consecutiveWins || 0,
                    maxConsecutiveWins: stateData.maxConsecutiveWins || 0,
                    consecutiveLosses: stateData.consecutiveLosses || 0,
                    maxConsecutiveLosses: stateData.maxConsecutiveLosses || 0,
                    longTrades: stateData.longTrades || 0,
                    longWins: stateData.longWins || 0,
                    longLosses: stateData.longLosses || 0,
                    shortTrades: stateData.shortTrades || 0,
                    shortWins: stateData.shortWins || 0,
                    shortLosses: stateData.shortLosses || 0,
                    tradeHistory: stateData.tradeHistory || [],

                    position: stateData.position || null,
                    entryPrice: stateData.entryPrice || 0,
                    entryIdx: stateData.entryIdx || 0,
                    stopLoss: stateData.stopLoss || 0,
                    takeProfit: stateData.takeProfit || 0,
                    alertBuy: stateData.alertBuy || false,
                    alertSell: stateData.alertSell || false,
                    symbol: stateData.symbol,
                    interval: stateData.interval,
                    isPartial: true,
                    savedAt: new Date().toISOString()
                }
            }, { merge: true });
        } catch (error) {
            console.error(`❌ [Firebase] Erro ao salvar estado do backtest (${botId}):`, error);
        }
    },

    /**
     * Carrega o estado intermediário do backtest salvo no Firebase
     * Retorna null se não existir ou for de outro symbol/interval
     */
    async loadBacktestState(botId, symbol, interval) {
        try {
            const botRef = doc(db, "bots", botId);
            const snap = await getDoc(botRef);
            if (!snap.exists()) return null;

            const data = snap.data();
            const saved = data.backtestState;
            if (!saved) return null;

            // Só retoma se for do mesmo par e timeframe
            if (saved.symbol !== symbol || saved.interval !== interval) return null;
            if (!saved.isPartial || saved.cursor <= 0) return null;

            console.log(`✅ [Firebase] Estado do backtest carregado para ${botId}: cursor=${saved.cursor}, trades=${saved.trades}`);
            return saved;
        } catch (error) {
            console.error(`❌ [Firebase] Erro ao carregar estado do backtest (${botId}):`, error);
            return null;
        }
    },

    /**
     * Limpa o estado intermediário do backtest (para reiniciar do zero)
     */
    async clearBacktestState(botId) {
        try {
            const botRef = doc(db, "bots", botId);
            await updateDoc(botRef, {
                backtestState: deleteField()
            });
            console.log(`🗑️ [Firebase] Estado do backtest limpo para ${botId}.`);
        } catch (error) {
            // Se o documento não existe ainda, ignora o erro silenciosamente
            console.warn(`⚠️ [Firebase] Não foi possível limpar backtestState (${botId}):`, error.message);
        }
    },

    /**
     * Funções de Autenticação Firebase
     */
    async loginWithGoogle() {
        const provider = new GoogleAuthProvider();
        return signInWithPopup(auth, provider);
    },

    async login(email, password) {
        return signInWithEmailAndPassword(auth, email, password);
    },

    async register(email, password) {
        return createUserWithEmailAndPassword(auth, email, password);
    },

    async logout() {
        return signOut(auth);
    },

    async resetPassword(email) {
        return sendPasswordResetEmail(auth, email);
    },

    onAuthStateChanged(callback) {
        return onAuthStateChanged(auth, callback);
    },

    getCurrentUser() {
        return auth.currentUser;
    },

    /**
     * Busca o histórico de backtests e trades ao vivo
     * Retorna array de registros ordenados por data (mais recente primeiro)
     */
    async getHistorico(maxItems = 50) {
        try {
            const histRef = collection(db, 'historico_trader');
            let rows = [];
            try {
                const q = query(histRef, orderBy('timestamp', 'desc'), limit(maxItems));
                const snap = await getDocs(q);
                snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
            } catch (idxErr) {
                // Sem índice: busca todos e ordena localmente
                console.warn('[Firebase] Índice não disponível, ordenando localmente:', idxErr.message);
                const snap = await getDocs(histRef);
                snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
                rows.sort((a, b) => {
                    const ta = a.timestamp?.toMillis?.() || (a.timestamp?.seconds || 0) * 1000;
                    const tb = b.timestamp?.toMillis?.() || (b.timestamp?.seconds || 0) * 1000;
                    return tb - ta;
                });
                rows = rows.slice(0, maxItems);
            }

            // Fallback: se historico_trader estiver vazio, tenta pegar do documento do bot
            if (rows.length === 0) {
                console.log('[Firebase] historico_trader vazio, tentando fallback do documento do bot...');
                const botRef = doc(db, 'bots', 'bot_1_rsi_macd');
                const botSnap = await getDoc(botRef);
                if (botSnap.exists()) {
                    const data = botSnap.data();
                    const bt = data.backtest;
                    if (bt && bt.trades > 0) {
                        rows.push({
                            id: 'bot_doc_fallback',
                            tipo: 'BACKTEST',
                            symbol: bt.symbol || 'BTCUSDT',
                            interval: bt.interval || '30m',
                            lucroUsdt: bt.pnl || 0,
                            winRate: bt.winRate || 0,
                            totalTrades: bt.trades || 0,
                            startDate: bt.startDate || '---',
                            endDate: bt.endDate || '---',
                            timestamp: data.lastUpdate || null,
                            isPartial: bt.isPartial || false
                        });
                    }
                }
            }

            return rows;
        } catch (err) {
            console.error('[Firebase] Erro ao buscar histórico:', err);
            return [];
        }
    },

    /**
     * Busca os dados do último backtest do bot (aceita parcial também)
     */
    async getBotBacktest(botId = 'bot_1_rsi_macd') {
        try {
            const botRef = doc(db, 'bots', botId);
            const snap = await getDoc(botRef);
            if (!snap.exists()) return null;
            const data = snap.data();
            const bt = data.backtest;
            if (!bt || !bt.trades || bt.trades === 0) return null;
            return bt; // retorna mesmo se parcial
        } catch (err) {
            console.error('[Firebase] Erro ao buscar backtest do bot:', err);
            return null;
        }
    },

    /**
     * Fase 3: Busca um registro histórico específico por ID
     */
    async getHistoricoById(id) {
        try {
            const docRef = doc(db, "historico_trader", id);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                return { id: snap.id, ...snap.data() };
            }
            return null;
        } catch (error) {
            console.error(`❌ [Firebase] Erro ao buscar registro histórico ${id}:`, error);
            return null;
        }
    }
};

// Disponibiliza globalmente na window
window.FirebaseSync = FirebaseSync;
window.FirebaseAuth  = auth;
