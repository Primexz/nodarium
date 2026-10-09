import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Bitcoin, Languages, SunMoon, ArrowUpRight } from 'lucide-react';
import { setLanguage } from '../i18n';
import { useTheme, type Theme } from '../theme';

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Bitcoin size={23} />
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
