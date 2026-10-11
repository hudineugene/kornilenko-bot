'use strict';

// Properties from the website's XML feed (Kyero v3).

const test = require('node:test');
const assert = require('node:assert/strict');
const realFetch = global.fetch;
const { bot, resetData, cleanup } = require('./helpers/chat');

const telegramStub = global.fetch;
global.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : telegramStub(url, init));

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('feed photo')]);

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<root>
  <kyero><feed_version>3</feed_version></kyero>
  <property>
    <id>1001</id><ref>KB-101</ref>
    <price>450000</price><currency>EUR</currency><price_freq>sale</price_freq>
    <new_build>1</new_build>
    <type>Villa</type><town>Finestrat</town><province>Alicante</province>
    <location_detail>Sierra Cortina</location_detail>
    <location><latitude>38.56</latitude><longitude>-0.21</longitude></location>
    <beds>3</beds><baths>2</baths>
    <surface_area><built>180</built><plot>600</plot></surface_area>
    <url><en>https://example.com/en/kb-101</en></url>
    <desc><ru>Современная вилла с видом на море и бассейном</ru><en><![CDATA[Modern villa with <b>sea views</b> &amp; pool]]></en><es>Villa moderna con vistas al mar</es></desc>
    <images>
      <image id="1"><url>https://img.example.com/kb-101-1.png</url></image>
      <image id="2"><url>https://img.example.com/missing.png</url></image>
    </images>
  </property>
  <property>
    <ref>KB-202</ref><price>1200</price><price_freq>month</price_freq>
    <type>Apartment</type><town>Benidorm</town><beds>2</beds>
  </property>
  <property><price>1000</price><type>Land</type></property>
  <property><ref>KB-202</ref><price>1300</price></property>
