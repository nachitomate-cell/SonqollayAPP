// ============================================================
// Configuración de Firebase
// ------------------------------------------------------------
// 1) Andá a Firebase Console → Configuración del proyecto →
//    "Tus apps" → App web → SDK setup → Config.
// 2) Copiá el objeto firebaseConfig y reemplazá los valores
//    de abajo (apiKey, authDomain, projectId, etc.).
// 3) En Firebase Console habilitá:
//    - Authentication → Sign-in method → Anónimo
//    - Firestore Database (modo producción)
//    - Cloud Messaging (Web Push: agregá la VAPID key de abajo
//      si todavía no figura)
// ============================================================

export const firebaseConfig = {
  apiKey: "REEMPLAZAR",
  authDomain: "REEMPLAZAR.firebaseapp.com",
  projectId: "REEMPLAZAR",
  storageBucket: "REEMPLAZAR.appspot.com",
  messagingSenderId: "REEMPLAZAR",
  appId: "REEMPLAZAR"
};

// VAPID Public Key (Web Push Certificate) — ya cargada
export const VAPID_KEY = "BG51GzCL7b78_tnJ1GzvV53HimMawsAwPPdTCKM8XPAKV6RS8arlEQZ-BxzQqyFLxCJaY-durev5H6GyJysO9HU";
