// ============================================================
// app.js - the whole frontend
// Sections: helpers, API, cart, login state, components, views,
// router, event handlers
// ============================================================

// The element where every page is drawn.
const app = document.getElementById('app');

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

// Turn special characters into safe text, so data from the server
// can never be interpreted as HTML (protects against XSS).
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(amount) {
  return '€' + amount.toFixed(2);
}

// ------------------------------------------------------------
// Talking to the REST API
// ------------------------------------------------------------

// Call our backend. Adds the login token when we have one,
// and throws an Error if the server answers with an error status.
async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }

  const response = await fetch('/api' + url, {
    method: options.method || 'GET',
    headers: headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong');
  }
  return data;
}

// ------------------------------------------------------------
// Cart (saved in the browser's localStorage as JSON text)
// Each item: { pid: productId, oid: offerId, qty: quantity }
// ------------------------------------------------------------

function getCart() {
  return JSON.parse(localStorage.getItem('cart') || '[]');
}

function saveCart(cart) {
  localStorage.setItem('cart', JSON.stringify(cart));
  updateHeader();
}

// ------------------------------------------------------------
// Login state
// ------------------------------------------------------------

function isLoggedIn() {
  return Boolean(localStorage.getItem('token'));
}

function logOut() {
  localStorage.removeItem('token');
  localStorage.removeItem('email');
  updateHeader();
}

// Refresh the cart counter and the sign-in link in the header.
function updateHeader() {
  const itemCount = getCart().reduce((sum, item) => sum + item.qty, 0);
  document.getElementById('badge').textContent = itemCount;

  const authLink = document.getElementById('authlink');
  const email = localStorage.getItem('email');
  if (email) {
    authLink.textContent = 'Orders (' + email.split('@')[0] + ')';
    authLink.href = '#/orders';
  } else {
    authLink.textContent = 'Sign in';
    authLink.href = '#/login';
  }
}

// ------------------------------------------------------------
// Components: functions that return a piece of HTML
// ------------------------------------------------------------

function productCard(product) {
  // Give every product its own colour, since we have no images.
  const hue = (product.id * 47) % 360;
  const gradient = `linear-gradient(135deg, hsl(${hue}, 60%, 42%), hsl(${hue + 60}, 60%, 24%))`;

  let discountTag = '';
  if (product.discount > 0) {
    discountTag = `<span class="tag">-${product.discount}%</span>`;
  }

  return `
    <a class="card" href="#/product/${product.id}">
      <div class="cover" style="background: ${gradient}">${escapeHtml(product.name)}</div>
      <div class="info">
        <small>${escapeHtml(product.platform)} · ${escapeHtml(product.region)}</small>
        ${discountTag}
        <div class="price">From ${formatMoney(product.price)}</div>
      </div>
    </a>`;
}

function productGrid(products) {
  return `<div class="grid">${products.map(productCard).join('')}</div>`;
}

function bannerList(banners) {
  const items = banners.map(
    (banner) => `
      <a class="banner" href="${escapeHtml(banner.link)}">
        <h3>${escapeHtml(banner.title)}</h3>
        ${escapeHtml(banner.text)}
      </a>`
  );
  return `<div class="banners">${items.join('')}</div>`;
}

function selectOptions(values, selected, placeholder) {
  let html = `<option value="">${placeholder}</option>`;
  for (const value of values) {
    const isSelected = value === selected ? 'selected' : '';
    html += `<option ${isSelected}>${escapeHtml(value)}</option>`;
  }
  return html;
}

// ------------------------------------------------------------
// Views: each one returns the HTML of a page
// ------------------------------------------------------------

// Homepage: three empty blocks. loadHomeBlocks() fills each one from
// its own endpoint, so one failing block doesn't break the others.
function homeView() {
  return `
    <div id="home-banners" class="muted">Loading…</div>
    <h2>Best sellers</h2>
    <div id="home-bestsellers" class="muted">Loading…</div>
    <h2>Hot deals</h2>
    <div id="home-deals" class="muted">Loading…</div>`;
}

async function loadBlock(elementId, url, render) {
  const element = document.getElementById(elementId);
  try {
    const data = await api(url);
    element.innerHTML = render(data);
  } catch (error) {
    element.innerHTML = '<p class="err">Could not load this section.</p>';
  }
}

function loadHomeBlocks() {
  loadBlock('home-banners', '/home/banners', bannerList);
  loadBlock('home-bestsellers', '/home/bestsellers', productGrid);
  loadBlock('home-deals', '/home/deals', productGrid);
}

