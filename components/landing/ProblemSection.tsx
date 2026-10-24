const BEATS = [
  {
    title: "You explain it again.",
    body: "Each new office starts from zero, and the story gets a little shorter every time you have to tell it.",
  },
  {
    title: "The referral goes quiet.",
    body: "A name on a list is not an appointment. Intake lines ring out, and forms seem to disappear.",
  },
  {
    title: "The search becomes a second job.",
    body: "Specialists, trials, foundations and travel help all live in different places, written for different readers.",
  },
] as const;

/** Section 1: the problem, told plainly. No statistics, so nothing here needs a citation. */
export function ProblemSection() {
  return (
    <section aria-labelledby="problem-heading" className="page-container py-section">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-stack lg:grid-cols-12 lg:gap-x-10">
        <p className="m-0 flex items-center gap-2.5 text-micro font-semibold uppercase text-ink-3 lg:col-span-12">
          <span aria-hidden className="size-1.5 rounded-pill bg-terracotta" />
          Why this is hard
        </p>
        <h2
          id="problem-heading"
          data-scrub="words"
          className="m-0 font-display text-h1 font-light text-balance text-ink display-soft lg:col-span-10"
        >
          When a disease is rare, the hardest part is often finding someone who has <em className="emph">seen</em> it
          before.
        </h2>

        <ol className="m-0 mt-4 grid list-none gap-10 p-0 sm:grid-cols-3 sm:gap-8 lg:col-span-11 lg:col-start-2 lg:mt-10">
          {BEATS.map((beat, i) => (
            <li
              key={beat.title}
              data-reveal="rise"
              className="grid content-start gap-3 border-t border-line-strong pt-5 sm:[&:nth-child(2)]:mt-10 sm:[&:nth-child(3)]:mt-20"
            >
              <span aria-hidden className="font-display text-h3 font-light text-ink-3 display-soft">
                0{i + 1}
              </span>
              <h3 className="m-0 font-sans text-h4 font-bold text-ink">{beat.title}</h3>
              <p className="m-0 text-body text-ink-2">{beat.body}</p>
            </li>
          ))}
        </ol>

        <p
          data-reveal="rise"
          className="m-0 mt-6 max-w-[40rem] border-l-2 border-gold pl-5 text-lead text-ink lg:col-span-8 lg:col-start-2 lg:mt-14"
        >
          Wayfinder does the searching and the chasing, and leaves every decision with you.
        </p>
      </div>
    </section>
  );
}
