export const CLOUD_CONFIG = Object.freeze({
  appId: "",
  appKey: "",
  serverURL: "",
});

export function cloudConfigured(config = CLOUD_CONFIG) {
  return Boolean(config.appId && config.appKey && /^https:\/\//u.test(config.serverURL));
}
