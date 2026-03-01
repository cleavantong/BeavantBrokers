const ALLOWED_PRED_SYMBOLS = [
    "AAPL", "MSFT", "GOOG", "TSLA", "NVDA",
    "META", "AMZN", "JPM", "V", "UNH",
    "JNJ", "XOM", "PG", "HD", "MA",
    "BAC", "AVGO", "LLY", "MRK", "PEP",
    "COST", "ABBV", "KO", "WMT", "CVX",
    "ADBE", "CRM", "MCD", "CSCO", "DIS",
    "TXN", "PFE", "NFLX", "INTC", "VZ",
    "TMO", "QCOM", "WFC", "ABT", "NKE",
    "ACN", "DHR", "UPS", "LIN", "PM",
    "NEE", "AMGN", "LOW", "MDT", "MS"
];

// ─── NAVIGATION HELPERS ───

// hide section tags under main, then show only the one matching window.location.hash.
function showSection() {
    let current = window.location.hash.substring(1); // e.g. "#watchlist" → "watchlist"
    if (!current) {
        current = 'dashboard';
        history.replaceState(null, '', '#dashboard');
    }

    // hides all sections and only shows the one == current
    document.querySelectorAll('main section').forEach(sec => {
        sec.style.display = sec.id === current ? 'block' : 'none';
    });

    document.querySelectorAll('.btn-group button').forEach(btn => {
        const btnId = btn.id; // e.g. "btn-dashboard" cleev'nt
        if (btnId === 'btn-' + current) {
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary');
        } else if (btnId !== 'btn-logout') {
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-secondary');
        }
    });

    // keep topbar nav links active
    document.querySelectorAll('.navbar-nav .nav-link').forEach(link => {
        link.classList.toggle('active',
            link.getAttribute('href') === '#' + current
        );
    });

    // if Alerts tab is now visible, refresh the warning banner
    if (current === 'alerts') {
        updateNotificationWarning();
    }
}


// sets window.location.hash and immediately shows the correct section.
function navigate(sectionId) {
    window.location.hash = sectionId;
    showSection();
}

// called by logout
function logoutAndRedirect() {
    localStorage.removeItem('jwt');
    window.location.href = 'index.html';
}



const token = localStorage.getItem('jwt');
if (!token) {
    window.location.href = '/';
    throw new Error('No auth token, redirecting to login');
}

// initialise tooltip elements
function initTooltips(root = document) {
    const triggers = Array.from(root.querySelectorAll('[data-bs-toggle="tooltip"]'));
    triggers.forEach(el => new bootstrap.Tooltip(el));
}

// for portfolio analysis clevent
document.getElementById('runAnalysis').addEventListener('click', analyzePortfolioRisk);

async function analyzePortfolioRisk() {
    const btn = document.getElementById('runAnalysis');
    btn.disabled = true;
    btn.textContent = 'Analyzing…';

    // build holdings from livePrices & currentHoldings
    const payload = {
        holdings: window.currentHoldings.map(h => ({
            ticker: h.ticker,
            quantity: h.quantity
        }))
    };

    try {
        const res = await fetch('/api/portfolio-analysis', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');

        // render
        // key Metrics
        document.getElementById('analysis-metrics').innerHTML = `
    <h5>Key Metrics</h5>
    <ul class="list-unstyled">
      <li><strong>Volatility (σ):</strong> ${(data.metrics.volatility * 100).toFixed(2)}%</li>
      <li><strong>VaR 95%:</strong> ${(data.metrics.var95 * 100).toFixed(2)}%</li>
      <li><strong>Beta vs. SPY:</strong> ${data.metrics.beta.toFixed(2)}</li>
      <li><strong>Top 3 Concentration:</strong> ${(data.metrics.concentrationTop3 * 100).toFixed(1)}%</li>
    </ul>
  `;

        // sector breakdown → pie chart
        const breakdownEl = document.getElementById('analysis-breakdown');
        breakdownEl.innerHTML = `
    <h5>Sector Breakdown</h5>
    <canvas id="sectorChartCanvas" height="200"></canvas>
  `;

        // grab weights & labels
        const sectors = Object.keys(data.metrics.sectorWeights);
        const weights = sectors.map(s => +(data.metrics.sectorWeights[s] * 100).toFixed(1));

        // if we already drew one, destroy it
        if (window.sectorChartInstance) {
            window.sectorChartInstance.destroy();
        }

        // instantiate new pie
        const ctx = document.getElementById('sectorChartCanvas').getContext('2d');
        window.sectorChartInstance = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: sectors,
                datasets: [{ data: weights }]
            },
            options: {
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: ctx => `${ctx.label}: ${ctx.parsed}%`
                        }
                    }
                }
            }
        });

        // recommendations
        const varPct = (data.metrics.var95 * 100).toFixed(2);

        const recsHtml = data.recommendations.map(r => `
  <li>
    <strong>${r.title}:</strong>
    <small class="text-muted">${r.text}</small>
  </li>
`).join('');

        document.getElementById('analysis-recommendations').innerHTML = `
  <h5>Recommendations</h5>
  <ul class="list-unstyled">
    ${recsHtml}
    <li>
      <strong>About VaR:</strong>
      <small class="text-muted">
        Your 95% VaR is ${varPct}%, which means on 95 out of 100 trading days
        you shouldn’t lose more than ${Math.abs(varPct)}% of your portfolio.
      </small>
    </li>
  </ul>
`;

        initTooltips(document.getElementById('analysis'));

    } catch (err) {
        console.error(err);
        alert('Analysis failed: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-play me-1"></i>Run Analysis`;
    }
}

