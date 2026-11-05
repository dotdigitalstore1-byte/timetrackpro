// Validation shared by the locations API. Locations are geofences: a point + radius.

export interface LocationInput {
  name?: string;
  address?: string | null;
  latitude?: string;
  longitude?: string;
  radiusMeters?: number;
  isActive?: boolean;
}

export type ParsedLocation = { ok: true; value: LocationInput } | { ok: false; error: string };

/**
 * Parses and validates a location payload.
 * `partial = true` (PATCH) only validates the fields that are present; otherwise name, latitude,
 * longitude and radius are all required.
 */
export function parseLocationInput(body: unknown, partial: boolean): ParsedLocation {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: LocationInput = {};

  if (!partial || b.name !== undefined) {
    const name = String(b.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) return { ok: false, error: "Location name is required." };
    if (name.length > 200) return { ok: false, error: "Location name must be 200 characters or fewer." };
    out.name = name;
  }

  if (b.address !== undefined) {
    const address = String(b.address ?? "").trim().slice(0, 500);
    out.address = address || null;
  }

  if (!partial || b.latitude !== undefined || b.longitude !== undefined) {
    const lat = Number(b.latitude);
    const lng = Number(b.longitude);
    if (b.latitude === "" || b.latitude == null || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { ok: false, error: "Enter a valid latitude between -90 and 90." };
    }
    if (b.longitude === "" || b.longitude == null || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { ok: false, error: "Enter a valid longitude between -180 and 180." };
    }
    out.latitude = lat.toFixed(7);
    out.longitude = lng.toFixed(7);
  }

  if (!partial || b.radiusMeters !== undefined) {
    const radius = Number(b.radiusMeters);
    if (!Number.isFinite(radius) || radius < 20 || radius > 10000) {
      return { ok: false, error: "Radius must be between 20 and 10,000 meters." };
    }
    out.radiusMeters = Math.round(radius);
  }

  if (typeof b.isActive === "boolean") out.isActive = b.isActive;

  return { ok: true, value: out };
}
