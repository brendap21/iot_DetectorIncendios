# Explicación: Dónde vienen los 3 archivos generados por train_model.py

## Resumen Rápido

Cuando ejecutas `python entrena_modelo.py`, el script genera 3 archivos en la carpeta `models/`:

| Archivo | De dónde viene | Para qué sirve |
|---------|----------------|-----------------|
| **clasificador_riesgo.onnx** | RandomForest entrenado en 80% datos | Predice riesgo en Node.js |
| **anomaly_params.json** | Estadística (media, desv.est.) del 80% datos | Detecta lecturas raras/anómalas |
| **baseline.json** | Evaluación en 20% datos nuevos | Benchmark para detectar degradación |

---

## 1. ¿De dónde viene anomaly_params.json?

### Origen: Estadística del Entrenamiento

```
ENTRADA: 1000 lecturas de sensores
    ├─ 80% (800) → Entrenamiento
    │  └─ De aquí extraemos: MEDIA y DESV. EST.
    └─ 20% (200) → Validación (no se usa para esto)

SALIDA: anomaly_params.json
```

### ¿Cómo se calcula?

**Paso 1: Carga los 800 datos de entrenamiento**
```python
datos = [
    [llama=0, gas=1050, movimiento=0],
    [llama=0, gas=1100, movimiento=1],
    [llama=0, gas=1200, movimiento=0],
    ...
    [llama=1, gas=2500, movimiento=1],  # fila 800
]
```

**Paso 2: Calcula el promedio de cada sensor**
```python
mean = [
    (0 + 0 + 0 + ... + 1) / 800 = 0.065,      # promedio de llama
    (1050 + 1100 + 1200 + ... + 2500) / 800 = 1104,  # promedio de gas
    (0 + 1 + 0 + ... + 1) / 800 = 0.768,     # promedio de movimiento
]
```

**Paso 3: Calcula la desviación estándar (qué tanto varían)**
```python
std = [
    0.246,  # desv.est. de llama
    763,    # desv.est. de gas
    0.422,  # desv.est. de movimiento
]
```

**Resultado en JSON:**
```json
{
  "mean": [0.065, 1104, 0.768],
  "std": [0.246, 763, 0.422],
  "threshold": 2.5,
  "features": ["llama", "gas", "movimiento"]
}
```

### ¿Para qué sirve?

En Node.js, cuando llega una lectura nueva, detecta anomalías así:

```javascript
// Lectura nueva que llega
lectura = [llama=1, gas=3300, movimiento=1]

// Cálculo de Z-score para el gas
z_score = (3300 - 1104) / 763 = 2.88

// ¿Es anomalía?
if (2.88 > 2.5) {
    // SÍ, es anomalía. Muy lejos de lo normal
}
```

**La media y desviación estándar definen "qué es normal"** para tu sistema.

---

## 2. ¿Cómo se entrena el modelo para clasificar?

### El Algoritmo: Random Forest (Bosque Aleatorio)

```
┌─────────────────────────────────────────────────────────────┐
│ TENGO 800 MUESTRAS DE ENTRENAMIENTO:                         │
│                                                               │
│ llama | gas  | movimiento | label (respuesta correcta)      │
│ ──────┼──────┼────────────┼─────────────────────────         │
│   0   | 1050 |     0      |  0 (normal)                      │
│   0   | 1100 |     1      |  0 (normal)                      │
│   0   | 2500 |     1      |  1 (medio)                       │
│   1   | 3000 |     1      |  2 (alto)                        │
│  ...  | ...  |    ...     |  ...                             │
│   1   | 3800 |     1      |  2 (alto)                        │
└─────────────────────────────────────────────────────────────┘

               ↓ RandomForest crea 100 árboles ↓

        ÁRBOL 1              ÁRBOL 2              ÁRBOL 3
        ┌────────┐           ┌────────┐           ┌────────┐
        │ ¿gas   │           │ ¿llama │           │ ¿gas   │
        │ <1500? │           │ == 1?  │           │ <2000? │
        └────────┘           └────────┘           └────────┘
          /    \               /    \               /    \
        SÍ      NO           SÍ      NO           SÍ      NO
       /        \           /        \           /        \
    NORMAL    (otro)   ¿mov?      ALTO    NORMAL    (otro)
              test              
                                            ... (97 árboles más)
```

### Proceso Detallado

**Entrada:** 800 muestras etiquetadas (cada una sabe si es normal/medio/alto)

**Paso 1: RandomForest crea 100 árboles**
```python
modelo = RandomForestClassifier(
    n_estimators=100,  # 100 árboles
    max_depth=8,       # Cada árbol: máximo 8 decisiones
    random_state=42,   # Reproducibilidad
    class_weight="balanced",  # Si hay más "normal", penaliza error en "alto"
)
```

**Paso 2: Cada árbol aprende de forma DIFERENTE**
- Árbol 1: Mira primero el gas, luego llama
- Árbol 2: Mira primero llama, luego movimiento
- Árbol 3: Mira primero gas, luego movimiento
- ... y así 97 árboles más

Cada árbol entrena con ~63% aleatorio de los 800 datos (bootstrap).

**Paso 3: El modelo aprende reglas**

Por ejemplo:
```
Si gas > 1800:
    Es probable "alto" o "medio"
Si gas > 1800 AND llama == 1:
    Es definitivamente "alto"
Si llama == 0 AND gas < 1000:
    Es definitivamente "normal"
```

Estos "si-entonces" se guardan en los 100 árboles.

**Paso 4: Cuando llega una predicción nueva**
```
Nueva lectura: [llama=1, gas=2800, movimiento=1]

VOTACIÓN:
- Árbol 1 vota: "alto"
- Árbol 2 vota: "alto"
- Árbol 3 vota: "medio"
- ...
- Árbol 100 vota: "alto"

RESULTADO FINAL: 87 votos para "alto", 13 para "medio"
└─ PREDICCIÓN: "alto" (ganador)
```

