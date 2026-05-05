const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiver_upi_id: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['APPROVED', 'BLOCKED', 'WARNING'], default: 'APPROVED' },
    risk_score: { type: Number, default: 0 },
    fraud_reasons: [{ type: String }],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', transactionSchema);
