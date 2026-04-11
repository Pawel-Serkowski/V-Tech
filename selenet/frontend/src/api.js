export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
export const WS_STATUS_URL =
  import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws/status";

async function parseResponse(response) {
  if (response.ok) {
    return response.json();
  }

  let detail = `Request failed with status ${response.status}`;
  try {
    const errorBody = await response.json();
    if (errorBody?.detail) {
      detail = errorBody.detail;
    }
  } catch {
    // Keep default message when response body is not JSON.
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

export function fetchPackets(limit = 100) {
  return request(`/api/packets?limit=${limit}`);
}

export function fetchQueueLoad() {
  return request("/api/packets/queue-load");
}

export function fetchNodes(limit = 200) {
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

export function uploadNodesJson(nodes) {
  return request("/api/nodes", {
    method: "POST",
    body: JSON.stringify({ nodes }),
  });
}

export function uploadNodesFile(file) {
  const formData = new FormData();
  formData.append("file", file);

  return request("/api/nodes/upload-file", {
    method: "POST",
    body: formData,
  });
}