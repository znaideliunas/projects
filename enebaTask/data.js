// ============================================================
// data.js - seed data (a stand-in for a real database)
// ============================================================

const titles = [
  'Elden Ring', 'Cyberpunk 2077', 'EA FC 26', 'Minecraft', 'Hades II',
  "Baldur's Gate 3", 'The Witcher 3', 'Red Dead Redemption 2', 'Hollow Knight',
  'Stardew Valley', 'Call of Duty', 'Forza Horizon 5', 'Resident Evil 4',
  'Hogwarts Legacy', 'Starfield', 'Cities Skylines II',
];
const platforms = ['Steam', 'Xbox', 'PlayStation', 'Nintendo', 'EA App'];
const regions = ['Global', 'Europe', 'North America'];
const sellers = ['KeyKing', 'GameVault', 'PixelHub', 'LootLand', 'DigiDeals'];

// A tiny "random" generator with a fixed start (seed), so the catalog is
// the same every time the server starts. Returns a number between 0 and 1.
let seed = 7;
function random() {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

// Make 3-5 offers from different sellers for one product.
function makeOffers(retailPrice) {
  const offerCount = 3 + Math.floor(random() * 3);
  const offers = [];

  for (let i = 0; i < offerCount; i++) {
    const discountFactor = 0.55 + random() * 0.4; // pays 55%-95% of retail
    offers.push({
      id: i + 1,
      seller: sellers[i],
      rating: Number((3.8 + random() * 1.2).toFixed(1)),
      price: Number((retailPrice * discountFactor).toFixed(2)),
    });
  }
  return offers;
}

// Build the products: 3 versions (platforms) of every title.
const products = [];
let nextId = 1;

for (const name of titles) {
  for (let version = 0; version < 3; version++) {
    const retail = Math.round(10 + random() * 50);
    const offers = makeOffers(retail);
    const cheapest = Math.min(...offers.map((offer) => offer.price));

    products.push({
      id: nextId,
      name: name,
      platform: platforms[(nextId + version) % platforms.length],
      region: regions[Math.floor(random() * regions.length)],
      retail: retail,
      price: cheapest, // shown as "From €x" in lists
      discount: Math.round((1 - cheapest / retail) * 100), // % below retail
      sales: Math.floor(random() * 5000), // used for "best sellers"
      offers: offers,
    });
    nextId++;
  }
}

const banners = [
  {
    id: 1,
    title: 'Mega Sale Weekend',
    text: 'Up to 70% off top PC games',
    link: '#/store?sort=discount',
  },
  {
    id: 2,
    title: 'New: Starfield keys',
    text: 'Compare sellers, pick the best price',
    link: '#/store?q=starfield',
  },
];

module.exports = { products, banners, platforms, regions };