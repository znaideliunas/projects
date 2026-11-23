// ============================================================
// server.js - REST API + static file server (no frameworks)
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { products, banners, platforms, regions } = require('./data');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || 'dev-secret-change-me';

// "Database": plain arrays in memory. They reset when the server restarts.
const users = [];
const orders = [];

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------

// Send a JSON response with a status code.
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Read the request body (it arrives in chunks) and parse it as JSON.
function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (err) {
        resolve({}); // invalid JSON -> treat as empty body
      }
    });
  });
}

// ------------------------------------------------------------
// Authentication
// ------------------------------------------------------------

// Hash a password with a random "salt" so equal passwords get different hashes.
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

// Create a signature for some text using our secret.
// Nobody can fake a valid signature without knowing SECRET.
function sign(text) {
  return crypto.createHmac('sha256', SECRET).update(text).digest('base64url');
}

// A token looks like "<payload>.<signature>".
// The payload says who the user is and when the token expires (24h).
function createToken(userId) {
  const payload = { id: userId, expires: Date.now() + 24 * 60 * 60 * 1000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return encoded + '.' + sign(encoded);
}

// Read the "Authorization: Bearer <token>" header and return the user,
// or null if the token is missing, forged or expired.
function getUserFromRequest(req) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
  const [encoded, signature] = token.split('.');

  if (!encoded || signature !== sign(encoded)) return null; // forged or missing

  const payload = JSON.parse(Buffer.from(encoded, 'base64url'));
  if (payload.expires < Date.now()) return null; // expired

  return users.find((user) => user.id === payload.id) || null;
}

// ------------------------------------------------------------
// Search with typo tolerance
// ------------------------------------------------------------

// Levenshtein distance = how many single-letter edits (insert, delete,
// replace) turn word A into word B. "ring" -> "rign" is 2 edits.
function editDistance(a, b) {
  // table[i][j] = distance between first i letters of a and first j letters of b
  const table = [];
  for (let i = 0; i <= a.length; i++) {
    table.push([i]);
  }
  for (let j = 0; j <= b.length; j++) {
    table[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      table[i][j] = Math.min(
        table[i - 1][j] + 1,       // delete a letter
        table[i][j - 1] + 1,       // insert a letter
        table[i - 1][j - 1] + cost // replace a letter (or keep it)
      );
    }
  }
  return table[a.length][b.length];
}

// How many typos we forgive depends on word length.
function allowedTypos(word) {
  if (word.length >= 4) return 2;
  if (word.length === 3) return 1;
  return 0;
}

// Does the product name match what the user typed?
function nameMatches(productName, query) {
  const name = productName.toLowerCase();
  if (name.includes(query)) return true; // exact / partial match

  const nameWords = name.split(/\W+/);
  const queryWords = query.split(/\s+/);

  // Every typed word must be close to at least one word in the name.
  return queryWords.every((typed) =>
    nameWords.some((word) => {
      if (word.startsWith(typed)) return true; // partial name: "hol" -> "hollow"
      const start = word.slice(0, typed.length + 1); // compare similar-length part
      return editDistance(start, typed) <= allowedTypos(typed);
    })
  );
}

// ------------------------------------------------------------
// Product helpers
// ------------------------------------------------------------

// The list view doesn't need the offers, so send a smaller object.
function toListItem(product) {
  return {
    id: product.id,
    name: product.name,
    platform: product.platform,
    region: product.region,
    price: product.price,
    discount: product.discount,
  };
}

const sortFunctions = {
  popular: (a, b) => b.sales - a.sales,
  priceAsc: (a, b) => a.price - b.price,
  priceDesc: (a, b) => b.price - a.price,
  discount: (a, b) => b.discount - a.discount,
};

// ------------------------------------------------------------
// Route handlers. Each returns data (sent as 200) or [status, data].
// ------------------------------------------------------------

function getBestsellers() {
  return [...products].sort(sortFunctions.popular).slice(0, 8).map(toListItem);
}

function getDeals() {
  return [...products].sort(sortFunctions.discount).slice(0, 8).map(toListItem);
}

function listProducts(req, res, match, query) {
  const search = (query.get('q') || '').toLowerCase().trim();
  const platform = query.get('platform');
  const region = query.get('region');
  const minPrice = query.get('minPrice');
  const maxPrice = query.get('maxPrice');

  // Keep a product only if it passes every active filter.
  const results = products.filter((product) => {
    if (search && !nameMatches(product.name, search)) return false;
    if (platform && product.platform !== platform) return false;
    if (region && product.region !== region) return false;
    if (minPrice && product.price < Number(minPrice)) return false;
    if (maxPrice && product.price > Number(maxPrice)) return false;
    return true;
  });

  const sortBy = sortFunctions[query.get('sort')] || sortFunctions.popular;
  results.sort(sortBy);

  return { total: results.length, items: results.map(toListItem) };
}

