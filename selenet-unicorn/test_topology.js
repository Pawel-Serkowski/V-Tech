const fs = require('fs');

let mainJs = fs.readFileSync('frontend/src/visualization/main.js', 'utf8');

const topologyInit = `
const topologyMaterial = new THREE.LineBasicMaterial({ color: 0x4a7e99, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending });
const topologyGeometry = new THREE.BufferGeometry();
const topologyLines = new THREE.LineSegments(topologyGeometry, topologyMaterial);
scene.add(topologyLines);
`;

if (!mainJs.includes('topologyLines')) {
    mainJs = mainJs.replace('const relayBeams = [];', 'const relayBeams = [];\n' + topologyInit);
}

const topologyUpdate = `
  liveNodeVisuals.forEach((visual) => {
    if (visual.kind === "satellite" && visual.targetPosition && visual.mesh) {
       visual.mesh.position.lerp(visual.targetPosition, 0.08);
    }
  });

  const topologyPositions = [];
  const processedLinks = new Set();
  const nodeMap = new Map();
  
  liveNodeVisuals.forEach(v => {
    if (v.node && v.mesh) {
        nodeMap.set(v.node.node_id, v.mesh.getWorldPosition(new THREE.Vector3()));
    }
  });

  liveNodeVisuals.forEach(v => {
    const node = v.node;
    if (!node || !node.links || !v.mesh) return;
    const vPos = nodeMap.get(node.node_id);
    if (!vPos) return;

    node.links.forEach(link => {
       const dest_node = typeof link === "object" ? link.dest_node : link;
       if (!dest_node) return;
       const pairId = [node.node_id, dest_node].sort().join("-");
       if (processedLinks.has(pairId)) return;
       const destPos = nodeMap.get(dest_node);
       if (destPos) {
          topologyPositions.push(vPos.x, vPos.y, vPos.z);
          topologyPositions.push(destPos.x, destPos.y, destPos.z);
          processedLinks.add(pairId);
       }
    });
  });

  topologyGeometry.setAttribute('position', new THREE.Float32BufferAttribute(topologyPositions, 3));
`;

if (!mainJs.includes('topologyPositions')) {
    // replace original loop in animate
    mainJs = mainJs.replace(`  liveNodeVisuals.forEach((visual) => {
    if (visual.kind === "satellite" && visual.targetPosition && visual.mesh) {
       visual.mesh.position.lerp(visual.targetPosition, 0.08);
    }
  });`, topologyUpdate);
}

fs.writeFileSync('frontend/src/visualization/main.js', mainJs);
console.log('Done');
