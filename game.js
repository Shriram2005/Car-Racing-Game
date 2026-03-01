/* ============================================
   VELOCITY: OPEN WORLD RACING - GAME ENGINE
   ============================================ */

// ==========================================
// GAME CONFIGURATION
// ==========================================
const CONFIG = {
    WORLD_SIZE: 2000,
    ROAD_WIDTH: 16,
    CAR_COLORS: {
        sport: 0xff2e63,
        muscle: 0x3a7bd5,
        super: 0x845ec2
    },
    AI_COLORS: [0x00d2ff, 0xffd700, 0x00ff88],
    TRACK_SEGMENTS: 24,
    BUILDING_COUNT: 120,
    TREE_COUNT: 200,
    GRASS_PATCHES: 80,
    LAMP_COUNT: 60,
};

// ==========================================
// GAME STATE
// ==========================================
const GameState = {
    LOADING: 'loading',
    MENU: 'menu',
    GARAGE: 'garage',
    SETTINGS: 'settings',
    COUNTDOWN: 'countdown',
    RACING: 'racing',
    FREE_ROAM: 'free_roam',
    PAUSED: 'paused',
    RESULTS: 'results'
};

let state = GameState.LOADING;
let selectedCar = 'sport';
let difficulty = 'medium';
let numLaps = 3;
let weatherType = 'clear';
let qualitySetting = 'high';
let gameMode = 'race'; // 'race' or 'free_roam'

// ==========================================
// THREE.JS SETUP
// ==========================================
let scene, camera, renderer, clock;
let playerCar, aiCars = [];
let track = { waypoints: [], innerPoints: [], outerPoints: [] };
let world = { buildings: [], trees: [], lamps: [], ground: null };
let particles = { dust: [], exhaust: [] };
let weatherParticles = [];
let sunLight, ambientLight, hemisphereLight;
let cameraMode = 0; // 0: chase, 1: far chase, 2: hood, 3: top
let cameraModes = ['Chase', 'Far Chase', 'Hood', 'Top Down'];

// Race state
let raceTime = 0;
let lapTimes = [];
let bestLap = Infinity;
let lastLap = 0;
let currentLap = 1;
let topSpeed = 0;
let raceStarted = false;
let raceFinished = false;
let isPaused = false;

// Input
const keys = {};

// ==========================================
// INITIALIZATION
// ==========================================
function init() {
    // Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.0008);

    // Camera
    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 3000);
    camera.position.set(0, 15, 30);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputEncoding = THREE.sRGBEncoding;
    document.getElementById('game-container').appendChild(renderer.domElement);

    clock = new THREE.Clock();

    // Lighting
    setupLighting();

    // World
    createWorld();

    // Track
    generateTrack();

    // Player car
    playerCar = createCar(CONFIG.CAR_COLORS[selectedCar], true);
    scene.add(playerCar.group);

    // AI cars
    createAICars();

    // Input
    setupInput();

    // Resize
    window.addEventListener('resize', onResize);

    // Start loading simulation
    simulateLoading();
}

function setupLighting() {
    // Ambient
    ambientLight = new THREE.AmbientLight(0x404060, 0.4);
    scene.add(ambientLight);

    // Hemisphere
    hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x362d1e, 0.6);
    scene.add(hemisphereLight);

    // Sun
    sunLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
    sunLight.position.set(200, 300, 100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 800;
    sunLight.shadow.camera.left = -200;
    sunLight.shadow.camera.right = 200;
    sunLight.shadow.camera.top = 200;
    sunLight.shadow.camera.bottom = -200;
    sunLight.shadow.bias = -0.001;
    scene.add(sunLight);

    // Additional fill light
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-100, 50, -100);
    scene.add(fillLight);
}

