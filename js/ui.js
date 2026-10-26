/* ============================================================
   js/ui.js — Interface, logs, painéis e layouts
   ============================================================ */

function setEl(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function fmt(v) { return v !== null && v !== undefined && !isNaN(v) ? v.toFixed(2) : '---'; }
function getRsiStatus(v) { if (!v || isNaN(v)) return '---'; if (v >= 70) return 'SOBRECOMPRA'; if (v <= 30) return 'SOBREVENDA'; return 'NEUTRO'; }
function getRsiColor(v)  { if (!v || isNaN(v)) return 'text-yellow'; if (v >= 70) return 'text-red'; if (v <= 30) return 'text-green'; return 'text-yellow'; }

function updateStatus(type, text) {
    const dot = document.getElementById('status-dot');
    const lbl = document.getElementById('status-text');
    if (dot) dot.className = `status-dot ${type === 'online' ? 'online' : 'offline'}`;
    if (lbl) lbl.textContent = text;
}

function updateMetricsUI() {
    if (state.candles.length < 2) return;
    const lI = state.candles.length - 1;
    const cI = state.candles.length - 2;
    const cL = state.candles[lI];
    const cC = state.candles[cI];
    const sp = document.getElementById('strip-price');
    if (sp) { sp.textContent = '$' + cL.close.toFixed(2); sp.style.color = cL.close >= cC.close ? 'var(--color-green)' : 'var(--color-red)'; }
    setEl('strip-high',  '$' + cL.high.toFixed(2));
    setEl('strip-low',   '$' + cL.low.toFixed(2));
    setEl('strip-close', '$' + cC.close.toFixed(2));

    const isTrend = (window.PAGE_STRATEGY === 'trend_sma');
    const isBollinger = (window.PAGE_STRATEGY === 'bollinger_bands');

    if (isBollinger) {
        setEl('strip-bb-upper', (state.bbUpper && fmt(state.bbUpper[lI]) !== '---') ? '$' + fmt(state.bbUpper[lI]) : '---');
        setEl('strip-bb-mid',   (state.bbMiddle && fmt(state.bbMiddle[lI]) !== '---') ? '$' + fmt(state.bbMiddle[lI]) : '---');
        setEl('strip-bb-lower', (state.bbLower && fmt(state.bbLower[lI]) !== '---') ? '$' + fmt(state.bbLower[lI]) : '---');
        setEl('strip-ma8',      (state.ma8 && fmt(state.ma8[lI]) !== '---') ? '$' + fmt(state.ma8[lI]) : '---');
        setEl('strip-ma200',    (state.ma200 && fmt(state.ma200[lI]) !== '---') ? '$' + fmt(state.ma200[lI]) : '---');
    } else {
        if (isTrend && state.ma8) {
            setEl('strip-ma8', fmt(state.ma8[lI]) !== '---' ? '$' + fmt(state.ma8[lI]) : '---');
        }
        setEl('strip-ma9',  fmt(state.ma9[lI])  !== '---' ? '$' + fmt(state.ma9[lI]) : '---');
        setEl('strip-ma96', fmt(state.ma96[lI]) !== '---' ? '$' + fmt(state.ma96[lI]) : '---');
    }

    const lm = document.getElementById('legend-main');
    if (lm) {
        if (isBollinger) {
            const upC = state.bbUpper ? fmt(state.bbUpper[cI]) : '---';
            const midC = state.bbMiddle ? fmt(state.bbMiddle[cI]) : '---';
            const lowC = state.bbLower ? fmt(state.bbLower[cI]) : '---';
            const ma8C = state.ma8 ? fmt(state.ma8[cI]) : '---';
            const ma200C = state.ma200 ? fmt(state.ma200[cI]) : '---';

            const upL = state.bbUpper ? fmt(state.bbUpper[lI]) : '---';
            const midL = state.bbMiddle ? fmt(state.bbMiddle[lI]) : '---';
            const lowL = state.bbLower ? fmt(state.bbLower[lI]) : '---';
            const ma8L = state.ma8 ? fmt(state.ma8[lI]) : '---';
            const ma200L = state.ma200 ? fmt(state.ma200[lI]) : '---';

            lm.innerHTML = `<span class="badge-closed">FECHADO</span> Fech: <strong>$${cC.close.toFixed(2)}</strong> | <span class="text-cyan">Sup: $${upC}</span> | <span class="text-yellow">Média (SMA 20): $${midC}</span> | <span class="text-cyan">Inf: $${lowC}</span> | <span style="color:#00ff88;">SMA 8: $${ma8C}</span> | <span style="color:#ff7700;">SMA 200: $${ma200C}</span> &nbsp;&nbsp; <span class="badge-live">LIVE</span> Preço: <strong>$${cL.close.toFixed(2)}</strong> | <span class="text-cyan">Sup: $${upL}</span> | <span class="text-yellow">Média: $${midL}</span> | <span class="text-cyan">Inf: $${lowL}</span> | <span style="color:#00ff88;">SMA 8: $${ma8L}</span> | <span style="color:#ff7700;">SMA 200: $${ma200L}</span>`;
        } else if (isTrend && state.ma8) {
            lm.innerHTML = `<span class="badge-closed">FECHADO</span> Fech: <strong>$${cC.close.toFixed(2)}</strong> | <span style="color:#00ff88;">SMA8: $${fmt(state.ma8[cI])}</span> | <span class="text-cyan">SMA20: $${fmt(state.ma9[cI])}</span> | <span class="text-yellow">SMA50: $${fmt(state.ma96[cI])}</span> &nbsp;&nbsp; <span class="badge-live">LIVE</span> Preço: <strong>$${cL.close.toFixed(2)}</strong> | <span style="color:#00ff88;">SMA8: $${fmt(state.ma8[lI])}</span> | <span class="text-cyan">SMA20: $${fmt(state.ma9[lI])}</span> | <span class="text-yellow">SMA50: $${fmt(state.ma96[lI])}</span>`;
        } else {
            lm.innerHTML = `<span class="badge-closed">FECHADO</span> Fech: <strong>$${cC.close.toFixed(2)}</strong> | <span class="text-cyan">MA9: $${fmt(state.ma9[cI])}</span> | <span class="text-yellow">MA96: $${fmt(state.ma96[cI])}</span> &nbsp;&nbsp; <span class="badge-live">LIVE</span> Preço: <strong>$${cL.close.toFixed(2)}</strong> | <span class="text-cyan">MA9: $${fmt(state.ma9[lI])}</span> | <span class="text-yellow">MA96: $${fmt(state.ma96[lI])}</span>`;
        }
    }
    const lr = document.getElementById('legend-rsi');
    if (lr && state.rsi) lr.innerHTML = `<span class="badge-closed">FECHADO</span> RSI(14): <strong class="${getRsiColor(state.rsi[cI])}">${fmt(state.rsi[cI])}</strong> (${getRsiStatus(state.rsi[cI])}) &nbsp;&nbsp; <span class="badge-live">LIVE</span> RSI(14): <strong class="${getRsiColor(state.rsi[lI])}">${fmt(state.rsi[lI])}</strong> (${getRsiStatus(state.rsi[lI])})`;
    const ld = document.getElementById('legend-macd');
    if (ld && state.macd) ld.innerHTML = `<span class="badge-closed">FECHADO</span> MACD: <strong class="text-white">${fmt(state.macd[cI])}</strong> | Signal: <strong class="text-red">${fmt(state.signal[cI])}</strong> &nbsp;&nbsp; <span class="badge-live">LIVE</span> MACD: <strong class="text-white">${fmt(state.macd[lI])}</strong> | Signal: <strong class="text-red">${fmt(state.signal[lI])}</strong>`;
}

function renderHoverMetrics(candle, ma9, ma96, rsi, macd, signal) {
    if (!candle) return;
    const dt = new Date(candle.time * 1000);
    const ds = dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
    const isTrend2 = (window.PAGE_STRATEGY === 'trend_sma');
    const isBollinger2 = (window.PAGE_STRATEGY === 'bollinger_bands');
    const lm = document.getElementById('legend-main');
    if (lm) {
        if (isBollinger2) {
            const idx = findCandleIndexByTime(candle.time);
            const up = (idx !== -1 && state.bbUpper) ? fmt(state.bbUpper[idx]) : '---';
            const mid = (idx !== -1 && state.bbMiddle) ? fmt(state.bbMiddle[idx]) : '---';
            const low = (idx !== -1 && state.bbLower) ? fmt(state.bbLower[idx]) : '---';
            const ma8val = (idx !== -1 && state.ma8) ? fmt(state.ma8[idx]) : '---';
            const ma200val = (idx !== -1 && state.ma200) ? fmt(state.ma200[idx]) : '---';
            lm.innerHTML = `<span class="badge-inspect">&#128269; [${ds}]</span> Ab: $${candle.open.toFixed(2)} | Máx: $${candle.high.toFixed(2)} | Mín: $${candle.low.toFixed(2)} | Fech: <strong>$${candle.close.toFixed(2)}</strong> | <span class="text-cyan">Sup: $${up}</span> | <span class="text-yellow">Média (SMA 20): $${mid}</span> | <span class="text-cyan">Inf: $${low}</span> | <span style="color:#00ff88;">SMA 8: $${ma8val}</span> | <span style="color:#ff7700;">SMA 200: $${ma200val}</span>`;
        } else if (isTrend2) {
            const idx = findCandleIndexByTime(candle.time);
            const sma8val = (idx !== -1 && state.ma8) ? fmt(state.ma8[idx]) : '---';
            lm.innerHTML = `<span class="badge-inspect">&#128269; [${ds}]</span> Ab: $${candle.open.toFixed(2)} | Máx: $${candle.high.toFixed(2)} | Mín: $${candle.low.toFixed(2)} | Fech: <strong>$${candle.close.toFixed(2)}</strong> | <span style="color:#00ff88;">SMA8: $${sma8val}</span> | <span class="text-cyan">SMA20: $${fmt(ma9)}</span> | <span class="text-yellow">SMA50: $${fmt(ma96)}</span>`;
        } else {
            lm.innerHTML = `<span class="badge-inspect">&#128269; [${ds}]</span> Ab: $${candle.open.toFixed(2)} | Máx: $${candle.high.toFixed(2)} | Mín: $${candle.low.toFixed(2)} | Fech: <strong>$${candle.close.toFixed(2)}</strong> | <span class="text-cyan">MA9: $${fmt(ma9)}</span> | <span class="text-yellow">MA96: $${fmt(ma96)}</span>`;
        }
    }
    const lr = document.getElementById('legend-rsi');
    if (lr && rsi !== null && rsi !== undefined) lr.innerHTML = `<span class="badge-inspect">&#128269;</span> RSI(14): <strong class="${getRsiColor(rsi)}">${fmt(rsi)}</strong> (${getRsiStatus(rsi)})`;
    const ld = document.getElementById('legend-macd');
    if (ld && macd !== null && macd !== undefined) ld.innerHTML = `<span class="badge-inspect">&#128269;</span> MACD: <strong class="text-white">${fmt(macd)}</strong> | Signal: <strong class="text-red">${fmt(signal)}</strong>`;
}

function botLogAdd(msg, type = '') {
    const log = document.getElementById('bot-log');
    if (!log) return;
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `<span class="log-time">${now}</span><span class="log-msg ${type}">${msg}</span>`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    while (log.children.length > 60) log.removeChild(log.firstChild);
}

function toggleVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') { input.type = 'text'; btn.innerHTML = '&#128683;'; }
    else { input.type = 'password'; btn.innerHTML = '&#128065;'; }
}

