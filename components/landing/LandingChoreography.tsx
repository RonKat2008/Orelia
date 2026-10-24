"use client";

import { useEffect } from "react";
import { whenIdleAfterLoad } from "@/lib/ui/defer";
import { useReducedMotionGate } from "@/lib/motion/MotionPreference";
import { STEP_FRAMES_QUERY } from "./StepFramesIsland";

/**
 * Scroll choreography for the landing page. Renders nothing; after hydration it
 * dynamically imports GSAP ScrollTrigger + SplitText and wires up:
 *   [data-reveal="split"]  headings rise in line by line
 *   [data-reveal="rise"]   blocks rise and fade in
 *   [data-reveal="tile"]   bento tiles stagger in
 *   [data-scrub="words"]   the problem statement inks in, word by word, with scroll
 *   [data-step]/[data-step-frame]  the How-it-works active step (also under reduced motion)
 *   [data-rail]            the How-it-works progress rail
 * Content is server-rendered visible; motion only starts once JS has loaded.
 */
/** Upper bound on waiting for an idle moment before wiring scroll motion (keeps GSAP off first paint). */
const CHOREOGRAPHY_IDLE_TIMEOUT_MS = 1500;
/** Upper bound on waiting for the wide-screen step stage (a lazy island) to mount. */
const STEP_FRAMES_WAIT_MS = 3000;

/**
 * On wide screens the How-it-works stage is a client island that may mount after this
 * runs; wait for it (bounded) so its frames get their entrance state when wired.
 */
function waitForStepFrames(): Promise<void> {
  if (!window.matchMedia(STEP_FRAMES_QUERY).matches) return Promise.resolve();
  if (document.querySelector("[data-step-frame]")) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (document.querySelector("[data-step-frame]")) done();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(done, STEP_FRAMES_WAIT_MS);
  });
}

export function LandingChoreography() {
  const reduced = useReducedMotionGate();

  useEffect(() => {
    let isCancelled = false;
    let cleanup: (() => void) | undefined;

    const run = async () => {
      const [{ gsap }, { ScrollTrigger }, { SplitText }] = await Promise.all([
        import("gsap"),
        import("gsap/ScrollTrigger"),
        import("gsap/SplitText"),
      ]);
      await Promise.all([document.fonts?.ready, waitForStepFrames()]);
      if (isCancelled) return;
      gsap.registerPlugin(ScrollTrigger, SplitText);

      const splits: InstanceType<typeof SplitText>[] = [];
      const ctx = gsap.context(() => {
        wireSteps(ScrollTrigger, !reduced);
        if (reduced) return;

        const rail = document.querySelector("[data-rail]");
        const stepList = rail?.parentElement;
        if (rail && stepList) {
          gsap.to(rail, {
            scaleY: 1,
            ease: "none",
            scrollTrigger: { trigger: stepList, start: "top center", end: "bottom center", scrub: 0.6 },
          });
        }

        gsap.utils.toArray<HTMLElement>('[data-reveal="split"]').forEach((heading) => {
          const split = SplitText.create(heading, { type: "lines", mask: "lines", linesClass: "landing-line" });
          splits.push(split);
          // Masks clip descenders on display type; give each line a little room below.
          split.masks.forEach((mask) => {
            (mask as HTMLElement).style.paddingBottom = "0.14em";
            (mask as HTMLElement).style.marginBottom = "-0.14em";
          });
          gsap.from(split.lines, {
            yPercent: 105,
            duration: 1.2,
            ease: "expo.out",
            stagger: 0.09,
            scrollTrigger: { trigger: heading, start: "top 88%", once: true },
          });
        });

        gsap.utils.toArray<HTMLElement>('[data-reveal="rise"]').forEach((block) => {
          gsap.from(block, {
            y: 28,
            autoAlpha: 0,
            duration: 1.1,
            ease: "expo.out",
            scrollTrigger: { trigger: block, start: "top 90%", once: true },
          });
        });

        // Tiles stagger in per group (each list of tiles enters on its own).
        const tileGroups = new Set(
          gsap.utils.toArray<HTMLElement>('[data-reveal="tile"]').map((tile) => tile.parentElement),
        );
        tileGroups.forEach((group) => {
          if (!group) return;
          const tiles = Array.from(group.querySelectorAll<HTMLElement>(':scope > [data-reveal="tile"]'));
          gsap.from(tiles, {
            y: 40,
            autoAlpha: 0,
            duration: 1.2,
            ease: "expo.out",
            stagger: 0.12,
            scrollTrigger: { trigger: group, start: "top 85%", once: true },
          });
        });

        gsap.utils.toArray<HTMLElement>('[data-scrub="words"]').forEach((statement) => {
          const split = SplitText.create(statement, { type: "words" });
          splits.push(split);
          gsap.fromTo(
            split.words,
            { opacity: 0.2 },
            {
              opacity: 1,
              ease: "none",
              stagger: 0.08,
              // Words stay fully inked until the statement scrolls into view.
              immediateRender: false,
              scrollTrigger: { trigger: statement, start: "top bottom", end: "bottom 45%", scrub: 0.5 },
            },
          );
        });
      });

      ScrollTrigger.refresh();
      cleanup = () => {
        ctx.revert();
        splits.forEach((split) => split.revert());
      };
    };

    const start = () => {
      run().catch(() => {
        // Motion is an enhancement: if the libraries fail to load, the page is already complete.
      });
    };
    const cancelIdle = whenIdleAfterLoad(start, CHOREOGRAPHY_IDLE_TIMEOUT_MS);

    return () => {
      isCancelled = true;
      cancelIdle();
      cleanup?.();
    };
  }, [reduced]);

  return null;
}

type ScrollTriggerApi = typeof import("gsap/ScrollTrigger").ScrollTrigger;

/**
 * Marks the step crossing the viewport's middle as active, and shows its vignette.
 * With motion allowed, each scene (step + frame) starts `data-played="false"` and
 * plays its entrance the first time it becomes active.
 */
function wireSteps(ScrollTrigger: ScrollTriggerApi, shouldPlay: boolean) {
  const steps = Array.from(document.querySelectorAll<HTMLElement>("[data-step]"));
  const frames = Array.from(document.querySelectorAll<HTMLElement>("[data-step-frame]"));
  if (shouldPlay) {
    [...steps, ...frames].forEach((scene) => scene.setAttribute("data-played", "false"));
  } else {
    [...steps, ...frames].forEach((scene) => scene.removeAttribute("data-played"));
  }
  const activate = (index: number) => {
    // Re-query: the wide-screen stage is a lazy island and can mount (or remount) later.
    const currentFrames = Array.from(document.querySelectorAll<HTMLElement>("[data-step-frame]"));
    steps.forEach((step, i) => step.setAttribute("data-active", String(i === index)));
    currentFrames.forEach((frame, i) => frame.setAttribute("data-active", String(i === index)));
    if (shouldPlay) {
      steps[index]?.setAttribute("data-played", "true");
      currentFrames[index]?.setAttribute("data-played", "true");
    }
  };
  steps.forEach((step, index) => {
    ScrollTrigger.create({
      trigger: step,
      start: "top 55%",
      end: "bottom 55%",
      onToggle: (self) => {
        if (self.isActive) activate(index);
      },
    });
  });
}
