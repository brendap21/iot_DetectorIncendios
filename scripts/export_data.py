"""
export_data.py
--------------
Exports historical sensor readings from Firestore to a CSV file so they
can be merged with synthetic data and used to retrain the ML models.

Firebase credentials are resolved in this order:
    1. GOOGLE_APPLICATION_CREDENTIALS environment variable (path to JSON)
    2. ../config/firebase-key.json  (relative to this script)

Output:
    scripts/real_data.csv

Columns:
    llama, gas, movimiento, label
    label encoding: 0 = normal, 1 = medio, 2 = alto

Readings that already have a 'riesgo' field use it as the label.
Unlabelled readings are auto-labelled with the same domain thresholds
used in generate_synthetic.py so both datasets stay consistent.
"""

import os
import sys
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------------
# Label thresholds — keep in sync with generate_synthetic.py
# 12-bit ESP32 ADC (0-4095). Calibrated to clean-air baseline of ~550 ADC.
# ---------------------------------------------------------------------------

ALTO_GAS_THRESHOLD  = 1800
MEDIO_GAS_THRESHOLD = 1100

# Motion encoding: main.cpp transmits !digitalRead(MOVE_PIN).
#   movimiento = 0  -> motion detected
#   movimiento = 1  -> no motion (idle)
MOTION_DETECTED = 1

RIESGO_TO_INT: dict[str, int] = {"normal": 0, "medio": 1, "alto": 2}

OUTPUT_PATH = Path(__file__).parent / "real_data.csv"


# ---------------------------------------------------------------------------
# Firebase initialization
# ---------------------------------------------------------------------------

def init_firebase():
    """Initialize Firebase Admin SDK and return a Firestore client."""
    import firebase_admin
    from firebase_admin import credentials, firestore

    # Avoid re-initializing if the app already exists.
    if firebase_admin._apps:
        return firestore.client()

    key_env  = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    key_file = Path(__file__).parent.parent / "config" / "firebase-key.json"

    if key_env:
        cred = credentials.Certificate(key_env)
    elif key_file.exists():
        cred = credentials.Certificate(str(key_file))
    else:
        print("ERROR: No Firebase credentials found.")
        print("  Option 1: set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json")
        print("  Option 2: place the service account key at config/firebase-key.json")
        sys.exit(1)

    firebase_admin.initialize_app(cred)
    return firestore.client()


# ---------------------------------------------------------------------------
# Labelling
# ---------------------------------------------------------------------------

def auto_label(llama: int, gas: float, movimiento: int) -> int:
    """
    Deterministic label assignment matching generate_synthetic.py thresholds.
    movimiento=0 means motion detected (inverted PIR logic from main.cpp).
    """
    if llama == 1 or gas > ALTO_GAS_THRESHOLD:
        return 2  # alto
    if movimiento == MOTION_DETECTED or gas > MEDIO_GAS_THRESHOLD:
        return 1  # medio
    return 0      # normal


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    db   = init_firebase()
    docs = db.collection("lecturas").stream()

    rows = []
    for doc in docs:
        data       = doc.to_dict()
        llama      = data.get("llama",      0)
        gas        = data.get("gas",        0)
        movimiento = data.get("movimiento", 0)
        riesgo     = data.get("riesgo")

        label = (
            RIESGO_TO_INT[riesgo]
            if riesgo in RIESGO_TO_INT
            else auto_label(int(llama), float(gas), int(movimiento))
        )

        rows.append({
            "llama":      int(llama),
            "gas":        float(gas),
            "movimiento": int(movimiento),
            "label":      label,
        })

    if not rows:
        print("No readings found in Firestore. Exiting.")
        return

    df = pd.DataFrame(rows)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUTPUT_PATH, index=False)

    label_names = {0: "normal", 1: "medio", 2: "alto"}
    print(f"Exported {len(df)} real readings -> {OUTPUT_PATH}")
    print(df["label"].value_counts().rename(label_names).to_string())


if __name__ == "__main__":
    main()
