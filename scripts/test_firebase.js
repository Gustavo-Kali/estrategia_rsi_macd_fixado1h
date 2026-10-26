const https = require('https');

const PROJECT_ID = "air-trader-futures";
const API_KEY = "AIzaSyDtkchu5tjcV7LTGUOR-NJM_UWxXfkV2Jc";

async function testFirestore() {
    console.log("============================================================");
    console.log("   TESTANDO COMUNICAÇÃO COM O FIREBASE CLOUD FIRESTORE");
    console.log(`   Projeto: ${PROJECT_ID}`);
    console.log("============================================================");

    const docData = {
        fields: {
            bot: { stringValue: "BOT 1 - RSI + MACD" },
            symbol: { stringValue: "BTCUSDT" },
            interval: { stringValue: "30m" },
            rentabilidade: { doubleValue: 145.2 },
            winRate: { doubleValue: 68.5 },
            totalTrades: { integerValue: "320" },
            lucroUsdt: { doubleValue: 4520.50 },
            status: { stringValue: "TESTE_SUCESSO" },
            dataRegistro: { stringValue: new Date().toISOString() }
        }
    };

    const postData = JSON.stringify(docData);

    const options = {
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/historico_trader?key=${API_KEY}`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            console.log(`Status HTTP: ${res.statusCode}`);
            try {
                const json = JSON.parse(body);
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log("\n✅ CONEXÃO COM O FIREBASE REALIZADA COM SUCESSO!");
                    console.log("✅ Coleção 'historico_trader' criada no Firestore com o primeiro documento!");
                    console.log("Documento criado:", json.name);
                } else {
                    console.error("\n❌ ERRO DO FIREBASE:", json);
                }
            } catch (e) {
                console.error("Resposta bruta:", body);
            }
        });
    });

    req.on('error', (e) => {
        console.error("❌ Erro de requisição:", e.message);
    });

    req.write(postData);
    req.end();
}

testFirestore();
