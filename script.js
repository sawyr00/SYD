console.log('🟢 script.js has started running');


// ───────────────────────────────────────────────────────
// 1) IMPORTS
// ───────────────────────────────────────────────────────
import * as THREE    from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';
import { identifyNarbyRegions } from './face-regions.js';

// ───────────────────────────────────────────────────────
// 2) PRELOADER HIDING
// ───────────────────────────────────────────────────────
function hidePreloader() {
  const pre  = document.getElementById('preloader');
  const main = document.getElementById('main-content');

  // immediately remove the overlay
  pre?.remove();

  // show your real content
  main.style.visibility = 'visible';
}


// ───────────────────────────────────────────────────────
// 3) LOADING MANAGER
// ───────────────────────────────────────────────────────
// This manager tracks **all** loader.load() calls and
// fires .onLoad() once every one of them completes.
// ───────────────────────────────────────────────────────
// 3) LOADING MANAGER (with progress)
// ───────────────────────────────────────────────────────
const manager = new THREE.LoadingManager(
  // onLoad: once every asset has finished
  () => hidePreloader(),

  // onProgress: (url, itemsLoaded, itemsTotal)
  (url, itemsLoaded, itemsTotal) => {
    // ← guard against missing element
    const bar = document.getElementById('progress-bar');
    if (bar) {
      const pct = (itemsLoaded / itemsTotal) * 100;
      bar.style.width = pct + '%';
    }
  },


  // onError: if any asset errors out, still clear the preloader
  url => {
    console.warn(`Failed to load ${url}, continuing…`);
    hidePreloader();
  }
);


// ───────────────────────────────────────────────────────
// 4) GLTF LOADER
// ───────────────────────────────────────────────────────
// Pass our manager into the loader so it tracks all loads
const loader = new GLTFLoader(manager);

// ───────────────────────────────────────────────────────
// 5) SCENE SETUP
// ───────────────────────────────────────────────────────
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

camera.fov = 30; // less distortion
camera.updateProjectionMatrix();

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
const wallpaperStage = document.createElement('div');
wallpaperStage.className = 'wallpaper-stage';
wallpaperStage.setAttribute('aria-hidden', 'true');
document.body.prepend(wallpaperStage);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableRotate = false;
controls.enableDamping   = true;
controls.dampingFactor   = 0.05;

// Enable shadow maps on the renderer
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

// …and now your rain‐spawning and main‐model loader calls will all be
// tracked by the manager above—no further preloader logic needed in those callbacks.

// Softer ambient fill
scene.add(new THREE.AmbientLight(0xFF99AA, 0.2));

// Pink sky / darker ground
scene.add(new THREE.HemisphereLight(
  0xFF99AA,   // sky color
  0x442233,   // ground color (optional tweak)
  0.2
));

// Pink‐tinted directional key lights
[[5,5,5], [-5,5,5], [-5,-5,5], [5,-5,-5], [0,0,10]].forEach(([x,y,z]) => {
  const dir = new THREE.DirectionalLight(0xFFDDEE, 0.8);
  dir.position.set(x, y, z);
  dir.castShadow = true;

  // enable shadows
  const d = 10;
  dir.shadow.camera.left   = -d;
  dir.shadow.camera.right  =  d;
  dir.shadow.camera.top    =  d;
  dir.shadow.camera.bottom = -d;
  dir.castShadow = true;
  dir.shadow.bias = -0.0001;
  dir.shadow.normalBias = 0.02;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.near = 0.5;
  dir.shadow.camera.far  =  20;
  dir.shadow.camera.updateProjectionMatrix();



  scene.add(dir);
});

// ─── Rain spawn / kill parameters ───
const RAIN_TOTAL       = 50;
const SPAWN_Y_MIN      = 30;    // how high they start
const SPAWN_Y_MAX      = 60;
const SPAWN_XZ_RAD     = 50;    // ±range in X and Z
const KILL_Y           = -30;   // when to remove them
const CARTRIDGE_CLEAR_XZ = 10;  // avoid spawning within 10 units of cartridge

// ─── Seed per-instance randomness ───────────────────────
// (Place this **immediately** after your Rain Instancing Setup loader block,
//  i.e. just after `rainMesh.geometry.attributes.instanceOpacity.needsUpdate = true;`)



// per-instance randomness arrays
const fallSpeeds = [];   // how fast each drop falls
const rotAxes    = [];   // spin axis per drop
const rotSpeeds  = [];   // spin speed per drop
const scales     = [];   // uniform scale per drop


const palette = [
  new THREE.Color(0xFFFF33), // yellow
  new THREE.Color(0xFF3333), // red
  new THREE.Color(0xFF33CC), // pink
  new THREE.Color(0xFF8800), // orange
  new THREE.Color(0x8B4513)  // brown
];

// ───────────────────────────────────────────────────────

// alias for our instanced loop
const RAIN_COUNT = RAIN_TOTAL;

// ─── Instanced‐mesh globals ───
let rainMesh;                   // hold the InstancedMesh if you ever use it
let rainDummy = new THREE.Object3D();  // helper for matrix updates

// ─── Drop spawner state ───
const drops = [];
let dropGeometry, dropMaterial;


// ─── Drop initializer (INSERT HERE!) ─────────────────────
function initDrops(srcMesh) {
  dropGeometry = srcMesh.geometry;
  dropMaterial = srcMesh.material.clone();


}

// Model & rotation state
let model;
let squashGroup;  // group for rotating squash/stretch axes
const headSwapRig = new THREE.Group();
let narbyModel;
let gregModel;
let narbyHoverHeight;
let gregHoverHeight;
let headSwap = null;
let gregLoadPromise;
let gregSwapRequested = false;
let gregBlinkMixer;
let gregBlinkActions = [];
let gregNextBlink = Infinity;
let hoverHeight = 0;

const maxRotationSpeed = 0.02;
// the idle spin speed we decay back toward each frame
const baseRotationVelocity = new THREE.Vector3(0.002, 0.002, 0.002);
let spinOffset = new THREE.Vector3(0, 0, 0);
const rotationFriction = 0.004;
const maxSpinOffset = 0.1;
// if you still want a constant roll around Z when idle:
const baseRotationZ = baseRotationVelocity.z;
let defaultCameraZ = 5;
let initialModelScale = 0.6;
const gregBaseScale = initialModelScale * 1.14;


const turnVelocity = new THREE.Vector2();
/**
 * Change all DirectionalLights in the scene to the given hex color.
 */
function setDirectionalLightsColor(hexColor) {
  scene.traverse(obj => {
    if (obj.isDirectionalLight) {
      obj.color.setHex(hexColor);
    }
  });
}





