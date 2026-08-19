import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MindARThree } from 'mindar-face-three';

let mindarThree = null;
let gltfLoader = new GLTFLoader();
let currentLoadedModel = null;
let currentAnchor = null;
let currentOccluder = null;
let isARRunning = false;

/**
 * Start MindAR Face Tracking & Three.js 3D Virtual Try-On
 * @param {HTMLElement} containerEl - DOM element to render the AR video and WebGL canvas
 * @param {string} modelUrl - URL to .glb 3D glasses model
 */
export async function startARVirtualTryOn(containerEl, modelUrl = '/assets/models/prada_vintage.glb') {
    if (isARRunning) {
        stopARVirtualTryOn();
    }
    
    const loadingEl = document.getElementById('mindar-loading-indicator');
    if (loadingEl) loadingEl.style.display = 'block';

    try {
        mindarThree = new MindARThree({
            container: containerEl,
            uiLoading: "no",
            uiScanning: "no",
            uiError: "no"
        });

        const { renderer, scene, camera } = mindarThree;

        // Realistic Lighting setup for eyewear materials (acetate, metal, lenses)
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
        scene.add(ambientLight);

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
        keyLight.position.set(0, 1.5, 2);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xddeeff, 1.0);
        fillLight.position.set(0, -1, 1.5);
        scene.add(fillLight);

        const backLight = new THREE.DirectionalLight(0xffffff, 0.8);
        backLight.position.set(0, 2, -2);
        scene.add(backLight);

        // Head Occluder: Real-time 3D face mesh that masks temples behind ears and head
        currentOccluder = mindarThree.addFaceMesh();
        const occluderMat = new THREE.MeshStandardMaterial({
            colorWrite: false, // Depth buffer only (invisible mask)
        });
        currentOccluder.material = occluderMat;
        currentOccluder.renderOrder = 0;

        // Anchor at Landmark 168 (Nose Bridge / Eye Center)
        currentAnchor = mindarThree.addAnchor(168);

        // Load 3D Model
        if (modelUrl) {
            gltfLoader.load(
                modelUrl,
                (gltf) => {
                    if (currentLoadedModel && currentAnchor) {
                        currentAnchor.group.remove(currentLoadedModel);
                    }
                    currentLoadedModel = gltf.scene;
                    
                    // Auto-fit bounding box to human head dimensions (~14.8 MindAR units)
                    fitGlassesModelToFace(currentLoadedModel, 14.8);
                    
                    currentLoadedModel.renderOrder = 1;
                    if (currentAnchor) {
                        currentAnchor.group.add(currentLoadedModel);
                    }
                    if (loadingEl) loadingEl.style.display = 'none';
                },
                undefined,
                (err) => {
                    console.error('Error loading 3D glasses model for AR:', err);
                    if (loadingEl) loadingEl.style.display = 'none';
                }
            );
        }

        await mindarThree.start();
        isARRunning = true;

        // Ensure video is visible above container background and canvas is layered on top
        if (mindarThree.video) {
            mindarThree.video.style.zIndex = '1';
        }
        if (renderer && renderer.domElement) {
            renderer.domElement.style.zIndex = '2';
            renderer.domElement.style.pointerEvents = 'none';
        }
        if (mindarThree.cssRenderer && mindarThree.cssRenderer.domElement) {
            mindarThree.cssRenderer.domElement.style.zIndex = '3';
            mindarThree.cssRenderer.domElement.style.pointerEvents = 'none';
        }

        // Trigger resize once modal dimensions settle
        setTimeout(() => {
            if (mindarThree && typeof mindarThree._resize === 'function') {
                mindarThree._resize();
            }
        }, 150);

        renderer.setAnimationLoop(() => {
            renderer.render(scene, camera);
        });

    } catch (err) {
        console.error('Failed to start MindAR:', err);
        cleanupMindARInstance();
        if (loadingEl) loadingEl.style.display = 'none';
        throw err;
    }
}

function cleanupMindARInstance() {
    if (!mindarThree) return;

    try {
        const stream = mindarThree.video && mindarThree.video.srcObject;
        if (stream) stream.getTracks().forEach(track => track.stop());
        if (mindarThree.video) mindarThree.video.remove();
        if (mindarThree.renderer) {
            mindarThree.renderer.setAnimationLoop(null);
            mindarThree.renderer.dispose();
            mindarThree.renderer.domElement.remove();
        }
        if (mindarThree.cssRenderer && mindarThree.cssRenderer.domElement) {
            mindarThree.cssRenderer.domElement.remove();
        }
        if (mindarThree.controller && typeof mindarThree.controller.stopProcessVideo === 'function') {
            mindarThree.controller.stopProcessVideo();
        }
    } catch (error) {
        console.warn('Error while cleaning up MindAR:', error);
    }
}

/**
 * Stop MindAR Face Tracking and clean up WebGL / camera streams
 */
export function stopARVirtualTryOn() {
    if (mindarThree) {
        try {
            cleanupMindARInstance();
        } catch (e) {
            console.warn('Error during MindAR stop:', e);
        }
        mindarThree = null;
    }
    currentLoadedModel = null;
    currentAnchor = null;
    currentOccluder = null;
    isARRunning = false;

    const loadingEl = document.getElementById('mindar-loading-indicator');
    if (loadingEl) loadingEl.style.display = 'none';
}

/**
 * Automatically calculates bounding box of any 3D glasses model and fits it to realistic face dimensions
 * @param {THREE.Object3D} gltfScene 
 * @param {number} targetFaceWidth - Target width in MindAR metric units (default 14.8 units)
 */
export function fitGlassesModelToFace(gltfScene, targetFaceWidth = 14.8) {
    gltfScene.position.set(0, 0, 0);
    gltfScene.rotation.set(0, 0, 0);
    gltfScene.scale.set(1, 1, 1);
    gltfScene.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(gltfScene);
    const size = new THREE.Vector3();
    box.getSize(size);

    let modelWidth = size.x;
    if (size.z > size.x && size.z > size.y) {
        modelWidth = size.z;
    }

    if (modelWidth > 0) {
        const scaleFactor = targetFaceWidth / modelWidth;
        gltfScene.scale.set(scaleFactor, scaleFactor, scaleFactor);
    }

    gltfScene.updateMatrixWorld(true);
    const scaledBox = new THREE.Box3().setFromObject(gltfScene);
    const center = new THREE.Vector3();
    scaledBox.getCenter(center);

    // Center on Landmark 168 (Nose bridge) with slight forward offset for nose pads and ear temples
    gltfScene.position.set(-center.x, -center.y - 0.25, 0.15);
}

// Attach to window for global access
window.startARVirtualTryOn = startARVirtualTryOn;
window.stopARVirtualTryOn = stopARVirtualTryOn;
window.isMindARRunning = () => isARRunning;
