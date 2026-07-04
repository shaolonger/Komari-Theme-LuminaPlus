import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type {
  Fleet3DCameraPreset,
  Fleet3DNode,
  Fleet3DOrbit,
  Fleet3DQuality,
  Fleet3DRendererMode,
} from "@/utils/fleet3d";

interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Fleet3DSceneProps {
  nodes: Fleet3DNode[];
  orbits: Fleet3DOrbit[];
  selectedUuid: string | null;
  compareUuids: string[];
  riskScan: boolean;
  cameraPreset: Fleet3DCameraPreset;
  focusCenter: [number, number, number] | null;
  focusedUuids: string[];
  quality: Fleet3DQuality;
  rendererMode: Fleet3DRendererMode;
  snapshotRequestId: number;
  onSelectNode: (uuid: string | null) => void;
  onMarqueeSelect: (uuids: string[]) => void;
  onSnapshotReady: (dataUrl: string | null) => void;
}

const NODE_CORE_RADIUS = 0.105;
const NODE_GLOW_RADIUS = 0.22;
const MAX_TRAFFIC_PARTICLES_PER_DIRECTION = 26;
const CAMERA_PRESETS: Record<Fleet3DCameraPreset, THREE.Vector3> = {
  overview: new THREE.Vector3(0, 5.6, 12.5),
  close: new THREE.Vector3(0, 4.1, 8.4),
  wide: new THREE.Vector3(0, 7.4, 16.8),
};
const QUALITY_SETTINGS: Record<
  Fleet3DQuality,
  { pixelRatio: number; stars: number; particleRatio: number; pulseHalos: boolean }
> = {
  high: { pixelRatio: 2, stars: 720, particleRatio: 1, pulseHalos: true },
  balanced: { pixelRatio: 1.5, stars: 520, particleRatio: 0.72, pulseHalos: true },
  eco: { pixelRatio: 1, stars: 280, particleRatio: 0.38, pulseHalos: false },
};

interface TrafficStream {
  points: THREE.Points;
  positions: Float32Array;
  seeds: Float32Array;
  start: THREE.Vector3;
  end: THREE.Vector3;
  side: THREE.Vector3;
  speed: number;
  sway: number;
}

interface PingHalo {
  group: THREE.Group;
  pulse?: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  pulseStrength: number;
}

function seededUnit(index: number) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createStarField(count: number) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const radius = 9 + seededUnit(index) * 17;
    const theta = seededUnit(index + 11) * Math.PI * 2;
    const phi = Math.acos(seededUnit(index + 29) * 2 - 1);
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi) * 0.72;
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

    const brightness = 0.55 + seededUnit(index + 47) * 0.45;
    colors[index * 3] = 0.45 * brightness;
    colors[index * 3 + 1] = 0.62 * brightness;
    colors[index * 3 + 2] = 1 * brightness;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.035,
    vertexColors: true,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });

  return new THREE.Points(geometry, material);
}

function createOrbit(orbit: Fleet3DOrbit) {
  const points: THREE.Vector3[] = [];
  const segments = 180;
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    points.push(
      new THREE.Vector3(
        Math.cos(angle) * orbit.radius,
        orbit.y,
        Math.sin(angle) * orbit.radius,
      ),
    );
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0x8ea7d7,
    transparent: true,
    opacity: 0.17,
  });
  return new THREE.Line(geometry, material);
}

