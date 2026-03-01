require('dotenv').config();
console.log('🔑 POLYGON_API_KEY:', process.env.POLYGON_API_KEY
    ? '✔︎ loaded'
    : '✘ MISSING — check your .env');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { WebSocket } = require('ws');
const socketIO = require('socket.io');
const yahooFinance = require('yahoo-finance2').default;
const axios = require('axios');
const PREDICT_URL = process.env.PREDICT_URL || 'http://localhost:8000';
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT === '465', // true on 465, false on 587
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});


// app and server setup
const app = express();
const server = http.createServer(app);
const io = socketIO(server, { cors: { origin: '*' } });

// middleware
app.use(express.json());

// Serve ALL of /public (login.html, dashboard.html, CSS, JS, etc.)
app.use(express.static(path.join(__dirname, 'public')));


// mongodb setup
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => console.error('MongoDB error', err));

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    emailVerified: { type: Boolean, default: false },
    verifyToken: { type: String },
    resetToken: { type: String },
    resetTokenExpiration: { type: Date },
    holdings: [
        {
            ticker: { type: String, required: true },
            quantity: { type: Number, required: true },
            price: { type: Number, required: true }
        }
    ]
});


const User = mongoose.model('User', userSchema);
// added for polygon api
const fetch = require('node-fetch');

// auth helper
function authenticateToken(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.sendStatus(401);
    const token = auth.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
        if (err) return res.sendStatus(403);
        req.user = payload;
        next();
    });
}

// auth routes
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).send('Email + password required');

    // 1) Hash & create user
    const hash = await bcrypt.hash(password, 10);
    const token = crypto.randomBytes(32).toString('hex');
    let user;
    try {
        user = await User.create({ email, passwordHash: hash, verifyToken: token });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).send('Email already exists');
        }
        console.error(err);
        return res.status(500).send('Registration failed');
    }

    // 2) Prepare recipient and log it
    const recipient = user.email;
    console.log('📧 Preparing to send verification to:', recipient);
    if (!recipient) {
        console.error('❌ No email on user object – skipping email send');
    } else {
        // 3) Send verification email benny boi
        const verifyUrl = `${process.env.APP_URL}/verify?token=${user.verifyToken}`;
        try {
            const info = await transporter.sendMail({
                from: `"BeavantBrokers" <${process.env.SMTP_USER}>`,
                to: recipient,                 // <-- use user.email here
                subject: 'Please verify your email',
                html: `<p>Welcome to BeavantBrokers!</p>
              <p>Click <a href="${verifyUrl}">here</a> to verify your email address.</p>`
            });
            console.log('✉️  Verification email sent:', info.messageId);
        } catch (mailErr) {
            console.error('❌ Email send error:', mailErr);
            // We do NOT return an error here, so signup still succeeds
        }
    }

    // 3) Always return success cleevn't
    res.status(201).json({ id: user._id, email: user.email });
});


app.get('/verify', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).send('Token required');
    const user = await User.findOne({ verifyToken: token });
    if (!user) return res.status(400).send('Invalid or expired token');

    user.emailVerified = true;
    user.verifyToken = undefined;
    await user.save();

    // redirect back to login with a success message
    res.redirect('/?verified=1');
});

app.post("/forgot-password", async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(404).send("User not found");

    const token = crypto.randomBytes(32).toString("hex");
    const expiration = new Date(Date.now() + 3600000); // 1 hour

    user.resetToken = token;
    user.resetTokenExpiration = expiration;
    await user.save();

    const resetLink = `${process.env.APP_URL}/reset-password.html?token=${token}`;

    await transporter.sendMail({
        from: `"BeavantBrokers" <${process.env.SMTP_USER}>`,
        to: user.email,
        subject: "Password Reset",
        html: `<p>Click to reset your password: <a href="${resetLink}">${resetLink}</a></p>`
    });

    res.send("Reset link sent to your email.");
});

app.post("/reset-password", async (req, res) => {
    const { token, newPassword } = req.body;
    const user = await User.findOne({
        resetToken: token,
        resetTokenExpiration: { $gt: new Date() }
    });

    if (!user) return res.status(400).send("Invalid or expired token");

    const hash = await bcrypt.hash(newPassword, 10);
    user.passwordHash = hash;
    user.resetToken = undefined;
    user.resetTokenExpiration = undefined;

    // ✅ Mark email as verified if not already
    user.emailVerified = true;

    await user.save();
    res.send("Password has been reset successfully");
});


app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).send('Invalid credentials');

    if (!user.emailVerified) {
        return res.status(403).send('Please verify your email before logging in');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).send('Invalid credentials');

    const token = jwt.sign(
        { userId: user._id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '2h' }
    );
    res.json({ token });
});

