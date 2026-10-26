/* ============================================================
   results.js — Área de Resultados Históricos e Real-Time
   Usa window.FirebaseSync.subscribeToHistorico() para monitorar
   dados em tempo real com filtros temporais móveis.
   ============================================================ */

let _resultsAllData = [];
let _resultsCurrentFilter = 'all';
let _resultsPeriodDays = '90'; // Padrão: 3 meses (90 dias)
let _resultsUnsubscribe = null;

// ── Aguarda FirebaseSync estar disponível ──────────────────────────────────
function waitForFirebase(cb, tries = 0) {
    if (window.FirebaseSync && typeof window.FirebaseSync.subscribeToHistorico === 'function') {
        cb();
    } else if (tries < 30) {
        setTimeout(() => waitForFirebase(cb, tries + 1), 200);
    } else {
        console.warn('[Results] FirebaseSync não disponível após 6s.');
    }
}

// ── Abre o modal e inicia o Listener em Tempo Real ─────────────────────────
function openResultsModal() {
    const modal = document.getElementById('results-modal');
    if (!modal) return;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Restaura filtros padrão
    _resultsCurrentFilter = 'all';
    _resultsPeriodDays = '90';

    // Alinha botões de filtro na interface
    document.querySelectorAll('.res-filter-btn').forEach(b => b.classList.remove('active'));
    const allBtn = document.getElementById('filter-all');
    if (allBtn) allBtn.classList.add('active');

    // Restaura o seletor de período para "Últimos 3 meses"
    const periodSelect = document.getElementById('select-results-period');
    if (periodSelect) periodSelect.value = '90';
    
    const periodWrap = document.getElementById('results-period-wrap');
    if (periodWrap) periodWrap.style.display = 'inline-flex';

    // Inicia a escuta em tempo real do Firebase
    _resultsAllData = [];
    waitForFirebase(() => loadResultsData());
}

// ── Fecha o modal e desconecta o Listener ──────────────────────────────────
function closeResultsModal() {
    const modal = document.getElementById('results-modal');
    if (!modal) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';

    // Desconecta o monitoramento em tempo real para economizar banda/processamento
    if (_resultsUnsubscribe) {
        _resultsUnsubscribe();
        _resultsUnsubscribe = null;
        console.log('🔌 [Results] Monitoramento em tempo real desconectado.');
    }
}

// ── Clique no fundo fecha o modal ──────────────────────────────────────────
function handleResultsModalBgClick(e) {
    if (e.target.id === 'results-modal') closeResultsModal();
}

// ── Altera o Período de Corte Dinâmico (Ao Vivo) ───────────────────────────
function changeResultsPeriod(days) {
    _resultsPeriodDays = days;
    updateResultsUI();
}

// ── Aplica filtro por Tipo (Todos / Backtest / Ao Vivo) ────────────────────
function applyResultsFilter(tipo, btnEl) {
    _resultsCurrentFilter = tipo;
    document.querySelectorAll('.res-filter-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');

    // Oculta o seletor de período temporário se for apenas Backtest
    const periodWrap = document.getElementById('results-period-wrap');
    if (periodWrap) {
        periodWrap.style.display = (tipo === 'BACKTEST') ? 'none' : 'inline-flex';
    }

    updateResultsUI();
}