// ───────────────────────────────────────────────────────
// 4.1) RAIN INSTANCING SETUP (Candy-shell drops)
// ───────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────
// 4.1) RAIN INSTANCING SETUP (Candy-shell drops)
// ───────────────────────────────────────────────────────
loader.load('models/b&b_candyshell_yellow.glb', gltf => {
  // find the one mesh inside the GLTF
  const src = gltf.scene.getObjectByProperty('isMesh', true);
  if (!src) {
    console.error('❌ No mesh found in candy-shell GLTF!');
    return;
  }

  // — STEP 1: seed per-instance randomness arrays —
  for (let i = 0; i < RAIN_TOTAL; i++) {
    fallSpeeds[i] = THREE.MathUtils.randFloat(0.02, 0.1);
    rotAxes[i]    = new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize();
    rotSpeeds[i]  = THREE.MathUtils.randFloat(0.01, 0.05);
    scales[i]     = 0.2;
  }

  // — STEP 2: build the InstancedMesh with per-vertex color support —
  const geom = src.geometry;
  const mat  = src.material.clone();
  mat.transparent  = true;
  mat.depthWrite   = false;
  mat.vertexColors = true;                // enable per-instance tinting

  rainMesh = new THREE.InstancedMesh(geom, mat, RAIN_TOTAL);
  rainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // create & attach an instanceColor buffer (+ tell GPU it's dynamic)
  rainMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(RAIN_TOTAL * 3), 3
  );
  rainMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  rainMesh.geometry.setAttribute('instanceColor', rainMesh.instanceColor);

  scene.add(rainMesh);

  // — STEP 3: per-instance opacity buffer —
  const op = new Float32Array(RAIN_TOTAL).fill(0);
  rainMesh.geometry.setAttribute(
    'instanceOpacity',
    new THREE.InstancedBufferAttribute(op, 1)
  );

  // — STEP 4: initialize positions, scales, **and** colors —
  const dummy = new THREE.Object3D();
  for (let i = 0; i < RAIN_TOTAL; i++) {
    // position & scale
    dummy.position.set(
      THREE.MathUtils.randFloatSpread(SPAWN_XZ_RAD),
      THREE.MathUtils.randFloat(SPAWN_Y_MIN, SPAWN_Y_MAX),
      THREE.MathUtils.randFloatSpread(SPAWN_XZ_RAD)
    );
    dummy.scale.setScalar(scales[i]);
    dummy.updateMatrix();
    rainMesh.setMatrixAt(i, dummy.matrix);

    // color from your palette array (e.g. [yellow, red, pink, orange, brown])
    const c = palette[Math.floor(Math.random() * palette.length)];
    rainMesh.instanceColor.setXYZ(i, c.r, c.g, c.b);

    // start invisible
    op[i] = 0;
  }

  // — STEP 5: upload buffers to the GPU —
  rainMesh.geometry.attributes.instanceOpacity.needsUpdate = true;
 rainMesh.instanceColor.needsUpdate                       = true;

  // finally hide the preloader (so it can finish)
  hidePreloader();
});


// ───────────────────────────────────────────────────────
// 4.3) MAIN MODEL LOADER
// ───────────────────────────────────────────────────────
loader.load('models/Narby_Head-Web.glb', gltf => {
  const head = gltf.scene;
  const box = new THREE.Box3().setFromObject(head);
  const size = box.getSize(new THREE.Vector3());
  head.position.sub(box.getCenter(new THREE.Vector3()));
  model = new THREE.Group();
  model.add(head);
  narbyModel = model;
  prepareFaceStretch(head, size);
  model.traverse(c => {
    if (c.isMesh) {
      c.castShadow    = true;
      c.receiveShadow = true;
    }
  });

  // center + light
  hoverHeight = size.y * initialModelScale * 0.045;
  narbyHoverHeight = hoverHeight;
  const fill   = new THREE.PointLight(0xffffff, 0.8, 10);
  fill.position.set(0,2,2);
  fill.castShadow = false;
  model.add(fill);

  model.scale.setScalar(initialModelScale);

  squashGroup = new THREE.Group();
  headSwapRig.add(model);
  squashGroup.add(headSwapRig);
  scene.add(squashGroup);

  const keyLight = new THREE.SpotLight(0xffffff, 0.1);
  keyLight.position.set(5,5,5);
  keyLight.target = model;
  keyLight.castShadow = true;
  scene.add(keyLight);

  // position camera
  const fov  = camera.fov * Math.PI / 180;
  const frameSize = Math.max(size.y, size.x / camera.aspect) * initialModelScale;
  defaultCameraZ = frameSize / (2 * Math.tan(fov / 2)) * 1.55 + size.z * initialModelScale / 2;
  camera.position.set(0,0,defaultCameraZ);
  controls.target.set(0,0,0);
  controls.update();
  window.setTimeout(updateGregVisibility, 0);
}, undefined, err => {
  console.error('Failed to load main model:', err);
});



// Window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Smooth reset
let resetInProgress = false;
function smoothResetCamera() {
  if (resetInProgress || !model || headSwap) return;
  if (faceGrab) finishFaceGrab(faceGrab.pointerId);
  const faceReset = (model === narbyModel ? faceMeshes : [])
    .filter(part => part.changed)
    .map(part => ({ part, start: part.position.array.slice() }));
  if (faceReset.length) playSoundEffect(bounceBackSound);
  const pupilReset = facePupils.map(pupil => ({ pupil, start: pupil.anchor.offset.clone() }));
  if (model === narbyModel) {
    for (const anchor of faceAnchors) anchor.offset.set(0, 0, 0);
  }
  resetInProgress = true;
  turnVelocity.set(0, 0);
  controls.enabled = false;
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const startScale = model.scale.clone();
  const startRotation = model.quaternion.clone();
  const frontRotation = new THREE.Quaternion();
  const center = new THREE.Vector3();
  const startTime = performance.now();
  const centerDuration = 1000 / 3;
  const bounceDuration = faceReset.length ? 1350 : 0;
  function frame() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / centerDuration, 1);
    const eased = t * t * (3 - 2 * t);
    camera.position.lerpVectors(
      startPos,
      new THREE.Vector3(0, 0, defaultCameraZ),
      eased
    );
    model.scale.lerpVectors(
      startScale,
      new THREE.Vector3().setScalar(model === gregModel ? gregBaseScale : initialModelScale),
      eased
    );
    model.quaternion.slerpQuaternions(startRotation, frontRotation, eased);
    controls.target.lerpVectors(startTarget, center, eased);
    if (faceReset.length) {
      const seconds = elapsed / 1000;
      const remaining = Math.exp(-2.6 * seconds) * Math.cos(24 * seconds)
        * (1 - THREE.MathUtils.smoothstep(elapsed, bounceDuration - 150, bounceDuration));
      const finished = elapsed >= bounceDuration;
      resetFacePose(faceReset, remaining, finished);
      if (!finished) {
        for (const { pupil, start } of pupilReset) {
          pupil.anchor.offset.copy(start).multiplyScalar(remaining);
          positionPupil(pupil);
          updateFaceGeometry(pupil.part);
        }
      } else {
        for (const { pupil } of pupilReset) pupil.anchor.offset.set(0, 0, 0);
        faceReset.length = 0;
      }
    }
    controls.update();
    if (t < 1 || faceReset.length) requestAnimationFrame(frame);
    else {
      resetInProgress = false;
      controls.enabled = true;
    }
  }
  frame();
}
window.addEventListener('keydown', e => {
  if (['c', 'r'].includes(e.key.toLowerCase())) smoothResetCamera();
});

