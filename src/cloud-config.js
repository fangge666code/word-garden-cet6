export const CLOUD_CONFIG = Object.freeze({
  projectURL: "",
  anonKey: "",
});

export function cloudConfigured(config = CLOUD_CONFIG) {
  return Boolean(config.anonKey && /^https:\/\/[a-z0-9-]+\.supabase\.co$/iu.test(config.projectURL));
}