async function storeView(params) {
  const filters = await api('/filters');
  const result = await api('/products?' + params); // params already holds q, platform...

  const sortLabels = {
    popular: 'Most popular',
    priceAsc: 'Price ↑',
    priceDesc: 'Price ↓',
    discount: 'Biggest discount',
  };
  const currentSort = params.get('sort') || 'popular';
  let sortOptions = '';
  for (const key in sortLabels) {
    const isSelected = key === currentSort ? 'selected' : '';
    sortOptions += `<option value="${key}" ${isSelected}>${sortLabels[key]}</option>`;
  }

  const query = params.get('q') || '';
  const title = query ? `Store – “${escapeHtml(query)}”` : 'Store';
  const content = result.total
    ? productGrid(result.items)
    : '<p>No matches. Try another spelling or loosen the filters.</p>';

  return `
    <h1>${title}</h1>
    <form class="filters" id="filters">
      <select name="platform">${selectOptions(filters.platforms, params.get('platform'), 'All platforms')}</select>
      <select name="region">${selectOptions(filters.regions, params.get('region'), 'All regions')}</select>
      <input name="minPrice" type="number" min="0" placeholder="Min €" value="${escapeHtml(params.get('minPrice') || '')}">
      <input name="maxPrice" type="number" min="0" placeholder="Max €" value="${escapeHtml(params.get('maxPrice') || '')}">
      <select name="sort">${sortOptions}</select>
      <input type="hidden" name="q" value="${escapeHtml(query)}">
    </form>
    <p class="muted">${result.total} results</p>
    ${content}`;
}

async function productView(id) {
  const product = await api('/products/' + id);

  // Cheapest offer first, so buyers can compare easily.
  const offers = [...product.offers].sort((a, b) => a.price - b.price);
  const offerRows = offers.map(
    (offer) => `
      <div class="row">
        <span><b>${escapeHtml(offer.seller)}</b> <small>★ ${offer.rating}</small></span>
        <span class="price">${formatMoney(offer.price)}</span>
        <button class="btn" data-add="${product.id}:${offer.id}">Add to cart</button>
      </div>`
  );

  return `
    <h1>${escapeHtml(product.name)}</h1>
    <p class="muted">${escapeHtml(product.platform)} · ${escapeHtml(product.region)} · retail ${formatMoney(product.retail)}</p>
    <h2>Offers from ${offers.length} sellers</h2>
    ${offerRows.join('')}`;
}

async function cartView() {
  const cart = getCart();
  if (cart.length === 0) {
    return '<h1>Cart</h1><p>Your cart is empty.</p>';
  }

  let total = 0;
  let rows = '';

  for (let index = 0; index < cart.length; index++) {
    const item = cart[index];
    const product = await api('/products/' + item.pid);
    const offer = product.offers.find((o) => o.id === item.oid);
    total += offer.price * item.qty;

    rows += `
      <div class="row">
        <span><b>${escapeHtml(product.name)}</b> <small>${escapeHtml(product.platform)} · ${escapeHtml(offer.seller)}</small></span>
        <span>${item.qty} × ${formatMoney(offer.price)}</span>
        <button class="btn" data-remove="${index}">Remove</button>
      </div>`;
  }

  return `
    <h1>Cart</h1>
    ${rows}
    <h2>Total ${formatMoney(total)}</h2>
    <button class="btn" id="pay">Pay (test mode)</button>
    <p id="msg" class="err"></p>`;
}

function loginView() {
  return `
    <h1>Sign in / Register</h1>
    <form class="form" id="auth">
      <input name="email" type="email" placeholder="Email" required>
      <input name="password" type="password" placeholder="Password (6+ chars)" required minlength="6">
      <button class="btn" type="submit">Sign in</button>
      <button class="btn" type="button" id="register">Create account</button>
      <p id="msg" class="err"></p>
    </form>`;
}

async function ordersView() {
  const orders = await api('/orders');
  if (orders.length === 0) {
    return '<h1>Orders</h1><p>No orders yet.</p><a class="btn" href="#/store">Browse store</a>';
  }

  const orderBlocks = orders.map((order) => {
    const keyLines = order.lines.map(
      (line) => `<div>${escapeHtml(line.product)} (${escapeHtml(line.platform)}): <span class="key">${escapeHtml(line.key)}</span></div>`
    );
    return `
      <div class="row order">
        <b>Order #${order.id}</b>
        <small>${new Date(order.date).toLocaleString()}</small> – ${formatMoney(order.total)}
        ${keyLines.join('')}
      </div>`;
  });

  return `<h1>Order history</h1>${orderBlocks.join('')}<button class="btn" id="logout">Sign out</button>`;
}