// ensure showSection() is called on page load
window.addEventListener('hashchange', () => {
    showSection();
    if (window.location.hash === '#analysis') {
    }
});


window.currentHoldings = [];

const livePrices = {};

// for card stats
async function loadStats(symbol) {
    const statEl = document.getElementById(`stats-${symbol}`);
    statEl.textContent = 'Loading stats…';

    try {
        const res = await fetch(
            `/api/history?symbol=${encodeURIComponent(symbol)}&range=1d`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) throw new Error(await res.text());
        const bars = await res.json();

        if (!Array.isArray(bars) || bars.length === 0) {
            throw new Error('No bars returned');
        }

        // compute open, high, low, close, volume and insert tooltip
        const open = bars[0].o;
        const close = bars[bars.length - 1].c;
        const high = Math.max(...bars.map(b => b.h));
        const low = Math.min(...bars.map(b => b.l));
        const volume = bars.reduce((sum, b) => sum + b.v, 0);

        statEl.innerHTML = `
        <div class="d-flex flex-wrap gap-2">
    <span data-bs-toggle="tooltip" title="Open: price at today's first trade">
      Open: ${open.toFixed(2)}
    </span>
    <span data-bs-toggle="tooltip" title="High: the highest price during the day">
      High: ${high.toFixed(2)}
    </span>
    <span data-bs-toggle="tooltip" title="Low: the lowest price during the day">
      Low: ${low.toFixed(2)}
    </span>
    <span data-bs-toggle="tooltip" title="Close: the most recent price">
      Close: ${close.toFixed(2)}
    </span>
    <span data-bs-toggle="tooltip" title="Volume: total quantity of shares traded in the last 24H">
      Volume: ${volume.toLocaleString()}
    </span>
  </div>
      `;

        initTooltips(statEl);
    } catch (err) {
        console.warn(`loadStats(${symbol}) failed:`, err);
        statEl.textContent = 'Stats unavailable (you have reached the max number of API calls on our free plan, try reducing number of symbols in your watchlist)';
    }
}



// logout button
const logoutBtn = document.getElementById('logoutBtn');
logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('jwt');
    window.location.href = '/';
});

// setup chart.js
const ctx = document.getElementById('priceChart').getContext('2d');
const priceChart = new Chart(ctx, {
    type: 'line',
    data: {
        datasets: [
            {
                label: 'Live Price',
                data: [],
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.2,
            },
        ],
    },
    options: {
        scales: {
            x: {
                type: 'time',
                time: {
                    unit: 'minute',
                    displayFormats: { minute: 'HH:mm' },
                },
                title: { display: true, text: 'Time (HH:mm)' },
            },
            y: {
                beginAtZero: false,
                title: { display: true, text: 'Price (USD)' },
            },
        },
        plugins: {
            legend: { display: true }
        },
        animation: { duration: 0 }
    }
});
// chart display helper
let chartSymbol = null;
let chartRange = '1d';

