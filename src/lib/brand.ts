// Visual tokens shared with capstone_repository's aresver-css theme.
export const BRAND_PRIMARY = '#2e3f92';
export function organizationAccent(accent?: string) {
  // Adopt the shared brand for the original default; preserve custom branding.
  return !accent || accent.toLowerCase() === '#0e766c' ? BRAND_PRIMARY : accent;
}
