import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PeerMapData, Section } from '../types';
import { countryDistribution, countryName } from '../map';
import { decimal, number } from '../format';
import { message } from '../i18n';
import { Empty, Notice, SectionHeading } from './ui';

function PeerCountries({ section }: { section: Section<PeerMapData> }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const groups = countryDistribution(section.data?.peers ?? []);
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const knownCountries = groups.filter((group) => group.key !== 'unknown').length;
  const shown = expanded
    ? groups
    : groups.filter((group, index) => index < 8 || group.key === 'unknown');

  return (
    <section className="panel country-panel" aria-label={t('countries.title')}>
      <SectionHeading title={t('countries.title')} subtitle={t('countries.subtitle')}>
        {section.data && (
          <span className="country-summary">
            {t('countries.total', { count: total })} ·{' '}
            {t('countries.countries', { count: knownCountries })}
          </span>
        )}
      </SectionHeading>
      {(section.stale || section.error) && (
        <Notice error>{message(section.error) || t('map.stale')}</Notice>
      )}
      {section.data?.message && <Notice>{message(section.data.message)}</Notice>}
      {!section.data ? (
        <Empty title={t(section.error ? 'map.unavailable' : 'map.loading')} />
      ) : total === 0 ? (
        <Empty title={t('countries.empty')} />
      ) : (
        <>
          <dl className="country-bars">
            {shown.map((group) => {
              const share = (group.count / total) * 100;

              return (
                <div key={group.key} className={group.key === 'unknown' ? 'country-unknown' : ''}>
                  <dt>
                    {group.key === 'unknown'
                      ? t('countries.unknown')
                      : countryName(group.countryCode, group.country)}
                  </dt>
                  <dd>
                    <span className="country-track" aria-hidden="true">
                      <span style={{ width: `${share}%` }} />
                    </span>
                    <span
                      className="country-count"
                      aria-label={t('countries.total', { count: group.count })}
                    >
                      {number(group.count)}
                    </span>
                    <span className="country-share">{decimal(share, 1)}%</span>
                  </dd>
                </div>
              );
            })}
          </dl>
          {knownCountries > 8 && (
            <button
              className="country-more"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {t(expanded ? 'countries.showFewer' : 'countries.showAll', { count: knownCountries })}
            </button>
          )}
          <p className="country-note">{t('countries.note')}</p>
        </>
      )}
    </section>
  );
}

export default memo(PeerCountries);