async function showChartFor(symbol) {
    chartSymbol = symbol;
    document.getElementById('chart-title').textContent = `Price Chart: ${symbol}`;
    document.getElementById('chart-container').style.display = 'block';

    // clear old data/labels
    priceChart.data.datasets[0].data = [];
    priceChart.data.labels = [];

    // fetch raw bars
    let bars = [];
    try {
        const res = await fetch(
            `/api/history?symbol=${encodeURIComponent(symbol)}&range=${chartRange}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        bars = await res.json();
        console.log('🕰 raw bars:', bars.length);
    } catch (err) {
        console.error('❌ history fetch:', err);
        return;
    }

    // for multi-day ranges, drop weekend points
    if (chartRange !== '1d') {
        bars = bars.filter(b => {
            const wd = new Date(b.t).getUTCDay();  // 0=Sun,6=Sat
            return wd >= 1 && wd <= 5;
        });
        console.log('🕰 bars after weekend filter:', bars.length);
    }


    // if not daily build categorical axis otherwise idk how to get rid of weekend bar
    if (chartRange !== '1d') {
        const labels = bars.map(b =>
            new Date(b.t).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            })
        );
        const data = bars.map(b => b.c);

        priceChart.options.scales.x = {
            type: 'category',
            title: { display: true, text: 'Date' },
            ticks: { autoSkip: true, maxTicksLimit: 12 }
        };

        priceChart.data.labels = labels;
        priceChart.data.datasets[0].data = data;
        priceChart.update();
        return;
    }

    // daily
    priceChart.options.scales.x = {
        type: 'time',
        time: {
            unit: 'minute',
            displayFormats: { minute: 'HH:mm' }
        },
        title: { display: true, text: 'Time (HH:mm)' }
    };

    priceChart.data.datasets[0].data = bars.map(b => ({
        x: new Date(b.t),
        y: b.c
    }));

    priceChart.update();
}




// range‐button handler
document.getElementById('rangeBtns').addEventListener('click', e => {
    const r = e.target.dataset.range;
    if (!r || !chartSymbol) return;
    chartRange = r;
    showChartFor(chartSymbol);
});

// watchlist “view chart” handler
document.getElementById('watch-cards').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action="view-chart"]');
    if (!btn) return;
    showChartFor(btn.dataset.symbol);
});


// live mapping
const socket = io({ auth: { token } });



socket.on('connect', () => {
    console.log('🔗 Connected to price feed, socket id:', socket.id);
});

function updateDashboardMetrics() {
    let totalValue = 0;
    let totalCost = 0;
    let totalPnL = 0;
    let totalUnrealPL = 0;

    window.currentHoldings.forEach(({ ticker, quantity, price: costBasis }) => {
        const currPrice = livePrices[ticker];
        const currentVal = (typeof currPrice === 'number')
            ? (quantity * currPrice)
            : (quantity * costBasis);

        const costVal = quantity * costBasis;
        const pnl = currentVal - costVal;

        totalValue += currentVal;
        totalCost += costVal;
        totalPnL += pnl;
        totalUnrealPL += pnl;
    });

    // need to add this 
    const cashAvailable = 0.00;

    // update dom
    document.getElementById('total-value').textContent = `$${totalValue.toFixed(2)}`;

    // p&l
    const todaysPnLEl = document.getElementById('todays-pnl');
    const tnSign = totalPnL >= 0 ? '+' : '-';
    todaysPnLEl.textContent = `${tnSign}$${Math.abs(totalPnL).toFixed(2)}`;
    todaysPnLEl.className = totalPnL >= 0
        ? 'fs-3 text-success fw-bold'
        : 'fs-3 text-danger fw-bold';

    // urlz 
    const unrealPnLEl = document.getElementById('unrealized-pnl');
    const unSign = totalUnrealPL >= 0 ? '+' : '-';
    unrealPnLEl.textContent = `${unSign}$${Math.abs(totalUnrealPL).toFixed(2)}`;
    unrealPnLEl.className = totalUnrealPL >= 0
        ? 'fs-3 text-success fw-bold'
        : 'fs-3 text-danger fw-bold';

    // cash avail
    document.getElementById('cash-available').textContent = `$${cashAvailable.toFixed(2)}`;
}

socket.on('priceUpdate', ({ symbol, price, timestamp, change, changePercent }) => {
    livePrices[symbol] = price;

    const priceEl = document.getElementById(`price-${symbol}`);
    if (priceEl) priceEl.textContent = `$${price.toFixed(2)}`;

    const changeEl = document.getElementById(`change-${symbol}`);
    if (changeEl) {
        const sign = changePercent >= 0 ? '+' : '';
        changeEl.textContent = `${sign}${changePercent.toFixed(2)}%`;
        changeEl.className = changePercent >= 0 ? 'text-success' : 'text-danger';
    }

    if (window.latestTracked === symbol && window.chart) {
        window.chart.data.datasets[0].data.push({
            x: new Date(timestamp),
            y: price
        });
        if (window.chart.data.datasets[0].data.length > 60) {
            window.chart.data.datasets[0].data.shift();
        }
        window.chart.update('none');
    }
    updateDashboardMetrics();
    calculateAndDisplayHoldings();

    if (symbol === chartSymbol) {
        priceChart.data.datasets[0].data.push({
            x: new Date(timestamp || Date.now()),
            y: price
        });
        if (priceChart.data.datasets[0].data.length > 200) {
            priceChart.data.datasets[0].data.shift();
        }
        priceChart.update('none');
    }
});



// track button
const trackBtn = document.getElementById('trackBtn');
trackBtn.addEventListener('click', () => {
    const symbolInput = document.getElementById('stockSymbol');
    const symbol = symbolInput.value.trim().toUpperCase();
    if (!symbol) return;

    const watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
    if (!watchlist.includes(symbol)) {
        watchlist.push(symbol);
        localStorage.setItem('watchlist', JSON.stringify(watchlist));
    }

    socket.emit('subscribe', symbol);
    window.latestTracked = symbol;

    const container = document.getElementById('watch-cards');
    if (document.getElementById(`card-${symbol}`)) return;

    container.insertAdjacentHTML('beforeend', `
        <div class="col" id="card-${symbol}">
          <div class="card shadow-sm h-100">
            <div class="card-header d-flex justify-content-between align-items-center">
              <h6 class="mb-0">${symbol}</h6>
              <div>
                <button class="btn btn-sm btn-outline-primary me-2" data-action="view-chart" data-symbol="${symbol}">
                  <i class="fas fa-chart-line"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" data-action="remove-card" data-symbol="${symbol}">
                  &times;
                </button>
              </div>
            </div>
            <div class="card-body text-center">
              <p id="price-${symbol}" class="fs-3">$0.00</p>
              <p id="change-${symbol}" class="text-muted small">–</p>
      
              <!-- new stats block -->
              <div id="stats-${symbol}" class="mt-2 small text-start text-secondary">
                Loading stats…
              </div>
            </div>
          </div>
        </div>
      `);

    // then load stats
    loadStats(symbol);


});

window.removeCard = function (symbol) {
    const el = document.getElementById(`card-${symbol}`);
    if (el) el.remove();

    const watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
    const updated = watchlist.filter(s => s !== symbol);
    localStorage.setItem('watchlist', JSON.stringify(updated));
};

// remove-card handler
document.getElementById('watch-cards').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action="remove-card"]');
    if (!btn) return;
    const sym = btn.dataset.symbol;
    // use your helper — this removes from DOM *and* from localStorage
    removeCard(sym);
});

// view-chart handler
document.getElementById('watch-cards').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action="view-chart"]');
    if (!btn) return;
    const sym = btn.dataset.symbol;
    showChartFor(sym);
});

// load saved alerts
let alerts = JSON.parse(localStorage.getItem('priceAlerts') || '[]');

// render alert table
function renderAlerts() {
    const tbody = document.getElementById('alerts-list');
    tbody.innerHTML = '';
    alerts.forEach((a, i) => {
        tbody.insertAdjacentHTML('beforeend', `
      <tr>
        <td>${a.symbol}</td>
        <td>$${a.price.toFixed(2)}</td>
        <td>${a.condition}</td>
        <td>
          <button class="btn btn-sm btn-danger" data-index="${i}">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `);
    });
}
renderAlerts();

// add alert
document.getElementById('alerts-form').addEventListener('submit', async e => {
    e.preventDefault();
    const sym = document.getElementById('alertSymbol').value.trim().toUpperCase();
    const price = parseFloat(document.getElementById('alertPrice').value);
    const cond = document.getElementById('alertCondition').value;

    // save the alert
    alerts.push({ symbol: sym, price, condition: cond });
    localStorage.setItem('priceAlerts', JSON.stringify(alerts));

    // ask for permission now that user clicked 'add'
    if ('Notification' in window && Notification.permission === 'default') {
        const result = await Notification.requestPermission();
        console.log('📬 Notification.permission →', result);
        alert(
            result === 'granted'
                ? '✅ Notifications enabled!'
                : '⚠️ Please allow notifications to get alerts.'
        );
        updateNotificationWarning();
    }

    // redraw table
    renderAlerts();
    e.target.reset();
});


// remove alert
document.getElementById('alerts-list').addEventListener('click', e => {
    if (!e.target.closest('button[data-index]')) return;
    const i = parseInt(e.target.closest('button').dataset.index);
    alerts.splice(i, 1);
    localStorage.setItem('priceAlerts', JSON.stringify(alerts));
    renderAlerts();
});

// when priceupdate, check alert
socket.on('priceUpdate', ({ symbol, price }) => {
    alerts.forEach((a, i) => {
        if (a.symbol !== symbol) return;
        const triggered =
            (a.condition === 'above' && price >= a.price) ||
            (a.condition === 'below' && price <= a.price);
        // Only act if threshold passed *and* we have permission
        if (triggered && Notification.permission === 'granted') {
            new Notification(
                `Alert: ${symbol} is ${a.condition} $${a.price}`,
                { body: `Current price: $${price.toFixed(2)}`, icon: '/favicon.ico' }
            );
            // Now—and only now—remove it
            alerts.splice(i, 1);
            localStorage.setItem('priceAlerts', JSON.stringify(alerts));
            renderAlerts();
        }
    });
});

function updateDashboardMetricsFromHoldings(holdings) {
    const totalCost = holdings.reduce((sum, h) => sum + h.price * h.quantity, 0);
    const totalMarketValue = holdings.reduce((sum, h) => {
        const live = livePrices[h.ticker];
        return sum + (typeof live === 'number' ? live * h.quantity : 0);
    }, 0);

    const unrealised = totalMarketValue - totalCost;

    // update dom
    document.getElementById('unrealisedPL').textContent = `$${unrealised.toFixed(2)}`;

    // use the same logic for "today's P&L"
    const totalTodayPL = holdings.reduce((sum, h) => {
        const todayPL = livePriceChanges[h.ticker]; // e.g., difference from yesterday
        return sum + (typeof todayPL === 'number' ? todayPL * h.quantity : 0);
    }, 0);

    document.getElementById('todayPL').textContent = `$${totalTodayPL.toFixed(2)}`;
}

window.addEventListener('DOMContentLoaded', () => {
    //rehydrate
    const saved = JSON.parse(localStorage.getItem('watchlist') || '[]');
    saved.forEach(sym => {
        document.getElementById('stockSymbol').value = sym;
        document.getElementById('trackBtn').click();
        loadStats(sym);
    });

    // add holding and remove row handler
    document.getElementById('add-row').addEventListener('click', () => {
        const body = document.getElementById('holdings-body');
        const templateRow = body.querySelector('tr');
        let newRow;

        if (templateRow) {
            newRow = templateRow.cloneNode(true);
            newRow.querySelectorAll('input').forEach(input => {
                input.value = input.name === 'ticker' ? '' : 0;
            });
        } else {
            newRow = document.createElement('tr');
            newRow.innerHTML = `
      <td><input type="text" class="form-control" name="ticker" required></td>
      <td><input type="number" class="form-control" name="quantity" value="0" min="0" required></td>
      <td><input type="number" class="form-control" name="price" value="0" min="0" step="0.01" required></td>
      <td><button type="button" class="btn btn-danger btn-sm remove-row"><i class="fas fa-trash"></i></button></td>
      `;
        }
        body.appendChild(newRow);
    });

    document.getElementById('holdings-body').addEventListener('click', async e => {
        const btn = e.target.closest('.remove-row');
        if (!btn) return;

        // 1) remove the row
        btn.closest('tr').remove();

        // 2) recalc holdings
        await calculateAndDisplayHoldings();

        // 3) save updated holdings to backend
        const rows = Array.from(document.querySelectorAll('#holdings-body tr'));
        const updatedHoldings = rows.map(row => {
            const ticker = row.querySelector('input[name="ticker"]').value.trim().toUpperCase();
            const quantity = parseFloat(row.querySelector('input[name="quantity"]').value);
            const price = parseFloat(row.querySelector('input[name="price"]').value);
            return { ticker, quantity, price };
        });

        await fetch('/api/saveHoldings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify(updatedHoldings)
        });

        if (response.ok) {
            recalculateDashboardMetrics(updatedHoldings); // ✅ NEW: update metrics live
            alert('Holdings updated!');
        } else {
            alert('Failed to update holdings.');
        }
    });




    document.getElementById("calculateBtn").addEventListener("click", async () => {
        const calcBtn = document.getElementById('calculateBtn');
        if (calcBtn) {
            calcBtn.addEventListener('click', async (e) => {
                e.preventDefault();

                // update the metrics
                await calculateAndDisplayHoldings();
                await updateDashboardMetrics();

                // get updated holdings from table
                const rows = Array.from(document.querySelectorAll('#holdings-body tr'));
                const updatedHoldings = rows.map(row => {
                    const ticker = row.querySelector('input[name="ticker"]').value.trim().toUpperCase();
                    const quantity = parseFloat(row.querySelector('input[name="quantity"]').value);
                    const price = parseFloat(row.querySelector('input[name="price"]').value);
                    return { ticker, quantity, price };
                });

                // save holdings to backend
                const token = localStorage.getItem('jwt');
                await fetch('/api/saveHoldings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                    },
                    body: JSON.stringify(updatedHoldings)
                });

                //update the metrics in the dom
                updateDashboardMetricsFromHoldings(updatedHoldings);

            });
        }
    });


    updateNotificationWarning();
    initTooltips();
});


fetch('/api/loadHoldings', {
    headers: { Authorization: `Bearer ${token}` }
})
    .then(res => res.json())
    .then(data => {
        const body = document.getElementById('holdings-body');
        body.innerHTML = ''; // clear initial row

        // reinsert each saved row and store in window.currentHoldings cleevnt
        window.currentHoldings = []; // reset
        data.forEach(({ ticker, quantity, price }) => {
            const row = document.createElement('tr');
            row.innerHTML = `
        <td><input type="text" class="form-control" name="ticker" value="${ticker}" required></td>
        <td><input type="number" class="form-control" name="quantity" value="${quantity}" min="0" required></td>
        <td><input type="number" class="form-control" name="price" value="${price}" min="0" step="0.01" required></td>
        <td><button type="button" class="btn btn-danger btn-sm remove-row"><i class="fas fa-trash"></i></button></td>
      `;
            body.appendChild(row);

            window.currentHoldings.push({
                ticker: ticker.toUpperCase(),
                quantity: quantity,
                price: price
            });
        });


        // fetch current price for each holding
        const quotePromises = window.currentHoldings.map(h => {
            return fetch(`/api/quote?symbol=${encodeURIComponent(h.ticker)}`, {
                headers: { Authorization: `Bearer ${token}` }
            })
                .then(r => {
                    if (!r.ok) throw new Error(`${h.ticker} not found`);
                    return r.json();
                })
                .then(({ symbol, price }) => {
                    livePrices[symbol] = price;
                })
                .catch(err => {
                    console.warn(`[Quote Fetch] Could not fetch ${h.ticker}:`, err.message);
                });
        });

        // calculate table and cards after all quotes are fetched
        Promise.all(quotePromises).then(() => {
            calculateAndDisplayHoldings();
            updateDashboardMetrics();
        });
    })
    .catch(err => {
        console.error('Error loading holdings:', err);
    });

// —— ML Predictions tab loader ——  
async function loadPredictions() {
    const cards = document.getElementById('prediction-cards');
    cards.innerHTML = '';

    // a) use a separate ml‐symbols list, default to empty
    const mlSymbols = JSON.parse(localStorage.getItem('mlSymbols') || '[]');
    if (mlSymbols.length === 0) {
        cards.innerHTML = '<p>No symbols added. Use the input above.</p>';
        return;
    }

    cards.innerHTML = '<p>Loading predictions…</p>';

    // b) fetch predictions in parallel
    const results = await Promise.allSettled(
        mlSymbols.map(sym =>
            fetch(`/api/predict?symbol=${sym}`, {
                headers: { Authorization: `Bearer ${token}` }
            })
                .then(r => {
                    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
                    return r.json();
                })
                .then(data => ({ sym, data }))
        )
    );

    // c) render cards with a remove-button
    cards.innerHTML = '';
    results.forEach((r, i) => {
        const sym = mlSymbols[i];                          // ← always get true ticker
        if (r.status === 'fulfilled' && !r.value.data.error) {
            const { data: { next_day_close } } = r.value;

            cards.insertAdjacentHTML('beforeend', `
        <div class="col">
          <div class="prediction-card card shadow-sm">
            <div class="card-body position-relative">
              <!-- ← PART A: Remove button -->
              <button 
                class="btn-close position-absolute top-0 end-0 remove-pred-symbol" 
                data-symbol="${sym}"
                aria-label="Remove">
              </button>

              <h6 class="card-title">${sym}</h6>
              <p class="fs-3">$${next_day_close.toFixed(2)}</p>
            </div>
          </div>
        </div>
      `);
        } else {
            // error case with remove button
            cards.insertAdjacentHTML('beforeend', `
   <div class="col">
     <div class="card border-danger text-center">
       <div class="card-body position-relative">
         <button
           class="btn-close position-absolute top-0 end-0 remove-pred-symbol"
           data-symbol="${sym}"
           aria-label="Remove">
         </button>
         'Error loading ${sym} - please try again.'
       </div>
     </div>
   </div>
 `);
        }
    });
}


// 3) show the tab and load on hash
window.addEventListener('hashchange', () => {
    if (window.location.hash === '#predictions') loadPredictions();
});
if (window.location.hash === '#predictions') loadPredictions();

// 4) add‐symbol handler
document.getElementById('addPredSymbol').addEventListener('click', () => {
    const inp = document.getElementById('predSymbolInput');
    const sym = inp.value.trim().toUpperCase();
    if (!sym) return;

    if (!ALLOWED_PRED_SYMBOLS.includes(sym)) {
        return alert(
            `Sorry, “${sym}” isn’t supported.\n` +
            `Please choose from: ${ALLOWED_PRED_SYMBOLS.join(', ')}`
        );
    }

    let mlSymbols = JSON.parse(localStorage.getItem('mlSymbols') || '[]');
    if (!mlSymbols.includes(sym)) {
        mlSymbols.push(sym);
        localStorage.setItem('mlSymbols', JSON.stringify(mlSymbols));
        loadPredictions();
    }
    inp.value = '';
});


// 5) remove‐symbol handler 
document.getElementById('prediction-cards').addEventListener('click', e => {
    const btn = e.target.closest('.remove-pred-symbol');
    if (!btn) return;
    const sym = btn.dataset.symbol;
    let mlSymbols = JSON.parse(localStorage.getItem('mlSymbols') || '[]');
    mlSymbols = mlSymbols.filter(s => s !== sym);
    localStorage.setItem('mlSymbols', JSON.stringify(mlSymbols));
    loadPredictions();
});


async function calculateAndUpdateStats(holdings) {
    let totalValue = 0;
    let totalCost = 0;
    let todayPL = 0;

    for (const h of holdings) {
        try {
            const res = await fetch(`/api/quote?symbol=${h.ticker}`, {
                headers: {
                    Authorization: 'Bearer ' + localStorage.getItem('token')
                }
            });
            const data = await res.json();
            const price = data.price;
            const value = price * h.quantity;
            const cost = h.price * h.quantity;
            const pl = (price - h.price) * h.quantity;

            totalValue += value;
            totalCost += cost;
            todayPL += pl;
        } catch (err) {
            console.error('Failed to fetch price for', h.ticker, err);
        }
    }

    document.getElementById('totalValue').textContent = totalValue.toFixed(2);
    document.getElementById('todayPL').textContent = todayPL.toFixed(2);
    document.getElementById('unrealisedGL').textContent = (totalValue - totalCost).toFixed(2);
}



// calculate and display holding helper
function calculateAndDisplayHoldings() {
    let total = 0;
    let html = '<table class="table"><thead><tr><th>Ticker</th><th>Value</th><th>P/L</th></tr></thead><tbody>';

    const holdingsToSave = [];
    document.querySelectorAll('#holdings-body tr').forEach(r => {
        const t = r.querySelector('input[name="ticker"]').value.trim().toUpperCase();
        const q = parseFloat(r.querySelector('input[name="quantity"]').value);
        const p = parseFloat(r.querySelector('input[name="price"]').value);
        const curr = livePrices[t];
        const cost = q * p;
        const currentVal = (typeof curr === 'number') ? (q * curr) : cost;
        const pl = (typeof curr === 'number') ? (currentVal - cost) : 0;
        total += currentVal;

        holdingsToSave.push({ ticker: t, quantity: q, price: p });

        const plSign = pl > 0 ? '+' : pl < 0 ? '-' : '';
        const plFormatted = `${plSign}$${Math.abs(pl).toFixed(2)}`;
        const plClass = pl >= 0 ? 'text-success' : 'text-danger';

        html += `
      <tr>
        <td>${t}</td>
        <td>$${currentVal.toFixed(2)}</td>
        <td class="${plClass}">${plFormatted}</td>
      </tr>`;
    });

    html += `</tbody></table><h4>Total Assets: $${total.toFixed(2)}</h4>`;
    document.getElementById('holdings-result').innerHTML = html;
    document.getElementById('total-value').textContent = '$' + total.toFixed(2);

    // saves edits in case user makes changes before calcualting
    fetch('/api/saveHoldings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(holdingsToSave)
    })
        .then(res => {
            if (!res.ok) console.error('Failed to save holdings on recalc.');
        })
        .catch(err => console.error('Error saving holdings on recalc:', err));

    fetch('/api/loadHoldings', {
        method: 'GET',
        headers: {
            Authorization: 'Bearer ' + localStorage.getItem('token')
        }
    })
        .then(res => res.json())
        .then(fetchedHoldings => {
            calculateAndUpdateStats(fetchedHoldings); // Trigger update using new data
        });
}

document.getElementById('refreshBtn').addEventListener('click', () => {
    window.location.reload();
});


// logic to group same stock and recalculate avg price
const holdingsForm = document.getElementById('holdings-form');
if (holdingsForm) {
    holdingsForm.addEventListener('submit', e => {
        e.preventDefault();

        const rows = Array.from(document.querySelectorAll('#holdings-body tr'));
        const grouped = {};

        rows.forEach(r => {
            const t = r.querySelector('input[name="ticker"]').value.trim().toUpperCase();
            const q = parseFloat(r.querySelector('input[name="quantity"]').value);
            const p = parseFloat(r.querySelector('input[name="price"]').value);
            if (!t || isNaN(q) || isNaN(p)) return;

            if (!grouped[t]) {
                grouped[t] = { totalQty: q, totalCost: q * p };
            } else {
                grouped[t].totalQty += q;
                grouped[t].totalCost += q * p;
            }
        });

        const tbody = document.getElementById('holdings-body');
        tbody.innerHTML = '';
        Object.entries(grouped).forEach(([ticker, { totalQty, totalCost }]) => {
            const avg = totalCost / totalQty;
            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td><input type="text"   class="form-control" name="ticker"  value="${ticker}" required></td>
        <td><input type="number" class="form-control" name="quantity" value="${totalQty}" min="0" required></td>
        <td><input type="number" class="form-control" name="price"    value="${avg.toFixed(2)}" min="0" step="0.01" required></td>
        <td>
          <button type="button" class="btn btn-danger btn-sm remove-row">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      `;
            tbody.appendChild(tr);
        });

        calculateAndDisplayHoldings();
    });
}