// Archived drag-to-spin controls (inactive)
/*
// ─── Arcball rotation state & helper ───
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();
let   isHeld    = false;
let   prevArcballVec = new THREE.Vector3();
let   baseModelQuat  = new THREE.Quaternion();

// ─── Quaternion‐based momentum for greased‑bearing spin ───
let   momentumQuat   = new THREE.Quaternion();  // stores last drag‑delta quaternion
const quatFriction   = 0.02;                     // how fast momentum decays



/ **
 * Map screen coords → unit-sphere vector for arcball
 * /
function getArcballVector(clientX, clientY) {
  const x = (clientX / window.innerWidth)  * 2 - 1;
  const y = 1 - (clientY / window.innerHeight) * 2;
  const len2 = x*x + y*y;
  const v = new THREE.Vector3(x, y, 0);
  v.z = len2 <= 1 ? Math.sqrt(1 - len2) : 0;
  return v.normalize();
}


// Drag inertia
let isDragging = false;
let prevMouse = new THREE.Vector2();
let mouseDragVelocity = new THREE.Vector2();
renderer.domElement.addEventListener('mousedown', e => {
  if (e.button !== 0 || resetInProgress) return;
  isDragging = true;
  prevMouse.set(e.clientX, e.clientY);
  maybeStartAudio();

  isHeld = false;
  if (model) {
    // hit‐test
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(model, true);
    if (hits.length > 0) {
      isHeld = true;
      // capture starting orientation & arcball vector
      prevArcballVec.copy(getArcballVector(e.clientX, e.clientY));
      baseModelQuat.copy(model.quaternion);
 // ─── RESET momentum for this drag ───
  momentumQuat.identity();
    }
  }

  // disable camera orbit only if dragging the model
  controls.enabled = !isHeld;
});


renderer.domElement.addEventListener('mousemove', e => {
  if (!isDragging) return;

  if (isHeld) {
    // arcball rotation
    const currVec = getArcballVector(e.clientX, e.clientY);

    // axis = prev × curr, angle = arccos(prev • curr)
    const axis  = new THREE.Vector3().crossVectors(prevArcballVec, currVec).normalize();
    const dot   = THREE.MathUtils.clamp(prevArcballVec.dot(currVec), -1, 1);
    const angle = Math.acos(dot);

    // build the delta quaternion for this small motion
    const deltaQuat = new THREE.Quaternion().setFromAxisAngle(axis, angle);

    // apply it on top of the model’s current orientation
    model.quaternion.copy(deltaQuat.clone().multiply(model.quaternion));

    // store it as our “momentum” for after we let go
    momentumQuat.copy(deltaQuat);

    // update for next frame
    prevArcballVec.copy(currVec);
    baseModelQuat.copy(model.quaternion);

  } else {
    // camera-orbit case (or your old spinOffset logic)
    const dx = e.clientX - prevMouse.x;
    const dy = e.clientY - prevMouse.y;
    prevMouse.set(e.clientX, e.clientY);
    // …your orbit/spinOffset code…
  }
});


renderer.domElement.addEventListener('mouseup', () => {
  isHeld     = false;     // lift the “hold” so momentum can decay
  controls.enabled = true; // allow camera orbit again

  isDragging = false;
  mouseDragVelocity.set(0, 0);
});



// if not holding the model, layer on the last-drag momentum and decay it
if (!isHeld && !resetInProgress) {
  model.quaternion.multiply(momentumQuat);
  momentumQuat.slerp(new THREE.Quaternion(), quatFriction);
}
*/

// Drag to stretch the face. Pointer events share the same path for mouse and touch.
const faceMeshes = [];
const facePupils = [];
const faceAnchors = [];
const skinAnchors = [];
let faceStretchUnlocked = false;
let faceGrab = null;
let maxFacePull = 0;
const faceRay = new THREE.Raycaster();
const facePointer = new THREE.Vector2();
const faceVertex = new THREE.Vector3();
const faceHit = new THREE.Vector3();
const faceDelta = new THREE.Vector3();
const faceNormal = new THREE.Vector3();

// Coordinates are fractions of the half-width and half-height of Narby's neutral head.
const narbyGrabPoints = [
  [-0.59, 0.06], [0.59, 0.06],   // cheeks
  [0, -0.05],                    // muzzle
  [-0.46, -0.30], [0.46, -0.30], // mouth corners
  [0, -0.74],                    // chin
  [-0.43, 0.36], [0.43, 0.36],   // temples
  [0, 0.54]                      // forehead
];

function prepareFaceStretch(head, size) {
  model.updateMatrixWorld(true);
  const regionAnchors = new Map();
  const earRegions = new Map();
  const eyeRegions = new Map();
  const followers = [];
  const pupils = [];
  const makeAnchor = () => {
    const anchor = { offset: new THREE.Vector3(), parts: new Set() };
    faceAnchors.push(anchor);
    return anchor;
  };
  head.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    const normal = mesh.geometry.getAttribute('normal');
    position.setUsage(THREE.DynamicDrawUsage);
    const part = {
      mesh,
      position,
      neutral: position.array.slice(),
      neutralNormals: normal?.array.slice(),
      inverseLinear: new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld.clone().invert()),
      regions: new Array(position.count),
      vertices: [],
      changed: false
    };
    faceMeshes.push(part);
    for (const region of identifyNarbyRegions(position.array, mesh.geometry.index.array)) {
      for (const index of region.vertices) part.regions[index] = region;
      if (region.name === 'skin' || region.name.endsWith('-center-tooth')) continue;
      if (region.follower) {
        followers.push({ part, region });
        continue;
      }
      if (!regionAnchors.has(region.name)) {
        regionAnchors.set(region.name, makeAnchor());
      }
      region.anchor = regionAnchors.get(region.name);
      region.anchor.parts.add(part);
      if (region.name.endsWith('-ear')) earRegions.set(region.name, region);
      if (region.name.endsWith('-eye-white')) eyeRegions.set(region.name, { part, region });
      const pointCount = region.name.endsWith('-ear') ? 9 : region.name === 'nose' ? 7
        : region.name.endsWith('-eye-white') ? 8 : 0;
      if (pointCount) {
        region.points = [];
        const candidates = region.vertices.map(index => new THREE.Vector3()
          .fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld));
        distributeFacePoints(region.points, candidates, pointCount, makeAnchor);
        for (const point of region.points) point.parts.add(part);
      }
      if (region.name.endsWith('-pupil')) {
        pupils.push({ part, region, anchor: region.anchor });
        continue;
      }
      for (const index of region.vertices) {
        const weight = regionStretchWeight(region, part.neutral, index);
        let weights = [{ anchor: region.anchor, weight }];
        if (region.points) {
          faceVertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
          weights = localizedWeights(region.points, faceVertex, weight, size.y * 0.17);
        }
        part.vertices.push({ index, weights });
      }
    }
  });

  for (const { part, region } of followers) {
    const ear = earRegions.get(region.name);
    const weight = regionStretchWeight(ear, region.center, 0);
    faceVertex.fromArray(region.center).applyMatrix4(part.mesh.matrixWorld);
    const weights = localizedWeights(ear.points, faceVertex, weight, size.y * 0.17);
    for (const { anchor } of weights) anchor.parts.add(part);
    for (const index of region.vertices) {
      part.vertices.push({ index, weights });
    }
  }
  for (const pupil of pupils) {
    const eye = eyeRegions.get(pupil.region.name.replace('pupil', 'eye-white'));
    if (!eye) continue;
    const indices = eye.part.mesh.geometry.index.array;
    const front = THREE.MathUtils.lerp(eye.region.min[2], eye.region.max[2], 0.48);
    pupil.eye = eye.part;
    pupil.surface = [];
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      if ([a, b, c].every(index => eye.part.regions[index] === eye.region)
          && (eye.part.neutral[a * 3 + 2] + eye.part.neutral[b * 3 + 2] + eye.part.neutral[c * 3 + 2]) / 3 >= front) {
        pupil.surface.push(a, b, c);
      }
    }
    if (!pupil.surface.length) continue;
    const { center, min } = pupil.region;
    const base = new THREE.Vector3(center[0], center[1], min[2]);
    const attachment = {};
    pupil.origin = projectPupil(pupil, base, new THREE.Vector3(), attachment);
    pupil.attachIndices = attachment.indices;
    pupil.attachWeights = attachment.weights;
    facePupils.push(pupil);
  }

  const skinParts = faceMeshes.filter(part => part.regions.some(region => region.name === 'skin'));
  const skinMeshes = skinParts.map(part => part.mesh);
  const origin = new THREE.Vector3();
  const forwardRay = new THREE.Vector3(0, 0, -1);
  for (const [x, y] of narbyGrabPoints) {
    origin.set(x * size.x / 2, y * size.y / 2, size.z);
    faceRay.set(origin, forwardRay);
    const hit = faceRay.intersectObjects(skinMeshes, false)
      .find(candidate => skinParts.find(part => part.mesh === candidate.object)
        .regions[candidate.face.a].name === 'skin');
    if (hit) {
      const anchor = { point: hit.point.clone(), offset: new THREE.Vector3(), parts: new Set() };
      skinAnchors.push(anchor);
      faceAnchors.push(anchor);
    }
  }
  const skinCandidates = skinParts.flatMap(part => part.regions.flatMap((region, index) =>
    region.name === 'skin'
      ? [new THREE.Vector3().fromBufferAttribute(part.position, index).applyMatrix4(part.mesh.matrixWorld)]
      : []));
  distributeFacePoints(skinAnchors, skinCandidates, 36, makeAnchor);

  const influenceRadius = size.y * 0.23;
  maxFacePull = size.y * 0.25;
  for (const part of skinParts) {
    for (let index = 0; index < part.position.count; index++) {
      if (part.regions[index].name !== 'skin') continue;
      faceVertex.fromBufferAttribute(part.position, index).applyMatrix4(part.mesh.matrixWorld);
      const weights = localizedWeights(skinAnchors, faceVertex, 1, influenceRadius);
      for (const { anchor } of weights) anchor.parts.add(part);
      if (weights.length) part.vertices.push({ index, weights });
    }
  }
}