// ==========================================
// WORLD CREATION
// ==========================================
function createWorld() {
    // Sky gradient
    const skyGeo = new THREE.SphereGeometry(1500, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
        uniforms: {
            topColor: { value: new THREE.Color(0x0077ff) },
            bottomColor: { value: new THREE.Color(0xaaddff) },
            offset: { value: 33 },
            exponent: { value: 0.6 }
        },
        vertexShader: `
            varying vec3 vWorldPosition;
            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 topColor;
            uniform vec3 bottomColor;
            uniform float offset;
            uniform float exponent;
            varying vec3 vWorldPosition;
            void main() {
                float h = normalize(vWorldPosition + offset).y;
                gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
            }
        `,
        side: THREE.BackSide,
        depthWrite: false
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);

    // Ground — procedural canvas texture for realistic grass/dirt
    const groundGeo = new THREE.PlaneGeometry(CONFIG.WORLD_SIZE, CONFIG.WORLD_SIZE, 1, 1);
    const groundTex = buildGroundTexture();
    const groundMat = new THREE.MeshStandardMaterial({
        map: groundTex,
        roughness: 0.97,
        metalness: 0.0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    world.ground = ground;

    // Create detailed ground texture patches
    createGrassPatches();

    // Buildings
    createBuildings();

    // Trees
    createTrees();

    // Decorations
    createDecorations();
}

// ------------------------------------
// Procedural ground texture
// ------------------------------------
function buildGroundTexture() {
    const SIZE = 1024;
    const canvas = document.createElement('canvas');
    canvas.width  = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');

    // ---- base gradient: darker in centre, lighter edges ----
    const baseGrad = ctx.createRadialGradient(SIZE/2, SIZE/2, 0, SIZE/2, SIZE/2, SIZE * 0.72);
    baseGrad.addColorStop(0,   '#3a7a35');
    baseGrad.addColorStop(0.4, '#4a8c42');
    baseGrad.addColorStop(0.8, '#3e7838');
    baseGrad.addColorStop(1,   '#2e6228');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // ---- multi-tone grass patches ----
    const grassTones = [
        'rgba(80,140,55,0.35)',
        'rgba(55,110,35,0.30)',
        'rgba(100,160,65,0.28)',
        'rgba(45,95,30,0.25)',
        'rgba(120,175,70,0.22)',
        'rgba(35,80,25,0.28)',
    ];
    for (let i = 0; i < 1400; i++) {
        const rx = Math.random() * SIZE;
        const ry = Math.random() * SIZE;
        const rr = 6  + Math.random() * 55;
        ctx.beginPath();
        ctx.ellipse(rx, ry, rr, rr * (0.4 + Math.random() * 0.8), Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.fillStyle = grassTones[Math.floor(Math.random() * grassTones.length)];
        ctx.fill();
    }

    // ---- dirt / bare-earth patches ----
    const dirtTones = [
        'rgba(140,105,65,0.22)',
        'rgba(160,120,75,0.18)',
        'rgba(120,90,55,0.25)',
        'rgba(100,75,45,0.20)',
    ];
    for (let i = 0; i < 280; i++) {
        const rx = Math.random() * SIZE;
        const ry = Math.random() * SIZE;
        const rr = 8 + Math.random() * 50;
        ctx.beginPath();
        ctx.ellipse(rx, ry, rr, rr * (0.3 + Math.random() * 0.7), Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.fillStyle = dirtTones[Math.floor(Math.random() * dirtTones.length)];
        ctx.fill();
    }

    // ---- tiny pebble/grain noise ----
    const imgData = ctx.getImageData(0, 0, SIZE, SIZE);
    const d = imgData.data;
    for (let p = 0; p < d.length; p += 4) {
        const n = (Math.random() - 0.5) * 18;
        d[p]     = Math.min(255, Math.max(0, d[p]     + n));
        d[p + 1] = Math.min(255, Math.max(0, d[p + 1] + n * 0.9));
        d[p + 2] = Math.min(255, Math.max(0, d[p + 2] + n * 0.5));
    }
    ctx.putImageData(imgData, 0, 0);

    // ---- subtle vignette ----
    const vign = ctx.createRadialGradient(SIZE/2, SIZE/2, SIZE * 0.3, SIZE/2, SIZE/2, SIZE * 0.85);
    vign.addColorStop(0,   'rgba(0,0,0,0)');
    vign.addColorStop(1,   'rgba(0,0,0,0.22)');
    ctx.fillStyle = vign;
    ctx.fillRect(0, 0, SIZE, SIZE);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(12, 12);   // tile across the world
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
}

function createGrassPatches() {
    for (let i = 0; i < CONFIG.GRASS_PATCHES; i++) {
        const geo = new THREE.CircleGeometry(15 + Math.random() * 25, 8);
        const shade = 0.6 + Math.random() * 0.4;
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0.15 * shade, 0.45 * shade, 0.12 * shade),
            roughness: 1,
            transparent: true,
            opacity: 0.7
        });
        const patch = new THREE.Mesh(geo, mat);
        patch.rotation.x = -Math.PI / 2;
        patch.position.set(
            (Math.random() - 0.5) * CONFIG.WORLD_SIZE * 0.8,
            0.05,
            (Math.random() - 0.5) * CONFIG.WORLD_SIZE * 0.8
        );
        scene.add(patch);
    }
}

function createBuildings() {
    // Palette: glass towers, concrete blocks, brick mid-rises, industrial
    const palettes = [
        { wall: 0x4a7a9b, rough: 0.15, metal: 0.7, glass: true  },  // blue glass tower
        { wall: 0x2a6b8a, rough: 0.12, metal: 0.75, glass: true  }, // teal glass
        { wall: 0x8a8a8a, rough: 0.85, metal: 0.05, glass: false }, // concrete
        { wall: 0x7a6a5a, rough: 0.9,  metal: 0.0,  glass: false }, // dirty concrete
        { wall: 0x9b5a3a, rough: 0.92, metal: 0.0,  glass: false }, // brick
        { wall: 0xb8a898, rough: 0.88, metal: 0.02, glass: false }, // sandstone
        { wall: 0x556b7a, rough: 0.6,  metal: 0.4,  glass: false }, // metal cladding
    ];

    for (let i = 0; i < CONFIG.BUILDING_COUNT; i++) {
        const pal = palettes[Math.floor(Math.random() * palettes.length)];
        const w = 9 + Math.random() * 22;
        const h = 18 + Math.random() * 70;
        const d = 9 + Math.random() * 22;
        const group = new THREE.Group();

        const wallMat = new THREE.MeshStandardMaterial({
            color: pal.wall,
            roughness: pal.rough,
            metalness: pal.metal,
        });

        // ---- Main tower ----
        const mainGeo = new THREE.BoxGeometry(w, h, d);
        const main = new THREE.Mesh(mainGeo, wallMat);
        main.castShadow = true;
        main.receiveShadow = true;
        group.add(main);

        // ---- Stepped upper section (tall buildings) ----
        if (h > 40 && Math.random() > 0.4) {
            const s1h = h * 0.5;
            const s1 = new THREE.Mesh(
                new THREE.BoxGeometry(w * 0.7, s1h, d * 0.7),
                wallMat
            );
            s1.position.y = h / 2 + s1h / 2 - 2;
            s1.castShadow = true;
            group.add(s1);

            if (Math.random() > 0.5) {
                const s2h = h * 0.3;
                const s2 = new THREE.Mesh(
                    new THREE.BoxGeometry(w * 0.45, s2h, d * 0.45),
                    wallMat
                );
                s2.position.y = h / 2 + s1h + s2h / 2 - 4;
                s2.castShadow = true;
                group.add(s2);
            }
        }

        // ---- Base plinth ----
        const plinthMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7, metalness: 0.2 });
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 1.5, 2, d + 1.5), plinthMat);
        plinth.position.y = -h / 2 + 1;
        plinth.castShadow = true;
        group.add(plinth);

        // ---- Windows grid on all 4 sides ----
        const litMat  = new THREE.MeshStandardMaterial({ color: 0xfff5cc, emissive: 0xfff5cc, emissiveIntensity: pal.glass ? 0.6 : 0.25, roughness: 0.05, metalness: 0.9 });
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a2233, emissive: 0x000820, emissiveIntensity: 0.1, roughness: 0.05, metalness: 0.9 });

        const winW = 1.6, winH = 2.2;
        const colGapW = 3.2, rowGap = 4.0;
        const sides = [
            { axis: 'z', sign:  1, faceW: w, faceH: h, faceD: d },
            { axis: 'z', sign: -1, faceW: w, faceH: h, faceD: d },
            { axis: 'x', sign:  1, faceW: d, faceH: h, faceD: w },
            { axis: 'x', sign: -1, faceW: d, faceH: h, faceD: w },
        ];

        sides.forEach(side => {
            const cols = Math.max(1, Math.floor(side.faceW / colGapW) - 1);
            const rows = Math.max(1, Math.floor(h / rowGap) - 1);
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const mat = Math.random() > 0.25 ? litMat : darkMat;
                    const win = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), mat);
                    const cx2 = -side.faceW / 2 + colGapW * (c + 1);
                    const cy = -h / 2 + rowGap * (r + 1);
                    const cz = side.faceD / 2 + 0.08;
                    if (side.axis === 'z') {
                        win.position.set(cx2, cy, side.sign * cz);
                        if (side.sign === -1) win.rotation.y = Math.PI;
                    } else {
                        win.position.set(side.sign * cz, cy, cx2);
                        win.rotation.y = side.sign * Math.PI / 2;
                    }
                    group.add(win);
                }
            }
        });

        // ---- Roof details ----
        const roofMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.7, metalness: 0.3 });
        // Parapet
        const parapet = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.8, d + 0.5), roofMat);
        parapet.position.y = h / 2 + 0.4;
        group.add(parapet);

        // Rooftop AC units
        const acCount = Math.floor(Math.random() * 4) + 1;
        for (let a = 0; a < acCount; a++) {
            const acW = 1.5 + Math.random() * 2;
            const acH = 1 + Math.random() * 1.5;
            const ac = new THREE.Mesh(new THREE.BoxGeometry(acW, acH, acW), roofMat);
            ac.position.set(
                (Math.random() - 0.5) * (w - 3),
                h / 2 + acH / 2 + 0.8,
                (Math.random() - 0.5) * (d - 3)
            );
            ac.castShadow = true;
            group.add(ac);
        }

        // Antenna (tall buildings)
        if (h > 35 && Math.random() > 0.5) {
            const ant = new THREE.Mesh(
                new THREE.CylinderGeometry(0.08, 0.12, 8 + Math.random() * 10, 5),
                new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.4, metalness: 0.8 })
            );
            ant.position.y = h / 2 + 5;
            ant.castShadow = true;
            group.add(ant);
        }

        // Water tower (older buildings)
        if (!pal.glass && Math.random() > 0.6) {
            const tankMat = new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.9, metalness: 0.1 });
            const tankGeo = new THREE.CylinderGeometry(1.2, 1.4, 3, 8);
            const tank = new THREE.Mesh(tankGeo, tankMat);
            tank.position.set((Math.random() - 0.5) * (w * 0.5), h / 2 + 2.5, (Math.random() - 0.5) * (d * 0.5));
            tank.castShadow = true;
            group.add(tank);
            // Tank legs
            for (let l = 0; l < 4; l++) {
                const legAngle = (l / 4) * Math.PI * 2;
                const leg = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.1, 0.1, 2, 4),
                    new THREE.MeshStandardMaterial({ color: 0x555544, roughness: 0.6 })
                );
                leg.position.set(
                    tank.position.x + Math.cos(legAngle) * 0.8,
                    h / 2 + 1.2,
                    tank.position.z + Math.sin(legAngle) * 0.8
                );
                group.add(leg);
            }
        }

        // Place building — use half-diagonal of footprint + road clearance
        // so even corners of large buildings never clip the road
        const halfDiag = Math.sqrt(w * w + d * d) * 0.5;
        const clearance = halfDiag + CONFIG.ROAD_WIDTH + 22; // generous margin
        let x, z;
        let valid = false;
        let attempts = 0;
        while (!valid && attempts < 30) {
            x = (Math.random() - 0.5) * CONFIG.WORLD_SIZE * 0.85;
            z = (Math.random() - 0.5) * CONFIG.WORLD_SIZE * 0.85;
            valid = !isNearTrack(x, z, clearance);
            attempts++;
        }
        if (!valid) continue;   // no safe spot found — skip this building entirely

        group.position.set(x, h / 2, z);
        group.rotation.y = Math.random() * Math.PI * 2;
        scene.add(group);
        world.buildings.push(group);
    }
}

