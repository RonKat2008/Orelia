import Link from "next/link";
import { EditorialPage } from "@/components/pitch/Editorial";
import { StateScreen, WaypointArt } from "@/components/pitch/StateScreen";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <EditorialPage>
      <StateScreen
        eyebrow="404"
        title={
          <>
            We could not find that <em className="emph">page</em>
          </>
        }
        description="The link may be old or mistyped. Nothing is lost: your cases are exactly where you left them."
        art={<WaypointArt variant="lost" />}
        actions={
          <>
            <Button asChild size="lg">
              <Link href="/">Back to the start</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/how-it-works">How Wayfinder works</Link>
            </Button>
          </>
        }
      />
    </EditorialPage>
  );
}
