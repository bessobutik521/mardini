import { scryptSync, randomBytes } from 'node:crypto';
import { db } from './db.js';
const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PASSWORD;
if (!username || !password || password.length < 12) { console.error('عيّن ADMIN_USERNAME و ADMIN_PASSWORD (12 حرفًا على الأقل) في متغيرات البيئة.'); process.exit(1); }
const salt = randomBytes(16).toString('hex');
const hash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
db.prepare('INSERT INTO admin_users(username,password_hash) VALUES(?,?) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash').run(username, hash);
db.prepare('DELETE FROM admin_sessions WHERE admin_id=(SELECT id FROM admin_users WHERE username=?)').run(username);
console.log('تم إنشاء حساب الإدارة وتحديث كلمة المرور بنجاح.');
