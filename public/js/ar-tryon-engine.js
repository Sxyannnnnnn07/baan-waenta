// Baan Waenta - High-Performance Real-Time 3D/2D AR Try-On Engine
// Powered by Google MediaPipe Face Mesh & Three.js 6-DOF Pose Estimation
(function (window) {
    'use strict';

    let videoElement = null;
    let canvas2D = null;
    let ctx2D = null;
    let threeCanvas = null;
    let threeRenderer = null;
    let threeScene = null;
    let threeCamera = null;
    let current3DModel = null;
    let modelWrapperGroup = null;
    let headOccluder = null;
    let gltfLoader = null;

    let webcamStream = null;
    let faceMeshInstance = null;
    let isARRunning = false;
    let isDetecting = false;
    let isFaceMeshLoaded = false;
    let animFrameId = null;
    let detectionAnimFrameId = null;

    let currentProductData = null;
    let glasses2DImage = null;
    let is2DGlassesLoaded = false;

    // -------------------------------------------------------------
    // OneEuroFilter (Adaptive Low-Pass Filter for Silky-Smooth Tracking like Owndays)
    // -------------------------------------------------------------
    class OneEuroFilter {
        constructor(minCutoff = 0.85, beta = 0.015, dCutoff = 1.0) {
            this.minCutoff = minCutoff;
            this.beta = beta;
            this.dCutoff = dCutoff;
            this.x = null;
            this.dx = 0;
            this.lastTime = null;
        }
        filter(val, timestamp = performance.now()) {
            if (this.lastTime === null || this.x === null) {
                this.x = val;
                this.dx = 0;
                this.lastTime = timestamp;
                return val;
            }
            const dt = Math.max((timestamp - this.lastTime) / 1000, 0.001);
            this.lastTime = timestamp;
            const rate = 1 / dt;

            // Estimate movement velocity
            const dVal = (val - this.x) * rate;
            const alphaD = this.getAlpha(rate, this.dCutoff);
            this.dx = this.dx + alphaD * (dVal - this.dx);

            // Adaptive cutoff frequency based on movement speed
            const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
            const alpha = this.getAlpha(rate, cutoff);

            // Filtered value
            this.x = this.x + alpha * (val - this.x);
            return this.x;
        }
        getAlpha(rate, cutoff) {
            const tau = 1 / (2 * Math.PI * cutoff);
            const te = 1 / rate;
            return 1 / (1 + tau / te);
        }
        reset() {
            this.x = null;
            this.dx = 0;
            this.lastTime = null;
        }
    }

    class OneEuroFilterVector3 {
        constructor(minCutoff = 0.85, beta = 0.02, dCutoff = 1.0) {
            this.fx = new OneEuroFilter(minCutoff, beta, dCutoff);
            this.fy = new OneEuroFilter(minCutoff, beta, dCutoff);
            this.fz = new OneEuroFilter(minCutoff, beta, dCutoff);
        }
        filter(vec, timestamp = performance.now()) {
            return new THREE.Vector3(
                this.fx.filter(vec.x, timestamp),
                this.fy.filter(vec.y, timestamp),
                this.fz.filter(vec.z, timestamp)
            );
        }
        reset() {
            this.fx.reset();
            this.fy.reset();
            this.fz.reset();
        }
    }

    // Adaptive OneEuro smoothing state (Rock-solid stillness & zero-lag motion)
    let posFilter = new OneEuroFilterVector3(0.85, 0.02, 1.0);
    let scaleFilter = new OneEuroFilter(0.75, 0.015, 1.0);
    let smoothPos = null;
    let smoothQuat = null;
    let smoothScale = 1.0;

    /**
     * Dynamically loads an external script if not already present
     */
    function loadScriptAsync(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.crossOrigin = 'anonymous';
            script.onload = () => resolve();
            script.onerror = (e) => reject(e);
            document.head.appendChild(script);
        });
    }

    /**
     * Ensure Three.js, GLTFLoader, and MediaPipe FaceMesh dependencies are ready
     */
    async function ensureDependencies() {
        if (typeof window.THREE === 'undefined') {
            await loadScriptAsync('https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js');
        }
        if (typeof window.THREE !== 'undefined' && typeof window.THREE.GLTFLoader === 'undefined') {
            await loadScriptAsync('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js');
        }
        if (typeof window.FaceMesh === 'undefined') {
            await loadScriptAsync('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3/camera_utils.js');
            await loadScriptAsync('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/face_mesh.js');
        }
    }

    /**
     * Start 3D / 2D AR Virtual Try-On in the specified container
     * @param {HTMLElement} containerEl - DOM container element
     * @param {Object|string} productOrModelUrl - Product object or 3D model URL
     */
    async function startARVirtualTryOn(containerEl, productOrModelUrl) {
        if (isARRunning) {
            stopARVirtualTryOn();
        }

        if (!containerEl) {
            throw new Error('Container element is required for AR Virtual Try-On');
        }

        const loadingEl = document.getElementById('mindar-loading-indicator');
        if (loadingEl) loadingEl.style.display = 'block';

        // Parse product data
        if (typeof productOrModelUrl === 'string') {
            currentProductData = {
                name: 'แว่นตา 3D',
                model_3d_url: productOrModelUrl,
                scale_x: 1.0,
                scale_y: 1.0,
                scale_z: 1.0,
                offset_y: 0.0
            };
        } else if (productOrModelUrl && typeof productOrModelUrl === 'object') {
            currentProductData = {
                ...productOrModelUrl,
                model_3d_url: productOrModelUrl.model_3d_url || productOrModelUrl.model3d || null,
                scale_x: parseFloat(productOrModelUrl.scale_x) || 1.0,
                scale_y: parseFloat(productOrModelUrl.scale_y) || 1.0,
                scale_z: parseFloat(productOrModelUrl.scale_z) || 1.0,
                offset_y: parseFloat(productOrModelUrl.offset_y) || 0.0
            };
        } else {
            currentProductData = {
                name: 'Prada Vintage Star',
                model_3d_url: '/assets/models/prada_vintage.glb',
                scale_x: 1.0,
                scale_y: 1.0,
                scale_z: 1.0,
                offset_y: 0.0
            };
        }

        try {
            // 1. Ensure all scripts are present
            await ensureDependencies();

            // 2. Request Camera Stream directly
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'user',
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    },
                    audio: false
                });
            } catch (camErr) {
                console.warn('Ideal camera constraint failed, falling back to standard video stream:', camErr);
                stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false
                });
            }
            webcamStream = stream;

            // 3. Setup Video Element
            let video = containerEl.querySelector('video.ar-webcam-stream');
            if (!video) {
                video = document.createElement('video');
                video.className = 'ar-webcam-stream';
                video.setAttribute('playsinline', '');
                video.setAttribute('autoplay', '');
                video.muted = true;
                video.style.position = 'absolute';
                video.style.top = '0';
                video.style.left = '0';
                video.style.width = '100%';
                video.style.height = '100%';
                video.style.objectFit = 'cover';
                video.style.transform = 'scaleX(-1)';
                video.style.zIndex = '1';
                containerEl.appendChild(video);
            }
            videoElement = video;
            videoElement.srcObject = webcamStream;
            await videoElement.play();

            // 4. Setup 2D Canvas Layer (for 2D fallback)
            let c2d = containerEl.querySelector('canvas.ar-2d-layer');
            if (!c2d) {
                c2d = document.createElement('canvas');
                c2d.className = 'ar-2d-layer';
                c2d.style.position = 'absolute';
                c2d.style.top = '0';
                c2d.style.left = '0';
                c2d.style.width = '100%';
                c2d.style.height = '100%';
                c2d.style.pointerEvents = 'none';
                c2d.style.transform = 'scaleX(-1)';
                c2d.style.zIndex = '2';
                containerEl.appendChild(c2d);
            }
            canvas2D = c2d;
            ctx2D = canvas2D.getContext('2d');

            // 5. Setup Three.js WebGL Layer
            setupThreeJSRenderer(containerEl);

            // 6. Setup Tracking HUD Badge
            setupTrackingHUD(containerEl);

            // 7. Load 3D Model or 2D Image
            if (currentProductData.model_3d_url) {
                await loadGlasses3DModel(currentProductData.model_3d_url);
            } else if (currentProductData.tryon_image_url || currentProductData.image_url) {
                loadGlasses2DImage(currentProductData.tryon_image_url || currentProductData.image_url);
            }

            // 8. Initialize MediaPipe Face Mesh
            await initMediaPipeFaceMesh();

            isARRunning = true;
            updateHUDStatus(false); // Searching for face

            if (loadingEl) loadingEl.style.display = 'none';

            // 9. Start detection loop
            isDetecting = true;
            runFaceMeshDetectionLoop();

            // 10. Start Three.js animation render loop
            animateThreeJSScene();

            // Resize handler
            window.addEventListener('resize', handleARResize);
            setTimeout(handleARResize, 100);

        } catch (err) {
            console.error('Failed to start AR Virtual Try-On:', err);
            if (loadingEl) loadingEl.style.display = 'none';
            stopARVirtualTryOn();
            throw err;
        }
    }

    /**
     * Initializes Three.js Scene, Camera, Lights, and WebGLRenderer
     */
    function setupThreeJSRenderer(containerEl) {
        if (typeof THREE === 'undefined') {
            console.error('Three.js library is not loaded');
            return;
        }

        const oldCanvas = containerEl.querySelector('canvas.ar-three-layer');
        if (oldCanvas) oldCanvas.remove();

        threeScene = new THREE.Scene();

        const width = containerEl.clientWidth || 640;
        const height = containerEl.clientHeight || 480;
        const aspect = width / height;

        threeCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
        threeCamera.position.set(0, 0, 100);

        threeRenderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true
        });
        threeRenderer.setSize(width, height);
        threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

        if (typeof THREE.sRGBEncoding !== 'undefined') {
            threeRenderer.outputEncoding = THREE.sRGBEncoding;
        }
        if (typeof THREE.ACESFilmicToneMapping !== 'undefined') {
            threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
            threeRenderer.toneMappingExposure = 1.15;
        }

        threeCanvas = threeRenderer.domElement;
        threeCanvas.className = 'ar-three-layer';
        threeCanvas.style.position = 'absolute';
        threeCanvas.style.top = '0';
        threeCanvas.style.left = '0';
        threeCanvas.style.width = '100%';
        threeCanvas.style.height = '100%';
        threeCanvas.style.pointerEvents = 'none';
        threeCanvas.style.transform = 'scaleX(-1)';
        threeCanvas.style.zIndex = '3';

        containerEl.appendChild(threeCanvas);

        // Lighting for eyewear materials
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
        threeScene.add(ambientLight);

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
        keyLight.position.set(0, 25, 30);
        threeScene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xddeeff, 1.0);
        fillLight.position.set(-20, -10, 20);
        threeScene.add(fillLight);

        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 0.9);
        hemiLight.position.set(0, 30, 0);
        threeScene.add(hemiLight);

        // Anatomical Head Occluder (Composite depth mask to hide temples in front view and behind head like Owndays)
        const occluderMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
        headOccluder = new THREE.Group();
        headOccluder.renderOrder = 0;

        // 1. Temporal & Cranial Block (covers from temples backwards past ears)
        // Spans X = [-0.43, +0.43], Depth = [-0.05 to -1.15]
        const boxGeo = new THREE.BoxGeometry(0.86, 1.25, 1.10);
        const boxMesh = new THREE.Mesh(boxGeo, occluderMat);
        boxMesh.position.set(0, -0.06, -0.60);
        headOccluder.add(boxMesh);

        // 2. Cranial Cylinder (smooth curvature along sides of skull & temples)
        const craniumGeo = new THREE.CylinderGeometry(0.43, 0.43, 1.25, 32);
        const craniumMesh = new THREE.Mesh(craniumGeo, occluderMat);
        craniumMesh.position.set(0, -0.06, -0.60);
        headOccluder.add(craniumMesh);

        // 3. Back-Skull Sphere
        const backSkullGeo = new THREE.SphereGeometry(0.45, 24, 24);
        const backSkullMesh = new THREE.Mesh(backSkullGeo, occluderMat);
        backSkullMesh.position.set(0, 0, -0.65);
        headOccluder.add(backSkullMesh);

        headOccluder.visible = false;
        threeScene.add(headOccluder);
    }

    /**
     * Loads and auto-centers/normalizes 3D GLB model
     */
    async function loadGlasses3DModel(modelUrl) {
        if (!threeScene) return;

        if (current3DModel) {
            threeScene.remove(modelWrapperGroup || current3DModel);
            current3DModel = null;
            modelWrapperGroup = null;
        }

        if (typeof THREE.GLTFLoader === 'undefined') {
            console.warn('THREE.GLTFLoader is not available, skipping 3D model load');
            return;
        }

        if (!gltfLoader) {
            gltfLoader = new THREE.GLTFLoader();
        }

        return new Promise((resolve) => {
            gltfLoader.load(
                modelUrl,
                (gltf) => {
                    current3DModel = gltf.scene;

                    current3DModel.position.set(0, 0, 0);
                    current3DModel.rotation.set(0, 0, 0);
                    current3DModel.scale.set(1, 1, 1);
                    current3DModel.updateMatrixWorld(true);

                    const box = new THREE.Box3().setFromObject(current3DModel);
                    const size = new THREE.Vector3();
                    box.getSize(size);
                    const center = new THREE.Vector3();
                    box.getCenter(center);

                    // Normalize raw model width to exactly 1.0 unit
                    const rawWidth = size.x > 0 ? size.x : 1.0;
                    const normScale = 1.0 / rawWidth;
                    current3DModel.scale.set(normScale, normScale, normScale);

                    // Center horizontally (X), align optical center (Y), and position the nose pads
                    // flush at origin (Z = 0) so all head rotations (pitch, yaw, roll) pivot naturally on the nose
                    const frontZ = box.max.z; // In eyewear models, max.z is the front-most surface of lenses
                    current3DModel.position.set(
                        -center.x * normScale,
                        -center.y * normScale,
                        -(frontZ - size.z * 0.05) * normScale
                    );

                    // Wrap in parent group for 6-DOF transform control
                    modelWrapperGroup = new THREE.Group();
                    modelWrapperGroup.add(current3DModel);
                    modelWrapperGroup.renderOrder = 1;
                    modelWrapperGroup.visible = false;

                    threeScene.add(modelWrapperGroup);
                    resolve();
                },
                undefined,
                (err) => {
                    console.error('Error loading 3D glasses model:', err);
                    resolve();
                }
            );
        });
    }

    /**
     * Loads 2D glasses image fallback
     */
    function loadGlasses2DImage(imageUrl) {
        glasses2DImage = new Image();
        glasses2DImage.crossOrigin = 'anonymous';
        glasses2DImage.onload = () => {
            is2DGlassesLoaded = true;
        };
        glasses2DImage.src = imageUrl;
    }

    /**
     * Setup tracking status HUD badge
     */
    function setupTrackingHUD(containerEl) {
        let hud = containerEl.querySelector('#ar-tracking-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'ar-tracking-hud';
            hud.style.position = 'absolute';
            hud.style.bottom = '16px';
            hud.style.left = '50%';
            hud.style.transform = 'translateX(-50%)';
            hud.style.background = 'rgba(15, 23, 42, 0.82)';
            hud.style.backdropFilter = 'blur(8px)';
            hud.style.border = '1px solid rgba(255, 255, 255, 0.15)';
            hud.style.borderRadius = '24px';
            hud.style.padding = '6px 14px';
            hud.style.fontSize = '0.78rem';
            hud.style.fontWeight = '500';
            hud.style.color = '#fff';
            hud.style.zIndex = '15';
            hud.style.display = 'flex';
            hud.style.alignItems = 'center';
            hud.style.gap = '8px';
            hud.style.pointerEvents = 'none';
            hud.style.boxShadow = '0 4px 14px rgba(0,0,0,0.3)';
            hud.style.transition = 'all 0.3s ease';
            containerEl.appendChild(hud);
        }
    }

    /**
     * Update tracking HUD badge state
     */
    function updateHUDStatus(isFaceDetected) {
        const hud = document.getElementById('ar-tracking-hud');
        if (!hud) return;

        if (isFaceDetected) {
            hud.innerHTML = `
                <span style="width: 8px; height: 8px; border-radius: 50%; background: #48bb78; box-shadow: 0 0 8px #48bb78; display: inline-block;"></span>
                <span>ตรวจจับใบหน้าเรียบร้อย (60 FPS)</span>
            `;
            hud.style.borderColor = 'rgba(72, 187, 120, 0.4)';
        } else {
            hud.innerHTML = `
                <span style="width: 8px; height: 8px; border-radius: 50%; background: #ecc94b; display: inline-block;"></span>
                <span>กำลังสแกนหาใบหน้าของคุณ...</span>
            `;
            hud.style.borderColor = 'rgba(236, 201, 75, 0.3)';
        }
    }

    /**
     * Initialize MediaPipe Face Mesh instance
     */
    async function initMediaPipeFaceMesh() {
        const FaceMeshClass = window.FaceMesh;
        if (!FaceMeshClass) {
            throw new Error('Google MediaPipe FaceMesh class is not available');
        }

        faceMeshInstance = new FaceMeshClass({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`
        });

        faceMeshInstance.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        faceMeshInstance.onResults(onFaceMeshResults);
        isFaceMeshLoaded = true;
    }

    /**
     * Continuous Face Detection Loop
     */
    async function runFaceMeshDetectionLoop() {
        if (!isARRunning || !isDetecting || !faceMeshInstance || !videoElement) {
            return;
        }

        if (videoElement.readyState >= 2) {
            try {
                await faceMeshInstance.send({ image: videoElement });
            } catch (e) {
                console.warn('FaceMesh frame estimation warning:', e);
            }
        }

        detectionAnimFrameId = requestAnimationFrame(runFaceMeshDetectionLoop);
    }

    /**
     * Handle MediaPipe Face Mesh Results
     */
    function onFaceMeshResults(results) {
        if (!isARRunning || !videoElement) return;

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            updateHUDStatus(true);
            processFacePoseAndRender(landmarks);
        } else {
            updateHUDStatus(false);
            if (modelWrapperGroup) modelWrapperGroup.visible = false;
            if (headOccluder) headOccluder.visible = false;
            if (ctx2D && canvas2D) ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height);
        }
    }

    /**
     * 6-DOF Pose Estimation & Coordinate Mapping
     */
    function processFacePoseAndRender(landmarks) {
        const videoWidth = videoElement.videoWidth || 640;
        const videoHeight = videoElement.videoHeight || 480;
        const container = videoElement.parentElement;
        if (!container) return;

        const boxWidth = container.clientWidth || 640;
        const boxHeight = container.clientHeight || 480;

        // Container object-fit: cover mapping
        const s = Math.max(boxWidth / videoWidth, boxHeight / videoHeight);
        const rendW = videoWidth * s;
        const rendH = videoHeight * s;
        const dx = (boxWidth - rendW) / 2;
        const dy = (boxHeight - rendH) / 2;

        const toScreen = (pt) => ({
            x: pt.x * rendW + dx,
            y: pt.y * rendH + dy,
            z: (pt.z || 0) * rendW
        });

        // Key Facial Landmarks (Rigid Skull Bones for Pitch/Yaw/Roll Stability)
        // 1. Nose Bridge Anchor (Landmark 6 = nasion, where the bridge of eyewear rests)
        const pNoseBridge = landmarks[6] || landmarks[197] || landmarks[168] || { x: 0.5, y: 0.38, z: 0 };
        // 2. Base of Nose / Subnasale (Landmark 2 = philtrum base, forming a rigid vertical midline without forehead tilt bias)
        const pNoseBase = landmarks[2] || landmarks[164] || landmarks[1] || { x: 0.5, y: 0.52, z: 0 };

        let leftPupil = landmarks[468];
        let rightPupil = landmarks[473];
        if (!leftPupil || !rightPupil) {
            const leftOuter = landmarks[33] || landmarks[130];
            const leftInner = landmarks[133];
            const rightInner = landmarks[362];
            const rightOuter = landmarks[263] || landmarks[359];

            leftPupil = leftOuter && leftInner 
                ? { x: (leftOuter.x + leftInner.x) / 2, y: (leftOuter.y + leftInner.y) / 2, z: ((leftOuter.z || 0) + (leftInner.z || 0)) / 2 }
                : landmarks[159] || { x: 0.4, y: 0.4, z: 0 };

            rightPupil = rightInner && rightOuter
                ? { x: (rightInner.x + rightOuter.x) / 2, y: (rightInner.y + rightOuter.y) / 2, z: ((rightInner.z || 0) + (rightOuter.z || 0)) / 2 }
                : landmarks[386] || { x: 0.6, y: 0.4, z: 0 };
        }

        const sLeft = toScreen(leftPupil);
        const sRight = toScreen(rightPupil);
        const sBridge = toScreen(pNoseBridge);
        const sNoseBase = toScreen(pNoseBase);

        // Three.js World Dimensions at focus plane (Z = 0)
        if (threeCamera && threeScene && modelWrapperGroup) {
            modelWrapperGroup.visible = true;

            const aspect = boxWidth / boxHeight;
            const fovRad = threeCamera.fov * (Math.PI / 180);
            const heightAtZero = 2 * threeCamera.position.z * Math.tan(fovRad / 2);
            const widthAtZero = heightAtZero * aspect;

            // Convert points to Three.js World Space (where +Y is UP, +X is Right, +Z is Towards Viewer)
            const toWorld = (sPt, rawZ) => {
                const nx = sPt.x / boxWidth - 0.5;
                const ny = -(sPt.y / boxHeight - 0.5); // Invert Y so UP is positive
                return new THREE.Vector3(
                    nx * widthAtZero,
                    ny * heightAtZero,
                    -(rawZ || 0) * widthAtZero
                );
            };

            const wLeft = toWorld(sLeft, leftPupil.z);
            const wRight = toWorld(sRight, rightPupil.z);
            const wBridge = toWorld(sBridge, pNoseBridge.z);
            const wNoseBase = toWorld(sNoseBase, pNoseBase.z);

            // 6-DOF Orthogonal Rotation Basis from Rigid Facial Anatomy:
            // 1. Horizontal Eye Axis (Left to Right)
            const vX = new THREE.Vector3().subVectors(wRight, wLeft).normalize();
            // 2. Rigid Nasal Midline (Nose Base UP to Nose Bridge)
            // Eliminates artificial forehead pitch bias and ensures perfect pitch tracking on look-down
            const vUp = new THREE.Vector3().subVectors(wBridge, wNoseBase).normalize();
            // 3. True Forward Normal (facing viewer)
            const vZ = new THREE.Vector3().crossVectors(vX, vUp).normalize();
            // 4. True Orthogonal Up Vector
            const vY = new THREE.Vector3().crossVectors(vZ, vX).normalize();
            // 5. Strictly re-orthogonalize vX
            vX.crossVectors(vY, vZ).normalize();

            const rotMatrix = new THREE.Matrix4();
            rotMatrix.makeBasis(vX, vY, vZ);
            const targetQuat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

            // 1. Adaptive Slerp for Rotation (Zero jitter when still, zero latency on head turns)
            if (!smoothQuat) {
                smoothQuat = targetQuat.clone();
            } else {
                const dot = Math.min(Math.max(smoothQuat.dot(targetQuat), -1), 1);
                const angleDiff = 2 * Math.acos(Math.abs(dot)); // angular distance in radians
                // When stationary (< 0.02 rad / 1 deg), slerpAlpha is 0.12 (eliminates landmark jitter completely)
                // When moving fast, slerpAlpha scales up to 0.75 for instant real-time response
                const slerpAlpha = THREE.MathUtils.clamp(0.12 + angleDiff * 2.2, 0.12, 0.75);
                smoothQuat.slerp(targetQuat, slerpAlpha);
            }
            modelWrapperGroup.quaternion.copy(smoothQuat);

            // Responsive Scaling (IPD scaled to 2.15x for tailored adult fit)
            const eyeDistWorld = wLeft.distanceTo(wRight);
            const modelScaleMult = currentProductData.scale_x || 1.0;
            const targetGlassesWidth = eyeDistWorld * 2.15 * modelScaleMult;

            // Eye Center (at pupil level)
            const wEyeCenter = new THREE.Vector3().addVectors(wLeft, wRight).multiplyScalar(0.5);

            // Anchor Position:
            // Centered horizontally between eyes (wEyeCenter.x)
            // Vertically aligned so lenses sit directly over pupils and nose pads rest on the bridge
            const targetPos = new THREE.Vector3(
                wEyeCenter.x,
                wBridge.y * 0.40 + wEyeCenter.y * 0.60,
                wBridge.z
            );

            // Snug forward offset (1.5% of width) so lenses and nose pads sit right on nose bridge skin
            const forwardOffset = vZ.clone().multiplyScalar(targetGlassesWidth * 0.015);
            targetPos.add(forwardOffset);

            // Product database manual Y offset if provided
            if (currentProductData.offset_y) {
                targetPos.add(vY.clone().multiplyScalar(currentProductData.offset_y * heightAtZero));
            }

            // 2. OneEuroFilter for Position (Silky smooth, eliminates webcam noise while keeping fast motion snappy)
            const now = performance.now();
            if (!smoothPos) {
                smoothPos = targetPos.clone();
                posFilter.reset();
                posFilter.filter(targetPos, now);
            } else {
                smoothPos = posFilter.filter(targetPos, now);
            }
            modelWrapperGroup.position.copy(smoothPos);

            // 3. OneEuroFilter for Scale (Prevents breathing / scale jitter)
            if (!smoothScale) {
                smoothScale = targetGlassesWidth;
                scaleFilter.reset();
                scaleFilter.filter(targetGlassesWidth, now);
            } else {
                smoothScale = scaleFilter.filter(targetGlassesWidth, now);
            }
            modelWrapperGroup.scale.set(smoothScale, smoothScale, smoothScale);

            // 4. Head Occluder Mask (Composite depth mask to hide temples in front view & behind head like Owndays)
            if (headOccluder) {
                headOccluder.position.copy(smoothPos);
                headOccluder.quaternion.copy(smoothQuat);
                headOccluder.scale.set(smoothScale, smoothScale, smoothScale);
                headOccluder.visible = true;
            }
        } else if (is2DGlassesLoaded && glasses2DImage && ctx2D && canvas2D) {
            // 2D Glasses Overlay Fallback
            ctx2D.clearRect(0, 0, canvas2D.width, canvas2D.height);

            const dxEyes = sRight.x - sLeft.x;
            const dyEyes = sRight.y - sLeft.y;
            const eyeDist = Math.hypot(dxEyes, dyEyes);
            const angle = Math.atan2(dyEyes, dxEyes);

            const sEyeCenter = {
                x: (sLeft.x + sRight.x) / 2,
                y: (sLeft.y + sRight.y) / 2
            };

            const glassesWidth = eyeDist * 2.10 * (currentProductData.scale_x || 1.0);
            const aspect = glasses2DImage.naturalWidth / (glasses2DImage.naturalHeight || 1);
            const glassesHeight = glassesWidth / aspect;

            ctx2D.save();
            ctx2D.translate(sEyeCenter.x, sEyeCenter.y);
            ctx2D.rotate(angle);
            ctx2D.drawImage(glasses2DImage, -glassesWidth / 2, -glassesHeight / 2, glassesWidth, glassesHeight);
            ctx2D.restore();
        }
    }

    /**
     * Three.js Animation Render Loop
     */
    function animateThreeJSScene() {
        if (!isARRunning) return;

        if (threeRenderer && threeScene && threeCamera) {
            threeRenderer.render(threeScene, threeCamera);
        }

        animFrameId = requestAnimationFrame(animateThreeJSScene);
    }

    /**
     * Handles window and container resizing
     */
    function handleARResize() {
        if (!videoElement || !videoElement.parentElement) return;

        const container = videoElement.parentElement;
        const width = container.clientWidth;
        const height = container.clientHeight;

        if (canvas2D) {
            canvas2D.width = width;
            canvas2D.height = height;
        }

        if (threeRenderer && threeCamera) {
            threeRenderer.setSize(width, height);
            threeCamera.aspect = width / height;
            threeCamera.updateProjectionMatrix();
        }
    }

    /**
     * Stop AR Virtual Try-On and clean up all camera streams, listeners, and WebGL buffers
     */
    function stopARVirtualTryOn() {
        isARRunning = false;
        isDetecting = false;

        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }

        if (detectionAnimFrameId) {
            cancelAnimationFrame(detectionAnimFrameId);
            detectionAnimFrameId = null;
        }

        window.removeEventListener('resize', handleARResize);

        // Stop webcam tracks
        if (webcamStream) {
            try {
                webcamStream.getTracks().forEach(track => track.stop());
            } catch (e) {}
            webcamStream = null;
        }

        if (videoElement) {
            videoElement.srcObject = null;
            videoElement.remove();
            videoElement = null;
        }

        if (canvas2D) {
            canvas2D.remove();
            canvas2D = null;
            ctx2D = null;
        }

        if (threeRenderer) {
            try {
                threeRenderer.dispose();
                if (threeRenderer.domElement) {
                    threeRenderer.domElement.remove();
                }
            } catch (e) {}
            threeRenderer = null;
            threeCanvas = null;
        }

        threeScene = null;
        threeCamera = null;
        current3DModel = null;
        modelWrapperGroup = null;
        headOccluder = null;
        smoothPos = null;
        smoothQuat = null;
        smoothScale = 1.0;
        posFilter.reset();
        scaleFilter.reset();

        const hud = document.getElementById('ar-tracking-hud');
        if (hud) hud.remove();

        const loadingEl = document.getElementById('mindar-loading-indicator');
        if (loadingEl) loadingEl.style.display = 'none';
    }

    /**
     * Reset AR view and smoothing filters
     */
    function resetARView() {
        smoothPos = null;
        smoothQuat = null;
        smoothScale = 1.0;
        posFilter.reset();
        scaleFilter.reset();
    }

    // Attach to global window object
    window.startARVirtualTryOn = startARVirtualTryOn;
    window.stopARVirtualTryOn = stopARVirtualTryOn;
    window.resetARView = resetARView;
    window.isMindARRunning = () => isARRunning;
    window.isARVirtualTryOnRunning = () => isARRunning;

})(window);