// ------------------------------------------------------------
// Router: reads the URL hash (e.g. "#/product/5?x=1") and shows a page
// ------------------------------------------------------------
async function route() {
  const hash = location.hash.slice(1) || '/'; // remove the leading "#"
  const [pathPart, queryPart] = hash.split('?');
  const [, page, argument] = pathPart.split('/'); // "/product/5" -> ["", "product", "5"]
  const params = new URLSearchParams(queryPart || '');

  // Order history is only for signed-in users.
  if (page === 'orders' && !isLoggedIn()) {
    location.hash = '#/login';
    return;
  }

  app.innerHTML = '<p class="muted">Loading…</p>';

  try {
    if (!page) {
      app.innerHTML = homeView();
      loadHomeBlocks();
    } else if (page === 'store') {
      app.innerHTML = await storeView(params);
    } else if (page === 'product') {
      app.innerHTML = await productView(argument);
    } else if (page === 'cart') {
      app.innerHTML = await cartView();
    } else if (page === 'login') {
      app.innerHTML = loginView();
    } else if (page === 'orders') {
      app.innerHTML = await ordersView();
    } else {
      app.innerHTML = '<h1>Page not found</h1>';
    }
  } catch (error) {
    app.innerHTML = `<p class="err">${escapeHtml(error.message)}</p>`;
    // An expired login: forget it so the user can sign in again.
    if (error.message.includes('Sign in')) {
      logOut();
    }
  }
}

// ------------------------------------------------------------
// Event handlers
// ------------------------------------------------------------

async function signIn(mode, form) {
  const messageBox = document.getElementById('msg');
  try {
    const data = await api('/auth/' + mode, {
      method: 'POST',
      body: { email: form.email.value, password: form.password.value },
    });
    localStorage.setItem('token', data.token);
    localStorage.setItem('email', data.email);
    updateHeader();
    location.hash = getCart().length > 0 ? '#/cart' : '#/orders';
  } catch (error) {
    messageBox.textContent = error.message;
  }
}

function addToCart(button) {
  const [productId, offerId] = button.dataset.add.split(':').map(Number);
  const cart = getCart();
  const existing = cart.find((item) => item.pid === productId && item.oid === offerId);

  if (existing) {
    existing.qty++;
  } else {
    cart.push({ pid: productId, oid: offerId, qty: 1 });
  }
  saveCart(cart);
  button.textContent = 'Added ✓';
}

function removeFromCart(index) {
  const cart = getCart();
  cart.splice(index, 1); // remove one item at this position
  saveCart(cart);
  route(); // redraw the cart page
}

async function pay() {
  if (!isLoggedIn()) {
    location.hash = '#/login';
    return;
  }
  try {
    await api('/checkout', { method: 'POST', body: { items: getCart() } });
    saveCart([]); // empty the cart
    location.hash = '#/orders';
  } catch (error) {
    document.getElementById('msg').textContent = error.message;
  }
}

// Forms: search box in the header, and the login form.
document.addEventListener('submit', (event) => {
  event.preventDefault(); // stop the browser from reloading the page
  const form = event.target;

  if (form.id === 'search') {
    location.hash = '#/store?q=' + encodeURIComponent(form.q.value);
  } else if (form.id === 'auth') {
    signIn('login', form);
  }
});

// Changing any filter on the store page rebuilds the URL.
document.addEventListener('change', (event) => {
  const form = event.target.closest('#filters');
  if (!form) return;

  const params = new URLSearchParams(new FormData(form));
  for (const [key, value] of [...params]) {
    if (value === '') params.delete(key); // skip empty filters
  }
  location.hash = '#/store?' + params;
});

// One click listener for all buttons, using data-* attributes / ids.
document.addEventListener('click', (event) => {
  const target = event.target;

  if (target.dataset.add) addToCart(target);
  else if (target.dataset.remove) removeFromCart(Number(target.dataset.remove));
  else if (target.id === 'register') signIn('register', target.form);
  else if (target.id === 'logout') {
    logOut();
    location.hash = '#/';
  } else if (target.id === 'pay') pay();
});

// Start: redraw whenever the hash changes, and once on load.
window.addEventListener('hashchange', route);
updateHeader();
route();