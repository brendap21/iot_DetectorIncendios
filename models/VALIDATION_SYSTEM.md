# Sistema de Validación y Monitoreo del Modelo ML

## Descripción General

El proyecto ahora tiene un sistema completo de validación del modelo RandomForest con 3 niveles:

1. **Baseline (entrenamiento)** — Validación inicial en datos no vistos
2. **Pseudo-validación** — Validación en tiempo real contra heurístico
3. **Validación real** — Confirmaciones manuales del usuario

---

## Arquitectura

### 1. Baseline (Primera Mejora)

**Archivo:** `scripts/train_model.py`

Cuando ejecutas el script de entrenamiento, genera:
- `models/risk_classifier.onnx` — Modelo entrenado
- `models/anomaly_params.json` — Parámetros de anomalía
- **`models/baseline.json`** — Métricas de validación

```json
{
  "exportedAt": "2026-06-19T...",
  "accuracy": 0.92,
  "precision": 0.88,
  "recall": 0.85,
  "f1": 0.86,
  "datasetSize": 400,
  "classDistribution": {
    "normal": 200,
    "medio": 150,
    "alto": 50
  }
}
```

**Esto es importante porque:**
- ✅ Valida el modelo ANTES de ponerlo en producción
- ✅ Usa datos que el modelo NUNCA vio (20% test set)
- ✅ Es tu baseline de rendimiento esperado

**Cómo funciona:**
```
100% datos de entrenamiento
  ├─ 80% (entrenamiento del árbol)
  └─ 20% (VALIDACIÓN - datos nuevos)
     → Genera baseline.json
```

---

### 2. Pseudo-Validación (En Tiempo Real)

**Endpoint:** `GET /api/sensores/ml/evaluacion?limit=300`

Cada vez que haces clic en "Ver evaluación del modelo":
1. Obtiene las últimas 300 lecturas de Firestore
2. Compara predicción del modelo vs heurístico: `(llama === 1 || gas >= 1800)`
3. Calcula matriz de confusión, exactitud, precisión, sensibilidad, F1

**Respuesta:**
```json
{
  "ok": true,
  "evaluacion": {
    "totalLecturas": 300,
    "metricas": {
      "exactitud": 0.91,
      "precision": 0.87,
      "sensibilidad": 0.83,
      "f1": 0.85
    },
    "matriz": {
      "verdaderosPositivos": 150,
      "verdaderosNegativos": 120,
      "falsosPositivos": 20,
      "falsosNegativos": 10
    }
  },
  "reporteValidacion": { /* validación real, ver abajo */ }
}
```

**Limitaciones (por eso es "pseudo"):**
- ⚠️ Usa una "verdad observada" artificial (no es 100% correcta)
- ⚠️ Es solo un heurístico, no validación real
- ⚠️ Te dice que el modelo funciona, PERO no te dice si funciona BIEN

**Útil para:** Ver tendencias y detectar cambios bruscos

---

### 3. Validación Real (Nueva - Segunda y Tercera Mejora)

**Concepto:** El usuario marca predicciones como correctas/incorrectas

#### 3.1 Confirmar una predicción

**Endpoint:** `POST /api/sensores/validar-prediccion`

```bash
curl -X POST http://localhost:3000/api/sensores/validar-prediccion \
  -H "Content-Type: application/json" \
  -d '{
    "lecturaId": "abc123",
    "prediccion": "alto",
    "esCorrecta": true,
    "razon": "Confirmé visualmente que había humo"
  }'
```

**Respuesta:**
```json
{
  "ok": true,
  "message": "Predicción validada correctamente",
  "lecturaId": "abc123"
}
```

Los datos se guardan en `models/real_validations.json`:
```json
[
  {
    "id": "abc123-1718814000000",
    "lecturaId": "abc123",
    "prediccion": "alto",
    "esCorrecta": true,
    "razon": "Confirmé visualmente que había humo",
    "confirmadoEn": "2026-06-19T14:00:00Z"
  }
]
```

#### 3.2 Obtener reporte de validación real

**Endpoint:** `GET /api/sensores/ml/reporte-validacion`

```json
{
  "ok": true,
  "reporte": {
    "baseline": {
      "accuracy": 92.0,
      "precision": 88.0,
      "recall": 85.0,
      "f1": 86.0,
      "exportedAt": "2026-06-19T...",
      "testSetSize": 400
    },
    "realValidation": {
      "totalConfirmaciones": 45,
      "correctas": 40,
      "incorrectas": 5,
      "precisionReal": 88.89,
      "baselineAccuracy": 92.0,
      "degradacion": -3.11,
      "estado": "ADVERTENCIA: Posible degradación ligera"
    },
    "totalValidationsRecorded": 45
  }
}
```

**Interpretación:**
- ✅ Precisión Real = 88.89% (40 correctas / 45 total)
- ✅ Baseline = 92.0% (lo que esperabas)
- ⚠️ Degradación = -3.11% (modelo está un poco peor en producción)
- ⚠️ Estado = ADVERTENCIA (necesita atención)