function createNodeMesh(
  node: Fleet3DNode,
  selected: boolean,
  inCompare: boolean,
  riskScan: boolean,
  focusDimmed: boolean,
) {
  const group = new THREE.Group();
  group.position.set(node.position[0], node.position[1], node.position[2]);
  group.userData.uuid = node.uuid;

  const color = new THREE.Color(node.color);
  const glow = new THREE.Color(node.glowColor);
  const riskDimmed = riskScan && node.risk.tone === "none" && !selected && !inCompare;
  const dimmed = riskDimmed || focusDimmed;
  const riskEmphasis = riskScan && node.risk.tone !== "none";
  const riskColor =
    node.risk.tone === "critical"
      ? new THREE.Color(0xff6678)
      : node.risk.tone === "warning"
        ? new THREE.Color(0xffc857)
        : glow;
  const coreGeometry = new THREE.SphereGeometry(NODE_CORE_RADIUS * node.scale, 24, 16);
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: riskEmphasis ? riskColor : color,
    emissive: riskEmphasis ? riskColor : glow,
    emissiveIntensity: dimmed ? 0.16 : riskEmphasis ? 1.9 : selected ? 1.8 : inCompare ? 1.25 : 0.82,
    roughness: 0.28,
    metalness: 0.22,
    transparent: dimmed,
    opacity: dimmed ? 0.3 : 1,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.userData.uuid = node.uuid;
  group.add(core);

  const glowGeometry = new THREE.SphereGeometry(NODE_GLOW_RADIUS * node.scale, 32, 16);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: riskEmphasis ? riskColor : glow,
    transparent: true,
    opacity: dimmed ? 0.02 : riskEmphasis ? 0.24 : selected ? 0.22 : inCompare ? 0.16 : 0.1,
    depthWrite: false,
  });
  const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
  glowMesh.userData.uuid = node.uuid;
  group.add(glowMesh);

  if (selected || inCompare) {
    const ringGeometry = new THREE.TorusGeometry(
      NODE_GLOW_RADIUS * node.scale * (selected ? 1.55 : 1.35),
      0.008,
      8,
      64,
    );
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: selected ? 0xffffff : glow,
      transparent: true,
      opacity: selected ? 0.58 : 0.35,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.userData.uuid = node.uuid;
    group.add(ring);
  }

  if (riskEmphasis) {
    const beaconGeometry = new THREE.TorusGeometry(
      NODE_GLOW_RADIUS * node.scale * (1.85 + node.risk.score * 0.72),
      0.01,
      8,
      72,
    );
    const beaconMaterial = new THREE.MeshBasicMaterial({
      color: riskColor,
      transparent: true,
      opacity: node.risk.tone === "critical" ? 0.58 : 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
    beacon.rotation.x = Math.PI / 2;
    beacon.userData.uuid = node.uuid;
    group.add(beacon);
  }

  return group;
}

function trafficParticleCount(rate: number, quality: Fleet3DQuality) {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const density = clamp(Math.log10(rate + 1) / 6, 0, 1);
  const ratio = QUALITY_SETTINGS[quality].particleRatio;
  return Math.max(2, Math.round((4 + density * MAX_TRAFFIC_PARTICLES_PER_DIRECTION) * ratio));
}

function createTrafficStream(
  node: Fleet3DNode,
  direction: "up" | "down",
  quality: Fleet3DQuality,
): TrafficStream | null {
  const rate = direction === "up" ? node.netUp : node.netDown;
  const count = trafficParticleCount(rate, quality);
  if (count === 0) return null;

  const nodePosition = new THREE.Vector3(
    node.position[0],
    node.position[1],
    node.position[2],
  );
  const radial = nodePosition.clone().normalize();
  const tangent = new THREE.Vector3(-radial.z, 0, radial.x).normalize();
  const side = tangent.multiplyScalar(direction === "up" ? 0.055 : -0.055);
  const start = nodePosition.clone().multiplyScalar(direction === "up" ? 0.95 : 0.18);
  const end = nodePosition.clone().multiplyScalar(direction === "up" ? 0.18 : 0.95);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    seeds[index] = (index / count + seededUnit(index + node.uuid.length * 17)) % 1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: direction === "up" ? 0x6aa7ff : 0x62e4b0,
    size: direction === "up" ? 0.042 : 0.038,
    transparent: true,
    opacity: direction === "up" ? 0.72 : 0.64,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  return {
    points: new THREE.Points(geometry, material),
    positions,
    seeds,
    start,
    end,
    side,
    speed: direction === "up" ? 0.56 : 0.44,
    sway: direction === "up" ? 0.028 : 0.02,
  };
}

function updateTrafficStream(stream: TrafficStream, elapsed: number) {
  const path = new THREE.Vector3();
  for (let index = 0; index < stream.seeds.length; index += 1) {
    const seed = stream.seeds[index];
    const t = (seed + elapsed * stream.speed) % 1;
    path.copy(stream.start).lerp(stream.end, t);
    const fade = Math.sin(t * Math.PI);
    const wobble = Math.sin((elapsed * 2.4 + seed * 18.849) * Math.PI) * stream.sway;
    const offset = stream.side.clone().multiplyScalar(0.7 + fade * 0.65);
    const base = index * 3;
    stream.positions[base] = path.x + offset.x;
    stream.positions[base + 1] = path.y + offset.y + wobble;
    stream.positions[base + 2] = path.z + offset.z;
  }
  const attribute = stream.points.geometry.getAttribute("position");
  attribute.needsUpdate = true;
}

function pingToneColor(node: Fleet3DNode) {
  switch (node.ping.tone) {
    case "critical":
      return 0xff6678;
    case "warning":
      return 0xffc857;
    case "good":
      return 0x8fffc1;
    case "none":
    default:
      return 0xd7e2f5;
  }
}

function nodeSeed(value: string) {
  let seed = 0;
  for (let index = 0; index < value.length; index += 1) {
    seed = (seed + value.charCodeAt(index) * (index + 1)) % 997;
  }
  return seed;
}

function createPingRingGeometry(radius: number, fragmentation: number, seed: number) {
  const positions: number[] = [];
  const segments = 112;
  const gapSize = Math.max(1, Math.round(fragmentation * 5));
  const gapEvery = Math.max(6, Math.round(16 - fragmentation * 9));
  for (let index = 0; index < segments; index += 1) {
    if (fragmentation > 0.04 && ((index + seed) % gapEvery) < gapSize) continue;
    const start = (index / segments) * Math.PI * 2;
    const end = ((index + 0.72) / segments) * Math.PI * 2;
    positions.push(
      Math.cos(start) * radius,
      0,
      Math.sin(start) * radius,
      Math.cos(end) * radius,
      0,
      Math.sin(end) * radius,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function createPingHalo(node: Fleet3DNode, quality: Fleet3DQuality): PingHalo | null {
  if (node.ping.tone === "none" || node.ping.radius <= 0) return null;

  const group = new THREE.Group();
  group.position.set(node.position[0], node.position[1], node.position[2]);
  group.userData.uuid = node.uuid;
  const radius = node.ping.radius * node.scale;
  const color = pingToneColor(node);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: node.ping.tone === "good" ? 0.36 : 0.62,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ring = new THREE.LineSegments(
    createPingRingGeometry(radius, node.ping.fragmentation, nodeSeed(node.uuid)),
    material,
  );
  group.add(ring);

  let pulse: PingHalo["pulse"];
  if (QUALITY_SETTINGS[quality].pulseHalos && node.ping.pulse > 0.2) {
    const pulseMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.24 * node.ping.pulse,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    pulse = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.03, 0.01, 8, 80),
      pulseMaterial,
    );
    pulse.rotation.x = Math.PI / 2;
    group.add(pulse);
  }

  return {
    group,
    pulse,
    pulseStrength: node.ping.pulse,
  };
}

function updatePingHalo(halo: PingHalo, elapsed: number) {
  if (!halo.pulse) return;
  const phase = (elapsed * 0.72) % 1;
  halo.pulse.scale.setScalar(1 + phase * 0.72);
  halo.pulse.material.opacity = (1 - phase) * 0.3 * halo.pulseStrength;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if ("geometry" in mesh && mesh.geometry) mesh.geometry.dispose();
    const material = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}

function toCanvasPoint(event: PointerEvent, rect: DOMRect) {
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function buildMarqueeRect(
  start: { x: number; y: number },
  current: { x: number; y: number },
): MarqueeRect {
  const left = Math.min(start.x, current.x);
  const top = Math.min(start.y, current.y);
  return {
    left,
    top,
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
}

export function Fleet3DScene({
  nodes,
  orbits,
  selectedUuid,
  compareUuids,
  riskScan,
  cameraPreset,
  focusCenter,
  focusedUuids,
  quality,
  rendererMode,
  snapshotRequestId,
  onSelectNode,
  onMarqueeSelect,
  onSnapshotReady,
}: Fleet3DSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const snapshotRef = useRef<(() => string | null) | null>(null);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    snapshotRef.current = null;
    const compareSet = new Set(compareUuids);
    const focusedSet = new Set(focusedUuids);
    const hasFocus = focusedSet.size > 0 && focusedSet.size < nodes.length;
    const focusVector = focusCenter
      ? new THREE.Vector3(focusCenter[0], focusCenter[1], focusCenter[2])
      : null;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80);
    camera.position.copy(CAMERA_PRESETS[cameraPreset]);
    camera.lookAt(0, 0, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      });
    } catch {
      container.dataset.rendererMode = "unavailable";
      container.dataset.rendererRuntime = "unavailable";
      return;
    }
    const renderingContext = renderer.getContext();
    const runtimeMode =
      typeof WebGL2RenderingContext !== "undefined" &&
      renderingContext instanceof WebGL2RenderingContext
        ? "webgl2"
        : "webgl1";
    const runtimeLabel =
      rendererMode === "webgpu" ? `webgpu-detected-${runtimeMode}-fallback` : runtimeMode;
    container.dataset.rendererMode = rendererMode;
    container.dataset.rendererRuntime = runtimeLabel;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(QUALITY_SETTINGS[quality].pixelRatio, window.devicePixelRatio || 1));
    renderer.domElement.className = "fleet3d-canvas";
    renderer.domElement.dataset.renderer = runtimeLabel;
    container.appendChild(renderer.domElement);
    snapshotRef.current = () => {
      try {
        return renderer.domElement.toDataURL("image/png");
      } catch {
        return null;
      }
    };

    const root = new THREE.Group();
    scene.add(root);

    const starField = createStarField(QUALITY_SETTINGS[quality].stars);
    scene.add(starField);

    const orbitGroup = new THREE.Group();
    orbits.forEach((orbit) => orbitGroup.add(createOrbit(orbit)));
    root.add(orbitGroup);

    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x6a8fff,
      transparent: true,
      opacity: 0.12,
    });
    const hitTargets: THREE.Object3D[] = [];
    const nodeGroups = new Map<string, THREE.Group>();
    const trafficStreams: TrafficStream[] = [];
    const pingHalos: PingHalo[] = [];
    for (const node of nodes) {
      const selected = node.uuid === selectedUuid;
      const inCompare = compareSet.has(node.uuid);
      const focusDimmed = hasFocus && !focusedSet.has(node.uuid) && !selected && !inCompare;
      const mesh = createNodeMesh(node, selected, inCompare, riskScan, focusDimmed);
      nodeGroups.set(node.uuid, mesh);
      hitTargets.push(mesh);
      root.add(mesh);

      const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, node.position[1] * 0.25, 0),
        new THREE.Vector3(node.position[0], node.position[1], node.position[2]),
      ]);
      root.add(new THREE.Line(lineGeometry, lineMaterial.clone()));

      const suppressAuxiliary = focusDimmed || (riskScan && node.risk.tone === "none");
      const upStream = suppressAuxiliary ? null : createTrafficStream(node, "up", quality);
      if (upStream) {
        trafficStreams.push(upStream);
        root.add(upStream.points);
      }
      const downStream = suppressAuxiliary ? null : createTrafficStream(node, "down", quality);
      if (downStream) {
        trafficStreams.push(downStream);
        root.add(downStream.points);
      }

      const pingHalo = focusDimmed ? null : createPingHalo(node, quality);
      if (pingHalo) {
        pingHalos.push(pingHalo);
        root.add(pingHalo.group);
      }
    }

    scene.add(new THREE.AmbientLight(0x9fb7ff, 1.5));
    const keyLight = new THREE.PointLight(0x8db7ff, 90, 40);
    keyLight.position.set(3, 5, 6);
    scene.add(keyLight);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let frame = 0;
    let pointerDown: { x: number; y: number } | null = null;
    let didDrag = false;
    let hoveredUuid: string | null = null;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const setPointerFromEvent = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const pickNode = (event: PointerEvent) => {
      setPointerFromEvent(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(hitTargets, true)[0];
      return hit?.object.userData.uuid as string | undefined;
    };

    const selectMarqueeNodes = (rect: MarqueeRect) => {
      const canvasRect = renderer.domElement.getBoundingClientRect();
      const selected: string[] = [];
      for (const node of nodes) {
        const group = nodeGroups.get(node.uuid);
        if (!group) continue;
        const projected = group.position.clone().applyMatrix4(root.matrixWorld).project(camera);
        const x = ((projected.x + 1) / 2) * canvasRect.width;
        const y = ((1 - projected.y) / 2) * canvasRect.height;
        if (
          x >= rect.left &&
          x <= rect.left + rect.width &&
          y >= rect.top &&
          y <= rect.top + rect.height
        ) {
          selected.push(node.uuid);
        }
      }
      if (selected.length > 0) onMarqueeSelect(selected);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const point = toCanvasPoint(event, rect);
      if (pointerDown) {
        const next = buildMarqueeRect(pointerDown, point);
        didDrag = next.width > 8 || next.height > 8;
        if (didDrag) setMarquee(next);
        return;
      }

      const uuid = pickNode(event);
      if (uuid !== hoveredUuid) {
        hoveredUuid = uuid ?? null;
        renderer.domElement.style.cursor = uuid ? "pointer" : "crosshair";
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      pointerDown = toCanvasPoint(event, renderer.domElement.getBoundingClientRect());
      didDrag = false;
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const handlePointerUp = (event: PointerEvent) => {
      renderer.domElement.releasePointerCapture(event.pointerId);
      if (pointerDown && didDrag) {
        const next = buildMarqueeRect(
          pointerDown,
          toCanvasPoint(event, renderer.domElement.getBoundingClientRect()),
        );
        selectMarqueeNodes(next);
        setMarquee(null);
      } else {
        onSelectNode(pickNode(event) ?? null);
      }
      pointerDown = null;
      didDrag = false;
    };

    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);

    const startMs = performance.now();
    const animate = () => {
      const elapsed = (performance.now() - startMs) / 1000;
      const targetRotationY = focusVector ? 0 : elapsed * 0.085;
      root.rotation.y += (targetRotationY - root.rotation.y) * 0.055;
      root.rotation.x = Math.sin(elapsed * 0.32) * 0.04;
      const targetRootPosition = new THREE.Vector3(0, 0, 0);
      if (focusVector) {
        targetRootPosition.copy(focusVector).applyEuler(root.rotation).multiplyScalar(-1);
      }
      root.position.lerp(targetRootPosition, 0.075);
      camera.position.lerp(CAMERA_PRESETS[cameraPreset], 0.045);
      camera.lookAt(0, 0, 0);
      starField.rotation.y = elapsed * 0.025;
      starField.rotation.x = Math.sin(elapsed * 0.17) * 0.035;
      trafficStreams.forEach((stream) => updateTrafficStream(stream, elapsed));
      pingHalos.forEach((halo) => updatePingHalo(halo, elapsed));
      nodeGroups.forEach((group, uuid) => {
        const selected = uuid === selectedUuid;
        const riskNode = nodes.find((node) => node.uuid === uuid);
        const riskBoost = riskScan && riskNode?.risk.tone === "critical" ? 0.08 : 0;
        const pulse = 1 + Math.sin(elapsed * 2.8 + group.position.x) * (selected ? 0.07 : 0.025 + riskBoost);
        group.scale.setScalar(pulse);
      });
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      snapshotRef.current = null;
      renderer.domElement.remove();
      disposeObject(scene);
      renderer.dispose();
      setMarquee(null);
    };
  }, [
    cameraPreset,
    compareUuids,
    focusCenter,
    focusedUuids,
    nodes,
    onMarqueeSelect,
    onSelectNode,
    onSnapshotReady,
    orbits,
    quality,
    rendererMode,
    riskScan,
    selectedUuid,
  ]);

  useEffect(() => {
    if (snapshotRequestId <= 0) return;
    onSnapshotReady(snapshotRef.current?.() ?? null);
  }, [onSnapshotReady, snapshotRequestId]);

  return (
    <div ref={containerRef} className="fleet3d-scene" data-fleet3d-scene data-renderer-mode={rendererMode}>
      {marquee && (
        <div
          className="fleet3d-marquee"
          style={{
            left: marquee.left,
            top: marquee.top,
            width: marquee.width,
            height: marquee.height,
          }}
        />
      )}
    </div>
  );
}
