import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { db, config, dataDir } from './db.js';
import { calculate } from './calculation.js';
const app = express();
const production = process.env.NODE_ENV === 'production';
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'https:'], connectSrc: ["'self'"] } }, strictTransportSecurity: production ? undefined : false }));
app.use(express.json({ limit: '128kb' }));
app.use('/api', (req,res,next) => { res.set('Cache-Control','no-store'); if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({error:'الطلب غير مسموح.'}); next(); });
app.use('/api', rateLimit({windowMs: 60000, limit: 180, message: {error:'طلبات كثيرة. يرجى الانتظار قليلًا.'}}));
const hash = s => createHash('sha256').update(s).digest('hex');
function admin(req,res,next) {
  const token = /(?:^|;\s*)mrd_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  const session = token && db.prepare('SELECT * FROM admin_sessions WHERE token_hash=? AND expires>?').get(hash(token), Date.now());
  if (!session) return res.status(401).json({error:'يرجى تسجيل الدخول إلى لوحة الإدارة.'});
  req.session = session; next();
}
function text(value, max = 500) { if (typeof value !== 'string' || value.length > max) throw new Error('يرجى التحقق من البيانات المدخلة.'); return value.trim(); }
function num(value, min = 0, max = 1e12) { const n = Number(value); if (value === '' || value == null || !Number.isFinite(n) || n < min || n > max) throw new Error('يرجى إدخال قيمة رقمية صحيحة.'); return n; }
const active = v => v === true || v === 1 ? 1 : 0;
const publicOrder = o => { if (!o) return null; const {internal_note,proof,...safe} = o; return {...safe, has_proof: !!proof}; };
const statuses = ['بانتظار الدفع','تم إرسال إثبات الدفع','قيد المراجعة','تم تأكيد الدفع','قيد التنفيذ','مكتملة','مرفوضة','ملغاة'];
app.get('/api/config', (req,res) => res.json(config()));
app.post('/api/quote', (req,res) => res.json(calculate(req.body, config())));
app.post('/api/orders', rateLimit({windowMs:3600000,limit:20,message:{error:'وصلت إلى حد الطلبات. يرجى المحاولة لاحقًا.'}}), (req,res) => {
  const c = config(true), input = req.body, q = calculate(input,c);
  const recipient = text(input.recipient,200);
  if (recipient.length < 5) throw new Error('يرجى إدخال بيانات الاستلام كاملة.');
  const network = input.service === 'usdt' ? c.networks.find(n => n.id === Number(input.network) && n.active) : null;
  if (input.service === 'usdt' && !network) throw new Error('اختر شبكة تحويل مفعلة.');
  if (input.service === 'usdt' && input.direction === 'buy') {
    const valid = network.name === 'TRC20' ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(recipient) : ['ERC20','BEP20'].includes(network.name) ? /^0x[a-fA-F0-9]{40}$/.test(recipient) : /^[A-Za-z0-9:_-]{20,150}$/.test(recipient);
    if (!valid) throw new Error('عنوان الاستلام غير صالح للشبكة المحددة.');
  }
  const deposit = q.currency === 'USDT' ? network.address : c.wallets.find(w => w.currency === q.currency)?.address;
  if (!deposit) throw new Error('عنوان استقبال هذه العملية غير متاح حاليًا. يرجى التواصل مع الدعم.');
  const service = c.services.find(s => s.id === input.service);
  const id = 'MRD-' + randomBytes(10).toString('hex').toUpperCase();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO orders(id,service_id,direction,amount,currency,network,deposit_address,recipient,commission_percent,commission,exchange_rate,final_amount,final_currency,service_name,service_note,created_at,updated_at,commission_type,commission_fixed_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,service.id,input.direction,q.amount,q.currency,network?.name || null,deposit,recipient,q.percent,q.commission,q.rate,q.finalAmount,q.finalCurrency,service.name,service.note,now,now,q.commissionType,q.fixedAmount);
  res.status(201).json(publicOrder(db.prepare('SELECT * FROM orders WHERE id=?').get(id)));
});
app.get('/api/orders/:id', rateLimit({windowMs:60000,limit:30,message:{error:'يرجى الانتظار قليلًا قبل المحاولة مجددًا.'}}), (req,res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id.replace(/^#/,'').toUpperCase());
  if (!order) return res.status(404).json({error:'لم نعثر على الطلب. تأكد من رقم الطلب وحاول مجددًا.'});
  res.json(publicOrder(order));
});
const upload = multer({ storage:multer.memoryStorage(), limits:{fileSize:5*1024*1024,files:1,fields:2} });
const proofDir = path.join(dataDir,'proofs'); mkdirSync(proofDir,{recursive:true});
app.post('/api/orders/:id/proof', upload.single('proof'), (req,res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({error:'الطلب غير موجود.'});
  if (!['بانتظار الدفع','تم إرسال إثبات الدفع'].includes(order.status)) throw new Error('لا يمكن تعديل إثبات الدفع في حالة الطلب الحالية.');
  const txid = text(req.body.txid || '',150);
  if (txid && !/^[a-zA-Z0-9_-]{8,150}$/.test(txid)) throw new Error('يرجى إدخال TXID صالح.');
  let proof = order.proof;
  if (req.file) {
    const b = req.file.buffer;
    const ext = b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : b[0]===255 && b[1]===216 && b[2]===255 ? 'jpg' : b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP' ? 'webp' : null;
    if (!ext) throw new Error('يرجى رفع صورة بصيغة PNG أو JPG أو WebP.');
    proof = randomBytes(20).toString('hex') + '.' + ext; writeFileSync(path.join(proofDir,proof),b);
  }
  if (!proof && !txid) throw new Error('أرفق صورة إثبات الدفع أو أدخل TXID.');
  db.prepare('UPDATE orders SET proof=?,txid=?,status=?,updated_at=? WHERE id=?').run(proof,txid,'تم إرسال إثبات الدفع',new Date().toISOString(),order.id);
  res.json(publicOrder(db.prepare('SELECT * FROM orders WHERE id=?').get(order.id)));
});
app.post('/api/admin/login',rateLimit({windowMs:15*60000,limit:10,message:{error:'محاولات كثيرة. يرجى المحاولة بعد 15 دقيقة.'}}),(req,res) => {
  const username = text(req.body.username,100), password = text(req.body.password,200);
  const user = db.prepare('SELECT * FROM admin_users WHERE username=?').get(username);
  const [salt,expected] = (user?.password_hash || 'invalid:'+ '0'.repeat(128)).split(':');
  if (!timingSafeEqual(scryptSync(password,salt,64),Buffer.from(expected,'hex')) || !user) return res.status(401).json({error:'اسم المستخدم أو كلمة المرور غير صحيحة.'});
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM admin_sessions WHERE expires<?').run(Date.now());
  db.prepare('INSERT INTO admin_sessions VALUES(?,?,?)').run(hash(token),user.id,Date.now()+8*3600000);
  res.cookie('mrd_session',token,{httpOnly:true,secure:production,sameSite:'strict',maxAge:8*3600000,path:'/api/admin'}).json({ok:true});
});
app.use('/api/admin',admin);
app.post('/api/admin/logout',(req,res) => {db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(req.session.token_hash);res.clearCookie('mrd_session',{path:'/api/admin'}).json({ok:true});});
app.get('/api/admin/config',(req,res) => res.json(config(true)));
app.get('/api/admin/orders',(req,res) => res.json(db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500').all()));
app.get('/api/admin/stats',(req,res) => res.json({today:db.prepare("SELECT count(*) AS n FROM orders WHERE date(created_at)=date('now')").get().n,review:db.prepare("SELECT count(*) AS n FROM orders WHERE status IN ('تم إرسال إثبات الدفع','قيد المراجعة')").get().n,progress:db.prepare("SELECT count(*) AS n FROM orders WHERE status='قيد التنفيذ'").get().n,completed:db.prepare("SELECT count(*) AS n FROM orders WHERE status='مكتملة'").get().n}));
app.get('/api/admin/proofs/:file',(req,res) => { if (!/^[a-f0-9]{40}\.(png|jpg|webp)$/.test(req.params.file)) return res.sendStatus(404); res.sendFile(path.join(proofDir,req.params.file)); });
app.patch('/api/admin/orders/:id',(req,res) => { if (!statuses.includes(req.body.status)) throw new Error('حالة الطلب غير صالحة.'); db.prepare('UPDATE orders SET status=?,internal_note=?,updated_at=? WHERE id=?').run(req.body.status,text(req.body.internal_note,3000),new Date().toISOString(),req.params.id);res.json({ok:true}); });
app.put('/api/admin/rate',(req,res) => {db.prepare('UPDATE exchange_rates SET rate=?,updated_at=? WHERE id=1').run(num(req.body.rate,0.000001),new Date().toISOString());res.json({ok:true});});
app.put('/api/admin/settings',(req,res) => {
  const b = req.body;
  for (const value of [b.logo,b.support_link]) if (value && !/^https:\/\//.test(value) && !(value.startsWith('/') && !value.startsWith('//'))) throw new Error('الرابط يجب أن يبدأ بـ https:// أو مسار محلي.');
  db.prepare('UPDATE platform_settings SET name=?,logo=?,contact=?,support_phone=?,support_link=?,active=?,announcement=? WHERE id=1').run(text(b.name,80),text(b.logo,1000),text(b.contact,500),text(b.support_phone,50),text(b.support_link,1000),active(b.active),text(b.announcement,1000));res.json({ok:true});
});
app.put('/api/admin/services/:id',(req,res) => {
  const b = req.body, minimum = num(b.minimum), maximum = b.maximum === '' || b.maximum == null ? null : num(b.maximum,minimum);
  const allowed = req.params.id === 'usdt' ? ['sell','buy'] : ['usd-syp','syp-usd'];
  if (!Array.isArray(b.directions) || !b.directions.every(d => allowed.includes(d)) || !Array.isArray(b.currencies) || !b.currencies.every(c => ['USD','SYP'].includes(c))) throw new Error('الاتجاهات أو العملات غير صحيحة.');
  db.prepare('UPDATE services SET name=?,description=?,active=?,minimum=?,maximum=?,note=?,directions=?,currencies=? WHERE id=?').run(text(b.name,100),text(b.description),active(b.active),minimum,maximum,text(b.note,1000),JSON.stringify(b.directions),JSON.stringify(b.currencies),req.params.id);res.json({ok:true});
});
app.put('/api/admin/wallets/:id',(req,res) => {db.prepare('UPDATE wallets SET address=? WHERE id=?').run(text(req.body.address,200),req.params.id);res.json({ok:true});});
app.post('/api/admin/networks',(req,res) => {const b=req.body; const name=text(b.name,30),address=text(b.address,200);if (!name || (active(b.active) && !address)) throw new Error('اسم الشبكة وعنوان الشبكة المفعلة مطلوبان.');db.prepare('INSERT INTO networks(name,address,active) VALUES(?,?,?)').run(name,address,active(b.active));res.json({ok:true});});
app.put('/api/admin/networks/:id',(req,res) => {const b=req.body; const name=text(b.name,30),address=text(b.address,200);if(!name || (active(b.active) && !address))throw new Error('اسم الشبكة وعنوان الشبكة المفعلة مطلوبان.');db.prepare('UPDATE networks SET name=?,address=?,active=? WHERE id=?').run(name,address,active(b.active),req.params.id);res.json({ok:true});});
function tierValues(b,id) {
  const type = b.type ?? 'percent';
  if (!['percent','fixed'].includes(type)) throw new Error('اختر نوع عمولة صحيحًا.');
  const minimum=num(b.minimum),maximum=b.maximum === '' || b.maximum == null ? null:num(b.maximum,minimum+0.000001);
  const percent = type === 'percent' ? num(b.percent,0,99.99) : 0;
  const fixedAmount = type === 'fixed' ? num(b.fixed_amount,0,1e12) : 0;
  if (type === 'fixed' && Math.abs(fixedAmount * 1e6 - Math.round(fixedAmount * 1e6)) > 0.00001) throw new Error('العمولة الثابتة تقبل حتى 6 منازل عشرية.');
  if (type === 'fixed' && maximum != null && fixedAmount >= maximum) throw new Error('يجب أن تكون العمولة الثابتة أقل من الحد الأعلى للشريحة.');
  if(active(b.active)) {
    const overlap=db.prepare('SELECT * FROM commission_tiers WHERE active=1 AND id!=?').all(id || -1).some(t => minimum < (t.maximum ?? Infinity) && (maximum ?? Infinity) > t.minimum);
    if(overlap)throw new Error('هذه الشريحة تتداخل مع شريحة مفعلة. عدّل الحدود أولًا.');
  }
   return [minimum,maximum,percent,active(b.active),type,fixedAmount];
}
app.post('/api/admin/tiers',(req,res)=>{db.prepare('INSERT INTO commission_tiers(minimum,maximum,percent,active,type,fixed_amount) VALUES(?,?,?,?,?,?)').run(...tierValues(req.body));res.json({ok:true});});
app.put('/api/admin/tiers/:id',(req,res)=>{db.prepare('UPDATE commission_tiers SET minimum=?,maximum=?,percent=?,active=?,type=?,fixed_amount=? WHERE id=?').run(...tierValues(req.body,Number(req.params.id)),req.params.id);res.json({ok:true});});
for(const [route,table] of [['tiers','commission_tiers'],['networks','networks']]) app.delete(`/api/admin/${route}/:id`,(req,res)=>{db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);res.json({ok:true});});
app.use('/api',(req,res)=>res.status(404).json({error:'المسار غير موجود.'}));
const dist=path.resolve('dist');
if(existsSync(dist)){app.use(express.static(dist));app.get('/{*path}',(req,res)=>res.sendFile(path.join(dist,'index.html')));}
app.use((err,req,res,next)=>{if(err.code==='LIMIT_FILE_SIZE')return res.status(400).json({error:'حجم الصورة يجب ألا يتجاوز 5 ميغابايت.'}); console.error(err.message);res.status(400).json({error:err.message?.includes('UNIQUE') ? 'هذه القيمة موجودة مسبقًا.' : err.message?.includes('SQLITE') ? 'تعذر حفظ البيانات. تحقق من المدخلات.' : err.message || 'حدث خطأ غير متوقع.'});});
app.listen(Number(process.env.PORT || 3001),'0.0.0.0',()=>console.log('المارديني: http://localhost:'+(process.env.PORT || 3001)));
