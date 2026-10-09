import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Languages, SunMoon, ArrowUpRight } from 'lucide-react';
import { setLanguage } from '../i18n';
import { useTheme, type Theme } from '../theme';

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        {/* Bitcoin symbol from https://bitcoin.org/img/icons/logotop.svg. */}
        <svg width="23" height="23" viewBox="210 52 36 44" fill="currentColor" aria-hidden="true">
          <path d="m241.91 70.689c0.637-4.258-2.605-6.547-7.038-8.074l1.438-5.768-3.511-0.875-1.4 5.616c-0.923-0.23-1.871-0.447-2.813-0.662l1.41-5.653-3.509-0.875-1.439 5.766c-0.764-0.174-1.514-0.346-2.242-0.527l0.004-0.018-4.842-1.209-0.934 3.75c0 0 2.605 0.597 2.55 0.634 1.422 0.355 1.679 1.296 1.636 2.042l-1.638 6.571c0.098 0.025 0.225 0.061 0.365 0.117-0.117-0.029-0.242-0.061-0.371-0.092l-2.296 9.205c-0.174 0.432-0.615 1.08-1.609 0.834 0.035 0.051-2.552-0.637-2.552-0.637l-1.743 4.019 4.569 1.139c0.85 0.213 1.683 0.436 2.503 0.646l-1.453 5.834 3.507 0.875 1.439-5.772c0.958 0.26 1.888 0.5 2.798 0.726l-1.434 5.745 3.511 0.875 1.453-5.823c5.987 1.133 10.489 0.676 12.384-4.739 1.527-4.36-0.076-6.875-3.226-8.515 2.294-0.529 4.022-2.038 4.483-5.155zm-8.022 11.249c-1.085 4.36-8.426 2.003-10.806 1.412l1.928-7.729c2.38 0.594 10.012 1.77 8.878 6.317zm1.086-11.312c-0.99 3.966-7.1 1.951-9.082 1.457l1.748-7.01c1.982 0.494 8.365 1.416 7.334 5.553z" />
        </svg>
      </span>
      <span>
        Nodarium<span className="brand-descriptor">Bitcoin Core</span>
      </span>
    </span>
  );
}

export function LanguagePicker() {
  const { t, i18n } = useTranslation();

  return (
    <label className="preference-picker">
      <Languages size={15} aria-hidden />
      <select
        aria-label={t('language.label')}
        value={i18n.language}
        onChange={(e) => setLanguage(e.target.value)}
      >
        <option value="en">English</option>
        <option value="de">Deutsch</option>
      </select>
    </label>
  );
}

export function ThemePicker() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <label className="preference-picker">
      <SunMoon size={15} aria-hidden />
      <select
        aria-label={t('theme.label')}
        value={theme}
        onChange={(e) => setTheme(e.target.value as Theme)}
      >
        {(['system', 'light', 'dark'] as const).map((value) => (
          <option key={value} value={value}>
            {t(`theme.${value}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>
        <span>{value}</span>
        {detail && <small>{detail}</small>}
      </dd>
    </div>
  );
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div className={`banner ${error ? 'warning' : ''}`} role={error ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Empty({ title, description }: { title: string; description?: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

export function SectionHeading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function ExternalIcon() {
  return <ArrowUpRight size={15} aria-hidden />;
}

export class ErrorBoundary extends Component<
  { children: ReactNode; label: string; retry: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <div className="empty-state" role="alert">
        <p>{this.props.label}</p>
        <button onClick={() => this.setState({ failed: false })}>{this.props.retry}</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
