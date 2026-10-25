import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmailDestinationSwitch } from "@/components/demo/EmailDestinationSwitch";

describe("EmailDestinationSwitch markup", () => {
  it("renders an accessible radiogroup with the current choice and the not-sent-yet hint", () => {
    const html = renderToStaticMarkup(<EmailDestinationSwitch caseId="c" initial="scripted" available={{ scripted: true, personal: true }} />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("Test emails go to:");
    expect(html).toMatch(/aria-checked="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-checked="true"/);
    expect(html).toContain("Scripted test inbox · auto-replies");
    expect(html).toContain("My inbox");
    expect(html).toContain("Applies to emails not sent yet.");
    expect(html).not.toContain("aria-disabled");
  });
  it("disables an unconfigured option and says why, without any address", () => {
    const html = renderToStaticMarkup(<EmailDestinationSwitch caseId="c" initial="scripted" available={{ scripted: true, personal: false }} />);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("No personal inbox is configured");
    expect(html).not.toMatch(/@/);
  });
});
