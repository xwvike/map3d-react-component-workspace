import * as THREE from "three";

export function initCamera(container: HTMLElement) {
  const camera = new THREE.PerspectiveCamera(
    22,
    container.clientWidth / container.clientHeight,
    0.1,
    1000
  );
  camera.position.set(-7, -60, 80);

  return { camera };
}