function createTrees() {
    for (let i = 0; i < CONFIG.TREE_COUNT; i++) {
        const group = new THREE.Group();
        const treeType = Math.random();

        if (treeType < 0.38) {
            // === PINE TREE ===
            const trunkH = 5 + Math.random() * 3;
            const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.95, metalness: 0.0 });
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.2, 0.5, trunkH, 7),
                trunkMat
            );
            trunk.position.y = trunkH / 2;
            trunk.castShadow = true;
            group.add(trunk);

            const layers = 5;
            for (let j = 0; j < layers; j++) {
                const t = j / (layers - 1);
                const radius = (3.5 - t * 2.2) + Math.random() * 0.4;
                const coneH  = 3.5 + (1 - t) * 1.5;
                const shade  = 0.55 + Math.random() * 0.35;
                const g = Math.random() * 0.08;
                const coneMat = new THREE.MeshStandardMaterial({
                    color: new THREE.Color(0.05 + g, 0.32 * shade + 0.06, 0.08 + g),
                    roughness: 0.85,
                    flatShading: false,
                });
                const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, coneH, 8), coneMat);
                cone.position.y = trunkH + j * 2.2 + coneH * 0.3;
                cone.castShadow = true;
                group.add(cone);
            }

        } else if (treeType < 0.72) {
            // === ROUND BROADLEAF TREE ===
            const trunkH = 4 + Math.random() * 4;
            const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4b28, roughness: 0.95, metalness: 0.0 });
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.22, 0.55, trunkH, 7, 3),
                trunkMat
            );
            trunk.position.y = trunkH / 2;
            trunk.castShadow = true;
            group.add(trunk);

            // Main canopy
            const r1 = 3.5 + Math.random() * 2.5;
            const shade = 0.55 + Math.random() * 0.45;
            const gr = Math.random() * 0.1;
            const foliageMat = new THREE.MeshStandardMaterial({
                color: new THREE.Color(0.08 + gr, 0.38 * shade + 0.06, 0.06 + gr),
                roughness: 0.9,
            });
            const canopy = new THREE.Mesh(
                new THREE.SphereGeometry(r1, 9, 7),
                foliageMat
            );
            canopy.position.y = trunkH + r1 * 0.6;
            canopy.castShadow = true;
            group.add(canopy);

            // Secondary canopy blobs for 3-D silhouette
            const blobCount = 3 + Math.floor(Math.random() * 3);
            for (let b = 0; b < blobCount; b++) {
                const angle = (b / blobCount) * Math.PI * 2 + Math.random() * 0.5;
                const r2 = r1 * (0.5 + Math.random() * 0.35);
                const blob = new THREE.Mesh(
                    new THREE.SphereGeometry(r2, 7, 6),
                    foliageMat
                );
                blob.position.set(
                    Math.cos(angle) * r1 * 0.55,
                    trunkH + r1 * (0.4 + Math.random() * 0.3),
                    Math.sin(angle) * r1 * 0.55
                );
                blob.castShadow = true;
                group.add(blob);
            }

        } else {
            // === AUTUMN / SPARSE TREE ===
            const trunkH = 5 + Math.random() * 5;
            const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.95 });
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.18, 0.5, trunkH, 6),
                trunkMat
            );
            trunk.position.y = trunkH / 2;
            trunk.castShadow = true;
            group.add(trunk);

            // 3-4 major branches with foliage clusters at tips
            const branchCount = 3 + Math.floor(Math.random() * 3);
            const autumnColors = [0x8b3a0a, 0xc45c0c, 0xd4920a, 0x5a8c20, 0x3a7c14];
            const leafColor = autumnColors[Math.floor(Math.random() * autumnColors.length)];
            const bMat = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.95 });
            const lMat = new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.85, flatShading: true });

            for (let b = 0; b < branchCount; b++) {
                const angle = (b / branchCount) * Math.PI * 2 + Math.random() * 0.6;
                const spread = 1.5 + Math.random() * 2;
                const branchTop = new THREE.Vector3(
                    Math.cos(angle) * spread,
                    trunkH + 1 + Math.random() * 2,
                    Math.sin(angle) * spread
                );

                // Cluster of leaf blobs
                const clusterCount = 2 + Math.floor(Math.random() * 3);
                for (let c = 0; c < clusterCount; c++) {
                    const lr = 1.2 + Math.random() * 1.2;
                    const leaf = new THREE.Mesh(new THREE.SphereGeometry(lr, 6, 5), lMat);
                    leaf.position.set(
                        branchTop.x + (Math.random() - 0.5) * 1.5,
                        branchTop.y + (Math.random() - 0.3) * 1.5,
                        branchTop.z + (Math.random() - 0.5) * 1.5
                    );
                    leaf.castShadow = true;
                    group.add(leaf);
                }
            }
        }

        let x, z;
        let valid = false;
        let attempts = 0;
        while (!valid && attempts < 20) {
            x = (Math.random() - 0.5) * CONFIG.WORLD_SIZE * 0.9;
            z = (Math.random() - 0.5) * CONFIG.WORLD_SIZE * 0.9;
            valid = !isNearTrack(x, z, 25);
            attempts++;
        }

        const scale = 0.75 + Math.random() * 0.7;
        group.scale.set(scale, scale * (0.85 + Math.random() * 0.3), scale);
        group.position.set(x, 0, z);
        group.rotation.y = Math.random() * Math.PI * 2;
        scene.add(group);
        world.trees.push(group);
    }
}

function createDecorations() {
    // Rocks
    for (let i = 0; i < 50; i++) {
        const geo = new THREE.DodecahedronGeometry(1 + Math.random() * 3, 0);
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0.4 + Math.random() * 0.2, 0.38 + Math.random() * 0.15, 0.35 + Math.random() * 0.1),
            roughness: 0.9,
            flatShading: true
        });
        const rock = new THREE.Mesh(geo, mat);
        let x = (Math.random() - 0.5) * CONFIG.WORLD_SIZE * 0.8;
        let z = (Math.random() - 0.5) * CONFIG.WORLD_SIZE * 0.8;
        rock.position.set(x, 0.5, z);
        rock.rotation.set(Math.random(), Math.random(), Math.random());
        rock.castShadow = true;
        scene.add(rock);
    }

    // Barrier/fence along track edges
    createTrackBarriers();
}

function createTrackBarriers() {
    if (!track.waypoints.length) return;

    for (let i = 0; i < track.waypoints.length; i++) {
        const wp = track.waypoints[i];
        const nextWp = track.waypoints[(i + 1) % track.waypoints.length];
        const dir = new THREE.Vector3().subVectors(nextWp, wp).normalize();
        const perp = new THREE.Vector3(-dir.z, 0, dir.x);

        // Outer barrier posts
        for (let t = 0; t < 1; t += 0.5) {
            const pos = new THREE.Vector3().lerpVectors(wp, nextWp, t);
            const outerPos = pos.clone().add(perp.clone().multiplyScalar(CONFIG.ROAD_WIDTH + 2));

            const postGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.2, 6);
            const postMat = new THREE.MeshStandardMaterial({ color: 0xff4444, roughness: 0.5 });
            const post = new THREE.Mesh(postGeo, postMat);
            post.position.copy(outerPos);
            post.position.y = 0.6;
            scene.add(post);

            const innerPos = pos.clone().add(perp.clone().multiplyScalar(-(CONFIG.ROAD_WIDTH + 2)));
            const post2 = post.clone();
            post2.position.copy(innerPos);
            post2.position.y = 0.6;
            scene.add(post2);
        }
    }
}

// ==========================================
// TRACK GENERATION
// ==========================================
function generateTrack() {
    const segments = CONFIG.TRACK_SEGMENTS;
    const radius = 300;
    const variation = 120;

    // Generate control points in a loop
    const controlPoints = [];
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const r = radius + (Math.sin(angle * 3) * variation * 0.5) + (Math.cos(angle * 2 + 1) * variation * 0.3);
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        controlPoints.push(new THREE.Vector3(x, 0, z));
    }

    // Create smooth curve using CatmullRom
    const curve = new THREE.CatmullRomCurve3(controlPoints, true, 'catmullrom', 0.5);
    const points = curve.getPoints(segments * 20);
    track.waypoints = points;

    // Create road mesh
    const roadGeometry = new THREE.BufferGeometry();
    const roadVertices = [];
    const roadUVs = [];
    const roadNormals = [];

    for (let i = 0; i < points.length; i++) {
        const current = points[i];
        const next = points[(i + 1) % points.length];
        const dir = new THREE.Vector3().subVectors(next, current).normalize();
        const perp = new THREE.Vector3(-dir.z, 0, dir.x);

        const inner = current.clone().add(perp.clone().multiplyScalar(-CONFIG.ROAD_WIDTH));
        const outer = current.clone().add(perp.clone().multiplyScalar(CONFIG.ROAD_WIDTH));

        track.innerPoints.push(inner);
        track.outerPoints.push(outer);
    }

    // Build road triangles
    for (let i = 0; i < points.length; i++) {
        const nextI = (i + 1) % points.length;
        const p1 = track.innerPoints[i];
        const p2 = track.outerPoints[i];
        const p3 = track.innerPoints[nextI];
        const p4 = track.outerPoints[nextI];

        // Triangle 1
        roadVertices.push(p1.x, 0.20, p1.z);
        roadVertices.push(p2.x, 0.20, p2.z);
        roadVertices.push(p3.x, 0.20, p3.z);

        // Triangle 2
        roadVertices.push(p2.x, 0.20, p2.z);
        roadVertices.push(p4.x, 0.20, p4.z);
        roadVertices.push(p3.x, 0.20, p3.z);

        const u = i / points.length;
        const uNext = (i + 1) / points.length;
        roadUVs.push(0, u, 1, u, 0, uNext, 1, u, 1, uNext, 0, uNext);

        for (let j = 0; j < 6; j++) {
            roadNormals.push(0, 1, 0);
        }
    }

    roadGeometry.setAttribute('position', new THREE.Float32BufferAttribute(roadVertices, 3));
    roadGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(roadUVs, 2));
    roadGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(roadNormals, 3));

    // Road material with lane markings
    const roadMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        roughness: 0.85,
        metalness: 0.05,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
    });
    const roadMesh = new THREE.Mesh(roadGeometry, roadMat);
    roadMesh.receiveShadow = true;
    roadMesh.renderOrder = 1;
    scene.add(roadMesh);

    // Center line
    const lineGeometry = new THREE.BufferGeometry();
    const lineVertices = [];
    for (let i = 0; i < points.length; i++) {
        const next = (i + 1) % points.length;
        const dir = new THREE.Vector3().subVectors(points[next], points[i]).normalize();
        const perp = new THREE.Vector3(-dir.z, 0, dir.x);
        const p1 = points[i].clone().add(perp.clone().multiplyScalar(-0.2));
        const p2 = points[i].clone().add(perp.clone().multiplyScalar(0.2));
        const p3 = points[next].clone().add(perp.clone().multiplyScalar(-0.2));
        const p4 = points[next].clone().add(perp.clone().multiplyScalar(0.2));

        if (i % 4 < 2) { // Dashed line
            lineVertices.push(p1.x, 0.28, p1.z, p2.x, 0.28, p2.z, p3.x, 0.28, p3.z);
            lineVertices.push(p2.x, 0.28, p2.z, p4.x, 0.28, p4.z, p3.x, 0.28, p3.z);
        }
    }
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lineVertices, 3));
    lineGeometry.computeVertexNormals();
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lineMesh = new THREE.Mesh(lineGeometry, lineMat);
    scene.add(lineMesh);

    // Edge lines
    createEdgeLine(track.innerPoints, -0.5);
    createEdgeLine(track.outerPoints, 0.5);

    // Start/finish line
    createStartFinishLine();
}

