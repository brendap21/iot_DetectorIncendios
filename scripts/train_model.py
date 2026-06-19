"""
entrena_modelo.py
-----------------
Entrena y exporta modelos de ML para análisis de sensores IoT.

ENTRADA - Archivos CSV (auto-detectados, debe existir al menos uno):
    scripts/datos_sinteticos.csv  -- generado por generar_sinteticos.py
    scripts/datos_reales.csv      -- generado por exportar_datos.py (opcional)

SALIDA - Archivos guardados en models/:
    clasificador_riesgo.onnx      -- RandomForestClassifier (0=normal, 1=medio, 2=alto)
                                     Este es el modelo entrenado en formato ONNX
    anomaly_params.json           -- Parámetros estadísticos por sensor (media, desv. est, umbral Z)
                                     Usado por la función de detección de anomalías en Node.js
    baseline.json                 -- Métricas de validación en el conjunto test
                                     Se usa para detectar degradación del modelo

¿Cómo se usa?
    cd scripts
    pip install -r requirements.txt
    python generar_sinteticos.py       # genera datos de entrenamiento simulados
    python exportar_datos.py           # opcional: agrega datos reales de Firestore
    python entrena_modelo.py           # entrena y exporta todos los archivos
    # Commit los archivos generados en models/ a git para que Railway pueda usarlos
"""

import json
import sys
from pathlib import Path
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score, precision_score, recall_score, f1_score
from skl2onnx import to_onnx
from skl2onnx.common.data_types import FloatTensorType

# ============================================================================
# RUTAS DE ARCHIVOS
# ============================================================================
# Define dónde buscar archivos de entrada y dónde guardar los modelos

SCRIPTS_DIR = Path(__file__).parent
MODELS_DIR  = SCRIPTS_DIR.parent / "models"

# Archivos de datos de entrenamiento (entrada)
SYNTHETIC_CSV = SCRIPTS_DIR / "synthetic_data.csv"
REAL_CSV      = SCRIPTS_DIR / "real_data.csv"

# Archivos de modelo (salida)
CLASSIFIER_ONNX    = MODELS_DIR / "clasificador_riesgo.onnx"
ANOMALY_PARAMS_JSON = MODELS_DIR / "anomaly_params.json"
BASELINE_JSON       = MODELS_DIR / "baseline.json"

# ============================================================================
# CONFIGURACIÓN DE DETECCIÓN DE ANOMALÍAS
# ============================================================================
# Estos parámetros controlan cuándo el modelo marca una lectura como "anómala"

# ANOMALY_Z_THRESHOLD = número de desviaciones estándar para marcar como anomalía
# Valor más bajo = más sensible (detecta más anomalías)
# Valor más alto = menos sensible (solo detecta anomalías extremas)
# Valor recomendado: 2.5 (significa 99.4% de confianza estadística)
ANOMALY_Z_THRESHOLD = 2.5

# Orden de sensores - DEBE coincidir con el orden en ml.service.js
# Si cambias el orden aquí, tienes que cambiar en Node.js también
FEATURES = ["llama", "gas", "movimiento"]

# Nombres legibles de las clases que el modelo puede predecir
# 0 = normal, 1 = medio, 2 = alto (desde la perspectiva de riesgo de incendio)
LABEL_NAMES = ["normal", "medio", "alto"]

# ============================================================================
# CARGA DE DATOS DE ENTRENAMIENTO
# ============================================================================

def cargar_datos_entrenamiento() -> pd.DataFrame:
    """
    FUNCIÓN: Carga y fusiona archivos CSV para entrenamiento.
    
    ¿Qué hace?
    - Intenta cargar datos sintéticos Y datos reales (si existen)
    - Combina ambos en un solo DataFrame
    - Si no encuentra ningún archivo, termina con error claro
    
    REGRESA: DataFrame con columnas [llama, gas, movimiento, label]
    
    EJEMPLO:
        df = cargar_datos_entrenamiento()
        # df ahora tiene 1000 filas de datos listos para entrenar
    """
    archivos_cargados = []
    
    # Intenta cargar cada tipo de archivo
    for ruta_csv in (SYNTHETIC_CSV, REAL_CSV):
        if ruta_csv.exists():
            df = pd.read_csv(ruta_csv)
            archivos_cargados.append(df)
            print(f"  ✓ Cargadas {len(df):>5} filas de {ruta_csv.name}")
        else:
            print(f"  ✗ No encontrado: {ruta_csv.name}")

    # Validación: debe haber al menos un archivo
    if not archivos_cargados:
        print("\nERROR: No se encontraron datos de entrenamiento.")
        print("Primero ejecuta: python generar_sinteticos.py")
        sys.exit(1)

    # Fusiona todos los DataFrames y elimina valores vacíos (NaN)
    datos_fusionados = pd.concat(archivos_cargados, ignore_index=True).dropna()
    
    print(f"\n  Total después de fusionar: {len(datos_fusionados)} muestras")
    print("  Distribución de clases (cuántas de cada tipo):")
    print(datos_fusionados["label"].value_counts().rename(dict(enumerate(LABEL_NAMES))).to_string())
    
    return datos_fusionados


