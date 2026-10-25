import { describe, expect, it } from "vitest";
import { cleanContacts } from "@/components/rare/emergency/ContactsEditor";

describe("cleanContacts", () => {
  it("drops blank rows and trims the rest", () => {
    const r = cleanContacts([{ name: " Sam ", relationship: "Sister", phone: "555-010-9999" }, { name: "", relationship: "", phone: "" }]);
    expect(r).toEqual({ ok: true, contacts: [{ name: "Sam", relationship: "Sister", phone: "555-010-9999" }] });
  });
  it("asks for a missing field", () => {
    expect(cleanContacts([{ name: "Sam", relationship: "", phone: "555-010-9999" }]).ok).toBe(false);
  });
  it("rejects markup and short phone numbers", () => {
    expect(cleanContacts([{ name: "<b>", relationship: "Sister", phone: "555-010-9999" }]).ok).toBe(false);
    expect(cleanContacts([{ name: "Sam", relationship: "Sister", phone: "12" }]).ok).toBe(false);
  });
});