const pupilTriangle = new THREE.Triangle();
const pupilCandidate = new THREE.Vector3();
const pupilTarget = new THREE.Vector3();
const pupilDisplacement = new THREE.Vector3();

function projectPupil(pupil, target, result, attachment) {
  let closest = Infinity;
  const surface = pupil.surface;
  const position = pupil.eye.position;
  for (let i = 0; i < surface.length; i += 3) {
    pupilTriangle.a.fromBufferAttribute(position, surface[i]);
    pupilTriangle.b.fromBufferAttribute(position, surface[i + 1]);
    pupilTriangle.c.fromBufferAttribute(position, surface[i + 2]);
    pupilTriangle.closestPointToPoint(target, pupilCandidate);
    const distance = pupilCandidate.distanceToSquared(target);
    if (distance >= closest) continue;
    closest = distance;
    result.copy(pupilCandidate);
    if (attachment) {
      attachment.indices = surface.slice(i, i + 3);
      attachment.weights = pupilTriangle.getBarycoord(pupilCandidate, new THREE.Vector3()).toArray();
    }
  }
  return result;
}

function positionPupil(pupil) {
  pupilTarget.set(0, 0, 0);
  for (let i = 0; i < 3; i++) {
    faceVertex.fromBufferAttribute(pupil.eye.position, pupil.attachIndices[i]);
    pupilTarget.addScaledVector(faceVertex, pupil.attachWeights[i]);
  }
  pupilTarget.add(faceDelta.copy(pupil.anchor.offset).applyMatrix3(pupil.part.inverseLinear));
  projectPupil(pupil, pupilTarget, pupilDisplacement).sub(pupil.origin);
  const { position, neutral } = pupil.part;
  for (const index of pupil.region.vertices) {
    const i = index * 3;
    position.setXYZ(index, neutral[i] + pupilDisplacement.x,
      neutral[i + 1] + pupilDisplacement.y, neutral[i + 2] + pupilDisplacement.z);
  }
}

function distributeFacePoints(points, candidates, count, makeAnchor) {
  while (points.length < count && candidates.length) {
    let farthest = candidates[0];
    let greatestDistance = -1;
    for (const candidate of candidates) {
      let distance = Infinity;
      for (const point of points) distance = Math.min(distance, candidate.distanceToSquared(point.point));
      if (distance > greatestDistance) {
        farthest = candidate;
        greatestDistance = distance;
      }
    }
    if (greatestDistance <= 0) break;
    const anchor = makeAnchor();
    anchor.point = farthest.clone();
    points.push(anchor);
  }
}

function localizedWeights(points, vertex, strength, radius) {
  const weights = [];
  let nearest = points[0];
  let nearestDistance = Infinity;
  for (const anchor of points) {
    const distance = vertex.distanceTo(anchor.point);
    if (distance < nearestDistance) {
      nearest = anchor;
      nearestDistance = distance;
    }
    if (distance < radius) {
      weights.push({ anchor, weight: strength * (1 - THREE.MathUtils.smoothstep(distance, 0, radius)) });
    }
  }
  if (!weights.length && nearest) weights.push({ anchor: nearest, weight: strength * 0.1 });
  return weights;
}

function hatBillWeight(positions, index) {
  const i = index * 3;
  return THREE.MathUtils.smoothstep(-positions[i + 2], 1.05, 1.95)
    * (1 - THREE.MathUtils.smoothstep(positions[i + 1], 1.25, 1.75));
}

function regionStretchWeight(region, positions, index) {
  const i = index * 3;
  if (region.name === 'hat') {
    const distance = Math.hypot(positions[i], positions[i + 1] - 0.53, positions[i + 2] + 0.75);
    const capWeight = THREE.MathUtils.smoothstep(distance, 0.18, 1.65);
    const atBill = THREE.MathUtils.smoothstep(hatBillWeight(positions, index), 0.3, 0.5);
    // Every vertex on the bill, including the stitching, follows the same offset.
    return THREE.MathUtils.lerp(capWeight, 0.5, atBill);
  }
  if (region.axis === undefined) return 1;
  const min = region.min[region.axis];
  const max = region.max[region.axis];
  if (max === min) return 1;
  const value = positions[i + region.axis];
  const fraction = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
  const t = region.reverse ? 1 - fraction : fraction;
  const seam = region.midline === undefined
    ? 1 : THREE.MathUtils.smoothstep(Math.abs(positions[i] - region.midline), 0, 0.09);
  return t * t * (3 - 2 * t) * seam;
}

function setFaceRay(clientX, clientY) {
  const bounds = renderer.domElement.getBoundingClientRect();
  facePointer.set(
    (clientX - bounds.left) / bounds.width * 2 - 1,
    1 - (clientY - bounds.top) / bounds.height * 2
  );
  camera.updateMatrixWorld();
  faceRay.setFromCamera(facePointer, camera);
}

function updateFaceGeometry(part, restoreNormals = false) {
  const geometry = part.mesh.geometry;
  part.position.needsUpdate = true;
  if (restoreNormals && part.neutralNormals) {
    const normal = geometry.getAttribute('normal');
    normal.array.set(part.neutralNormals);
    normal.needsUpdate = true;
  } else {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingSphere();
  if (geometry.boundingBox) geometry.computeBoundingBox();
}

function startFaceGrab(event) {
  if (event.button !== 0 || resetInProgress || faceGrab || headSwap) return;
  if (!faceStretchUnlocked) {
    maybeStartAudio();
    return;
  }
  if (model !== narbyModel || !model || !faceAnchors.length) return;
  scene.updateMatrixWorld(true);
  setFaceRay(event.clientX, event.clientY);
  const hit = faceRay.intersectObjects(faceMeshes.map(part => part.mesh), false)[0];
  if (!hit) return;
  const part = faceMeshes.find(part => part.mesh === hit.object);
  const localHit = hit.object.worldToLocal(hit.point.clone());
  const hitVertices = [hit.face.a, hit.face.b, hit.face.c];
  hitVertices.sort((a, b) =>
    faceVertex.fromBufferAttribute(part.position, a).distanceToSquared(localHit)
    - faceVertex.fromBufferAttribute(part.position, b).distanceToSquared(localHit));
  const region = part.regions[hitVertices[0]];
  if (region.follower) return;
  if (region.name.endsWith('-center-tooth')) return;
  if (region.name === 'hat' && hatBillWeight(part.neutral, hitVertices[0]) >= 0.5) return;

  const inverse = model.matrixWorld.clone().invert();
  const grabOrigin = hit.point.clone().applyMatrix4(inverse);
  let nearest = region.anchor;
  let nearestDistance = Infinity;
  const points = region.name === 'skin' ? skinAnchors : region.points;
  if (points) {
    for (const anchor of points) {
      const distance = faceVertex.copy(anchor.point).add(anchor.offset).distanceToSquared(grabOrigin);
      if (distance < nearestDistance) {
        nearest = anchor;
        nearestDistance = distance;
      }
    }
  }
  if (!nearest) return;

  faceGrab = {
    pointerId: event.pointerId,
    plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(faceNormal), hit.point),
    inverse,
    grabOrigin,
    anchor: nearest,
    startOffset: nearest.offset.clone(),
    pending: null
  };
  controls.enabled = false;
  turnVelocity.set(0, 0);
  renderer.domElement.setPointerCapture(event.pointerId);
}