// ── Carrega dados em Tempo Real ─────────────────────────────────────────────
async function loadResultsData() {
    const loadingEl = document.getElementById('results-loading');
    const emptyEl   = document.getElementById('results-empty');
    const tableEl   = document.getElementById('results-table');
    const summaryEl = document.getElementById('results-summary');

    if (loadingEl) {
        loadingEl.style.display = 'flex';
        loadingEl.innerHTML = '<div class="res-spinner"></div><span>Conectando ao Firebase em tempo real...</span>';
    }
    if (emptyEl)   emptyEl.style.display   = 'none';
    if (tableEl)   tableEl.style.display   = 'none';
    if (summaryEl) summaryEl.style.display  = 'none';

    try {
        if (_resultsUnsubscribe) _resultsUnsubscribe();

        // Inscreve no FirebaseSync para atualizações instantâneas
        _resultsUnsubscribe = window.FirebaseSync.subscribeToHistorico((rows) => {
            console.log(`📊 [Results] Sincronizado Firebase: ${rows.length} operações carregadas.`);
            
            _resultsAllData = rows.map(r => ({
                id: r.id,
                tipo: r.tipo || 'BACKTEST',
                symbol: r.symbol || 'BTCUSDT',
                interval: r.interval || '---',
                pnl: r.lucroUsdt ?? r.profit ?? 0,
                winRate: r.winRate ?? null,
                trades: r.totalTrades ?? null,
                wins: r.vitorias ?? 0,
                losses: r.derrotas ?? 0,
                startDate: r.startDate || null,
                endDate: r.endDate || null,
                timestamp: r.timestamp?.toDate?.() || (r.timestamp?.seconds ? new Date(r.timestamp.seconds * 1000) : null),
                ambiente: r.ambiente || null,
                side: r.side || null,
                entryPrice: r.entryPrice || null,
                exitPrice: r.exitPrice || null,
                feesPaid: r.feesPaid || 0,
                maxDrawdownPct: r.maxDrawdownPct || 0,
                profitFactor: r.profitFactor || 0,
                sharpeRatio: r.sharpeRatio || 0,
                maxWin: r.maxWin || 0,
                maxLoss: r.maxLoss || 0
            }));

            if (loadingEl) loadingEl.style.display = 'none';

            // Atualiza UI com os novos dados
            updateResultsUI();
        }, 100);

    } catch (err) {
        console.error('[Results] Erro ao carregar dados:', err);
        if (loadingEl) loadingEl.style.display = 'none';
        if (emptyEl) {
            emptyEl.innerHTML = `⚠️ Erro ao conectar ao Firebase.<br><small>${err.message}</small>`;
            emptyEl.style.display = 'flex';
        }
    }
}

// ── Atualiza a Interface Filtrada ──────────────────────────────────────────
function updateResultsUI() {
    const emptyEl = document.getElementById('results-empty');
    const tableEl = document.getElementById('results-table');
    const summaryEl = document.getElementById('results-summary');

    // 1. Filtra por tipo (Todos / Backtest / Ao Vivo)
    let filtered = _resultsCurrentFilter === 'all'
        ? _resultsAllData
        : _resultsAllData.filter(r => r.tipo === _resultsCurrentFilter);

    // 2. Filtra por período móvel apenas se não for exclusivamente Backtest
    if (_resultsCurrentFilter !== 'BACKTEST' && _resultsPeriodDays !== 'all') {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - Number(_resultsPeriodDays));

        filtered = filtered.filter(r => {
            // Backtests são poupados do filtro de dias para não sumirem do consolidado
            if (r.tipo === 'BACKTEST') return true;

            // Filtra operações ao vivo
            if (r.timestamp) {
                return r.timestamp >= cutoffDate;
            }
            return false;
        });
    }

    if (filtered.length === 0) {
        if (tableEl) tableEl.style.display = 'none';
        if (summaryEl) summaryEl.style.display = 'none';
        if (emptyEl) {
            emptyEl.innerHTML = `📋 Nenhum registro correspondente encontrado para este filtro/período.`;
            emptyEl.style.display = 'flex';
        }
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    // 3. Renderiza os blocos
    renderAccumulatedResults(filtered);
    renderResultsTable(filtered);
}

