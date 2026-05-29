"""
generate_synthetic.py
---------------------
Generates a CSV file with labelled synthetic sensor readings for model
training when real Firestore data is scarce (< 100 readings).

Output:
    scripts/synthetic_data.csv

Columns:
    llama, gas, movimiento, label
    label encoding: 0 = normal, 1 = medio, 2 = alto

Sensor references:
    MQ-2  gas sensor    : 12-bit ADC on ESP32, practical range 0-1023
    KY-026 flame sensor : digital 0 = no flame, 1 = flame detected
    PIR motion sensor   : digital 0 = no motion, 1 = motion detected

IMPORTANT: Adjust ALTO_GAS_THRESHOLD and MEDIO_GAS_THRESHOLD to match
the baseline readings of your specific sensor unit and environment.
Run several minutes of normal-operation readings in your field and use
the 90th percentile of gas as the ALTO threshold.
"""

import numpy as np
import pandas as pd
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

RANDOM_SEED   = 42
N_NORMAL      = 700   # Class sizes reflect a realistic real-world imbalance.
N_MEDIO       = 250   # Fires and elevated gas are rare events.
N_ALTO        = 150

GAS_NOISE_STD = 50    # Gaussian noise applied to gas readings (ADC units).

# Gas thresholds (ADC units, 12-bit ESP32 ADC, range 0-4095).
# Calibrated to observed clean-air baseline of ~550 ADC on the deployed sensor.
#   MEDIO : ~2x baseline — clearly elevated gas concentration.
#   ALTO  : ~3.5x baseline — dangerous concentration or flame present.
# Adjust these values if your sensor's clean-air baseline drifts.
ALTO_GAS_THRESHOLD  = 1800
MEDIO_GAS_THRESHOLD = 1100

# Motion sensor note:
# main.cpp uses !digitalRead(MOVE_PIN), so the transmitted value is INVERTED:
#   movimiento = 1  ->  NO motion detected  (normal idle state)
#   movimiento = 0  ->  motion detected
# Synthetic data must reflect this encoding.
MOTION_DETECTED = 0   # value transmitted when motion IS detected

OUTPUT_PATH = Path(__file__).parent / "synthetic_data.csv"

# ---------------------------------------------------------------------------
# Label encoding — must stay in sync with train_model.py and ml.service.js.
# ---------------------------------------------------------------------------

LABEL_NORMAL = 0
LABEL_MEDIO  = 1
LABEL_ALTO   = 2


# ---------------------------------------------------------------------------
# Sample generation
# ---------------------------------------------------------------------------

def generate_samples(rng: np.random.Generator) -> pd.DataFrame:
    """Create labelled synthetic rows for all three risk classes."""
    rows = []

    # --- normal: no flame, low gas, no motion (movimiento=1 in idle state) --
    gas_normal = rng.uniform(400, MEDIO_GAS_THRESHOLD - 100, N_NORMAL)
    gas_normal += rng.normal(0, GAS_NOISE_STD, N_NORMAL)
    gas_normal  = np.clip(gas_normal, 0, 4095)

    for i in range(N_NORMAL):
        rows.append({
            "llama":      0,
            "gas":        float(gas_normal[i]),
            "movimiento": 1,          # idle: no motion (inverted PIR)
            "label":      LABEL_NORMAL,
        })

    # --- medio: elevated gas or motion present ------------------------------
    gas_medio = rng.uniform(MEDIO_GAS_THRESHOLD, ALTO_GAS_THRESHOLD, N_MEDIO)
    gas_medio += rng.normal(0, GAS_NOISE_STD, N_MEDIO)
    gas_medio  = np.clip(gas_medio, 0, 4095)

    for i in range(N_MEDIO):
        rows.append({
            "llama":      0,
            "gas":        float(gas_medio[i]),
            "movimiento": int(rng.integers(0, 2)),  # mixed motion state
            "label":      LABEL_MEDIO,
        })

    # --- alto: flame detected OR very high gas ------------------------------
    # Split half-and-half so the model learns both triggers independently.
    n_flame    = N_ALTO // 2
    n_high_gas = N_ALTO - n_flame

    for _ in range(n_flame):
        rows.append({
            "llama":      1,
            "gas":        float(np.clip(
                rng.uniform(800, 4000) + rng.normal(0, GAS_NOISE_STD), 0, 4095
            )),
            "movimiento": MOTION_DETECTED,  # fire scenario: motion likely present
            "label":      LABEL_ALTO,
        })

    gas_high = rng.uniform(ALTO_GAS_THRESHOLD, 4095, n_high_gas)
    gas_high += rng.normal(0, GAS_NOISE_STD, n_high_gas)
    gas_high  = np.clip(gas_high, 0, 4095)

    for i in range(n_high_gas):
        rows.append({
            "llama":      0,
            "gas":        float(gas_high[i]),
            "movimiento": MOTION_DETECTED,
            "label":      LABEL_ALTO,
        })

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    rng = np.random.default_rng(RANDOM_SEED)
    df  = generate_samples(rng)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUTPUT_PATH, index=False)

    label_names = {LABEL_NORMAL: "normal", LABEL_MEDIO: "medio", LABEL_ALTO: "alto"}
    print(f"Generated {len(df)} synthetic samples -> {OUTPUT_PATH}")
    print(df["label"].value_counts().rename(label_names).to_string())


if __name__ == "__main__":
    main()