function applyFaceGrab() {
  if (!faceGrab?.pending) return;
  const { pending, plane, inverse, grabOrigin, anchor, startOffset } = faceGrab;
  faceGrab.pending = null;
  setFaceRay(pending.x, pending.y);
  if (!faceRay.ray.intersectPlane(plane, faceHit)) return;
  faceDelta.copy(faceHit).applyMatrix4(inverse).sub(grabOrigin).add(startOffset).clampLength(0, maxFacePull);
  if (faceDelta.equals(anchor.offset)) return;
  anchor.offset.copy(faceDelta);

  for (const part of anchor.parts) {
    for (const { index, weights } of part.vertices) {
      faceDelta.set(0, 0, 0);
      for (const { anchor: point, weight } of weights) faceDelta.addScaledVector(point.offset, weight);
      faceDelta.clampLength(0, maxFacePull).applyMatrix3(part.inverseLinear);
      const i = index * 3;
      part.position.setXYZ(
        index,
        part.neutral[i] + faceDelta.x,
        part.neutral[i + 1] + faceDelta.y,
        part.neutral[i + 2] + faceDelta.z
      );
    }
    part.changed = true;
  }
  const changedParts = new Set(anchor.parts);
  for (const pupil of facePupils) {
    if (anchor === pupil.anchor || anchor.parts.has(pupil.eye)) {
      positionPupil(pupil);
      pupil.part.changed = true;
      changedParts.add(pupil.part);
    }
  }
  for (const part of changedParts) updateFaceGeometry(part);
}
function finishFaceGrab(pointerId) {
  if (faceGrab?.pointerId !== pointerId) return;
  applyFaceGrab();
  faceGrab = null;
  if (renderer.domElement.hasPointerCapture(pointerId)) renderer.domElement.releasePointerCapture(pointerId);
  controls.enabled = !resetInProgress;
}

function resetFacePose(parts, remaining, finished) {
  for (const { part, start } of parts) {
    const positions = part.position.array;
    for (let i = 0; i < positions.length; i++) {
      positions[i] = part.neutral[i] + (start[i] - part.neutral[i]) * remaining;
    }
    part.changed = !finished;
    updateFaceGeometry(part, finished);
  }
}

renderer.domElement.addEventListener('pointerdown', startFaceGrab, { capture: true });
renderer.domElement.addEventListener('pointermove', event => {
  if (faceGrab?.pointerId === event.pointerId) {
    faceGrab.pending = { x: event.clientX, y: event.clientY };
  }
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  renderer.domElement.addEventListener(type, event => finishFaceGrab(event.pointerId));
}

// Audio setup
const tracks = [
  "audio/01 - JARRYXSPRINGER - daytime tv.mp3",
  "audio/02 - HEMATIDROSIS - Onward To Babylon.mp3",
  "audio/03 - DC - TODA2000.mp3",
  "audio/04 - CROWN VIC - BENEATH THE ROT FEAT. MORBID ANGEL.mp3",
  "audio/05 - DREW THE ARCHITECT - SEARING GRIP.mp3",
  "audio/06 - 10SCOOPS - CAREER VICTIM.mp3",
  "audio/07 - Hewhocorrupts - Suge Knight is at My BBQ.mp3",
  "audio/08 - SMILEY - Game Goofy.mp3",
  "audio/09 - whatsdysmorphiaxboltcutter - placenta jesus.mp3",
  "audio/10 - SNUFFED ON SIGHT - ALL TALK   BLUNT COUGH (DJ MRD REMIX).mp3"
];
// Fisher–Yates shuffle
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

shuffleArray(tracks);  // ← randomize on every page load

const narbyPlaylist = tracks.map(path => ({ path }));
let gregPlaylist = [];
let activePlaylist = narbyPlaylist;
const playlistPositions = new Map();
let currentTrack = 0;
const audio = new Audio(tracks[currentTrack]);
const buttonPressSound = new Audio('audio/_sound%20fx/button%20press%203.mp3');
const bounceBackSound = new Audio('audio/_sound%20fx/bounceback%20v1.wav');
buttonPressSound.preload = 'auto';
bounceBackSound.preload = 'auto';

function playSoundEffect(sound) {
  sound.currentTime = 0;
  sound.play().catch(error => console.warn('Could not play sound effect:', error));
}

audio.addEventListener('playing', () => { faceStretchUnlocked = true; }, { once: true });
audio.loop = false;
audio.preload = 'auto';
let userHasPressedPlay = false;
let isMuted = false;

function maybeStartAudio() {
  if (!userHasPressedPlay) togglePlayPause();
}

// Now Playing overlay with titles
const titleBackdrop = document.createElement('div');
titleBackdrop.className = 'track-title-backdrop';
titleBackdrop.setAttribute('aria-hidden', 'true');
document.body.appendChild(titleBackdrop);

const nowPlaying = document.createElement('div');
nowPlaying.className = 'track-title-strip';
Object.assign(nowPlaying.style, {
  position: 'fixed', top: 'var(--track-title-top, 20px)', left: '50%',
  transform: 'translateX(-50%)', width: '80%', overflow: 'hidden',
  display: 'flex', justifyContent: 'center', alignItems: 'center'
});
document.body.appendChild(nowPlaying);
const nowText = document.createElement('div');
Object.assign(nowText.style, {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, max-content) minmax(0, 1fr)',
  alignItems: 'center',
  gap: 'var(--track-title-gap, 40px)',
  width: '100%',
  minWidth: '0'
});
nowPlaying.appendChild(nowText);

function getBaseName(path) {
  return path.split('/').pop().replace(/^\d+ - /, '');
}

function updateNowPlaying() {
  const gregTitles = activePlaylist === gregPlaylist;
  const titles = [-1, 0, 1].map(offset => {
    const track = activePlaylist[(currentTrack + offset + activePlaylist.length) % activePlaylist.length];
    const title = document.createElement(gregTitles ? 'span' : 'img');
    if (gregTitles) {
      title.className = 'greg-track-title';
      title.textContent = track.title;
      title.title = track.title;
    } else {
      const trackNumber = track.path.split('/').pop().slice(0, 2);
      const suffix = offset === 0 ? '-current' : '';
      title.src = `images/track-titles/${trackNumber}${suffix}.png`;
      title.alt = getBaseName(track.path);
    }
    const fade = offset === 0
      ? 'none'
      : `linear-gradient(to ${offset < 0 ? 'right' : 'left'}, transparent, rgba(0, 0, 0, 0.9))`;
    Object.assign(title.style, {
      display: 'block',
      height: 'auto',
      maxHeight: 'var(--track-title-max-height, 26px)',
      maxWidth: offset === 0
        ? 'max(0px, calc(80vw - 2 * var(--track-title-gap, 40px)))'
        : '100%',
      justifySelf: ['end', 'center', 'start'][offset + 1],
      WebkitMaskImage: fade,
      maskImage: fade
    });
    return title;
  });
  nowText.replaceChildren(...titles);
}
// Initial call to show titles
updateNowPlaying();

