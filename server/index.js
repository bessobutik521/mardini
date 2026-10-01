import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const supaUrl = process.env.SUPABASE_URL || 'https://ijzukzccrrmsfffewqwj.supabase.co';
const supaAnon = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqenVremNjcnJtc2ZmZmV3cXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3ODkyMzksImV4cCI6MjEwNjM2NTIzOX0.EiM88OWwCMmbPy5xSzDTqUPmF68OywEE6IBb4eDuY5Q';
const supaSvc = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqenVremNjcnJtc2ZmZmV3cXdqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDc4OTIzOSwiZXhwIjoyMTA2MzY1MjM5fQ.3fG0LykbEq1tXHQ0Fga0psdP-7b4o2gzxv6OAERLO4c';

export const supabase = createClient(supaUrl, supaAnon);
export const supabaseAdmin = createClient(supaUrl, supaSvc);

const app = express();
const production = process.env.NODE_ENV === 'production';
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
app.use(helmet());
app.use(express.json({ limit: '128kb' }));
app.use('/api', (req,res,next) => { next(); });
app.use('/api', rateLimit({windowMs: 60000, limit: 180}));

function hash(s) { return createHash('sha256').update(s).digest('hex'); }

function text(value, max = 500) { if (typeof value !== 'string' || value.length > max) throw new Error('err'); return value.trim(); }

function num(value, min = 0, max = 1e12) { const n = Number(value); if (value === '' || value == null || !Number.isFinite(n) || n < min || n > max) throw new Error('err'); return n; }

const active = v => v === true || v === 1 ? 1 : 0;

const statuses = ['pending','proof','review','paid','processing','completed','rejected','cancelled'];

app.get('/api/config', async (req,res) => { res.json({}); });
app.post('/api/quote', (req,res) => { res.json({}); });
app.post('/api/orders', async (req,res) => { res.status(201).json({id:'MRD-TEST'}); });
app.get('/api/orders/:id', async (req,res) => { res.json({id:req.params.id}); });

app.listen(3001, '0.0.0.0', () => console.log(' running on port 3001'));