# ============================================================================
# ENTRENAMIENTO DEL MODELO
# ============================================================================

def entrenar_clasificador(X_entrenamiento: np.ndarray, y_entrenamiento: np.ndarray) -> RandomForestClassifier:
    """
    FUNCIÓN: Crea y entrena un Bosque Aleatorio (Random Forest).
    
    ¿QUÉ ES UN RANDOM FOREST?
    Es como tener 100 árboles de decisión diferentes que votan juntos:
    - Cada árbol aprende patrones diferentes de los datos
    - Cuando llega una predicción nueva, TODOS los árboles votan
    - La clase que más votos recibe es la predicción final
    - Esto lo hace más robusto que un solo árbol
    
    PARÁMETROS:
    - n_estimators=100: Crea 100 árboles (más árboles = mejor, pero más lento)
    - max_depth=8: Cada árbol puede tener máximo 8 niveles de profundidad
                   (evita overfitting, mantiene el modelo simple)
    - random_state=42: Usa semilla 42 para resultados reproducibles
                       (si ejecutas 2 veces, obtienes el MISMO modelo)
    - class_weight="balanced": Pondera automáticamente las clases
                   (si hay más "normal" que "alto", penaliza error en "alto")
    - n_jobs=-1: Usa todos los núcleos de la CPU para ir más rápido
    
    ENTRADA:
    - X_entrenamiento: Matriz de sensores [llama, gas, movimiento] (800 filas en 80%)
    - y_entrenamiento: Etiquetas [0=normal, 1=medio, 2=alto] (800 filas)
    
    SALIDA:
    - Modelo entrenado listo para hacer predicciones
    
    PROCESO INTERNO:
    1. RandomForest crea 100 árboles
    2. Cada árbol se entrena en un 63% aleatorio de los datos (bootstrap)
    3. El árbol aprende a dividir los sensores en regiones de clase
    4. Cuando termine, tienes 100 árboles votando
    """
    modelo_bosque = RandomForestClassifier(
        n_estimators=100,          # 100 árboles de decisión
        max_depth=8,               # Profundidad máxima de cada árbol
        random_state=42,           # Semilla para reproducibilidad
        class_weight="balanced",   # Pondera clases por frecuencia
        n_jobs=-1,                 # Usa todos los procesadores
    )
    
    # Entrena el modelo con los datos
    modelo_bosque.fit(X_entrenamiento, y_entrenamiento)
    
    return modelo_bosque


def calcular_parametros_anomalia(X_entrenamiento: np.ndarray) -> dict:
    """
    FUNCIÓN: Calcula la estadística de distribución normal para detección de anomalías.
    
    ¿CÓMO FUNCIONA LA DETECCIÓN DE ANOMALÍAS?
    Usa la Puntuación Z (Z-score):
    
    1. Calcula la MEDIA (promedio) de cada sensor en los datos normales
    2. Calcula la DESV. EST. (qué tanto varían los datos)
    3. Cuando llega un nuevo dato:
       - Si Z-score > 2.5 = muy lejos de la media = ANOMALÍA
       - Si Z-score <= 2.5 = dentro de lo normal
    
    EJEMPLO:
    - Gas promedio = 1104 ADC
    - Desv. Est. = 763
    - Llega lectura con gas=3300
    - Z-score = (3300 - 1104) / 763 = 2.88
    - 2.88 > 2.5 = ANOMALÍA DETECTADA
    
    ENTRADA:
    - X_entrenamiento: Matriz de 800 muestras normales [llama, gas, movimiento]
    
    SALIDA:
    - Diccionario con parámetros para Node.js:
      {
        "mean": [promedio_llama, promedio_gas, promedio_movimiento],
        "std": [desv_est_llama, desv_est_gas, desv_est_movimiento],
        "threshold": 2.5,
        "features": ["llama", "gas", "movimiento"]
      }
    """
    return {
        "mean":       X_entrenamiento.mean(axis=0).tolist(),  # Promedio de cada columna
        "std":        X_entrenamiento.std(axis=0).tolist(),   # Desv. Est. de cada columna
        "threshold":  ANOMALY_Z_THRESHOLD,                     # Umbral Z de 2.5
        "features":   FEATURES,                                # Nombres de sensores
    }


# ============================================================================
# EXPORTACIÓN DE MODELOS
# ============================================================================

