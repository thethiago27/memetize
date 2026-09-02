import { mediaUrl } from '../lib/api';

export function Thumb({
  path,
  alt,
  className = '',
  fallback = 'Sem miniatura',
}: {
  path: string | null | undefined;
  alt: string;
  className?: string;
  fallback?: string;
}) {
  const url = mediaUrl(path);
  return (
    <div className={`thumb ${className}`.trim()}>
      {url ? <img src={url} alt={alt} loading="lazy" /> : <span>{fallback}</span>}
    </div>
  );
}
