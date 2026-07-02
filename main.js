import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// --- PROCEDURAL COMPONENTS CONFIGURATION ---
// You can tweak these offsets if it's slightly off, but the script now auto-locates the Pi!
const config = {
  breadboardOffsetX: -0.3, // Fine-tune how close it sits to the Pi
  gpioOffsetY: 1.0         // Where the wires attach relative to the Pi center
};

// 1. Setup Scene, Camera, and Renderer
const canvas = document.querySelector('#webgl-canvas');
const scene = new THREE.Scene();

const sizes = {
  width: document.documentElement.clientWidth,
  height: window.innerHeight
};

const camera = new THREE.PerspectiveCamera(45, sizes.width / sizes.height, 0.1, 1000);
// Position the camera so we can see the model
camera.position.z = 20;
scene.add(camera);

const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
  alpha: true, // Transparent background so the text behind is visible
  antialias: true
});
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace; // Correct color space for GLTF models

// 2. Add Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);

// 3. Load the Eyenova Model
const loader = new GLTFLoader();
let eyenovaModel = null;
const modelGroup = new THREE.Group();
scene.add(modelGroup);

loader.load(
  '/project_peabody.glb',
  (gltf) => {
    eyenovaModel = gltf.scene;
    
    // Fix orientation from Fusion 360: if it was upside down at +PI/2, we use -PI/2
    eyenovaModel.rotation.x = -Math.PI / 2; 

    // Center the model dynamically
    const box = new THREE.Box3().setFromObject(eyenovaModel);
    const center = box.getCenter(new THREE.Vector3());
    eyenovaModel.position.sub(center);
    
    // Auto-scale it so it's not "wayyy too big"
    const size = box.getSize(new THREE.Vector3()).length();
    const desiredSize = 15; // Target size in Three.js units
    const scaleFactor = desiredSize / size;
    eyenovaModel.scale.set(scaleFactor, scaleFactor, scaleFactor);
    
    // Enhance Materials based on their names
    eyenovaModel.traverse((child) => {
      if (child.isMesh && child.material) {
        const matName = child.material.name || '';
        
        // Default PBR improvements
        child.material.metalness = 0.3;
        child.material.roughness = 0.5;
        
        // 1. The Main Casing (Acrylic/Clear)
        if (matName.includes('Acrylic')) {
          child.material.transparent = true;
          child.material.opacity = 0.3;
          child.material.roughness = 0.1;
          child.material.metalness = 0.1;
          child.material.depthWrite = false;
        }
        
        // 2. The Screen (Water)
        // Removed the Opaque r < 0.2 rule because it accidentally caught the green Raspberry Pi!
        if (matName.includes('Water')) {
          child.material.color.setHex(0x050505); // Force deep black
          child.material.roughness = 0.05; // Glossy screen
          child.material.metalness = 0.8;
          child.material.transparent = false;
        }
      }
    });

    modelGroup.add(eyenovaModel);

    // 5. Add Procedural Components
    modelGroup.updateMatrixWorld(true);
    addProceduralComponents(modelGroup, eyenovaModel);

    // 5b. Add "EyeNova" text on the screen
    const textPlane = addScreenText(modelGroup, eyenovaModel);

    // 6. Setup Scroll Animation with GSAP
    const chars = setupBackgroundText();
    setupScrollAnimation(textPlane, chars);
  },
  undefined,
  (error) => {
    console.error('An error happened while loading the model:', error);
  }
);