function selectStrategy(btn) {
    document.querySelectorAll('.strat-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    botState.strategy = btn.dataset.strat;
    botLogAdd(`Estratégia selecionada: ${btn.textContent.trim()}`, 'cyan');
}

function setEnvironment(env) {
    botState.environment = env;
    const btnTestnet    = document.getElementById('btn-env-testnet');
    const btnProd       = document.getElementById('btn-env-production');
    const fieldsTestnet = document.getElementById('fields-testnet');
    const fieldsProd    = document.getElementById('fields-production');
    const apiTitle      = document.getElementById('api-section-title');
    if (!btnTestnet || !btnProd) return;
    if (env === 'testnet') {
        btnTestnet.classList.add('active'); btnProd.classList.remove('active');
        if (fieldsTestnet) fieldsTestnet.style.display = 'block';
        if (fieldsProd)    fieldsProd.style.display    = 'none';
        if (apiTitle)      apiTitle.textContent         = 'Credenciais API (Testnet)';
    } else {
        btnTestnet.classList.remove('active'); btnProd.classList.add('active');
        if (fieldsTestnet) fieldsTestnet.style.display = 'none';
        if (fieldsProd)    fieldsProd.style.display    = 'block';
        if (apiTitle)      apiTitle.textContent         = 'Credenciais API (Produção)';
    }
    localStorage.setItem('bot_environment', env);
    botLogAdd(`Ambiente: ${env === 'testnet' ? 'Binance Testnet' : 'Produção Real'}`, 'cyan');
}

function saveCredentials() {
    localStorage.setItem('bot_api_key_testnet',    document.getElementById('bot-api-key-testnet').value.trim());
    localStorage.setItem('bot_api_secret_testnet', document.getElementById('bot-api-secret-testnet').value.trim());
    localStorage.setItem('bot_api_key_prod',       document.getElementById('bot-api-key-prod').value.trim());
    localStorage.setItem('bot_api_secret_prod',    document.getElementById('bot-api-secret-prod').value.trim());
    // Salva quantidade, par e timeframe
    const qty = document.getElementById('bot-qty');
    if (qty) localStorage.setItem('bot_qty', qty.value);
    if (typeof state !== 'undefined') {
        localStorage.setItem('bot_selected_symbol',   state.symbol   || 'BTCUSDT');
        localStorage.setItem('bot_selected_interval', state.interval || '30m');
    }
}

function loadCredentials() {
    const kt = document.getElementById('bot-api-key-testnet');
    if (kt) {
        kt.value = localStorage.getItem('bot_api_key_testnet') || '';
        document.getElementById('bot-api-secret-testnet').value = localStorage.getItem('bot_api_secret_testnet') || '';
        document.getElementById('bot-api-key-prod').value       = localStorage.getItem('bot_api_key_prod') || '';
        document.getElementById('bot-api-secret-prod').value    = localStorage.getItem('bot_api_secret_prod') || '';
    }
    setEnvironment(localStorage.getItem('bot_environment') || 'testnet');
}

function setZoomDays(days) {
    if (!state.candles.length) return;
    const last  = state.candles[state.candles.length - 1].time;
    const start = last - days * 86400;
    state.charts.main.timeScale().setVisibleRange({ from: start, to: last });
}

function resetZoom() {
    state.charts.main.timeScale().fitContent();
}

/* --- Painéis drag/resize --- */
function initPanels() {
    const workspace = document.getElementById('workspace');
    const overlay   = document.getElementById('drag-overlay');
    const panels    = workspace.querySelectorAll('.panel');
    applyPreset(localStorage.getItem('bot_layout_preset') || 'binance', false);

    panels.forEach(panel => {
        const titlebar = panel.querySelector('.panel-titlebar');
        titlebar.addEventListener('mousedown', e => {
            if (e.button !== 0 || e.target.tagName === 'BUTTON') return;
            e.preventDefault();
            bringToFront(panel);
            const wsRect = workspace.getBoundingClientRect();
            const pRect  = panel.getBoundingClientRect();
            const offX = e.clientX - pRect.left;
            const offY = e.clientY - pRect.top;
            overlay.classList.add('active');
            function onMove(e) {
                let l = Math.max(0, Math.min(e.clientX - wsRect.left - offX, workspace.clientWidth  - panel.offsetWidth));
                let t = Math.max(0, Math.min(e.clientY - wsRect.top  - offY, workspace.clientHeight - panel.offsetHeight));
                panel.style.left = l + 'px'; panel.style.top = t + 'px';
            }
            function onUp() { overlay.classList.remove('active'); savePanelLayout(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
        });

        panel.querySelectorAll('.rh').forEach(handle => {
            handle.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                e.preventDefault(); e.stopPropagation();
                bringToFront(panel);
                const dir = handle.dataset.dir;
                const wsRect = workspace.getBoundingClientRect();
                const pRect  = panel.getBoundingClientRect();
                const startX = e.clientX, startY = e.clientY;
                const startL = pRect.left - wsRect.left, startT = pRect.top - wsRect.top;
                const startW = pRect.width, startH = pRect.height;
                overlay.classList.add('active');
                overlay.style.cursor = getComputedStyle(handle).cursor;
                function onMove(e) {
                    const dx = e.clientX - startX, dy = e.clientY - startY;
                    let l = startL, t = startT, w = startW, h = startH;
                    if (dir.includes('e')) w = Math.max(180, startW + dx);
                    if (dir.includes('s')) h = Math.max(100, startH + dy);
                    if (dir.includes('w')) { w = Math.max(180, startW - dx); l = startL + startW - w; }
                    if (dir.includes('n')) { h = Math.max(100, startH - dy); t = startT + startH - h; }
                    panel.style.left = Math.max(0, l) + 'px'; panel.style.top = Math.max(0, t) + 'px';
                    panel.style.width = w + 'px'; panel.style.height = h + 'px';
                }
                function onUp() { overlay.classList.remove('active'); overlay.style.cursor = ''; savePanelLayout(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup',   onUp);
            });
        });

        panel.addEventListener('mousedown', () => bringToFront(panel));
    });
}

function bringToFront(panel) {
    document.querySelectorAll('.panel').forEach(p => { p.classList.remove('panel-active'); p.style.zIndex = '10'; });
    panel.classList.add('panel-active'); panel.style.zIndex = '100';
}

function savePanelLayout() {
    const ws = document.getElementById('workspace');
    if (!ws) return;
    const wW = ws.clientWidth, wH = ws.clientHeight;
    const layout = {};
    document.querySelectorAll('.panel').forEach(p => {
        layout[p.id] = {
            leftPct:   (parseFloat(p.style.left)   / wW) * 100,
            topPct:    (parseFloat(p.style.top)    / wH) * 100,
            widthPct:  (parseFloat(p.style.width)  / wW) * 100,
            heightPct: (parseFloat(p.style.height) / wH) * 100
        };
    });
    localStorage.setItem('bot_panel_layout', JSON.stringify(layout));
}

function applyPreset(name, save = true) {
    const ws = document.getElementById('workspace');
    if (!ws) return;
    requestAnimationFrame(() => {
        const W = ws.clientWidth, H = ws.clientHeight, GAP = 4;
        ['binance','grid','cols3','stack'].forEach(n => { const b = document.getElementById('btn-layout-' + n); if (b) b.classList.toggle('active', n === name); });
        if (save) localStorage.setItem('bot_layout_preset', name);
        const pm = document.getElementById('panel-main');
        const pr = document.getElementById('panel-rsi');
        const pd = document.getElementById('panel-macd'); // null on ORION / Bollinger page
        if (!pm) return;
        if (!pr && !pd) {
            // 1-panel layout (AURA Bollinger Bands)
            setPanelGeometry(pm, 0, 0, W, H);
        } else if (pd && pr) {
            // 3-panel layout (ZENITH with MACD)
            if (name === 'binance') {
                const mainW = Math.floor(W * 0.68), sideW = W - mainW - GAP, sideH = Math.floor((H - GAP) / 2);
                setPanelGeometry(pm, 0, 0, mainW, H);
                setPanelGeometry(pr, mainW + GAP, 0, sideW, sideH);
                setPanelGeometry(pd, mainW + GAP, sideH + GAP, sideW, H - sideH - GAP);
            } else if (name === 'grid') {
                const topH = Math.floor(H * 0.6), botH = H - topH - GAP, halfW = Math.floor((W - GAP) / 2);
                setPanelGeometry(pm, 0, 0, W, topH);
                setPanelGeometry(pr, 0, topH + GAP, halfW, botH);
                setPanelGeometry(pd, halfW + GAP, topH + GAP, W - halfW - GAP, botH);
            } else if (name === 'cols3') {
                const colW = Math.floor((W - GAP * 2) / 3);
                setPanelGeometry(pm, 0, 0, colW, H);
                setPanelGeometry(pr, colW + GAP, 0, colW, H);
                setPanelGeometry(pd, (colW + GAP)*2, 0, W - (colW + GAP)*2, H);
            } else if (name === 'stack') {
                const mainH = Math.floor(H * 0.55), rsiH = Math.floor((H - mainH - GAP * 2) / 2), macdH = H - mainH - rsiH - GAP * 2;
                setPanelGeometry(pm, 0, 0, W, mainH);
                setPanelGeometry(pr, 0, mainH + GAP, W, rsiH);
                setPanelGeometry(pd, 0, mainH + rsiH + GAP*2, W, macdH);
            }
        } else if (pr) {
            // 2-panel layout (ORION without MACD)
            if (name === 'binance' || name === 'grid') {
                const mainW = Math.floor(W * 0.72), sideW = W - mainW - GAP;
                setPanelGeometry(pm, 0, 0, mainW, H);
                setPanelGeometry(pr, mainW + GAP, 0, sideW, H);
            } else if (name === 'cols3') {
                const halfW = Math.floor((W - GAP) / 2);
                setPanelGeometry(pm, 0, 0, halfW, H);
                setPanelGeometry(pr, halfW + GAP, 0, W - halfW - GAP, H);
            } else if (name === 'stack') {
                const mainH = Math.floor(H * 0.65), rsiH = H - mainH - GAP;
                setPanelGeometry(pm, 0, 0, W, mainH);
                setPanelGeometry(pr, 0, mainH + GAP, W, rsiH);
            }
        }
        if (save) savePanelLayout();
    });
}

function setPanelGeometry(panel, left, top, width, height) {
    if (!panel) return;
    panel.style.left = left + 'px'; panel.style.top = top + 'px';
    panel.style.width = width + 'px'; panel.style.height = height + 'px';
}

function setBotStatusBadge(cls, html) {
    const badge = document.getElementById('bot-status-badge');
    if (!badge) return;
    const dot = badge.querySelector('.bot-status-dot');
    badge.className = cls;
    const txt = document.getElementById('bot-status-text');
    if (txt) txt.innerHTML = html;
    if (dot) { if (cls === 'running') dot.classList.add('pulsing'); else dot.classList.remove('pulsing'); }
}

function updateBotSessionUI() {
    setEl('bot-trades-count', botState.trades);
    const wr = botState.trades > 0 ? ((botState.wins / botState.trades) * 100).toFixed(0) + '%' : '---';
    setEl('bot-winrate', wr);
    const pnl = botState.sessionPnl;
    const pnlEl = document.getElementById('bot-session-pnl');
    if (pnlEl) { pnlEl.textContent = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2); pnlEl.style.color = pnl >= 0 ? 'var(--color-green)' : 'var(--color-red)'; }
    const badge   = document.getElementById('trade-status-badge');
    const entryEl = document.getElementById('trade-info-entry');
    const slEl    = document.getElementById('trade-info-sl');
    const tpEl    = document.getElementById('trade-info-tp');
    if (botState.position) {
        const isLong = botState.position === 'long';
        const posColor = isLong ? 'var(--color-green)' : 'var(--color-red)';
        if (badge)   { badge.textContent = isLong ? 'ABERTA (COMPRA)' : 'ABERTA (VENDA)'; badge.style.color = posColor; }
        if (entryEl) entryEl.textContent = '$' + Number(botState.entryPrice).toFixed(2);
        if (slEl)    slEl.textContent    = botState.stopLoss   > 0 ? '$' + Number(botState.stopLoss).toFixed(2)   : '---';
        if (tpEl)    tpEl.textContent    = botState.takeProfit > 0 ? '$' + Number(botState.takeProfit).toFixed(2) : '---';
        const posEl = document.getElementById('bot-live-pos');
        if (posEl) { posEl.textContent = isLong ? 'LONG' : 'SHORT'; posEl.style.color = posColor; }
    } else {
        if (badge)   { badge.textContent = 'ENCERRADA'; badge.style.color = 'var(--text-muted)'; }
        if (entryEl) entryEl.textContent = '---';
        if (slEl)    slEl.textContent    = '---';
        if (tpEl)    tpEl.textContent    = '---';
        const posEl = document.getElementById('bot-live-pos');
        if (posEl) { posEl.textContent = 'FORA'; posEl.style.color = ''; }
    }
}
