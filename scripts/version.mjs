export function nextAppVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Cannot preserve invalid app version ${JSON.stringify(version)}.`);
  return '1.0.0';
}
