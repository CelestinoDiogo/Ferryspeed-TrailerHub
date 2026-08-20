import { z } from "zod";
import { previewDepartureSpreadsheet, type DepartureImportCandidate } from "@/lib/imports/departure-import";
import { SpreadsheetImportValidationError, validateSpreadsheetUpload } from "@/lib/imports/spreadsheet-security";
import { previewVesselTrailerSpreadsheet } from "@/lib/imports/vessel-trailer-list-import";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";

export const runtime = "nodejs";

const purposeSchema = z.enum(["vessel_list", "departure"]);
const existingNumbersSchema = z.array(z.string());

export async function POST(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);

    const formData = await request.formData();
    const purpose = purposeSchema.parse(
      new URL(request.url).searchParams.get("purpose")
      ?? (typeof formData.get("purpose") === "string" ? formData.get("purpose") : null)
      ?? "vessel_list",
    );

    await requireRbacPermission(
      supabase,
      user.id,
      purpose === "vessel_list" ? "vessel_operations" : "departures",
      "edit",
    );

    const fileValue = formData.get("file");
    if (!(fileValue instanceof File)) {
      throw new SpreadsheetImportValidationError("An Excel file is required.");
    }

    const bytes = new Uint8Array(await fileValue.arrayBuffer());
    validateSpreadsheetUpload({
      fileName: fileValue.name,
      mimeType: fileValue.type,
      byteLength: bytes.byteLength,
      bytes,
    });

    if (purpose === "vessel_list") {
      const existingTrailerNumbers = existingNumbersSchema.parse(
        parseOptionalJson(formData.get("existingTrailerNumbers")) ?? [],
      );
      return Response.json({
        purpose,
        preview: previewVesselTrailerSpreadsheet(bytes, existingTrailerNumbers),
      });
    }

    const { data, error } = await supabase
      .from("trailers")
      .select("id, trailer_number, customer, consignee, compound_position, arrival_date, departure_date, departure_time, operational_status, is_local, load_status");

    if (error) {
      throw new Error(error.message || "Unable to match extracted trailers.");
    }

    return Response.json({
      purpose,
      preview: previewDepartureSpreadsheet(bytes, (data ?? []) as DepartureImportCandidate[]),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid Excel import request." }, { status: 400 });
    }

    if (error instanceof SpreadsheetImportValidationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error("Spreadsheet import preview failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Unable to preview this Excel file." }, { status: 500 });
  }
}

const parseOptionalJson = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new SpreadsheetImportValidationError("existingTrailerNumbers must be a JSON array of trailer numbers.");
  }
};
