import { describe, expect, it } from "vitest";
import {
  CONFIDENTIALITY_LEVELS,
  CONTRACT_LIFECYCLE_STATUSES,
  GENERAL_LIFECYCLE_STATUSES,
  INGEST_STATUSES,
} from "./index.js";

describe("durum kataloğu (A6)", () => {
  it("eksen 1: 6 durum", () => {
    expect(INGEST_STATUSES).toEqual([
      "QUARANTINED",
      "PROCESSING",
      "METADATA_PENDING",
      "READY",
      "REJECTED",
      "FAILED_RETRYABLE",
    ]);
  });

  it("genel profil: 9 durum, DRAFT ile başlar, DISPOSED ile biter", () => {
    expect(GENERAL_LIFECYCLE_STATUSES).toHaveLength(9);
    expect(GENERAL_LIFECYCLE_STATUSES[0]).toBe("DRAFT");
    expect(GENERAL_LIFECYCLE_STATUSES.at(-1)).toBe("DISPOSED");
  });

  it("sözleşme profili: 15 durum, INVALID içerir", () => {
    expect(CONTRACT_LIFECYCLE_STATUSES).toHaveLength(15);
    expect(CONTRACT_LIFECYCLE_STATUSES).toContain("INVALID");
  });

  it("gizlilik seviyeleri sıralıdır", () => {
    expect(CONFIDENTIALITY_LEVELS).toEqual([
      "INTERNAL",
      "CONFIDENTIAL",
      "RESTRICTED",
      "HIGHLY_RESTRICTED",
    ]);
  });
});