function createEdgeLine(edgePoints, offset) {
    const geo = new THREE.BufferGeometry();
    const verts = [];
    for (let i = 0; i < edgePoints.length; i++) {
        const next = (i + 1) % edgePoints.length;
        const dir = new THREE.Vector3().subVectors(edgePoints[next], edgePoints[i]).normalize();
        const perp = new THREE.Vector3(-dir.z, 0, dir.x);

        const p1 = edgePoints[i].clone().add(perp.clone().multiplyScalar(-0.3));
        const p2 = edgePoints[i].clone().add(perp.clone().multiplyScalar(0.3));
        const p3 = edgePoints[next].clone().add(perp.clone().multiplyScalar(-0.3));
        const p4 = edgePoints[next].clone().add(perp.clone().multiplyScalar(0.3));

        verts.push(p1.x, 0.29, p1.z, p2.x, 0.29, p2.z, p3.x, 0.29, p3.z);
        verts.push(p2.x, 0.29, p2.z, p4.x, 0.29, p4.z, p3.x, 0.29, p3.z);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
    scene.add(new THREE.Mesh(geo, mat));
}

function createStartFinishLine() {
    if (track.waypoints.length < 2) return;
    const p = track.waypoints[0];
    const next = track.waypoints[1];
    const dir = new THREE.Vector3().subVectors(next, p).normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);

    // Checkered pattern
    const width = CONFIG.ROAD_WIDTH * 2;
    const checkerSize = 2;
    const numCheckers = Math.floor(width / checkerSize);

    for (let i = 0; i < numCheckers; i++) {
        for (let j = 0; j < 3; j++) {
            const isBlack = (i + j) % 2 === 0;
            const geo = new THREE.PlaneGeometry(checkerSize, checkerSize);
            const mat = new THREE.MeshBasicMaterial({
                color: isBlack ? 0x000000 : 0xffffff
            });
            const checker = new THREE.Mesh(geo, mat);
            checker.rotation.x = -Math.PI / 2;

            const offset = (-width / 2 + i * checkerSize + checkerSize / 2);
            const fwd = (-1 + j) * checkerSize;

            checker.position.copy(p);
            checker.position.add(perp.clone().multiplyScalar(offset));
            checker.position.add(dir.clone().multiplyScalar(fwd));
            checker.position.y = 0.31;

            scene.add(checker);
        }
    }

    // Start/finish arch
    const archGeo = new THREE.BoxGeometry(width + 4, 0.8, 0.8);
    const archMat = new THREE.MeshStandardMaterial({ color: 0xcc0000, metalness: 0.5, roughness: 0.3 });
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.copy(p);
    arch.position.y = 8;
    arch.lookAt(next);
    scene.add(arch);

    // Pillars
    for (const side of [-1, 1]) {
        const pillarGeo = new THREE.CylinderGeometry(0.4, 0.4, 8.5, 8);
        const pillar = new THREE.Mesh(pillarGeo, archMat);
        pillar.position.copy(p);
        pillar.position.add(perp.clone().multiplyScalar(side * (width / 2 + 1.5)));
        pillar.position.y = 4;
        scene.add(pillar);
    }
}

function isNearTrack(x, z, dist) {
    for (const wp of track.waypoints) {
        const dx = x - wp.x;
        const dz = z - wp.z;
        if (dx * dx + dz * dz < dist * dist) return true;
    }
    return false;
}

// ==========================================
// CAR CREATION
// ==========================================
function createCar(color, isPlayer) {
    const group = new THREE.Group();

    // Car body
    const bodyGeo = new THREE.BoxGeometry(2.2, 0.7, 4.5);
    const bodyMat = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.15,
        metalness: 0.85,
        envMapIntensity: 1.0,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.65;
    body.castShadow = true;
    group.add(body);

    // Cabin
    const cabinGeo = new THREE.BoxGeometry(1.8, 0.7, 2.2);
    const cabinMat = new THREE.MeshStandardMaterial({
        color: 0x111122,
        roughness: 0.1,
        metalness: 0.9,
        transparent: true,
        opacity: 0.7
    });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 1.3, -0.3);
    cabin.castShadow = true;
    group.add(cabin);

    // Hood scoop
    const scoopGeo = new THREE.BoxGeometry(0.8, 0.2, 1);
    const scoopMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.7 });
    const scoop = new THREE.Mesh(scoopGeo, scoopMat);
    scoop.position.set(0, 1.05, 1.2);
    group.add(scoop);

    // Front splitter
    const splitterGeo = new THREE.BoxGeometry(2.4, 0.1, 0.5);
    const splitterMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
    const splitter = new THREE.Mesh(splitterGeo, splitterMat);
    splitter.position.set(0, 0.25, 2.3);
    group.add(splitter);

    // Rear spoiler
    const spoilerGeo = new THREE.BoxGeometry(2, 0.1, 0.4);
    const spoilerMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.3, metalness: 0.8 });
    const spoiler = new THREE.Mesh(spoilerGeo, spoilerMat);
    spoiler.position.set(0, 1.5, -2);
    group.add(spoiler);

    // Spoiler supports
    for (const side of [-0.7, 0.7]) {
        const supportGeo = new THREE.BoxGeometry(0.1, 0.4, 0.1);
        const support = new THREE.Mesh(supportGeo, spoilerMat);
        support.position.set(side, 1.25, -2);
        group.add(support);
    }

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
    const rimGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.32, 8);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.2, metalness: 0.9 });

    const wheelPositions = [
        new THREE.Vector3(-1.2, 0.4, 1.4),
        new THREE.Vector3(1.2, 0.4, 1.4),
        new THREE.Vector3(-1.2, 0.4, -1.4),
        new THREE.Vector3(1.2, 0.4, -1.4),
    ];

    const wheels = [];
    wheelPositions.forEach(pos => {
        const wheelGroup = new THREE.Group();
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheelGroup.add(wheel);

        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.rotation.z = Math.PI / 2;
        wheelGroup.add(rim);

        wheelGroup.position.copy(pos);
        wheelGroup.castShadow = true;
        group.add(wheelGroup);
        wheels.push(wheelGroup);
    });

    // Headlights
    const headlightGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const headlightMat = new THREE.MeshStandardMaterial({
        color: 0xffffee,
        emissive: 0xffffee,
        emissiveIntensity: 0.5
    });
    for (const side of [-0.7, 0.7]) {
        const headlight = new THREE.Mesh(headlightGeo, headlightMat);
        headlight.position.set(side, 0.7, 2.3);
        group.add(headlight);
    }

    // Taillights
    const taillightGeo = new THREE.BoxGeometry(0.4, 0.15, 0.1);
    const taillightMat = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        emissive: 0xff0000,
        emissiveIntensity: 0.3
    });
    for (const side of [-0.8, 0.8]) {
        const taillight = new THREE.Mesh(taillightGeo, taillightMat);
        taillight.position.set(side, 0.7, -2.25);
        group.add(taillight);
    }

    // Add headlight beams for player
    if (isPlayer) {
        for (const side of [-0.7, 0.7]) {
            const spotLight = new THREE.SpotLight(0xffffee, 0.5, 60, Math.PI / 6, 0.5);
            spotLight.position.set(side, 0.7, 2.3);
            spotLight.target.position.set(side, 0, 20);
            group.add(spotLight);
            group.add(spotLight.target);
        }
    }

    // Shadow beneath car
    const shadowGeo = new THREE.PlaneGeometry(3, 5.5);
    const shadowMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.3,
        depthWrite: false
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.05;
    group.add(shadow);

    // Car data
    const carStats = getCarStats(isPlayer ? selectedCar : 'sport');

    return {
        group: group,
        wheels: wheels,
        speed: 0,
        maxSpeed: carStats.maxSpeed,
        acceleration: carStats.acceleration,
        braking: carStats.braking,
        handling: carStats.handling,
        rotation: 0,
        steerAngle: 0,
        velocity: new THREE.Vector3(),
        angularVelocity: 0,
        gear: 0, // 0=N, 1-6
        rpm: 0,
        onTrack: true,
        waypointIndex: 0,
        lapCount: 0,
        passedStart: false,
        distanceTraveled: 0,
        racePosition: 1,
        finishTime: 0,
        isPlayer: isPlayer
    };
}

function getCarStats(type) {
    const stats = {
        sport: { maxSpeed: 180, acceleration: 0.08, braking: 0.12, handling: 0.035 },
        muscle: { maxSpeed: 160, acceleration: 0.10, braking: 0.10, handling: 0.028 },
        super: { maxSpeed: 220, acceleration: 0.09, braking: 0.14, handling: 0.040 },
    };
    return stats[type] || stats.sport;
}

// ==========================================
// AI SYSTEM
// ==========================================
function createAICars() {
    aiCars = [];
    const aiTypes = ['sport', 'muscle', 'super'];

    for (let i = 0; i < 3; i++) {
        const aiCar = createCar(CONFIG.AI_COLORS[i], false);
        const startIdx = Math.floor((i + 1) * (track.waypoints.length / 5));
        const startPos = track.waypoints[startIdx % track.waypoints.length];

        const nextPos = track.waypoints[(startIdx + 1) % track.waypoints.length];
        const dir = new THREE.Vector3().subVectors(nextPos, startPos).normalize();
        const angle = Math.atan2(dir.x, dir.z);

        // Offset to side
        const perp = new THREE.Vector3(-dir.z, 0, dir.x);
        const sideOffset = (i % 2 === 0 ? 1 : -1) * 4;

        aiCar.group.position.copy(startPos);
        aiCar.group.position.add(perp.clone().multiplyScalar(sideOffset));
        aiCar.group.position.y = 0;
        aiCar.group.rotation.y = angle;
        aiCar.rotation = angle;
        aiCar.waypointIndex = startIdx % track.waypoints.length;

        // Set AI stats based on difficulty and car type
        const typeStats = getCarStats(aiTypes[i]);
        aiCar.maxSpeed = typeStats.maxSpeed;
        aiCar.acceleration = typeStats.acceleration;
        aiCar.handling = typeStats.handling;

        const diffMultiplier = {
            easy: 0.65,
            medium: 0.8,
            hard: 0.95,
            extreme: 1.1
        }[difficulty] || 0.8;

        aiCar.maxSpeed *= diffMultiplier;
        aiCar.acceleration *= diffMultiplier;
        aiCar.aiType = aiTypes[i];
        aiCar.aiName = ['AI-BOLT', 'AI-FURY', 'AI-GHOST'][i];
        aiCar.aiRandomness = 0.02 + Math.random() * 0.03;

        scene.add(aiCar.group);
        aiCars.push(aiCar);
    }
}

