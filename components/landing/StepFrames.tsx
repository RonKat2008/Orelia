import { HOW_STEPS } from "./content";
import { VIGNETTES } from "./Vignettes";

/**
 * The sticky vignette stage for wide screens (one frame per How-it-works step).
 * LandingChoreography flips each frame's `data-active` as its step crosses the
 * viewport's middle. Loaded on demand by StepFramesIsland, never server-rendered.
 */
export default function StepFrames() {
  return (
    <div className="sticky top-[calc(50vh-16.5rem)] h-[33rem]">
      <div aria-hidden className="absolute inset-6 rotate-[-1.5deg] rounded-lg border border-line bg-paper shadow-md" />
      {HOW_STEPS.map((step, i) => {
        const Vignette = VIGNETTES[step.id];
        return (
          <div
            key={step.id}
            data-step-frame={i}
            data-active={i === 0}
            className="group/scene absolute inset-x-0 top-1/2 -translate-y-1/2 px-2 opacity-0 transition-[opacity,transform] duration-700 ease-out-expo data-[active=false]:translate-y-[calc(-50%+1.5rem)] data-[active=true]:opacity-100 motion-reduce:transition-none"
          >
            {Vignette ? <Vignette /> : null}
          </div>
        );
      })}
    </div>
  );
}
