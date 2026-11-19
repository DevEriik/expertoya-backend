export interface CentroCobertura {
  nombre: string;
  lat: number;
  lng: number;
}

export const CENTROS_COBERTURA: CentroCobertura[] = [
  { nombre: "Neuquén", lat: -38.9516, lng: -68.0591 },
  { nombre: "Plottier", lat: -38.9533, lng: -68.2323 },
  { nombre: "Cipolletti", lat: -38.9311, lng: -67.9904 },
];

export const RADIO_COBERTURA_KM = 20;

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function estaDentroDeCobertura(lat: number, lng: number): boolean {
  return CENTROS_COBERTURA.some(
    (c) => haversineKm(lat, lng, c.lat, c.lng) <= RADIO_COBERTURA_KM,
  );
}