---

## Cómo Usar en Práctica

### Workflow Completo

```
1. ENTRENAMIENTO (Desarrollo)
   └─ python scripts/train_model.py
      → Genera baseline.json

2. DESPLIEGUE (Producción)
   └─ El modelo se carga automáticamente
   └─ Empieza a hacer predicciones

3. MONITOREO (Operación)
   ├─ Usuario ve predicción del modelo
   ├─ Usuario confirma: ¿fue correcta?
   │  POST /api/sensores/validar-prediccion
   │
   └─ Después de N confirmaciones:
      └─ GET /api/sensores/ml/reporte-validacion
         → Compara real vs baseline
         → Detecta degradación

4. ACCIÓN (Si hay degradación)
   ├─ Revisar qué cambió en el entorno
   ├─ Recolectar más datos reales
   ├─ Reentrenar el modelo
   └─ Volver a paso 1
```

---

## Cambios en el Backend

### Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `scripts/train_model.py` | +`export_baseline()` para guardar métricas de test |
| `services/prediction-validation.service.js` | 🆕 Nuevo servicio para validación real |
| `controllers/sensores.controller.js` | +`confirmarPrediccion()`, +`obtenerReporteValidacion()` |
| `routes/sensores.routes.js` | +Rutas para validación |
| `public/pwa-client.js` | +Interfaz para mostrar validación real |

---

## Cambios en el Frontend

`public/pwa-client.js` ahora:
1. Renderiza el reporte de validación real al lado de la pseudo-validación
2. Muestra degradación vs baseline
3. Muestra estado del modelo (OK/ADVERTENCIA/ALERTA)

Ejemplo de salida en pantalla:
```
VALIDACIÓN EN TIEMPO REAL
├─ Confirmaciones: 45
├─ Correctas: 40
├─ Incorrectas: 5
├─ Precisión Real: 88.89%
├─ Baseline (entrenamiento): 92.00%
├─ Degradación: -3.11%
└─ Estado: ADVERTENCIA: Posible degradación ligera
```

---

## Umbrales de Degradación

En `services/prediction-validation.service.js`:

```javascript
degradacion < -0.05  → ALERTA: Modelo degradado significativamente (>5%)
degradacion < 0      → ADVERTENCIA: Posible degradación ligera (<5%)
degradacion >= 0     → OK: Modelo mantiene rendimiento
```

Puedes ajustar estos umbrales según tu tolerancia.

---

## Casos de Uso

### Caso 1: Validar que el modelo funciona antes de ir a producción
```bash
python scripts/train_model.py
# Revisa baseline.json
# Si F1-score > 0.80, está listo
```

### Caso 2: Monitorear degradación en producción
```
Cada semana, ejecuta:
GET /api/sensores/ml/reporte-validacion

Si degradacion < -0.05:
  1. Investiga qué cambió (sensor descalibrado?)
  2. Recolecta nuevos datos
  3. Reentrana el modelo
```

### Caso 3: Usuario quiere justificar que el modelo funciona
```
1. Muestra baseline.json (92% accuracy en test set)
2. Muestra reporte-validacion (88.89% en producción)
3. Explica: "El modelo aprende bien, pero el mundo real es más difícil"
4. Datos: 45 confirmaciones reales, mínimo 5% degradación que es aceptable
```

---

## Preguntas Frecuentes

**P: ¿Qué es mejor, pseudo-validación o validación real?**
R: Ambas. La pseudo-validación es rápida y gratis. La validación real es lenta pero precisa. Usa ambas.

**P: ¿Cuántas confirmaciones necesito para confiar en la validación real?**
R: Idealmente 100+. Con 45 tienes una idea, pero no es conclusivo.

**P: ¿El heurístico `llama===1 || gas>=1800` es correcto?**
R: No siempre. Por eso necesitas validación real (confirmaciones del usuario).

**P: ¿Puedo modificar los umbrales de degradación?**
R: Sí, en `services/prediction-validation.service.js` línea ~85.

**P: ¿Dónde se guardan las confirmaciones?**
R: En `models/real_validations.json` (se crea automáticamente).

---

## Próximas Mejoras Sugeridas

1. **Dashboard de monitoreo**: Gráfica de precisión real en el tiempo
2. **Alertas automáticas**: Email si degradación > 10%
3. **Reentrenamiento automático**: Si hay 100 datos nuevos, reentrenar
4. **A/B Testing**: Comparar versiones del modelo en paralelo
5. **Explicabilidad**: Mostrar qué features influyeron en cada predicción

---

## Referencias Técnicas

- **Baseline**: Métricas en datos de TEST (80-20 split)
- **Pseudo-validación**: Matriz confusión contra heurístico (imperfecto)
- **Validación Real**: Confirmaciones manuales (es la verdad)
- **Degradación**: (Precisión Real - Baseline) / Baseline × 100%

---

**Última actualización:** 2026-06-19
**Autor:** Sistema de validación ML mejorado
