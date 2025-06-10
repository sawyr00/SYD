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
  pre.remove();

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
    // compute percentage
    const pct = (itemsLoaded / itemsTotal) * 100;
    document.getElementById('progress-bar').style.width = pct + '%';
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

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);
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

// per-instance randomness arrays
const fallSpeeds = [];   // how fast each drop falls
const rotAxes    = [];   // spin axis per drop
const rotSpeeds  = [];   // spin speed per drop
const scales     = [];   // uniform scale per drop
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

  for (let i = 0; i < RAIN_TOTAL; i++) {
    fallSpeeds[i] = 1 + Math.random() * 2;
    rotAxes   [i] = new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize();
    rotSpeeds [i] = THREE.MathUtils.randFloat(0.01, 0.05);
    scales    [i] = 0.2;
  }
}

// Model & rotation state
let model;
// …up above, where you have let model; let squashGroup; …
let squashUniforms = [];    // ← define this once for the entire script
let squashGroup;  // group for rotating squash/stretch axes
// randomized slow “idle” spin
let rotationVelocity = new THREE.Vector3(
  THREE.MathUtils.randFloat(-0.002,  0.002),
  THREE.MathUtils.randFloat(-0.002,  0.002),
  THREE.MathUtils.randFloat(-0.002,  0.002)
);

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
let bbBtnVisible = false;
let spins = 0;


// ─── Arcball rotation state & helper ───
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();
let   isHeld    = false;
let   prevArcballVec = new THREE.Vector3();
let   baseModelQuat  = new THREE.Quaternion();

// ─── Quaternion‐based momentum for greased‑bearing spin ───
let   momentumQuat   = new THREE.Quaternion();  // stores last drag‑delta quaternion
const quatFriction   = 0.02;                     // how fast momentum decays

let   bbSquashTime   = 0;       // will drive our erratic squash/stretch
const bbSquashSpeed  = 0.1;     // how fast it oscillates
const bbSquashAmount = 0.15;    // max deviation from 1× scale


/**
 * Map screen coords → unit-sphere vector for arcball
 */
function getArcballVector(clientX, clientY) {
  const x = (clientX / window.innerWidth)  * 2 - 1;
  const y = 1 - (clientY / window.innerHeight) * 2;
  const len2 = x*x + y*y;
  const v = new THREE.Vector3(x, y, 0);
  v.z = len2 <= 1 ? Math.sqrt(1 - len2) : 0;
  return v.normalize();
}


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

// BB‐button light tint animation state
let dirInitialColor       = new THREE.Color(0xFFFFFF);
const dirTargetColor      = new THREE.Color(0xFF0055);
let colorTransitionActive = false;
let colorTransitionStart  = 0;
const colorTransitionDuration = 1000;  // ms

// Throbbing pulse once tint completes
let pulseActive      = false;
let pulseStartTime   = 0;
const pulseSpeed     = 0.005;   // tweak for faster/slower throb
const pulseAmplitude = 0.3;     // swing magnitude
const baseDirIntensity = 0.8;   // match your original directional-light intensity




