/* ============================================================
   app.js — Bootstrapper: inicializa tudo após o DOM carregar
   Os módulos em js/ são carregados pelo HTML antes deste arquivo.
   ============================================================ */

window.addEventListener('DOMContentLoaded', () => {
    // 1. Restaura visual ativo do time frame e par selecionados
    if (state.interval) {
        document.querySelectorAll('[data-interval]').forEach(b => {
            b.classList.toggle('active', b.dataset.interval === state.interval);
        });
    }
    if (state.symbol) {
        document.querySelectorAll('.sym-btn').forEach(b => b.classList.remove('active'));
        const activeSymBtn = document.getElementById('sym-' + state.symbol);
        if (activeSymBtn) activeSymBtn.classList.add('active');
        const sel = document.getElementById('select-symbol');
        if (sel) sel.value = state.symbol;
    }

    // 2. Gráficos
    initCharts();

    // 3. Painéis drag/resize
    initPanels();

    // 4. Dados históricos e WebSocket
    fetchHistoricalData();

    // 5. Credenciais e ambiente
    loadCredentials();

    // 6. Botões de intervalo de tempo
    document.querySelectorAll('[data-interval]').forEach(btn => {
        btn.addEventListener('click', e => {
            document.querySelectorAll('[data-interval]').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            state.interval = e.target.dataset.interval;
            localStorage.setItem('bot_selected_interval', state.interval);
            localStorage.setItem('bot_interval', state.interval);
            // Limpa cache do backtest ao mudar intervalo
            bt.allCandles = [];
            bt.loadedInterval = null;
            fetchHistoricalData();
        });
    });

    // 6. Resize responsivo
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            applyPreset(localStorage.getItem('bot_layout_preset') || 'binance', false);
        }, 200);
    });

    // 7. Log inicial
    botLogAdd('Dashboard inicializado. Selecione o ambiente e configure as chaves de API.', 'cyan');
});