function getProduct(req, res, match) {
  const id = Number(match[1]); // match[1] is the (\d+) part of the URL
  const product = products.find((p) => p.id === id);
  return product || [404, { error: 'Product not found' }];
}

async function authenticate(req, res, match) {
  const mode = match[1]; // "register" or "login"
  const { email = '', password = '' } = await readJsonBody(req);

  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 6) {
    return [400, { error: 'Valid email and a password of 6+ characters required' }];
  }

  if (mode === 'register') {
    if (users.some((user) => user.email === email)) {
      return [409, { error: 'Email already registered' }];
    }
    const salt = crypto.randomBytes(8).toString('hex');
    const user = { id: users.length + 1, email, salt, hash: hashPassword(password, salt) };
    users.push(user);
    return { token: createToken(user.id), email };
  }

  // login
  const user = users.find((u) => u.email === email);
  if (!user || user.hash !== hashPassword(password, user.salt)) {
    return [401, { error: 'Wrong email or password' }];
  }
  return { token: createToken(user.id), email };
}

// Make a fake key like "962A-3DA2-AF71-DC68".
function generateKey() {
  const hex = crypto.randomBytes(8).toString('hex').toUpperCase();
  return hex.match(/.{4}/g).join('-');
}

async function checkout(req) {
  const user = getUserFromRequest(req);
  if (!user) return [401, { error: 'Sign in to check out' }];

  const { items = [] } = await readJsonBody(req);
  const lines = [];

  for (const item of items) {
    // We look up the price ourselves. Never trust a price sent by the browser.
    const product = products.find((p) => p.id === item.pid);
    const offer = product && product.offers.find((o) => o.id === item.oid);
    if (!offer) return [400, { error: 'Invalid item in cart' }];

    const quantity = Math.min(Number(item.qty) || 1, 5); // max 5 per item
    for (let i = 0; i < quantity; i++) {
      lines.push({
        product: product.name,
        platform: product.platform,
        seller: offer.seller,
        price: offer.price,
        key: generateKey(), // the "digital key" the buyer receives
      });
    }
  }

  if (lines.length === 0) return [400, { error: 'Cart is empty' }];

  // Payment is simulated: we just record the order as paid.
  const total = lines.reduce((sum, line) => sum + line.price, 0);
  const order = {
    id: orders.length + 1,
    userId: user.id,
    date: new Date().toISOString(),
    lines,
    total: Number(total.toFixed(2)),
  };
  orders.push(order);
  return order;
}

function getOrders(req) {
  const user = getUserFromRequest(req);
  if (!user) return [401, { error: 'Sign in to see your orders' }];
  return orders.filter((order) => order.userId === user.id).reverse(); // newest first
}

// ------------------------------------------------------------
// Route table: [HTTP method, URL pattern, handler]
// ------------------------------------------------------------
const routes = [
  ['GET', /^\/api\/home\/banners$/, () => banners],
  ['GET', /^\/api\/home\/bestsellers$/, getBestsellers],
  ['GET', /^\/api\/home\/deals$/, getDeals],
  ['GET', /^\/api\/filters$/, () => ({ platforms, regions })],
  ['GET', /^\/api\/products$/, listProducts],
  ['GET', /^\/api\/products\/(\d+)$/, getProduct],
  ['POST', /^\/api\/auth\/(register|login)$/, authenticate],
  ['POST', /^\/api\/checkout$/, checkout],
  ['GET', /^\/api\/orders$/, getOrders],
];

// ------------------------------------------------------------
// Static files (the frontend in /public)
// ------------------------------------------------------------
const contentTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
};

function serveStaticFile(url, res) {
  const requested = url.pathname === '/' ? 'index.html' : url.pathname;
  // normalize + strip leading "../" so nobody can read files outside /public
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(__dirname, 'public', safePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const type = contentTypes[path.extname(filePath)] || 'text/plain';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

// ------------------------------------------------------------
// The server: every request comes through here
// ------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (!url.pathname.startsWith('/api/')) {
    serveStaticFile(url, res);
    return;
  }

  // Find the first route whose method and URL pattern both match.
  for (const [method, pattern, handler] of routes) {
    const match = url.pathname.match(pattern);
    if (req.method === method && match) {
      const result = await handler(req, res, match, url.searchParams);
      // A handler returns either data, or [statusCode, data] for errors.
      if (Array.isArray(result) && typeof result[0] === 'number') {
        sendJson(res, result[0], result[1]);
      } else {
        sendJson(res, 200, result);
      }
      return;
    }
  }

  sendJson(res, 404, { error: 'No such endpoint' });
});

server.listen(PORT, () => console.log('Running on http://localhost:' + PORT));