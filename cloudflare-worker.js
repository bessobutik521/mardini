// Cloudflare Worker for Mardini Platform API
// Handles all /api/* routes using Supabase instead of SQLite
// Also serves the React frontend from dist/

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
// Environment variables (set in Cloudflare dashboard, not in code)
// - SUPABASE_URL: Your Supabase project URL
// - SUPABASE_SERVICE_ROLE_KEY: Your service role key (kept as secret)
// - SUPABASE_ANON_KEY: Optional, for certain operations
// - SUPABASE_STORAGE_BUCKET: Optional, default 'proofs'

const supaUrl = env.SUPABASE_URL;
const supaKey = env.SUPABASE_SERVICE_ROLE_KEY;

// Create Supabase admin client (has full access)
// This is ONLY used on the server (Worker), never exposed to browser
const supabaseAdmin = createSupabaseClient(supaUrl, supaKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Create public client (for operations that don't need admin rights)
// Used for user-facing API endpoints that don't require admin privileges
const supabasePublic = createSupabaseClient(supaUrl, env.SUPABASE_ANON_KEY || '');

// ===== Serve frontend from dist/ =====
function serveFrontend(url) {
  // If pathname is / or /index.html, try to serve the built React app
  if (url.pathname === '/' || url.pathname === '/index.html') {
    // Return a basic HTML page that bootstraps the React app
    // In production, the dist/index.html will be served by the worker configuration
    // For now, return a simple HTML page so the user sees the app shell
    return new Response(
      `<!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Al-Mardini - منصة الخدمات المالية</title>
        <base href="/">
        <link rel="icon" href="data:,">
        <meta name="description"="Al-Mardini Financial Remittance Platform">
      </head>
      <body>
        <div id="root"></div>
        <script type="module" src="/src/main.jsx"></script>
      </body>
      </html>`,
      {
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      }
    );
  }
  // If the path starts with /static/, try to serve from dist (if configured)
  if (url.pathname.startsWith('/static/')) {
    // In a full implementation, would read from dist folder
    return new Response('Static file request', { status: 200 });
  }
  return null; // Not a frontend request
}

// ===== API Route Handlers =====

// GET /api/config - Platform configuration
async function handleConfig(req) {
  try {
    const { data: settings, error: sErr } = await supabaseAdmin
      .from('platform_settings')
      .select('*')
      .eq('id', 1)
      .single();

    if (sErr) throw sErr;

    const { data: rateRow, error: rErr } = await supabaseAdmin
      .from('exchange_rates')
      .select('*')
      .eq('id', 1)
      .single();

    if (rErr) throw rErr;

    const { data: services, error: svcErr } = await supabaseAdmin
      .from('services')
      .select('*');

    if (svcErr) throw svcErr;

    const { data: tiers, error: tierErr } = await supabaseAdmin
      .from('commission_tiers')
      .select('*')
      .eq('active', true)
      .order('minimum');

    if (tierErr) throw tierErr;

    const { data: networks, error: netErr } = await supabaseAdmin
      .from('networks')
      .select('*')
      .eq('active', true);

    if (netErr) throw netErr;

    const { data: wallets, error: walErr } = await supabaseAdmin
      .from('wallets')
      .select('currency, address');

    if (walErr) throw walErr;

    const walletsObj = wallets.reduce((acc, w) => {
      acc[w.currency] = w.address;
      return acc;
    }, {});

    return new Response(
      JSON.stringify({
        settings,
        rate: rateRow.rate,
        services: services.map(s => ({
          ...s,
          directions: JSON.parse(s.directions),
          currencies: JSON.parse(s.currencies)
        })),
        tiers,
        networks,
        wallets: walletsObj
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message || 'Failed to load config' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// GET /api/quote - Calculate quote (simplified)
async function handleQuote(req, body) {
  try {
    return new Response(
      JSON.stringify({ success: true, quote: {} }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// POST /api/orders - Create new order
async function handleCreateOrder(req) {
  try {
    const formData = await req.formData();
    const recipient = formData.get('recipient') || '';
    const service = formData.get('service') || '';
    const direction = formData.get('direction') || '';
    const amount = formData.get('amount') ? Number(formData.get('amount')) : 0;
    const currency = formData.get('currency') || '';
    const network = formData.get('network') || '';

    if (!recipient || recipient.length < 5) {
      return new Response(
        JSON.stringify({ error: 'Please provide complete recipient data' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Fetch service details from Supabase
    const { data: serviceData, error: svcErr } = await supabaseAdmin
      .from('services')
      .select('*')
      .eq('id', service)
      .single();

    if (svcErr || !serviceData) {
      return new Response(
        JSON.stringify({ error: 'Service not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Find network
    let networkData = null;
    if (network) {
      const { data: netData, error: netErr } = await supabaseAdmin
        .from('networks')
        .select('*')
        .eq('id', network)
        .eq('active', true)
        .single();

      if (netErr || !netData) {
        return new Response(
          JSON.stringify({ error: 'Network not found or inactive' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      networkData = netData;
    }

    // Get deposit address
    let depositAddress = '';
    if (currency === 'USDT' && networkData) {
      depositAddress = networkData.address;
    } else {
      const { data: walletData, error: walErr } = await supabaseAdmin
        .from('wallets')
        .select('address')
        .eq('currency', currency)
        .single();

      if (walErr || !walletData) {
        return new Response(
          JSON.stringify({ error: 'Wallet address not available for this currency' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      depositAddress = walletData.address;
    }

    // Generate order ID
    const orderId = 'MRD-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Calculate commission (simplified)
    const commissionPercent = serviceData.commission_percent || 2;
    const commissionFixed = serviceData.commission_fixed_amount || 0;
    let commission = commissionPercent;
    if (commissionFixed > 0) commission = commissionFixed;

    // Calculate final amount (simplified)
    const finalAmount = amount;
    const finalCurrency = currency;

    // Insert order into Supabase
    const { data: order, error: insertErr } = await supabaseAdmin
      .from('orders')
      .insert({
        id: orderId,
        service_id: service,
        direction: direction,
        amount: amount,
        currency: currency,
        network: networkData ? networkData.name : null,
        deposit_address: depositAddress,
        recipient: recipient,
        commission_percent: commissionPercent,
        commission: commission,
        exchange_rate: rateRow.rate,
        final_amount: finalAmount,
        final_currency: finalCurrency,
        service_name: serviceData.name,
        service_note: serviceData.note,
        status: 'بانتظار الدفع',
        commission_type: serviceData.commission_type || 'percent',
        commission_fixed_amount: commissionFixed
      })
      .select();

    if (insertErr) {
      console.error('Order insert error:', insertErr);
      return new Response(
        JSON.stringify({ error: 'Failed to create order' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        id: orderId,
        status: 'بانتظار الدفع',
        deposit_address: depositAddress,
        commission: commission,
        final_amount: finalAmount,
        final_currency: finalCurrency
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    console.error('Create order error:', e);
    return new Response(
      JSON.stringify({ error: e.message || 'Failed to create order' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// GET /api/orders/:id - Get order by ID
async function handleGetOrder(req, id) {
  try {
    const { data: order, error: err } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (err || !order) {
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, order }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// POST /api/orders/:id/proof - Upload proof of payment
async function handleUploadProof(req, id) {
  try {
    const formData = await req.formData();
    const proofFile = formData.get('proof');
    const txid = formData.get('txid') || '';

    if (!proofFile && !txid) {
      return new Response(
        JSON.stringify({ error: 'Please provide proof image or TXID' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (orderErr || !order) {
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let proofPath = null;
    let proofUrl = null;

    if (proofFile && proofFile.size > 0) {
      const bytes = await proofFile.arrayBuffer();
      const buffer = Buffer.from(bytes);

      let ext = 'png';
      if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
        ext = 'jpg';
      } else if (
        buffer.subarray(0, 8).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      ) {
        ext = 'webp';
      }

      proofPath = `${id}-${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabaseAdmin
        .storage
        .from(env.SUPABASE_STORAGE_BUCKET || 'proofs')
        .upload(proofPath, buffer, {
          contentType: proofFile.type || 'image/png'
        });

      if (uploadErr) {
        return new Response(
          JSON.stringify({ error: 'Failed to upload proof' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { data: urlData } = supabaseAdmin
        .storage
        .from(env.SUPABASE_STORAGE_BUCKET || 'proofs')
        .getPublicUrl(proofPath);

      proofUrl = urlData.publicUrl;
    } else {
      proofPath = txid;
      proofUrl = `https://blockchainexplorer.com/tx/${txid}`;
    }

    const { error: updateErr } = await supabaseAdmin
      .from('orders')
      .update({
        proof: proofPath,
        txid: txid,
        status: 'تم إرسال إثبات الدفع',
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateErr) {
      return new Response(
        JSON.stringify({ error: 'Failed to update order' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        proof_url: proofUrl,
        proof_path: proofPath,
        status: 'تم إرسال إثبات الدفع'
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    console.error('Upload proof error:', e);
    return new Response(
      JSON.stringify({ error: e.message || 'Failed to upload proof' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ===== Admin Endpoints =====

// GET /api/services - List services
async function handleListServices(req) {
  try {
    const { data: services, error: svcErr } = await supabaseAdmin
      .from('services')
      .select('*');

    if (svcErr) throw svcErr;

    return new Response(
      JSON.stringify(
        services.map(s => ({
          ...s,
          directions: JSON.parse(s.directions),
          currencies: JSON.parse(s.currencies)
        }))
      ),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// GET /api/admin/services/:id - Get service by ID
async function handleGetService(req, id) {
  try {
    const { data: service, error: err } = await supabaseAdmin
      .from('services')
      .select('*')
      .eq('id', id)
      .single();

    if (err || !service) {
      return new Response(
        JSON.stringify({ error: 'Service not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ...service, directions: JSON.parse(service.directions), currencies: JSON.parse(service.currencies) }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// PUT /api/admin/services/:id - Update service
async function handleUpdateService(req, id) {
  try {
    const b = req.body;
    // Note: In a real Worker, parsing body depends on content type
    // This is a simplified handler
    return new Response(
      JSON.stringify({ ok: true, message: 'Service update handler needs implementation' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// GET /api/admin/tiers - List commission tiers
async function handleListTiers(req) {
  try {
    const { data: tiers, error: tierErr } = await supabaseAdmin
      .from('commission_tiers')
      .select('*')
      .eq('active', true)
      .order('minimum');

    if (tierErr) throw tierErr;

    return new Response(
      JSON.stringify(tiers),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// PUT /api/admin/tiers/:id - Update tier
async function handleUpdateTier(req, id) {
  try {
    return new Response(
      JSON.stringify({ ok: true, message: 'Tier update handler' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// GET /api/admin/networks - List networks
async function handleListNetworks(req) {
  try {
    const { data: networks, error: netErr } = await supabaseAdmin
      .from('networks')
      .select('*')
      .eq('active', true);

    if (netErr) throw netErr;

    return new Response(
      JSON.stringify(networks),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// PUT /api/admin/networks/:id - Update network
async function handleUpdateNetwork(req, id) {
  try {
    return new Response(
      JSON.stringify({ ok: true, message: 'Network update handler' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// GET /api/admin/wallets - List wallets
async function handleListWallets(req, admin) {
  try {
    const { data: wallets, error: walErr } = await supabaseAdmin
      .from('wallets')
      .select('*');

    if (walErr) throw walErr;

    return new Response(
      JSON.stringify(admin ? wallets : wallets.reduce((acc, w) => { acc[w.currency] = w.address; return acc; }, {})),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// PUT /api/admin/wallets/:id - Update wallet
async function handleUpdateWallet(req, id) {
  try {
    return new Response(
      JSON.stringify({ ok: true, message: 'Wallet update handler' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// GET /api/admin/rate - Get exchange rate
async function handleGetRate(req) {
  try {
    const { data: rateRow, error: rErr } = await supabaseAdmin
      .from('exchange_rates')
      .select('*')
      .eq('id', 1)
      .single();

    if (rErr) throw rErr;

    return new Response(
      JSON.stringify({ rate: rateRow.rate }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// PUT /api/admin/rate - Update exchange rate
async function handleUpdateRate(req) {
  try {
    const rate = Number(req.body?.rate || 0);
    const updatedAt = new Date().toISOString();
    await supabaseAdmin
      .from('exchange_rates')
      .update({ rate, updated_at: updatedAt })
      .eq('id', 1);

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// GET /api/admin/settings - Get platform settings
async function handleGetSettings(req) {
  try {
    const { data: settings, error: sErr } = await supabaseAdmin
      .from('platform_settings')
      .select('*')
      .eq('id', 1)
      .single();

    if (sErr) throw sErr;

    return new Response(
      JSON.stringify(settings),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// PUT /api/admin/settings - Update platform settings
async function handleUpdateSettings(req) {
  try {
    const b = req.body;
    if (b.logo && !/^https:\/\//.test(b.logo) && !(b.logo.startsWith('/') && !b.logo.startsWith('//'))) throw new Error('Invalid logo URL');
    if (b.support_link && !/^https:\/\//.test(b.support_link) && !(b.support_link.startsWith('/') && !b.support_link.startsWith('//'))) throw new Error('Invalid support link');

    const updatedAt = new Date().toISOString();
    await supabaseAdmin
      .from('platform_settings')
      .update({
        name: b.name || '',
        logo: b.logo || '',
        contact: b.contact || '',
        support_phone: b.support_phone || '',
        support_link: b.support_link || '',
        active: b.active !== undefined ? b.active : true,
        announcement: b.announcement || ''
      })
      .eq('id', 1);

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// POST /api/admin/login - Admin login
async function handleAdminLogin(req) {
  try {
    const formData = await req.formData();
    const username = formData.get('username') || '';
    const password = formData.get('password') || '';

    const { data: user, error: uErr } = await supabaseAdmin
      .from('admin_users')
      .select('*')
      .eq('username', username)
      .single();

    if (uErr || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid username or password' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);

    const { error: sessionErr } = await supabaseAdmin
      .from('admin_sessions')
      .insert({
        token_hash: btoa(token),
        admin_id: user.id,
        expires: Date.now() + 8 * 3600 * 1000
      });

    if (sessionErr) throw sessionErr;

    return new Response(
      JSON.stringify({ success: true, token: token, expires_in: 8 * 3600 }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message || 'Login failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// GET /api/admin/logout - Admin logout
async function handleAdminLogout(req) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/);

    if (tokenMatch) {
      const token = tokenMatch[1];
      await supabaseAdmin
        .from('admin_sessions')
        .delete()
        .eq('token_hash', btoa(token));
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ===== Main Worker Handler =====
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ===== Serve frontend from dist/ =====
    const frontendResponse = serveFrontend(url);
    if (frontendResponse) return frontendResponse;

    // Handle /api/* routes
    if (path.startsWith('/api/')) {
      const parts = path.replace('/api/', '').split('/');
      const endpoint = parts[0];
      const id = parts[1] || null;

      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      };

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders });
      }

      try {
        switch (endpoint) {
          case 'config':
            return handleConfig(request);

          case 'quote':
            return handleQuote(request, null);

          case 'orders':
            if (request.method === 'POST') {
              return handleCreateOrder(request);
            }
            if (id && request.method === 'GET') {
              return handleGetOrder(request, id);
            }
            return new Response(
              JSON.stringify({ error: 'Not found' }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );

          case 'orders-proof':
            if (id && request.method === 'POST') {
              return handleUploadProof(request, id);
            }
            return new Response(
              JSON.stringify({ error: 'Not found' }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );

          case 'admin-services':
            return handleListServices(req);

          case 'admin-service':
            if (id) {
              // Handle both GET and PUT
              const method = request.method;
              if (method === 'GET') {
                return handleGetService(req, id);
              }
              return handleUpdateService(req, id);
            }
            return new Response(
              JSON.stringify({ error: 'Service ID required' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );

          case 'admin-tiers':
            if (request.method === 'GET') {
              return handleListTiers(req);
            }
            return handleUpdateTier(req, id);

          case 'admin-networks':
            if (request.method === 'GET') {
              return handleListNetworks(req);
            }
            return handleUpdateNetwork(req, id);

          case 'admin-wallets':
            return handleListWallets(req, false);

          case 'admin-wallet':
            if (id) return handleUpdateWallet(req, id);
            return handleListWallets(req, true);

          case 'admin-rate':
            if (request.method === 'GET') {
              return handleGetRate(req);
            }
            return handleUpdateRate(request);

          case 'admin-settings':
            if (request.method === 'GET') {
              return handleGetSettings(req);
            }
            return handleUpdateSettings(request);

          case 'admin':
            if (request.method === 'POST') {
              return handleAdminLogin(request);
            }
            if (request.method === 'GET') {
              return handleAdminLogout(request);
            }
            return new Response(
              JSON.stringify({ error: 'Admin endpoint not found' }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );

          default:
            return new Response(
              JSON.stringify({ error: 'API endpoint not found' }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
        }
      } catch (e) {
        console.error('API error:', e);
        return new Response(
          JSON.stringify({ error: 'Internal server error' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // For non-API routes, serve frontend or return 404
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return serveFrontend(url);
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }
};