import { getMessaging, getToken, onMessage } from 'firebase/messaging'
import { doc, updateDoc } from 'firebase/firestore'
import app, { db } from './config'

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string

let messagingInstance: ReturnType<typeof getMessaging> | null = null

function getMsg() {
  if (!messagingInstance) messagingInstance = getMessaging(app)
  return messagingInstance
}

/** Demande la permission + enregistre le token FCM dans Firestore (users/{uid}) */
export async function registerFCMToken(uid: string): Promise<void> {
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return

    const registration = await navigator.serviceWorker.ready
    const token = await getToken(getMsg(), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration })
    if (token) {
      await updateDoc(doc(db, 'users', uid), { fcmToken: token })
    }
  } catch (e) {
    console.warn('[FCM] Token registration failed:', e)
  }
}

/** Callback quand un message arrive en foreground */
export function onForegroundMessage(cb: (payload: any) => void) {
  return onMessage(getMsg(), cb)
}