// refresh current holdings and dashboard after saving
window.currentHoldings = holdingsToSave;

Promise.all(
    holdingsToSave.map(h =>
        fetch(`/api/quote?symbol=${encodeURIComponent(h.ticker)}`, {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data) livePrices[h.ticker] = data.price;
            })
            .catch(err => console.warn(`[Quote Fetch] ${h.ticker} failed`, err.message))
    )
).then(() => {
    updateDashboardMetrics(); // refresh dashboard UI
});

// show/hide the “notifications disabled” warning and offer a button to enable
function updateNotificationWarning() {
    const warn = document.getElementById('notificationWarning');

    // 1) not supported at all
    if (!('Notification' in window)) {
        warn.textContent = 'Your browser does not support desktop notifications.';
        warn.style.display = 'block';
        return;
    }

    // 2) user hasn’t decided yet → we can call requestPermission()
    if (Notification.permission === 'default') {
        warn.innerHTML = `
        Desktop notifications are <strong>disabled</strong>.
        <button 
          class="btn btn-sm btn-secondary ms-2"
          onclick="(async () => {
            const res = await Notification.requestPermission();
            console.log('New permission:', res);
            updateNotificationWarning();
          })()"
        >
          Enable Notifications
        </button>
      `;
        warn.style.display = 'block';
        return;
    }

    // 3) user explicitly denied → we must ask them to go into browser settings
    if (Notification.permission === 'denied') {
        warn.innerHTML = `
        Desktop notifications have been <strong>blocked</strong>.<br>
        Please open your browser’s site-settings and re-enable notifications for this site.
      `;
        warn.style.display = 'block';
        return;
    }

    // 4) granted cleevent
    warn.style.display = 'none';
}



