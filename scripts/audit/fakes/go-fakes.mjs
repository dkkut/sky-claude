// Подставные поставщики для проверок Sky GO: Overpass (АЗС) на :9931 и Travelpayouts (авиабилеты) на :9932.
// Запуск: node scripts/audit/fakes/go-fakes.mjs   (API — с FUEL_PROVIDER=osm OVERPASS_URL=http://127.0.0.1:9931
//   FLIGHTS_PROVIDER=travelpayouts TRAVELPAYOUTS_TOKEN=t TRAVELPAYOUTS_BASE_URL=http://127.0.0.1:9932 TRAVELPAYOUTS_AUTOCOMPLETE_URL=http://127.0.0.1:9932)
import http from 'node:http';

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const q = new URLSearchParams(body).get('data') ?? '';
    const m = /around:(\d+),([\d.]+),([\d.]+)/.exec(q);
    const lat = m ? Number(m[2]) : 55; const lng = m ? Number(m[3]) : 37;
    res.setHeader('content-type', 'application/json');
    if (lat > 80) { res.statusCode = 500; return res.end('{}'); }   // имитация сбоя поставщика
    if (/car_wash/.test(q)) return res.end(JSON.stringify({ elements: [
      { type: 'node', id: 101, lat: lat + 0.003, lon: lng + 0.001, tags: { amenity: 'car_wash', name: 'Тест-Мойка 1', opening_hours: '24/7' } },
      { type: 'way', id: 102, center: { lat: lat - 0.006, lon: lng + 0.004 }, tags: { amenity: 'car_wash' } },
    ] }));
    res.end(JSON.stringify({ elements: [
      { type: 'node', id: 1, lat: lat + 0.004, lon: lng + 0.002, tags: { amenity: 'fuel', name: 'Тест-АЗС 1', brand: 'Тест', 'addr:street': 'Тестовая', 'addr:housenumber': '1', opening_hours: '24/7', 'fuel:diesel': 'yes', 'fuel:octane_95': 'yes', shop: 'convenience', toilets: 'yes' } },
      { type: 'way', id: 2, center: { lat: lat - 0.01, lon: lng + 0.01 }, tags: { amenity: 'fuel', name: 'Тест-АЗС 2', 'fuel:octane_92': 'yes', opening_hours: 'Mo-Su 07:00-23:00' } },
      { type: 'node', id: 3, lat: lat + 0.02, lon: lng - 0.02, tags: { amenity: 'fuel' } },
    ] }));
  });
}).listen(9931, () => console.log('fake overpass on 9931'));

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (u.pathname === '/places2') return res.end(JSON.stringify([{ code: 'MOW', name: 'Москва', country_name: 'Россия', type: 'city' }, { code: 'LED', name: 'Санкт-Петербург', country_name: 'Россия', type: 'city' }]));
  if (u.pathname === '/aviasales/v3/prices_for_dates') {
    if (u.searchParams.get('token') !== 't' && u.searchParams.get('token') !== 'testtoken') { res.statusCode = 401; return res.end('{}'); }
    const o = u.searchParams.get('origin'); const d = u.searchParams.get('destination');
    if (o === 'XXX') return res.end(JSON.stringify({ success: true, data: [] }));
    return res.end(JSON.stringify({ success: true, data: [
      { origin_airport: o, destination_airport: d, departure_at: `${u.searchParams.get('departure_at')}T09:15:00+03:00`, airline: 'SU', flight_number: 1234, price: 5400, duration_to: 125, transfers: 0, link: `/search/${o}${d}1` },
      { origin_airport: o, destination_airport: d, departure_at: `${u.searchParams.get('departure_at')}T18:40:00+03:00`, airline: 'S7', flight_number: 77, price: 4300, duration_to: 140, transfers: 1, link: `/search/${o}${d}2` },
    ] }));
  }
  res.statusCode = 404; res.end('{}');
}).listen(9932, () => console.log('fake travelpayouts on 9932'));
