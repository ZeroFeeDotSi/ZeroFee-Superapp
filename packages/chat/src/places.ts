// Places by name (grade 02g, G5: "Zurich" was refused, a person had to know "u0qj"). A small list bundled in the app, so
// a typed city is turned into its place on the phone and nothing is looked up anywhere. "Nearby" reads the phone's own
// location once, with its permission, and turns it into the same kind of place here; the location itself never leaves
// the phone (only the place's letters go to the relays, as for a typed one).
//
// A place is BitChat's 4-letter geohash, its "province" level (bitchat GeohashChannelLevel): about 40 by 20 km, so a
// whole city and its people share one, and #u0qj, the place everyone already knows as Zurich, stays Zurich.
import { encode } from "./geohash.ts";

export const PLACE_LETTERS = 4;

/** [name, country, latitude, longitude]: city centres. */
const CITIES: readonly (readonly [string, string, number, number])[] = [
  ["Zurich", "Switzerland", 47.3769, 8.5417], ["Geneva", "Switzerland", 46.2044, 6.1432], ["Basel", "Switzerland", 47.5596, 7.5886],
  ["Bern", "Switzerland", 46.948, 7.4474], ["Lausanne", "Switzerland", 46.5197, 6.6323], ["Lugano", "Switzerland", 46.0037, 8.9511],
  ["Zug", "Switzerland", 47.1662, 8.5155], ["Vienna", "Austria", 48.2082, 16.3738], ["Munich", "Germany", 48.1351, 11.582],
  ["Berlin", "Germany", 52.52, 13.405], ["Hamburg", "Germany", 53.5511, 9.9937], ["Frankfurt", "Germany", 50.1109, 8.6821],
  ["Cologne", "Germany", 50.9375, 6.9603], ["Stuttgart", "Germany", 48.7758, 9.1829], ["Paris", "France", 48.8566, 2.3522],
  ["Lyon", "France", 45.764, 4.8357], ["Marseille", "France", 43.2965, 5.3698], ["Nice", "France", 43.7102, 7.262],
  ["London", "United Kingdom", 51.5074, -0.1278], ["Manchester", "United Kingdom", 53.4808, -2.2426], ["Edinburgh", "United Kingdom", 55.9533, -3.1883],
  ["Dublin", "Ireland", 53.3498, -6.2603], ["Amsterdam", "Netherlands", 52.3676, 4.9041], ["Rotterdam", "Netherlands", 51.9244, 4.4777],
  ["Brussels", "Belgium", 50.8503, 4.3517], ["Luxembourg", "Luxembourg", 49.6116, 6.1319], ["Copenhagen", "Denmark", 55.6761, 12.5683],
  ["Stockholm", "Sweden", 59.3293, 18.0686], ["Oslo", "Norway", 59.9139, 10.7522], ["Helsinki", "Finland", 60.1699, 24.9384],
  ["Reykjavik", "Iceland", 64.1466, -21.9426], ["Tallinn", "Estonia", 59.437, 24.7536], ["Riga", "Latvia", 56.9496, 24.1052],
  ["Vilnius", "Lithuania", 54.6872, 25.2797], ["Warsaw", "Poland", 52.2297, 21.0122], ["Krakow", "Poland", 50.0647, 19.945],
  ["Prague", "Czechia", 50.0755, 14.4378], ["Bratislava", "Slovakia", 48.1486, 17.1077], ["Budapest", "Hungary", 47.4979, 19.0402],
  ["Ljubljana", "Slovenia", 46.0569, 14.5058], ["Zagreb", "Croatia", 45.815, 15.9819], ["Belgrade", "Serbia", 44.7866, 20.4489],
  ["Bucharest", "Romania", 44.4268, 26.1025], ["Sofia", "Bulgaria", 42.6977, 23.3219], ["Athens", "Greece", 37.9838, 23.7275],
  ["Istanbul", "Turkey", 41.0082, 28.9784], ["Ankara", "Turkey", 39.9334, 32.8597], ["Kyiv", "Ukraine", 50.4501, 30.5234],
  ["Rome", "Italy", 41.9028, 12.4964], ["Milan", "Italy", 45.4642, 9.19], ["Naples", "Italy", 40.8518, 14.2681],
  ["Florence", "Italy", 43.7696, 11.2558], ["Madrid", "Spain", 40.4168, -3.7038], ["Barcelona", "Spain", 41.3874, 2.1686],
  ["Valencia", "Spain", 39.4699, -0.3763], ["Seville", "Spain", 37.3891, -5.9845], ["Lisbon", "Portugal", 38.7223, -9.1393],
  ["Porto", "Portugal", 41.1579, -8.6291], ["Malta", "Malta", 35.8989, 14.5146], ["Tbilisi", "Georgia", 41.7151, 44.8271],
  ["Moscow", "Russia", 55.7558, 37.6173], ["Dubai", "United Arab Emirates", 25.2048, 55.2708], ["Abu Dhabi", "United Arab Emirates", 24.4539, 54.3773],
  ["Doha", "Qatar", 25.2854, 51.531], ["Riyadh", "Saudi Arabia", 24.7136, 46.6753], ["Tel Aviv", "Israel", 32.0853, 34.7818],
  ["Cairo", "Egypt", 30.0444, 31.2357], ["Lagos", "Nigeria", 6.5244, 3.3792], ["Accra", "Ghana", 5.6037, -0.187],
  ["Nairobi", "Kenya", -1.2921, 36.8219], ["Johannesburg", "South Africa", -26.2041, 28.0473], ["Cape Town", "South Africa", -33.9249, 18.4241],
  ["Casablanca", "Morocco", 33.5731, -7.5898], ["Mumbai", "India", 19.076, 72.8777], ["Delhi", "India", 28.7041, 77.1025],
  ["Bengaluru", "India", 12.9716, 77.5946], ["Chennai", "India", 13.0827, 80.2707], ["Karachi", "Pakistan", 24.8607, 67.0011],
  ["Lahore", "Pakistan", 31.5204, 74.3587], ["Dhaka", "Bangladesh", 23.8103, 90.4125], ["Colombo", "Sri Lanka", 6.9271, 79.8612],
  ["Singapore", "Singapore", 1.3521, 103.8198], ["Kuala Lumpur", "Malaysia", 3.139, 101.6869], ["Jakarta", "Indonesia", -6.2088, 106.8456],
  ["Bali", "Indonesia", -8.6705, 115.2126], ["Manila", "Philippines", 14.5995, 120.9842], ["Ho Chi Minh City", "Vietnam", 10.8231, 106.6297],
  ["Hanoi", "Vietnam", 21.0278, 105.8342], ["Da Nang", "Vietnam", 16.0544, 108.2022], ["Phnom Penh", "Cambodia", 11.5564, 104.9282],
  ["Hong Kong", "Hong Kong", 22.3193, 114.1694], ["Taipei", "Taiwan", 25.033, 121.5654], ["Shanghai", "China", 31.2304, 121.4737],
  ["Beijing", "China", 39.9042, 116.4074], ["Shenzhen", "China", 22.5431, 114.0579], ["Seoul", "South Korea", 37.5665, 126.978],
  ["Busan", "South Korea", 35.1796, 129.0756], ["Tokyo", "Japan", 35.6762, 139.6503], ["Osaka", "Japan", 34.6937, 135.5023],
  ["Kyoto", "Japan", 35.0116, 135.7681], ["Sydney", "Australia", -33.8688, 151.2093], ["Melbourne", "Australia", -37.8136, 144.9631],
  ["Brisbane", "Australia", -27.4698, 153.0251], ["Perth", "Australia", -31.9505, 115.8605], ["Auckland", "New Zealand", -36.8485, 174.7633],
  ["New York", "United States", 40.7128, -74.006], ["Los Angeles", "United States", 34.0522, -118.2437], ["San Francisco", "United States", 37.7749, -122.4194],
  ["Chicago", "United States", 41.8781, -87.6298], ["Miami", "United States", 25.7617, -80.1918], ["Austin", "United States", 30.2672, -97.7431],
  ["Boston", "United States", 42.3601, -71.0589], ["Seattle", "United States", 47.6062, -122.3321], ["Washington", "United States", 38.9072, -77.0369],
  ["Denver", "United States", 39.7392, -104.9903], ["Las Vegas", "United States", 36.1699, -115.1398], ["Houston", "United States", 29.7604, -95.3698],
  ["Dallas", "United States", 32.7767, -96.797], ["Atlanta", "United States", 33.749, -84.388], ["Toronto", "Canada", 43.6532, -79.3832],
  ["Vancouver", "Canada", 49.2827, -123.1207], ["Montreal", "Canada", 45.5017, -73.5673], ["Mexico City", "Mexico", 19.4326, -99.1332],
  ["Cancun", "Mexico", 21.1619, -86.8515], ["San Salvador", "El Salvador", 13.6929, -89.2182], ["Panama City", "Panama", 8.9824, -79.5199],
  ["Bogota", "Colombia", 4.711, -74.0721], ["Medellin", "Colombia", 6.2442, -75.5812], ["Lima", "Peru", -12.0464, -77.0428],
  ["Santiago", "Chile", -33.4489, -70.6693], ["Buenos Aires", "Argentina", -34.6037, -58.3816], ["Sao Paulo", "Brazil", -23.5505, -46.6333],
  ["Rio de Janeiro", "Brazil", -22.9068, -43.1729], ["Montevideo", "Uruguay", -34.9011, -56.1645], ["Caracas", "Venezuela", 10.4806, -66.9036],
];

