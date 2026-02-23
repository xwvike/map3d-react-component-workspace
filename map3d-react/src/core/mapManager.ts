import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import {
  draw2dBubble,
  draw2dLabel,
  drawLineBetween2Spot,
  drawSpot,
} from "./draw";
import type {
  AnyMapElement,
  LabelElement,
  LineElement,
  MapElement,
  ModelElement,
  SpotElement,
} from "../types";
import type { MapThemeConfig } from "./mapConfig";
import type { ExtendObject3D } from "../types";

export interface MapManagerOptions {
  dracoDecoderPath?: string;
  preserveWhenClear?: (id: string) => boolean;
  themeConfig: MapThemeConfig;
}

type ManagedElement = MapElement & {
  object3D?: THREE.Object3D;
};

export class MapManager {
  private scene: THREE.Scene;
  private mapObject3D: THREE.Object3D;
  private elementsContainer: THREE.Object3D;
  private labelsContainer: THREE.Object3D;
  private spotsContainer: THREE.Object3D;
  private modelsContainer: THREE.Object3D;
  private linesContainer: THREE.Object3D;
  private elements: Map<string, ManagedElement> = new Map();
  private animatedSpots: Array<THREE.Mesh & { _s?: number }> = [];
  private flySpots: Array<THREE.Mesh & { _s?: number; curve?: THREE.Curve<THREE.Vector3> }> = [];
  private modelMixers: THREE.AnimationMixer[] = [];
  private highlightedRegions: Map<
    string,
    {
      meshes: THREE.Mesh[];
      originalMaterials: THREE.Material[];
      timeoutId: ReturnType<typeof setTimeout>;
    }
  > = new Map();
  private gltfLoader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private options: MapManagerOptions;

  constructor(scene: THREE.Scene, mapObject3D: THREE.Object3D, options: MapManagerOptions) {
    this.scene = scene;
    this.mapObject3D = mapObject3D;
    this.options = options;

    this.elementsContainer = new THREE.Object3D();
    this.labelsContainer = new THREE.Object3D();
    this.spotsContainer = new THREE.Object3D();
    this.modelsContainer = new THREE.Object3D();
    this.linesContainer = new THREE.Object3D();

    this.elementsContainer.add(this.labelsContainer);
    this.elementsContainer.add(this.spotsContainer);
    this.elementsContainer.add(this.modelsContainer);
    this.elementsContainer.add(this.linesContainer);
    this.mapObject3D.add(this.elementsContainer);

    this.gltfLoader = new GLTFLoader();
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath(options.dracoDecoderPath ?? "./draco/");
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
  }

  private addLabel(element: LabelElement): Promise<void> {
    return new Promise((resolve) => {
      const labelObject = draw2dLabel(
        element.position,
        element.text,
        this.options.themeConfig
      );
      if (labelObject) {
        const managed = element as ManagedElement;
        managed.object3D = labelObject;
        this.labelsContainer.add(labelObject);
        this.elements.set(element.id, managed);
      }
      resolve();
    });
  }

  private addBubble(element: LabelElement): Promise<void> {
    return new Promise((resolve) => {
      const bubbleObject = draw2dBubble(
        element.position,
        element.text,
        this.options.themeConfig
      );
      if (bubbleObject) {
        const managed = element as ManagedElement;
        managed.object3D = bubbleObject;
        this.labelsContainer.add(bubbleObject);
        this.elements.set(element.id, managed);
      }
      resolve();
    });
  }

  private addSpot(element: SpotElement): Promise<void> {
    return new Promise((resolve) => {
      const spotObject = drawSpot(element.position, this.options.themeConfig);
      if (spotObject?.circle && spotObject.ring) {
        const container = new THREE.Object3D();
        container.add(spotObject.circle);
        container.add(spotObject.ring);

        const managed = element as ManagedElement;
        managed.object3D = container;
        managed.data = spotObject;
        this.spotsContainer.add(container);
        this.elements.set(element.id, managed);
        this.animatedSpots.push(spotObject.ring);
      }
      resolve();
    });
  }

