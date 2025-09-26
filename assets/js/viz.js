;(() => {
  "use strict";
  const canvas = document.getElementById('viz3d');
  const overlay = document.getElementById('vizLabels');
  if (!canvas) return;
  const glConfig = {
    antialias: true,
    alpha: false,
    premultipliedAlpha: true,
    powerPreference: 'default'
  };
  const gl = canvas.getContext('webgl', glConfig);
  if (!gl) return;
  const overlayCtx = overlay ? overlay.getContext('2d') : null;
  const rootEl = document.documentElement;
  const clearColor = new Float32Array([0.015, 0.02, 0.05]);
  const fogColor = new Float32Array([0.03, 0.05, 0.09]);
  const pulseTint = new Float32Array([0.35, 0.55, 0.9]);
  const overlayColors = {
    text: 'rgba(255,255,255,0.95)',
    bracket: 'rgba(255,255,255,0.72)'
  };
  const palette = {
    nodeCool: new Float32Array([0.16,0.78,0.72]),
    nodeWarm: new Float32Array([0.92,0.18,0.56]),
    edgeStrong: new Float32Array([0.12,0.62,0.98]),
    edgeSoft: new Float32Array([0.17,0.85,0.66]),
    edgeHot: new Float32Array([0.92,0.18,0.56])
  };
  let fogDensity = 1;
  let edgePaletteDirty = false;

  function parseVec(styles, name, target){
    const raw = styles.getPropertyValue(name);
    if (!raw) return;
    const parts = raw.split(',');
    if (parts.length < 3) return;
    for (let i=0;i<3;i++){
      const value = parseFloat(parts[i]);
      if (!Number.isFinite(value)) return;
      target[i] = Math.max(0, Math.min(255, value)) / 255;
    }
  }

  function refreshPalette(){
    const styles = getComputedStyle(rootEl);
    parseVec(styles, '--gl-clear', clearColor);
    parseVec(styles, '--gl-fog', fogColor);
    parseVec(styles, '--gl-node-cool', palette.nodeCool);
    parseVec(styles, '--gl-node-warm', palette.nodeWarm);
    parseVec(styles, '--gl-edge-strong', palette.edgeStrong);
    parseVec(styles, '--gl-edge-soft', palette.edgeSoft);
    parseVec(styles, '--gl-edge-hot', palette.edgeHot);
    parseVec(styles, '--gl-line-pulse', pulseTint);
    const densityRaw = styles.getPropertyValue('--gl-fog-density').trim();
    const densityValue = densityRaw ? parseFloat(densityRaw) : NaN;
    fogDensity = Number.isFinite(densityValue) ? Math.max(0, Math.min(2, densityValue)) : 1;
    const textRaw = styles.getPropertyValue('--gl-label-text').trim();
    if (textRaw) overlayColors.text = textRaw;
    const bracketRaw = styles.getPropertyValue('--gl-label-bracket').trim();
    if (bracketRaw) overlayColors.bracket = bracketRaw;
    edgePaletteDirty = true;
  }

  rootEl.addEventListener('themechange', refreshPalette);

  let lastPulse = performance.now();
  let lastTS = performance.now();
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  function resize(){
    const w = Math.max(360, innerWidth);
    const h = Math.max(360, innerHeight);
    canvas.width = Math.round(w * DPR);
    canvas.height = Math.round(h * DPR);
    gl.viewport(0,0,canvas.width, canvas.height);
    if (overlay){
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      if (overlayCtx){
        overlayCtx.setTransform(1,0,0,1,0,0);
        overlayCtx.clearRect(0,0,overlay.width, overlay.height);
      }
    }
  }
  resize(); addEventListener('resize', resize);

  /* Matrices */
  const M = {
    perspective(fov, aspect, near, far){
      const f = 1/Math.tan(fov/2), nf = 1/(near-far);
      return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,(2*far*near)*nf,0]);
    },
    lookAt(eye,center,up){
      const [ex,ey,ez]=eye,[cx,cy,cz]=center,[ux,uy,uz]=up;
      let zx=ex-cx, zy=ey-cy, zz=ez-cz; let zl=Math.hypot(zx,zy,zz); zx/=zl; zy/=zl; zz/=zl;
      let xx = uy*zz - uz*zy, xy = uz*zx - ux*zz, xz = ux*zy - uy*zx;
      let xl=Math.hypot(xx,xy,xz); xx/=xl; xy/=xl; xz/=xl;
      const yx = zy*xz - zz*xy, yy = zz*xx - zx*xz, yz = zx*xy - zy*xx;
      return new Float32Array([xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0, -(xx*ex+xy*ey+xz*ez), -(yx*ex+yy*ey+yz*ez), -(zx*ex+zy*ey+zz*ez), 1]);
    },
    rotateZ(a){
      const c=Math.cos(a), s=Math.sin(a);
      return new Float32Array([c,-s,0,0, s,c,0,0, 0,0,1,0, 0,0,0,1]);
    }
  };

  function transformPoint(mat, x, y, z){
    return {
      x: mat[0]*x + mat[4]*y + mat[8]*z + mat[12],
      y: mat[1]*x + mat[5]*y + mat[9]*z + mat[13],
      z: mat[2]*x + mat[6]*y + mat[10]*z + mat[14],
      w: mat[3]*x + mat[7]*y + mat[11]*z + mat[15]
    };
  }

  function weightedPick(weights){
    const total = weights.reduce((sum, w) => sum + w, 0);
    let r = Math.random() * total;
    for (let i=0; i<weights.length; i++){
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  function makeBracketedRows(rows){
    const last = rows.length - 1;
    return rows.map((row, idx) => {
      const left = idx === 0 ? '⎡' : idx === last ? '⎣' : '⎢';
      const right = idx === 0 ? '⎤' : idx === last ? '⎦' : '⎥';
      return `${left}${row}${right}`;
    }).join('\n');
  }

  function centerCell(value, width) {
    const text = String(value ?? '');
    const diff = width - text.length;
    if (diff <= 0) return text;
    const left = Math.floor(diff / 2);
    const right = diff - left;
    return `${' '.repeat(left)}${text}${' '.repeat(right)}`;
  }

  function buildMatrix(rows) {
    if (!rows || !rows.length) return makeBracketedRows([]);
    const normalized = rows.map((row) => row.map((cell) => String(cell ?? '')));
    const colCount = normalized.reduce((max, row) => Math.max(max, row.length), 0);
    const colWidths = new Array(colCount).fill(0);
    for (const row of normalized) {
      for (let i = 0; i < colCount; i++) {
        const value = row[i] !== undefined ? String(row[i]) : '';
        if (value.length > colWidths[i]) colWidths[i] = value.length;
      }
    }
    const formatted = normalized.map((row) => {
      const cells = [];
      for (let i = 0; i < colCount; i++) {
        const value = row[i] !== undefined ? row[i] : '';
        cells.push(centerCell(value, colWidths[i]));
      }
      return cells.join('  ');
    });
    return makeBracketedRows(formatted);
  }

  function buildColumn(entries) {
    return buildMatrix(entries.map((entry) => [entry]));
  }

  function buildRowVector(entries) {
    if (!entries.length) return '[]';
    const normalized = entries.map((entry) => String(entry ?? ''));
    const maxLen = normalized.reduce((max, value) => Math.max(max, value.length), 0);
    const padded = normalized.map((value) => centerCell(value, maxLen));
    return `[ ${padded.join('  ')} ]`;
  }

  function sample(pool) {
    return pool[(Math.random() * pool.length) | 0];
  }

  const SUBSCRIPT_DIGITS = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };

  function toSubscript(value) {
    return String(value).split('').map((ch) => SUBSCRIPT_DIGITS[ch] || ch).join('');
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randomAxisSet(dim) {
    const bases = ['x', 'y', 'z', 't', 'r', 'θ', 'φ', 'u', 'v', 'w'];
    const counts = Object.create(null);
    const axes = [];
    for (let i = 0; i < dim; i++) {
      const root = sample(bases);
      counts[root] = (counts[root] || 0) + 1;
      axes.push(counts[root] === 1 ? root : `${root}${toSubscript(counts[root])}`);
    }
    return axes;
  }

  const angleSymbols = ['θ', 'φ', 'ψ', 'α', 'β'];
  const tensorSymbols = ['Φ', 'Ψ', '𝓛', 'E', 'U', 'H'];
  const functionRoots = ['f', 'g', 'h', 'F', 'G'];
  const weightRoots = ['w', 'α', 'β', 'γ', 'η', 'ζ'];
  const covarRoots = ['σ', 'ρ', 'κ'];
  const stateRoots = ['h', 's', 'm', 'q'];
  const kinematicSymbols = ['ẋ', 'ẏ', 'ż', 'ω', 'θ̇', 'φ̇', 'ν', 'μ', 'ξ'];

  function generateHessianMatrix() {
    const dimOptions = [2, 3, 4];
    const dim = dimOptions[weightedPick([1, 3, 2])];
    const axes = randomAxisSet(dim);
    const symbol = sample(tensorSymbols);
    const rows = axes.map((axisRow) => axes.map((axisCol) => {
      if (axisRow === axisCol) return `∂²${symbol}/∂${axisRow}²`;
      return `∂²${symbol}/∂${axisRow}∂${axisCol}`;
    }));
    return buildMatrix(rows);
  }

  function generateJacobianMatrix() {
    const outputOptions = [3, 4, 5];
    const inputOptions = [3, 4, 5];
    const outputs = outputOptions[weightedPick([2, 3, 1])];
    const inputs = inputOptions[weightedPick([3, 2, 1])];
    const axes = randomAxisSet(inputs);
    const rows = [];
    for (let i = 0; i < outputs; i++) {
      const fn = sample(functionRoots);
      const fnLabel = `${fn}${toSubscript(i + 1)}`;
      rows.push(axes.map((axis) => `∂${fnLabel}/∂${axis}`));
    }
    return buildMatrix(rows);
  }

  function generateRotationMatrix() {
    if (Math.random() < 0.4) {
      const angle = sample(angleSymbols);
      return buildMatrix([
        [`cos${angle}`, `-sin${angle}`],
        [`sin${angle}`, `cos${angle}`],
      ]);
    }
    const angle = sample(angleSymbols);
    const axis = sample(['x', 'y', 'z']);
    if (axis === 'x') {
      return buildMatrix([
        ['1', '0', '0'],
        ['0', `cos${angle}`, `-sin${angle}`],
        ['0', `sin${angle}`, `cos${angle}`],
      ]);
    }
    if (axis === 'y') {
      return buildMatrix([
        [`cos${angle}`, '0', `sin${angle}`],
        ['0', '1', '0'],
        [`-sin${angle}`, '0', `cos${angle}`],
      ]);
    }
    return buildMatrix([
      [`cos${angle}`, `-sin${angle}`, '0'],
      [`sin${angle}`, `cos${angle}`, '0'],
      ['0', '0', '1'],
    ]);
  }

  function generateCovarianceMatrix() {
    const dimOptions = [3, 4, 5];
    const dim = dimOptions[weightedPick([3, 2, 1])];
    const symbol = sample(covarRoots);
    const rows = [];
    for (let i = 0; i < dim; i++) {
      const row = [];
      for (let j = 0; j < dim; j++) {
        if (i === j) row.push(`${symbol}${toSubscript(i + 1)}²`);
        else row.push(`${symbol}${toSubscript(i + 1)}${toSubscript(j + 1)}`);
      }
      rows.push(row);
    }
    return buildMatrix(rows);
  }

  function generateDenseMatrix() {
    const rows = randomInt(4, 6);
    const cols = randomInt(4, 6);
    const data = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        if (Math.random() < 0.12) {
          row.push('0');
        } else {
          const value = (Math.random() * 2 - 1) * (Math.random() < 0.35 ? 3 : 1);
          const formatted = (value >= 0 ? '+' : '-') + Math.abs(value).toFixed(2);
          row.push(formatted);
        }
      }
      data.push(row);
    }
    return buildMatrix(data);
  }

  function generateAttentionMatrix() {
    const heads = randomInt(3, 5);
    const dims = randomInt(4, 6);
    const prefix = sample(weightRoots);
    const rows = [];
    for (let i = 0; i < heads; i++) {
      const row = [];
      for (let j = 0; j < dims; j++) {
        row.push(`${prefix}${toSubscript(i + 1)}${toSubscript(j + 1)}`);
      }
      rows.push(row);
    }
    return buildMatrix(rows);
  }

  function generateLaplacianStencil() {
    const axes = randomAxisSet(3);
    const coeff = sample(covarRoots);
    const rows = axes.map((axisRow, i) => axes.map((axisCol, j) => {
      if (i === j) return `∂²/∂${axisRow}² - ${coeff}${toSubscript(i + 1)}`;
      return `∂²/∂${axisRow}∂${axisCol}`;
    }));
    rows.push(axes.map((axis, idx) => (idx === 0 ? 'Δ' : '0')));
    return buildMatrix(rows);
  }

  const matrixGenerators = [
    { weight: 3, fn: generateHessianMatrix },
    { weight: 3, fn: generateJacobianMatrix },
    { weight: 2, fn: generateRotationMatrix },
    { weight: 2, fn: generateCovarianceMatrix },
    { weight: 3, fn: generateDenseMatrix },
    { weight: 2, fn: generateAttentionMatrix },
    { weight: 1, fn: generateLaplacianStencil },
  ];

  function randomMatrix() {
    const weights = matrixGenerators.map((entry) => entry.weight);
    const index = weightedPick(weights);
    const generator = matrixGenerators[index]?.fn || matrixGenerators[0].fn;
    return generator();
  }

  function randomColumnVector() {
    const lengths = [3, 4, 5, 6];
    const len = lengths[weightedPick([1, 2, 3, 2])];
    const mode = weightedPick([3, 2, 3, 2]);
    const values = [];
    if (mode === 0) {
      for (let i = 0; i < len; i++) values.push(`λ${toSubscript(i + 1)}`);
    } else if (mode === 1) {
      const target = sample(weightRoots);
      const symbol = sample(tensorSymbols);
      for (let i = 0; i < len; i++) values.push(`∂${symbol}/∂${target}${toSubscript(i + 1)}`);
    } else if (mode === 2) {
      for (let i = 0; i < len; i++) {
        const value = (Math.random() * 2 - 1) * (Math.random() < 0.4 ? 2.5 : 1);
        const formatted = (value >= 0 ? '+' : '-') + Math.abs(value).toFixed(2);
        values.push(formatted);
      }
    } else {
      const prefix = sample(stateRoots);
      for (let i = 0; i < len; i++) values.push(`${prefix}${toSubscript(i + 1)}`);
    }
    return buildColumn(values);
  }

  function randomRowVector() {
    const lengths = [3, 4, 5, 6];
    const len = lengths[weightedPick([3, 2, 2, 1])];
    const mode = weightedPick([3, 2, 2, 2]);
    const values = [];
    if (mode === 0) {
      const fn = sample(functionRoots);
      const axes = randomAxisSet(len);
      for (const axis of axes) values.push(`∂${fn}/∂${axis}`);
    } else if (mode === 1) {
      const prefix = sample(weightRoots);
      for (let i = 0; i < len; i++) values.push(`${prefix}${toSubscript(i + 1)}`);
    } else if (mode === 2) {
      const raw = Array.from({ length: len }, () => Math.random());
      const total = raw.reduce((sum, value) => sum + value, 0) || 1;
      for (const value of raw) values.push((value / total).toFixed(2));
    } else {
      for (let i = 0; i < len; i++) values.push(sample(kinematicSymbols));
    }
    return buildRowVector(values);
  }

