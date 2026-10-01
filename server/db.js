import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
export const dataDir = path.resolve(process.env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, 'mardini.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, minimum REAL NOT NULL, maximum REAL, note TEXT NOT NULL, directions TEXT NOT NULL, currencies TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS commission_tiers (id INTEGER PRIMARY KEY AUTOINCREMENT, minimum REAL NOT NULL, maximum REAL, percent REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS exchange_rates (id INTEGER PRIMARY KEY CHECK(id=1), rate REAL NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS networks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, address TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS wallets (id INTEGER PRIMARY KEY AUTOINCREMENT, currency TEXT NOT NULL UNIQUE, address TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS platform_settings (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, logo TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', support_phone TEXT NOT NULL DEFAULT '', support_link TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, announcement TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, service_id TEXT NOT NULL, direction TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, network TEXT, deposit_address TEXT NOT NULL, recipient TEXT NOT NULL, commission_percent REAL NOT NULL, commission REAL NOT NULL, exchange_rate REAL NOT NULL, final_amount REAL NOT NULL, final_currency TEXT NOT NULL, service_name TEXT NOT NULL, service_note TEXT NOT NULL, proof TEXT, txid TEXT, status TEXT NOT NULL DEFAULT 'بانتظار الدفع', internal_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admin_users(id), expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at);
`);
// Additive migration: existing tiers and historical order amounts remain unchanged.
db.exec('BEGIN IMMEDIATE');
try {
  for (const [table, column, definition] of [
    ['commission_tiers', 'type', "TEXT NOT NULL DEFAULT 'percent' CHECK(type IN ('percent','fixed'))"],
    ['commission_tiers', 'fixed_amount', 'REAL NOT NULL DEFAULT 0 CHECK(fixed_amount >= 0)'],
    ['orders', 'commission_type', "TEXT NOT NULL DEFAULT 'percent'"],
    ['orders', 'commission_fixed_amount', 'REAL NOT NULL DEFAULT 0'],
  ]) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
  db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }
if (!db.prepare('SELECT id FROM platform_settings').get()) {
  db.prepare('INSERT INTO platform_settings(id,name) VALUES(1,?)').run('المارديني');
  db.prepare('INSERT INTO exchange_rates VALUES(1,12500,?)').run(new Date().toISOString());
  const insert = db.prepare('INSERT INTO services VALUES(?,?,?,?,?,?,?,?,?)');
  insert.run('usdt', 'شراء وبيع USDT', 'شراء وبيع USDT مقابل رصيد شام كاش', 1, 10, null, 'يتم تنفيذ الطلب بعد تأكيد استلام الدفعة. تستغرق المعاملة عادةً حتى 15 دقيقة.', '["sell","buy"]', '["USD","SYP"]');
  insert.run('exchange', 'تصريف شام كاش', 'تحويل الرصيد بين الدولار والليرة السورية', 1, 1, null, 'تصريف رصيدك دون عمولة إضافية. يتم التنفيذ بعد تأكيد استلام الدفعة.', '["usd-syp","syp-usd"]', '["USD","SYP"]');
  const tier = db.prepare('INSERT INTO commission_tiers(minimum,maximum,percent) VALUES(?,?,?)');
  tier.run(0,100,2); tier.run(100,500,1.5); tier.run(500,1000,1); tier.run(1000,null,0.5);
  // Networks become available only after an administrator supplies a real deposit address.
  for (const name of ['TRC20','ERC20','BEP20']) db.prepare('INSERT INTO networks(name,address,active) VALUES(?,?,0)').run(name,'');
  for (const currency of ['USD','SYP']) db.prepare('INSERT INTO wallets(currency,address) VALUES(?,?)').run(currency,'');
}
export function config(admin = false) {
  return { services: db.prepare('SELECT * FROM services').all().map(s => ({...s, directions: JSON.parse(s.directions), currencies: JSON.parse(s.currencies)})),
    tiers: db.prepare(`SELECT * FROM commission_tiers ${admin ? '' : 'WHERE active=1'} ORDER BY minimum`).all(),
    rate: db.prepare('SELECT * FROM exchange_rates WHERE id=1').get().rate,
    networks: db.prepare(`SELECT * FROM networks ${admin ? '' : 'WHERE active=1'}`).all(),
    wallets: admin ? db.prepare('SELECT * FROM wallets').all() : undefined,
    settings: db.prepare('SELECT * FROM platform_settings WHERE id=1').get() };
}
