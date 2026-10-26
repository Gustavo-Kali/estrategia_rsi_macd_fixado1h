const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================================
//  CONFIGURAÇÃO — edite aqui os pares e timeframes desejados
// ============================================================

const START_TIME = Date.now() - (3 * 365 * 24 * 60 * 60 * 1000); // 3 anos atrás
const END_TIME   = Date.now();    // até hoje

// Pares de futuros a baixar
const SYMBOLS = [
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
    'SUIUSDT',
    'TRXUSDT',
    'ETCUSDT'
];

// Timeframes a baixar para CADA par
const INTERVALS = ['15m', '30m', '1h', '1d'];

// Pasta de saída (relativa à raiz do projeto)
const DATA_DIR = path.join(__dirname, '..', 'data');

// ============================================================

function fetchKlines(symbol, interval, startTime, limit = 1500) {
    return new Promise((resolve, reject) => {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&limit=${limit}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Erro JSON parse: ' + data));
                    }
                } else {
                    reject(new Error(`Status HTTP ${res.statusCode}: ${data}`));
                }
            });
        }).on('error', reject);
    });
}

async function downloadInterval(symbol, interval) {
    const symbolLower = symbol.toLowerCase();
    const fileName = `${symbolLower}_${interval}_3years.json`;
    const filePath = path.join(DATA_DIR, fileName);

    // Pula se já existir
    if (fs.existsSync(filePath)) {
        const sizeMb = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(2);
        console.log(`\n  ⏭  ${symbol} [${interval}] já existe (${sizeMb} MB) — pulando.`);
        return;
    }

    console.log(`\n  ⬇  ${symbol} [${interval}] -> ${fileName}`);

    let currentStart = START_TIME;
    const allCandles = [];
    const seenTimes = new Set();

    while (currentStart < END_TIME) {
        try {
            const batch = await fetchKlines(symbol, interval, currentStart, 1500);
            if (!batch || batch.length === 0) break;

            for (const c of batch) {
                const tsSec = Math.floor(c[0] / 1000);
                if (!seenTimes.has(tsSec)) {
                    seenTimes.add(tsSec);
                    allCandles.push([
                        tsSec,
                        Math.round(parseFloat(c[1]) * 100) / 100, // open
                        Math.round(parseFloat(c[2]) * 100) / 100, // high
                        Math.round(parseFloat(c[3]) * 100) / 100, // low
                        Math.round(parseFloat(c[4]) * 100) / 100, // close
                        Math.round(parseFloat(c[5]) * 1000) / 1000 // volume
                    ]);
                }
            }

            const lastOpenTime = batch[batch.length - 1][0];
            process.stdout.write(`\r     Coletados: ${allCandles.length} candles (até ${new Date(lastOpenTime).toISOString().slice(0, 10)})`);

            if (batch.length < 1500 || lastOpenTime >= END_TIME) break;
            currentStart = lastOpenTime + 1;

            // Delay para respeitar o rate limit da Binance
            await new Promise(r => setTimeout(r, 60));
        } catch (err) {
            console.error(`\n  ⚠ Erro ao baixar lote [${symbol} ${interval}]: ${err.message}`);
            console.log('  Aguardando 1s e tentando novamente...');
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    allCandles.sort((a, b) => a[0] - b[0]);
    fs.writeFileSync(filePath, JSON.stringify(allCandles));
    const sizeMb = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(2);
    console.log(`\n  ✅ Salvo: ${fileName} — ${allCandles.length} candles (${sizeMb} MB)`);
}

async function main() {
    // Garante que a pasta data/ existe
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    console.log('============================================================');
    console.log(`  DOWNLOAD HISTÓRICO — ${SYMBOLS.length} pares x ${INTERVALS.length} timeframes`);
    console.log(`  Pares:      ${SYMBOLS.join(', ')}`);
    console.log(`  Timeframes: ${INTERVALS.join(', ')}`);
    console.log(`  Saída:      ${DATA_DIR}`);
    console.log('============================================================');

    let totalOk = 0;
    let totalErr = 0;

    for (const symbol of SYMBOLS) {
        console.log(`\n━━━ ${symbol} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        for (const interval of INTERVALS) {
            try {
                await downloadInterval(symbol, interval);
                totalOk++;
            } catch (e) {
                console.error(`\n  ❌ Falha em ${symbol} ${interval}: ${e.message}`);
                totalErr++;
            }
        }
    }

    console.log('\n============================================================');
    console.log(`  CONCLUÍDO — ✅ ${totalOk} arquivos baixados, ❌ ${totalErr} erros`);
    console.log('============================================================');
}

main();
