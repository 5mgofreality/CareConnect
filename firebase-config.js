// Firebase Configuration
// Initialize Firebase for CareConnect

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, getDocs, updateDoc, doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { getDatabase, ref, set, get, update, push, onValue } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDemoKey123456789", // Replace with your Firebase API key
    authDomain: "careconnect-app.firebaseapp.com",
    projectId: "careconnect-app",
    storageBucket: "careconnect-app.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abcdef123456"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);

// ==================== AUTHENTICATION ====================

/**
 * Register a new primary user (elderly/speech-impaired person)
 */
export async function registerPrimaryUser(email, password, userData) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const uid = userCredential.user.uid;

        // Store user profile in Firestore
        await setDoc(doc(db, "users", uid), {
            uid: uid,
            email: email,
            name: userData.name,
            language: userData.language || "en",
            phone: userData.phone || "",
            dateOfBirth: userData.dateOfBirth || "",
            userType: "primary", // primary or caregiver
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        // Initialize activity log collection
        await setDoc(doc(db, "users", uid, "activityLog", "metadata"), {
            totalAlerts: 0,
            totalMessages: 0,
            lastActivity: serverTimestamp()
        });

        return { success: true, uid: uid };
    } catch (error) {
        console.error("Registration error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Register a new caregiver
 */
export async function registerCaregiver(email, password, caregiverData) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const uid = userCredential.user.uid;

        // Store caregiver profile
        await setDoc(doc(db, "users", uid), {
            uid: uid,
            email: email,
            name: caregiverData.name,
            phone: caregiverData.phone || "",
            userType: "caregiver",
            linkedUsers: [], // Array of UIDs of primary users this caregiver is linked to
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        return { success: true, uid: uid };
    } catch (error) {
        console.error("Caregiver registration error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Sign in user
 */
export async function signInUser(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        return { success: true, uid: userCredential.user.uid };
    } catch (error) {
        console.error("Sign in error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Sign out user
 */
export async function signOutUser() {
    try {
        await signOut(auth);
        return { success: true };
    } catch (error) {
        console.error("Sign out error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get current authenticated user
 */
export function getCurrentUser(callback) {
    return onAuthStateChanged(auth, callback);
}

// ==================== USER LINKING & CONNECTIONS ====================

/**
 * Generate unique invite code for primary user to share with caregiver
 */
export async function generateInviteCode(primaryUserId) {
    try {
        const inviteCode = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        
        await setDoc(doc(db, "inviteCodes", inviteCode), {
            primaryUserId: primaryUserId,
            createdAt: serverTimestamp(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            used: false,
            usedBy: null,
            usedAt: null
        });

        return { success: true, inviteCode: inviteCode };
    } catch (error) {
        console.error("Invite code generation error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Caregiver joins using invite code
 */
export async function caregiverJoinWithCode(caregiverId, inviteCode) {
    try {
        const inviteDocRef = doc(db, "inviteCodes", inviteCode);
        const inviteSnap = await getDoc(inviteDocRef);

        if (!inviteSnap.exists()) {
            return { success: false, error: "Invalid invite code" };
        }

        const inviteData = inviteSnap.data();
        
        if (inviteData.used) {
            return { success: false, error: "Invite code already used" };
        }

        if (new Date() > inviteData.expiresAt) {
            return { success: false, error: "Invite code expired" };
        }

        const primaryUserId = inviteData.primaryUserId;

        // Update primary user's caregiver list
        const primaryUserRef = doc(db, "users", primaryUserId);
        const primaryUserSnap = await getDoc(primaryUserRef);
        const caregivers = primaryUserSnap.data().caregivers || [];
        caregivers.push(caregiverId);
        await updateDoc(primaryUserRef, { caregivers: caregivers });

        // Update caregiver's linked users list
        const caregiverRef = doc(db, "users", caregiverId);
        const caregiverSnap = await getDoc(caregiverRef);
        const linkedUsers = caregiverSnap.data().linkedUsers || [];
        linkedUsers.push(primaryUserId);
        await updateDoc(caregiverRef, { linkedUsers: linkedUsers });

        // Mark invite code as used
        await updateDoc(inviteDocRef, {
            used: true,
            usedBy: caregiverId,
            usedAt: serverTimestamp()
        });

        // Create notification for primary user
        await addDoc(collection(db, "users", primaryUserId, "notifications"), {
            type: "caregiver_joined",
            caregiverId: caregiverId,
            caregiverName: (await getDoc(caregiverRef)).data().name,
            createdAt: serverTimestamp(),
            read: false
        });

        return { success: true, primaryUserId: primaryUserId };
    } catch (error) {
        console.error("Join with code error:", error);
        return { success: false, error: error.message };
    }
}

// ==================== ACTIVITY LOGGING ====================

/**
 * Log activity (alerts, messages, calls, etc.)
 */
export async function logActivity(primaryUserId, activityData) {
    try {
        const timestamp = serverTimestamp();
        
        await addDoc(collection(db, "users", primaryUserId, "activityLog"), {
            type: activityData.type, // "alert", "message", "call", "sos"
            message: activityData.message,
            contact: activityData.contact || null,
            platform: activityData.platform || null, // "whatsapp", "sms", "call"
            timestamp: timestamp,
            details: activityData.details || {}
        });

        // Update metadata
        const metadataRef = doc(db, "users", primaryUserId, "activityLog", "metadata");
        const metadataSnap = await getDoc(metadataRef);
        
        if (metadataSnap.exists()) {
            const currentData = metadataSnap.data();
            await updateDoc(metadataRef, {
                lastActivity: timestamp,
                totalAlerts: activityData.type === "alert" ? (currentData.totalAlerts || 0) + 1 : currentData.totalAlerts,
                totalMessages: activityData.type === "message" ? (currentData.totalMessages || 0) + 1 : currentData.totalMessages
            });
        }

        return { success: true };
    } catch (error) {
        console.error("Activity logging error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get activity log for a primary user (for caregiver dashboard)
 */
export async function getActivityLog(primaryUserId, limit = 50) {
    try {
        const q = query(
            collection(db, "users", primaryUserId, "activityLog"),
            orderBy("timestamp", "desc"),
            limit(limit)
        );

        const querySnapshot = await getDocs(q);
        const activities = [];
        querySnapshot.forEach((doc) => {
            if (doc.id !== "metadata") {
                activities.push({ id: doc.id, ...doc.data() });
            }
        });

        return { success: true, activities: activities };
    } catch (error) {
        console.error("Get activity log error:", error);
        return { success: false, error: error.message };
    }
}

// ==================== CAREGIVER DASHBOARD ====================

/**
 * Get dashboard summary for caregiver
 */
export async function getCaregiverDashboard(caregiverId) {
    try {
        const caregiverSnap = await getDoc(doc(db, "users", caregiverId));
        const linkedUsers = caregiverSnap.data().linkedUsers || [];

        let summaryData = [];

        for (const userId of linkedUsers) {
            const userSnap = await getDoc(doc(db, "users", userId));
            const userData = userSnap.data();
            
            const metadataSnap = await getDoc(doc(db, "users", userId, "activityLog", "metadata"));
            const metadata = metadataSnap.exists() ? metadataSnap.data() : {};

            summaryData.push({
                userId: userId,
                name: userData.name,
                email: userData.email,
                phone: userData.phone,
                lastActivity: metadata.lastActivity,
                totalAlerts: metadata.totalAlerts || 0,
                totalMessages: metadata.totalMessages || 0
            });
        }

        return { success: true, linkedUsers: summaryData };
    } catch (error) {
        console.error("Dashboard error:", error);
        return { success: false, error: error.message };
    }
}

export { onValue };