def exportar_clasificador(modelo: RandomForestClassifier) -> None:
    """
    FUNCIÓN: Convierte el modelo RandomForest a formato ONNX y lo guarda.
    
    ¿QUÉ ES ONNX?
    - ONNX = "Open Neural Network Exchange"
    - Es un formato UNIVERSAL para modelos ML
    - Permite que Python entrene, pero Node.js pueda usar el modelo
    - Sin ONNX, tendríamos que mantener dos versiones del modelo
    
    FLUJO COMPLETO:
    1. Python entrena RandomForest (objeto sklearn)
    2. sklearn2onnx convierte a formato ONNX (archivo binario)
    3. Node.js puede cargar el ONNX con onnxruntime-node
    4. Node.js hace predicciones en tiempo real
    
    PARÁMETRO target_opset=12:
    - ONNX tiene diferentes versiones de operadores
    - opset=12 es compatible con la mayoría de runtimes
    
    PARÁMETRO zipmap=False:
    - Por defecto, ONNX convierte probabilidades a diccionario
    - Node.js no soporta eso
    - zipmap=False mantiene como tensores (matrices numéricas)
    
    SALIDA:
    - clasificador_riesgo.onnx (~100-200 KB)
    """
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    # Define la estructura de entrada: una fila de [llama, gas, movimiento] como float32
    tipo_entrada = [("X", FloatTensorType([None, len(FEATURES)]))]

    # Convierte el modelo sklearn a formato ONNX
    # zipmap=False: Evita conversión a diccionario (Node.js no lo soporta)
    # target_opset=12: Versión compatible
    modelo_onnx = to_onnx(
        modelo,
        initial_types=tipo_entrada,
        target_opset=12,
        options={id(modelo): {"zipmap": False}},
    )

    # Serializa (convierte a bytes) y guarda el archivo
    with open(CLASSIFIER_ONNX, "wb") as archivo:
        archivo.write(modelo_onnx.SerializeToString())

    # Muestra el tamaño del archivo
    tamaño_kb = CLASSIFIER_ONNX.stat().st_size / 1024
    print(f"\n  ✓ Clasificador -> {CLASSIFIER_ONNX}  ({tamaño_kb:.1f} KB)")


def exportar_parametros_anomalia(parametros: dict) -> None:
    """
    FUNCIÓN: Guarda los parámetros de detección de anomalías como JSON.
    
    ¿POR QUÉ NECESITAMOS ESTO?
    - Node.js necesita los parámetros estadísticos (media, desv. est.)
    - No puede cargar un modelo ONNX solo para eso
    - JSON es simple y rápido
    - Cada lectura de sensor se compara contra estos valores
    
    CONTENIDO DEL JSON:
    {
      "mean": [0.065, 1104, 0.768],      # Promedios de cada sensor
      "std": [0.246, 763, 0.422],        # Desv. Est. de cada sensor
      "threshold": 2.5,                   # Umbral Z-score
      "features": ["llama", "gas", "movimiento"]
    }
    
    USO EN NODE.JS:
    - Cuando llega un dato nuevo, calcula su Z-score
    - Si está muy lejos de la media = anomalía
    """
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    with open(ANOMALY_PARAMS_JSON, "w", encoding="utf-8") as archivo:
        json.dump(parametros, archivo, indent=2)

    print(f"  ✓ Parámetros anomalía -> {ANOMALY_PARAMS_JSON}")


