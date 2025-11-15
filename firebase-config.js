// firebase-config.js
// Thay config bên dưới bằng config từ Firebase Console của bạn
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

export function initFirebase() {
  const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
  measurementId: ""
};

  const app = initializeApp(firebaseConfig);
  return getFirestore(app);
}
