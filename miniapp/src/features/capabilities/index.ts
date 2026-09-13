/**
 * Ce funcții sunt DISPONIBILE CU ADEVĂRAT pe serverul acesta.
 *
 * Singura sursă de adevăr e ruta de capabilități; clientul nu ghicește niciodată
 * după mediu sau după o variabilă de build. Vezi `capabilitiesApi.ts`.
 */
export {
  CAPABILITIES_PATH,
  CAPABILITY,
  NO_CAPABILITIES,
  fetchCapabilities,
  isCapabilityEnabled,
  normalizeCapabilities,
  normalizeKey,
} from './capabilitiesApi';
export type { CapabilityMap, CapabilityName } from './capabilitiesApi';
export { CAPABILITIES_KEY, useCapabilities, useCapability } from './useCapabilities';
export type { CapabilitiesState, CapabilityState } from './useCapabilities';
