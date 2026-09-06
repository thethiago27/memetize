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
      {url ? (
        // biome-ignore lint/performance/noImgElement: media comes from the local Studio API, not a remote host next/image can optimize.
        <img src={url} alt={alt} loading="lazy" />
      ) : (
        <span>{fallback}</span>
      )}
    </div>
  );
}
