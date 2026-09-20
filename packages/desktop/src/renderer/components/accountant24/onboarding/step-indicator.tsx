// Where the user is in the wizard. Deliberately quiet: one dot per step and
// nothing else, so progress is visible without competing with the step's own
// content. The count is still written out for screen readers, which have no
// dots to look at.

export function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`size-1.5 rounded-full ${i + 1 === step ? "bg-primary" : "bg-border"}`} />
      ))}
      <span className="sr-only">
        Step {step} of {total}
      </span>
    </div>
  );
}
