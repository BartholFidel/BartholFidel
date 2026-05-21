/**
 * Shared types for BartholFidel platform services.
 */

/** Health check response from GET /api/health */
export interface HealthCheckResponse {
  success: boolean;
  platform: "BartholFidel";
  status: "online";
  timestamp: string;
}
