import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { calculateDistanceKm } from "@/lib/distance";
import { Pharmacy } from "@/types/pharmacy";
import { IzmirProvider } from "@/lib/providers/izmir-provider";
import { CollectApiProvider } from "@/lib/providers/collectapi-provider";
import { SupabaseProvider } from "@/lib/providers/supabase-provider";
import { MockProvider } from "@/lib/providers/mock-provider";
import { normalizePharmacy } from "@/lib/pharmacy-normalizer";

const providers = [
  new IzmirProvider(),
  new CollectApiProvider(),
  new SupabaseProvider(),
  new MockProvider()
].sort((a, b) => a.priority - b.priority);

const QuerySchema = z.object({
  lat: z.string().optional().nullable().transform(val => val ? parseFloat(val) : undefined).refine(val => val === undefined || (!isNaN(val) && val >= -90 && val <= 90), "Geçersiz enlem (lat)"),
  lng: z.string().optional().nullable().transform(val => val ? parseFloat(val) : undefined).refine(val => val === undefined || (!isNaN(val) && val >= -180 && val <= 180), "Geçersiz boylam (lng)"),
  city: z.string().optional().nullable().transform(val => val || undefined),
  district: z.string().optional().nullable().transform(val => val || undefined),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const parsedParams = QuerySchema.safeParse({
      lat: searchParams.get("lat"),
      lng: searchParams.get("lng"),
      city: searchParams.get("city"),
      district: searchParams.get("district"),
    });

    if (!parsedParams.success) {
      return NextResponse.json({ success: false, error: "Geçersiz parametreler", details: parsedParams.error.format() }, { status: 400 });
    }

    const { lat, lng, city, district } = parsedParams.data;

    const input = { lat, lng, city, district };
    let pharmacies: Pharmacy[] = [];

    // Iterate through providers based on priority
    for (const provider of providers) {
      if (provider.canHandle(input)) {
        try {
          const results = await provider.fetch(input);
          if (results.length > 0) {
            pharmacies = results.map(r => normalizePharmacy(r, provider.name));
            break; // Stop at the first provider that successfully returns data
          }
        } catch (err) {
          console.error(`Provider ${provider.name} failed:`, err);
        }
      }
    }

    // Only calculate a distance from an actual user location.
    if (lat !== undefined && lng !== undefined) {
      pharmacies = pharmacies.map((p) => {
        const usable = Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
          && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180
          && !(p.latitude === 0 && p.longitude === 0);
        const km = usable ? calculateDistanceKm(lat, lng, p.latitude, p.longitude) : undefined;
        return { ...p, distance: km !== undefined && Number.isFinite(km) ? km : undefined };
      });
      // Do not rank missing coordinates ahead of measured distances.
      pharmacies.sort((a, b) => a.distance === undefined
        ? (b.distance === undefined ? 0 : 1)
        : b.distance === undefined ? -1 : a.distance - b.distance);
    } else {
      // GPS denied/unavailable: preserve provider order and remove any fake
      // or source-relative distance, which is not relative to this user.
      pharmacies = pharmacies.map(p => ({ ...p, distance: undefined }));
    }

    return NextResponse.json(
      { success: true, data: pharmacies },
      { 
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=59" // ECC: Edge Cache Control (5 mins)
        }
      }
    );
  } catch (error: unknown) {
    console.error("Error in /api/pharmacies GET:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
