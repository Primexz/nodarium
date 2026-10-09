import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Link, Navigate, Route, Routes, useLocation } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Activity,
  Blocks,
  LayoutDashboard,
  Network,
  Globe2,
  LogOut,
  Menu,
  X,
  ShieldCheck,
  ArrowUpRight,
  LockKeyhole,
  RefreshCw,
  Pickaxe,
  Server,
} from 'lucide-react';
import { useAuth } from './auth';
import { useReadings, refresh } from './state';
import { message } from './i18n';
import type { HistoryRange } from './types';
import { duration } from './format';
import { Brand, LanguagePicker, ThemePicker, Notice, ErrorBoundary } from './components/ui';

const Dashboard = lazy(() => import('./views/Dashboard'));
import styles from './App.module.css';

export default function App() {
  const { checking, authenticated } = useAuth();
  const { t } = useTranslation();

  if (checking)
    return (
      <main className="boot">
        <Brand />
        <p role="status">{t('app.opening')}</p>
      </main>
    );

  return authenticated ? <Workspace /> : <Login />;
}

function Login() {
  const { t } = useTranslation();
  const auth = useAuth();

  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      await auth.login(key);
      setKey('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.login}>
      <section className={styles.loginIntroduction}>
        <Brand />
        <div>
          <h1>
            {t('login.headline')} <span>Bitcoin.</span>
          </h1>
          <p>{t('login.description')}</p>
          <div className={styles.loginChain} aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i}>
                <Blocks size={24} />
                <span>SHA-256</span>
              </div>
            ))}
          </div>
        </div>
        <p className={styles.loginFoot}>
          <ShieldCheck size={16} />
          {t('login.hosted')}
        </p>
      </section>
      <section className={styles.loginAccess}>
        <div className={styles.loginPreferences}>
          <LanguagePicker />
          <ThemePicker />
        </div>
        <form className={styles.loginForm} onSubmit={login}>
          <LockKeyhole size={25} />
          <h2>{t('login.welcome')}</h2>
          <p>{t('login.instruction')}</p>
          <label htmlFor="admin-key">{t('login.key')}</label>
          <input
            id="admin-key"
            type="password"
            autoComplete="current-password"
            required
            value={key}
            disabled={busy}
            placeholder={t('login.placeholder')}
            onChange={(e) => setKey(e.target.value)}
          />
          {(error || auth.error) && <Notice error>{message(error || auth.error)}</Notice>}
          <button className="primary" disabled={busy || !key}>
            {busy ? t('login.signingIn') : t('login.open')}
            <ArrowUpRight size={18} />
          </button>
          <p className="form-note">
            <LockKeyhole size={13} />
            {t('login.private')}
          </p>
        </form>
        <span className={styles.loginVersion}>Nodarium / Bitcoin Core</span>
      </section>
    </main>
  );
}

function Workspace() {
  const { t } = useTranslation();
  const auth = useAuth();
  const node = useReadings();
  const location = useLocation();

  const [menu, setMenu] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<HistoryRange>('24h');

  const links = [
    { path: 'overview', icon: LayoutDashboard },
    { path: 'node', icon: Server },
    { path: 'mining', icon: Pickaxe },
    { path: 'peers', icon: Network },
    { path: 'traffic', icon: Activity },
    { path: 'mempool', icon: Blocks },
    { path: 'blocks', icon: Globe2 },
  ] as const;

  const page = links.find((link) => link.path === location.pathname.slice(1))?.path ?? 'overview';
  const title = t(`nav.${page}`);

  const navigation = (
    <>
      <Link to="/overview" onClick={() => setMenu(false)}>
        <Brand />
      </Link>
      <nav aria-label={t('nav.workspace')}>
        {links.map(({ path, icon: Icon }) => (
          <NavLink to={`/${path}`} key={path} onClick={() => setMenu(false)}>
            <Icon size={18} />
            <span>{t(`nav.${path}`)}</span>
            {path === 'peers' && node.peers.data && (
              <span className="nav-count">{node.peers.data.length}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className={styles.navBottom}>
        <p>
          <ShieldCheck size={14} />
          {t('login.hosted')}
        </p>
        <button className="logout" onClick={() => void auth.logout()}>
          <LogOut size={16} />
          {t('nav.signOut')}
        </button>
      </div>
    </>
  );

  const status = node.overview?.status ?? 'connecting';

  async function manualRefresh() {
    setRefreshing(true);

    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className={styles.shell}>
      <a href="#content" className="skip-link">
        {t('common.skip')}
      </a>
      <aside className={styles.sidebar}>{navigation}</aside>
      <div className={styles.main}>
        <header className={`${styles.topbar} topbar`}>
          <div className={styles.context}>
            <Dialog.Root open={menu} onOpenChange={setMenu}>
              <Dialog.Trigger asChild>
                <button className={`icon-button ${styles.mobileMenu}`} aria-label={t('nav.open')}>
                  <Menu size={20} />
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="drawer-overlay" />
                <Dialog.Content className="navigation-drawer">
                  <Dialog.Title className="sr-only">{t('nav.workspace')}</Dialog.Title>
                  <Dialog.Description className="sr-only">{t('login.hosted')}</Dialog.Description>
                  <Dialog.Close asChild>
                    <button className="icon-button drawer-close" aria-label={t('nav.close')}>
                      <X size={20} />
                    </button>
                  </Dialog.Close>
                  {navigation}
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <span className={styles.pageTitle}>{title}</span>
            <span className={`connection-badge ${status}`}>
              <span className="status-dot" />
              {t(
                `status.${status === 'connected' || status === 'partial' || status === 'disconnected' ? status : 'connecting'}`,
              )}
            </span>
          </div>
          <div className={styles.tools}>
            <LanguagePicker />
            <ThemePicker />
            <span className="updated">
              {node.overview?.checked_at
                ? t('dashboard.updated', {
                    time: duration((node.now - Date.parse(node.overview.checked_at)) / 1000),
                  })
                : t('dashboard.waiting')}
            </span>
            <button
              className={`icon-button ${refreshing ? 'spinning' : ''}`}
              disabled={refreshing}
              aria-label={t('dashboard.refresh')}
              onClick={() => void manualRefresh()}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>
        {auth.error && <Notice error>{message(auth.error)}</Notice>}
        <ErrorBoundary key={page} label={t('app.interfaceError')} retry={t('common.retry')}>
          <Suspense fallback={<Notice>{t('app.opening')}</Notice>}>
            <Routes>
              <Route path="/" element={<Navigate to="/overview" replace />} />
              {links.map(({ path }) => (
                <Route
                  key={path}
                  path={`/${path}`}
                  element={<Dashboard page={path} node={node} range={range} setRange={setRange} />}
                />
              ))}
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
        <footer className={styles.footer}>
          <span>
            <ShieldCheck size={13} />
            {t('app.direct')}
          </span>
          <span>{t('app.verification')}</span>
        </footer>
      </div>
    </div>
  );
}
