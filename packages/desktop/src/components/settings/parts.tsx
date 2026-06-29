// Small building blocks shared across the Settings pages.

export function Section({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b px-6 py-5 last:border-b-0">
      {title && <h2 className="text-sm font-semibold">{title}</h2>}
      {description && <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>}
      <div className={title || description ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="border-destructive/20 bg-destructive/10 text-destructive mt-3 rounded-md border px-3 py-2 text-sm">
      {message}
    </div>
  );
}