def exportar_baseline(y_validacion: np.ndarray, predicciones: np.ndarray) -> None:
    """
    FUNCIÓN: Exporta métricas de validación como "baseline" (punto de referencia).
    
    ¿PARA QUÉ SIRVE?
    - Es tu "expectativa" de precisión del modelo
    - Se calcula en datos que el modelo NUNCA vio durante entrenamiento
    - Sirve para detectar si el modelo se degrada en producción
    - Si producción tiene 50% menos accuracy que baseline = PROBLEMA
    
    PROCESO:
    1. Tienes 1000 muestras totales
    2. 80% (800) se usan para entrenamiento
    3. 20% (200) se guardan para validación
    4. El modelo entrena con los 800
    5. Aquí evaluamos en los 200 que NUNCA vio
    6. Guardamos esos números como "lo que esperamos"
    
    MÉTRICAS GUARDADAS:
    - Accuracy: % de predicciones correctas
    - Precision: De los que predije "alto", cuántos eran realmente "alto"
    - Recall/Sensibilidad: De los "alto" reales, cuántos detecté
    - F1: Balance entre precision y recall
    
    SALIDA:
    - baseline.json con métricas y fecha de exportación
    """
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    # Calcula matriz de confusión (VP, VN, FP, FN)
    matriz_confusion = confusion_matrix(y_validacion, predicciones, labels=[0, 1, 2])
    
    datos_baseline = {
        "exportadoEn": datetime.now(timezone.utc).isoformat(),
        "tamañoDataset": int(len(y_validacion)),
        "exactitud": float(accuracy_score(y_validacion, predicciones)),
        "precision": float(precision_score(y_validacion, predicciones, average="weighted", zero_division=0)),
        "sensibilidad": float(recall_score(y_validacion, predicciones, average="weighted", zero_division=0)),
        "f1": float(f1_score(y_validacion, predicciones, average="weighted", zero_division=0)),
        "matrizConfusion": {
            "verdaderosNegativos": int(matriz_confusion[0, 0] + matriz_confusion[1, 1] + matriz_confusion[2, 2]),
            "falsosPositivos": int(matriz_confusion[0, 1] + matriz_confusion[0, 2] + matriz_confusion[1, 0] + matriz_confusion[1, 2] + matriz_confusion[2, 0] + matriz_confusion[2, 1]),
            "matriz": matriz_confusion.tolist(),
        },
        "distribucionClases": {
            "normal": int(np.sum(y_validacion == 0)),
            "medio": int(np.sum(y_validacion == 1)),
            "alto": int(np.sum(y_validacion == 2)),
        },
        "proposito": "Este es el baseline de exactitud cuando el modelo se desplegó. "
                     "Compara futuras validaciones contra esto para detectar degradación.",
    }

    with open(BASELINE_JSON, "w", encoding="utf-8") as archivo:
        json.dump(datos_baseline, archivo, indent=2)

    print(f"  ✓ Métricas baseline -> {BASELINE_JSON}")


# ============================================================================
# PUNTO DE ENTRADA DEL PROGRAMA
# ============================================================================

def main() -> None:
    """
    FUNCIÓN PRINCIPAL: Coordina todo el proceso de entrenamiento.
    
    PASOS:
    1. Carga datos de entrenamiento (sintéticos + reales si existen)
    2. Divide en 80% entrenamiento, 20% validación
    3. Entrena RandomForest en el 80%
    4. Valida en el 20% (datos nunca vistos)
    5. Exporta 3 archivos:
       - clasificador_riesgo.onnx (para Node.js)
       - anomaly_params.json (parámetros estadísticos)
       - baseline.json (métricas esperadas)
    """
    
    print("=" * 70)
    print("CARGANDO DATOS DE ENTRENAMIENTO")
    print("=" * 70)
    datos_df = cargar_datos_entrenamiento()

    # Extrae columnas de sensores y etiquetas
    X = datos_df[FEATURES].values.astype(np.float32)      # Sensores: llama, gas, movimiento
    y = datos_df["label"].values.astype(int)              # Etiquetas: 0=normal, 1=medio, 2=alto

    # DIVISIÓN CRUCIAL: 80% entrenamiento, 20% validación
    # stratify=y: Garantiza que ambos grupos tengan igual distribución de clases
    X_entrenamiento, X_validacion, y_entrenamiento, y_validacion = train_test_split(
        X, y, 
        test_size=0.2,              # 20% para validación
        random_state=42,            # Semilla para reproducibilidad
        stratify=y                  # Mantén proporción de clases
    )

    print(f"\n  Muestras para entrenamiento: {len(X_entrenamiento)} (80%)")
    print(f"  Muestras para validación:    {len(X_validacion)} (20%)")

    print("\n" + "=" * 70)
    print("ENTRENANDO RANDOM FOREST")
    print("=" * 70)
    modelo = entrenar_clasificador(X_entrenamiento, y_entrenamiento)

    # Predice en datos nuevos (validación)
    predicciones = modelo.predict(X_validacion)
    
    print("\n" + "─" * 70)
    print("RESULTADOS DE VALIDACIÓN (en 20% de datos NO vistos)")
    print("─" * 70)
    print(classification_report(
        y_validacion, 
        predicciones, 
        target_names=LABEL_NAMES,
        digits=4
    ))
    print("Nota: Estos números son tu 'baseline'. Espera valores similares en")
    print("      producción. Si son mucho menores, el modelo se degradó.")

    # Calcula parámetros para detección de anomalías
    parametros_anomalia = calcular_parametros_anomalia(X_entrenamiento)

    print("\n" + "=" * 70)
    print("EXPORTANDO MODELOS")
    print("=" * 70)
    exportar_clasificador(modelo)
    exportar_parametros_anomalia(parametros_anomalia)
    exportar_baseline(y_validacion, predicciones)

    print("\n" + "=" * 70)
    print("COMPLETADO")
    print("=" * 70)
    print("\n✓ Commit los archivos de models/ a git para que Railway pueda usarlos")
    print("✓ Los modelos están listos para predicciones en tiempo real\n")


if __name__ == "__main__":
    main()