function pickLabel(){
    const r = Math.random();
    if (r < 0.5) return randomColumnVector();
    if (r < 0.75) return randomRowVector();
    return randomMatrix();
  }

  /* Shaders (alpha softened, bigger points) */
  const V_SRC = `
  attribute vec3 position;
  attribute vec3 color;
  attribute float pulse;
  attribute float alpha;
  uniform mat4 uProj, uView, uModel;
  varying vec3 vColor;
  varying float vDepth;
  varying float vPulse;
  varying float vAlpha;
  void main(){
    vec4 world = uModel * vec4(position, 1.0);
    vec4 view = uView * world;
    vDepth = -view.z;
    vColor = color;
    vPulse = pulse;
    vAlpha = alpha;
    gl_Position = uProj * view;
    gl_PointSize = 48.0 / (0.55 + vDepth*0.3); /* softer dots */
  }`;
  const F_POINTS = `
  precision mediump float;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec3 vColor;
  varying float vDepth;
  varying float vPulse;
  varying float vAlpha;
  void main(){
    vec2 p = gl_PointCoord*2.0 - 1.0;
    float r2 = dot(p,p);
    if (r2 > 1.0) discard;
    vec3 N = normalize(vec3(p.x, p.y, sqrt(max(0.0, 1.0 - r2))));
    vec3 L = normalize(vec3(0.6, 0.9, 1.0));
    float diff = 0.5 + 0.5*max(0.0, dot(N,L));
    float spec = pow(max(0.0, dot(reflect(-L,N), vec3(0.0,0.0,1.0))), 42.0) * 0.35;
    float halo = smoothstep(0.9, 0.0, r2) * vPulse * 0.9;
    float fog = clamp(((vDepth-1.0) / 9.0) * uFogDensity, 0.0, 1.0);
    vec3 base = vColor*(diff + 0.12*halo) + spec*vec3(1.0);
    base = mix(base, uFogColor, fog);
    gl_FragColor = vec4(base, 0.86 * vAlpha);
  }`;
  const V_LINES = `
  attribute vec3 position;
  attribute vec3 color;
  attribute float pulse;
  attribute float alpha;
  uniform mat4 uProj, uView, uModel;
  varying vec3 vColor;
  varying float vDepth;
  varying float vPulse;
  varying float vAlpha;
  void main(){
    vec4 world = uModel * vec4(position, 1.0);
    vec4 view = uView * world;
    vDepth = -view.z; vColor = color; vPulse = pulse; vAlpha = alpha;
    gl_Position = uProj * view;
  }`;
  const F_LINES = `
  precision mediump float;
  uniform vec3 uFogColor;
  uniform vec3 uPulseColor;
  uniform float uFogDensity;
  varying vec3 vColor;
  varying float vDepth;
  varying float vPulse;
  varying float vAlpha;
  void main(){
    float fog = clamp(((vDepth-1.0) / 9.0) * uFogDensity, 0.0, 1.0);
    vec3 col = mix(vColor + vPulse*uPulseColor, uFogColor, fog);
    gl_FragColor = vec4(col, (0.35 + 0.35*min(1.0, vPulse)) * vAlpha);
  }`;

  function compile(src, type){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; }
  function program(vs, fs){ const p=gl.createProgram();
    gl.attachShader(p, compile(vs, gl.VERTEX_SHADER));
    gl.attachShader(p, compile(fs, gl.FRAGMENT_SHADER));
    gl.linkProgram(p); if(!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
    return p;
  }
  const PROG_POINTS = program(V_SRC, F_POINTS);
  const PROG_LINES  = program(V_LINES, F_LINES);

  const uPoints = {
    uProj: gl.getUniformLocation(PROG_POINTS,'uProj'),
    uView: gl.getUniformLocation(PROG_POINTS,'uView'),
    uModel: gl.getUniformLocation(PROG_POINTS,'uModel'),
    uFogColor: gl.getUniformLocation(PROG_POINTS,'uFogColor'),
    uFogDensity: gl.getUniformLocation(PROG_POINTS,'uFogDensity'),
  };
  const uLines = {
    uProj: gl.getUniformLocation(PROG_LINES,'uProj'),
    uView: gl.getUniformLocation(PROG_LINES,'uView'),
    uModel: gl.getUniformLocation(PROG_LINES,'uModel'),
    uFogColor: gl.getUniformLocation(PROG_LINES,'uFogColor'),
    uPulseColor: gl.getUniformLocation(PROG_LINES,'uPulseColor'),
    uFogDensity: gl.getUniformLocation(PROG_LINES,'uFogDensity'),
  };

  function attrib(p, name, buf, size){
    const loc = gl.getAttribLocation(p, name);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  /* --- Torus “air in tire” graph with soft surface constraint --- */
  const N = 110;
  const MAX_EDGES = 260;
  const positions = new Float32Array(N*3);
  const velocities = new Float32Array(N*3);
  const colors = new Float32Array(N*3);
  const pulsesAttrib = new Float32Array(N);
  const tmpF = new Float32Array(N*3);
  const labelText = new Array(N);
  const labelOffset = new Float32Array(N*3);
  const labelFreq = new Float32Array(N);
  const labelPhase = new Float32Array(N);
  const centerMass = new Float32Array(3);
  const smoothedCenter = new Float32Array(3);
  let centerReady = false;

  const R = 1.7, r = 0.55;                      // torus major/minor radii
  const TORUS_K = 1.4;                           // surface pull strength
  const PULL=0.009, DAMP=0.9, REPULSE=0.014, SPRING_K=0.095, BREAK_STRETCH=1.9;

  function torusPoint(a,b){
    const x = (R + r*Math.cos(b))*Math.cos(a);
    const y = (R + r*Math.cos(b))*Math.sin(a);
    const z = r*Math.sin(b);
    return [x,y,z];
  }
  function nearestOnTorus(x,y,z){
    const a = Math.atan2(y, x);
    const radial = Math.hypot(x,y) - R;
    const b = Math.atan2(z, radial);
    const tx = (R + r*Math.cos(b))*Math.cos(a);
    const ty = (R + r*Math.cos(b))*Math.sin(a);
    const tz = r*Math.sin(b);
    return [tx,ty,tz];
  }

  for (let i=0;i<N;i++){
    const a = Math.random()*Math.PI*2;
    const b = Math.random()*Math.PI*2;
    const p = torusPoint(a,b);
    positions[i*3+0]=p[0]; positions[i*3+1]=p[1]; positions[i*3+2]=p[2];
    velocities[i*3+0]=(Math.random()-0.5)*0.0018;
    velocities[i*3+1]=(Math.random()-0.5)*0.0018;
    velocities[i*3+2]=(Math.random()-0.5)*0.0018;
    colors.set(palette.nodeCool, i*3);
    labelText[i] = pickLabel();
    const amp = 0.14 + Math.random()*0.12;
    const theta = Math.random()*Math.PI*2;
    const phi = (Math.random()*0.6) - 0.3;
    labelOffset[i*3+0] = amp*Math.cos(theta)*Math.cos(phi);
    labelOffset[i*3+1] = amp*Math.sin(theta)*Math.cos(phi);
    labelOffset[i*3+2] = amp*Math.sin(phi);
    labelFreq[i] = 0.3 + Math.random()*0.35;
    labelPhase[i] = Math.random()*Math.PI*2;
  }

  /* Edges with fade in/out for smooth breaking */
  const edges = new Uint16Array(MAX_EDGES*2);
  const springRest = new Float32Array(MAX_EDGES);
  const edgeColor = new Float32Array(MAX_EDGES*2*3);
  const edgePulse = new Float32Array(MAX_EDGES*2);
  const edgeAlpha = new Float32Array(MAX_EDGES*2);   // per-vertex alpha (fade)
  const edgeLife  = new Float32Array(MAX_EDGES);     // 1 = alive target, 0 = removed target
  const edgeFade  = new Float32Array(MAX_EDGES);     // current fade 0..1
  const edgeVariant = new Uint8Array(MAX_EDGES);
  let edgeCount = 0;

  function assignEdgeColors(index){
    const offset = index*6;
    edgeColor.set(palette.edgeStrong, offset);
    const variant = edgeVariant[index];
    const endColor = variant === 1 ? palette.edgeHot : palette.edgeSoft;
    edgeColor.set(endColor, offset+3);
  }

  function applyEdgeColors(){
    for (let e=0; e<edgeCount; e++) assignEdgeColors(e);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineColBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, edgeColor.subarray(0, edgeCount*6));
  }

  function addEdge(a,b, startFade=0){
    if (a===b || edgeCount>=MAX_EDGES) return false;
    for(let e=0;e<edgeCount;e++){
      if ((edges[e*2]===a && edges[e*2+1]===b) || (edges[e*2]===b && edges[e*2+1]===a)) return false;
    }
    edges[edgeCount*2]=a; edges[edgeCount*2+1]=b;
    const dx=positions[a*3]-positions[b*3], dy=positions[a*3+1]-positions[b*3+1], dz=positions[a*3+2]-positions[b*3+2];
    springRest[edgeCount] = Math.max(0.42, Math.min(0.92, Math.hypot(dx,dy,dz)));
    edgeVariant[edgeCount] = Math.random()<0.13 ? 1 : 0;
    assignEdgeColors(edgeCount);
    edgePulse[edgeCount*2] = 0.0; edgePulse[edgeCount*2+1] = 0.0;
    edgeLife[edgeCount] = 1.0;
    edgeFade[edgeCount] = startFade; // start small, fade in
    edgePaletteDirty = true;
    edgeCount++;
    return true;
  }

  function degree(){
    const d=new Uint16Array(N);
    for(let e=0;e<edgeCount;e++){ d[edges[e*2]]++; d[edges[e*2+1]]++; }
    return d;
  }
  for (let i=0;i<N;i++){
    for (let j=i+1;j<N;j++){
      if (edgeCount>=MAX_EDGES) break;
      const dx=positions[i*3]-positions[j*3], dy=positions[i*3+1]-positions[j*3+1], dz=positions[i*3+2]-positions[j*3+2];
      const d2=dx*dx+dy*dy+dz*dz;
      if (d2 < 1.6) addEdge(i,j, Math.random()*0.5);
    }
    if (edgeCount>=MAX_EDGES) break;
  }
  while (edgeCount < MAX_EDGES){
    const i=(Math.random()*N)|0, j=(Math.random()*N)|0;
    if (i!==j){
      const dx=positions[i*3]-positions[j*3], dy=positions[i*3+1]-positions[j*3+1], dz=positions[i*3+2]-positions[j*3+2];
      const d2=dx*dx+dy*dy+dz*dz;
      if (d2<2.5) addEdge(i,j, Math.random()*0.4);
    }
  }

  function makeBuf(type, data, usage){ const b=gl.createBuffer(); gl.bindBuffer(type,b); gl.bufferData(type,data,usage||gl.DYNAMIC_DRAW); return b; }
  const posBuf   = makeBuf(gl.ARRAY_BUFFER, positions);
  const colBuf   = makeBuf(gl.ARRAY_BUFFER, colors);
  const pulseBuf = makeBuf(gl.ARRAY_BUFFER, pulsesAttrib);
  const linePosBuf   = makeBuf(gl.ARRAY_BUFFER, new Float32Array(MAX_EDGES*2*3));
  const lineColBuf   = makeBuf(gl.ARRAY_BUFFER, edgeColor);
  const linePulseBuf = makeBuf(gl.ARRAY_BUFFER, edgePulse);
  const lineAlphaBuf = makeBuf(gl.ARRAY_BUFFER, edgeAlpha);

  refreshPalette();
  applyEdgeColors();
  edgePaletteDirty = false;

  const lineVerts = new Float32Array(MAX_EDGES*2*3);
  function updateLineVerts(){
    for (let e=0;e<edgeCount;e++){
      const a = edges[e*2], b = edges[e*2+1];
      lineVerts.set(positions.subarray(a*3,a*3+3), e*6+0);
      lineVerts.set(positions.subarray(b*3,b*3+3), e*6+3);
      const fade = edgeFade[e];
      edgePulse[e*2]   = nodePulse[a];
      edgePulse[e*2+1] = nodePulse[b];
      edgeAlpha[e*2]   = fade;
      edgeAlpha[e*2+1] = fade;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, linePosBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineVerts.subarray(0, edgeCount*6));
    gl.bindBuffer(gl.ARRAY_BUFFER, linePulseBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, edgePulse.subarray(0, edgeCount*2));
    gl.bindBuffer(gl.ARRAY_BUFFER, lineAlphaBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, edgeAlpha.subarray(0, edgeCount*2));
  }

  function updateCenterOfMass(dt){
    let sx = 0, sy = 0, sz = 0;
    for (let i=0;i<N;i++){
      const idx = i*3;
      sx += positions[idx];
      sy += positions[idx+1];
      sz += positions[idx+2];
    }
    const invN = 1 / N;
    centerMass[0] = sx * invN;
    centerMass[1] = sy * invN;
    centerMass[2] = sz * invN;
    if (!centerReady){
      smoothedCenter.set(centerMass);
      centerReady = true;
      return;
    }
    const blend = Math.min(1, 0.08 + dt * 5.5);
    smoothedCenter[0] += (centerMass[0] - smoothedCenter[0]) * blend;
    smoothedCenter[1] += (centerMass[1] - smoothedCenter[1]) * blend;
    smoothedCenter[2] += (centerMass[2] - smoothedCenter[2]) * blend;
  }

  /* Physics + pulses */
  let timeScale = 0.03, timeScaleTarget = 0.03;
  const pulses = []; // {i, t0}
  const nodePulse = new Float32Array(N);
  const PULSE_SPEED = 0.18; const PULSE_FADE = 1.9;

  let pulseInterval = 5200, pulseIntervalTarget = 5200;

  function spawnPulse(){
    const deg = degree();
    let best = 0, bestScore = -1;
    for (let k=0;k<12;k++){
      const i = (Math.random()*N)|0;
      const score = (6 - Math.min(6, deg[i])) + Math.random()*0.5;
      if (score>bestScore){ bestScore=score; best=i; }
    }
    pulses.push({i:best, t0:performance.now()});
    if (pulses.length>3) pulses.shift();
  }

  function updatePulses(now){
    nodePulse.fill(0);
    for (const p of pulses){
      const age = (now - p.t0)/1000;
      const rad = age * PULSE_SPEED;
      if (age>6) continue;
      const sx=positions[p.i*3], sy=positions[p.i*3+1], sz=positions[p.i*3+2];
      for (let i=0;i<N;i++){
        const dx=positions[i*3]-sx, dy=positions[i*3+1]-sy, dz=positions[i*3+2]-sz;
        const d = Math.hypot(dx,dy,dz);
        const band = Math.exp(-((d-rad)*(d-rad))/(2*PULSE_FADE*PULSE_FADE));
        nodePulse[i] = Math.max(nodePulse[i], band);
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, pulseBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, nodePulse);
  }

  let lastRewire = performance.now();
  let rewireInterval = 8200, rewireIntervalTarget = 8200;

  function rewire(){
    const now = performance.now();
    if (now - lastRewire < rewireInterval) return;
    lastRewire = now;

    const toChange = Math.max(1, Math.floor(MAX_EDGES * 0.04));
    const willBreak = [];

    for (let e=0;e<edgeCount;e++){
      const a=edges[e*2], b=edges[e*2+1];
      const dx=positions[a*3]-positions[b*3], dy=positions[a*3+1]-positions[b*3+1], dz=positions[a*3+2]-positions[b*3+2];
      const d = Math.hypot(dx,dy,dz);
      if (d > springRest[e]*BREAK_STRETCH) willBreak.push(e);
      if (willBreak.length>=toChange) break;
    }
    while (willBreak.length<toChange){
      const e = (Math.random()*edgeCount)|0;
      if (!willBreak.includes(e)) willBreak.push(e);
    }

    /* mark for fade-out instead of instant removal */
    for (const e of willBreak){ edgeLife[e] = 0.0; }
  }

  function fadeEdges(dt){
    /* fade current edges toward their target state */
    for (let e=0;e<edgeCount;e++){
      const target = edgeLife[e];
      const cur = edgeFade[e];
      const rate = target>cur ? 1.5 : 1.2; // fade-in a bit faster than fade-out
      const next = cur + (target - cur) * Math.min(1, rate*dt);
      edgeFade[e] = Math.max(0, Math.min(1, next));
    }
    /* physically remove edges whose fade reached ~0, and add new ones fading in */
    for (let idx=edgeCount-1; idx>=0; idx--){
      if (edgeLife[idx]===0 && edgeFade[idx] < 0.03){
        // remove by swapping last
        edgeCount--;
        edges[idx*2]=edges[edgeCount*2]; edges[idx*2+1]=edges[edgeCount*2+1];
        springRest[idx]=springRest[edgeCount];
        edgeFade[idx]=edgeFade[edgeCount];
        edgeLife[idx]=edgeLife[edgeCount];
        edgeVariant[idx] = edgeVariant[edgeCount];
        assignEdgeColors(idx);
        edgePaletteDirty = true;
      }
    }
    // add back up to MAX_EDGES with fade-in
    const deg = degree();
    while (edgeCount < MAX_EDGES){
      const i=(Math.random()*N)|0, j=(Math.random()*N)|0;
      if (i===j) continue;
      const wI = 1/(1+deg[i]); const wJ = 1/(1+deg[j]);
      if (Math.random() > (0.65*wI + 0.65*wJ)) continue;
      const dx=positions[i*3]-positions[j*3], dy=positions[i*3+1]-positions[j*3+1], dz=positions[i*3+2]-positions[j*3+2];
      const d2=dx*dx+dy*dy+dz*dz;
      if (d2>0.35 && d2<2.4){
        addEdge(i,j, 0.05); // start faded, will fade in
      }
      if (Math.random()<0.3) break; // spread additions over frames
    }
  }

  function step(dt){
    tmpF.fill(0);
    // pairwise repulsion
    for (let i=0;i<N;i++){
      const ix=i*3, x=positions[ix], y=positions[ix+1], z=positions[ix+2];
      for (let j=i+1;j<N;j++){
        const jx=j*3;
        let dx = x - positions[jx], dy = y - positions[jx+1], dz = z - positions[jx+2];
        let d2 = dx*dx+dy*dy+dz*dz + 0.001;
        let inv = 1.0/Math.sqrt(d2);
        let f = REPULSE * inv*inv;
        dx*=f; dy*=f; dz*=f;
        tmpF[ix]+=dx; tmpF[ix+1]+=dy; tmpF[ix+2]+=dz;
        tmpF[jx]-=dx; tmpF[jx+1]-=dy; tmpF[jx+2]-=dz;
      }
    }
    // springs
    for (let e=0;e<edgeCount;e++){
      const a=edges[e*2], b=edges[e*2+1], ax=a*3, bx=b*3;
      let dx = positions[bx]-positions[ax];
      let dy = positions[bx+1]-positions[ax+1];
      let dz = positions[bx+2]-positions[ax+2];
      let d = Math.hypot(dx,dy,dz)+1e-6;
      const k = SPRING_K*(d - springRest[e]);
      const fx=(dx/d)*k, fy=(dy/d)*k, fz=(dz/d)*k;
      tmpF[ax]+=fx; tmpF[ax+1]+=fy; tmpF[ax+2]+=fz;
      tmpF[bx]-=fx; tmpF[bx+1]-=fy; tmpF[bx+2]-=fz;
    }
    // torus surface constraint (soft)
    for (let i=0;i<N;i++){
      const ix=i*3;
      const x=positions[ix], y=positions[ix+1], z=positions[ix+2];
      const t = nearestOnTorus(x,y,z);
      const dx=t[0]-x, dy=t[1]-y, dz=t[2]-z;
      tmpF[ix]   += dx*TORUS_K;
      tmpF[ix+1] += dy*TORUS_K;
      tmpF[ix+2] += dz*TORUS_K;
    }
    // integrate + center pull + colors
    for (let i=0;i<N;i++){
      const ix=i*3;
      velocities[ix]   = (velocities[ix]   + tmpF[ix]*dt) * DAMP;
      velocities[ix+1] = (velocities[ix+1] + tmpF[ix+1]*dt) * DAMP;
      velocities[ix+2] = (velocities[ix+2] + tmpF[ix+2]*dt) * DAMP;
      positions[ix]   += velocities[ix]*dt;
      positions[ix+1] += velocities[ix+1]*dt;
      positions[ix+2] += velocities[ix+2]*dt;

      positions[ix]   -= positions[ix]*PULL*dt*0.8;
      positions[ix+1] -= positions[ix+1]*PULL*dt*0.8;
      positions[ix+2] -= positions[ix+2]*PULL*dt*0.8;

      const sp = Math.min(1.0, Math.hypot(velocities[ix],velocities[ix+1],velocities[ix+2])*8.5);
      const cool = palette.nodeCool;
      const warm = palette.nodeWarm;
      const warmBlend = sp*0.6;
      colors[ix]   = cool[0]*(1-sp) + warm[0]*warmBlend;
      colors[ix+1] = cool[1]*(1-sp) + warm[1]*warmBlend;
      colors[ix+2] = cool[2]*(1-sp) + warm[2]*warmBlend;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, colors);
  }

  /* Scroll-scrubbed motion (video-like), with smoothed targets to avoid flicker */
  let scrollProg=0, scrollTarget=0;
  function onScroll(){
    const vh = Math.max(1, window.innerHeight);
    const y = window.scrollY;
    scrollTarget = Math.max(0, Math.min(0.2, y / (vh*12)));
    const ease = scrollTarget * 0.4;
    timeScaleTarget = 0.03 + ease*0.01;
    rewireIntervalTarget = 8200 - ease*600;
    pulseIntervalTarget  = 5200 - ease*400;
  }
  addEventListener('scroll', () => requestAnimationFrame(onScroll), {passive:true}); onScroll();

  /* Camera: inside torus, spin + forward; phase is scroll-scrubbed + gentle autoplay */
  let autoPhase = 0.0;
  function getCamera(dt){
    const aspect = canvas.height === 0 ? 1 : canvas.width / canvas.height;
    const portraitStrength = Math.max(0, Math.min(1, (1.25 - aspect) * 1.6));
    autoPhase += dt * (0.18 + 0.04*portraitStrength);

    const spiral = scrollProg * (0.45 + 0.22*portraitStrength);
    const phase = autoPhase + spiral;
    const twist = phase * (1.08 + 0.12*portraitStrength) + 1.1;

    const tx = -Math.sin(phase);
    const ty = Math.cos(phase);

    const comX = smoothedCenter[0];
    const comY = smoothedCenter[1];
    const comZ = smoothedCenter[2];

    const cx = comX + R*Math.cos(phase);
    const cy = comY + R*Math.sin(phase);
    const radialBase = 0.16 - 0.03*portraitStrength;
    const radial = radialBase + 0.015*Math.sin(autoPhase*0.8);
    const ex = cx + radial*Math.cos(twist);
    const ey = cy + radial*Math.sin(twist);
    const ez = comZ - 0.42 - 0.08*portraitStrength + Math.sin(autoPhase*0.45)*0.05;

    const forwardPush = 1.16 + 0.58*portraitStrength + 0.04*Math.sin(autoPhase*0.3);
    const upDrift = Math.sin(phase*0.5)*(0.22 + 0.18*portraitStrength) + 0.18*portraitStrength;

    const lookAhead = [
      ex + tx*forwardPush,
      ey + ty*forwardPush,
      comZ + upDrift
    ];
    const focusBlend = 0.3 + 0.45*portraitStrength;
    const center = [
      lookAhead[0]*(1 - focusBlend) + comX*focusBlend,
      lookAhead[1]*(1 - focusBlend) + comY*focusBlend,
      lookAhead[2]*(1 - focusBlend) + (comZ + upDrift*0.6)*focusBlend
    ];

    return {
      eye:[ex, ey, ez],
      center,
      spin: phase * (0.18 + 0.04*portraitStrength)
    };
  }

  /* Points need an alpha of 1 (constant), edges get per-vertex alpha */
  const pointAlpha = new Float32Array(N).fill(1.0);
  const pointAlphaBuf = makeBuf(gl.ARRAY_BUFFER, pointAlpha);

  const uPointsLoc = { uProj: uPoints.uProj, uView: uPoints.uView, uModel: uPoints.uModel };
  const uLinesLoc  = { uProj: uLines.uProj,  uView: uLines.uView,  uModel: uLines.uModel };

  const parsedLabelCache = new Map();
  const textWidthCache = new Map();
  function parseLabelSource(raw){
    if (!raw) return {lines:[], usesBrackets:false};
    const cached = parsedLabelCache.get(raw);
    if (cached) return cached;
    const rows = raw.split('\n');
    const cleaned = [];
    let canBracket = true;
    for (const row of rows){
      const trimmed = row.trim();
      if (!trimmed) continue;
      cleaned.push(trimmed);
      const first = trimmed[0];
      const last = trimmed[trimmed.length-1];
      const hasBracket = '⎡⎢⎣'.includes(first) && '⎤⎥⎦'.includes(last) && trimmed.length > 1;
      if (!hasBracket) canBracket = false;
    }
    const lines = canBracket
      ? cleaned.map(part => part.slice(1, -1).trim().replace(/\s+/g, ' '))
      : cleaned;
    const result = {lines, usesBrackets: canBracket && lines.length>0};
    parsedLabelCache.set(raw, result);
    return result;
  }

  function drawTallBracket(ctx, lineX, top, bottom, arm, isRight){
    ctx.beginPath();
    if (isRight){
      ctx.moveTo(lineX, top);
      ctx.lineTo(lineX - arm, top);
      ctx.moveTo(lineX, top);
      ctx.lineTo(lineX, bottom);
      ctx.moveTo(lineX, bottom);
      ctx.lineTo(lineX - arm, bottom);
    } else {
      ctx.moveTo(lineX, top);
      ctx.lineTo(lineX + arm, top);
      ctx.moveTo(lineX, top);
      ctx.lineTo(lineX, bottom);
      ctx.moveTo(lineX, bottom);
      ctx.lineTo(lineX + arm, bottom);
    }
    ctx.stroke();
  }

  function frame(ts){
    const rawDt = Math.min(40, ts - lastTS);
    lastTS = ts;
    const dt = (rawDt/1000);

    // smooth scroll & targets to avoid flicker
    scrollProg += (scrollTarget - scrollProg) * Math.min(1, 1.2*dt);
    timeScale += (timeScaleTarget - timeScale) * Math.min(1, 1.4*dt);
    pulseInterval += (pulseIntervalTarget - pulseInterval) * Math.min(1, 1.1*dt);
    rewireInterval += (rewireIntervalTarget - rewireInterval) * Math.min(1, 1.1*dt);

    const simDt = Math.min(0.004, dt * timeScale);

    const now = performance.now();
    if (now - lastPulse > pulseInterval){ lastPulse = now; spawnPulse(); }
    updatePulses(now);

    step(simDt);
    updateCenterOfMass(dt);
    rewire();
    fadeEdges(dt);
    updateLineVerts();
    if (edgePaletteDirty){
      applyEdgeColors();
      edgePaletteDirty = false;
    }

    const aspect = canvas.width/canvas.height;
    const proj = M.perspective(50*Math.PI/180, aspect, 0.1, 100.0);
    const cam = getCamera(dt);
    const view = M.lookAt(cam.eye, cam.center, [0,1,0]);
    const model = M.rotateZ(cam.spin); // the “tire” spins around us for an immersive feel

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(clearColor[0], clearColor[1], clearColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // LINES
    gl.useProgram(PROG_LINES);
    gl.uniformMatrix4fv(uLinesLoc.uProj,false,proj);
    gl.uniformMatrix4fv(uLinesLoc.uView,false,view);
    gl.uniformMatrix4fv(uLinesLoc.uModel,false,model);
    if (uLines.uFogColor) gl.uniform3fv(uLines.uFogColor, fogColor);
    if (uLines.uFogDensity) gl.uniform1f(uLines.uFogDensity, fogDensity);
    if (uLines.uPulseColor) gl.uniform3fv(uLines.uPulseColor, pulseTint);
    attrib(PROG_LINES,'position', linePosBuf, 3);
    attrib(PROG_LINES,'color',    lineColBuf, 3);
    attrib(PROG_LINES,'pulse',    linePulseBuf, 1);
    attrib(PROG_LINES,'alpha',    lineAlphaBuf, 1);
    gl.drawArrays(gl.LINES, 0, edgeCount*2);

    // POINTS
    gl.useProgram(PROG_POINTS);
    gl.uniformMatrix4fv(uPointsLoc.uProj,false,proj);
    gl.uniformMatrix4fv(uPointsLoc.uView,false,view);
    gl.uniformMatrix4fv(uPointsLoc.uModel,false,model);
    if (uPoints.uFogColor) gl.uniform3fv(uPoints.uFogColor, fogColor);
    if (uPoints.uFogDensity) gl.uniform1f(uPoints.uFogDensity, fogDensity);
    attrib(PROG_POINTS,'position', posBuf, 3);
    attrib(PROG_POINTS,'color',    colBuf, 3);
    attrib(PROG_POINTS,'pulse',    pulseBuf, 1);
    attrib(PROG_POINTS,'alpha',    pointAlphaBuf, 1);
    gl.drawArrays(gl.POINTS, 0, N);

    if (overlayCtx && overlay){
      overlayCtx.clearRect(0,0,overlay.width, overlay.height);
      const fontSizePx = Math.max(12, Math.round(12 * DPR));
      const lineGap = Math.round(fontSizePx * 0.3);
      overlayCtx.font = `${fontSizePx}px "SFMono-Regular", "Menlo", monospace`;
      overlayCtx.textBaseline = 'middle';
      overlayCtx.lineJoin = 'miter';
      overlayCtx.lineCap = 'butt';
      overlayCtx.shadowBlur = 0;
      overlayCtx.shadowColor = 'transparent';
      const padX = 4 * DPR;
      const padY = 4 * DPR;
      const offset = 10 * DPR;
      const outline = Math.max(1, DPR*0.6);
      overlayCtx.lineWidth = outline;
      const nowSec = now * 0.001;
      const skipMargin = 80 * DPR;

      for (let i=0;i<N;i++){
        const idx = i*3;
        const baseX = positions[idx];
        const baseY = positions[idx+1];
        const baseZ = positions[idx+2];
        const ox = labelOffset[idx];
        const oy = labelOffset[idx+1];
        const oz = labelOffset[idx+2];
        const phase = labelPhase[i] + nowSec * labelFreq[i];
        const swingCos = Math.cos(phase);
        const swingSin = Math.sin(phase);
        const offsetX = ox * swingCos - oy * swingSin * 0.6;
        const offsetY = oy * swingCos + ox * swingSin * 0.6;
        const offsetZ = oz + Math.sin(phase*0.5)*0.06;
        const worldX = baseX + offsetX;
        const worldY = baseY + offsetY;
        const worldZ = baseZ + offsetZ;

        const modelPos = transformPoint(model, worldX, worldY, worldZ);
        const viewPos = transformPoint(view, modelPos.x, modelPos.y, modelPos.z);
        const clipPos = transformPoint(proj, viewPos.x, viewPos.y, viewPos.z);
        if (clipPos.w <= 0) continue;
        const invW = 1 / clipPos.w;
        const ndcX = clipPos.x * invW;
        const ndcY = clipPos.y * invW;
        const ndcZ = clipPos.z * invW;
        if (ndcZ < -1 || ndcZ > 1) continue;
        if (ndcX < -1.2 || ndcX > 1.2 || ndcY < -1.2 || ndcY > 1.2) continue;

        const screenX = (ndcX * 0.5 + 0.5) * overlay.width;
        const screenY = (1 - (ndcY * 0.5 + 0.5)) * overlay.height;

        const raw = labelText[i];
        if (!raw) continue;
        if (screenX < -skipMargin || screenX > overlay.width + skipMargin) continue;
        if (screenY < -skipMargin || screenY > overlay.height + skipMargin) continue;
        const parsed = parseLabelSource(raw);
        const lines = parsed.lines;
        if (!lines.length) continue;
        let textWidth = 0;
        for (const line of lines){
          const cacheKey = `${fontSizePx}|${line}`;
          let w = textWidthCache.get(cacheKey);
          if (w === undefined){
            w = overlayCtx.measureText(line).width;
            textWidthCache.set(cacheKey, w);
          }
          if (w>textWidth) textWidth = w;
        }
        const textHeight = lines.length * fontSizePx + (lines.length-1)*lineGap;
        const bracketThickness = parsed.usesBrackets ? Math.max(1, Math.round(DPR*0.6)) : 0;
        const bracketArm = parsed.usesBrackets ? Math.max(5 * DPR, Math.round(fontSizePx * 0.4)) : 0;
        const bracketGap = parsed.usesBrackets ? Math.max(4 * DPR, Math.round(fontSizePx * 0.18)) : 0;
        const bracketPad = parsed.usesBrackets ? (bracketThickness/2 + bracketArm + bracketGap) : 0;
        const boxW = textWidth + padX*2 + bracketPad*2;
        const boxH = textHeight + padY*2;
        let boxX = screenX + offset;
        if (boxX + boxW > overlay.width - 4 * DPR){
          boxX = screenX - offset - boxW;
        }
        if (boxX < 4 * DPR) boxX = 4 * DPR;
        let boxY = screenY - boxH/2;
        if (boxY < 4 * DPR) boxY = 4 * DPR;
        if (boxY + boxH > overlay.height - 4 * DPR) boxY = overlay.height - 4 * DPR - boxH;

        if (parsed.usesBrackets){
          const bracketTop = boxY + padY;
          const bracketBottom = bracketTop + textHeight;
          const leftLineX = boxX + padX + bracketThickness/2;
          const rightLineX = boxX + boxW - padX - bracketThickness/2;
          overlayCtx.save();
          overlayCtx.lineWidth = bracketThickness;
          overlayCtx.strokeStyle = overlayColors.bracket;
          overlayCtx.shadowColor = 'transparent';
          drawTallBracket(overlayCtx, leftLineX, bracketTop, bracketBottom, bracketArm, false);
          drawTallBracket(overlayCtx, rightLineX, bracketTop, bracketBottom, bracketArm, true);
          overlayCtx.restore();
        }

        overlayCtx.fillStyle = overlayColors.text;
        overlayCtx.shadowColor = 'transparent';
        const textX = boxX + padX + bracketPad;
        let lineY = boxY + padY + fontSizePx/2;
        for (const line of lines){
          overlayCtx.fillText(line, textX, lineY);
          lineY += fontSizePx + lineGap;
        }
      }
    }

    requestAnimationFrame(frame);
  }
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion){
    return;
  }

  requestAnimationFrame(frame);
})();
