const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const User = require('./models/User');
const Transaction = require('./models/Transaction');
const { analyzeTransaction } = require('./services/fraudEngine');

const app = express();

// Allow all origins (required for Android device on local network)
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || '0bb65debc39bacbda6c3202b3ac6db433d2b424dd431b0dcfb362ec7a5374ee477a3489720d898cb95de2f718ef09739d63ab71a27f97c35b2955c2851ccdd32';

// Health check — test this from Android browser: http://YOUR_IP:5000/health
app.get('/health', (req, res) => res.json({ status: 'ok', message: 'Server is running' }));

let isDbConnected = false;
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fraud_detection_upi')
    .then(() => { console.log('✅ Connected to MongoDB'); isDbConnected = true; })
    .catch(err => console.error('❌ MongoDB connection error:', err));

// Guard middleware — returns clear error if DB isn't up
const requireDb = (req, res, next) => {
    if (!isDbConnected) {
        return res.status(503).json({ msg: 'Database not connected. Make sure MongoDB is running on port 27017.' });
    }
    next();
};

// Auth MiddleWare
const auth = (req, res, next) => {
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(400).json({ msg: 'Token is not valid' });
    }
};

// Routes
app.post('/api/auth/signup', requireDb, async (req, res) => {
    try {
        const { name, email, password, upi_id } = req.body;
        if (!name || !email || !password || !upi_id) {
            return res.status(400).json({ msg: 'All fields are required (name, email, password, upi_id)' });
        }
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ msg: 'User already exists with this email' });

        const existingUpi = await User.findOne({ upi_id });
        if (existingUpi) return res.status(400).json({ msg: 'UPI ID already taken' });
        
        user = new User({ name, email, password, upi_id });
        await user.save();
        
        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user._id, name, upi_id } });
    } catch (err) {
        console.error('Signup error:', err.message);
        res.status(500).json({ msg: err.message || 'Server error during signup' });
    }
});

app.post('/api/auth/login', requireDb, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ msg: 'Email and password are required' });

        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ msg: 'No account found with this email' });
        
        const bcrypt = require('bcryptjs');
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ msg: 'Incorrect password' });

        const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user._id, name: user.name, upi_id: user.upi_id, isFrozen: user.isFrozen } });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ msg: err.message || 'Server error during login' });
    }
});

app.post('/api/transactions/process', auth, async (req, res) => {
    try {
        const { receiver_upi_id, amount, device_change, new_recipient } = req.body;
        const user = await User.findById(req.user.id);

        if (user.isFrozen && user.frozenUntil > new Date()) {
            return res.status(403).json({ 
                msg: 'Account frozen due to multiple high-risk attempts. Try later.',
                decision: 'BLOCKED'
            });
        } else if (user.isFrozen) {
            user.isFrozen = false;
            await user.save();
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // SIMULATED REAL-WORLD UPI VERIFICATION
        // ─────────────────────────────────────────────────────────────────────────────
        
        // 1. Basic Format Validation (Regex)
        const upi_regex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
        if (!upi_regex.test(receiver_upi_id)) {
            return res.status(400).json({ 
                msg: 'Invalid UPI ID format. Please use a valid handle (e.g., user@bank).',
                decision: 'BLOCKED'
            });
        }

        // 2. Simulated "External Registry Lookup" delay (mimicking real NPCI check)
        await new Promise(resolve => setTimeout(resolve, 800));

        // 3. Mock "Real World" blacklist (IDs found online to be malicious)
        const mockBlacklist = ['fraud@paytm', 'scammer@okaxis', 'lottery@sbi'];
        if (mockBlacklist.includes(receiver_upi_id.toLowerCase())) {
            return res.status(400).json({ 
                msg: 'SECURITY ALERT: This UPI ID has been reported for fraudulent activity in the real world.',
                decision: 'BLOCKED'
            });
        }

        // Verify if receiver exists in local DB (for internal simulation)
        const receiver = await User.findOne({ upi_id: receiver_upi_id });
        
        // Determine if this is truly a new recipient for THIS user
        const previousTx = await Transaction.findOne({ 
            sender: user._id, 
            receiver_upi_id: receiver_upi_id,
            status: 'APPROVED' 
        });
        
        let effective_new_recipient = previousTx ? 0 : 1;
        
        if (!receiver && effective_new_recipient === 1) {
            console.log(`ℹ️ External recipient detected: ${receiver_upi_id}. Verified via mock registry.`);
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // BEHAVIORAL PROFILING (User Baseline)
        // ─────────────────────────────────────────────────────────────────────────────
        
        // 1. Frequency check (Velocity)
        const freq = await Transaction.countDocuments({ 
            sender: user._id, 
            createdAt: { $gt: new Date(Date.now() - 3600000) } 
        });

        // 2. Average Spend Check (Deviation from normal)
        const userHistory = await Transaction.find({ sender: user._id }).limit(20);
        let user_avg_amount = 0;
        let is_unusual_time = 0;

        if (userHistory.length > 0) {
            const sum = userHistory.reduce((acc, tx) => acc + tx.amount, 0);
            user_avg_amount = sum / userHistory.length;
            
            // Unusual time check (e.g., 3 AM vs typical daytime)
            const currentHour = new Date().getHours();
            const typicalHours = userHistory.map(tx => new Date(tx.createdAt).getHours());
            const hourDiffs = typicalHours.map(h => Math.abs(h - currentHour));
            const minDiff = Math.min(...hourDiffs);
            if (minDiff > 6) is_unusual_time = 1; // Significant deviation from usual hours
        }

        // Run Fraud Engine
        const analysis = await analyzeTransaction({
            amount, 
            userId: user._id, 
            receiver_upi_id, 
            freq, 
            device_change, 
            new_recipient: effective_new_recipient,
            user_avg_amount,
            is_unusual_time
        });

        const transaction = new Transaction({
            sender: user._id,
            receiver_upi_id,
            amount,
            status: analysis.decision,
            risk_score: analysis.risk_score,
            fraud_reasons: analysis.reasons
        });

        await transaction.save();

        // Handle Smart Freeze (ifrisk > 90%)
        if (analysis.risk_score > 90) {
            user.isFrozen = true;
            user.frozenUntil = new Date(Date.now() + 600000); // 10 minutes
            await user.save();
        }

        res.json({ 
            decision: analysis.decision, 
            risk_score: Math.round(analysis.risk_score), 
            reasons: analysis.reasons,
            transaction_id: transaction._id
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Processing error' });
    }
});

app.get('/api/dashboard/stats', auth, async (req, res) => {
    try {
        const totalTx = await Transaction.countDocuments({ sender: req.user.id });
        const blockedTx = await Transaction.countDocuments({ sender: req.user.id, status: 'BLOCKED' });
        const history = await Transaction.find({ sender: req.user.id }).sort({ createdAt: -1 }).limit(10);
        
        res.json({
            totalTransactions: totalTx,
            blockedTransactions: blockedTx,
            fraudPercentage: totalTx ? ((blockedTx / totalTx) * 100).toFixed(1) : 0,
            history
        });
    } catch (err) {
        res.status(500).json({ msg: 'Stats error' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Server running on network at http://0.0.0.0:${PORT}`);
});