function updateAI(car, dt) {
    if (!raceStarted || raceFinished) return;

    const waypoints = track.waypoints;
    const target = waypoints[car.waypointIndex];
    const carPos = car.group.position;

    // Look ahead multiple waypoints for smoother AI
    const lookAhead = 5;
    const futureIdx = (car.waypointIndex + lookAhead) % waypoints.length;
    const futureTarget = waypoints[futureIdx];

    // Calculate direction to target
    const dx = target.x - carPos.x;
    const dz = target.z - carPos.z;
    const distToWaypoint = Math.sqrt(dx * dx + dz * dz);

    // Calculate direction to future target for smoother turning
    const fdx = futureTarget.x - carPos.x;
    const fdz = futureTarget.z - carPos.z;

    // Blend between immediate and future target
    const blend = 0.6;
    const targetAngle = Math.atan2(
        dx * (1 - blend) + fdx * blend,
        dz * (1 - blend) + fdz * blend
    );

    // Smooth steering
    let angleDiff = targetAngle - car.rotation;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    // Add slight randomness for natural driving
    angleDiff += (Math.random() - 0.5) * car.aiRandomness;

    const steerStrength = car.handling * 1.2;
    car.rotation += angleDiff * steerStrength * 60 * dt;

    // Speed control - slow down for turns
    const turnSharpness = Math.abs(angleDiff);
    let targetSpeed = car.maxSpeed;

    if (turnSharpness > 0.5) {
        targetSpeed *= 0.5;
    } else if (turnSharpness > 0.2) {
        targetSpeed *= 0.75;
    } else if (turnSharpness > 0.1) {
        targetSpeed *= 0.9;
    }

    // Avoid other cars
    const avoidDist = 15;
    for (const other of [...aiCars, playerCar]) {
        if (other === car) continue;
        const odx = other.group.position.x - carPos.x;
        const odz = other.group.position.z - carPos.z;
        const oDist = Math.sqrt(odx * odx + odz * odz);
        if (oDist < avoidDist) {
            // Steer away
            const avoidAngle = Math.atan2(odx, odz);
            let avoidDiff = avoidAngle - car.rotation;
            while (avoidDiff > Math.PI) avoidDiff -= Math.PI * 2;
            while (avoidDiff < -Math.PI) avoidDiff += Math.PI * 2;
            car.rotation -= avoidDiff * 0.02;

            if (oDist < 8) {
                targetSpeed *= 0.7;
            }
        }
    }

    // Accelerate/decelerate
    if (car.speed < targetSpeed) {
        car.speed += car.acceleration * 60 * dt;
    } else {
        car.speed -= car.acceleration * 0.5 * 60 * dt;
    }
    car.speed = Math.max(0, Math.min(car.speed, car.maxSpeed));

    // Move car
    const moveX = Math.sin(car.rotation) * car.speed * dt;
    const moveZ = Math.cos(car.rotation) * car.speed * dt;
    carPos.x += moveX;
    carPos.z += moveZ;
    carPos.y = 0.0;

    car.group.rotation.y = car.rotation;

    // Spin wheels
    car.wheels.forEach(w => {
        w.children[0].rotation.x += car.speed * dt * 0.5;
        w.children[1].rotation.x += car.speed * dt * 0.5;
    });

    // Update waypoint
    if (distToWaypoint < 20) {
        const prevIndex = car.waypointIndex;
        car.waypointIndex = (car.waypointIndex + 1) % waypoints.length;

        // Check lap completion
        if (car.waypointIndex < prevIndex && prevIndex > waypoints.length * 0.8) {
            car.lapCount++;
        }
    }

    // Track distance for position calculation
    car.distanceTraveled = car.lapCount * waypoints.length + car.waypointIndex;
}

// ==========================================
// PLAYER PHYSICS
// ==========================================
function updatePlayer(dt) {
    if (!raceStarted && gameMode === 'race') return;

    const car = playerCar;
    const turnSpeed = car.handling;
    const isOnGrass = !isOnTrack(car.group.position.x, car.group.position.z);

    // Acceleration
    if (keys['ArrowUp'] || keys['w'] || keys['W']) {
        const accel = isOnGrass ? car.acceleration * 0.5 : car.acceleration;
        car.speed += accel * 60 * dt;
    }

    // Braking
    if (keys['ArrowDown'] || keys['s'] || keys['S']) {
        if (car.speed > 0) {
            car.speed -= car.braking * 60 * dt;
            if (car.speed < 0) car.speed = -car.maxSpeed * 0.3;
        } else {
            car.speed -= car.acceleration * 0.5 * 60 * dt;
        }
    }

    // Handbrake
    if (keys[' ']) {
        car.speed *= 0.96;
        // Add drift effect
        if (Math.abs(car.steerAngle) > 0.01) {
            car.angularVelocity += car.steerAngle * 0.003;
        }
    }

    // Steering
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) {
        car.steerAngle = Math.min(car.steerAngle + 0.06 * dt * 60, 1);
    } else if (keys['ArrowRight'] || keys['d'] || keys['D']) {
        car.steerAngle = Math.max(car.steerAngle - 0.06 * dt * 60, -1);
    } else {
        car.steerAngle *= 0.85;
    }

    // Speed limits
    const maxSpd = isOnGrass ? car.maxSpeed * 0.6 : car.maxSpeed;
    car.speed = Math.max(-maxSpd * 0.3, Math.min(car.speed, maxSpd));

    // Friction
    if (!keys['ArrowUp'] && !keys['w'] && !keys['W'] &&
        !keys['ArrowDown'] && !keys['s'] && !keys['S']) {
        car.speed *= isOnGrass ? 0.97 : 0.99;
    }

    // Very small speeds snap to 0
    if (Math.abs(car.speed) < 0.5) car.speed *= 0.9;

    // Turning (speed-dependent)
    const speedFactor = Math.min(Math.abs(car.speed) / 50, 1);
    const turnAmount = car.steerAngle * turnSpeed * speedFactor * 60 * dt;
    car.rotation += car.speed > 0 ? turnAmount : -turnAmount;
    car.rotation += car.angularVelocity;
    car.angularVelocity *= 0.92;

    // Move
    const moveX = Math.sin(car.rotation) * car.speed * dt;
    const moveZ = Math.cos(car.rotation) * car.speed * dt;
    car.group.position.x += moveX;
    car.group.position.z += moveZ;
    car.group.position.y = 0.0;

    // World boundaries
    const bound = CONFIG.WORLD_SIZE / 2 - 20;
    car.group.position.x = Math.max(-bound, Math.min(bound, car.group.position.x));
    car.group.position.z = Math.max(-bound, Math.min(bound, car.group.position.z));

    car.group.rotation.y = car.rotation;

    // Wheel animation
    const wheelSpinSpeed = car.speed * dt * 0.5;
    car.wheels.forEach((w, i) => {
        w.children[0].rotation.x += wheelSpinSpeed;
        w.children[1].rotation.x += wheelSpinSpeed;
        // Front wheel steering visual
        if (i < 2) {
            w.rotation.y = car.steerAngle * 0.3;
        }
    });

    // Gear calculation
    const absSpeed = Math.abs(car.speed);
    if (absSpeed < 1) car.gear = 0;
    else if (absSpeed < 30) car.gear = 1;
    else if (absSpeed < 60) car.gear = 2;
    else if (absSpeed < 90) car.gear = 3;
    else if (absSpeed < 130) car.gear = 4;
    else if (absSpeed < 170) car.gear = 5;
    else car.gear = 6;

    car.rpm = absSpeed > 0 ? 1000 + (absSpeed % 30) / 30 * 7000 : 800;

    // Track top speed
    if (absSpeed > topSpeed) topSpeed = absSpeed;

    // Update waypoint tracking for position system
    updatePlayerWaypoint();

    // Car body tilt
    car.group.children[0].rotation.z = -car.steerAngle * speedFactor * 0.03;
    car.group.children[0].rotation.x = (keys['ArrowUp'] || keys['w'] || keys['W']) ? -0.02 : 
                                        (keys['ArrowDown'] || keys['s'] || keys['S']) ? 0.02 : 0;
}

function isOnTrack(x, z) {
    // Check distance from nearest track waypoint
    let minDist = Infinity;
    for (let i = 0; i < track.waypoints.length; i += 3) {
        const wp = track.waypoints[i];
        const dx = x - wp.x;
        const dz = z - wp.z;
        const dist = dx * dx + dz * dz;
        if (dist < minDist) minDist = dist;
    }
    return minDist < (CONFIG.ROAD_WIDTH + 2) * (CONFIG.ROAD_WIDTH + 2);
}