  private addModel(element: ModelElement): Promise<void> {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        element.modelPath,
        (glb) => {
          const clonedModel = glb.scene.clone();
          const spotZ = this.options.themeConfig.spotZIndex;

          clonedModel.position.set(element.position[0], -element.position[1], spotZ);

          if (element.scale) {
            clonedModel.scale.set(...element.scale);
          } else {
            clonedModel.scale.set(0.3, 0.3, 0.6);
          }

          clonedModel.traverse((child) => {
            if (!(child as THREE.Mesh).isMesh) return;
            const mesh = child as THREE.Mesh;
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach((mat) => {
                if ("color" in mat) {
                  (mat as THREE.MeshPhongMaterial).color.set(0xff0000);
                }
              });
            } else if ("color" in mesh.material) {
              (mesh.material as THREE.MeshPhongMaterial).color.set(0xff0000);
            }
          });

          if (element.animation && glb.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(clonedModel);
            glb.animations.forEach((clip) => {
              mixer.clipAction(clip).play();
            });
            this.modelMixers.push(mixer);
          }

          const managed = element as ManagedElement;
          managed.object3D = clonedModel;
          this.modelsContainer.add(clonedModel);
          this.elements.set(element.id, managed);
          resolve();
        },
        undefined,
        (error) => reject(error)
      );
    });
  }

  private addLine(element: LineElement): Promise<void> {
    return new Promise((resolve) => {
      const { flyLine, flySpot } = drawLineBetween2Spot(
        element.startPosition,
        element.endPosition,
        this.options.themeConfig
      );

      const container = new THREE.Object3D();
      container.add(flyLine);
      container.add(flySpot);

      const managed = element as ManagedElement;
      managed.object3D = container;
      managed.data = { flyLine, flySpot };
      this.linesContainer.add(container);
      this.elements.set(element.id, managed);
      this.flySpots.push(flySpot);
      resolve();
    });
  }

  removeElement(id: string): boolean {
    const element = this.elements.get(id);
    if (!element?.object3D) {
      return false;
    }

    switch (element.type) {
      case "bubble":
      case "label":
        this.labelsContainer.remove(element.object3D);
        break;
      case "spot": {
        this.spotsContainer.remove(element.object3D);
        const ring = (element.data as { ring?: THREE.Mesh } | undefined)?.ring;
        if (ring) {
          this.animatedSpots = this.animatedSpots.filter((item) => item !== ring);
        }
        break;
      }
      case "model":
        this.modelsContainer.remove(element.object3D);
        this.modelMixers = this.modelMixers.filter((mixer) => {
          const root = mixer.getRoot();
          const shouldRemove = root === element.object3D;
          if (shouldRemove) {
            mixer.stopAllAction();
            mixer.uncacheRoot(root);
          }
          return !shouldRemove;
        });
        break;
      case "line": {
        this.linesContainer.remove(element.object3D);
        const flySpot = (element.data as { flySpot?: THREE.Mesh } | undefined)?.flySpot;
        if (flySpot) {
          this.flySpots = this.flySpots.filter((item) => item !== flySpot);
        }
        break;
      }
    }

    if (element.object3D.parent) {
      element.object3D.parent.remove(element.object3D);
    }
    this.disposeObject3D(element.object3D);
    this.elements.delete(id);
    return true;
  }

  async addElements(elements: AnyMapElement[]): Promise<void> {
    const tasks = elements.map((element) => {
      switch (element.type) {
        case "label":
          return this.addLabel(element as LabelElement);
        case "bubble":
          return this.addBubble(element as LabelElement);
        case "spot":
          return this.addSpot(element as SpotElement);
        case "model":
          return this.addModel(element as ModelElement);
        case "line":
          return this.addLine(element as LineElement);
        default:
          return Promise.resolve();
      }
    });

    await Promise.all(tasks);
  }

  removeElements(ids: string[]) {
    ids.forEach((id) => this.removeElement(id));
  }

  clearAllElements() {
    const shouldKeep = this.options.preserveWhenClear;
    const ids = Array.from(this.elements.keys()).filter((id) =>
      shouldKeep ? !shouldKeep(id) : true
    );
    this.removeElements(ids);
  }

  updateAnimations(delta: number) {
    this.modelMixers.forEach((mixer) => mixer.update(delta));

    this.animatedSpots.forEach((mesh) => {
      mesh._s = (mesh._s ?? 1) + 0.01;
      mesh.scale.set(mesh._s, mesh._s, mesh._s);
      if (mesh._s <= 2) {
        (mesh.material as THREE.Material & { opacity?: number }).opacity = 2 - mesh._s;
      } else {
        mesh._s = 1;
      }
    });

    this.flySpots.forEach((mesh) => {
      mesh._s = (mesh._s ?? 0) + 0.003;
      if (!mesh.curve) return;
      const pos = mesh.curve.getPointAt(mesh._s % 1);
      mesh.position.set(pos.x, pos.y, pos.z);
    });
  }

  highlightRegion(regionName: string, duration = 3000): boolean {
    if (this.highlightedRegions.has(regionName)) {
      this.clearRegionHighlight(regionName);
    }

    const targetRegion = this.findRegionByName(regionName);
    if (!targetRegion) return false;

    const meshes: THREE.Mesh[] = [];
    const originalMaterials: THREE.Material[] = [];

    targetRegion.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.userData.isChangeColor) return;
      meshes.push(child);
      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => {
          originalMaterials.push(mat.clone());
        });
      } else {
        originalMaterials.push(child.material.clone());
      }
    });

    if (meshes.length === 0) return false;

    this.applyHighlightMaterial(meshes);

    const timeoutId = setTimeout(() => {
      this.restoreRegionMaterial(regionName);
    }, duration);

    this.highlightedRegions.set(regionName, { meshes, originalMaterials, timeoutId });
    return true;
  }

  clearRegionHighlight(regionName: string): boolean {
    const highlightInfo = this.highlightedRegions.get(regionName);
    if (!highlightInfo) return false;

    clearTimeout(highlightInfo.timeoutId);
    this.restoreRegionMaterial(regionName);
    return true;
  }

  clearAllHighlights() {
    Array.from(this.highlightedRegions.keys()).forEach((regionName) => {
      this.clearRegionHighlight(regionName);
    });
  }

  getHighlightedRegions() {
    return Array.from(this.highlightedRegions.keys());
  }

  dispose() {
    this.clearAllElements();
    this.modelMixers.length = 0;
    this.animatedSpots.length = 0;
    this.flySpots.length = 0;
    this.clearAllHighlights();
    this.dracoLoader.dispose();
  }

  private findRegionByName(regionName: string): THREE.Object3D | null {
    let targetRegion: THREE.Object3D | null = null;

    this.mapObject3D.traverse((child) => {
      const extendedChild = child as ExtendObject3D;
      const props = extendedChild.customProperties;
      if (!props) return;

      if (
        props.name === regionName ||
        props.NAME === regionName ||
        String(props.adcode) === regionName ||
        props.code === regionName
      ) {
        targetRegion = child;
      }
    });

    return targetRegion;
  }

  private applyHighlightMaterial(meshes: THREE.Mesh[]) {
    meshes.forEach((mesh) => {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material, index) => {
          if (index !== 0 || !(material instanceof THREE.MeshPhongMaterial)) return;
          material.color.setHex(0xffd700);
          material.emissive.setHex(0x444400);
        });
      } else if (mesh.material instanceof THREE.MeshPhongMaterial) {
        mesh.material.color.setHex(0xffd700);
        mesh.material.emissive.setHex(0x444400);
      }
    });
  }

  private restoreRegionMaterial(regionName: string) {
    const highlightInfo = this.highlightedRegions.get(regionName);
    if (!highlightInfo) return;

    const { meshes, originalMaterials } = highlightInfo;
    let materialIndex = 0;

    meshes.forEach((mesh) => {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material, index) => {
          if (index !== 0 || materialIndex >= originalMaterials.length) return;
          const original = originalMaterials[materialIndex];
          if (
            material instanceof THREE.MeshPhongMaterial &&
            original instanceof THREE.MeshPhongMaterial
          ) {
            material.color.copy(original.color);
            material.emissive.copy(original.emissive);
          }
          materialIndex += 1;
        });
      } else if (materialIndex < originalMaterials.length) {
        const original = originalMaterials[materialIndex];
        if (
          mesh.material instanceof THREE.MeshPhongMaterial &&
          original instanceof THREE.MeshPhongMaterial
        ) {
          mesh.material.color.copy(original.color);
          mesh.material.emissive.copy(original.emissive);
        }
        materialIndex += 1;
      }
    });

    this.highlightedRegions.delete(regionName);
  }

  private disposeObject3D(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => {
            (material as THREE.Material & { map?: THREE.Texture }).map?.dispose();
            material.dispose();
          });
        } else {
          const material = child.material as THREE.Material & { map?: THREE.Texture };
          material.map?.dispose();
          material.dispose();
        }
      }
      const disposable = child as unknown as { dispose?: () => void };
      disposable.dispose?.();
    });

    while (object.children.length > 0) {
      const child = object.children[0];
      object.remove(child);
      this.disposeObject3D(child);
    }
  }
}