app.post('/api/saveHoldings', authenticateToken, async (req, res) => {
    const email = req.user.email;
    const holdings = req.body;

    await User.updateOne(
        { email },
        { $set: { holdings } },
        { upsert: true }
    );
    res.sendStatus(200);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Sign-Up page
app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});


app.get('/me', authenticateToken, (req, res) => {
    res.json({ message: 'You are logged in', user: req.user });
});

app.get('/api/loadHoldings', authenticateToken, async (req, res) => {
    const user = await User.findOne({ email: req.user.email });
    res.json(user?.holdings || []);
});

// return current market price for single stock
app.get('/api/quote', authenticateToken, async (req, res) => {
    const symbol = (req.query.symbol || '').trim().toUpperCase();
    if (!symbol) {
        return res.status(400).json({ error: 'Missing symbol parameter' });
    }

    try {
        const quote = await yahooFinance.quote(symbol);
        if (!quote || typeof quote.regularMarketPrice !== 'number') {
            return res.status(404).json({ error: `No price for ${symbol}` });
        }
        return res.json({
            symbol: quote.symbol,
            price: quote.regularMarketPrice
        });
    } catch (err) {
        console.error(`[API /api/quote] Error fetching ${symbol}:`, err.message);
        return res.status(500).json({ error: `Failed to pull price for ${symbol}` });
    }
});

// polygon api calling
app.get('/api/history', authenticateToken, async (req, res) => {
    try {
        const { symbol, range } = req.query;
        const now = Date.now();
        let from;
        switch (range) {
            case '1d': from = now - 24 * 3600 * 1000; break;
            case '1w': from = now - 7 * 24 * 3600 * 1000; break;
            case '1m': from = now - 30 * 24 * 3600 * 1000; break;
            case '1y': from = now - 365 * 24 * 3600 * 1000; break;
            default: return res.status(400).send('Invalid range');
        }

        let timespan, multiplier;
        if (range === '1d' || range === '1w') {
            timespan = 'minute';
            multiplier = 1;
        } else if (range === '1m') {
            timespan = 'minute';
            multiplier = 5;
        } else {
            timespan = 'hour';
            multiplier = 1;
        }

        const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
            `/range/${multiplier}/${timespan}/${from}/${now}` +
            `?adjusted=true&sort=asc&limit=50000&apiKey=${process.env.POLYGON_API_KEY}`;

        console.log('Calling Polygon:', url);
        console.log('Using key:', process.env.POLYGON_API_KEY ? '***present***' : '***MISSING***');

        const polyRes = await axios.get(url);
        const polyJson = polyRes.data;
        console.log('🛰️  Polygon raw response:', polyJson);

        if (!Array.isArray(polyJson.results)) {
            return res
                .status(500)
                .json({ error: polyJson.error || 'Polygon returned no results' });
        }

        const bars = polyJson.results.map(r => ({
            t: r.t,
            o: r.o,
            h: r.h,
            l: r.l,
            c: r.c,
            v: r.v
        }));
        res.json(bars);
    } catch (err) {
        console.error('History fetch error', err);
        res.status(500).send('Server error');
    }
});

// open/close endpoint
app.get('/api/open-close/:symbol/:date', authenticateToken, async (req, res) => {
    const { symbol, date } = req.params;
    try {
        const { data } = await axios.get(
            `https://api.polygon.io/v1/open-close/${symbol}/${date}`,
            { params: { adjusted: true, apiKey: process.env.POLYGON_API_KEY } }
        );
        return res.json(data);
    } catch (err) {
        console.error('❌ open-close error', err.response?.status, err.message);
        return res.status(502).send('Open-close fetch failed');
    }
});

// last quote endpoint
app.get('/api/last-quote/:symbol', authenticateToken, async (req, res) => {
    const { symbol } = req.params;
    try {
        const { data } = await axios.get(
            `https://api.polygon.io/v1/last_quote/stocks/${symbol}`,
            { params: { apiKey: process.env.POLYGON_API_KEY } }
        );
        return res.json(data);
    } catch (err) {
        console.error('❌ last-quote error', err.response?.status, err.message);
        return res.status(502).send('Last-quote fetch failed');
    }
});


