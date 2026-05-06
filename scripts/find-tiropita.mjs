import { db } from './_firebase_admin.mjs'
const snap = await db.collection('catalogue').get()
const all = snap.docs.map(d => d.data().name).filter(Boolean).sort()
console.log('Tiropitas :')
all.filter(n => n.toLowerCase().includes('tiro')).forEach(n => console.log(' ', n))
console.log('\nHoumous :')
all.filter(n => n.toLowerCase().includes('houmous') || n.toLowerCase().includes('hummus')).forEach(n => console.log(' ', n))
