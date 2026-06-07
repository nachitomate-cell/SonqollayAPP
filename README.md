# SonqollayAPP

PWA móvil para gestión de clientes y cotizaciones con **Firestore** (sincronización en la nube + offline) y **Firebase Cloud Messaging** (notificaciones push web).

## 1) Configurar Firebase

### a) Crear el proyecto / obtener config

1. Andá a https://console.firebase.google.com → tu proyecto.
2. **Configuración del proyecto** → "Tus apps" → agregá una **App web** si no existe.
3. Copiá el objeto `firebaseConfig` (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId).

### b) Pegar los valores

Editá los mismos valores en **dos** lugares:

- `firebase-config.js` (módulo ES que usa la app)
- `firebase-messaging-sw.js` (config embebida que usa el service worker de FCM)

La **VAPID Public Key** ya está cargada:

```
BG51GzCL7b78_tnJ1GzvV53HimMawsAwPPdTCKM8XPAKV6RS8arlEQZ-BxzQqyFLxCJaY-durev5H6GyJysO9HU
```

### c) Habilitar servicios en la consola

- **Authentication** → Sign-in method → habilitar **Anónimo**.
- **Firestore Database** → Crear base de datos (modo producción).
- **Reglas de Firestore**: copiar el contenido de `firestore.rules` en *Rules* y publicar.
- **Cloud Messaging** → ya tenés la VAPID Web Push registrada.

> **Acceso del equipo (importante).** Las cotizaciones, clientes y plantillas ya **no** son accesibles para cualquier cuenta de Google que inicie sesión. La función `isTeam()` de `firestore.rules` solo permite al dueño (`ignaciiio.mate@gmail.com`), a los administradores (`isAdmin == true`) y a correos **verificados** del dominio `@sonqollay.cl`. La Cloud Function `parseDictation` aplica el mismo criterio. Para sumar miembros con otro correo, marcá su documento `users/{uid}` con `isAdmin: true` o ajustá el dominio en `isTeam()` y en `parseDictation`.

### d) Dominios autorizados

En Authentication → Settings → **Authorized domains**, agregá el dominio donde alojás la app (ej. `tu-usuario.github.io`). `localhost` ya viene autorizado.

## 2) Estructura de datos en Firestore

```
users/{uid}/
  ├─ quotes/{id}    → { empresa, numero, fecha, descripcion, valor,
  │                     contactos, estado, seguimiento, notas, createdAt, updatedAt }
  ├─ clients/{id}   → { empresa, nombre, email, telefono, cargo, notas }
  └─ fcmTokens/{token} → { token, ua, createdAt }
```

Cada teléfono recibe un UID anónimo persistente. Si reinstalás la app, generá un respaldo (Ajustes → Exportar JSON) o usá login Google en el futuro para enlazar datos entre dispositivos.

## 3) Funcionalidades

- **Cotizaciones**: ABM, estado (Borrador/Enviada/En revisión/Adjudicada/Perdida), valor CLP, contactos, próximo seguimiento, notas.
- **Clientes**: ficha por empresa con persona, email, teléfono, cargo.
- **Dashboard**: KPIs, próximos seguimientos, últimas cotizaciones.
- **Sync real-time**: cambios desde cualquier dispositivo aparecen al instante.
- **Offline-first**: Firestore con persistencia IndexedDB + Service Worker.
- **Push web (FCM)**: botón en Ajustes para activar; el token queda guardado en `users/{uid}/fcmTokens` para enviar mensajes desde tu backend o Cloud Functions.
- **Exportar/Importar** respaldo JSON, **Exportar CSV** (Excel).
- **mailto** desde cada cotización.

## 4) Probar local

```bash
cd SonqollayAPP
python3 -m http.server 8080
# abrir http://localhost:8080
```

> Importante: FCM requiere **HTTPS** (o `localhost`). Para usarlo desde un teléfono real, hostealo en GitHub Pages / Netlify / Firebase Hosting.

## 5) Deploy con Firebase Hosting + Functions

El proyecto ya viene con `firebase.json` y `.firebaserc` apuntando al proyecto `sonqollayapp`.

```bash
npm i -g firebase-tools
firebase login

# Instalar deps de las functions
cd functions && npm install && cd ..

# Deploy completo (hosting + reglas + functions)
firebase deploy
```

Deploy parcial:
```bash
firebase deploy --only hosting
firebase deploy --only firestore:rules
firebase deploy --only functions
firebase deploy --only functions:dailyFollowUpReminders
```

## 6) Cloud Functions incluidas

Ubicadas en `functions/index.js`:

- **`dailyFollowUpReminders`** — Schedule: todos los días 09:00 (America/Santiago). Espeja las urgencias del dashboard y envía un push consolidado: cotizaciones **atrasadas** (seguimiento vencido, sin tope de antigüedad), de **hoy**, **próximas** (1-3 días) y **sin respuesta +14 días** (Enviada/En revisión sin actividad reciente, aunque no tengan seguimiento). Excluye Adjudicadas/Perdidas. Mientras una cotización siga atrasada, se recuerda cada día.
- **`onQuoteWritten`** — Trigger Firestore único (onWrite) sobre `quotes/{quoteId}`. Envía **como máximo una** notificación por escritura, según prioridad: creación → cambio de estado → seguimiento (hoy/programado) → nota nueva. Excluye al autor del cambio (`updatedBy`/`createdBy`).
- **`onClientCreated`** — Trigger Firestore (onCreate) sobre `clients/{clientId}`. Notifica cada cliente nuevo (excluye al autor).
- **`onAdminBroadcast`** — Trigger Firestore (onCreate) sobre `adminBroadcasts/{id}`. Reenvía el push manual del panel admin/superadmin a todos los tokens.
- **`parseDictation`** — Callable. Extrae entidades de un dictado con Gemini 2.0 Flash.

> Nota de migración: las funciones `onQuoteSeguimientoToday`, `notifyOnNewQuote`, `onQuoteNoteAdded`, `onQuoteEstadoChanged` y `onQuoteSeguimientoRegistered` se consolidaron en `onQuoteWritten`. Al desplegar, `firebase deploy` pedirá confirmar el borrado de esas 5 funciones obsoletas (o usá `firebase deploy --only functions --force`).

Las funciones envían en lotes de 500 tokens (límite de FCM) y limpian automáticamente los tokens FCM que el navegador haya invalidado.

### Probar las funciones

```bash
# Emulador local (sin afectar producción)
cd functions && npm run serve

# Disparar manualmente el schedule (después de deploy)
gcloud scheduler jobs run firebase-schedule-dailyFollowUpReminders-us-central1 --location=us-central1
```

### Requisitos para usar Cloud Functions

- El proyecto Firebase debe estar en plan **Blaze** (pay-as-you-go). El uso de las funciones de esta app es muy bajo y normalmente queda dentro del cupo gratuito.

## 7) Enviar notificaciones de prueba

Desde Firebase Console → **Cloud Messaging** → Enviar mensaje de prueba → pegá el token FCM (lo podés ver en Firestore en `users/{uid}/fcmTokens/...`).

## 8) Datos precargados

En la primera conexión, si la cuenta no tiene cotizaciones, se siembran las 12 del respaldo (Arcadis, Keypro, Worley, JRI, WSP, Salfa, Techint, R&Q).
