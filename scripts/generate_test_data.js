#!/usr/bin/env node

/**
 * generate_test_data.js
 * 
 * Genera datos de prueba para demostración de métricas del modelo.
 * Crea una mezcla de lecturas normales e incendios para ver cómo funcionan
 * las evaluaciones.
 * 
 * Uso:
 *   node scripts/generate_test_data.js <cantidad>
 *   
 * Ejemplo:
 *   node scripts/generate_test_data.js 50
 *   → Genera 50 lecturas de prueba en Firestore
 */

'use strict';

const admin = require('firebase-admin');
const path = require('path');

// Inicializa Firebase
const serviceAccountPath = path.join(__dirname, '..', 'config', 'firebase-key.json');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function generateTestData(cantidad = 50) {
  console.log(`\n📊 Generando ${cantidad} lecturas de prueba...\n`);

  const batch = db.batch();
  let count = 0;

  for (let i = 0; i < cantidad; i++) {
    // 60% lecturas normales, 40% con incendios
    const esIncendio = Math.random() < 0.4;

    let llama, gas, movimiento, riesgo;

    if (esIncendio) {
      // Genera datos que indican incendio
      llama = Math.random() < 0.6 ? 1 : 0;
      gas = Math.floor(Math.random() * 2000) + 1800; // 1800-3800 ADC
      movimiento = Math.random() < 0.7 ? 1 : 0;
      riesgo = Math.random() < 0.5 ? 'alto' : 'medio';
    } else {
      // Genera datos normales
      llama = 0;
      gas = Math.floor(Math.random() * 1000); // 0-1000 ADC
      movimiento = 0;
      riesgo = 'normal';
    }

    const lectura = {
      llama,
      gas,
      movimiento,
      riesgo,
      fecha: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
      probabilidad: Math.random(),
      alerta: riesgo !== 'normal',
      source: 'test-generator',
    };

    const docRef = db.collection('lecturas').doc(`test-${Date.now()}-${i}`);
    batch.set(docRef, lectura);

    count++;
    if (count % 10 === 0) {
      process.stdout.write(`✓ ${count}/${cantidad}\r`);
    }
  }

  try {
    await batch.commit();
    console.log(`\n✅ Se generaron ${cantidad} lecturas de prueba exitosamente\n`);
    console.log('📌 Notas:');
    console.log(`   - 60% (${Math.floor(cantidad * 0.6)}) son lecturas normales`);
    console.log(`   - 40% (${Math.floor(cantidad * 0.4)}) son lecturas con incendios`);
    console.log('   - Ahora abre el dashboard y haz clic en "Ver Evaluación"');
    console.log('   - Deberías ver métricas más interesantes (no 0% en todo)\n');
  } catch (error) {
    console.error('❌ Error al generar datos:', error.message);
    process.exit(1);
  }
}

// Parsea argumentos
const cantidad = parseInt(process.argv[2]) || 50;

if (cantidad < 1 || cantidad > 1000) {
  console.error('❌ La cantidad debe estar entre 1 y 1000');
  process.exit(1);
}

generateTestData(cantidad)
  .then(() => {
    admin.app().delete();
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    admin.app().delete();
    process.exit(1);
  });
