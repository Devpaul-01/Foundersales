// src/config/firebase.js
import admin from 'firebase-admin';
import dotenv from 'dotenv';
dotenv.config();

let firebaseApp;

export const initFirebase = () => {
  if (firebaseApp) return firebaseApp;

  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('[Firebase] Initialized successfully');
  } catch (err) {
    console.error('[Firebase] Init failed:', err.message);
    // Don't crash the server if Firebase fails - just disable push notifications
  }

  return firebaseApp;
};

export const getMessaging = () => {
  if (!firebaseApp) return null;
  return admin.messaging();
};

export default { initFirebase, getMessaging };
