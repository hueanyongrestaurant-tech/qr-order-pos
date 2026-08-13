import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyAID2jX0PJILzCl5hTKVeMCVKBKHuR0qJI",
    authDomain: "hueanyong-restaurant.firebaseapp.com",
    projectId: "hueanyong-restaurant",
    storageBucket: "hueanyong-restaurant.firebasestorage.app",
    messagingSenderId: "250543301933",
    appId: "1:250543301933:web:0a5f7e9960421b1d035fa4",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);