</root>`;

// Имена в проверках выдуманные: подменяем разрешение имён, чтобы прогон не
// зависел от настоящего DNS и не ждал его молчания.
const lookup = async () => [{ address: '93.184.216.34', family: 4 }];

function imageFetcher(url) {
  if (String(url).includes('missing')) return Promise.resolve(new Response('no', { status: 404 }));
  return Promise.resolve(new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }));
}

test.beforeEach(() => resetData());
test.after(cleanup);

test('the XML reader copes with CDATA, entities and attributes', () => {
  const root = bot.parseXml('<a x="1 &amp; 2"><b><![CDATA[<i>raw</i>]]></b><c>&lt;tag&gt; &#169; &#x20AC;</c><d/></a>');
  const a = root.children[0];
  assert.equal(a.attributes.x, '1 & 2');
  assert.equal(a.children[0].text, '<i>raw</i>');
  assert.equal(a.children[1].text, '<tag> © €');
  assert.equal(a.children[2].name, 'd');
});

test('Kyero fields become the bot\'s property fields', () => {
  const [villa, flat] = bot.readFeed(FEED);
  assert.equal(villa.reference, 'KB-101');
  assert.deepEqual(villa.fields, { dealType: 'sale', pricePeriod: 'total', priceValue: 450000, currency: 'EUR', propertyType: 'villa', bedrooms: 3, bathrooms: 2, area: 180, plotArea: 600, condition: 'new' });
  assert.deepEqual(villa.texts.title, { ru: 'Вилла · Finestrat', uk: 'Вілла · Finestrat', en: 'Villa · Finestrat', es: 'Villa · Finestrat' });
  assert.equal(villa.texts.description.en, 'Modern villa with sea views & pool', 'HTML in the description becomes plain text');
  assert.equal(villa.texts.description.ru, 'Современная вилла с видом на море и бассейном');
  assert.equal(villa.texts.mapUrl, 'https://www.google.com/maps?q=38.56,-0.21');
  assert.equal(villa.images.length, 2);
  assert.deepEqual([flat.fields.dealType, flat.fields.pricePeriod, flat.fields.propertyType], ['rent', 'month', 'apartment']);
  assert.equal(bot.propertyTypeOf('Ático / Penthouse'), 'apartment');
  assert.equal(bot.propertyTypeOf('Town House'), 'townhouse');
  assert.equal(bot.propertyTypeOf('Parcela urbana'), 'land');
  assert.throws(() => bot.readFeed('<html><body>Not a feed</body></html>'), /не выгрузка в формате Kyero/);
});

test('new properties are added hidden with their photos; the admin\'s texts are kept', async () => {
  const data = bot.getData();
  data.objects.push({ id: 'manual-a1', status: 'active', reference: 'KB101', title: { ru: 'Другой объект', en: '', es: '' }, propertyType: 'house', imagesByLanguage: { ru: [], en: [], es: [] } });
  data.objects.push({ id: 'mine', status: 'active', reference: 'kb-202 ', title: { ru: 'Моя квартира', en: '', es: '' }, description: { ru: '', en: '', es: '' }, priceValue: 1100, dealType: 'rent', imagesByLanguage: { ru: [], en: [], es: [] } });
  const preview = bot.planSummary(bot.planImport(bot.readFeed(FEED)));
  assert.deepEqual([preview.create, preview.update, preview.unchanged], [1, 1, 0]);
  assert.deepEqual(preview.skipped.map((item) => item.reason), ['нет номера объекта (<ref>)', 'номер повторяется в выгрузке']);
  assert.equal(data.objects.length, 2, 'the preview changes nothing');

  const result = await bot.applyImport(bot.readFeed(FEED), { fetcher: imageFetcher, lookup });
  assert.deepEqual([result.create, result.update, result.images, result.imageErrors], [1, 1, 1, 1]);
  const villa = data.objects.find((record) => record.reference === 'KB-101');
  assert.equal(villa.status, 'hidden');
  assert.equal(villa.imagesByLanguage.ru.length, 1);
  assert.equal(villa.imagesByLanguage.es.length, 1);
  assert.notEqual(villa.imagesByLanguage.ru[0].id, villa.imagesByLanguage.es[0].id);
  assert.ok(villa.importedAt);

  const mine = data.objects.find((record) => record.id === 'mine');
  assert.equal(mine.priceValue, 1200, 'the price comes from the site');
  assert.equal(mine.title.ru, 'Моя квартира', 'the admin\'s title stays');
  assert.equal(mine.city.ru, 'Benidorm', 'an empty city is filled');
  assert.equal(data.objects.find((record) => record.id === 'manual-a1').propertyType, 'house', '"KB101" is not "KB-101"');
});

test('a feed that leaves fields out does not overwrite them', async () => {
  const data = bot.getData();
  data.objects.push({ id: 'rented', status: 'active', reference: 'R-1', dealType: 'rent', pricePeriod: 'month', currency: 'GBP', propertyType: 'villa', priceValue: 2000, title: { ru: 'Вилла', en: '', es: '' }, imagesByLanguage: { ru: [], en: [], es: [] } });
  await bot.applyImport(bot.readFeed('<root><property><ref>R-1</ref><price>2200</price></property></root>'), { fetcher: imageFetcher, lookup });
  const record = data.objects.find((item) => item.id === 'rented');
  assert.deepEqual([record.priceValue, record.dealType, record.pricePeriod, record.currency, record.propertyType], [2200, 'rent', 'month', 'GBP', 'villa']);
});

test('снижение цены из выгрузки остаётся на карточке зачёркнутой старой ценой', async () => {
  const data = bot.getData();
  data.objects.push({ id: 'cheaper', status: 'active', reference: 'C-1', dealType: 'sale', currency: 'EUR', propertyType: 'villa', priceValue: 300000, title: { ru: 'Вилла', en: 'Villa', es: 'Villa' } });
  await bot.applyImport(bot.readFeed('<root><property><ref>C-1</ref><price>280000</price></property></root>'), { fetcher: imageFetcher, lookup });
  const record = data.objects.find((item) => item.id === 'cheaper');
  assert.equal(record.priceValue, 280000);
  assert.equal(record.previousPriceValue, 300000, 'прежняя цена запомнена');
  assert.ok(record.priceChangedAt);

  // Следующая загрузка с той же ценой пометку не трогает.
  await bot.applyImport(bot.readFeed('<root><property><ref>C-1</ref><price>280000</price><beds>3</beds></property></root>'), { fetcher: imageFetcher, lookup });
  assert.equal(record.previousPriceValue, 300000, 'повторная загрузка без снижения не стирает зачёркнутую цену');
});

test('a broken file is read quickly; photos from local addresses are refused; one import at a time', async () => {
  const started = Date.now();
  bot.parseXml('<root>' + '<!-- x'.repeat(200000));
  bot.parseXml('<root><![CDATA[' + 'a'.repeat(3000000));
  assert.ok(Date.now() - started < 2000, 'linear, not quadratic');
  assert.equal(bot.publicAddress('https://img.example.com/a.jpg'), true);
  for (const address of ['http://127.0.0.1/a.jpg', 'http://localhost:3000/api/state', 'http://192.168.1.10/a.png', 'http://10.0.0.5/x', 'http://[::1]/x', 'file:///C:/a.jpg']) {
    assert.equal(bot.publicAddress(address), false, address);
  }
  let release;
  const slow = () => new Promise((resolve) => { release = () => resolve(new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })); });
  const first = bot.applyImport(bot.readFeed(FEED), { fetcher: slow, lookup });
  await assert.rejects(bot.applyImport(bot.readFeed(FEED), { fetcher: imageFetcher, lookup }), /уже идёт/);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  release();
  release = null;
  const waitAndRelease = setInterval(() => { if (release) { release(); release = null; } }, 5);
  await first;
  clearInterval(waitAndRelease);
});

test('an import sends each client at most one alert', async () => {
  const data = bot.getData();
  data.config.active = true;
  data.users.fan = { id: 'fan', chatId: 777001, firstName: 'Fan', preferredLanguage: 'ru', activity: [] };
  data.inquiries.push({ id: 'sel', userId: 'fan', type: 'selection', language: 'ru', selection: { deal: '', type: '', location: '', budget: '', bedrooms: '' }, status: 'new', text: '', replies: [], createdAt: new Date().toISOString() });
  const result = await bot.applyImport(bot.readFeed(FEED), { fetcher: imageFetcher, publishNew: true, lookup });
  assert.equal(result.alerts, 1);
});

test('with "show at once" new properties with photos are published', async () => {
  await bot.applyImport(bot.readFeed(FEED), { fetcher: imageFetcher, publishNew: true, lookup });
  const data = bot.getData();
  assert.equal(data.objects.find((record) => record.reference === 'KB-101').status, 'active');
  assert.equal(data.objects.find((record) => record.reference === 'KB-202').status, 'hidden', 'no photos: not shown yet');
});

test('"show at once" keeps an incomplete multilingual card hidden', async () => {
  const withoutRussianDescription = FEED.replace('<ru>Современная вилла с видом на море и бассейном</ru>', '');
  await bot.applyImport(bot.readFeed(withoutRussianDescription), { fetcher: imageFetcher, publishNew: true, lookup });
  const villa = bot.getData().objects.find((record) => record.reference === 'KB-101');
  assert.equal(villa.status, 'hidden');
  assert.deepEqual(bot.propertyPublicationIssues(villa, 'ru'), ['описание']);
});

test('a second import updates instead of duplicating, and reports what left the feed', async () => {
  await bot.applyImport(bot.readFeed(FEED), { fetcher: imageFetcher, lookup });
  const smaller = FEED.replace(/<property>\s*<ref>KB-202<\/ref><price>1200[\s\S]*?<\/property>/, '').replace('<price>450000</price>', '<price>430000</price>');
  const result = await bot.applyImport(bot.readFeed(smaller), { fetcher: imageFetcher, lookup });
  assert.deepEqual([result.create, result.update], [0, 2]);
  assert.equal(bot.getData().objects.filter((record) => record.reference === 'KB-101').length, 1);
  assert.equal(bot.getData().objects.find((record) => record.reference === 'KB-101').priceValue, 430000);
});

test('the panel previews and imports a feed; daily updates run once a day', async () => {
  const data = bot.getData();
  const password = bot.hashPassword('correct-password');
  data.config.passwordSalt = password.salt;
  data.config.passwordHash = password.hash;
  await new Promise((resolve) => bot.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + bot.server.address().port;
    const login = await realFetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    const headers = { 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': (await login.json()).csrf };
    const noImages = FEED.replace(/<images>[\s\S]*?<\/images>/, '');
    let response = await realFetch(base + '/api/feed/preview', { method: 'POST', headers, body: JSON.stringify({ xml: noImages }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).create, 2);
    response = await realFetch(base + '/api/feed/preview', { method: 'POST', headers, body: JSON.stringify({ url: 'ftp://example.com/feed.xml' }) });
    assert.equal(response.status, 400);
    response = await realFetch(base + '/api/feed/import', { method: 'POST', headers, body: JSON.stringify({ xml: noImages }) });
    assert.equal((await response.json()).create, 2);
    assert.equal((await realFetch(base + '/api/feed/settings', { method: 'PUT', headers, body: JSON.stringify({ daily: true }) })).status, 400, 'daily needs a link');
    assert.equal((await realFetch(base + '/api/feed/settings', { method: 'PUT', headers, body: JSON.stringify({ url: 'https://example.com/kyero.xml', daily: true }) })).status, 200);
  } finally {
    await new Promise((resolve) => bot.server.close(resolve));
  }
  let downloads = 0;
  const feedFetcher = (url) => {
    downloads += 1;
    return Promise.resolve(new Response(FEED.replace(/<images>[\s\S]*?<\/images>/, ''), { status: 200 }));
  };
  const monday = new Date(2026, 8, 21, 10, 0);
  bot.getData().config.feedImport.lastRunAt = new Date(2026, 8, 20, 20, 0).toISOString();
  assert.equal(await bot.runDailyFeedImport(monday, feedFetcher, lookup), null, 'less than a day ago');
  bot.getData().config.feedImport.lastRunAt = new Date(2026, 8, 20, 9, 0).toISOString();
  const result = await bot.runDailyFeedImport(monday, feedFetcher, lookup);
  assert.equal(downloads, 1);
  assert.deepEqual([result.create, result.update], [0, 0]);
});