// Audio control functions
function playPlaylistAudio() {
  audio.play().catch(error => {
    if (error.name !== 'AbortError') console.warn('Could not play the selected track:', error);
  });
}

function togglePlayPause() {
  userHasPressedPlay = true;
  if (audio.paused) {
    playPlaylistAudio();
  } else {
    audio.pause();
  }
}

function changeTrack(offset) {
  const wasPlaying = !audio.paused;
  currentTrack = (currentTrack + offset + activePlaylist.length) % activePlaylist.length;
  audio.src = activePlaylist[currentTrack].path;
  updateNowPlaying();
  if (wasPlaying) playPlaylistAudio();
}

function switchPlaylist(playlist) {
  if (playlist === activePlaylist || !playlist.length) return;
  const wasPlaying = !audio.paused;
  playlistPositions.set(activePlaylist, { index: currentTrack, time: audio.currentTime });
  activePlaylist = playlist;
  const previous = playlistPositions.get(playlist);
  currentTrack = previous?.index ?? 0;
  audio.src = playlist[currentTrack].path;
  if (previous?.time) audio.currentTime = previous.time;
  updateNowPlaying();
  if (wasPlaying) playPlaylistAudio();
}

function nextTrack() {
  changeTrack(1);
}

function prevTrack() {
  changeTrack(-1);
}

function toggleMute(btn) {
  isMuted = !isMuted; audio.muted = isMuted;
  btn.style.backgroundImage = `url("images/${isMuted?'mutepressed.png':'mute.png'}")`;
}