// ── Renderiza o Sumário de Resultados Acumulados ───────────────────────────
function renderAccumulatedResults(filteredData) {
    const grid = document.getElementById('res-summary-grid');
    const pairsContainer = document.getElementById('res-summary-pairs');
    const summaryEl = document.getElementById('results-summary');
    const titleEl = document.querySelector('.res-summary-title');
    if (!grid || !pairsContainer) return;

    // Filtra apenas registros operacionais válidos
    if (filteredData.length === 0) {
        if (summaryEl) summaryEl.style.display = 'none';
        return;
    }
    if (summaryEl) summaryEl.style.display = 'block';

    let totalPnl = 0;
    let totalTrades = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let totalFees = 0;
    let maxDD = 0;

    // Agrupamento por símbolo (par) para estatísticas por moeda
    const pairStats = {};

    filteredData.forEach(r => {
        const pnlVal = Number(r.pnl || 0);
        totalPnl += pnlVal;
        totalTrades += Number(r.trades || 1); // Operação individual live conta como 1 trade
        totalWins += Number(r.wins || (pnlVal > 0 ? 1 : 0));
        totalLosses += Number(r.losses || (pnlVal < 0 ? 1 : 0));
        totalFees += Number(r.feesPaid || 0);
        
        const ddPct = Number(r.maxDrawdownPct || 0);
        if (ddPct > maxDD) maxDD = ddPct;

        const sym = r.symbol || 'BTCUSDT';
        if (!pairStats[sym]) {
            pairStats[sym] = {
                symbol: sym,
                pnl: 0,
                trades: 0,
                wins: 0,
                losses: 0
            };
        }
        pairStats[sym].pnl += pnlVal;
        pairStats[sym].trades += Number(r.trades || 1);
        pairStats[sym].wins += Number(r.wins || (pnlVal > 0 ? 1 : 0));
        pairStats[sym].losses += Number(r.losses || (pnlVal < 0 ? 1 : 0));
    });

    const fmt = (v, d = 2) => (v != null ? Number(v).toFixed(d) : '---');
    const fmtD = (v) => v != null ? (Number(v) >= 0 ? '+$' : '-$') + Math.abs(Number(v)).toFixed(2) : '---';
    const pnlCls = totalPnl >= 0 ? 'green' : 'red';
    const ddCls  = maxDD > 15 ? 'red' : maxDD > 5 ? 'cyan' : 'green';

    const overallWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    const pairCount = Object.keys(pairStats).length || 1;
    const overallPnlPct = (totalPnl / (10000 * pairCount)) * 100; // Média estimada de rentabilidade sobre $10k iniciais por moeda

    // Atualiza o título dinamicamente
    if (titleEl) {
        if (_resultsCurrentFilter === 'BACKTEST') {
            titleEl.innerHTML = `&#127942; RESULTADO ACUMULADO (BACKTEST)`;
        } else if (_resultsCurrentFilter === 'LIVE_TRADE') {
            const periodText = _resultsPeriodDays === 'all' ? 'TODO O HISTÓRICO' : `ÚLTIMOS ${_resultsPeriodDays} DIAS`;
            titleEl.innerHTML = `&#9889; RESULTADO ACUMULADO (AO VIVO - ${periodText})`;
        } else {
            const periodText = _resultsPeriodDays === 'all' ? 'TODO O HISTÓRICO' : `ÚLTIMOS ${_resultsPeriodDays} DIAS`;
            titleEl.innerHTML = `&#128202; RESULTADO ACUMULADO (GERAL - ${periodText})`;
        }
    }

    // Renderiza cartões globais
    const cards = [
        { lbl: 'P&L Acumulado',  val: fmtD(totalPnl),                                          cls: pnlCls },
        { lbl: 'Rentabilidade',  val: (overallPnlPct >= 0 ? '+' : '') + fmt(overallPnlPct) + '%', cls: pnlCls },
        { lbl: 'Win Rate Geral', val: fmt(overallWinRate, 1) + '%',                            cls: 'cyan' },
        { lbl: 'Total Operações',val: totalTrades,                                             cls: '' },
        { lbl: 'Max Drawdown',   val: '-' + fmt(maxDD) + '%',                                   cls: ddCls },
        { lbl: 'Total Taxas',    val: '-$' + fmt(totalFees),                                   cls: 'red' },
    ];

    grid.innerHTML = cards.map(c => `
        <div class="res-summary-card">
            <span class="card-lbl">${c.lbl}</span>
            <span class="card-val ${c.cls}">${c.val}</span>
        </div>
    `).join('');

    // Renderiza lista de pares
    const pairsList = Object.values(pairStats);
    pairsContainer.innerHTML = pairsList.map(p => {
        const pairPnlCls = p.pnl >= 0 ? 'res-pnl-pos' : 'res-pnl-neg';
        const pairPnlTxt = (p.pnl >= 0 ? '+' : '-') + '$' + Math.abs(p.pnl).toFixed(2);
        const pairWinRate = p.trades > 0 ? ((p.wins / p.trades) * 100).toFixed(1) + '%' : '0.0%';

        return `
            <div class="res-pair-row" onclick="openPairStats('${p.symbol}')" style="cursor: pointer;">
                <div class="res-pair-info">
                    <span class="res-pair-name">${p.symbol}</span>
                    <span class="res-pair-details">${p.trades} ops &bull; ${pairWinRate} Win Rate</span>
                </div>
                <span class="res-pair-pnl ${pairPnlCls}">${pairPnlTxt}</span>
            </div>
        `;
    }).join('');
}

