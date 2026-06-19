#!/usr/bin/env node
/**
 * Script de Verificación de Configuración
 * 
 * Ejecuta: node verify-config.js
 * 
 * Verifica que Firebase + Adafruit + Push estén configurados correctamente
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  VERIFICACIÓN DE CONFIGURACIÓN - IoT Cloud Fire Detection  ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Colores para terminal
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function check(label, condition, details = '') {
  const status = condition ? '✓' : '✗';
  const color = condition ? colors.green : colors.red;
  const msg = details ? ` - ${details}` : '';
  console.log(`${color}${status}${colors.reset} ${label}${msg}`);
  return condition;
}

function section(title) {
  console.log(`\n${colors.bold}${colors.blue}${title}${colors.reset}`);
  console.log('─'.repeat(60));
}

// ════════════════════════════════════════════════════════════
// 1. VERIFICAR ARCHIVOS
// ════════════════════════════════════════════════════════════

section('1️⃣ ARCHIVOS Y DIRECTORIOS');

const requiredFiles = [
  '.env',
  'config/firebase-key.json',
  'package.json',
];

const requiredDirs = [
  'config',
  'services',
  'controllers',
  'routes',
  'public',
  'lib',
  'include',
  'src',
];

const allFilesOk = requiredFiles.every(file => {
  const exists = fs.existsSync(path.join(process.cwd(), file));
  check(`Archivo: ${file}`, exists);
  return exists;
});

const allDirsOk = requiredDirs.every(dir => {
  const exists = fs.existsSync(path.join(process.cwd(), dir));
  check(`Directorio: ${dir}`, exists);
  return exists;
});

// ════════════════════════════════════════════════════════════
// 2. VERIFICAR VARIABLES DE ENTORNO
// ════════════════════════════════════════════════════════════

section('2️⃣ VARIABLES DE ENTORNO (.env)');

const requiredEnvVars = {
  'PORT': process.env.PORT,
  'FIREBASE_PROJECT_ID': process.env.FIREBASE_PROJECT_ID,
  'FIREBASE_CLIENT_EMAIL': process.env.FIREBASE_CLIENT_EMAIL,
  'FIREBASE_PRIVATE_KEY': process.env.FIREBASE_PRIVATE_KEY,
  'AIO_USERNAME': process.env.AIO_USERNAME,
  'AIO_KEY': process.env.AIO_KEY,
  'VAPID_PUBLIC_KEY': process.env.VAPID_PUBLIC_KEY,
  'VAPID_PRIVATE_KEY': process.env.VAPID_PRIVATE_KEY,
  'GOOGLE_APPLICATION_CREDENTIALS': process.env.GOOGLE_APPLICATION_CREDENTIALS,
};

const envChecks = Object.entries(requiredEnvVars).map(([key, value]) => {
  const isSet = value && String(value).trim() !== '';
  const preview = value ? `${String(value).substring(0, 30)}${String(value).length > 30 ? '...' : ''}` : 'NO DEFINIDA';
  check(key, isSet, isSet ? 'configurada' : 'FALTA');
  return isSet;
});

const allEnvOk = envChecks.every(v => v);

// ════════════════════════════════════════════════════════════
// 3. VERIFICAR FIREBASE CONFIG
// ════════════════════════════════════════════════════════════

section('3️⃣ CONFIGURACIÓN DE FIREBASE');

let firebaseKeyValid = false;
if (fs.existsSync(path.join(process.cwd(), 'config/firebase-key.json'))) {
  try {
    const key = require('./config/firebase-key.json');
    firebaseKeyValid = key.type === 'service_account' && 
                       key.project_id && 
                       key.private_key &&
                       key.client_email;
    
    check('Archivo firebase-key.json válido', firebaseKeyValid);
    if (firebaseKeyValid) {
      check('  Project ID coincide', 
        key.project_id === process.env.FIREBASE_PROJECT_ID,
        `En archivo: ${key.project_id}`
      );
      check('  Client Email coincide',
        key.client_email === process.env.FIREBASE_CLIENT_EMAIL,
        `En archivo: ${key.client_email}`
      );
    }
  } catch (err) {
    check('Archivo firebase-key.json válido', false, `Error: ${err.message}`);
  }
} else {
  check('Archivo firebase-key.json existe', false);
}

// ════════════════════════════════════════════════════════════
// 4. VERIFICAR CREDENCIALES DE FIREBASE
// ════════════════════════════════════════════════════════════

section('4️⃣ CREDENCIALES DE FIREBASE');

const firebaseProjectIdValid = process.env.FIREBASE_PROJECT_ID && 
                                !process.env.FIREBASE_PROJECT_ID.includes('YOUR_');
const firebaseClientEmailValid = process.env.FIREBASE_CLIENT_EMAIL &&
                                 process.env.FIREBASE_CLIENT_EMAIL.includes('@');
const firebasePrivateKeyValid = process.env.FIREBASE_PRIVATE_KEY &&
                                process.env.FIREBASE_PRIVATE_KEY.includes('BEGIN PRIVATE KEY');

check('FIREBASE_PROJECT_ID válido', firebaseProjectIdValid, process.env.FIREBASE_PROJECT_ID);
check('FIREBASE_CLIENT_EMAIL válido', firebaseClientEmailValid, process.env.FIREBASE_CLIENT_EMAIL);
check('FIREBASE_PRIVATE_KEY válida', firebasePrivateKeyValid, '(clave privada detectada)');

// ════════════════════════════════════════════════════════════
// 5. VERIFICAR ADAFRUIT
// ════════════════════════════════════════════════════════════

section('5️⃣ CONFIGURACIÓN DE ADAFRUIT IO');

const aiousernameValid = process.env.AIO_USERNAME && !process.env.AIO_USERNAME.includes('YOUR_');
const aiokeyValid = process.env.AIO_KEY && process.env.AIO_KEY.length >= 32;

check('AIO_USERNAME configurado', aiousernameValid, process.env.AIO_USERNAME);
check('AIO_KEY configurada', aiokeyValid, 
  `Longitud: ${process.env.AIO_KEY ? process.env.AIO_KEY.length : 0} caracteres`
);

// ════════════════════════════════════════════════════════════
// 6. VERIFICAR WEB PUSH (VAPID)
// ════════════════════════════════════════════════════════════

section('6️⃣ CONFIGURACIÓN DE WEB PUSH (VAPID)');

const vapidPublicValid = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PUBLIC_KEY.length > 50;
const vapidPrivateValid = process.env.VAPID_PRIVATE_KEY && process.env.VAPID_PRIVATE_KEY.length > 50;
const vapidSubjectValid = process.env.VAPID_SUBJECT && process.env.VAPID_SUBJECT.includes('mailto:');

check('VAPID_PUBLIC_KEY válida', vapidPublicValid, 
  `Longitud: ${process.env.VAPID_PUBLIC_KEY ? process.env.VAPID_PUBLIC_KEY.length : 0} caracteres`
);
check('VAPID_PRIVATE_KEY válida', vapidPrivateValid,
  `Longitud: ${process.env.VAPID_PRIVATE_KEY ? process.env.VAPID_PRIVATE_KEY.length : 0} caracteres`
);
check('VAPID_SUBJECT válido', vapidSubjectValid, process.env.VAPID_SUBJECT);

// ════════════════════════════════════════════════════════════
// 7. VERIFICAR DEPENDENCIAS
// ════════════════════════════════════════════════════════════

section('7️⃣ DEPENDENCIAS (package.json)');

try {
  const pkg = require('./package.json');
  const requiredDeps = ['express', 'firebase-admin', 'web-push', 'dotenv', 'axios'];
  
  const depsOk = requiredDeps.every(dep => {
    const installed = pkg.dependencies && pkg.dependencies[dep];
    check(`${dep}`, !!installed, installed ? pkg.dependencies[dep] : 'NO INSTALADO');
    return !!installed;
  });
} catch (err) {
  console.log(`${colors.red}✗${colors.reset} Error leyendo package.json: ${err.message}`);
}

// ════════════════════════════════════════════════════════════
// 8. RESUMEN Y RECOMENDACIONES
// ════════════════════════════════════════════════════════════

section('📊 RESUMEN DE VERIFICACIÓN');

const totalChecks = {
  firebase: firebaseKeyValid && firebaseProjectIdValid && firebaseClientEmailValid && firebasePrivateKeyValid,
  adafruit: aiousernameValid && aiokeyValid,
  vapid: vapidPublicValid && vapidPrivateValid && vapidSubjectValid,
  files: allFilesOk && allDirsOk,
  env: allEnvOk,
};

const passed = Object.values(totalChecks).filter(v => v).length;
const total = Object.keys(totalChecks).length;

console.log(`\nResultado: ${passed}/${total} categorías OK\n`);

if (totalChecks.firebase) {
  console.log(`${colors.green}✓${colors.reset} Firebase/Firestore: CONFIGURADO CORRECTAMENTE`);
} else {
  console.log(`${colors.red}✗${colors.reset} Firebase/Firestore: REQUIERE CONFIGURACIÓN`);
  console.log(`  Acciones:`);
  console.log(`  1. Ve a https://console.firebase.google.com/`);
  console.log(`  2. Crea un nuevo proyecto o usa existente`);
  console.log(`  3. Ve a ⚙️ Configuración → Cuentas de servicio`);
  console.log(`  4. Descarga la clave privada (JSON)`);
  console.log(`  5. Guarda en: config/firebase-key.json`);
  console.log(`  6. Actualiza .env con los valores del JSON`);
}

if (totalChecks.adafruit) {
  console.log(`${colors.green}✓${colors.reset} Adafruit IO: CONFIGURADO CORRECTAMENTE`);
} else {
  console.log(`${colors.red}✗${colors.reset} Adafruit IO: REQUIERE CONFIGURACIÓN`);
  console.log(`  Acciones:`);
  console.log(`  1. Ve a https://io.adafruit.com/settings/keys`);
  console.log(`  2. Copia tu Username`);
  console.log(`  3. Copia tu API Key`);
  console.log(`  4. Actualiza .env: AIO_USERNAME y AIO_KEY`);
}

if (totalChecks.vapid) {
  console.log(`${colors.green}✓${colors.reset} Web Push (VAPID): CONFIGURADO CORRECTAMENTE`);
} else {
  console.log(`${colors.red}✗${colors.reset} Web Push (VAPID): REQUIERE CONFIGURACIÓN`);
  console.log(`  Nota: Si es primera vez, ejecuta:`);
  console.log(`  npx web-push generate-vapid-keys`);
  console.log(`  Y copia los valores a .env`);
}

// ════════════════════════════════════════════════════════════
// 9. INSTRUCCIONES FINALES
// ════════════════════════════════════════════════════════════

if (passed === total) {
  console.log(`\n${colors.green}${colors.bold}🎉 TODAS LAS CONFIGURACIONES ESTÁN CORRECTAS!${colors.reset}`);
  console.log(`\nPuedes iniciar el servidor con: ${colors.bold}npm start${colors.reset}\n`);
} else {
  console.log(`\n${colors.yellow}${colors.bold}⚠️ Hay ${total - passed} configuración(es) pendiente(s)${colors.reset}`);
  console.log(`\nConsulta: SETUP_FIREBASE_DUAL.md para instrucciones detalladas\n`);
}

console.log('════════════════════════════════════════════════════════════\n');
