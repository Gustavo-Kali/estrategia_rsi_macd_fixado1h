/**
 * js/backtest_tests.js
 * Testes unitários automatizados para o motor de estatísticas do backtest.
 * Pode ser executado diretamente com: node js/backtest_tests.js
 */

const StatsEngine = require('./stats_engine');

function runTest(testName, testFn) {
    try {
        testFn();
        console.log(`✅ TEST PASSED: ${testName}`);
        return true;
    } catch (err) {
        console.error(`❌ TEST FAILED: ${testName}`);
        console.error(err);
        return false;
    }
}

function assertEquals(actual, expected, message = '') {
    if (actual !== expected) {
        throw new Error(`Assert failed: Expected [${expected}], but got [${actual}]. ${message}`);
    }
}

function assertApprox(actual, expected, epsilon = 0.001, message = '') {
    if (Math.abs(actual - expected) > epsilon) {
        throw new Error(`Assert failed: Expected [${expected}] approx (eps ${epsilon}), but got [${actual}]. ${message}`);
    }
}

function assertNotNull(val, message = '') {
    if (val === null || val === undefined) {
        throw new Error(`Assert failed: Value is null or undefined. ${message}`);
    }
}

// --- SUITE DE TESTES ---

// 1. Teste de Estatísticas Fundamentais
runTest('Fundamental Stats Calculation', () => {
    const mockTrades = [
        { netProfit: 150, fees: 5, roi: 1.5, type: 'long' },
        { netProfit: -50, fees: 5, roi: -0.5, type: 'long' },
        { netProfit: 200, fees: 5, roi: 2.0, type: 'short' },
        { netProfit: -100, fees: 5, roi: -1.0, type: 'short' }
    ];
    const initialBalance = 10000;

    const stats = StatsEngine.calculateFundamentalStats(mockTrades, initialBalance);
    assertNotNull(stats);
    assertEquals(stats.total, 4);
    assertEquals(stats.wins, 2);
    assertEquals(stats.losses, 2);
    assertEquals(stats.winRate, 50.0);
    assertEquals(stats.lossRate, 50.0);
    assertEquals(stats.grossProfit, 350);
    assertEquals(stats.grossLoss, 150);
    assertEquals(stats.netProfit, 200);
    assertEquals(stats.totalFees, 20);
    assertApprox(stats.profitFactor, 350 / 150);
    assertApprox(stats.payoffRatio, 175 / 75);
    
    // Expectancy = (0.5 * 175) - (0.5 * 75) = 87.5 - 37.5 = 50.0
    assertApprox(stats.expectancy, 50.0);
});

// 2. Teste de Equity e Drawdowns
runTest('Equity and Drawdown Tracking', () => {
    // Começa com 10000
    // Trade 1: +500 -> 10500 (novo pico)
    // Trade 2: -1000 -> 9500 (drawdown de 1000, ddPct = 9.52%)
    // Trade 3: +800 -> 10300 (ainda abaixo do pico)
    // Trade 4: +600 -> 10900 (novo pico)
    const mockTrades = [
        { netProfit: 500, exitTime: 1718000000 },
        { netProfit: -1000, exitTime: 1718086400 },
        { netProfit: 800, exitTime: 1718172800 },
        { netProfit: 600, exitTime: 1718259200 }
    ];
    const initialBalance = 10000;

    const dd = StatsEngine.calculateEquityAndDrawdowns(mockTrades, initialBalance);
    assertNotNull(dd);
    assertApprox(dd.maxDrawdown, 1000);
    assertApprox(dd.maxDrawdownPct, (1000 / 10500) * 100);
    assertEquals(dd.drawdownCount, 1);
    assertEquals(dd.maxDrawdownDuration, 2); // Trade 2 e 3 debaixo d'água, recuperado no 4
    assertApprox(dd.recoveryFactor, 900 / 1000); // netProfit / maxDrawdown
});

// 3. Teste de Índices Sharpe, Sortino, Calmar reais
runTest('Advanced Risk Ratios', () => {
    // 3 trades em dias sucessivos
    const mockTrades = [
        { netProfit: 100, entryTime: 1718000000, exitTime: 1718086400, roi: 1.0 },
        { netProfit: -50, entryTime: 1718086400, exitTime: 1718172800, roi: -0.5 },
        { netProfit: 150, entryTime: 1718172800, exitTime: 1718259200, roi: 1.5 }
    ];
    const initialBalance = 10000;

    const ratios = StatsEngine.calculateAdvancedRatios(mockTrades, initialBalance, '1d');
    assertNotNull(ratios);
    // Sharpe, Sortino e Calmar devem ser números válidos
    assertEquals(typeof ratios.sharpe, 'number');
    assertEquals(typeof ratios.sortino, 'number');
    assertEquals(typeof ratios.calmar, 'number');
});

// 4. Teste de Intervalo de Confiança Wilson para Win Rate
runTest('Wilson Score Confidence Interval', () => {
    // 70 acertos de 100
    const ci = StatsEngine.calculateWinRateConfidenceInterval(70, 100);
    assertNotNull(ci);
    // Confirma que os limites inferior e superior estão na faixa esperada (ex: ~60% a ~78%)
    assertEquals(ci.lower > 50 && ci.lower < 70, true);
    assertEquals(ci.upper > 70 && ci.upper < 85, true);
});

// 5. Teste t-Student e Autocorrelação
runTest('Hypothesis Testing and Serial Dependency', () => {
    const returns = [10, 12, 9, 11, 10, 12, 10, 11, 9, 11]; // Claramente positivos significativos H0: media = 0 deve rejeitar
    const test = StatsEngine.calculateStudentTTest(returns);
    assertNotNull(test);
    assertEquals(test.pValue < 0.01, true); // Significativo
    assertEquals(test.significant, true);

    const zeroCorr = [1, -1, 1, -1, 1, -1];
    const autocorr = StatsEngine.calculateAutocorrelationLag1(zeroCorr);
    assertEquals(autocorr < 0, true); // Alternância perfeita gera correlação negativa
});

// 6. Teste de Classificação de Evidência
runTest('Evidence Classification Logic', () => {
    const statsPoor = { total: 10, winRate: 90, profitFactor: 5 }; // poucos trades
    const statsGood = { total: 120, winRate: 55, profitFactor: 1.5 };
    const statsExcellent = { total: 350, winRate: 52, profitFactor: 1.6 };

    const ratiosBase = { sharpe: 1.3 };
    const ddBase = { recoveryFactor: 4.0 };

    const poorClass = StatsEngine.classifyEvidence(statsPoor, ratiosBase, ddBase);
    assertEquals(poorClass.level, 'Evidência Insuficiente');

    const goodClass = StatsEngine.classifyEvidence(statsGood, ratiosBase, ddBase);
    assertEquals(goodClass.level, 'Evidência Moderada');

    const excellentClass = StatsEngine.classifyEvidence(statsExcellent, ratiosBase, ddBase);
    assertEquals(excellentClass.level, 'Evidência Robusta');
});

console.log('\n--- TODOS OS TESTES UNITÁRIOS CONCLUÍDOS ---');
