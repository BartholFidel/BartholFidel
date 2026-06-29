import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  CreateEntityBody,
  CreateRelationshipBody,
  Entity,
  EntityDetailResponse,
  EntityGraph,
  EntityRelationship,
  Incident,
  IncidentStatusAction,
  IncidentTierCounts,
  RawPayloadSummary,
  ShortestPathResponse,
  UpdateEntityBody,
} from "@bartholfidel/shared";

function apiBase(): string {
  if (typeof window !== "undefined") {
    return "";
  }
  const url = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return url;
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    return {
      success: false,
      error: text,
    } as unknown as T;
  }
}

function getErrorMessage(
  body: ApiSuccessResponse<unknown> | ApiErrorResponse,
  fallback: string,
): string {
  if (!body.success) {
    return body.error;
  }
  return fallback;
}

export async function fetchEntities(filters?: {
  source?: string;
  type?: string;
}): Promise<Entity[]> {
  const params = new URLSearchParams();
  if (filters?.source) {
    params.set("source", filters.source);
  }
  if (filters?.type) {
    params.set("type", filters.type);
  }
  const query = params.toString();
  const path = `/api/entities${query ? `?${query}` : ""}`;
  const response = await fetch(`${apiBase()}${path}`, { cache: "no-store" });
  const body = await parseJson<ApiSuccessResponse<Entity[]> | ApiErrorResponse>(
    response,
  );
  if (!response.ok || !body.success) {
    throw new Error(getErrorMessage(body, "Failed to fetch entities"));
  }
  return body.data;
}

export async function createEntity(
  payload: CreateEntityBody,
): Promise<Entity> {
  const response = await fetch(`${apiBase()}/api/entities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await parseJson<ApiSuccessResponse<Entity> | ApiErrorResponse>(
    response,
  );
  if (!response.ok || !body.success) {
    throw new Error(getErrorMessage(body, "Failed to create entity"));
  }
  return body.data;
}

export async function deleteEntity(id: string): Promise<void> {
  const response = await fetch(`${apiBase()}/api/entities/${id}`, {
    method: "DELETE",
  });
  const body = await parseJson<ApiSuccessResponse<{ id: string }> | ApiErrorResponse>(
    response,
  );
  if (!response.ok || !body.success) {
    throw new Error(getErrorMessage(body, "Failed to delete entity"));
  }
}

export async function updateEntity(
  id: string,
  payload: UpdateEntityBody,
): Promise<Entity> {
  const response = await fetch(`${apiBase()}/api/entities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await parseJson<ApiSuccessResponse<Entity> | ApiErrorResponse>(
    response,
  );
  if (!response.ok || !body.success) {
    throw new Error(getErrorMessage(body, "Failed to update entity"));
  }
  return body.data;
}

export async function fetchEntityDetail(
  id: string,
): Promise<EntityDetailResponse> {
  const response = await fetch(`${apiBase()}/api/entities/${id}`, {
    cache: "no-store",
  });
  const body = await parseJson<
    ApiSuccessResponse<EntityDetailResponse> | ApiErrorResponse
  >(response);
  if (!response.ok || !body.success) {
    throw new Error(getErrorMessage(body, "Failed to fetch entity detail"));
  }
  return body.data;
}

export async function fetchIncidents(): Promise<Incident[]> {
  const response = await fetch(`${apiBase()}/api/incidents`, {
    cache: "no-store",
  });
  const body = await parseJson<ApiSuccessResponse<Incident[]> | ApiErrorResponse>(
    response,
  );
  if (!response.ok || !body.success) {
    throw new Error(getErrorMessage(body, "Failed to fetch incidents"));
  }
  return body.data;
}

export async function fetchIncidentTierCounts(): Promise<IncidentTierCounts> {
  const response = await fetch(`${apiBase()}/api/incidents/counts`, {
    cache: "no-store",
  });
  const body = await parseJson<
    ApiSuccessResponse<IncidentTierCounts> | ApiErrorResponse
  >(response);
  if (!response.ok || !body.success) {
    throw new Error(getErrorMessage(body, "Failed to fetch incident counts"));
  }
  return body.data;
}

export async function fetchIncidentPayload(
  incidentId: string,
): Promise<RawPayloadSummary | null> {
  const response = await fetch(`${apiBase()}/api/incidents/${incidentId}/payload`, {
    cache: "no-store",
  });
  const body = await parseJson<
    ApiSuccessResponse<RawPayloadSummary | null> | ApiErrorResponse
  >(response);
  if (!response.ok || !body.success) {
    throw new Error(getErrorMessage(body, "Failed to fetch payload summary"));
  }
  return body.data;
}

export async function updateIncidentStatus(
  incidentId: string,
  action: IncidentStatusAction,
): Promise<Incident> {
  const response = await fetch(`${apiBase()}/api/incidents/${incidentId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const body = await parseJson<ApiSuccessResponse<Incident> | ApiErrorResponse>(
    response,
  );
  if (!response.ok || !body.success) {
    throw new Error(getErrorMessage(body, "Failed to update incident"));
  }
  return body.data;
}

export async function fetchGraph(): Promise<EntityGraph> {
  const response = await fetch(`${apiBase()}/api/graph`, { cache: "no-store" });
  const body = await parseJson<
    ApiSuccessResponse<EntityGraph> | ApiErrorResponse
  >(response);
  if (!response.ok || !body.success) {
    throw new Error(getErrorMessage(body, "Failed to fetch graph"));
  }
  return body.data;
}

export async function fetchShortestPath(
  from: string,
  to: string,
): Promise<ShortestPathResponse> {
  const params = new URLSearchParams({ from, to });
  const response = await fetch(`${apiBase()}/api/graph/path?${params.toString()}`, {
    cache: "no-store",
  });
  const body = await parseJson<
    ApiSuccessResponse<ShortestPathResponse> | ApiErrorResponse
  >(response);
  if (!response.ok || !body.success) {
    throw new Error(getErrorMessage(body, "Failed to compute shortest path"));
  }
  return body.data;
}

export async function createRelationship(
  payload: CreateRelationshipBody,
): Promise<EntityRelationship> {
  const response = await fetch(`${apiBase()}/api/graph/relationships`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await parseJson<
    ApiSuccessResponse<EntityRelationship> | ApiErrorResponse
  >(response);
  if (!response.ok || !body.success) {
    throw new Error(getErrorMessage(body, "Failed to create relationship"));
  }
  return body.data;
}

export async function deleteRelationship(id: string): Promise<void> {
  const response = await fetch(`${apiBase()}/api/graph/relationships/${id}`, {
    method: "DELETE",
  });
  const body = await parseJson<
    ApiSuccessResponse<{ id: string }> | ApiErrorResponse
  >(response);
  if (!response.ok || !body.success) {
    throw new Error(getErrorMessage(body, "Failed to delete relationship"));
  }
}
