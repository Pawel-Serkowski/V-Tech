export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8002";
export const WS_STATUS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8002/ws/status";

function formatValidationDetail(detail) {
  if (!Array.isArray(detail) || detail.length === 0) {
    return null;
  }

  const first = detail[0];
  const location = Array.isArray(first?.loc) ? first.loc.join(".") : "request";
  const message = typeof first?.msg === "string" ? first.msg : "Validation error";
  return `${location}: ${message}`;
}

async function parseResponse(response) {
  if (response.ok) {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  let detail = `Request failed with status ${response.status}`;

  try {
    const errorBody = await response.json();
    if (typeof errorBody?.detail === "string") {
      detail = errorBody.detail;
    } else if (Array.isArray(errorBody?.detail)) {
      detail = formatValidationDetail(errorBody.detail) || detail;
    } else if (typeof errorBody?.detail?.message === "string") {
      detail = errorBody.detail.message;
    } else if (typeof errorBody?.message === "string") {
      detail = errorBody.message;
    }
  } catch {
    // Keep generic message when response body is not JSON.
  }

  throw new Error(detail);
}

async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = isFormData
    ? options.headers || {}
    : {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  return parseResponse(response);
}

export function fetchPackets(limit = 300) {
  return request(`/api/packets?limit=${limit}`);
}

export function fetchPacket(packetId) {
  return request(`/api/packets/${packetId}`);
}

export function fetchQueueLoad() {
  return request("/api/packets/queue-load");
}

export function fetchNodes(limit = 500) {
  return request(`/api/nodes?limit=${limit}`);
}

export function fetchDispatchContext() {
  return request("/api/packets/dispatch-context");
}

export function createPacket(packet) {
  return request("/api/packets", {
    method: "POST",
    body: JSON.stringify(packet),
  });
}

export function cancelPacket(packetId) {
  return request(`/api/packets/${packetId}/cancel`, {
    method: "POST",
  });
}

export function uploadNodesJson(nodes, options = {}) {
  const query = options.replace ? "?replace=true" : "";
  return request(`/api/nodes${query}`, {
    method: "POST",
    body: JSON.stringify({ nodes }),
  });
}

export function uploadNodesFile(file, options = {}) {
  const formData = new FormData();
  formData.append("file", file);

  const query = options.replace ? "?replace=true" : "";
  return request(`/api/nodes/upload-file${query}`, {
    method: "POST",
    body: formData,
  });
}
