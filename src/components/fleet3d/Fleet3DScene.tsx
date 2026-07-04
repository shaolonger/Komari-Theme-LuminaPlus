import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { Fleet3DNode, Fleet3DOrbit } from "@/utils/fleet3d";

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
  onSelectNode: (uuid: string | null) => void;
  onMarqueeSelect: (uuids: string[]) => void;
}

const NODE_CORE_RADIUS = 0.105;
const NODE_GLOW_RADIUS = 0.22;

function seededUnit(index: number) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function createStarField() {
  const count = 720;
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
) {
  const group = new THREE.Group();
  group.position.set(node.position[0], node.position[1], node.position[2]);
  group.userData.uuid = node.uuid;

  const color = new THREE.Color(node.color);
  const glow = new THREE.Color(node.glowColor);
  const coreGeometry = new THREE.SphereGeometry(NODE_CORE_RADIUS * node.scale, 24, 16);
  const coreMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: glow,
    emissiveIntensity: selected ? 1.8 : inCompare ? 1.25 : 0.82,
    roughness: 0.28,
    metalness: 0.22,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.userData.uuid = node.uuid;
  group.add(core);

  const glowGeometry = new THREE.SphereGeometry(NODE_GLOW_RADIUS * node.scale, 32, 16);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: glow,
    transparent: true,
    opacity: selected ? 0.22 : inCompare ? 0.16 : 0.1,
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

  return group;
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
  onSelectNode,
  onMarqueeSelect,
}: Fleet3DSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const compareSet = new Set(compareUuids);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80);
    camera.position.set(0, 5.6, 12.5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.domElement.className = "fleet3d-canvas";
    container.appendChild(renderer.domElement);

    const root = new THREE.Group();
    scene.add(root);

    const starField = createStarField();
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
    for (const node of nodes) {
      const selected = node.uuid === selectedUuid;
      const inCompare = compareSet.has(node.uuid);
      const mesh = createNodeMesh(node, selected, inCompare);
      nodeGroups.set(node.uuid, mesh);
      hitTargets.push(mesh);
      root.add(mesh);

      const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, node.position[1] * 0.25, 0),
        new THREE.Vector3(node.position[0], node.position[1], node.position[2]),
      ]);
      root.add(new THREE.Line(lineGeometry, lineMaterial.clone()));
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

    const clock = new THREE.Clock();
    const animate = () => {
      const elapsed = clock.getElapsedTime();
      root.rotation.y = elapsed * 0.085;
      root.rotation.x = Math.sin(elapsed * 0.32) * 0.04;
      starField.rotation.y = elapsed * 0.025;
      starField.rotation.x = Math.sin(elapsed * 0.17) * 0.035;
      nodeGroups.forEach((group, uuid) => {
        const selected = uuid === selectedUuid;
        const pulse = 1 + Math.sin(elapsed * 2.8 + group.position.x) * (selected ? 0.07 : 0.025);
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
      renderer.domElement.remove();
      disposeObject(scene);
      renderer.dispose();
      setMarquee(null);
    };
  }, [compareUuids, nodes, onMarqueeSelect, onSelectNode, orbits, selectedUuid]);

  return (
    <div ref={containerRef} className="fleet3d-scene" data-fleet3d-scene>
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