function addProceduralComponents(parent, model) {
  let piCenter = new THREE.Vector3();
  let piSize = new THREE.Vector3();
  let maxPiArea = 0;
  let highestY = -Infinity;
  let eyecupMesh = null;

  model.traverse((child) => {
    if (child.isMesh && child.material) {
      const matName = child.material.name || '';
      const box = new THREE.Box3().setFromObject(child);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      if (matName === 'Opaque(5,110,17)') {
        const area = size.x * size.y + size.y * size.z + size.x * size.z;
        if (area > maxPiArea) {
          maxPiArea = area;
          piCenter.copy(center);
          piSize.copy(size);
        }
      }
      if (center.y > highestY) {
        highestY = center.y;
        eyecupMesh = child;
      }
    }
  });

  if (eyecupMesh && eyecupMesh.material) {
    eyecupMesh.material.color.setHex(0xffffff);
    eyecupMesh.material.metalness = 0.0;
    eyecupMesh.material.roughness = 0.9;
  }

  // --- Find breadboard ---
  let bbCenter = new THREE.Vector3();
  let bbSize = new THREE.Vector3();
  let maxBBArea = 0;
  model.traverse((child) => {
    if (child.isMesh && child.material) {
      const matName = child.material.name || '';
      if (matName.includes('Powder_Coat') || matName === 'Opaque(246,246,243)') {
        const box = new THREE.Box3().setFromObject(child);
        const size = box.getSize(new THREE.Vector3());
        const area = size.x * size.y + size.y * size.z + size.x * size.z;
        if (area > maxBBArea) {
          maxBBArea = area;
          bbCenter = box.getCenter(new THREE.Vector3());
          bbSize.copy(size);
        }
      }
    }
  });

  // --- WIRE ROUTING (pure geometry, no gold-material detection) ---
  // From debug output we know:
  //   Breadboard: center(0.14, -0.07, 0.60), size(3.75, 4.35, 0.47) → thin axis = Z
  //   Pi PCB: behind the breadboard at lower Z
  //
  // Wires go from breadboard -Z face → Pi +Z face, spread along Y (height)
  const bbFaceZ = bbCenter.z - bbSize.z / 2;   // breadboard face toward Pi
  const piFaceZ = piCenter.z + piSize.z / 2;    // Pi face toward breadboard
  
  // GPIO pins run along Y on the upper portion of the Pi
  const piPinTopY = piCenter.y + piSize.y * 0.4;
  const piPinBotY = piCenter.y - piSize.y * 0.1;
  const piPinX = piCenter.x;

  console.log('--- BB face Z:', bbFaceZ, '→ Pi face Z:', piFaceZ);
  console.log('--- Pi:', piCenter, piSize, '| BB:', bbCenter, bbSize);

  // --- Create Wires ---
  const wireColors = [
    0xe63946, 0x457b9d, 0x2a9d8f, 0xe9c46a,
    0xf4a261, 0xffffff, 0x9b5de5, 0xf72585,
    0x06d6a0, 0xffd166, 0x264653, 0x00f5d4,
    0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3,
    0xf38181, 0xaa96da, 0xfcbad3, 0xa8d8ea,
  ];

  function createWire(startPos, endPos, color, sag, curveX = 0) {
    const mid = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
    mid.y -= sag;
    // Curve toward the pin side (-X edge of Pi)
    mid.x += curveX;
    const curve = new THREE.CatmullRomCurve3([startPos, mid, endPos]);
    const geom = new THREE.TubeGeometry(curve, 32, 0.012, 8, false);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 });
    parent.add(new THREE.Mesh(geom, mat));
  }

  // The GPIO pins are on the -X edge of the Pi. Wires should end there.
  const pinEdgeX = piCenter.x - piSize.x * 0.45;

  const wireCount = 35;
  for (let i = 0; i < wireCount; i++) {
    const t = i / (wireCount - 1);
    const color = wireColors[i % wireColors.length];

    // START: breadboard -Z face, spread along Y and X
    const startY = bbCenter.y + (t - 0.5) * bbSize.y * 0.55;
    const startX = bbCenter.x + (t - 0.5) * bbSize.x * 0.3;
    const start = new THREE.Vector3(startX, startY, bbFaceZ);

    // END: Pi +Z face, at the pin edge (+X), spread along Y
    const endY = piPinBotY + t * (piPinTopY - piPinBotY);
    const end = new THREE.Vector3(pinEdgeX, endY, piFaceZ);

    const sag = 0.04 + Math.abs(Math.sin(i * 1.3)) * 0.08;
    const curveTowardPins = -(0.3 + Math.sin(i * 0.7) * 0.15); // all curve toward -X
    createWire(start, end, color, sag, curveTowardPins);
  }
}