// Button factory
function createIconButton({ id, image, pressedImage, onClick, topOffset, rightOffset, toggle = false }) {
  const isGregButton = id === 'bbBtn';
  const btn = document.createElement(isGregButton ? 'div' : 'button');
  btn.addEventListener('pointerdown', event => {
    if (event.button === 0) playSoundEffect(buttonPressSound);
  });
  btn.addEventListener('click', event => {
    if (event.detail === 0) playSoundEffect(buttonPressSound);
  });
  btn.id = id;
  btn.dataset.icon = id;

  // ─── RESET ANY BACKGROUND ───
  btn.style.background      = 'none';               // remove any shorthand background
  btn.style.backgroundColor = 'transparent';        // fully transparent canvas

  const version = isGregButton ? '?v7' : '';
  const defaultArt = `url("images/${image}${version}")`;
  const pressedArt = `url("images/${pressedImage}${version}")`;
  const pressedPreload = new Image();
  pressedPreload.src = `images/${pressedImage}${version}`;
  pressedPreload.decode().catch(() => {});
  btn.style.backgroundImage = defaultArt;
  btn.style.backgroundRepeat   = 'no-repeat';
  btn.style.backgroundPosition = 'center center';
  btn.style.backgroundSize     = 'contain';
  if (isGregButton) {
    btn.setAttribute('role', 'button');
    btn.tabIndex = 0;
    btn.addEventListener('contextmenu', event => event.preventDefault());
    btn.addEventListener('keydown', event => {
      if (event.key === ' ') event.preventDefault();
      if (event.key === 'Enter' && !event.repeat) btn.click();
    });
    btn.addEventListener('keyup', event => {
      if (event.key === ' ') btn.click();
    });
    const normalImage = new Image();
    normalImage.src = `images/${image}${version}`;
    const artwork = document.createElement('canvas');
    artwork.width = artwork.height = 400;
    artwork.setAttribute('aria-hidden', 'true');
    const context = artwork.getContext('2d');
    const drawArtwork = () => {
      const selected = btn.dataset.pressed && pressedPreload.complete && pressedPreload.naturalWidth
        ? pressedPreload : normalImage;
      if (!selected.complete || !selected.naturalWidth) return;
      context.clearRect(0, 0, 400, 400);
      context.drawImage(selected, 0, 0, 400, 400);
    };
    normalImage.addEventListener('load', drawArtwork);
    pressedPreload.addEventListener('load', drawArtwork);
    new MutationObserver(drawArtwork).observe(btn, { attributes: true, attributeFilter: ['data-pressed'] });
    drawArtwork();
    btn.setAttribute('aria-label', 'Switch to Greg');
    btn.append(artwork);
    btn.style.backgroundImage = 'none';
  }
  // ─────────────────────────────

  Object.assign(btn.style, {
    padding: '0',
    margin:  '0',
    border:    'none',
    cursor:    'pointer',
    position:  'fixed',
    top:       `var(--icon-top, ${topOffset})`,
    right:     `var(--icon-right, ${rightOffset})`,
    width:     'var(--icon-size, 50px)',
    height:    'var(--icon-size, 50px)',
    zIndex:    '10',
    boxSizing: 'border-box'
  });

  if (toggle) {
    btn.addEventListener('click', () => onClick(btn));
  } else {
    let releaseTimer;
    const showPressed = () => {
      window.clearTimeout(releaseTimer);
      if (isGregButton) {
        if (pressedPreload.complete && pressedPreload.naturalWidth) btn.dataset.pressed = 'true';
      } else {
        btn.style.backgroundImage = pressedArt;
      }
    };
    const release = () => {
      window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(() => {
        if (isGregButton) delete btn.dataset.pressed;
        else btn.style.backgroundImage = defaultArt;
      }, 200);
    };
    btn.addEventListener('pointerdown', event => {
      if (event.button === 0) showPressed();
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
      btn.addEventListener(type, release);
    }
    btn.addEventListener('click', () => {
      showPressed();
      onClick();
      release();
    });
  }

  if (id === 'bbBtn') {
    btn.style.display = 'none';
  }

  const shadow = document.createElement('div');
  shadow.className = 'icon-button-shadow';
  shadow.dataset.icon = id;
  shadow.setAttribute('aria-hidden', 'true');
  Object.assign(shadow.style, {
    top: btn.style.top,
    right: btn.style.right,
    width: btn.style.width,
    height: btn.style.height
  });
  const syncShadow = () => {
    Object.assign(shadow.style, {
      backgroundImage: isGregButton
        ? (btn.dataset.pressed ? pressedArt : defaultArt)
        : btn.style.backgroundImage,
      display: btn.style.display,
      transform: btn.style.transform
    });
  };
  syncShadow();
  new MutationObserver(syncShadow).observe(btn, {
    attributes: true,
    attributeFilter: ['style', 'data-pressed']
  });
  document.body.append(shadow, btn);

  return btn;
}


// Instantiate buttons
createIconButton({ id: 'recenterBtn', image: 'rkey.png', pressedImage: 'rkeypressed.png', onClick: smoothResetCamera, topOffset: '75%', rightOffset: '20px' });
createIconButton({ id: 'playPauseBtn', image: 'playpause.png', pressedImage: 'playpausepressed.png', onClick: togglePlayPause, topOffset: '25%', rightOffset: '20px' });
createIconButton({ id: 'nextTrackBtn', image: 'nexttrack.png', pressedImage: 'nexttrackpressed.png', onClick: nextTrack, topOffset: '30%', rightOffset: '20px' });
createIconButton({ id: 'prevTrackBtn', image: 'prevtrack.png', pressedImage: 'prevtrackpressed.png', onClick: prevTrack, topOffset: '35%', rightOffset: '20px' });
createIconButton({ id: 'muteBtn', image: 'mute.png', pressedImage: 'mutepressed.png', onClick: toggleMute, topOffset: '40%', rightOffset: '20px', toggle: true });
const bbBtn = createIconButton({ id: 'bbBtn', image: 'gregkey.png', pressedImage: 'gregkeypressed.png', onClick: toggleGregHead, topOffset: '68px', rightOffset: 'calc(50% - var(--icon-size) / 2)' });

// Turn off test mode to use the visitor's local midnight–6 a.m. window.
const gregTestMode = true;
function gregAvailable() {
  return gregTestMode || new Date().getHours() < 6;
}

function updateGregVisibility() {
  const available = gregAvailable();
  bbBtn.style.display = available && narbyModel && model !== gregModel ? 'block' : 'none';
  if (!available && gregModel && model === gregModel && !headSwap && !resetInProgress) {
    beginHeadSwap(narbyModel);
  }
  if (available) preloadGregHead();
}

function getGregHead() {
  if (!gregLoadPromise) {
    gregLoadPromise = loadGregHead().catch(error => {
      gregLoadPromise = undefined;
      throw error;
    });
  }
  return gregLoadPromise;
}

function preloadGregHead() {
  if (!narbyModel || !gregAvailable() || gregLoadPromise || navigator.connection?.saveData) return;
  getGregHead().catch(error => console.warn('Greg background load failed:', error));
}

async function loadGregHead() {
  const skullTile = new Image();
  skullTile.src = 'images/skullwallpaper-single.png';
  const gregLoader = new GLTFLoader();
  const directory = 'models/GregHeadFinalPieced/';
  const [head, lids, fur, playlist] = await Promise.all([
    gregLoader.loadAsync(directory + 'GregHead-Web.glb'),
    gregLoader.loadAsync(directory + 'Eyeblink-Web.glb'),
    new THREE.TextureLoader().loadAsync('images/greg-eyelid-fur.png'),
    fetch('greg-playlist.json', { cache: 'no-cache' }).then(response => {
      if (!response.ok) throw new Error('Could not load the Greg playlist');
      return response.json();
    }),
    skullTile.decode().catch(() => {})
  ]);
  if (!Array.isArray(playlist) || !playlist.length) throw new Error('The Greg playlist is empty');
  gregPlaylist = playlist;
  shuffleArray(gregPlaylist);
  fur.flipY = false;
  fur.encoding = THREE.sRGBEncoding;
  fur.wrapS = fur.wrapT = THREE.RepeatWrapping;
  const eyelidMaterial = new THREE.MeshStandardMaterial({
    map: fur,
    roughness: 0.85
  });
  lids.scene.traverse(object => {
    if (!object.isMesh) return;
    object.material = eyelidMaterial;
  });
  const aligned = new THREE.Group();
  aligned.add(head.scene, lids.scene);
  aligned.rotation.y = -Math.PI / 2;
  aligned.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(head.scene);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  aligned.position.sub(center);

  const greg = new THREE.Group();
  greg.add(aligned);
  greg.scale.setScalar(gregBaseScale);
  greg.visible = false;
  gregHoverHeight = size.y * gregBaseScale * 0.045;
  gregBlinkMixer = new THREE.AnimationMixer(lids.scene);
  gregBlinkActions = lids.animations.map(clip => {
    const action = gregBlinkMixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    action.paused = true;
    return action;
  });
  gregBlinkMixer.update(0);
  headSwapRig.add(greg);
  gregModel = greg;
}

async function toggleGregHead() {
  if (!narbyModel || model !== narbyModel || headSwap || resetInProgress || gregSwapRequested || !gregAvailable()) return;
  if (!gregModel) {
    gregSwapRequested = true;
    bbBtn.setAttribute('aria-busy', 'true');
    try {
      await getGregHead();
    } catch (error) {
      console.error('Failed to load Greg:', error);
      return;
    } finally {
      gregSwapRequested = false;
      bbBtn.removeAttribute('aria-busy');
    }
  }
  if (gregAvailable() && !resetInProgress && !headSwap) beginHeadSwap(gregModel);
}

function beginHeadSwap(target) {
  if (faceGrab) finishFaceGrab(faceGrab.pointerId);
  turnVelocity.set(0, 0);
  headSwap = { target, started: performance.now() * 0.001, changed: false };
}

function scheduleGregBlink(now) {
  gregNextBlink = now + THREE.MathUtils.randFloat(3.6, 6.4);
}

function updateGregBlink(now, frameSeconds) {
  if (!gregModel || model !== gregModel) return;
  if (!headSwap && now >= gregNextBlink) {
    for (const action of gregBlinkActions) action.reset().play();
    scheduleGregBlink(now);
  }
  gregBlinkMixer.update(frameSeconds);
}

let finishWallpaperTransition;
function transitionWallpaper(toGreg) {
  finishWallpaperTransition?.();
  if (wallpaperStage.classList.contains('greg-wallpaper') === toGreg) return;

  const styles = getComputedStyle(document.body);
  const size = parseFloat(styles.getPropertyValue('--wallpaper-tile-size')) || 400;
  const offset = parseFloat(styles.getPropertyValue('--wallpaper-offset-x')) || 0;
  const startX = ((offset % size) + size) % size - size;
  const layer = document.createElement('div');
  layer.className = toGreg ? 'wallpaper-transition to-greg' : 'wallpaper-transition';
  layer.setAttribute('aria-hidden', 'true');
  const tiles = [];
  for (let y = 0; y < window.innerHeight; y += size) {
    for (let x = startX; x < window.innerWidth; x += size) {
      if (x + size <= 0) continue;
      const tile = document.createElement('div');
      tile.className = 'wallpaper-transition-tile';
      tile.style.left = `${x}px`;
      tile.style.top = `${y}px`;
      tiles.push(tile);
    }
  }

  shuffleArray(tiles);
  const stagger = 4400 / Math.max(1, tiles.length - 1);
  tiles.forEach((tile, index) => {
    tile.style.setProperty('--tile-delay', `${index * stagger}ms`);
  });
  layer.append(...tiles);
  wallpaperStage.append(layer);

  const finish = () => {
    wallpaperStage.classList.toggle('greg-wallpaper', toGreg);
    layer.remove();
    window.clearTimeout(timer);
    window.removeEventListener('resize', finish);
    finishWallpaperTransition = undefined;
  };
  const timer = window.setTimeout(finish, (tiles.length - 1) * stagger + 500);
  finishWallpaperTransition = finish;
  window.addEventListener('resize', finish, { once: true });
}

function updateHeadSwap(now) {
  if (!headSwap) return;
  const halfDuration = 1.5;
  const elapsed = now - headSwap.started;
  if (elapsed >= halfDuration && !headSwap.changed) {
    model.visible = false;
    model = headSwap.target;
    model.visible = true;
    hoverHeight = model === gregModel ? gregHoverHeight : narbyHoverHeight;
    headSwap.changed = true;
    transitionWallpaper(model === gregModel);
    if (model === gregModel) updateGregVisibility();
    switchPlaylist(model === gregModel ? gregPlaylist : narbyPlaylist);
  }
  if (elapsed >= 2 * halfDuration) {
    headSwapRig.position.set(0, 0, 0);
    headSwapRig.rotation.set(0, 0, 0);
    headSwapRig.scale.setScalar(1);
    headSwap = null;
    if (model === gregModel) scheduleGregBlink(now);
    updateGregVisibility();
    return;
  }
  // The incoming head traces the outgoing head's motion backward.
  const phase = elapsed < halfDuration ? elapsed / halfDuration : 2 - elapsed / halfDuration;
  const energy = THREE.MathUtils.smoothstep(phase, 0, 0.55);
  const size = 1 - THREE.MathUtils.smoothstep(phase, 0.05, 1);
  const tumble = phase * phase;
  const vortex = 10 * Math.PI * tumble;
  headSwapRig.rotation.set(
    8 * tumble + Math.sin(phase * 31) * energy * 0.65,
    17 * tumble + Math.sin(phase * 41) * energy * 0.5,
    -vortex + Math.sin(phase * 53) * energy * 0.7,
    'ZYX'
  );
  headSwapRig.position.x = Math.sin(phase * 63) * size * energy * 0.15;
  headSwapRig.scale.set(
    size * (1 + Math.sin(phase * 61) * energy * 0.31),
    size * (1 + Math.sin(phase * 83) * energy * 0.33),
    size * (1 + Math.sin(phase * 73) * energy * 0.29)
  );
}

updateGregVisibility();
if (!gregTestMode) {
  window.setInterval(updateGregVisibility, 1000);
  document.addEventListener('visibilitychange', updateGregVisibility);
}

// Pulsating model effect
let scaleFactor = 1;
let time = 0;
function pulsateModel() {
  if (!audio.paused && model && !resetInProgress && !headSwap) {
    scaleFactor = 1 + Math.sin(time * 5) * 0.05;
    const baseScale = model === gregModel ? gregBaseScale : initialModelScale;
    model.scale.setScalar(baseScale * scaleFactor);
    time += 0.02;
  }
}




const turnStick = document.createElement('button');
turnStick.type = 'button';
turnStick.className = 'head-turn-stick';
turnStick.setAttribute('aria-label', 'Rotate Narby. Drag the joystick or hold arrow keys.');
const turnThumb = document.createElement('span');
turnThumb.setAttribute('aria-hidden', 'true');
turnStick.appendChild(turnThumb);
document.body.appendChild(turnStick);

const stickTravelRatio = 21 / 76;
const stickInput = new THREE.Vector2();
const turnTarget = new THREE.Vector2();
const turnKeys = new Set();
const arrowKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
let stickPointer = null;

function setStick(x, y) {
  stickInput.set(x, y).clampLength(0, 1);
  const stickTravel = turnStick.offsetWidth * stickTravelRatio;
  turnThumb.style.transform = `translate(${stickInput.x * stickTravel}px, ${stickInput.y * stickTravel}px)`;
}

function moveStick(event) {
  if (event.pointerId !== stickPointer) return;
  const bounds = turnStick.getBoundingClientRect();
  const stickTravel = bounds.width * stickTravelRatio;
  setStick(
    (event.clientX - bounds.left - bounds.width / 2) / stickTravel,
    (event.clientY - bounds.top - bounds.height / 2) / stickTravel
  );
}

function releaseStick() {
  stickPointer = null;
  turnKeys.clear();
  setStick(0, 0);
}

turnStick.addEventListener('pointerdown', event => {
  if (event.button !== 0 || stickPointer !== null) return;
  stickPointer = event.pointerId;
  turnStick.setPointerCapture(stickPointer);
  moveStick(event);
});
turnStick.addEventListener('pointermove', moveStick);
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  turnStick.addEventListener(type, event => {
    if (event.pointerId === stickPointer) releaseStick();
  });
}
for (const type of ['keydown', 'keyup']) {
  turnStick.addEventListener(type, event => {
    if (!arrowKeys.includes(event.key) || stickPointer !== null) return;
    event.preventDefault();
    if (type === 'keydown') turnKeys.add(event.key);
    else turnKeys.delete(event.key);
    setStick(
      Number(turnKeys.has('ArrowRight')) - Number(turnKeys.has('ArrowLeft')),
      Number(turnKeys.has('ArrowDown')) - Number(turnKeys.has('ArrowUp'))
    );
  });
}
turnStick.addEventListener('blur', releaseStick);
window.addEventListener('blur', releaseStick);
const turnAxes = new THREE.Euler(0, 0, 0, 'YXZ');
const turnDelta = new THREE.Quaternion();
function updateHeadTurn(frameSeconds) {
  if (resetInProgress || faceGrab || headSwap) return;
  turnTarget.copy(stickInput).multiplyScalar(1.55);
  turnVelocity.lerp(turnTarget, 1 - Math.exp(-frameSeconds / 0.12));
  if (turnVelocity.lengthSq() < 0.000025) return;
  turnAxes.set(turnVelocity.y * frameSeconds, turnVelocity.x * frameSeconds, 0);
  model.quaternion.premultiply(turnDelta.setFromEuler(turnAxes));
}

