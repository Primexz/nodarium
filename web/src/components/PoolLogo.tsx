import { useState } from 'react';
import { useTheme } from '../theme';

// Only bundled assets can be selected. Pool names never become network URLs.
const logos = import.meta.glob<string>('../assets/mining-pool-logos/*.svg', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});

function LogoImage({ sources }: { sources: string[] }) {
  const [failed, setFailed] = useState(0);
  const src = sources[failed];

  return (
    <span className="pool-logo" aria-hidden="true">
      {src && (
        <img
          src={src}
          alt=""
          width="24"
          height="24"
          decoding="async"
          onError={() => setFailed((value) => value + 1)}
        />
      )}
    </span>
  );
}

export default function PoolLogo({ name }: { name?: string | null }) {
  const { effective } = useTheme();
  const slug = name == null ? 'unknown' : name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const names =
    effective === 'light'
      ? [`${slug}.light.svg`, `${slug}.svg`, 'default.light.svg', 'default.svg']
      : [`${slug}.svg`, 'default.svg'];

  const sources = [
    ...new Set(names.map((file) => logos[`../assets/mining-pool-logos/${file}`]).filter(Boolean)),
  ];

  // A new theme or pool gets a fresh fallback chain, including when a previous
  // request failed. All failures leave the name visible without a broken image.
  return <LogoImage key={sources.join('|')} sources={sources} />;
}