function addScreenText(parent, model) {
  // Find the screen mesh (Water material)
  let screenMesh = null;
  model.traverse((child) => {
    if (child.isMesh && child.material && child.material.name && child.material.name.includes('Water')) {
      screenMesh = child;
    }
  });

  if (!screenMesh) {
    console.warn('Screen mesh not found');
    return null;
  }

  const screenBox = new THREE.Box3().setFromObject(screenMesh);
  const screenCenter = screenBox.getCenter(new THREE.Vector3());
  const screenSize = screenBox.getSize(new THREE.Vector3());

  // Wait for Inter font to load, then draw
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 2048; // Double the height so vertical text doesn't get cut off at the edges
  const ctx = canvas.getContext('2d');

  function drawText() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#9A9791'; // Darker beige for a subtle watermark effect
    ctx.font = 'normal 400 80px "Garamond", serif'; // Very small font
    ctx.letterSpacing = '0px';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    
    // Bottom right corner, pushed as far right as possible
    ctx.fillText('EyeNova', canvas.width - 50, canvas.height - 190);
    
    if (texture) texture.needsUpdate = true;
  }

  const texture = new THREE.CanvasTexture(canvas);
  drawText();

  // Redraw once fonts are ready
  document.fonts.ready.then(() => {
    drawText();
  });

  // Size the plane to match the screen
  const textWidth = screenSize.x * 0.8;
  const textHeight = textWidth * (canvas.height / canvas.width);

  const planeGeom = new THREE.PlaneGeometry(textWidth, textHeight);
  const planeMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0, // Start invisible!
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const textPlane = new THREE.Mesh(planeGeom, planeMat);
  textPlane.position.copy(screenCenter);

  // Un-mirror the text (since it was drawn backwards relative to the screen's outward facing normal)
  textPlane.rotation.y = Math.PI;

  // The screen is the front panel. Its thin axis is Z.
  // The screen faces AWAY from us initially, so +Z is toward us after 180° flip.
  // We need the text on the -Z side (the side that becomes visible after the flip).
  const zOffset = screenSize.z / 2 + 0.03;
  textPlane.position.z -= zOffset;

  parent.add(textPlane);

  console.log('--- Screen text at:', textPlane.position, 'screenSize:', screenSize);
  return textPlane;
}

function setupBackgroundText() {
  const container = document.getElementById('bg-text-left');
  if (!container) return null;
  
  const text = "EyeNova is a portable, low-cost diagnostic platform that uses biomimetic machine learning and infrared imaging to detect subtle ocular markers of Wilson's disease and glaucoma. Inspired by the mantis shrimp's visual system, it significantly outperforms human diagnostic rates, providing a scalable solution for early detection in underserved regions.";
  
  container.innerHTML = '';
  const words = text.split(' ');
  words.forEach((word, index) => {
    const wordSpan = document.createElement('span');
    wordSpan.style.display = 'inline-block';
    
    word.split('').forEach(char => {
      const charSpan = document.createElement('span');
      charSpan.textContent = char;
      charSpan.className = 'scroll-char';
      wordSpan.appendChild(charSpan);
    });
    
    container.appendChild(wordSpan);
    
    if (index < words.length - 1) {
      container.appendChild(document.createTextNode(' '));
    }
  });

  return container.querySelectorAll('.scroll-char');
}