### ¿Por qué Random Forest?

✅ Aprende relaciones complejas entre sensores  
✅ No overfitting (100 árboles votan, difícil sobreajostar)  
✅ Rápido en predicción (solo 100 búsquedas)  
✅ Da probabilidades (87% confianza en "alto")  

---

## 3. ¿Cómo se genera el .onnx?

### El Formato ONNX

**ONNX = "Open Neural Network Exchange"**

Es como un "formato universal" para modelos ML:

```
┌──────────────────────────────────────────────────────────┐
│ PYTHON (sklearn)  ←→  ONNX  ←→  NODE.JS (runtime)      │
│                                                           │
│ RandomForest     export    Binary File    load   JS      │
│ (en Python)      con       formato        con    hace    │
│ entrena el       sklearn2  ONNX           onnx-  predic- │
│ modelo           onnx      (~150 KB)      runtime iones  │
└──────────────────────────────────────────────────────────┘
```

### Proceso de Conversión

**Paso 1: El RandomForest entrenado (object Python)**
```python
modelo = RandomForestClassifier(...)
modelo.fit(X_train, y_train)  # Entrenado
# Tienes un objeto Python con 100 árboles en memoria
```

**Paso 2: Convierte a ONNX**
```python
from skl2onnx import to_onnx
from skl2onnx.common.data_types import FloatTensorType

# Define la entrada: una fila de 3 números float
tipo_entrada = [("X", FloatTensorType([None, 3]))]

# Convierte el objeto sklearn a ONNX
modelo_onnx = to_onnx(
    modelo,
    initial_types=tipo_entrada,
    target_opset=12,
    options={id(modelo): {"zipmap": False}},
)
```

**Paso 3: Serializa a bytes y guarda**
```python
with open("clasificador_riesgo.onnx", "wb") as archivo:
    archivo.write(modelo_onnx.SerializeToString())
    # Ahora es un archivo binario: 100 árboles codificados

# Resultado: clasificador_riesgo.onnx (~150 KB)
```

### ¿Por qué "zipmap=False"?

```
Por defecto, ONNX hace:
  predicción = {"normal": 0.15, "medio": 0.30, "alto": 0.55}
  
Pero Node.js NO soporta ese formato de diccionario.

zipmap=False hace:
  predicción = [0.15, 0.30, 0.55]  (solo números)
  
Node.js puede leerlo fácilmente.
```

### En Node.js (cómo se usa)

```javascript
// Carga el modelo ONNX
const session = await ort.InferenceSession.create('clasificador_riesgo.onnx');

// Nueva lectura
const entrada = {
    X: new ort.Tensor('float32', [0, 2500, 1], [1, 3])
    //                              [llama, gas, movimiento]
};

// Predicción
const salida = await session.run(entrada);

// Resultado: [0.15, 0.30, 0.55] (probabilidades)
const prediccion = argmax(salida);  // 2 = "alto"
```

---

## Resumen Visual del Flujo Completo

```
DATOS ORIGINALES
├─ synthetic_data.csv (1000 filas generadas)
└─ real_data.csv (0-N filas reales opcionales)

         ↓ cargar_datos_entrenamiento()

DATOS FUSIONADOS (1000 filas)
├─ llama | gas | movimiento | label
└─ ...

         ↓ train_test_split (80/20)

ENTRENAMIENTO (800)              VALIDACIÓN (200)
├─ [0, 1050, 0] → 0              ├─ [1, 2800, 1] → 2
├─ [0, 1100, 1] → 0              ├─ [0, 950, 0] → 0
└─ ... (800 muestras)            └─ ... (200 muestras)

         ↓ entrenar_clasificador()

MODELO ENTRENADO (100 árboles en Python)

         ↓ exportar_clasificador()
         │ export_baseline()
         │ exportar_parametros_anomalia()

3 ARCHIVOS GENERADOS:
├─ clasificador_riesgo.onnx (150 KB)
│  └─ Predicciones: [llama, gas, mov] → [prob_normal, prob_medio, prob_alto]
│
├─ anomaly_params.json (pequeño)
│  └─ mean: [0.065, 1104, 0.768]
│  └─ std: [0.246, 763, 0.422]
│
└─ baseline.json (métricas)
   └─ accuracy: 0.92
   └─ precision: 0.88
   └─ ...
```

---

## En Clase: Qué Explicar

### Pregunta: "¿De dónde sacaste anomaly_params.json?"

**Respuesta:**
> "De la estadística de los 800 datos de entrenamiento. Calculé la media (promedio) y la desviación estándar de cada sensor. Estos valores definen 'qué es normal'. Cuando llega un sensor que está muy lejos de esa media (Z-score > 2.5), lo marcamos como anomalía."

### Pregunta: "¿Cómo entrenas el modelo?"

**Respuesta:**
> "Uso Random Forest: 100 árboles de decisión que votan juntos. Cada árbol aprende patrones diferentes de los datos (cuál-sensor-mirar-primero, qué-umbrales-usar). Cuando llega una predicción nueva, los 100 árboles votan y ganador es la clase con más votos. Es más robusto que un solo árbol."

### Pregunta: "¿Cómo generas el .onnx?"

**Respuesta:**
> "Convierto el modelo sklearn a formato ONNX (Open Neural Network Exchange). Es un formato universal que Python puede generar y Node.js puede cargar. Sin esto, tendría que reimplementar el modelo en JavaScript."

---

**Documento generado automáticamente**  
Versión: 1.0  
Fecha: 2026-06-19
