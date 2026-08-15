import { describe, expect, it } from "vitest";
import { getTrailerOwnershipType } from "@/lib/trailer-ownership";

describe("trailer ownership classification", () => {
  it("classifies company by known source values", () => {
    expect(getTrailerOwnershipType({ trailerSource: "company" })).toBe("company");
    expect(getTrailerOwnershipType({ trailerSource: "owned" })).toBe("company");
  });

  it("classifies outsourcing by source values", () => {
    expect(getTrailerOwnershipType({ trailerSource: "outsourced" })).toBe("outsourcing");
    expect(getTrailerOwnershipType({ trailerSource: "external" })).toBe("outsourcing");
  });

  it("classifies outsourcing when external_company is present", () => {
    expect(getTrailerOwnershipType({ trailerSource: null, externalCompany: "Carrier X" })).toBe("outsourcing");
  });

  it("classifies company via company trailer number set", () => {
    expect(getTrailerOwnershipType({ trailerNumber: "pro100", companyTrailerNumbers: new Set(["PRO100"]) })).toBe("company");
  });

  it("returns unknown when no ownership evidence exists", () => {
    expect(getTrailerOwnershipType({ trailerSource: null, externalCompany: null, trailerNumber: null })).toBe("unknown");
  });

  it("treats local trailers as company-owned when there is no outsourcing evidence", () => {
    expect(getTrailerOwnershipType({ isLocal: true, trailerSource: null, externalCompany: null })).toBe("company");
  });

  it("resolves conflicting evidence in favor of outsourcing", () => {
    expect(getTrailerOwnershipType({ trailerSource: "company", externalCompany: "Carrier X" })).toBe("outsourcing");
  });
});