// next-day ML prediction proxy
app.get('/api/predict', async (req, res) => {
    const { symbol } = req.query;
    const url = `${PREDICT_URL}/predict?symbol=${encodeURIComponent(symbol)}`;
    const MAX_RETRIES = 3, BACKOFF = 500;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const resp = await fetch(url, {
                headers: { Authorization: `Bearer ${process.env.API_TOKEN}` }
            });
            const text = await resp.text();          // always grab raw payload

            if (!resp.ok) {
                console.warn(`[Predict][${attempt}] ${resp.status}:`, text);
                throw new Error(`Status ${resp.status}`);
            }

            const payload = JSON.parse(text);        // throws if HTML i hate this error UGH 
            return res.status(200).json(payload);
        } catch (err) {
            console.error(`[Predict][${attempt}] Error:`, err.message);
            if (attempt === MAX_RETRIES) {
                return res.status(502).json({ error: 'Prediction service unavailable' });
            }
            await new Promise(r => setTimeout(r, BACKOFF));
        }
    }
});



// websocket feed and socket.io auth to cleavn't
const upstream = new WebSocket(`${process.env.STREAM_URL}?token=${process.env.STREAM_KEY}`);
upstream.on('open', () => console.log('🔗 Connected upstream'));
upstream.on('message', msg => io.emit('priceUpdate', JSON.parse(msg)));
upstream.on('error', console.error);

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Auth token missing'));
    jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
        if (err) return next(new Error('Invalid auth token'));
        socket.user = payload;
        next();
    });
});
const activePollers = new Map();

// check if market is open
function isMarketOpen() {
    const now = new Date();
    const day = now.getUTCDay(); // Sunday = 0, Saturday = 6
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const isWeekday = day >= 1 && day <= 5;
    const isOpen = (hour > 13 || (hour === 13 && minute >= 30)) && hour < 20;
    return isWeekday && isOpen;
}

setInterval(() => {
    io.emit('marketStatus', { open: isMarketOpen() });
}, 10000); // Update market status every 10s

io.on('connection', socket => {
    console.log(`Client connected [id=${socket.id}]`);

    socket.on('subscribe', symbol => {
        const upperSymbol = symbol.toUpperCase();
        if (activePollers.has(upperSymbol)) return;

        console.log(`📡 Subscribing to ${upperSymbol}`);

        const intervalId = setInterval(async () => {
            try {
                const quote = await yahooFinance.quote(upperSymbol);
                io.emit('priceUpdate', {
                    symbol: quote.symbol,
                    price: quote.regularMarketPrice,
                    timestamp: quote.regularMarketTime * 1000,
                    change: quote.regularMarketChange,
                    changePercent: quote.regularMarketChangePercent,
                });
            } catch (err) {
                console.error(`[Polling ${upperSymbol}]`, err.message);
            }
        }, 1000);

        activePollers.set(upperSymbol, intervalId);
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected [id=${socket.id}]`);
    });
});

io.on('connection', socket => {
    console.log(`👤 ${socket.user.email} connected to Socket.IO`);
});

// connect to price stream
const priceWs = new WebSocket(
    `${process.env.STREAM_URL}?token=${process.env.STREAM_KEY}`
);
priceWs.on('open', () =>
    console.log('✅ Connected to price stream:', process.env.STREAM_URL)
);
priceWs.on('message', raw => {
    let tick;
    try {
        tick = JSON.parse(raw);
    } catch (e) {
        console.error('Invalid price data:', e);
        return;
    }
    io.emit('priceUpdate', tick);
});
priceWs.on('error', err =>
    console.error('Price stream error:', err)
);

// poll single stock
function startYahooPolling(symbol, intervalMs = 5000) {
    setInterval(async () => {
        yahooFinance.suppressNotices(['yahooSurvey']);
        try {
            const quote = await yahooFinance.quote(symbol);
            // quote looks like:  { symbol: 'AAPL', regularMarketPrice: 172.25, regularMarketTime: 1691601234, … }
            io.emit('stockData', {
                symbol: quote.symbol,
                price: quote.regularMarketPrice,
                timestamp: quote.regularMarketTime * 1000, // convert to ms
                change: quote.regularMarketChange,
                changePercent: quote.regularMarketChangePercent,
                // will add more fields later
            });
        } catch (err) {
            console.error(`[YahooPolling] Error fetching ${symbol}:`, err.message);
        }
    }, intervalMs);
}

// when client connects, stat polling
io.on('connection', socket => {
    console.log(`Client connected [id=${socket.id}]`);
    const defaultSymbol = 'AAPL';
    if (!io.hasStartedPolling) {
        startYahooPolling(defaultSymbol, 5000);
        io.hasStartedPolling = true;
    }

    socket.on('subscribe', symbol => {
        console.log(`Client ${socket.id} wants to subscribe to ${symbol}`);
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected [id=${socket.id}]`);
    });
});

// start server and connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => {
        const PORT = process.env.PORT || 4000;
        server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
    })
    .catch(err => console.error('MongoDB error', err));


// portfolio recommendations 

const yahoo = require('yahoo-finance2').default;