window.addEventListener('DOMContentLoaded', () => {
    updateNotificationWarning();
});

window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('calculateBtn')
    if (btn) {
        btn.addEventListener('click', e => {
            e.preventDefault()         //  stop the form‑submit
            window.location.reload()   //  full page refresh
        })
    }
})

function recalculateDashboardMetrics(holdings) {
    let totalCost = 0;
    let totalMarketValue = 0;
    let totalTodayPL = 0;

    holdings.forEach(h => {
        const ticker = h.ticker.toUpperCase();
        const quantity = parseFloat(h.quantity);
        const price = parseFloat(h.price);

        const live = livePrices[ticker];
        const prevClose = prevClosePrices[ticker];

        if (live && prevClose) {
            totalCost += quantity * price;
            totalMarketValue += quantity * live;
            totalTodayPL += quantity * (live - prevClose);
        }
    });

    const unrealised = totalMarketValue - totalCost;

    const todayPLPercent = totalCost > 0 ? (totalTodayPL / totalCost) * 100 : 0;
    const unrealisedPercent = totalCost > 0 ? (unrealised / totalCost) * 100 : 0;

    document.getElementById('todays-pnl').textContent = `$${totalTodayPL.toFixed(2)} (${todayPLPercent.toFixed(1)}%)`;
    document.getElementById('unrealized-pnl').textContent = `$${unrealised.toFixed(2)} (${unrealisedPercent.toFixed(1)}%)`;
}

