import { useTranslation } from 'react-i18next';
import { historyRanges, type HistoryRange } from '../types';

export default function HistoryRangePicker({
  title,
  range,
  onChange,
}: {
  title: string;
  range: HistoryRange;
  onChange: (range: HistoryRange) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="section-toolbar">
      <h2>{title}</h2>
      <div className="range-picker" role="group" aria-label={t('history.range')}>
        {historyRanges.map((value) => (
          <button
            key={value}
            aria-pressed={range === value}
            className={range === value ? 'active' : ''}
            onClick={() => onChange(value)}
          >
            {t(`range.${value}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
