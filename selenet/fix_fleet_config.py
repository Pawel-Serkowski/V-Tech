import re

with open("/Users/pawelserkowski/Desktop/V-Tech/selenet-unicorn/frontend/src/pages/FleetConfigPage.jsx", "r") as f:
    content = f.read()

# Fix sanitizeNodeInput
replacement1 = """    surface_lat_deg: toNumberOrNull(editor.surface_lat_deg),
    surface_lon_deg: toNumberOrNull(editor.surface_lon_deg),
    location_label: String(editor.location_label || "").trim() || null,
    links: String(editor.links || "").split(",").map(s => s.trim()).filter(Boolean).map(dest => ({
      dest_node: dest,
      bandwidth_bps: toNumberOrNull(editor.link_bandwidth_bps) ?? 1048576,
      windows: []
    })),
  };"""

content = re.sub(r'    surface_lat_deg: toNumberOrNull\(editor\.surface_lat_deg\),\n    surface_lon_deg: toNumberOrNull\(editor\.surface_lon_deg\),\n    location_label: String\(editor\.location_label \|\| ""\)\.trim\(\) \|\| null,\n      link_bandwidth_bps: toNumberOrNull\(editor\.link_bandwidth_bps\) \?\? 1048576,\n    };', replacement1, content)

# Fix toEditor
replacement2 = """    surface_lat_deg: node.surface_lat_deg ?? "",
    surface_lon_deg: node.surface_lon_deg ?? "",
    location_label: node.location_label || "",
    links: Array.isArray(node.links) ? node.links.map(l => typeof l === "object" ? l.dest_node : l).join(", ") : "",
    link_bandwidth_bps: (Array.isArray(node.links) && node.links[0]?.bandwidth_bps) ? node.links[0].bandwidth_bps : "1048576",
  };"""

content = re.sub(r'    surface_lat_deg: node\.surface_lat_deg \?\? "",\n    surface_lon_deg: node\.surface_lon_deg \?\? "",\n    location_label: node\.location_label \|\| "",\n      link_bandwidth_bps: node\.link_bandwidth_bps \?\? "1048576",\n    };', replacement2, content)

with open("/Users/pawelserkowski/Desktop/V-Tech/selenet-unicorn/frontend/src/pages/FleetConfigPage.jsx", "w") as f:
    f.write(content)
