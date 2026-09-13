// Where the user is in the wizard. Deliberately quiet: a line of text and one
// dot per step, so the progress is visible without competing with the step's
// own content.

export function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`size-1.5 rounded-full ${i + 1 === step ? "bg-primary" : "bg-border"}`} />
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        Step {step} of {total}
      </p>
    </div>
  );
}
