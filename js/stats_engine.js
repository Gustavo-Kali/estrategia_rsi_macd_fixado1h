/**
 * js/stats_engine.js
 * Motor de cálculos quantitativos, estatísticos e de simulação de Monte Carlo.
 * Utilizado de forma pura pela página stats.html.
 */

const StatsEngine = {
    /**
     * Calcula as métricas fundamentais a partir da lista de trades
     */
    calculateFundamentalStats(trades, initialBalance) {
        if (!trades || trades.length === 0) return null;

        const total = trades.length;
        const wins = trades.filter(t => t.netProfit > 0).length;
        const losses = total - wins;
        const winRate = (wins / total) * 100;
        const lossRate = (losses / total) * 100;

        let grossProfit = 0;
        let grossLoss = 0;
        let netProfit = 0;
        let totalFees = 0;
        let bestTrade = -Infinity;
        let worstTrade = Infinity;

        const netProfits = [];
        const rois = [];

        trades.forEach(t => {
            const np = Number(t.netProfit || 0);
            const fees = Number(t.fees || 0);
            const roi = Number(t.roi || 0);
            
            netProfits.push(np);
            rois.push(roi);
            
            netProfit += np;
            totalFees += fees;

            if (np > 0) {
                grossProfit += np;
            } else {
                grossLoss += Math.abs(np);
            }

            if (np > bestTrade) bestTrade = np;
            if (np < worstTrade) worstTrade = np;
        });

        const avgWin = wins > 0 ? (grossProfit / wins) : 0;
        const avgLoss = losses > 0 ? (grossLoss / losses) : 0;
        const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 99.9 : 0);
        const payoffRatio = avgLoss > 0 ? (avgWin / avgLoss) : (avgWin > 0 ? 99.9 : 0);

        // Expectancy = (WinRate * AvgWin) - (LossRate * AvgLoss)
        const expectancy = total > 0 ? ((wins / total) * avgWin - (losses / total) * avgLoss) : 0;

        // Mediana e desvio padrão
        const sortedProfits = [...netProfits].sort((a, b) => a - b);
        const medianProfit = total % 2 !== 0 
            ? sortedProfits[Math.floor(total / 2)] 
            : (sortedProfits[total / 2 - 1] + sortedProfits[total / 2]) / 2;

        const meanProfit = netProfit / total;
        const variance = netProfits.reduce((sum, val) => sum + Math.pow(val - meanProfit, 2), 0) / Math.max(1, total - 1);
        const stdDev = Math.sqrt(variance);

        return {
            total,
            wins,
            losses,
            winRate,
            lossRate,
            grossProfit,
            grossLoss,
            netProfit,
            totalFees,
            profitFactor,
            payoffRatio,
            expectancy,
            avgWin,
            avgLoss,
            medianProfit,
            stdDev,
            bestTrade,
            worstTrade,
            rois,
            netProfits
        };
    },

    /**
     * Calcula a curva de patrimônio (Equity Curve) e drawdowns detalhados
     */
    calculateEquityAndDrawdowns(trades, initialBalance) {
        let balance = initialBalance;
        let peak = initialBalance;
        let maxDrawdown = 0;
        let maxDrawdownPct = 0;
        let totalDrawdownAmt = 0;
        let drawdownCount = 0;

        const equityCurve = [{ time: 'Início', value: initialBalance, drawdown: 0, drawdownPct: 0 }];
        const drawdowns = [];

        let currentDrawdownStart = null;
        let maxDrawdownDuration = 0; // em número de trades

        trades.forEach((t, i) => {
            balance += Number(t.netProfit || 0);
            
            if (balance > peak) {
                if (currentDrawdownStart !== null) {
                    const duration = i - currentDrawdownStart;
                    if (duration > maxDrawdownDuration) {
                        maxDrawdownDuration = duration;
                    }
                    currentDrawdownStart = null;
                }
                peak = balance;
            } else {
                if (currentDrawdownStart === null) {
                    currentDrawdownStart = i;
                    drawdownCount++;
                }
            }

            const ddAmt = peak - balance;
            const ddPct = (ddAmt / peak) * 100;

            totalDrawdownAmt += ddAmt;

            if (ddAmt > maxDrawdown) maxDrawdown = ddAmt;
            if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

            equityCurve.push({
                time: t.exitTime ? new Date(t.exitTime * 1000).toLocaleDateString('pt-BR') : `Trade ${i+1}`,
                timestamp: t.exitTime,
                value: balance,
                drawdown: ddAmt,
                drawdownPct: ddPct
            });
        });

        // Caso termine no meio de um drawdown
        if (currentDrawdownStart !== null) {
            const duration = trades.length - currentDrawdownStart;
            if (duration > maxDrawdownDuration) {
                maxDrawdownDuration = duration;
            }
        }

        const avgDrawdown = trades.length > 0 ? (totalDrawdownAmt / trades.length) : 0;
        const recoveryFactor = maxDrawdown > 0 ? ((balance - initialBalance) / maxDrawdown) : null;

        return {
            equityCurve,
            maxDrawdown,
            maxDrawdownPct,
            avgDrawdown,
            drawdownCount,
            maxDrawdownDuration, // em trades
            recoveryFactor
        };
    },

    /**
     * Reconstrói a série temporal diária para calcular índices reais de Sharpe, Sortino e Calmar
     */
    calculateAdvancedRatios(trades, initialBalance, interval) {
        if (!trades || trades.length < 2) {
            return { sharpe: 0, sortino: 0, calmar: 0, dailyVol: 0 };
        }

        // Ordena por exitTime
        const sortedTrades = [...trades].sort((a, b) => a.exitTime - b.exitTime);
        const startSecs = Math.min(...sortedTrades.map(t => t.entryTime || t.exitTime));
        const endSecs = Math.max(...sortedTrades.map(t => t.exitTime));

        const msPerDay = 24 * 60 * 60 * 1000;
        const startMs = startSecs * 1000;
        const endMs = endSecs * 1000;

        const dailyBalances = [];
        let currentBalance = initialBalance;
        let currentMs = startMs;
        let tradeIdx = 0;

        // Gera saldo ao final de cada dia
        while (currentMs <= endMs + msPerDay) {
            const dayEndSecs = Math.floor((currentMs + msPerDay) / 1000);
            while (tradeIdx < sortedTrades.length && sortedTrades[tradeIdx].exitTime < dayEndSecs) {
                currentBalance += Number(sortedTrades[tradeIdx].netProfit || 0);
                tradeIdx++;
            }
            dailyBalances.push(currentBalance);
            currentMs += msPerDay;
        }

        // Calcula retornos diários
        const dailyReturns = [];
        for (let i = 1; i < dailyBalances.length; i++) {
            const prev = dailyBalances[i - 1];
            const ret = prev > 0 ? (dailyBalances[i] - prev) / prev : 0;
            dailyReturns.push(ret);
        }

        if (dailyReturns.length < 2) {
            return { sharpe: 0, sortino: 0, calmar: 0, dailyVol: 0 };
        }

        const meanDailyRet = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
        const dailyVar = dailyReturns.reduce((sum, val) => sum + Math.pow(val - meanDailyRet, 2), 0) / (dailyReturns.length - 1);
        const dailyVol = Math.sqrt(dailyVar);

        // Sharpe Anualizado (24/7 Crypto = 365 dias)
        const sharpe = dailyVol > 0 ? (meanDailyRet / dailyVol) * Math.sqrt(365) : 0;

        // Downside Deviation para o Sortino
        const negativeReturns = dailyReturns.filter(r => r < 0);
        const downsideVar = negativeReturns.length > 0 
            ? negativeReturns.reduce((sum, val) => sum + Math.pow(val, 2), 0) / dailyReturns.length
            : 0;
        const downsideVol = Math.sqrt(downsideVar);
        const sortino = downsideVol > 0 ? (meanDailyRet / downsideVol) * Math.sqrt(365) : 0;

        // Calmar
        const totalReturnPct = ((currentBalance - initialBalance) / initialBalance) * 100;
        const peakBalances = [];
        let peak = initialBalance;
        let maxDDPct = 0;
        
        let runningBalance = initialBalance;
        sortedTrades.forEach(t => {
            runningBalance += Number(t.netProfit || 0);
            if (runningBalance > peak) peak = runningBalance;
            const ddPct = peak > 0 ? ((peak - runningBalance) / peak) * 100 : 0;
            if (ddPct > maxDDPct) maxDDPct = ddPct;
        });

        const years = (endSecs - startSecs) / (365 * 24 * 60 * 60);
        const annualizedReturn = years > 0.1 ? (Math.pow(1 + totalReturnPct / 100, 1 / years) - 1) * 100 : totalReturnPct;
        const calmar = maxDDPct > 0 ? (annualizedReturn / maxDDPct) : 0;

        return {
            sharpe: Number(sharpe.toFixed(2)),
            sortino: Number(sortino.toFixed(2)),
            calmar: Number(calmar.toFixed(2)),
            dailyVol: Number((dailyVol * 100).toFixed(2)) // em %
        };
    },

    /**
     * Calcula o intervalo de confiança Wilson 95% para o Win Rate
     */
    calculateWinRateConfidenceInterval(wins, total) {
        if (total === 0) return { lower: 0, upper: 0 };
        const p = wins / total;
        const z = 1.96; // 95% de confiança
        const denominator = 1 + (z * z) / total;
        const center = p + (z * z) / (2 * total);
        const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
        
        const lower = Math.max(0, (center - spread) / denominator) * 100;
        const upper = Math.min(1, (center + spread) / denominator) * 100;

        return {
            lower: Number(lower.toFixed(1)),
            upper: Number(upper.toFixed(1))
        };
    },

    /**
     * Calcula o teste de hipótese t-Student para significância
     */
    calculateStudentTTest(returns) {
        if (!returns || returns.length < 2) {
            return { tStat: 0, pValue: 1, significant: false };
        }
        const n = returns.length;
        const mean = returns.reduce((a, b) => a + b, 0) / n;
        const variance = returns.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (n - 1);
        const stdDev = Math.sqrt(variance);

        if (stdDev === 0) return { tStat: 0, pValue: 1, significant: false };

        const tStat = mean / (stdDev / Math.sqrt(n));

        // Aproximação do p-value usando distribuição normal para n grande
        // z = tStat. Usamos aproximação polinomial para a CDF normal padrão.
        const z = Math.abs(tStat);
        const t = 1 / (1 + 0.2316419 * z);
        const d = 0.3989423 * Math.exp(-z * z / 2);
        const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
        const pValue = 2 * prob; // Bilateral

        return {
            tStat: Number(tStat.toFixed(3)),
            pValue: Number(pValue.toFixed(4)),
            significant: pValue < 0.05
        };
    },

    /**
     * Calcula a autocorrelação lag 1 dos retornos
     */
    calculateAutocorrelationLag1(returns) {
        if (!returns || returns.length < 3) return 0;
        const n = returns.length;
        const mean = returns.reduce((a, b) => a + b, 0) / n;

        let num = 0;
        let den = 0;

        for (let i = 0; i < n; i++) {
            den += Math.pow(returns[i] - mean, 2);
        }

        for (let i = 1; i < n; i++) {
            num += (returns[i] - mean) * (returns[i - 1] - mean);
        }

        return den > 0 ? Number((num / den).toFixed(3)) : 0;
    },

    /**
     * Executa simulações de Monte Carlo (Bootstrap IID)
     */
    runMonteCarloSimulation(rois, initialCapital, iterations = 1000, horizon = 100, equityFloor = 2000, drawdownThreshold = 30) {
        if (!rois || rois.length === 0) return null;

        const results = [];
        let pathsEndingNegative = 0;
        let pathsRuined = 0;
        let pathsExceededDrawdown = 0;

        const allDrawdowns = [];
        const finalBalances = [];

        for (let i = 0; i < iterations; i++) {
            let balance = initialCapital;
            let peak = initialCapital;
            let pathMaxDDPct = 0;
            let ruined = false;

            const path = [initialCapital];

            for (let h = 0; h < horizon; h++) {
                // Sorteia aleatoriamente um ROI com reposição
                const randomIndex = Math.floor(Math.random() * rois.length);
                const roi = rois[randomIndex];
                
                const tradeProfit = balance * (roi / 100);
                balance += tradeProfit;

                if (balance <= equityFloor) {
                    ruined = true;
                }

                if (balance > peak) {
                    peak = balance;
                }

                const ddPct = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
                if (ddPct > pathMaxDDPct) {
                    pathMaxDDPct = ddPct;
                }

                path.push(balance);
            }

            finalBalances.push(balance);
            allDrawdowns.push(pathMaxDDPct);

            if (balance < initialCapital) {
                pathsEndingNegative++;
            }
            if (ruined) {
                pathsRuined++;
            }
            if (pathMaxDDPct >= drawdownThreshold) {
                pathsExceededDrawdown++;
            }

            results.push(path);
        }

        // Calcula os percentis do saldo final
        finalBalances.sort((a, b) => a - b);
        allDrawdowns.sort((a, b) => a - b);

        const getPercentile = (arr, p) => {
            const idx = Math.floor((p / 100) * arr.length);
            return arr[Math.min(idx, arr.length - 1)];
        };

        return {
            probNegativePct: (pathsEndingNegative / iterations) * 100,
            probRuinPct: (pathsRuined / iterations) * 100,
            probExceededDrawdownPct: (pathsExceededDrawdown / iterations) * 100,
            p5: getPercentile(finalBalances, 5),
            p25: getPercentile(finalBalances, 25),
            p50: getPercentile(finalBalances, 50),
            p75: getPercentile(finalBalances, 75),
            p95: getPercentile(finalBalances, 95),
            ddP95: getPercentile(allDrawdowns, 95),
            medianFinalBalance: getPercentile(finalBalances, 50),
            worstPathBalance: finalBalances[0],
            bestPathBalance: finalBalances[finalBalances.length - 1]
        };
    },

    /**
     * Calcula percentis de retornos simples
     */
    calculatePercentiles(values) {
        if (!values || values.length === 0) return {};
        const sorted = [...values].sort((a, b) => a - b);
        const getPct = (p) => {
            const idx = (p / 100) * (sorted.length - 1);
            const low = Math.floor(idx);
            const high = Math.ceil(idx);
            if (low === high) return sorted[low];
            return sorted[low] + (idx - low) * (sorted[high] - sorted[low]);
        };

        return {
            p5: getPct(5),
            p25: getPct(25),
            p50: getPct(50),
            p75: getPct(75),
            p95: getPct(95)
        };
    },

    /**
     * Analisa concentração do lucro
     */
    analyzeProfitConcentration(netProfits) {
        if (!netProfits || netProfits.length === 0) return null;
        
        const totalNetProfit = netProfits.reduce((a, b) => a + b, 0);
        if (totalNetProfit <= 0) return { best1Pct: 0, best5Pct: 0, profitWithoutBest1: 0, profitWithoutBest5: 0, dependencyPct: 0 };

        const sortedWins = netProfits.filter(p => p > 0).sort((a, b) => b - a); // ordem decrescente
        const totalWinsSum = sortedWins.reduce((a, b) => a + b, 0);

        if (totalWinsSum === 0) return { best1Pct: 0, best5Pct: 0, profitWithoutBest1: 0, profitWithoutBest5: 0, dependencyPct: 0 };

        const takeBestSum = (pct) => {
            const count = Math.max(1, Math.round((pct / 100) * netProfits.length));
            return sortedWins.slice(0, count).reduce((a, b) => a + b, 0);
        };

        const best1Sum = takeBestSum(1);
        const best5Sum = takeBestSum(5);

        return {
            best1Pct: (best1Sum / totalWinsSum) * 100,
            best5Pct: (best5Sum / totalWinsSum) * 100,
            profitWithoutBest1: totalNetProfit - best1Sum,
            profitWithoutBest5: totalNetProfit - best5Sum
        };
    },

    /**
     * Segmentação contextual (Long/Short, dia da semana, hora)
     */
    segmentContext(trades) {
        const segments = {
            direction: { LONG: [], SHORT: [] },
            dayOfWeek: { 'Seg': [], 'Ter': [], 'Qua': [], 'Qui': [], 'Sex': [], 'Sáb': [], 'Dom': [] },
            hourOfDay: {}
        };

        // Inicializa horas
        for (let h = 0; h < 24; h++) {
            segments.hourOfDay[String(h).padStart(2, '0')] = [];
        }

        const daysMap = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

        trades.forEach(t => {
            const pnl = Number(t.netProfit || 0);
            
            // Direção
            const dir = String(t.type || '').toUpperCase();
            if (segments.direction[dir]) {
                segments.direction[dir].push(pnl);
            }

            // Tempo
            if (t.entryTime) {
                const date = new Date(t.entryTime * 1000);
                const day = daysMap[date.getDay()];
                const hour = String(date.getHours()).padStart(2, '0');

                if (segments.dayOfWeek[day]) segments.dayOfWeek[day].push(pnl);
                if (segments.hourOfDay[hour]) segments.hourOfDay[hour].push(pnl);
            }
        });

        const summarizeGroup = (arr) => {
            if (arr.length === 0) return { trades: 0, winRate: 0, pf: 0, pnl: 0 };
            const wins = arr.filter(v => v > 0).length;
            const winRate = (wins / arr.length) * 100;
            const grossProfit = arr.filter(v => v > 0).reduce((a, b) => a + b, 0);
            const grossLoss = arr.filter(v => v < 0).reduce((a, b) => a + Math.abs(b), 0);
            const pf = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 99.9 : 0);
            const pnl = arr.reduce((a, b) => a + b, 0);

            return {
                trades: arr.length,
                winRate: Number(winRate.toFixed(1)),
                pf: Number(pf.toFixed(2)),
                pnl: Number(pnl.toFixed(2))
            };
        };

        const result = {
            direction: {},
            dayOfWeek: {},
            hourOfDay: {}
        };

        for (let k in segments.direction) result.direction[k] = summarizeGroup(segments.direction[k]);
        for (let k in segments.dayOfWeek) result.dayOfWeek[k] = summarizeGroup(segments.dayOfWeek[k]);
        for (let k in segments.hourOfDay) result.hourOfDay[k] = summarizeGroup(segments.hourOfDay[k]);

        return result;
    },

    /**
     * Classifica o nível de evidência com base nas métricas
     */
    classifyEvidence(stats, ratios, drawdown) {
        if (!stats || stats.total < 30) {
            return {
                level: 'Evidência Insuficiente',
                color: 'var(--color-red)',
                description: 'A amostra de operações é inferior a 30 trades. Os resultados observados podem ser fruto do acaso e não têm relevância estatística.'
            };
        }

        const tradesCount = stats.total;
        const pf = stats.profitFactor;
        const winRate = stats.winRate;
        const sharpe = ratios.sharpe;

        let level = 'Evidência Limitada';
        let color = '#ff7700'; // laranja
        let desc = 'A estratégia possui um número razoável de operações, mas o fator de lucro, o Sharpe ou o win rate histórico são baixos ou instáveis.';

        if (tradesCount >= 100 && pf >= 1.2 && winRate >= 45 && sharpe >= 0.8) {
            level = 'Evidência Moderada';
            color = 'var(--color-cyan)';
            desc = 'Amostra estatística robusta (>= 100 trades), com consistência histórica comprovada pelo Sharpe e Fator de Lucro.';
        }

        if (tradesCount >= 300 && pf >= 1.4 && winRate >= 48 && sharpe >= 1.2 && drawdown.recoveryFactor >= 3) {
            level = 'Evidência Robusta';
            color = 'var(--color-green)';
            desc = 'Excelente histórico amostral (>= 300 trades) com alto índice de recuperação, consistência anualizada e robustez matemática em diferentes cenários.';
        }

        return { level, color, description: desc };
    }
};

// Disponibiliza no escopo global
if (typeof window !== 'undefined') {
    window.StatsEngine = StatsEngine;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StatsEngine;
}
