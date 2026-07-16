export const CLOUD_CONFIG = Object.freeze({
  projectURL: "https://qwjbitkuiccnmwejrlcd.supabase.co",
  anonKey: "sb_publishable_v7_RDyTSqtqf2Fp5CldrDQ_j4MIzmnc",
});

export function cloudConfigured(config = CLOUD_CONFIG) {
  return Boolean(config.anonKey && /^https:\/\/[a-z0-9-]+\.supabase\.co$/iu.test(config.projectURL));
}
