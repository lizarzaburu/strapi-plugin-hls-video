export const HLS_ROOT = 'hls';

export function outputDirName(hash: string, version: number): string {
  return `${HLS_ROOT}/${hash}-v${version}`;
}

export function tmpDirName(hash: string, version: number): string {
  return `${HLS_ROOT}/.tmp-${hash}-v${version}`;
}

export function hlsUrl(dirName: string, file: string): string {
  return `/uploads/${dirName}/${file}`;
}

export function versionFromDirName(name: string): number | null {
  const match = /-v(\d+)$/.exec(name);
  return match ? Number(match[1]) : null;
}