function updatePlayerWaypoint() {
    const pos = playerCar.group.position;
    let closestIdx = playerCar.waypointIndex;
    let closestDist = Infinity;

    // Search nearby waypoints
    const searchRange = 30;
    for (let i = -searchRange; i <= searchRange; i++) {
        const idx = ((playerCar.waypointIndex + i) % track.waypoints.length + track.waypoints.length) % track.waypoints.length;
        const wp = track.waypoints[idx];
        const dx = pos.x - wp.x;
        const dz = pos.z - wp.z;
        const dist = dx * dx + dz * dz;
        if (dist < closestDist) {
            closestDist = dist;
            closestIdx = idx;
        }
    }

    // Check for lap completion (passed start line)
    if (closestIdx < track.waypoints.length * 0.1 &&
        playerCar.waypointIndex > track.waypoints.length * 0.8) {

        // Lap completed
        if (currentLap <= numLaps) {
            const lapTime = raceTime - lapTimes.reduce((a, b) => a + b, 0);
            lapTimes.push(lapTime);
            lastLap = lapTime;

            if (lapTime < bestLap) {
                bestLap = lapTime;
                showNotification('BEST LAP!');
            }

            currentLap++;

            if (currentLap > numLaps && gameMode === 'race') {
                finishRace();
            } else if (currentLap <= numLaps) {
                showNotification(`LAP ${currentLap}`);
            }
        }
    }

    playerCar.waypointIndex = closestIdx;
    playerCar.distanceTraveled = (currentLap - 1) * track.waypoints.length + closestIdx;
}

// ==========================================
// CAMERA SYSTEM
// ==========================================
function updateCamera(dt) {
    const carPos = playerCar.group.position;
    const carRot = playerCar.rotation;
    const speed = Math.abs(playerCar.speed);

    // Dynamic FOV based on speed
    const targetFov = 65 + (speed / playerCar.maxSpeed) * 15;
    camera.fov += (targetFov - camera.fov) * 0.05;
    camera.updateProjectionMatrix();

    let targetPos, lookAtPos;

    switch (cameraMode) {
        case 0: // Chase cam
            const chaseDist = 12 + speed * 0.02;
            const chaseHeight = 5 + speed * 0.01;
            targetPos = new THREE.Vector3(
                carPos.x - Math.sin(carRot) * chaseDist,
                carPos.y + chaseHeight,
                carPos.z - Math.cos(carRot) * chaseDist
            );
            lookAtPos = new THREE.Vector3(
                carPos.x + Math.sin(carRot) * 10,
                carPos.y + 1,
                carPos.z + Math.cos(carRot) * 10
            );
            break;

        case 1: // Far chase
            const farDist = 25 + speed * 0.03;
            targetPos = new THREE.Vector3(
                carPos.x - Math.sin(carRot) * farDist,
                carPos.y + 12,
                carPos.z - Math.cos(carRot) * farDist
            );
            lookAtPos = new THREE.Vector3(carPos.x, carPos.y + 1, carPos.z);
            break;

        case 2: // Hood cam
            targetPos = new THREE.Vector3(
                carPos.x + Math.sin(carRot) * 1,
                carPos.y + 2,
                carPos.z + Math.cos(carRot) * 1
            );
            lookAtPos = new THREE.Vector3(
                carPos.x + Math.sin(carRot) * 30,
                carPos.y + 1,
                carPos.z + Math.cos(carRot) * 30
            );
            break;

        case 3: // Top down
            targetPos = new THREE.Vector3(carPos.x, carPos.y + 60, carPos.z + 10);
            lookAtPos = new THREE.Vector3(carPos.x, carPos.y, carPos.z);
            break;
    }

    // Smooth camera
    const smoothing = cameraMode === 2 ? 0.15 : 0.06;
    camera.position.lerp(targetPos, smoothing);
    
    const currentLookAt = new THREE.Vector3();
    camera.getWorldDirection(currentLookAt);
    const targetDir = new THREE.Vector3().subVectors(lookAtPos, camera.position).normalize();
    currentLookAt.lerp(targetDir, smoothing * 1.5);
    camera.lookAt(
        camera.position.x + currentLookAt.x * 10,
        camera.position.y + currentLookAt.y * 10,
        camera.position.z + currentLookAt.z * 10
    );

    // Update shadow camera to follow player
    sunLight.position.set(carPos.x + 200, 300, carPos.z + 100);
    sunLight.target.position.copy(carPos);
}

// ==========================================
// WEATHER SYSTEM
// ==========================================
function setupWeather() {
    // Remove existing weather particles
    weatherParticles.forEach(p => scene.remove(p));
    weatherParticles = [];

    switch (weatherType) {
        case 'clear':
            scene.fog = new THREE.FogExp2(0x87ceeb, 0.0005);
            sunLight.intensity = 1.2;
            ambientLight.intensity = 0.4;
            break;

        case 'cloudy':
            scene.fog = new THREE.FogExp2(0x999999, 0.001);
            sunLight.intensity = 0.6;
            ambientLight.intensity = 0.5;
            ambientLight.color.setHex(0x888899);
            break;

        case 'rain':
            scene.fog = new THREE.FogExp2(0x666688, 0.0015);
            sunLight.intensity = 0.4;
            ambientLight.intensity = 0.4;
            ambientLight.color.setHex(0x667788);
            createRainParticles();
            break;

        case 'night':
            scene.fog = new THREE.FogExp2(0x0a0a1a, 0.002);
            sunLight.intensity = 0.05;
            ambientLight.intensity = 0.15;
            ambientLight.color.setHex(0x1a1a3a);
            hemisphereLight.intensity = 0.1;
            // Make building windows glow more
            world.buildings.forEach(b => {
                b.traverse(child => {
                    if (child.material && child.material.emissiveIntensity) {
                        child.material.emissiveIntensity = 1.0;
                    }
                });
            });
            break;
    }
}

function createRainParticles() {
    const rainCount = 3000;
    const rainGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(rainCount * 3);
    const velocities = new Float32Array(rainCount);

    for (let i = 0; i < rainCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 400;
        positions[i * 3 + 1] = Math.random() * 100;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 400;
        velocities[i] = 50 + Math.random() * 50;
    }

    rainGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    rainGeo.userData = { velocities };

    const rainMat = new THREE.PointsMaterial({
        color: 0xaaaacc,
        size: 0.3,
        transparent: true,
        opacity: 0.6,
        depthWrite: false
    });

    const rain = new THREE.Points(rainGeo, rainMat);
    rain.userData = { type: 'rain', velocities };
    scene.add(rain);
    weatherParticles.push(rain);
}

function updateWeather(dt) {
    weatherParticles.forEach(p => {
        if (p.userData.type === 'rain') {
            const positions = p.geometry.attributes.position.array;
            const velocities = p.userData.velocities;

            for (let i = 0; i < positions.length / 3; i++) {
                positions[i * 3 + 1] -= velocities[i] * dt;

                if (positions[i * 3 + 1] < 0) {
                    positions[i * 3 + 1] = 80 + Math.random() * 20;
                    positions[i * 3] = playerCar.group.position.x + (Math.random() - 0.5) * 400;
                    positions[i * 3 + 2] = playerCar.group.position.z + (Math.random() - 0.5) * 400;
                }
            }

            p.geometry.attributes.position.needsUpdate = true;

            // Move rain with player
            p.position.x = playerCar.group.position.x;
            p.position.z = playerCar.group.position.z;
        }
    });
}

