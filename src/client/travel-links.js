export const normalizeDestination = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/[\s_-]+/g, ' ');
const COUNTRIES = {
  peru: 'Peru', pe: 'Peru', per: 'Peru', bolivia: 'Bolivia', bolivien: 'Bolivia', bo: 'Bolivia', bol: 'Bolivia',
  chile: 'Chile', cl: 'Chile', chl: 'Chile', brazil: 'Brazil', brasil: 'Brazil', brasilien: 'Brazil', br: 'Brazil', bra: 'Brazil',
};
const PLACES = { cuzco: 'Cusco', 'uyuni tour': 'Uyuni', 'machupicchu pueblo': 'Aguas Calientes', 'machu picchu pueblo': 'Aguas Calientes' };
export const destinationCountry = value => COUNTRIES[normalizeDestination(value)] || String(value || '').trim();
export const destinationPlace = stop => {
  const raw = typeof stop === 'string' ? stop : stop?.place || stop?.name || '';
  return PLACES[normalizeDestination(raw)] || String(raw).trim();
};
const mapsQuery = stop => [destinationPlace(stop), typeof stop === 'object' ? destinationCountry(stop?.country) : ''].filter(Boolean).join(', ');

// Universal Maps URLs work in the app or browser and require no Google API key.
// https://developers.google.com/maps/documentation/urls/get-started
export function mapsSearchUrl(stop) {
  const query = mapsQuery(stop);
  if (!query) return '';
  const url = new URL('https://www.google.com/maps/search/');
  url.search = new URLSearchParams({ api: '1', query }).toString();
  return url.href;
}
export function mapsDirectionsUrl(from, to) {
  const origin = mapsQuery(from), destination = mapsQuery(to);
  if (!origin || !destination) return '';
  const url = new URL('https://www.google.com/maps/dir/');
  url.search = new URLSearchParams({ api: '1', origin, destination }).toString();
  return url.href;
}
