console.log('🟢 script.js has started running');


// ───────────────────────────────────────────────────────
// 1) IMPORTS
// ───────────────────────────────────────────────────────
import * as THREE    from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';

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
  model.traverse(c => {
    if (c.isMesh) {
      c.castShadow    = true;
      c.receiveShadow = true;
    }
  });

  // center + light
  hoverHeight = size.y * initialModelScale * 0.045;
  const fill   = new THREE.PointLight(0xffffff, 0.8, 10);
  fill.position.set(0,2,2);
  fill.castShadow = false;
  model.add(fill);

  model.scale.setScalar(initialModelScale);

  squashGroup = new THREE.Group();
  squashGroup.add(model);
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
  if (resetInProgress || !model) return;
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
  const duration = 1000;
  function frame() {
    const t = Math.min((performance.now() - startTime) / duration, 1);
    const eased = t * t * (3 - 2 * t);
    camera.position.lerpVectors(
      startPos,
      new THREE.Vector3(0, 0, defaultCameraZ),
      eased
    );
    model.scale.lerpVectors(
      startScale,
      new THREE.Vector3(initialModelScale, initialModelScale, initialModelScale),
      eased
    );
    model.quaternion.slerpQuaternions(startRotation, frontRotation, eased);
    controls.target.lerpVectors(startTarget, center, eased);
    controls.update();
    if (t < 1) requestAnimationFrame(frame);
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

renderer.domElement.addEventListener('pointerdown', event => {
  if (event.button === 0 && !resetInProgress) maybeStartAudio();
});

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

let currentTrack = 0;
const audio = new Audio(tracks[currentTrack]);
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
  const titles = [-1, 0, 1].map(offset => {
    const path = tracks[(currentTrack + offset + tracks.length) % tracks.length];
    const trackNumber = path.split('/').pop().slice(0, 2);
    const title = document.createElement('img');
    const suffix = offset === 0 ? '-current' : '';
    title.src = `images/track-titles/${trackNumber}${suffix}.png`;
    title.alt = getBaseName(path);
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
function togglePlayPause() {
  userHasPressedPlay = true;
  if (audio.paused) {
    audio.play();
    document.getElementById('playPauseBtn').style.backgroundImage = 'url("images/playpause.png")';
  } else {
    audio.pause();
    document.getElementById('playPauseBtn').style.backgroundImage = 'url("images/playpausepressed.png")';
  }
}

function changeTrack(offset) {
  const wasPlaying = !audio.paused;
  currentTrack = (currentTrack + offset + tracks.length) % tracks.length;
  audio.src = tracks[currentTrack];
  updateNowPlaying();
  if (wasPlaying) audio.play();
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
  const btn = document.createElement('button');
  btn.id = id;
  btn.dataset.icon = id;

  // ─── RESET ANY BACKGROUND ───
  btn.style.background      = 'none';               // remove any shorthand background
  btn.style.backgroundColor = 'transparent';        // fully transparent canvas

  // now apply only the PNG (cache‐bust bbBtn)
  btn.style.backgroundImage = id === 'bbBtn'
    ? `url("images/${image}?v4")`
    : `url("images/${image}")`;
  btn.style.backgroundRepeat   = 'no-repeat';
  btn.style.backgroundPosition = 'center center';
  btn.style.backgroundSize     = 'contain';
  // ─────────────────────────────

  Object.assign(btn.style, {
    padding: '0',
    margin:  '0',
    border:    'none',
    outline:   'none',
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
    btn.addEventListener('click', () => {
      // swap only the image, leave transparency intact
      btn.style.backgroundImage = id === 'bbBtn'
        ? `url("images/${pressedImage}?v4")`
        : `url("images/${pressedImage}")`;
      onClick();
      setTimeout(() => {
        btn.style.backgroundImage = id === 'bbBtn'
          ? `url("images/${image}?v4")`
          : `url("images/${image}")`;
      }, 200);
    });
  }

  if (id === 'bbBtn') {
    btn.style.display    = 'none';
    btn.style.boxShadow  = '0 0 15px 3px rgba(255,0,0,0.7)';
    btn.style.transition = 'box-shadow 0.3s ease';
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
      backgroundImage: btn.style.backgroundImage,
      display: btn.style.display,
      transform: btn.style.transform
    });
  };
  syncShadow();
  new MutationObserver(syncShadow).observe(btn, {
    attributes: true,
    attributeFilter: ['style']
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
const bbBtn = createIconButton({ id: 'bbBtn', image: 'gregkey.png', pressedImage: 'gregkeypressed.png', onClick: () => {}, topOffset: '56px', rightOffset: 'calc(50% - 25px)' });

// Switch on when Greg is ready. The window follows the visitor's device clock.
const gregScheduleEnabled = false;
if (gregScheduleEnabled) {
  const updateGregVisibility = () => {
    bbBtn.style.display = new Date().getHours() < 6 ? 'block' : 'none';
  };
  updateGregVisibility();
  window.setInterval(updateGregVisibility, 1000);
  document.addEventListener('visibilitychange', updateGregVisibility);
}

// Pulsating model effect
let scaleFactor = 1;
let time = 0;
function pulsateModel() {
  if (!audio.paused && model && !resetInProgress) {
    scaleFactor = 1 + Math.sin(time * 5) * 0.05;
    model.scale.set(
      initialModelScale * scaleFactor,
      initialModelScale * scaleFactor,
      initialModelScale * scaleFactor
    );
    time += 0.02;
  }
}

// BB Button animation
let bbPulseTime = 0;
let bbRotationAngle = 0;
let bbRotationDirection = 1;
const bbRotationMax = THREE.MathUtils.degToRad(7);
function animateBBButton() {
  if (bbBtn.style.display === 'none') return;
  bbPulseTime += 0.05;
  const pulseScale = 0.9 + ((Math.sin(bbPulseTime) + 1) / 2) * 0.2;
  bbBtn.style.transform = `scale(${pulseScale}) rotate(${THREE.MathUtils.radToDeg(bbRotationAngle)}deg)`;
  bbRotationAngle += bbRotationDirection * 0.002;
  if (bbRotationAngle > bbRotationMax) bbRotationDirection = -1;
  else if (bbRotationAngle < -bbRotationMax) bbRotationDirection = 1;
  const glowAlpha = 0.5 + ((Math.sin(bbPulseTime * 2) + 1) / 4);
  bbBtn.style.boxShadow = `0 0 15px 3px rgba(255, 0, 0, ${glowAlpha})`;
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
  if (resetInProgress) return;
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


  // pulsation & BB-button
  pulsateModel();
  animateBBButton();

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

  // render & controls
  renderer.render(scene, camera);
  controls.update();

  requestAnimationFrame(animate);
}

// kick things off
animate();

