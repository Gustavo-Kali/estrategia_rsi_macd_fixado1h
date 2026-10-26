/* ============================================================
   js/state.js — Estados globais e constantes
   ============================================================ */

// Pares de futuros suportados (com suporte local e fallback API Binance)
const SUPPORTED_SYMBOLS = [
    'BTCUSDT',
    'ETHUSDT',
    'SOLUSDT',
    'BNBUSDT',
    'XRPUSDT',
    'ADAUSDT',
    'DOGEUSDT',
    'AVAXUSDT',
    'LINKUSDT',
    'NEARUSDT',
    'DOTUSDT',
    'SUIUSDT'
];

const state = {
    symbol: localStorage.getItem('bot_selected_symbol') || "BTCUSDT",
    interval: localStorage.getItem('bot_selected_interval') || "30m",
    candles: [],
    ma8: [],
    ma9: [],
    ma96: [],
    ma200: [],
    rsi: [],
    macd: [],
    signal: [],
    ws: null,
    charts: {},
    series: {},
    isHovering: false,
    maVisible: localStorage.getItem('maVisible') !== 'false'
};

const bt = {
    allCandles: [],
    loadedInterval: null,
    loadedSymbol: null,
    cursor: 0,
    candles: [],
    ma8: [], ma9: [], ma96: [], ma200: [], rsi: [], macd: [], signal: [],
    running: false,
    paused: false,
    intervalId: null,
    speed: 20,
    alertBuy: false,
    alertSell: false,
    position: null,
    entryPrice: 0,
    entryIdx: 0,
    stopLoss: 0,
    takeProfit: 0,
    balance: 10000,
    initialBalance: 10000,
    peakBalance: 10000,
    // Custos e Taxas (Binance Futures)
    feeRateTaker: 0.0004, // 0.04% por perna (ordem a mercado / SL / TP)
    feeRateMaker: 0.0002, // 0.02% por perna (ordem limite)
    feesPaid: 0,
    grossPnl: 0,
    netPnl: 0,
    // Gestão de Risco & Drawdown
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    currentDrawdown: 0,
    currentDrawdownPct: 0,
    // Métricas de Trades & Streaks
    trades: 0,
    wins: 0,
    losses: 0,
    maxWin: 0,
    maxLoss: 0,
    grossWinsTotal: 0,
    grossLossesTotal: 0,
    consecutiveWins: 0,
    maxConsecutiveWins: 0,
    consecutiveLosses: 0,
    maxConsecutiveLosses: 0,
    longTrades: 0,
    longWins: 0,
    longLosses: 0,
    shortTrades: 0,
    shortWins: 0,
    shortLosses: 0,
    tradeHistory: [],
    markers: [],
    rsiMarkers: [],
    macdMarkers: [],
    entryPriceLine: null,
    slPriceLine: null,
    tpPriceLine: null,
    // Máquina de estados: estratégia Bollinger 3 Sinais
    bbShortPhase: 0,       // 0=aguardando, 1=S1, 2=S2 (Venda/Short)
    bbLongPhase: 0,        // 0=aguardando, 1=S1, 2=S2 (Compra/Long)
    bbDownDuration: 0,     // candles consecutivos abaixo das MAs 8, 20 e 200
    bbUpDuration: 0        // candles consecutivos acima das MAs 8, 20 e 200
};

const botState = {
    strategy: (typeof window !== 'undefined' && window.PAGE_STRATEGY) ? window.PAGE_STRATEGY : 'rsi_macd',
    running: false,
    trades: 0,
    wins: 0,
    losses: 0,
    sessionPnl: 0,
    position: null,
    entryPrice: 0,
    stopLoss: 0,
    takeProfit: 0,
    environment: 'testnet',
    alertBuy: false,
    alertSell: false,
    markers: [],
    rsiMarkers: [],
    macdMarkers: [],
    entryPriceLine: null,
    slPriceLine: null,
    tpPriceLine: null,
    // Máquina de estados: estratégia Bollinger 3 Sinais
    bbShortPhase: 0,       // 0=aguardando, 1=S1, 2=S2 (Venda/Short)
    bbLongPhase: 0,        // 0=aguardando, 1=S1, 2=S2 (Compra/Long)
    bbDownDuration: 0,     // candles consecutivos abaixo das MAs 8, 20 e 200
    bbUpDuration: 0        // candles consecutivos acima das MAs 8, 20 e 200
};

const API_URL_KLINES = "https://fapi.binance.com/fapi/v1/klines";
const WS_BASE_URL    = "wss://fstream.binance.com/market/ws/";