export interface City {
  name: string;
  country: string;
  /** The place: its geohash, PLACE_LETTERS long. */
  place: string;
}

const all: City[] = CITIES.map(([name, country, lat, lon]) => ({ name, country, place: encode(lat, lon, PLACE_LETTERS) }));

/** Letters only, no accents or case: "Zürich", "zurich" and "ZURICH " read alike. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

/** The cities a typed name could be: the name's start first, then a word inside it ("francisco"). At most `max`. */
export function findCities(text: string, max = 5): City[] {
  const q = fold(text);
  if (q.length < 2) return [];
  const starts = all.filter((c) => fold(c.name).startsWith(q) || fold(c.country) === q);
  const inside = all.filter((c) => !starts.includes(c) && c.name.toLowerCase().split(/\s+/).some((w) => fold(w).startsWith(q)));
  return [...starts, ...inside].slice(0, max);
}

/** Finding 41: every city on the list, A to Z, for "Pick a city" with nothing typed: a way in that needs no location. */
export function everyCity(): readonly City[] {
  return [...all].sort((x, y) => x.name.localeCompare(y.name, "en"));
}

/** The city a place is, when it is one on the list ("u0qj" → Zurich); null for any other place. */
export function cityOf(place: string): City | null {
  return all.find((c) => c.place === place) ?? null;
}

/** A place's name for people: the city when it is one, else "#<letters>" as BitChat writes it. */
export const placeName = (place: string): string => cityOf(place)?.name ?? `#${place}`;

/** The place around a point (Nearby): worked out here, from the phone's own reading; nothing is sent anywhere. */
export const placeAt = (lat: number, lon: number): string => encode(lat, lon, PLACE_LETTERS);
