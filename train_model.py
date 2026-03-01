import os
import yfinance as yf
import pandas as pd
import numpy as np
import joblib

from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error
SYMBOLS = [
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
]

MODEL_DIR = "models"
os.makedirs(MODEL_DIR, exist_ok=True)

already_trained = set(os.path.splitext(f)[0] for f in os.listdir(MODEL_DIR))

for sym in SYMBOLS:
    print(f"\nTraining model for {sym}…")

    df = yf.download(sym, period="2y", interval="1d").dropna()
    df["return_1d"] = df["Close"].pct_change()
    df["ma_5"]      = df["Close"].rolling(5).mean()
    df["vol_5"]     = df["Volume"].rolling(5).mean()
    df["target"]    = df["Close"].shift(-1)
    df = df.dropna()

    X = df[["Close","return_1d","ma_5","vol_5"]]
    y = df["target"]

    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=0.2, shuffle=False
    )
    model = RandomForestRegressor(n_estimators=200, random_state=42)
    model.fit(X_train, y_train)

    preds = model.predict(X_val)
    rmse  = np.sqrt(mean_squared_error(y_val, preds))
    print(f"  Validation RMSE for {sym}: {rmse:.2f}")

    path = os.path.join(MODEL_DIR, f"{sym}.joblib")
    joblib.dump(model, path)
    print(f"  Saved {sym} model to {path}")