// Main loop
let lastFrameTime = performance.now() * 0.001;
function animate() {
  const tNow = performance.now() * 0.001;
  const frameSeconds = Math.min(tNow - lastFrameTime, 0.05);
  lastFrameTime = tNow;




// ⬇️ Update, fade & recycle via InstancedMesh ⬇️
if (rainMesh) {
  const opAttr = rainMesh.geometry.attributes.instanceOpacity.array;
  const tmpMat = new THREE.Matrix4();
  const pos    = new THREE.Vector3();
  const quat   = new THREE.Quaternion();
  const scl    = new THREE.Vector3();
  const mat    = new THREE.Matrix4();

  for (let i = 0; i < RAIN_TOTAL; i++) {
    // 1) pull matrix out
    rainMesh.getMatrixAt(i, tmpMat);
    tmpMat.decompose(pos, quat, scl);

    // 2) fall
    pos.y -= fallSpeeds[i];

    // 3) respawn
    if (pos.y <= KILL_Y) {
      pos.set(
        THREE.MathUtils.randFloatSpread(SPAWN_XZ_RAD),
        THREE.MathUtils.randFloat(SPAWN_Y_MIN, SPAWN_Y_MAX),
        THREE.MathUtils.randFloatSpread(SPAWN_XZ_RAD)
      );
    }

    // 4) spin
    const spinQ = new THREE.Quaternion().setFromAxisAngle(rotAxes[i], rotSpeeds[i]);
    quat.multiply(spinQ);

    // 5) **reset uniform scale** to your 0.2 size
    scl.setScalar(scales[i]);

    // 6) fade in/out
    const fi = THREE.MathUtils.clamp((pos.y - SPAWN_Y_MIN) / (SPAWN_Y_MAX - SPAWN_Y_MIN), 0, 1);
    const fo = THREE.MathUtils.clamp((SPAWN_Y_MAX - pos.y) / (SPAWN_Y_MAX - KILL_Y),     0, 1);
    opAttr[i] = Math.min(fi, fo);

    // 7) write back
    mat.compose(pos, quat, scl);
    rainMesh.setMatrixAt(i, mat);
  }

  rainMesh.geometry.attributes.instanceOpacity.needsUpdate = true;
  rainMesh.instanceMatrix.needsUpdate                    = true;
}


  // Head swap, blink, and music pulse
  updateHeadSwap(tNow);
  updateGregBlink(tNow, frameSeconds);
  pulsateModel();

  // Float the parent group so the idle motion and drag rotation stay independent.
  if (model) {
    squashGroup.position.y = hoverHeight * Math.sin(tNow * 1.45);
    squashGroup.rotation.set(
      0.055 * Math.sin(tNow * 0.93),
      0.12 * Math.sin(tNow * 0.71),
      0.035 * Math.sin(tNow * 1.13)
    );

    updateHeadTurn(frameSeconds);
  }

  applyFaceGrab();

  // render & controls
  renderer.render(scene, camera);
  controls.update();

  requestAnimationFrame(animate);
}

// kick things off
animate();

