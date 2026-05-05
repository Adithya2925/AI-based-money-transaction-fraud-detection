import sys
import json
import os
import numpy as np
import joblib

# Use script's own directory to find the model — works regardless of CWD
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(SCRIPT_DIR, 'fraud_model.joblib')

def predict(amount, time_of_day, freq, device_change, new_recipient):
    try:
        model = joblib.load(MODEL_PATH)
        
        # Data processing
        features = np.array([[amount, time_of_day, freq, device_change, new_recipient]])
        
        # Probability estimation
        fraud_prob = model.predict_proba(features)[0][1]
        
        return {
            'success': True,
            'probability': fraud_prob,
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

if __name__ == "__main__":
    # Input expected as CLI arguments: amount, time, freq, device_change, new_recipient
    if len(sys.argv) < 6:
        print(json.dumps({'success': False, 'error': 'Missing transaction data'}))
        sys.exit(1)
        
    amount = float(sys.argv[1])
    time_of_day = int(sys.argv[2])
    freq = int(sys.argv[3])
    device_change = int(sys.argv[4])
    new_recipient = int(sys.argv[5])
    
    result = predict(amount, time_of_day, freq, device_change, new_recipient)
    print(json.dumps(result))