// ==========================================
// PARTICLE EFFECTS
// ==========================================
function createDustParticle(position, speed) {
    if (particles.dust.length > 100) {
        const oldest = particles.dust.shift();
        scene.remove(oldest.mesh);
    }

    const geo = new THREE.SphereGeometry(0.3 + Math.random() * 0.5, 4, 4);
    const mat = new THREE.MeshBasicMaterial({
        color: isOnTrack(position.x, position.z) ? 0x555555 : 0x886644,
        transparent: true,
        opacity: 0.4,
        depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.position.y = 0.3;
    mesh.position.x += (Math.random() - 0.5) * 2;
    mesh.position.z += (Math.random() - 0.5) * 2;

    scene.add(mesh);
    particles.dust.push({
        mesh,
        life: 1,
        velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 3,
            1 + Math.random() * 2,
            (Math.random() - 0.5) * 3
        )
    });
}

function updateParticles(dt) {
    // Dust from car
    if (Math.abs(playerCar.speed) > 20) {
        if (Math.random() < 0.3) {
            const pos = playerCar.group.position.clone();
            pos.x -= Math.sin(playerCar.rotation) * 2.5;
            pos.z -= Math.cos(playerCar.rotation) * 2.5;
            createDustParticle(pos, playerCar.speed);
        }
    }

    // Extra dust when drifting
    if (keys[' '] && Math.abs(playerCar.speed) > 30) {
        for (let i = 0; i < 3; i++) {
            const pos = playerCar.group.position.clone();
            pos.x -= Math.sin(playerCar.rotation) * 2;
            pos.z -= Math.cos(playerCar.rotation) * 2;
            createDustParticle(pos, playerCar.speed);
        }
    }

    // Update dust particles
    for (let i = particles.dust.length - 1; i >= 0; i--) {
        const p = particles.dust[i];
        p.life -= dt * 1.5;
        p.mesh.position.add(p.velocity.clone().multiplyScalar(dt));
        p.velocity.y -= 2 * dt;
        p.mesh.material.opacity = p.life * 0.4;
        p.mesh.scale.setScalar(1 + (1 - p.life) * 2);

        if (p.life <= 0) {
            scene.remove(p.mesh);
            particles.dust.splice(i, 1);
        }
    }
}

// ==========================================
// HUD RENDERING
// ==========================================
function drawSpeedometer() {
    const canvas = document.getElementById('speedometer-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = 90;

    ctx.clearRect(0, 0, w, h);

    // Background arc
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI * 0.75, Math.PI * 2.25, false);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 8;
    ctx.stroke();

    // Speed arc
    const speed = Math.abs(playerCar.speed);
    const maxSpeed = playerCar.maxSpeed;
    const speedRatio = Math.min(speed / maxSpeed, 1);
    const endAngle = Math.PI * 0.75 + speedRatio * Math.PI * 1.5;

    const gradient = ctx.createLinearGradient(0, h, w, 0);
    gradient.addColorStop(0, '#ff6b35');
    gradient.addColorStop(0.5, '#ff2e63');
    gradient.addColorStop(1, '#ff0040');

    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI * 0.75, endAngle, false);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Glow effect
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI * 0.75, endAngle, false);
    ctx.strokeStyle = `rgba(255, 46, 99, ${0.3 * speedRatio})`;
    ctx.lineWidth = 20;
    ctx.stroke();

    // Tick marks
    for (let i = 0; i <= 10; i++) {
        const angle = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
        const innerR = radius - 15;
        const outerR = radius - 5;

        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
        ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
        ctx.strokeStyle = i <= speedRatio * 10 ? '#ff2e63' : 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Speed numbers
        const numR = radius - 25;
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '10px Orbitron';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
            Math.round(maxSpeed * i / 10),
            cx + Math.cos(angle) * numR,
            cy + Math.sin(angle) * numR
        );
    }

    // Needle
    const needleAngle = Math.PI * 0.75 + speedRatio * Math.PI * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
        cx + Math.cos(needleAngle) * (radius - 10),
        cy + Math.sin(needleAngle) * (radius - 10)
    );
    ctx.strokeStyle = '#ff2e63';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ff2e63';
    ctx.fill();

    // RPM bar at bottom
    const rpmRatio = Math.min(playerCar.rpm / 8000, 1);
    const rpmWidth = 120;
    const rpmX = cx - rpmWidth / 2;
    const rpmY = cy + radius - 15;

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(rpmX, rpmY, rpmWidth, 4);

    const rpmGrad = ctx.createLinearGradient(rpmX, 0, rpmX + rpmWidth, 0);
    rpmGrad.addColorStop(0, '#00ff88');
    rpmGrad.addColorStop(0.7, '#ff6b35');
    rpmGrad.addColorStop(1, '#ff0040');
    ctx.fillStyle = rpmGrad;
    ctx.fillRect(rpmX, rpmY, rpmWidth * rpmRatio, 4);
}

function drawMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = 'rgba(0, 20, 10, 0.8)';
    ctx.fillRect(0, 0, w, h);

    const scale = 0.18;
    const offsetX = w / 2;
    const offsetY = h / 2;

    // Center on player
    const px = playerCar.group.position.x;
    const pz = playerCar.group.position.z;

    // Draw track
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 3;

    for (let i = 0; i < track.waypoints.length; i++) {
        const wp = track.waypoints[i];
        const x = (wp.x - px) * scale + offsetX;
        const y = (wp.z - pz) * scale + offsetY;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    // Draw AI cars
    aiCars.forEach((car, i) => {
        const x = (car.group.position.x - px) * scale + offsetX;
        const y = (car.group.position.z - pz) * scale + offsetY;

        if (x >= -5 && x <= w + 5 && y >= -5 && y <= h + 5) {
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#' + CONFIG.AI_COLORS[i].toString(16).padStart(6, '0');
            ctx.fill();
        }
    });

    // Draw player (always center)
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.rotate(-playerCar.rotation + Math.PI);

    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(-4, 4);
    ctx.lineTo(4, 4);
    ctx.closePath();
    ctx.fillStyle = '#ff2e63';
    ctx.fill();

    ctx.restore();

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);
}

function updateHUD() {
    // Speed
    const speedEl = document.getElementById('hud-speed');
    if (speedEl) speedEl.textContent = Math.round(Math.abs(playerCar.speed) * 2);

    // Gear
    const gearEl = document.getElementById('hud-gear');
    if (gearEl) gearEl.textContent = playerCar.gear === 0 ? 'N' : playerCar.gear;

    // Position
    if (gameMode === 'race') {
        const position = calculatePosition();
        const posEl = document.getElementById('hud-position');
        const suffixEl = document.getElementById('hud-position-suffix');
        if (posEl) posEl.textContent = position;
        if (suffixEl) {
            const suffixes = ['ST', 'ND', 'RD', 'TH'];
            suffixEl.textContent = position <= 3 ? suffixes[position - 1] : suffixes[3];
        }

        // Lap
        const lapEl = document.getElementById('hud-lap');
        if (lapEl) lapEl.textContent = Math.min(currentLap, numLaps);
        const totalLapsEl = document.getElementById('hud-total-laps');
        if (totalLapsEl) totalLapsEl.textContent = numLaps;
    }

    // Time
    const timeEl = document.getElementById('hud-time');
    if (timeEl) timeEl.textContent = formatTime(raceTime);

    // Best lap
    const bestLapEl = document.getElementById('hud-best-lap');
    if (bestLapEl) bestLapEl.textContent = bestLap < Infinity ? formatTime(bestLap) : '--:--.---';

    // Last lap
    const lastLapEl = document.getElementById('hud-last-lap');
    if (lastLapEl) lastLapEl.textContent = lastLap > 0 ? formatTime(lastLap) : '--:--.---';

    drawSpeedometer();
    drawMinimap();
}

function calculatePosition() {
    const allCars = [playerCar, ...aiCars];
    allCars.sort((a, b) => b.distanceTraveled - a.distanceTraveled);
    return allCars.indexOf(playerCar) + 1;
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

// ==========================================
// RACE MANAGEMENT
// ==========================================
function startCountdown() {
    state = GameState.COUNTDOWN;
    const overlay = document.getElementById('countdown-overlay');
    const numberEl = document.getElementById('countdown-number');
    overlay.style.display = 'flex';

    let count = 3;
    numberEl.textContent = count;

    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            numberEl.textContent = count;
            numberEl.style.animation = 'none';
            void numberEl.offsetWidth; // Trigger reflow
            numberEl.style.animation = 'countPulse 1s ease';
        } else if (count === 0) {
            numberEl.textContent = 'GO!';
            numberEl.style.color = '#00ff88';
            numberEl.style.animation = 'none';
            void numberEl.offsetWidth;
            numberEl.style.animation = 'countPulse 1s ease';
        } else {
            overlay.style.display = 'none';
            numberEl.style.color = '';
            state = GameState.RACING;
            raceStarted = true;
            clearInterval(interval);
        }
    }, 1000);
}

function finishRace() {
    raceFinished = true;
    raceStarted = false;
    state = GameState.RESULTS;

    const position = calculatePosition();
    const positions = ['1ST', '2ND', '3RD', '4TH'];
    const titles = ['VICTORY!', 'GREAT RACE!', 'NICE TRY!', 'KEEP PRACTICING!'];

    document.getElementById('results-position').textContent = positions[position - 1] || '4TH';
    document.getElementById('results-title').textContent = titles[position - 1] || titles[3];
    document.getElementById('results-total-time').textContent = formatTime(raceTime);
    document.getElementById('results-best-lap').textContent = bestLap < Infinity ? formatTime(bestLap) : '--:--.---';
    document.getElementById('results-top-speed').textContent = Math.round(topSpeed * 2) + ' km/h';

    document.getElementById('game-hud').style.display = 'none';
    document.getElementById('results-screen').style.display = 'block';
}

function resetRace() {
    raceTime = 0;
    lapTimes = [];
    bestLap = Infinity;
    lastLap = 0;
    currentLap = 1;
    topSpeed = 0;
    raceStarted = false;
    raceFinished = false;

    // Reset player position
    const startPos = track.waypoints[0];
    const nextPos = track.waypoints[1];
    const dir = new THREE.Vector3().subVectors(nextPos, startPos).normalize();
    const angle = Math.atan2(dir.x, dir.z);

    playerCar.group.position.copy(startPos);
    playerCar.group.position.y = 0;
    playerCar.group.rotation.y = angle;
    playerCar.rotation = angle;
    playerCar.speed = 0;
    playerCar.steerAngle = 0;
    playerCar.angularVelocity = 0;
    playerCar.waypointIndex = 0;
    playerCar.distanceTraveled = 0;
    playerCar.gear = 0;
    playerCar.rpm = 800;

    // Reset AI
    aiCars.forEach(car => scene.remove(car.group));
    aiCars = [];
    createAICars();

    // Move AI to start positions behind player
    aiCars.forEach((car, i) => {
        const offset = (i + 1) * 10;
        const sideOffset = (i % 2 === 0 ? 1 : -1) * 5;
        const perp = new THREE.Vector3(-dir.z, 0, dir.x);

        car.group.position.copy(startPos);
        car.group.position.x -= dir.x * offset;
        car.group.position.z -= dir.z * offset;
        car.group.position.add(perp.clone().multiplyScalar(sideOffset));
        car.group.position.y = 0;
        car.group.rotation.y = angle;
        car.rotation = angle;
        car.waypointIndex = 0;
        car.lapCount = 0;
        car.speed = 0;
        car.distanceTraveled = 0;
    });
}