// helper to compute sd
function std(arr) {
    const μ = arr.reduce((sum, x) => sum + x, 0) / arr.length;
    return Math.sqrt(arr.reduce((sum, x) => sum + (x - μ) ** 2, 0) / (arr.length - 1));
}

// analysis
app.post('/api/portfolio-analysis', authenticateToken, async (req, res) => {
    try {
        const holdings = req.body.holdings; // [{ ticker, quantity }]
        if (!Array.isArray(holdings) || holdings.length === 0) {
            return res.status(400).json({ error: 'No holdings provided' });
        }

        // mkt values and weights
        const quotes = await Promise.all(
            holdings.map(h => yahoo.quote(h.ticker).catch(() => null))
        );
        let totalValue = 0;
        const items = holdings.map((h, i) => {
            const price = quotes[i]?.regularMarketPrice || 0;
            const value = price * h.quantity;
            totalValue += value;
            return { ticker: h.ticker, quantity: h.quantity, price, value };
        });
        items.forEach(it => it.weight = totalValue ? it.value / totalValue : 0);

        // concentration (top 3 holdings)
        const sorted = [...items].sort((a, b) => b.weight - a.weight);
        const top3Weight = sorted.slice(0, 3).reduce((sum, x) => sum + x.weight, 0);

        // fetch 1y daily history for each ticker + spy
        const end = new Date();
        const start = new Date(end);
        start.setFullYear(start.getFullYear() - 1);

        const history = await Promise.all(
            sorted.map(it =>
                yahoo.historical(it.ticker, { period1: start, period2: end, interval: '1d' })
            )
        );
        const spyHist = await yahoo.historical('SPY', { period1: start, period2: end, interval: '1d' });

        // daily returns
        const getReturns = data =>
            data
                .map((d, i, arr) => i > 0 && d.close && arr[i - 1].close
                    ? (d.close - arr[i - 1].close) / arr[i - 1].close
                    : null
                )
                .filter(x => x != null);

        const spyReturns = getReturns(spyHist);

        // portfolio returns = sum(weight_i * ret_i)
        const portReturns = history[0].map((_, dayIdx) => {
            if (dayIdx === 0) return null;
            let r = 0, valid = true;
            for (let j = 0; j < sorted.length; j++) {
                const series = getReturns(history[j]);
                if (!series[dayIdx - 1]) { valid = false; break; }
                r += series[dayIdx - 1] * sorted[j].weight;
            }
            return valid ? r : null;
        }).filter(x => x != null);

        // volatility and VaR
        const vol = std(portReturns);
        const sortedR = [...portReturns].sort((a, b) => a - b);
        const var95 = sortedR[Math.floor(0.05 * sortedR.length)];

        // beta: cov(port, SPY) / var(SPY)
        function cov(a, b) {
            const μa = a.reduce((s, x) => s + x, 0) / a.length;
            const μb = b.reduce((s, x) => s + x, 0) / b.length;
            return a.reduce((s, x, i) => s + (x - μa) * (b[i] - μb), 0) / (a.length - 1);
        }
        const beta = cov(portReturns, spyReturns) / (std(spyReturns) ** 2);

        // sector cleavent breakdown (via quote.summary.profile.sector)
        const profiles = await Promise.all(
            sorted.map(it =>
                yahoo.quoteSummary(it.ticker, { modules: ['assetProfile'] })
                    .then(r => r.assetProfile?.sector || 'Unknown')
                    .catch(() => 'Unknown')
            )
        );
        const sectorMap = {};
        sorted.forEach((it, i) => {
            sectorMap[profiles[i]] = (sectorMap[profiles[i]] || 0) + it.weight;
        });

        // build recommendations
        const recs = [];
        if (top3Weight > 0.4) {
            recs.push({
                title: 'Too concentrated',
                text: `Your top 3 holdings make up ${(top3Weight * 100).toFixed(1)}% of your portfolio — consider diversifying.`
            });
        }
        if (vol > 0.02) {
            recs.push({
                title: 'Volatility',
                text: `Your portfolio volatility is ${(vol * 100).toFixed(2)}% daily. If you would like to reduce risk, consider lower‐beta or defensive assets.`
            });
        }
        recs.push({
            title: 'Beta vs. SPY',
            text: `Your portfolio beta is ${beta.toFixed(2)} (vs. SPY). ${beta > 1 ? 'You will swing more than the market.' : 'You are less reactive than the market.'}`
        });

        // reply
        return res.json({
            metrics: {
                volatility: vol,
                var95,
                beta,
                concentrationTop3: top3Weight,
                sectorWeights: sectorMap
            },
            recommendations: recs
        });
    } catch (err) {
        console.error('Portfolio analysis error:', err);
        res.status(500).json({ error: 'Analysis failed' });
    }
});