// ───────────────────────────────────────────────────────
// ─── 4.1) RAIN INSTANCING SETUP ─────────────────────────
loader.load('models/b&b_candyshell_yellow.glb', gltf => {
// by child index (if it's the second node)
const src = gltf.scene.children[1];
 if (!src) { console.error('No candy-shell mesh found!'); return; }

  // 1) seed randomness
  for (let i = 0; i < RAIN_TOTAL; i++) {
    fallSpeeds[i] = THREE.MathUtils.randFloat(0.02, 0.1);
    rotAxes[i]    = new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize();
    rotSpeeds[i]  = THREE.MathUtils.randFloat(0.01, 0.05);
    scales[i]     = 0.2;
  }

  // 2) build instanced mesh
  const geom = src.geometry;
  const mat  = src.material.clone();
  mat.transparent = true;
  mat.depthWrite  = false;

  rainMesh = new THREE.InstancedMesh(geom, mat, RAIN_TOTAL);
  rainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(rainMesh);

  // per-instance opacity
  const op = new Float32Array(RAIN_TOTAL).fill(0);
  rainMesh.geometry.setAttribute(
    'instanceOpacity',
    new THREE.InstancedBufferAttribute(op, 1)
  );

  // 3) initialize positions + scales
  rainDummy = new THREE.Object3D();
  for (let i = 0; i < RAIN_TOTAL; i++) {
    rainDummy.position.set(
      THREE.MathUtils.randFloatSpread(SPAWN_XZ_RAD),
      THREE.MathUtils.randFloat(SPAWN_Y_MIN, SPAWN_Y_MAX),
      THREE.MathUtils.randFloatSpread(SPAWN_XZ_RAD)
    );
    rainDummy.scale.setScalar(scales[i]); // enforce uniform 0.2 size
    rainDummy.updateMatrix();
    rainMesh.setMatrixAt(i, rainDummy.matrix);
    op[i] = 0;
  }
  rainMesh.geometry.attributes.instanceOpacity.needsUpdate = true;
});  // ← this closing brace *and* parenthesis must match the opening loader.load(


// ─── Seed per-instance randomness ───────────────────────
// (Place this **immediately** after your Rain Instancing Setup loader block,
//  i.e. just after `rainMesh.geometry.attributes.instanceOpacity.needsUpdate = true;`)

for (let i = 0; i < RAIN_TOTAL; i++) {
  // falling speeds, matching your old 0.02–0.1 range
  fallSpeeds[i] = THREE.MathUtils.randFloat(0.02, 0.1);

  // random rotation axis & speed
  rotAxes[i]   = new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize();
  rotSpeeds[i] = THREE.MathUtils.randFloat(0.01, 0.05);

  // uniform per-instance scale (drastically smaller)
  scales[i]    = 0.2;
}


