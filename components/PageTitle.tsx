export function PageTitle({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <section className="page-title-row">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="display-title">{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      {action && <div className="title-action">{action}</div>}
    </section>
  );
}
