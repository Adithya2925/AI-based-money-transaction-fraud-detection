const { spawn } = require('child_process');
const path = require('path');

const analyzeTransaction = async (data) => {
    const { amount, userId, receiver_upi_id, freq, device_change, new_recipient, user_avg_amount, is_unusual_time } = data;
    const time_of_day = new Date().getHours();

    return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python', [
            path.join(__dirname, '../../ml/predict.py'),
            amount,
            time_of_day,
            freq,
            device_change,
            new_recipient
        ]);

        let result = '';
        pythonProcess.stdout.on('data', (data) => {
            result += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            console.error(`Python error: ${data}`);
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                return reject('Failed to run ML model');
            }
            try {
                const mlOutput = JSON.parse(result);
                if (!mlOutput.success) {
                    return reject(mlOutput.error);
                }

                // ─────────────────────────────────────────────────────────────────────────────
                // COMPREHENSIVE RULE-BASED ENGINE
                // ─────────────────────────────────────────────────────────────────────────────
                let ruleScore = 0;
                let reasons = [];

                // 1. Amount Checks
                if (amount > 40000) {
                    ruleScore += 45;
                    reasons.push('Critically high transaction amount (>40k)');
                } else if (amount > 15000) {
                    ruleScore += 25;
                    reasons.push('High transaction amount (>15k)');
                }
                
                if (user_avg_amount > 0) {
                    if (amount > (user_avg_amount * 5)) {
                        ruleScore += 40;
                        reasons.push('Amount is 5x higher than your average spend');
                    } else if (amount > (user_avg_amount * 2.5)) {
                        ruleScore += 25;
                        reasons.push('Amount significantly exceeds user average');
                    }
                }

                // 2. Velocity & Frequency
                if (freq > 5) {
                    ruleScore += 20;
                    reasons.push('Rapid repeats (velocity attack)');
                }

                // 3. Device & Identity
                if (device_change === 1) {
                    ruleScore += 30;
                    reasons.push('New device detected');
                }
                if (new_recipient === 1) {
                    ruleScore += 15;
                    reasons.push('Transfer to a new recipient');
                }

                // 4. Behavioral / Time
                if (is_unusual_time === 1) {
                    ruleScore += 20;
                    reasons.push('Unusual time for this specific user');
                } else if (time_of_day < 5 || time_of_day > 23) {
                    ruleScore += 10;
                    reasons.push('Late night transaction (general risk)');
                }

                // 5. Simulated Location / Impossible Travel
                // (In a real app, you'd pass lat/long or IP)
                const isProxyDetected = Math.random() < 0.05; // Mock 5% proxy detection
                if (isProxyDetected) {
                    ruleScore += 40;
                    reasons.push('Proxy/VPN usage detected');
                }

                // Combine ML probability with rules (Weighted Avg)
                const mlProb = mlOutput.probability;
                const mlScore = mlProb * 100;
                
                // Final score: 70% ML, 30% Rules (capped)
                const finalRiskScore = Math.min(100, (mlScore * 0.7) + (Math.min(100, ruleScore) * 0.3));

                let decision = 'APPROVED';
                if (finalRiskScore > 75) decision = 'BLOCKED';
                else if (finalRiskScore > 40) decision = 'WARNING';

                resolve({
                    risk_score: finalRiskScore,
                    decision,
                    reasons
                });
            } catch (err) {
                reject('Error parsing ML response');
            }
        });
    });
};

module.exports = { analyzeTransaction };