// ───────────────────────────────────────────────────────
// 4.3) MAIN MODEL LOADER
// ───────────────────────────────────────────────────────
loader.load('models/n64cartridge1.glb', gltf => {
  console.log('✅ cartridge loaded:', gltf);
  model = gltf.scene;
  model.traverse(c => {
    if (c.isMesh) {
      c.castShadow    = true;
      c.receiveShadow = true;
    }
  });

  // center + light
  const box    = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const fill   = new THREE.PointLight(0xffffff, 0.8, 10);
  fill.position.set(0,2,2);
  fill.castShadow = false;
  model.add(fill);

  model.position.sub(center);
  model.scale.set(initialModelScale, initialModelScale, initialModelScale);

  model.rotation.set(
    THREE.MathUtils.degToRad(-32),
    THREE.MathUtils.degToRad(-25),
    THREE.MathUtils.degToRad(-15)
  );

  squashGroup = new THREE.Group();
  squashGroup.add(model);
  scene.add(squashGroup);

  squashUniforms = [];
  model.traverse(child => {
    if (child.isMesh && child.material.uniforms?.cartoonSquash) {
      squashUniforms.push(child.material.uniforms.cartoonSquash);
    }
  });

  const keyLight = new THREE.SpotLight(0xffffff, 0.1);
  keyLight.position.set(5,5,5);
  keyLight.target = model;
  keyLight.castShadow = true;
  scene.add(keyLight);

  // position camera
  const size = box.getSize(new THREE.Vector3()).length();
  const fov  = camera.fov * Math.PI / 180;
  defaultCameraZ = size / (2 * Math.tan(fov/2)) * 1.5;
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
  const startPos = camera.position.clone();
  const startScale = model.scale.clone();
  const startTime = performance.now();
  const duration = 1000;
  function frame() {
    const t = Math.min((performance.now() - startTime) / duration, 1);
    camera.position.lerpVectors(
      startPos,
      new THREE.Vector3(0, 0, defaultCameraZ),
      t
    );
    model.scale.lerpVectors(
      startScale,
      new THREE.Vector3(initialModelScale, initialModelScale, initialModelScale),
      t
    );
    camera.lookAt(0, 0, 0);
    controls.update();
    if (t < 1) requestAnimationFrame(frame);
    else {
      resetInProgress = false;
      rotationVelocity.set(0.002, 0.002, 0.002);
    }
  }
  frame();
}
window.addEventListener('keydown', e => {
  if (e.key.toLowerCase() === 'c') smoothResetCamera();
});

// Drag inertia
let isDragging = false;
let prevMouse = new THREE.Vector2();
let mouseDragVelocity = new THREE.Vector2();
renderer.domElement.addEventListener('mousedown', e => {
  if (e.button !== 0) return;            // only left‐click
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

  if (isDragging) spins++;
  isDragging = false;
  mouseDragVelocity.set(0, 0);
  updateBBButtonVisibility();
});



// Audio setup
const tracks = [
  "audio/02-cold_piece-ocd_(feat._snuffed_on_sight).mp3",
  "audio/B3 Filth Foragers.wav",
  "audio/Chain Gang - Problem Solver.mp3",
  "audio/DTG - SPOOKY SLIME 10 QUICK SAND MASTER 2 (Louder).mp3",
  "audio/DTW - Backseat Lobotomy.wav",
  "audio/IRON GAINS - WILLING TO SUFFER - SONG 4 MIX V.4.wav",
  "audio/KWC - Informent Torment.wav",
  "audio/Lurkin - DEERGOD.wav",
  "audio/Phantomhorde - Shedding The Velvet (Final Mix).mp3",
  "audio/primal horde - the sixth hunt (alt._ending_raw_unreleased).mp4",
  "audio/Resurrected Divinity - Death Bed Revelation (feat. 10SCOOPS).mp3",
  "audio/slamwich - tba (boofed mix).m4a",
  "audio/Snuffed on Sight - The Bay Slam II.mp3",
  "audio/Spirit gun - Still standing 2.wav",
  "audio/Tactosa - Through The Windshield.wav",
  "audio/whatsdysmorphia - fertile (demo).m4a",
  "audio/STLIFTER-RISEN.WAV"
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
const nowPlaying = document.createElement('div');
Object.assign(nowPlaying.style, {
  position: 'fixed', top: '20px', left: '50%',
  transform: 'translateX(-50%)', width: '80%', overflow: 'hidden',
  display: 'flex', justifyContent: 'center', alignItems: 'center',
  fontFamily: 'Courier New, monospace', fontSize: '18px', fontWeight: 'bold',
  color: '#7fff7f',
  WebkitMaskImage: 'linear-gradient(to right, transparent, black 65%, black 100%, transparent)',
  maskImage: 'linear-gradient(to right, transparent, black 65%, black 100%, transparent)'
});
document.body.appendChild(nowPlaying);
const nowText = document.createElement('div');
nowText.style.display = 'flex'; nowText.style.gap = '40px';
nowPlaying.appendChild(nowText);

function getBaseName(path) {
  return path.split('/').pop();
}

function updateNowPlaying() {
  const prev = getBaseName(tracks[(currentTrack - 1 + tracks.length) % tracks.length]);
  const curr = getBaseName(tracks[currentTrack]);
  const next = getBaseName(tracks[(currentTrack + 1) % tracks.length]);
  nowText.innerHTML = `
    <span style="color: rgba(127,255,127,0.3);">${prev}</span>
    <span style="color: #7fff7f;">${curr}</span>
    <span style="color: rgba(127,255,127,0.3);">${next}</span>
  `;
}
// Initial call to show titles
updateNowPlaying();

// Audio control functions
function togglePlayPause() {
  userHasPressedPlay = true;
  if (audio.paused) {
    audio.play(); setupAudioContext();
    document.getElementById('playPauseBtn').style.backgroundImage = 'url("images/playpause.png")';
  } else {
    audio.pause();
    document.getElementById('playPauseBtn').style.backgroundImage = 'url("images/playpausepressed.png")';
  }
}

function setupAudioContext() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = audioCtx.createAnalyser();
  const source = audioCtx.createMediaElementSource(audio);
  source.connect(analyser); analyser.connect(audioCtx.destination);
  analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.3;
}

function nextTrack() {
  currentTrack = (currentTrack + 1) % tracks.length;
  audio.src = tracks[currentTrack]; updateNowPlaying(); if (!audio.paused) audio.play();
}

function prevTrack() {
  currentTrack = (currentTrack - 1 + tracks.length) % tracks.length;
  audio.src = tracks[currentTrack]; updateNowPlaying(); if (!audio.paused) audio.play();
}

function toggleMute(btn) {
  isMuted = !isMuted; audio.muted = isMuted;
  btn.style.backgroundImage = `url("images/${isMuted?'mutepressed.png':'mute.png'}")`;
}

// Button factory
function createIconButton({ id, image, pressedImage, onClick, topOffset, rightOffset, toggle = false }) {
  const btn = document.createElement('button');
  btn.id = id;

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
    top:       topOffset,
    right:     rightOffset,
    width:     '50px',
    height:    '50px',
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

  document.body.appendChild(btn);

  if (id === 'bbBtn') {
    btn.style.display    = 'none';
    btn.style.boxShadow  = '0 0 15px 3px rgba(255,0,0,0.7)';
    btn.style.transition = 'box-shadow 0.3s ease';
  }

  return btn;
}


// Instantiate buttons
createIconButton({ id: 'recenterBtn', image: 'ckey.png', pressedImage: 'ckeypressed.png', onClick: smoothResetCamera, topOffset: '75%', rightOffset: '20px' });
createIconButton({ id: 'playPauseBtn', image: 'playpause.png', pressedImage: 'playpausepressed.png', onClick: togglePlayPause, topOffset: '25%', rightOffset: '20px' });
createIconButton({ id: 'nextTrackBtn', image: 'nexttrack.png', pressedImage: 'nexttrackpressed.png', onClick: nextTrack, topOffset: '30%', rightOffset: '20px' });
createIconButton({ id: 'prevTrackBtn', image: 'prevtrack.png', pressedImage: 'prevtrackpressed.png', onClick: prevTrack, topOffset: '35%', rightOffset: '20px' });
createIconButton({ id: 'muteBtn', image: 'mute.png', pressedImage: 'mutepressed.png', onClick: toggleMute, topOffset: '40%', rightOffset: '20px', toggle: true });
const bbBtn = createIconButton({ id: 'bbBtn', image: 'bbkeyv4.png', pressedImage: 'bbkeypressedv4.png', onClick: () => {}, topOffset: '85%', rightOffset: '20px' });

// Pulsating model effect
let scaleFactor = 1;
let time = 0;
function pulsateModel() {
  if (!audio.paused && model) {
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
function updateBBButtonVisibility() {
  if (!bbBtnVisible && (spins > 10 || audio.ended)) {
    bbBtn.style.display = 'block';
    bbBtnVisible = true;

    // start the color transition
    scene.traverse(o => {
      if (o.isDirectionalLight) dirInitialColor.copy(o.color);
    });
    colorTransitionStart    = performance.now();
    colorTransitionActive   = true;
    pulseActive             = false;
  }
}
function animateBBButton() {
  if (!bbBtnVisible) return;
  bbPulseTime += 0.05;
  const pulseScale = 0.9 + ((Math.sin(bbPulseTime) + 1) / 2) * 0.2;
  bbBtn.style.transform = `scale(${pulseScale}) rotate(${THREE.MathUtils.radToDeg(bbRotationAngle)}deg)`;
  bbRotationAngle += bbRotationDirection * 0.002;
  if (bbRotationAngle > bbRotationMax) bbRotationDirection = -1;
  else if (bbRotationAngle < -bbRotationMax) bbRotationDirection = 1;
  const glowAlpha = 0.5 + ((Math.sin(bbPulseTime * 2) + 1) / 4);
  bbBtn.style.boxShadow = `0 0 15px 3px rgba(255, 0, 0, ${glowAlpha})`;
}



// Main loop
function animate() {
  const tNow = performance.now() * 0.001; // seconds




// 3a) handle the fade‐in of your new hue
if (colorTransitionActive) {
  const t = Math.min((now - colorTransitionStart) / colorTransitionDuration, 1);
  scene.traverse(o => {
    if (o.isDirectionalLight) {
      // lerp the color
      o.color.copy(dirInitialColor).lerp(dirTargetColor, t);
    }
  });
  if (t >= 1) {
    colorTransitionActive = false;
    pulseActive = true;
    pulseStartTime = now;
  }
}

// 3b) once tinted, give a throbbing intensity
if (pulseActive) {
  const elapsed = now - pulseStartTime;
  // compute a [1–amplitude .. 1+amplitude] multiplier
  const mult = 1 + Math.sin(elapsed * pulseSpeed) * pulseAmplitude;
  scene.traverse(o => {
    if (o.isDirectionalLight) {
      o.intensity = baseDirIntensity * mult;
    }
  });
}
  

// ⬇️ Update, fade & recycle via InstancedMesh ⬇️
// inside animate(), in your instanced‐mesh update:
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

    // 2) apply fall
    pos.y -= fallSpeeds[i];

    // 3) respawn if below kill-plane
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

    // 5) **reset uniform scale** here—
    scl.setScalar(scales[i]);

    // 6) fade in/out
    const fi = THREE.MathUtils.clamp((pos.y - SPAWN_Y_MIN) / (SPAWN_Y_MAX - SPAWN_Y_MIN), 0, 1);
    const fo = THREE.MathUtils.clamp((SPAWN_Y_MAX - pos.y) / (SPAWN_Y_MAX - KILL_Y), 0, 1);
    opAttr[i] = Math.min(fi, fo);

    // 7) write back transform + opacity
    mat.compose(pos, quat, scl);
    rainMesh.setMatrixAt(i, mat);
  }

  rainMesh.geometry.attributes.instanceOpacity.needsUpdate = true;
  rainMesh.instanceMatrix.needsUpdate                    = true;
}



  // pulsation & BB-button
  pulsateModel();
  animateBBButton();

  // main model rotation: idle spin + momentum
  if (model) {
    // always apply a slow randomized idle spin
    model.rotateOnAxis(new THREE.Vector3(1,0,0), rotationVelocity.x);
    model.rotateOnAxis(new THREE.Vector3(0,1,0), rotationVelocity.y);
    model.rotateOnAxis(new THREE.Vector3(0,0,1), rotationVelocity.z);

    // if not holding the model, layer on the last-drag momentum and decay it
    if (!isHeld) {
      model.quaternion.multiply(momentumQuat);
      momentumQuat.slerp(new THREE.Quaternion(), quatFriction);
    }
  }

    // once BB button is active, do an erratic squash & stretch on the model itself
  if (bbBtnVisible) {
    bbSquashTime += bbSquashSpeed;

    const sx = 1 +
      Math.sin(bbSquashTime * 1.1) *
      bbSquashAmount *
      (0.5 + Math.random() * 0.5);
    const sy = 1 +
      Math.sin(bbSquashTime * 1.3) *
      bbSquashAmount *
      (0.5 + Math.random() * 0.5);
    const sz = 1 +
      Math.sin(bbSquashTime * 1.7) *
      bbSquashAmount *
      (0.5 + Math.random() * 0.5);

    // apply squash/stretch on the model itself
    model.scale.set(
      initialModelScale * sx,
      initialModelScale * sy,
      initialModelScale * sz
    );
  }

  // drive your GLSL cartoonSquash uniform in lock-step
  if (bbBtnVisible && squashUniforms.length) {
    // NOTE: no second bbSquashTime += here
    const s = Math.sin(bbSquashTime * 2.0) * bbSquashAmount;
    for (let uni of squashUniforms) {
      uni.value = s;
    }
  }

  // render & controls
  renderer.render(scene, camera);
  controls.update();

  requestAnimationFrame(animate);
}

// kick things off
animate();

