# SonqollayAPP

PWA móvil para gestión de clientes y cotizaciones con **Firestore** (sincronización en la nube + offline) y **Firebase Cloud Messaging** (notificaciones push web).

## 1) Configurar Firebase

### a) Crear el proyecto / obtener config

1. Andá a https://console.firebase.google.com → tu proyecto.
2. **Configuración del proyecto** → "Tus apps" → agregá una **App web** si no existe.
3. Copiá el objeto `firebaseConfig` (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId).

### b) Pegar los valores

Editá **dos** archivos con los mismos valores:

- `firebase-config.js` (módulo ES que usa la app)
- `firebase-config-compat.js` (lo usa el service worker de FCM)

La **VAPID Public Key** ya está cargada:

```
BG51GzCL7b78_tnJ1GzvV53HimMawsAwPPdTCKM8XPAKV6RS8arlEQZ-BxzQqyFLxCJaY-durev5H6GyJysO9HU
```

### c) Habilitar servicios en la consola

- **Authentication** → Sign-in method → habilitar **Anónimo**.
- **Firestore Database** → Crear base de datos (modo producción).
- **Reglas de Firestore**: copiar el contenido de `firestore.rules` en *Rules* y publicar.
- **Cloud Messaging** → ya tenés la VAPID Web Push registrada.

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

## 5) Deploy con Firebase Hosting (opcional)

```bash
npm i -g firebase-tools
firebase login
firebase init hosting     # apuntar a este directorio como public
firebase deploy
```

## 6) Enviar notificaciones de prueba

Desde Firebase Console → **Cloud Messaging** → Enviar mensaje de prueba → pegá el token FCM (lo podés ver en Firestore en `users/{uid}/fcmTokens/...`).

## 7) Datos precargados

En la primera conexión, si la cuenta no tiene cotizaciones, se siembran las 12 del respaldo (Arcadis, Keypro, Worley, JRI, WSP, Salfa, Techint, R&Q).
