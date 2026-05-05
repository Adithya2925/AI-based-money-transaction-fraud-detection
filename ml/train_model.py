import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, accuracy_score
import joblib
import os

# Create data directory if it doesn't exist
data_dir = '../data'
if not os.path.exists(data_dir):
    os.makedirs(data_dir)

def generate_synthetic_data(n_samples=1000):
    np.random.seed(42)
    
    # Features:
    # 1. Amount (0.1 to 100000)
    # 2. Time of day (0-23)
    # 3. Transaction Frequency (count in last hour)
    # 4. Device Change (0 or 1)
    # 5. Is New Recipient (0 or 1)
    
    amount = np.random.uniform(1, 50000, n_samples)
    time_of_day = np.random.randint(0, 24, n_samples)
    freq = np.random.randint(1, 20, n_samples)
    device_change = np.random.randint(0, 2, n_samples)
    new_recipient = np.random.randint(0, 2, n_samples)
    
    # Logic for fraud (y):
    # - High amount (> 45000)
    # - Device change AND new recipient
    # - High frequency (> 15) AND late night (0-5)
    
    fraud = []
    for i in range(n_samples):
        score = 0
        if amount[i] > 35000: score += 50
        if device_change[i] == 1: score += 40
        if new_recipient[i] == 1: score += 30
        if freq[i] > 8: score += 35
        if time_of_day[i] < 6 or time_of_day[i] > 23: score += 25
        
        # Randomness
        score += np.random.normal(0, 5) # Reduced noise for clearer patterns
        
        if score > 60: # Lowered threshold (from 75)
            fraud.append(1)
        else:
            fraud.append(0)
            
    df = pd.DataFrame({
        'amount': amount,
        'time_of_day': time_of_day,
        'frequency': freq,
        'device_change': device_change,
        'new_recipient': new_recipient,
        'is_fraud': fraud
    })
    
    df.to_csv(os.path.join(data_dir, 'upi_transactions.csv'), index=False)
    print(f"Generated {n_samples} samples.")
    return df

def train():
    df = generate_synthetic_data(5000)
    
    X = df.drop('is_fraud', axis=1)
    y = df['is_fraud']
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X_train, y_train)
    
    y_pred = model.predict(X_test)
    print("Accuracy:", accuracy_score(y_test, y_pred))
    print("\nClassification Report:\n", classification_report(y_test, y_pred))
    
    # Save model in the same directory as this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(script_dir, 'fraud_model.joblib')
    joblib.dump(model, model_path)
    print(f"Model saved as {model_path}")

if __name__ == "__main__":
    train()
