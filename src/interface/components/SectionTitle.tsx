interface SectionTitleProps {
  title: string;
  subtitle: string;
}

export const SectionTitle = ({ title, subtitle }: SectionTitleProps) => (
  <div className="mb-4">
    <h2 className="text-lg font-semibold text-white">{title}</h2>
    <p className="text-sm mt-0.5" style={{ color: 'var(--t2)' }}>{subtitle}</p>
  </div>
);