function showNotification(text) {
    const notif = document.getElementById('hud-notification');
    const textEl = document.getElementById('notification-text');
    textEl.textContent = text;
    notif.style.display = 'block';
    notif.style.animation = 'none';
    void notif.offsetWidth;
    notif.style.animation = 'notifPulse 0.5s ease';

    setTimeout(() => {
        notif.style.display = 'none';
    }, 2000);
}

// ==========================================
// INPUT HANDLING
// ==========================================
function setupInput() {
    window.addEventListener('keydown', (e) => {
        keys[e.key] = true;

        if (e.key === 'c' || e.key === 'C') {
            cameraMode = (cameraMode + 1) % cameraModes.length;
            showNotification(cameraModes[cameraMode].toUpperCase());
        }

        if (e.key === 'r' || e.key === 'R') {
            // Reset car to nearest track point
            if (state === GameState.RACING || state === GameState.FREE_ROAM) {
                const nearestWp = track.waypoints[playerCar.waypointIndex];
                const nextWp = track.waypoints[(playerCar.waypointIndex + 1) % track.waypoints.length];
                const dir = new THREE.Vector3().subVectors(nextWp, nearestWp).normalize();

                playerCar.group.position.copy(nearestWp);
                playerCar.group.position.y = 0;
                playerCar.rotation = Math.atan2(dir.x, dir.z);
                playerCar.group.rotation.y = playerCar.rotation;
                playerCar.speed = 0;
                playerCar.steerAngle = 0;
                playerCar.angularVelocity = 0;
                showNotification('RESET');
            }
        }

        if (e.key === 'Escape') {
            if (state === GameState.RACING || state === GameState.FREE_ROAM) {
                togglePause();
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        keys[e.key] = false;
    });
}

function togglePause() {
    if (isPaused) {
        isPaused = false;
        document.getElementById('pause-menu').style.display = 'none';
        state = gameMode === 'race' ? GameState.RACING : GameState.FREE_ROAM;
        clock.start();
    } else {
        isPaused = true;
        document.getElementById('pause-menu').style.display = 'block';
        state = GameState.PAUSED;
    }
}

// ==========================================
// UI EVENT HANDLERS
// ==========================================
function setupUI() {
    // Quick Race
    document.getElementById('btn-quick-race').addEventListener('click', () => {
        gameMode = 'race';
        document.getElementById('main-menu').style.display = 'none';
        document.getElementById('game-hud').style.display = 'block';
        numLaps = parseInt(document.getElementById('setting-laps').value);
        difficulty = document.getElementById('setting-difficulty').value;
        weatherType = document.getElementById('setting-weather').value;
        const stats = getCarStats(selectedCar);
        playerCar.maxSpeed = stats.maxSpeed;
        playerCar.acceleration = stats.acceleration;
        playerCar.braking = stats.braking;
        playerCar.handling = stats.handling;
        setupWeather();
        resetRace();
        startCountdown();
    });

    // Free Roam
    document.getElementById('btn-free-roam').addEventListener('click', () => {
        gameMode = 'free_roam';
        state = GameState.FREE_ROAM;
        document.getElementById('main-menu').style.display = 'none';
        document.getElementById('game-hud').style.display = 'block';
        weatherType = document.getElementById('setting-weather').value;
        const stats = getCarStats(selectedCar);
        playerCar.maxSpeed = stats.maxSpeed;
        playerCar.acceleration = stats.acceleration;
        playerCar.braking = stats.braking;
        playerCar.handling = stats.handling;
        setupWeather();
        raceStarted = true;
        resetRace();
        raceStarted = true; // Override reset
        showNotification('FREE ROAM');
    });

    // Garage
    document.getElementById('btn-garage').addEventListener('click', () => {
        document.getElementById('main-menu').style.display = 'none';
        document.getElementById('garage-screen').style.display = 'block';
    });

    document.getElementById('btn-garage-back').addEventListener('click', () => {
        document.getElementById('garage-screen').style.display = 'none';
        document.getElementById('main-menu').style.display = 'block';
    });

    // Car selection
    document.querySelectorAll('.car-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.car-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedCar = card.dataset.car;
        });
    });

    document.getElementById('btn-select-car').addEventListener('click', () => {
        // Update player car color
        const color = CONFIG.CAR_COLORS[selectedCar];
        playerCar.group.children[0].material.color.setHex(color);

        // Update stats
        const stats = getCarStats(selectedCar);
        playerCar.maxSpeed = stats.maxSpeed;
        playerCar.acceleration = stats.acceleration;
        playerCar.braking = stats.braking;
        playerCar.handling = stats.handling;

        document.getElementById('garage-screen').style.display = 'none';
        document.getElementById('main-menu').style.display = 'block';
        showNotification('CAR SELECTED');
    });

    // Settings
    document.getElementById('btn-settings').addEventListener('click', () => {
        document.getElementById('main-menu').style.display = 'none';
        document.getElementById('settings-screen').style.display = 'block';
    });

    document.getElementById('btn-settings-back').addEventListener('click', () => {
        document.getElementById('settings-screen').style.display = 'none';
        document.getElementById('main-menu').style.display = 'block';
        applySettings();
    });

    // Pause
    document.getElementById('btn-pause').addEventListener('click', togglePause);
    document.getElementById('btn-resume').addEventListener('click', togglePause);

    document.getElementById('btn-restart').addEventListener('click', () => {
        isPaused = false;
        document.getElementById('pause-menu').style.display = 'none';
        resetRace();
        if (gameMode === 'race') {
            startCountdown();
        } else {
            state = GameState.FREE_ROAM;
            raceStarted = true;
        }
    });

    document.getElementById('btn-quit').addEventListener('click', () => {
        isPaused = false;
        document.getElementById('pause-menu').style.display = 'none';
        document.getElementById('game-hud').style.display = 'none';
        document.getElementById('main-menu').style.display = 'block';
        state = GameState.MENU;
        raceStarted = false;
    });

    // Results
    document.getElementById('btn-race-again').addEventListener('click', () => {
        document.getElementById('results-screen').style.display = 'none';
        document.getElementById('game-hud').style.display = 'block';
        resetRace();
        startCountdown();
    });

    document.getElementById('btn-results-menu').addEventListener('click', () => {
        document.getElementById('results-screen').style.display = 'none';
        document.getElementById('main-menu').style.display = 'block';
        state = GameState.MENU;
    });
}

function applySettings() {
    qualitySetting = document.getElementById('setting-quality').value;
    difficulty = document.getElementById('setting-difficulty').value;
    numLaps = parseInt(document.getElementById('setting-laps').value);
    weatherType = document.getElementById('setting-weather').value;

    // Quality settings
    switch (qualitySetting) {
        case 'low':
            renderer.setPixelRatio(1);
            renderer.shadowMap.enabled = false;
            break;
        case 'medium':
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.BasicShadowMap;
            break;
        case 'high':
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFShadowMap;
            break;
        case 'ultra':
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            break;
    }
}

// ==========================================
// LOADING
// ==========================================
function simulateLoading() {
    const fill = document.getElementById('loading-bar-fill');
    const text = document.getElementById('loading-text');
    let progress = 0;

    const messages = [
        'Loading terrain...',
        'Generating track...',
        'Building city...',
        'Spawning vehicles...',
        'Calibrating physics...',
        'Setting up AI...',
        'Preparing weather...',
        'Almost ready...'
    ];

    const interval = setInterval(() => {
        progress += Math.random() * 15 + 5;
        if (progress >= 100) {
            progress = 100;
            fill.style.width = '100%';
            text.textContent = 'Ready!';

            setTimeout(() => {
                document.getElementById('loading-screen').style.display = 'none';
                document.getElementById('main-menu').style.display = 'block';
                state = GameState.MENU;
            }, 500);
            clearInterval(interval);
        } else {
            fill.style.width = progress + '%';
            text.textContent = messages[Math.floor(progress / 13)] || messages[messages.length - 1];
        }
    }, 200);
}

// ==========================================
// RESIZE
// ==========================================
function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==========================================
// GAME LOOP
// ==========================================
function animate() {
    requestAnimationFrame(animate);

    if (isPaused) {
        renderer.render(scene, camera);
        return;
    }

    const dt = Math.min(clock.getDelta(), 0.05); // Cap delta time

    if (state === GameState.RACING || state === GameState.FREE_ROAM) {
        // Update race time
        if (raceStarted && !raceFinished) {
            raceTime += dt;
        }

        // Update player
        updatePlayer(dt);

        // Update AI
        aiCars.forEach(car => updateAI(car, dt));

        // Update camera
        updateCamera(dt);

        // Update particles
        updateParticles(dt);

        // Update weather
        updateWeather(dt);

        // Update HUD
        updateHUD();
    } else if (state === GameState.COUNTDOWN) {
        updateCamera(dt);
    } else if (state === GameState.MENU || state === GameState.GARAGE || state === GameState.SETTINGS) {
        // Slowly rotate camera around the scene for menu background
        const time = Date.now() * 0.0001;
        camera.position.set(
            Math.cos(time) * 150,
            80,
            Math.sin(time) * 150
        );
        camera.lookAt(0, 0, 0);
    }

    renderer.render(scene, camera);
}

// ==========================================
// START GAME
// ==========================================
init();
setupUI();
animate();