function setupScrollAnimation(textPlane, chars) {


  // Fade out the scroll arrow as soon as the user starts scrolling
  gsap.to('#scroll-arrow', {
    opacity: 0,
    ease: 'none',
    scrollTrigger: {
      trigger: '.main-content',
      start: 'top top',
      end: '150px top', // fades out within the first 150px of scroll
      scrub: true,
    }
  });

  // Setup initial model position AFTER all procedural wires are built correctly at (0,0,0)
  modelGroup.position.x = 3.2; // Pushed even further right per user request

  // Create a single timeline for perfectly smooth, sequential animations
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '#animation-trigger',
      start: 'top top', // Start EXACTLY when the 3D track snaps to the top of the viewport
      end: 'bottom top', // Finishes EXACTLY when the research page hits the top of the viewport
      scrub: 0.1, // extremely snappy, no lag
    }
  });

  // Step 0: Text Illuminates completely while model sits still
  if (chars && chars.length > 0) {
    tl.to(chars, {
      color: '#FAFAFA',
      stagger: { amount: 3 }, // Text illuminates completely over the first 3 scroll units
      ease: 'none',
      duration: 0.1 // Each character lights up instantly
    }, 0); // Start at absolute time 0 of timeline
  }

  // Model waits until time 3.5 (after text is fully illuminated) to start moving
  tl.to(modelGroup.position, {
    x: 0,
    ease: 'power1.inOut',
    duration: 3
  }, 3.5); // Pan takes from time 3.5 to 6.5

  // Fade out the text exactly as the pan finishes
  tl.to('.side-text', {
    opacity: 0,
    ease: 'power1.inOut',
    duration: 1
  }, 5.5); // Start fading out at time 5.5, fully gone by 6.5

  // Step 1: Flip 180 degrees
  tl.to(modelGroup.rotation, {
    y: Math.PI,
    ease: 'none',
    duration: 3
  });

  // Step 2: Text fades in (takes 10% of scroll)
  if (textPlane) {
    tl.to(textPlane.material, {
      opacity: 1,
      ease: 'none',
      duration: 1
    });
  }

  // Step 3: Tilt and Zoom to frame the camera (takes 30% of scroll)
  tl.to(modelGroup.rotation, {
    x: Math.PI * 0.25,
    ease: 'power1.inOut',
    duration: 3
  }, 'zoomPhase'); // start at same time as camera move

  tl.to(camera.position, {
    y: 3,
    z: 8,
    ease: 'power1.inOut',
    duration: 3
  }, 'zoomPhase');

  // Step 4: Extreme dive right into the lens (takes final 30% of scroll)
  tl.to(camera.position, {
    y: 5.5,
    z: -1,
    ease: 'power2.in',
    duration: 3
  });
}

// 5. Handle Resize
window.addEventListener('resize', () => {
  sizes.width = document.documentElement.clientWidth;
  sizes.height = window.innerHeight;

  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();

  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// 6. Animation Loop
const clock = new THREE.Clock();

const tick = () => {
  const elapsedTime = clock.getElapsedTime();

  // Gentle floating animation removed as requested

  renderer.render(scene, camera);
  window.requestAnimationFrame(tick);
};

tick();

// Update mouse position for Bento Grid glow effect
document.getElementById('bento').onmousemove = e => {
  for(const tile of document.getElementsByClassName("bento-tile")) {
    const rect = tile.getBoundingClientRect(),
          x = e.clientX - rect.left,
          y = e.clientY - rect.top;

    tile.style.setProperty("--mouse-x", `${x}px`);
    tile.style.setProperty("--mouse-y", `${y}px`);
  };
}

// 7. SPA Routing & Scroll Handling
function handleRoute() {
  const path = window.location.pathname;
  let target = null;
  
  if (path === '/research' || path === '/projects' || window.location.hash === '#research-page') {
    target = document.getElementById('research-page');
  } else if (path === '/resume' || window.location.hash === '#resume-page') {
    target = document.getElementById('resume-page');
  }

  if (target) {
    document.documentElement.style.scrollSnapType = 'none'; // Temporarily disable snapping
    target.scrollIntoView();
    setTimeout(() => {
      document.documentElement.style.scrollSnapType = '';
      document.documentElement.style.transition = 'opacity 0.5s ease';
      document.documentElement.style.opacity = '1';
    }, 100);
  } else {
    window.scrollTo(0, 0);
    document.documentElement.style.transition = 'opacity 0.5s ease';
    document.documentElement.style.opacity = '1';
  }
}

// Run routing logic immediately
handleRoute();

// Update URL as user scrolls
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      let newPath = '/';
      if (entry.target.id === 'main-content') newPath = '/landing';
      if (entry.target.id === 'research-page') newPath = '/research';
      if (entry.target.id === 'resume-page') newPath = '/resume';
      
      if (window.location.pathname !== newPath && window.location.pathname !== '/') {
        history.replaceState(null, null, newPath);
      } else if (window.location.pathname === '/' && newPath !== '/landing') {
        history.replaceState(null, null, newPath);
      }
    }
  });
}, { threshold: 0.5 });

const elMain = document.getElementById('main-content');
const elResearch = document.getElementById('research-page');
const elResume = document.getElementById('resume-page');

// Delay starting the observer slightly so it doesn't fight the initial routing jump
setTimeout(() => {
  if (elMain) observer.observe(elMain);
  if (elResearch) observer.observe(elResearch);
  if (elResume) observer.observe(elResume);
}, 500);