// ── Tabela de histórico ────────────────────────────────────────────────────
function renderResultsTable(filteredData) {
    const tbody   = document.getElementById('results-tbody');
    const tableEl = document.getElementById('results-table');
    const emptyEl = document.getElementById('results-empty');
    if (!tbody || !tableEl || !emptyEl) return;

    tableEl.style.display = 'table';
    emptyEl.style.display = 'none';

    const fmtDate = (d) => {
        if (!d) return '---';
        if (d instanceof Date && !isNaN(d)) {
            return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }
        return String(d);
    };

    tbody.innerHTML = filteredData.map(r => {
        const isBacktest = r.tipo === 'BACKTEST';
        const typeBadge  = isBacktest
            ? `<span class="res-type-badge backtest">🧪 Backtest</span>`
            : `<span class="res-type-badge live">⚡ Ao Vivo${r.ambiente ? ' · ' + r.ambiente : ''}</span>`;

        const pnl    = Number(r.pnl);
        const pnlTxt = (pnl >= 0 ? '+$' : '-$') + Math.abs(pnl).toFixed(2);
        const pnlCls = pnl >= 0 ? 'res-pnl-pos' : 'res-pnl-neg';
        const winRate = r.winRate != null ? Number(r.winRate).toFixed(1) + '%' : '---';
        const trades  = r.trades  != null ? r.trades : '---';

        let periodo = '---';
        if (isBacktest && r.startDate && r.endDate) {
            periodo = `${r.startDate} → ${r.endDate}`;
        } else if (!isBacktest && r.side) {
            const ep = r.entryPrice ? `$${Number(r.entryPrice).toFixed(0)}` : '---';
            const xp = r.exitPrice  ? `$${Number(r.exitPrice).toFixed(0)}`  : 'aberta';
            periodo = `${r.side === 'long' ? '▲ Long' : '▼ Short'} ${ep}→${xp}`;
        }

        return `<tr onclick="if('${r.id}' === 'bot_doc_fallback') { openPairStats('${r.symbol}'); } else { window.open('/pages/stats.html?id=${r.id}', '_blank'); }" style="cursor: pointer;">
            <td>${typeBadge}</td>
            <td><strong>${r.symbol || '---'}</strong>${r.interval && r.interval !== '---' ? ` <span style="color:rgba(255,255,255,0.3);font-size:0.7rem;">${r.interval}</span>` : ''}</td>
            <td style="font-size:0.72rem;color:rgba(255,255,255,0.5);">${periodo}</td>
            <td class="${pnlCls}">${pnlTxt}</td>
            <td>${winRate}</td>
            <td>${trades}</td>
            <td style="font-size:0.72rem;color:rgba(255,255,255,0.4);">${fmtDate(r.timestamp)}</td>
        </tr>`;
    }).join('');
}

// ── Abre a página de estatísticas para o par clicado ───────────────────────
function openPairStats(symbol) {
    // Tenta encontrar o último backtest completo para este par na lista carregada
    const record = _resultsAllData.find(r => r.symbol === symbol && r.tipo === 'BACKTEST' && r.id !== 'bot_doc_fallback');
    if (record && record.id) {
        window.open(`/pages/stats.html?id=${record.id}`, '_blank');
    } else {
        // Fallback usando o botId atual da tela de backtest
        const botId = typeof btGetBotId === 'function' ? btGetBotId() : 'bot_1_rsi_macd';
        window.open(`/pages/stats.html?botId=${botId}&symbol=${symbol}`, '_blank');
    }
}

// ── ESC fecha o modal ──────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeResultsModal();
});
