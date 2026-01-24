// firebase-config.js
// Thay config bên dưới bằng config từ Firebase Console của bạn
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

export function initFirebase() {
  const firebaseConfig = {
  apiKey: "AIzaSyCYxFAVaey6NeM5diL90312tIflIPduBEs",
  authDomain: "friendsmda-d3e5d.firebaseapp.com",
  projectId: "friendsmda-d3e5d",
  storageBucket: "friendsmda-d3e5d.firebasestorage.app",
  messagingSenderId: "300350999498",
  appId: "1:300350999498:web:3721aa674682cfa6eadd33",
  measurementId: "G-J56077Z67G"
};

  const app = initializeApp(firebaseConfig);
  return getFirestore(app);
}
