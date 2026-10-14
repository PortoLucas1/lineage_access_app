/**
 * Unity Catalog object icons, using the SVG paths from the Databricks design
 * system (@databricks/design-system, ISC) so the browser matches Catalog
 * Explorer.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;
type Path = { d: string; evenOdd?: boolean };

function UcIcon({ paths, ...props }: IconProps & { paths: Path[] }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      fill="none"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...props}
    >
      {paths.map(({ d, evenOdd }) => (
        <path
          key={d}
          fill="currentColor"
          d={d}
          fillRule={evenOdd ? 'evenodd' : undefined}
          clipRule={evenOdd ? 'evenodd' : undefined}
        />
      ))}
    </svg>
  );
}

const TABLE_FRAME =
  'M1 1.75A.75.75 0 0 1 1.75 1h12.5a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75zm1.5.75v3h11v-3zm0 11V7H5v6.5zm4 0h3V7h-3zM11 7v6.5h2.5V7z';

export function CatalogIcon(props: IconProps) {
  return (
    <UcIcon
      {...props}
      paths={[
        {
          evenOdd: true,
          d: 'M14 .75a.75.75 0 0 0-.75-.75H4.5A2.5 2.5 0 0 0 2 2.5v10.75A2.75 2.75 0 0 0 4.75 16h8.5a.75.75 0 0 0 .75-.75zM3.5 4.792v8.458c0 .69.56 1.25 1.25 1.25h7.75V5h-8c-.356 0-.694-.074-1-.208m9-1.292v-2h-8a1 1 0 0 0 0 2z',
        },
      ]}
    />
  );
}

export function SchemaIcon(props: IconProps) {
  return (
    <UcIcon
      {...props}
      paths={[
        {
          evenOdd: true,
          d: 'M2.727 3.695c-.225.192-.227.298-.227.305s.002.113.227.305c.223.19.59.394 1.108.58C4.865 5.256 6.337 5.5 8 5.5s3.135-.244 4.165-.615c.519-.186.885-.39 1.108-.58.225-.192.227-.298.227-.305s-.002-.113-.227-.305c-.223-.19-.59-.394-1.108-.58C11.135 2.744 9.663 2.5 8 2.5s-3.135.244-4.165.615c-.519.186-.885.39-1.108.58M13.5 5.94a7 7 0 0 1-.826.358C11.442 6.74 9.789 7 8 7s-3.442-.26-4.673-.703a7 7 0 0 1-.827-.358V8c0 .007.002.113.227.305.223.19.59.394 1.108.58C4.865 9.256 6.337 9.5 8 9.5s3.135-.244 4.165-.615c.519-.186.885-.39 1.108-.58.225-.192.227-.298.227-.305zM15 8V4c0-.615-.348-1.1-.755-1.447-.41-.349-.959-.63-1.571-.85C11.442 1.26 9.789 1 8 1s-3.442.26-4.673.703c-.613.22-1.162.501-1.572.85C1.348 2.9 1 3.385 1 4v8c0 .615.348 1.1.755 1.447.41.349.959.63 1.572.85C4.558 14.74 6.21 15 8 15s3.441-.26 4.674-.703c.612-.22 1.161-.501 1.571-.85.407-.346.755-.832.755-1.447zm-1.5 1.939a7 7 0 0 1-.826.358C11.442 10.74 9.789 11 8 11s-3.442-.26-4.673-.703a7 7 0 0 1-.827-.358V12c0 .007.002.113.227.305.223.19.59.394 1.108.58 1.03.371 2.502.615 4.165.615s3.135-.244 4.165-.615c.519-.186.885-.39 1.108-.58.225-.192.227-.298.227-.305z',
        },
      ]}
    />
  );
}

export function TableIcon(props: IconProps) {
  return <UcIcon {...props} paths={[{ evenOdd: true, d: TABLE_FRAME }]} />;
}

export function StreamingTableIcon(props: IconProps) {
  return (
    <UcIcon
      {...props}
      paths={[
        {
          evenOdd: true,
          d: 'M1.75 1a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75H6.5V7h3v1H11V7h2.5v1H15V1.75a.75.75 0 0 0-.75-.75zM5 7v6.5H2.5V7zm8.5-1.5v-3h-11v3z',
        },
        {
          d: 'M9.024 10.92a1.187 1.187 0 0 1 1.876.03 2.687 2.687 0 0 0 4.247.066l.439-.548-1.172-.937-.438.548a1.187 1.187 0 0 1-1.876-.03 2.687 2.687 0 0 0-4.247-.066l-.439.548 1.172.937z',
        },
        {
          d: 'M9.024 13.92a1.187 1.187 0 0 1 1.876.03 2.687 2.687 0 0 0 4.247.066l.439-.548-1.172-.937-.438.548a1.187 1.187 0 0 1-1.876-.03 2.687 2.687 0 0 0-4.247-.066l-.439.548 1.172.937z',
        },
      ]}
    />
  );
}

export function MaterializedViewIcon(props: IconProps) {
  return (
    <UcIcon
      {...props}
      paths={[
        {
          evenOdd: true,
          d: 'M1.75 1a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75H8v-1.5H6.5V7h7v2H15V1.75a.75.75 0 0 0-.75-.75zM5 7H2.5v6.5H5zm8.5-1.5v-3h-11v3z',
        },
        {
          d: 'm8.43 11.512 3-3.5 1.14.976-1.94 2.262H14a.75.75 0 0 1 .57 1.238l-3 3.5-1.14-.976 1.94-2.262H9a.75.75 0 0 1-.57-1.238',
        },
      ]}
    />
  );
}

export function ViewIcon(props: IconProps) {
  return (
    <UcIcon
      {...props}
      paths={[
        {
          evenOdd: true,
          d: 'M1.75 1a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75H4v-1.5H2.5V7H5v2h1.5V7h3v2H11V7h2.5v2H15V1.75a.75.75 0 0 0-.75-.75zM13.5 5.5v-3h-11v3z',
        },
        {
          evenOdd: true,
          d: 'M11.75 10a.75.75 0 0 0-.707.5H9.957a.75.75 0 0 0-.708-.5H5.75a.75.75 0 0 0-.75.75v1.75a2.5 2.5 0 0 0 5 0V12h1v.5a2.5 2.5 0 0 0 5 0v-1.75a.75.75 0 0 0-.75-.75zm.75 2.5v-1h2v1a1 1 0 1 1-2 0m-6-1v1a1 1 0 1 0 2 0v-1z',
        },
      ]}
    />
  );
}

export function ExternalTableIcon(props: IconProps) {
  return (
    <UcIcon
      {...props}
      paths={[
        {
          evenOdd: true,
          d: 'M1.75 1a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75H7v-1.5h-.5V7H15V1.75a.75.75 0 0 0-.75-.75zM5 7v6.5H2.5V7zm8.5-1.5v-3h-11v3z',
        },
        {
          evenOdd: true,
          d: 'M11.625 7.25a4.375 4.375 0 1 0 0 8.75 4.375 4.375 0 0 0 0-8.75M9.952 9.287a10.5 10.5 0 0 0-.185 1.588H8.85a2.88 2.88 0 0 1 1.103-1.588m1.547-.02c-.116.41-.196.963-.23 1.608h.712c-.034-.646-.114-1.198-.23-1.608a2.5 2.5 0 0 0-.126-.353q-.06.13-.126.353m0 4.716c-.116-.41-.196-.963-.23-1.608h.712c-.034.646-.114 1.198-.23 1.608-.043.15-.086.265-.126.353a2.5 2.5 0 0 1-.126-.353m1.799-4.696c.098.475.158 1.016.185 1.588h.918a2.88 2.88 0 0 0-1.103-1.588m.185 3.088h.918a2.88 2.88 0 0 1-1.103 1.588c.098-.475.158-1.016.185-1.588m-4.634 0h.918c.027.572.087 1.113.185 1.588a2.88 2.88 0 0 1-1.103-1.588',
        },
      ]}
    />
  );
}

export function UcAssetIcon({ tableType, ...props }: IconProps & { tableType: string }) {
  switch (tableType.toUpperCase().replace(/ /g, '_')) {
    case 'STREAMING_TABLE':
      return <StreamingTableIcon {...props} />;
    case 'MATERIALIZED_VIEW':
      return <MaterializedViewIcon {...props} />;
    case 'VIEW':
    case 'METRIC_VIEW':
      return <ViewIcon {...props} />;
    case 'EXTERNAL':
    case 'FOREIGN':
      return <ExternalTableIcon {...props} />;
    default:
      return <TableIcon {...props} />;
  }
}
