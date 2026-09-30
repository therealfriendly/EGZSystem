/* Operator – Hologramme mit three.js r128 (global: OP.holo)
   OP.holo.supported()            -> true, wenn WebGL geht und Effekte an sind
   OP.holo.body(container, opts)  -> Koerper-Hologramm (Profil, Gym, Kalorien)
   OP.holo.enemy(container, opts) -> Gegner-Hologramm (14 Bauformen, Kampf, Taverne)
   Ohne WebGL (oder Effekte aus) gibt es eine SVG-Grafik mit derselben API.
   Jeder Aufruf hat einen eigenen Renderer. Bildschirme MUESSEN handle.destroy() aufrufen.

   Koerper (Version 2: Push / Pull / Beine):
     Teile: brust, trizeps, schultern (Push); ruecken, bizeps (Pull); bauch; beine (inkl. Po)
     opts.mode    'ranks' (Rang-Farben) | 'focus' (Gym: Ziel-Muskeln leuchten) | 'kcal' (Kalorien-Fuellung)
     opts.colors  {brust, trizeps, schultern, ruecken, bizeps, bauch, beine: '#hex'}
                  (auch 'push'/'pull'/'legs' fuer ganze Gruppen und das alte 'arme' = Bizeps + Trizeps)
     opts.focus   Muskel-Id | Gruppen-Id ('push' | 'pull' | 'legs') | Liste davon | null
                  -> der Koerper dreht sich so, dass die Ziel-Muskeln zu sehen sind, und pendelt leicht
     opts.focusColor '#hex' (optional, Standard Tuerkis)   opts.fill 0..1 (kcal)
     opts.view    optional 'front' | 'back' | 'side' | Winkel: Blickrichtung beim Start bzw. einmal dorthin drehen
                  (per update). Im Fokus mit Ziel-Muskeln waehlt der Koerper die Richtung selbst.
     opts.autoRotate (true), opts.interactive (true)
     handle: update(teilOpts), pulse(idOderGruppe?) (Aufleuchten, der Koerper zeigt dabei die passende Seite), destroy() */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});

  /* Koerper-Teile (Muskel-Gruppen) in Profil-Reihenfolge */
  var PARTS = ['brust', 'trizeps', 'schultern', 'ruecken', 'bizeps', 'bauch', 'beine'];
  /* Sammel-Namen, falls OP.data.GROUPS fehlt, plus alte Namen aus Version 1 */
  var PART_ALIAS = { push: ['brust', 'trizeps', 'schultern'], pull: ['ruecken', 'bizeps'], legs: ['beine'], arme: ['bizeps', 'trizeps'] };
  var ARCHETYPES = ['soldat', 'scharfschuetze', 'schwer', 'forscher', 'skelett', 'goblin', 'bestie',
    'spinne', 'geist', 'golem', 'troll', 'drache', 'drohne', 'magier'];
  var COL = {
    cyan: '#3ee6d0', cyanHi: '#72fbe8', cyanDim: '#2a9c90', red: '#ff3d57', healthy: '#74f7a4',
    liqLow: '#ff2b3c', liqTop: '#ffa23e', gold: '#ffd060', steel: '#d4ebf2', grey: '#6d8f99',
    // Rang-Scan: Grundkoerper (Kopf, Rumpf, Haende, Fuesse) in kuehlem Stahlblau, schwach -> jede Rang-Farbe hebt sich ab
    // (bewusst nicht Tuerkis wie Platin #5fe8d6, nicht Grau wie Eisen, nicht Weiss wie Silber)
    neutral: '#5b7896'
  };
  var TAU = Math.PI * 2, PI = Math.PI;

  /* ================= kleine Helfer ================= */
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function isHex(s) { return typeof s === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim()); }
  function hexOr(s, d) { return isHex(s) ? s.trim() : d; }
  function extend(t) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i];
      if (!s) continue;
      for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k) && s[k] !== undefined) t[k] = s[k];
    }
    return t;
  }
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function reducedMotion() {
    try { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  /* fester Pseudo-Zufall (gleiche Form bei jedem Aufbau) */
  function hash1(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* ================= WebGL vorhanden? ================= */
  var glCache = null;
  function webglAvailable() {
    if (glCache !== null) return glCache;
    glCache = false;
    try {
      if (!window.THREE || !window.WebGLRenderingContext) return false;
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
      if (gl) {
        glCache = true;
        var ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();   // Test-Kontext sofort freigeben
      }
    } catch (e) { glCache = false; }
    return glCache;
  }
  function supported() {
    var s = OP.state;
    if (s && s.settings && s.settings.effects === false) return false;
    return webglAvailable();
  }

  /* ================= Shader ================= */
  var GLSL_LINE = [
    'float gridLine(float v, float w) {',
    '  float d = abs(fract(v + 0.5) - 0.5);',
    '  float fw = max(fwidth(v), 0.0001);',
    '  return 1.0 - smoothstep(fw * w, fw * (w + 1.0), d);',
    '}'
  ].join('\n');

  var GLSL_NOISE = [
    'float hHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
    'float hNoise(vec3 x) {',
    '  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(mix(hHash(i), hHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hHash(i + vec3(0.0, 1.0, 0.0)), hHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),',
    '             mix(mix(hHash(i + vec3(0.0, 0.0, 1.0)), hHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hHash(i + vec3(0.0, 1.0, 1.0)), hHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);',
    '}'
  ].join('\n');

  /* Vertex-Shader fuer Flaechen, Linien, Tiefen-Maske und Boden (gleiche Rechnung = keine Luecken) */
  var VS = [
    'uniform float uTime;',
    'uniform float uGlitch;',
    'varying vec3 vW;',
    'varying vec3 vV;',
    '#ifdef HOLO_NORMAL',
    'varying vec3 vN;',
    '#endif',
    '#ifdef HOLO_UV',
    'varying vec2 vUv;',
    '#endif',
    'void main() {',
    '#ifdef HOLO_UV',
    '  vUv = uv;',
    '#endif',
    '  vec4 w = modelMatrix * vec4(position, 1.0);',
    '  if (uGlitch > 0.001) {',
    '    float tt = floor(uTime * 15.0);',
    '    float r = fract(sin(floor(w.y * 10.0) * 12.9898 + tt * 78.233) * 43758.5453);',
    '    w.x += (r - 0.5) * uGlitch * 0.16 * step(0.7, r);',
    '  }',
    '  vW = w.xyz;',
    '  vec4 mv = viewMatrix * w;',
    '  vV = -mv.xyz;',
    '#ifdef HOLO_NORMAL',
    '  vN = normalMatrix * normal;',
    '#endif',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  /* Hologramm-Flaeche: Randlicht (Fresnel), Scanlinien, Hoehenlinien, Gitter, Kalorien-Fuellung, Aufloesen */
  var FS_SURF = [
    'uniform vec3 uColor;',
    'uniform vec3 uFlashCol;',
    'uniform vec3 uLiq1;',
    'uniform vec3 uLiq2;',
    'uniform float uAlpha;',
    'uniform float uFill;',
    'uniform float uRim;',
    'uniform float uWire;',
    'uniform float uFlash;',
    'uniform float uTime;',
    'uniform float uFlick;',
    'uniform float uPx;',
    'uniform float uDissolve;',
    'uniform float uKcal;',
    'uniform float uLevel;',
    'uniform float uHealthy;',
    'varying vec3 vW;',
    'varying vec3 vV;',
    'varying vec3 vN;',
    'varying vec2 vUv;',
    GLSL_LINE,
    GLSL_NOISE,
    'void main() {',
    '  vec3 n = normalize(vN);',
    '  vec3 vd = normalize(vV);',
    '  float fres = 1.0 - abs(dot(n, vd));',
    '  float rim = fres * fres;',
    '  float scan = 0.78 + 0.22 * sin(gl_FragCoord.y / uPx * 2.1 - uTime * 7.0);',
    '  float sweep = pow(fract(vW.y * 0.42 - uTime * 0.21), 18.0);',
    '  float contour = gridLine(vW.y * 12.0, 0.25);',
    '  float wire = max(gridLine(vUv.x, 0.35), gridLine(vUv.y, 0.35));',
    '  vec3 col = uColor;',
    '  float a = uFill * scan + rim * uRim + contour * (0.025 + uFill * 0.5) + sweep * 0.28 + wire * uWire;',
    '  if (uKcal > 0.5) {',
    '    float wave = sin(vW.x * 17.0 + uTime * 2.3) * 0.006 + sin(vW.z * 23.0 - uTime * 1.8) * 0.005;',
    '    float lv = uLevel + wave;',
    '    float fw = max(fwidth(vW.y), 0.0001);',
    '    float below = 1.0 - smoothstep(lv - fw, lv + fw, vW.y);',
    '    float hh = clamp(vW.y / max(uLevel, 0.1), 0.0, 1.0);',
    '    vec3 liq = mix(uLiq1, uLiq2, hh * hh);',
    '    float bub = smoothstep(0.8, 0.96, hNoise(vec3(vW.x * 34.0, vW.y * 34.0 - uTime * 2.4, vW.z * 34.0)));',
    '    float surf = (1.0 - smoothstep(0.0, 0.016, abs(vW.y - lv))) * step(0.004, uLevel);',
    '    float aFull = 0.36 * scan + rim * 0.95 + contour * 0.22 + bub * 0.35 + sweep * 0.25;',
    '    float aEmpty = mix(0.012 + rim * 0.2 + wire * 0.42 + contour * 0.05, a, uHealthy);',
    '    col = mix(uColor, liq, below);',
    '    a = mix(aEmpty, aFull, below);',
    '    col = mix(col, vec3(1.0, 0.86, 0.6), surf * 0.6);',
    '    a += surf * 1.2;',
    '  }',
    '  float edge = 0.0;',
    '  if (uDissolve > 0.001) {',
    '    float nz = hNoise(vW * 11.0);',
    '    float keep = step(uDissolve, nz);',
    '    edge = (1.0 - smoothstep(0.0, 0.07, nz - uDissolve)) * keep * (1.0 - step(0.999, uDissolve));',
    '    a = (a - wire * uWire) * keep + wire * uWire;',
    '  }',
    '  col = mix(col, uFlashCol, clamp(uFlash, 0.0, 1.0));',
    '  col += vec3(1.0) * rim * rim * 0.25;',
    '  col += vec3(1.0, 0.75, 0.45) * edge * 1.5;',
    '  a = (a + edge * 1.5 + uFlash * 0.35) * uAlpha * uFlick;',
    '  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));',
    '}'
  ].join('\n');

  /* feine Kantenlinien */
  var FS_LINE = [
    'uniform vec3 uColor;',
    'uniform vec3 uFlashCol;',
    'uniform vec3 uLiq2;',
    'uniform float uLineA;',
    'uniform float uAlpha;',
    'uniform float uFlash;',
    'uniform float uTime;',
    'uniform float uFlick;',
    'uniform float uPx;',
    'uniform float uKcal;',
    'uniform float uLevel;',
    'uniform float uHealthy;',
    'varying vec3 vW;',
    'void main() {',
    '  float scan = 0.7 + 0.3 * sin(gl_FragCoord.y / uPx * 2.1 - uTime * 7.0);',
    '  vec3 col = uColor;',
    '  float a = uLineA;',
    '  if (uKcal > 0.5) {',
    '    float below = step(vW.y, uLevel);',
    '    col = mix(uColor, uLiq2, below);',
    '    a = mix(uLineA * mix(0.6, 1.0, uHealthy), uLineA * 1.2, below);',
    '  }',
    '  col = mix(col, uFlashCol, clamp(uFlash, 0.0, 1.0));',
    '  gl_FragColor = vec4(col, clamp(a * scan * uFlick * uAlpha, 0.0, 1.0));',
    '}'
  ].join('\n');

  /* Tiefen-Maske: schreibt nur Tiefe, damit die Rueckseite nicht durchscheint */
  var FS_OCC = 'void main() { gl_FragColor = vec4(0.0); }';

  /* Boden, Ringe, Lichtsaeule, Aura */
  var FS_FLAT = [
    'uniform vec3 uColor;',
    'uniform float uAlpha;',
    'uniform float uTime;',
    'uniform float uKind;',
    'uniform float uR;',
    'uniform float uPx;',
    'varying vec3 vW;',
    'varying vec2 vUv;',
    GLSL_LINE,
    'void main() {',
    '  float q = length(vW.xz) / uR;',
    '  float ang = atan(vW.z, vW.x);',
    '  float fq = max(fwidth(q), 0.0005);',
    '  float scan = 0.7 + 0.3 * sin(gl_FragCoord.y / uPx * 2.1 - uTime * 7.0);',
    '  float a = 0.0;',
    '  if (uKind < 0.5) {',
    '    float outer = 1.0 - smoothstep(fq, fq * 2.5, abs(q - 1.0));',
    '    float inner = (1.0 - smoothstep(fq, fq * 2.5, abs(q - 0.8))) * step(0.42, fract(ang * 0.9549297 + uTime * 0.07));',
    '    float tick = step(0.85, q) * step(q, 0.9) * step(0.7, fract(ang * 5.729578 - uTime * 0.03));',
    '    float glow = exp(-abs(q - 1.0) * 14.0) * 0.28;',
    '    a = outer * 0.95 + inner * 0.5 + tick * 0.3 + glow;',
    '  } else if (uKind < 1.5) {',
    '    vec2 g = vW.xz * (4.0 / uR);',
    '    float l = max(gridLine(g.x, 0.25), gridLine(g.y, 0.25));',
    '    float fade = 1.0 - smoothstep(0.35, 1.6, q);',
    '    a = (l * 0.3 + exp(-q * q * 2.0) * 0.1) * fade;',
    '  } else if (uKind < 2.5) {',
    '    a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 3.0) * 0.2 * scan;',
    '  } else if (uKind < 3.5) {',
    '    float pulse = 0.65 + 0.35 * sin(uTime * 2.6);',
    '    float r1 = 1.0 - smoothstep(fq, fq * 3.0, abs(q - 1.0));',
    '    float r2 = (1.0 - smoothstep(fq, fq * 3.0, abs(q - 0.86))) * step(0.5, fract(ang * 1.2732395 - uTime * 0.25));',
    '    a = (r1 * 0.9 + r2 * 0.7 + exp(-abs(q - 1.0) * 9.0) * 0.45) * pulse;',
    '  } else {',
    '    a = pow(clamp(vUv.y, 0.0, 1.0), 2.0) * 0.28 * scan;',
    '  }',
    '  gl_FragColor = vec4(uColor, clamp(a * uAlpha, 0.0, 1.0));',
    '}'
  ].join('\n');

  /* Partikel (Funken, Glut, Treffer) */
  var VS_PTS = [
    'attribute float aAlpha;',
    'attribute float aSize;',
    'attribute vec3 aColor;',
    'uniform float uScale;',
    'varying float vA;',
    'varying vec3 vC;',
    'void main() {',
    '  vA = aAlpha; vC = aColor;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = aSize * uScale / max(0.1, -mv.z);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  var FS_PTS = [
    'varying float vA;',
    'varying vec3 vC;',
    'void main() {',
    '  float d = length(gl_PointCoord - 0.5);',
    '  if (d > 0.5 || vA < 0.003) discard;',
    '  float a = 1.0 - d * 2.0;',
    '  a = a * a;',
    '  gl_FragColor = vec4(vC + vec3(0.4) * a, a * vA);',
    '}'
  ].join('\n');

  /* additive Mischung: Farbe addiert (Leuchten), Alpha normal */
  function additive(m) {
    m.transparent = true;
    m.depthWrite = false;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.SrcAlphaFactor;
    m.blendDst = THREE.OneFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    return m;
  }

  /* ================= Geometrie-Helfer ================= */
  function V(x, y, z) { return new THREE.Vector3(x || 0, y || 0, z || 0); }
  var AX_X = null, AX_Y = null, AX_Z = null, UPV = null;
  function initConst() {
    if (AX_Y) return;
    AX_X = V(1, 0, 0); AX_Y = V(0, 1, 0); AX_Z = V(0, 0, 1); UPV = V(0, 1, 0);
  }

  /* UV-Koordinaten strecken -> Anzahl der Gitterlinien im Shader */
  function uvScale(g, su, sv) {
    var uv = g.attributes.uv;
    if (!uv) return g;
    for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    return g;
  }
  /* konstante UV (keine Gitterlinien, z. B. fuer Felsen) */
  function uvFlat(g) {
    var n = g.attributes.position.count, a = new Float32Array(n * 2);
    for (var i = 0; i < a.length; i++) a[i] = 0.5;
    g.setAttribute('uv', new THREE.BufferAttribute(a, 2));
    return g;
  }
  function sphereGeo(r, ws, hs) { return uvScale(new THREE.SphereGeometry(r, ws || 18, hs || 14), 8, 6); }
  function partSphere(r, ws, hs, p0, pl, t0, tl) { return uvScale(new THREE.SphereGeometry(r, ws, hs, p0, pl, t0, tl), 8, 4); }
  function boxGeo(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
  function cylGeo(rt, rb, h, seg, open) { return uvScale(new THREE.CylinderGeometry(rt, rb, h, seg || 16, 1, !!open), 8, 2); }
  function coneGeo(r, h, seg) { return uvScale(new THREE.ConeGeometry(r, h, seg || 12), 6, 2); }
  function torusGeo(R, r, rs, ts, arc) { return uvScale(new THREE.TorusGeometry(R, r, rs || 8, ts || 32, arc || TAU), 12, 1); }
  function icoGeo(r, d) { return uvFlat(new THREE.IcosahedronGeometry(r, d || 0)); }
  function dodecaGeo(r) { return uvFlat(new THREE.DodecahedronGeometry(r, 0)); }
  function octaGeo(r) { return uvFlat(new THREE.OctahedronGeometry(r, 0)); }

  /* Muskel-Platte: Kugel, die eckiger gedrueckt wird (Exponent < 1 = kantiger), z. B. Sixpack, Brust */
  function spow(v, e) { return (v < 0 ? -1 : 1) * Math.pow(Math.abs(v), e); }
  function plateGeo(ex, ey, ez, ws, hs, tb, tt) {
    var g = new THREE.SphereGeometry(1, ws || 22, hs || 16), p = g.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var y = p.getY(i), taper = 1 - (tb || 0) * Math.max(0, -y) - (tt || 0) * Math.max(0, y);   // unten/oben schmaler
      p.setXYZ(i, spow(p.getX(i), ex) * taper, spow(y, ey), spow(p.getZ(i), ez));
    }
    g.computeVertexNormals();
    return uvScale(g, 8, 6);
  }

  /* Drehkoerper aus Profil [[radius, y], ...] (von unten nach oben) */
  function latheGeo(prof, seg, p0, pl) {
    var pts = prof.map(function (q) { return new THREE.Vector2(Math.max(0, q[0]), q[1]); });
    var g = new THREE.LatheGeometry(pts, seg || 24, p0 || 0, pl || TAU);
    return uvScale(g, 8, Math.max(2, Math.round(pts.length / 1.5)));
  }

  function sampleR(rs, t) {
    if (rs.length === 1) return rs[0];
    var f = t * (rs.length - 1), i = Math.min(rs.length - 2, Math.floor(f)), u = f - i;
    u = u * u * (3 - 2 * u);
    return rs[i] + (rs[i + 1] - rs[i]) * u;
  }
  /* Glied (Arm, Bein, Hals ...): Laenge entlang +y, Radien von unten nach oben, runde Enden.
     Ersatz fuer CapsuleGeometry (gibt es in r128 nicht). */
  function limbGeo(len, rs, seg) {
    rs = (rs && rs.length) ? rs : [0.05];
    var r0 = rs[0], r1 = rs[rs.length - 1], pts = [], i, a, CAP = 4;
    var capB = r0 * 0.85, capT = r1 * 0.85;
    for (i = 0; i <= CAP; i++) {
      a = -PI / 2 + (i / CAP) * PI / 2;
      pts.push(new THREE.Vector2(i === 0 ? 0 : Math.cos(a) * r0, Math.sin(a) * capB));
    }
    var n = Math.max(4, rs.length * 3);
    for (i = 1; i < n; i++) { var t = i / n; pts.push(new THREE.Vector2(sampleR(rs, t), t * len)); }
    for (i = 0; i <= CAP; i++) {
      a = (i / CAP) * PI / 2;
      pts.push(new THREE.Vector2(i === CAP ? 0 : Math.cos(a) * r1, len + Math.sin(a) * capT));
    }
    return uvScale(new THREE.LatheGeometry(pts, seg || 14), 6, Math.max(2, Math.round(len / 0.07)));
  }
  /* Kapsel = Glied mit gleichem Radius */
  function capsuleGeo(r, len, seg) { return limbGeo(len, [r, r], seg); }

  /* Rippe: offener Ring, Luecke vorne */
  function ribGeo(R, tube) {
    var gap = 1.1;
    var g = torusGeo(R, tube || 0.011, 5, 26, TAU - gap);
    g.rotateX(-PI / 2);
    g.rotateY(gap / 2 - PI / 2);
    return g;
  }

  /* ================= Materialien ("Looks") =================
     Ein Look = Farbe + Leuchtwerte. Flaeche, Kanten und Tiefen-Maske teilen sich die Uniforms. */
  function makeCommon() {
    return {
      uTime: { value: 0 }, uPx: { value: 1 }, uFlick: { value: 1 }, uGlitch: { value: 0 },
      uDissolve: { value: 0 }, uKcal: { value: 0 }, uLevel: { value: 0 }, uHealthy: { value: 0 },
      uLiq1: { value: new THREE.Color(COL.liqLow) }, uLiq2: { value: new THREE.Color(COL.liqTop) }
    };
  }
  function lookColor(c) { return (c && c.isColor) ? c.clone() : new THREE.Color(hexOr(c, COL.cyan)); }
  function makeLook(stage, name, p) {
    var u = {
      uColor: { value: lookColor(p.color) }, uAlpha: { value: p.alpha != null ? p.alpha : 1 },
      uFill: { value: p.fill }, uRim: { value: p.rim }, uWire: { value: p.wire || 0 }, uLineA: { value: p.lineA },
      uFlash: { value: 0 }, uFlashCol: { value: new THREE.Color(1, 1, 1) }
    };
    for (var k in stage.common) u[k] = stage.common[k];
    var look = { name: name, u: u, flash: 0, base: lookColor(p.color), mats: {} };
    look.target = { color: lookColor(p.color), fill: p.fill, rim: p.rim, wire: p.wire || 0, lineA: p.lineA, alpha: u.uAlpha.value };
    look.get = function (kind) {
      if (look.mats[kind]) return look.mats[kind];
      var m, dbl = kind.slice(-1) === '2';
      var side = dbl ? THREE.DoubleSide : THREE.FrontSide;
      if (kind === 'surf' || kind === 'surf2') {
        m = additive(new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: FS_SURF,
          defines: { HOLO_UV: 1, HOLO_NORMAL: 1 }, extensions: { derivatives: true }, side: side }));
      } else if (kind === 'occ' || kind === 'occ2') {
        m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: FS_OCC, side: side,
          colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
      } else {
        m = additive(new THREE.ShaderMaterial({ uniforms: u, vertexShader: VS, fragmentShader: FS_LINE }));
      }
      look.mats[kind] = m;
      stage.mats.push(m);
      return m;
    };
    return look;
  }
  function flatMat(stage, kind, color, R, alpha) {
    var m = additive(new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: lookColor(color) }, uAlpha: { value: alpha == null ? 1 : alpha }, uKind: { value: kind },
        uR: { value: R || 1 }, uTime: stage.common.uTime, uPx: stage.common.uPx, uGlitch: { value: 0 }
      },
      vertexShader: VS, fragmentShader: FS_FLAT, defines: { HOLO_UV: 1 },
      extensions: { derivatives: true }, side: THREE.DoubleSide
    }));
    stage.mats.push(m);
    return m;
  }

  /* Farbe so aufhellen, dass sie auf dunklem Grund sicher leuchtet */
  function glowColor(hex, minL) {
    var c = new THREE.Color(hexOr(hex, COL.cyan)), hsl = {};
    c.getHSL(hsl);
    if (hsl.l < minL) c.setHSL(hsl.h, Math.min(1, hsl.s * 1.08), minL);
    return c;
  }

  /* ================= Bauteile =================
     part(): Flaeche + Tiefen-Maske + Kantenlinien fuer eine Geometrie.
     o: {pos:[x,y,z], rot:[x,y,z], scale:[x,y,z]|n, double, edges(false), occ(false), edgeAngle} */
  function part(parent, geo, look, o) {
    o = o || {};
    var dbl = !!o.double;
    var m = new THREE.Mesh(geo, look.get(dbl ? 'surf2' : 'surf'));
    if (o.occ !== false) {
      var oc = new THREE.Mesh(geo, look.get(dbl ? 'occ2' : 'occ'));
      oc.userData.occ = true;
      m.add(oc);
    }
    if (o.edges !== false) {
      var eg = new THREE.EdgesGeometry(geo, o.edgeAngle || 35);
      if (eg.attributes.position && eg.attributes.position.count) {
        var ln = new THREE.LineSegments(eg, look.get('line'));
        ln.userData.line = true;
        m.add(ln);
      } else eg.dispose();
    }
    if (o.pos) m.position.set(o.pos[0], o.pos[1], o.pos[2]);
    if (o.rot) m.rotation.set(o.rot[0], o.rot[1], o.rot[2], o.order || 'XYZ');
    if (o.scale != null) {
      if (typeof o.scale === 'number') m.scale.setScalar(o.scale);
      else m.scale.set(o.scale[0], o.scale[1], o.scale[2]);
    }
    m.userData.look = look.name;
    parent.add(m);
    return m;
  }
  /* nur Tiefen-Maske (unsichtbar, verdeckt aber, z. B. leeres Gesicht in der Kapuze) */
  function occOnly(parent, geo, look, o) {
    var m = new THREE.Mesh(geo, look.get('occ'));
    m.userData.occ = true;
    if (o && o.pos) m.position.set(o.pos[0], o.pos[1], o.pos[2]);
    if (o && o.scale) m.scale.set(o.scale[0], o.scale[1], o.scale[2]);
    parent.add(m);
    return m;
  }

  /* Weltposition eines lokalen Punkts */
  function W(obj, p) { obj.updateWorldMatrix(true, false); return obj.localToWorld(p.clone()); }
  /* Punkt aus dem Raum von src in den Raum von target */
  function loc(target, src, p) {
    src.updateWorldMatrix(true, false); target.updateWorldMatrix(true, false);
    return target.worldToLocal(src.localToWorld(p.clone()));
  }
  function mul(arr, f) { return arr.map(function (x) { return x * f; }); }

  /* Gliederkette durch Punkte (Weltkoordinaten beim Aufbau). Jedes Glied ist ein Gelenk (Group),
     das naechste haengt daran -> Drehen bewegt alles dahinter. rads: Radien je Glied. */
  function chain(parent, pts, rads, look, o) {
    o = o || {};
    var piv = [], cur = parent, lastLen = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      cur.updateWorldMatrix(true, false);
      var a = cur.worldToLocal(pts[i].clone()), b = cur.worldToLocal(pts[i + 1].clone());
      var dir = b.clone().sub(a), len = dir.length();
      if (len < 1e-5) continue;
      var g = new THREE.Group();
      g.position.copy(a);
      g.quaternion.setFromUnitVectors(UPV, dir.normalize());
      cur.add(g);
      part(g, limbGeo(len, rads[Math.min(i, rads.length - 1)], o.seg), look, { edges: o.edges });
      if (o.joint && i > 0) part(g, sphereGeo(o.joint, 12, 8), o.jointLook || look, { edges: false });
      piv.push(g);
      cur = g;
      lastLen = len;
    }
    var end = new THREE.Group();
    end.position.set(0, lastLen, 0);
    cur.add(end);
    piv.end = end;
    return piv;
  }

  /* Zwei-Knochen-Gelenk (Arm/Bein): Ellbogen so, dass beide Laengen passen. hint = Knickrichtung. */
  function ik2(a, c, L1, L2, hint) {
    var d = c.clone().sub(a), dist = Math.max(0.001, d.length());
    var dn = d.clone().divideScalar(dist);
    dist = Math.min(dist, (L1 + L2) * 0.999);
    var x = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    var h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
    var perp = hint.clone().sub(dn.clone().multiplyScalar(hint.dot(dn)));
    if (perp.lengthSq() < 1e-6) perp.set(0, 0, -1);
    perp.normalize();
    return a.clone().add(dn.multiplyScalar(x)).add(perp.multiplyScalar(h));
  }

  /* Gelenk um eine Achse (im Eltern-Raum) zusaetzlich drehen, ohne die Grundhaltung zu verlieren */
  var tmpQ = null;
  function wiggle(piv, axis, angle) {
    if (!piv) return;
    if (!piv.userData.q0) piv.userData.q0 = piv.quaternion.clone();
    if (!tmpQ) tmpQ = new THREE.Quaternion();
    tmpQ.setFromAxisAngle(axis, angle);
    piv.quaternion.copy(tmpQ).multiply(piv.userData.q0);
  }
  function breathe(obj, t, amp, speed) {
    var b = Math.sin(t * (speed || 1.7));
    obj.scale.set(1 + amp * b * 0.6, 1 + amp * b, 1 + amp * b * 0.8);
  }

  /* ================= Aufraeumen ================= */
  function disposeTree(obj, keepMats) {
    var geos = new Set(), mats = new Set();
    obj.traverse(function (o) {
      if (o.geometry) geos.add(o.geometry);
      if (o.material && !keepMats) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { mats.add(m); });
    });
    geos.forEach(function (g) { g.dispose(); });
    mats.forEach(disposeMat);
  }
  function disposeMat(m) {
    if (!m) return;
    if (m.uniforms) {
      for (var k in m.uniforms) {
        var v = m.uniforms[k] && m.uniforms[k].value;
        if (v && v.isTexture) v.dispose();
      }
    }
    m.dispose();
  }

  /* ================= Buehne: Renderer, Kamera, Schleife, Ziehen ================= */
  function createStage(container, cfg) {
    initConst();
    var st = {
      destroyed: false, lost: false, inView: true, raf: 0, poll: 0, goneSince: 0, autoH: false,
      w: 0, h: 0, pr: 1, time: 0, last: 0, yawUser: 0, yawAuto: 0, spin: 0, dragging: false, idleAt: 0,
      fit: cfg.fit || { cy: 1, halfH: 1, halfW: 0.6, depth: 0.4 }, mats: [], autoOn: cfg.autoOn !== false,
      springBack: !!cfg.springBack,   // nach dem Ziehen zurueck in die Grundstellung (Gegner immer, Koerper im Fokus)
      onFrame: null, onLost: null, onRestore: null, onOrphan: null, onFail: null, onResize: null
    };
    var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0);
    st.pr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(st.pr);
    var canvas = renderer.domElement;
    canvas.className = 'holo__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.classList.add('holo');
    if (cfg.interactive) container.classList.add('holo--drag');
    container.appendChild(canvas);
    var scanEl = document.createElement('div');
    scanEl.className = 'holo__scan';
    container.appendChild(scanEl);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(cfg.fov || 26, 1, 0.05, 60);
    var root = new THREE.Group();
    scene.add(root);
    st.renderer = renderer; st.scene = scene; st.camera = camera; st.root = root; st.canvas = canvas;
    st.common = makeCommon();
    st.common.uPx.value = st.pr;
    st.pointScale = { value: 300 };

    function fitCamera() {
      var f = st.fit, t = Math.tan(camera.fov * PI / 360);
      var el = f.elev != null ? f.elev : (cfg.elev != null ? cfg.elev : 0.12);
      var cy = f.cy, d;
      if (f.pts) {
        // genaue Rahmung: alle Randpunkte (alle Posen + Schwenk) passen ins Bild
        var r = fitPoints(f, t, camera.aspect, el);
        cy = r.cy; d = r.d;
      } else {
        d = Math.max(f.halfH / t, f.halfW / (t * camera.aspect)) + (f.depth || 0);
      }
      camera.position.set(0, cy + Math.sin(el) * d, Math.cos(el) * d);
      camera.lookAt(0, cy, 0);
      camera.near = Math.max(0.02, d * 0.05);
      camera.far = d * 4 + 10;
      camera.updateProjectionMatrix();
    }
    st.setFit = function (f) { st.fit = f; if (st.w) fitCamera(); };

    function resize() {
      if (st.destroyed) return;
      var w = container.clientWidth, h = container.clientHeight;
      if (w > 0 && h === 0 && !st.autoH) {
        // Bildschirm hat keine Hoehe gesetzt -> sinnvolle Hoehe, damit man etwas sieht
        st.autoH = true;
        container.style.height = Math.round(Math.min(w * 1.1, 360)) + 'px';
        h = container.clientHeight;
      }
      if (!w || !h) return;
      var pr = Math.min(window.devicePixelRatio || 1, 2);
      if (w === st.w && h === st.h && pr === st.pr) return;
      st.w = w; st.h = h; st.pr = pr;
      renderer.setPixelRatio(pr);
      renderer.setSize(w, h, false);
      st.common.uPx.value = pr;
      camera.aspect = w / h;
      if (st.onResize) st.onResize(w, h);   // z. B. Koerper: Rahmung und Boden-Ring an schmale Buehnen anpassen
      fitCamera();
      st.pointScale.value = (h * pr) / (2 * Math.tan(camera.fov * PI / 360));
      kick();
    }
    st.resize = resize;

    function canRun() {
      return !st.destroyed && !st.lost && container.isConnected && !document.hidden && st.inView && st.w > 0 && st.h > 0;
    }
    function kick() {
      if (st.destroyed || st.raf) return;
      if (!container.isConnected) { watchConnect(); return; }
      if (!st.w) resize();
      if (st.raf || !canRun()) return;
      st.raf = requestAnimationFrame(tick);
    }
    st.kick = kick;
    function tick(ts) {
      st.raf = 0;
      if (!canRun()) {
        if (!st.destroyed && !container.isConnected) watchConnect();
        return;
      }
      st.raf = requestAnimationFrame(tick);
      if (st.last && ts - st.last < 14) return;          // hoechstens ~60 Bilder pro Sekunde
      var dt = st.last ? Math.min(0.1, (ts - st.last) / 1000) : 1 / 60;
      st.last = ts;
      st.time += dt;
      try {
        if (!st.dragging) {
          if (Math.abs(st.spin) > 0.01) { st.yawUser += st.spin * dt; st.spin *= Math.exp(-dt * 3.5); }
          if (cfg.spinSpeed && st.autoOn && st.time > st.idleAt) st.yawAuto += cfg.spinSpeed * dt;
          // Gegner: nach dem Loslassen langsam zurueck in die Grundstellung (dafuer ist die Kamera gerahmt)
          if (st.springBack && st.time > st.idleAt && st.yawUser !== 0) {
            var home = Math.round(st.yawUser / TAU) * TAU;
            st.yawUser += (home - st.yawUser) * (1 - Math.exp(-dt * 1.8));
            if (Math.abs(home - st.yawUser) < 0.001) st.yawUser = 0;
          }
        }
        if (st.onFrame) st.onFrame(dt, st.time);
        renderer.render(scene, camera);
      } catch (e) {
        console.error('[holo]', e);
        if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
        st.lost = true;
        if (st.onFail) st.onFail(e);
      }
    }
    /* Container nicht im Dokument: jede Sekunde nachsehen. Nach 60 s ohne destroy() selbst aufraeumen. */
    function watchConnect() {
      if (st.poll || st.destroyed) return;
      if (!st.goneSince) st.goneSince = Date.now();
      st.poll = setTimeout(function () {
        st.poll = 0;
        if (st.destroyed) return;
        if (container.isConnected) { st.goneSince = 0; resize(); kick(); return; }
        if (Date.now() - st.goneSince > 60000) { if (st.onOrphan) st.onOrphan(); else st.destroy(); return; }
        watchConnect();
      }, 1000);
    }

    function onVis() { if (!document.hidden) { st.last = 0; kick(); } }
    function onWinResize() { resize(); }
    document.addEventListener('visibilitychange', onVis);
    var ro = null, io = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(function () { resize(); kick(); });
      ro.observe(container);
    } else {
      window.addEventListener('resize', onWinResize);
    }
    if (window.IntersectionObserver) {
      io = new IntersectionObserver(function (entries) {
        var e = entries[entries.length - 1];
        st.inView = !!(e.isIntersecting || e.intersectionRatio > 0);
        if (st.inView) { st.last = 0; kick(); }
      }, { rootMargin: '120px' });
      io.observe(container);
    }

    /* WebGL-Kontext verloren (z. B. zu viele Kontexte, Handy im Hintergrund) */
    function onLost(e) {
      if (e && e.preventDefault) e.preventDefault();
      if (st.destroyed) return;
      st.lost = true;
      st.everLost = true;
      if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
      if (st.onLost) st.onLost();
    }
    function onRestored() {
      if (st.destroyed) return;
      st.lost = false;
      st.last = 0;
      if (st.onRestore) st.onRestore();
      kick();
    }
    canvas.addEventListener('webglcontextlost', onLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);

    /* Ziehen zum Drehen (nur waagrecht; senkrechtes Scrollen bleibt dank touch-action: pan-y) */
    var drag = null;
    function onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, t: nowMs(), v: 0 };
      st.dragging = true;
      st.spin = 0;
      container.classList.add('holo--dragging');
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var tn = nowMs(), dtm = Math.max(1, tn - drag.t), d = (e.clientX - drag.x) * 0.011;
      drag.x = e.clientX; drag.t = tn;
      st.yawUser += d;
      drag.v = drag.v * 0.6 + (d / dtm * 1000) * 0.4;
      kick();
    }
    function onUp(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      st.spin = clamp(drag.v, -8, 8);
      drag = null;
      st.dragging = false;
      st.idleAt = st.time + 2.2;
      container.classList.remove('holo--dragging');
    }
    if (cfg.interactive) {
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      canvas.addEventListener('lostpointercapture', onUp);
    }

    st.destroy = function () {
      if (st.destroyed) return;
      st.destroyed = true;
      if (st.raf) cancelAnimationFrame(st.raf);
      st.raf = 0;
      if (st.poll) clearTimeout(st.poll);
      st.poll = 0;
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      window.removeEventListener('resize', onWinResize);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('lostpointercapture', onUp);
      try {
        // War der Kontext einmal weg, gehoeren alte Puffer zum toten Kontext: nicht einzeln loeschen
        // (gibt nur Warnungen). Der Kontext wird unten ohnehin ganz freigegeben.
        if (!st.everLost) {
          disposeTree(scene);
          st.mats.forEach(disposeMat);
        }
        st.mats = [];
        if (renderer.renderLists) renderer.renderLists.dispose();
        renderer.dispose();
        var gl = renderer.getContext();
        if (gl && !gl.isContextLost()) renderer.forceContextLoss();
      } catch (e) { /* egal */ }
      canvas.width = 1; canvas.height = 1;
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (scanEl.parentNode) scanEl.parentNode.removeChild(scanEl);
      container.classList.remove('holo', 'holo--drag', 'holo--dragging', 'holo--lost');
      if (st.autoH) container.style.height = '';
    };
    return st;
  }

  /* ================= Partikel ================= */
  function makeParticles(stage, max) {
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(max * 3), col = new Float32Array(max * 3), alpha = new Float32Array(max), size = new Float32Array(max);
    var vel = new Float32Array(max * 3), life = new Float32Array(max), age = new Float32Array(max), a0 = new Float32Array(max),
      grav = new Float32Array(max), drag = new Float32Array(max);
    function attr(arr, n) { var b = new THREE.BufferAttribute(arr, n); b.setUsage(THREE.DynamicDrawUsage); return b; }
    geo.setAttribute('position', attr(pos, 3));
    geo.setAttribute('aColor', attr(col, 3));
    geo.setAttribute('aAlpha', attr(alpha, 1));
    geo.setAttribute('aSize', attr(size, 1));
    var mat = additive(new THREE.ShaderMaterial({ uniforms: { uScale: stage.pointScale }, vertexShader: VS_PTS, fragmentShader: FS_PTS }));
    stage.mats.push(mat);
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    stage.scene.add(pts);
    var next = 0, active = 0;
    return {
      /* p: Weltposition, v: Geschwindigkeit, c: THREE.Color */
      spawn: function (p, v, lifeS, sz, c, opt) {
        var i = next;
        next = (next + 1) % max;
        if (life[i] <= 0) active++;
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        vel[i * 3] = v.x; vel[i * 3 + 1] = v.y; vel[i * 3 + 2] = v.z;
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        life[i] = Math.max(0.05, lifeS); age[i] = 0; size[i] = sz;
        a0[i] = (opt && opt.alpha != null) ? opt.alpha : 1;
        grav[i] = (opt && opt.grav) || 0;
        drag[i] = (opt && opt.drag != null) ? opt.drag : 1.2;
        alpha[i] = a0[i];
      },
      update: function (dt) {
        if (!active) return;
        active = 0;
        for (var i = 0; i < max; i++) {
          if (life[i] <= 0) continue;
          age[i] += dt;
          if (age[i] >= life[i]) { life[i] = 0; alpha[i] = 0; continue; }
          active++;
          var k = Math.exp(-drag[i] * dt);
          vel[i * 3] *= k; vel[i * 3 + 1] = vel[i * 3 + 1] * k + grav[i] * dt; vel[i * 3 + 2] *= k;
          pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
          var f = age[i] / life[i];
          alpha[i] = a0[i] * Math.min(1, f * 8) * (1 - f) * (1 - f);
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aColor.needsUpdate = true;
        geo.attributes.aAlpha.needsUpdate = true;
        geo.attributes.aSize.needsUpdate = true;
      }
    };
  }

  /* ================= Boden: Ring, Gitter, Lichtsaeule ================= */
  function makePlatform(stage, R, color, height) {
    var g = new THREE.Group();
    var grid = new THREE.Mesh(new THREE.PlaneGeometry(R * 3.4, R * 3.4).rotateX(-PI / 2), flatMat(stage, 1, color, R, 0.9));
    var ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.7, R * 1.06, 96, 1).rotateX(-PI / 2), flatMat(stage, 0, color, R, 0.7));
    ring.position.y = 0.004;
    grid.material.depthTest = false;   // Boden leuchtet durch dunkle Teile hindurch (kein schwarzer Fleck)
    ring.material.depthTest = false;
    var bh = Math.max(0.3, height * 0.45);
    var beam = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.97, R, bh, 48, 1, true).translate(0, bh / 2, 0), flatMat(stage, 2, color, R, 0.7));
    g.add(grid); g.add(ring); g.add(beam);
    /* Radius nachtraeglich aendern (Muster im Shader haengt an uR) */
    g.userData.setR = function (r) {
      var k = r / R;
      g.scale.set(k, 1, k);
      [grid, ring, beam].forEach(function (m) { m.material.uniforms.uR.value = r; });
    };
    return g;
  }

  /* Krone (Tier 5) */
  function addCrown(parent, pos, s, gold, gem) {
    var g = new THREE.Group();
    g.position.set(pos[0], pos[1], pos[2]);
    g.scale.setScalar(s || 1);
    parent.add(g);
    part(g, torusGeo(0.085, 0.013, 6, 30), gold, { rot: [PI / 2, 0, 0], edges: false });
    for (var i = 0; i < 5; i++) {
      var a = i / 5 * TAU;
      part(g, coneGeo(0.024, 0.08, 6), gold, { pos: [Math.cos(a) * 0.085, 0.045, Math.sin(a) * 0.085] });
      part(g, sphereGeo(0.012, 8, 6), gem, { pos: [Math.cos(a) * 0.085, 0.09, Math.sin(a) * 0.085], edges: false });
    }
    return g;
  }

  /* Ausdehnung in der aktuellen Pose messen (fuer Boden-Ring und Lichtsaeule) */
  function measure(obj) {
    obj.updateMatrixWorld(true);
    var v = V(), r = { minY: Infinity, maxY: -Infinity, maxR: 0, footR: 0 };
    obj.traverse(function (o) {
      if (!o.isMesh || o.userData.occ || !o.geometry || !o.geometry.attributes.position) return;
      var p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 400));
      for (var i = 0; i < p.count; i += step) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        if (v.y < r.minY) r.minY = v.y;
        if (v.y > r.maxY) r.maxY = v.y;
        var rr = Math.sqrt(v.x * v.x + v.z * v.z);
        if (rr > r.maxR) r.maxR = rr;
        if (v.y < 0.35 && rr > r.footR) r.footR = rr;
      }
    });
    if (!isFinite(r.minY)) { r.minY = 0; r.maxY = 2; }
    return r;
  }

  /* Randpunkte fuer die Kamera sammeln: Modell in vielen Posen der Animation (z. B. Fluegel oben/unten),
     gedreht ueber den ganzen Schwenk-Bereich, plus Boden-Ring (Radius ringR).
     Pro Richtung (48 Sektoren) und Hoehen-Stufe bleibt nur der aeusserste Punkt -> wenige Punkte. */
  function framePoints(model, anim, yaws, ringR) {
    var SECT = 48, BAND = 0.04, POSES = 26, STEP = 0.37;   // Posen: t = 0 ... ~9 s
    var outer = {}, top = [], bot = [], v = V();
    function keep(x, y, z) {
      var r = Math.sqrt(x * x + z * z);
      var s = Math.floor((Math.atan2(z, x) + PI) / TAU * SECT) % SECT;
      var key = s + SECT * Math.floor(y / BAND + 1000);
      var o = outer[key];
      if (!o || r > o[3]) outer[key] = [x, y, z, r];
      if (!top[s] || y > top[s][1]) top[s] = [x, y, z];
      if (!bot[s] || y < bot[s][1]) bot[s] = [x, y, z];
    }
    for (var k = 0; k < POSES; k++) {
      if (anim) anim(k * STEP, 0, 1);
      model.updateMatrixWorld(true);
      model.traverse(function (o) {
        if (!o.isMesh || o.userData.occ || !o.geometry || !o.geometry.attributes.position) return;
        var p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 160));
        for (var i = 0; i < p.count; i += step) {
          v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
          keep(v.x, v.y, v.z);
        }
      });
    }
    var list = [];
    Object.keys(outer).forEach(function (key) { list.push(outer[key]); });
    top.concat(bot).forEach(function (q) { if (q) list.push(q); });
    // gedreht ueber alle Schwenk-Winkel (Drehung um y wie bei root.rotation.y)
    var out = [];
    yaws.forEach(function (a) {
      var c = Math.cos(a), s = Math.sin(a);
      list.forEach(function (q) { out.push(q[0] * c + q[2] * s, q[1], -q[0] * s + q[2] * c); });
    });
    // Boden-Ring dreht nicht mit
    for (var j = 0; j < 64; j++) {
      var an = j / 64 * TAU;
      out.push(Math.cos(an) * ringR, 0, Math.sin(an) * ringR);
    }
    return new Float32Array(out);
  }

  /* Kamera-Abstand d und Blickhoehe cy so, dass alle Punkte ins Bild passen (mit Rand pad).
     Kamera schaut von vorne (+z), um el nach oben geneigt, auf (0, cy, 0). */
  function fitPoints(f, t, aspect, el) {
    var P = f.pts, n = P.length, pad = f.pad || 1.05;
    var tx = t * aspect / pad, ty = t / pad, ce = Math.cos(el), se = Math.sin(el);
    var cy = f.cy, d = 1, i;
    for (var it = 0; it < 6; it++) {
      d = 0.1;
      for (i = 0; i < n; i += 3) {
        var qy = P[i + 1] - cy, z = P[i + 2];
        var back = qy * se + z * ce, yc = qy * ce - z * se;
        var need = back + Math.max(Math.abs(P[i]) / tx, Math.abs(yc) / ty);
        if (need > d) d = need;
      }
      if (it === 5) break;
      // oben und unten gleich viel Rand: Blickhoehe verschieben
      var hi = -Infinity, lo = Infinity;
      for (i = 0; i < n; i += 3) {
        var qy2 = P[i + 1] - cy, z2 = P[i + 2];
        var ny = (qy2 * ce - z2 * se) / (Math.max(0.01, d - (qy2 * se + z2 * ce)) * ty);
        if (ny > hi) hi = ny;
        if (ny < lo) lo = ny;
      }
      var mid = (hi + lo) / 2;
      if (Math.abs(mid) < 0.004) break;
      cy += mid * d * ty / ce;
    }
    return { cy: cy, d: d };
  }
  /* Punkte auf der Oberflaeche sammeln (fuer Partikel beim Treffer/Aufloesen) */
  function samplePoints(obj, n) {
    obj.updateMatrixWorld(true);
    var all = [];
    obj.traverse(function (o) {
      if (!o.isMesh || o.userData.occ || !o.geometry || !o.geometry.attributes.position) return;
      var p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 30));
      for (var i = 0; i < p.count; i += step) all.push(V().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
    });
    var out = [];
    for (var j = 0; j < n && all.length; j++) out.push(all[Math.floor(Math.random() * all.length)]);
    return out.length ? out : [V(0, 1, 0)];
  }

  /* ================= Koerper (Profil / Gym / Kalorien) ================= */

  /** Trainings-Gruppe -> Teile (aus OP.data.GROUPS, sonst feste Liste); auch das alte 'arme' */
  function aliasParts(id) {
    var D = OP.data;
    if (D && typeof D.group === 'function') {
      var g = D.group(id);
      if (g && Array.isArray(g.muscles)) return g.muscles;
    }
    return Object.prototype.hasOwnProperty.call(PART_ALIAS, id) ? PART_ALIAS[id] : null;
  }
  /** Muskel-Id, Gruppen-Id ('push' | 'pull' | 'legs'), 'arme' oder eine Liste davon -> Liste der Koerper-Teile */
  function resolveParts(x, out) {
    out = out || [];
    if (x == null || x === false || x === '') return out;
    if (Array.isArray(x)) {
      for (var i = 0; i < x.length; i++) resolveParts(x[i], out);
      return out;
    }
    var id = String(x).trim().toLowerCase();
    var list = PARTS.indexOf(id) >= 0 ? [id] : aliasParts(id);
    if (list) list.forEach(function (p) { if (PARTS.indexOf(p) >= 0 && out.indexOf(p) < 0) out.push(p); });
    return out;
  }
  /** Farbe je Teil. Gruppen-Farben ('push' ...) und 'arme' zuerst, genaue Teil-Farben gewinnen. */
  function partColors(cols) {
    var out = {};
    if (!cols || typeof cols !== 'object') return out;
    Object.keys(cols).forEach(function (k) {
      if (PARTS.indexOf(k) < 0 && isHex(cols[k])) resolveParts(k).forEach(function (p) { out[p] = cols[k].trim(); });
    });
    PARTS.forEach(function (p) { if (isHex(cols[p])) out[p] = cols[p].trim(); });
    return out;
  }

  /* Blickrichtung, aus der ein Teil am besten zu sehen ist (Drehung um y: 0 = von vorne, PI = von hinten) + Gewicht.
     Push -> schraeg vorne (Brust, Schulter, Trizeps an der Seite), Pull -> fast von hinten, Arme -> von der Seite. */
  var FACE = { brust: [0, 1.6], bauch: [0, 1.2], bizeps: [0.4, 1], schultern: [0.8, 0.8], beine: [0.45, 1], trizeps: [PI - 0.7, 1], ruecken: [PI, 1.6] };
  function faceFor(parts) {
    var c = 0, s = 0;
    parts.forEach(function (p) { var f = FACE[p]; if (f) { c += Math.cos(f[0]) * f[1]; s += Math.sin(f[0]) * f[1]; } });
    return (Math.abs(c) + Math.abs(s) < 1e-6) ? 0 : Math.atan2(s, c);
  }
  /** opts.view ('front' | 'back' | 'side' | Winkel) -> Winkel oder null */
  var VIEWS = { front: 0, vorne: 0, back: PI, hinten: PI, side: PI / 2, seite: PI / 2 };
  function viewYaw(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    return typeof v === 'string' && Object.prototype.hasOwnProperty.call(VIEWS, v) ? VIEWS[v] : null;
  }
  /** Winkel auf -PI..PI (kuerzester Weg beim Drehen) */
  function wrapAngle(a) { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; }

  /* Rumpf-Profil [radius, y] und Becken; vorne/hinten flach gedrueckt (Faktor TORSO_Z) */
  var TORSO = [[0, 0.955], [0.12, 0.96], [0.148, 0.985], [0.146, 1.04], [0.148, 1.1], [0.162, 1.18], [0.186, 1.26],
    [0.212, 1.34], [0.23, 1.41], [0.235, 1.47], [0.226, 1.53], [0.196, 1.572], [0.135, 1.603], [0.06, 1.622], [0, 1.626]];
  var TORSO_Z = 0.62;
  var PELVIS = [[0, 0.83], [0.1, 0.835], [0.148, 0.86], [0.163, 0.9], [0.162, 0.95], [0.15, 0.985], [0.14, 1.0], [0, 1.005]];
  var BODY_TOP = 1.925;

  function torsoR(y) {
    for (var i = 0; i < TORSO.length - 1; i++) {
      var a = TORSO[i], b = TORSO[i + 1];
      if (y >= a[1] && y <= b[1]) return a[0] + (b[0] - a[0]) * ((y - a[1]) / (b[1] - a[1] || 1));
    }
    return 0.15;
  }
  /* Tiefe der Rumpf-Oberflaeche bei Hoehe y und Seite x (vorne +z) */
  function torsoZ(y, x) {
    var r = torsoR(y), q = clamp(Math.abs(x) / r, 0, 0.98);
    return r * TORSO_Z * Math.sqrt(1 - q * q);
  }

  /* Rahmen entlang eines Knochens (a = oben, b = unten): Gruppe in der Mitte,
     lokale Achsen y = nach oben (b -> a), z = 'front' (senkrecht dazu gemacht), x = y kreuz z */
  function frameAt(parent, a, b, front) {
    var y = a.clone().sub(b).normalize();
    var z = front.clone().sub(y.clone().multiplyScalar(front.dot(y))).normalize();
    var x = V().crossVectors(y, z).normalize();
    var g = new THREE.Group();
    g.position.copy(a).add(b).multiplyScalar(0.5);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    parent.add(g);
    return g;
  }

  /* Muskelbauch: Spindel der Hoehe 2 (y -1..1), dickste Stelle (Radius 1) bei 'peak' (0 = unten, 1 = oben).
     fat < 1 = voller, > 1 = spitzer. Mit scale auf Groesse bringen (x = Breite, y = halbe Laenge, z = Dicke). */
  function bellyGeo(peak, fat, seg) {
    var pts = [], n = 16;
    peak = clamp(peak == null ? 0.5 : peak, 0.15, 0.85);
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var u = t < peak ? t / peak * 0.5 : 0.5 + (t - peak) / (1 - peak) * 0.5;
      var r = (i === 0 || i === n) ? 0 : Math.pow(Math.sin(u * PI), fat || 0.7);
      pts.push(new THREE.Vector2(r, t * 2 - 1));
    }
    return uvScale(new THREE.LatheGeometry(pts, seg || 18), 6, 5);
  }

  function buildBody(M, LK) {
    var N = LK.neutral, R = LK.ruecken;
    // Kopf, Kiefer, Hals
    var head = new THREE.Group();
    head.position.set(0, 1.782, 0.008);
    M.add(head);
    part(head, sphereGeo(0.098, 24, 18), N, { scale: [0.95, 1.2, 1.05] });
    part(head, sphereGeo(0.066, 16, 12), N, { pos: [0, -0.068, 0.03], scale: [1.05, 0.85, 1] });
    part(M, cylGeo(0.046, 0.06, 0.15, 14), N, { pos: [0, 1.64, -0.008] });
    // Rumpf + Becken (neutral)
    part(M, latheGeo(TORSO, 30), N, { scale: [1, 1, TORSO_Z] });
    part(M, latheGeo(PELVIS, 26), N, { scale: [1, 1, 0.7] });

    // Ruecken: oberer Trapez (Nacken bis Schulter, auch von vorne zu sehen), Trapez-Mitte, Latissimus, unterer Ruecken
    [1, -1].forEach(function (sd) {
      part(M, sphereGeo(1, 18, 12), R, { pos: [sd * 0.1, 1.594, -0.03], scale: [0.094, 0.036, 0.06], rot: [0, 0, -sd * 0.36] });
    });
    part(M, plateGeo(0.9, 1, 1, 22, 16, 0.85, 0.5), R, { pos: [0, 1.45, -(torsoZ(1.45, 0) - 0.028)], scale: [0.15, 0.17, 0.045] });
    var lat = plateGeo(0.8, 0.9, 1, 22, 16, 0.7, 0);
    [1, -1].forEach(function (sd) {
      part(M, lat, R, { pos: [sd * 0.112, 1.31, -(torsoZ(1.31, 0.112) - 0.03)], scale: [0.12, 0.2, 0.06], rot: [0, -sd * 0.35, -sd * 0.12] });
      part(M, sphereGeo(1, 14, 10), R, { pos: [sd * 0.04, 1.11, -(torsoZ(1.11, 0.04) - 0.012)], scale: [0.034, 0.12, 0.03] });
    });
    // Brust: zwei kantige Platten, die sich in der Mitte treffen
    var pec = plateGeo(0.62, 0.7, 1);
    [1, -1].forEach(function (sd) {
      part(M, pec, LK.brust, { pos: [sd * 0.082, 1.44, torsoZ(1.44, 0.082) - 0.026], scale: [0.092, 0.07, 0.045], rot: [0, sd * 0.3, sd * 0.1] });
    });
    // Bauch: Sixpack (2 x 3 Bloecke) + schmale seitliche Bauchmuskeln
    var ab = plateGeo(0.45, 0.5, 1, 16, 12);
    for (var r = 0; r < 3; r++) {
      var ay = 1.278 - r * 0.078;
      [1, -1].forEach(function (sd) {
        part(M, ab, LK.bauch, { pos: [sd * 0.039, ay, torsoZ(ay, 0.039) - 0.009], scale: [0.034, 0.034, 0.019], rot: [0, sd * 0.2, 0] });
      });
    }
    [1, -1].forEach(function (sd) {
      part(M, plateGeo(0.6, 0.8, 1, 14, 10), LK.bauch, { pos: [sd * 0.118, 1.16, torsoZ(1.16, 0.118) - 0.014], scale: [0.028, 0.085, 0.03], rot: [0, sd * 0.85, sd * 0.12] });
    });

    // Arme: schlanker neutraler Grundarm + Unterarm + Hand. Am Oberarm zwei getrennte Muskeln:
    // Bizeps vorne (leicht nach innen), Trizeps hinten/aussen mit zwei Koepfen (Hufeisen).
    [1, -1].forEach(function (sd) {
      var sh = V(sd * 0.232, 1.49, -0.005), el = V(sd * 0.282, 1.195, -0.03), wr = V(sd * 0.305, 0.935, 0.02);
      var arm = chain(M, [sh, el, wr], [[0.036, 0.038, 0.036, 0.035, 0.037], [0.041, 0.046, 0.04, 0.032, 0.028]], N);
      part(arm.end, sphereGeo(1, 12, 10), N, { pos: [0, 0.05, 0], scale: [0.03, 0.058, 0.04] });
      // Die beiden Muskeln bilden den Oberarm selbst; wo sie sich schneiden, entsteht seitlich die Trennlinie
      var U = frameAt(M, sh, el, V(-sd * 0.12, 0, 1));
      part(U, bellyGeo(0.42, 0.62), LK.bizeps, { pos: [-sd * 0.002, -0.016, 0.014], scale: [0.041, 0.116, 0.043] });
      part(U, bellyGeo(0.6, 0.6), LK.trizeps, { pos: [sd * 0.02, 0.018, -0.012], scale: [0.032, 0.124, 0.042] });      // seitlicher Kopf
      part(U, bellyGeo(0.52, 0.6), LK.trizeps, { pos: [-sd * 0.014, 0.0, -0.016], scale: [0.031, 0.134, 0.042] });     // langer Kopf
    });
    // Schultern (Deltamuskel): Kappe ueber dem Oberarm, laeuft nach unten spitz zu
    var delt = plateGeo(0.9, 0.95, 0.92, 22, 16, 0.45, 0);
    [1, -1].forEach(function (sd) {
      part(M, delt, LK.schultern, { pos: [sd * 0.237, 1.51, -0.004], scale: [0.074, 0.087, 0.079], rot: [0, 0, -sd * 0.3] });
    });

    // Beine + Po + Fuesse
    [1, -1].forEach(function (sd) {
      chain(M, [V(sd * 0.094, 0.9, 0), V(sd * 0.108, 0.5, 0.015), V(sd * 0.112, 0.085, -0.01)],
        [[0.098, 0.1, 0.088, 0.07, 0.056], [0.054, 0.064, 0.055, 0.04, 0.032]], LK.beine);
      part(M, plateGeo(0.8, 0.85, 1, 20, 14), LK.beine, { pos: [sd * 0.072, 0.895, -0.078], scale: [0.086, 0.094, 0.05], rot: [0.12, -sd * 0.25, 0] });
      part(M, sphereGeo(1, 14, 10), N, { pos: [sd * 0.114, 0.03, 0.035], scale: [0.043, 0.03, 0.1] });
    });
  }

  /* Zielwerte der Looks je Modus. fparts = Ziel-Teile im Fokus-Modus */
  function bodyTargets(opts, healthy, fparts) {
    var t = {}, mode = opts.mode;
    var neutral = { color: COL.cyan, fill: 0.028, rim: 0.42, wire: 0.035, lineA: 0.2 };
    if (mode === 'kcal') {
      var k = healthy
        ? { color: COL.healthy, fill: 0.16, rim: 1.0, wire: 0.08, lineA: 0.4 }
        : { color: '#43d9e8', fill: 0.05, rim: 0.5, wire: 0.08, lineA: 0.3 };
      PARTS.forEach(function (g) { t[g] = k; });
      t.neutral = k;
      return t;
    }
    if (mode === 'focus') {
      if (fparts.length) {
        var fc = isHex(opts.focusColor) ? glowColor(opts.focusColor, 0.6) : COL.cyanHi;
        PARTS.forEach(function (g) {
          t[g] = fparts.indexOf(g) >= 0
            ? { color: fc, fill: 0.3, rim: 1.35, wire: 0.14, lineA: 0.75, pulse: true }
            : { color: COL.cyanDim, fill: 0.03, rim: 0.3, wire: 0.03, lineA: 0.13 };
        });
        t.neutral = { color: COL.cyanDim, fill: 0.022, rim: 0.26, wire: 0.02, lineA: 0.1 };
      } else {
        PARTS.forEach(function (g) { t[g] = { color: COL.cyan, fill: 0.12, rim: 0.85, wire: 0.06, lineA: 0.38 }; });
        t.neutral = neutral;
      }
      return t;
    }
    // 'ranks': jeder Teil in seiner Rang-Farbe; der Rest ist ein schwacher Stahl-Koerper,
    // damit auch Platin (tuerkis wie das normale Hologramm) klar als Muskel leuchtet
    var cols = partColors(opts.colors);
    PARTS.forEach(function (g) {
      t[g] = { color: glowColor(cols[g] || COL.cyan, 0.56), fill: 0.2, rim: 1.1, wire: 0.1, lineA: 0.55 };
    });
    t.neutral = { color: COL.neutral, fill: 0.02, rim: 0.5, wire: 0.025, lineA: 0.2 };
    return t;
  }

  function glBody(container, opts) {
    var RM = reducedMotion();
    var SPIN = RM ? 0.15 : 0.42;   // Drehen rundherum (rad/s)
    var SWAY = RM ? 0.22 : 0.5;    // Pendeln um die Ziel-Muskeln im Fokus (rad)
    var st = createStage(container, {
      interactive: opts.interactive !== false,
      spinSpeed: 0,                // die Drehung steuert der Koerper selbst (rundherum oder pendeln)
      elev: 0.1,
      fit: { cy: 0.93, halfH: 1.02, halfW: 0.52, depth: 0.25 }
    });
    var S = {
      fill: clamp(num(opts.fill, 1), 0, 1), healthy: 0, dip: 0, dipDepth: 0, fb: null,
      parts: [], face: null, yaw: 0, ph: 0, turnTo: null, hint: null, hintUntil: 0
    };
    S.fillShow = S.fill;
    var looks = {}, M, levelRing, platform;
    try {
      PARTS.concat(['neutral']).forEach(function (g) {
        looks[g] = makeLook(st, g, { color: COL.cyan, fill: 0.1, rim: 0.8, wire: 0.05, lineA: 0.3 });
      });
      M = new THREE.Group();
      st.root.add(M);
      buildBody(M, looks);
      platform = makePlatform(st, 0.46, COL.cyan, BODY_TOP);
      st.scene.add(platform);
      // Pegel-Ring fuer Kalorien
      levelRing = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.43, 96, 1).rotateX(-PI / 2), flatMat(st, 0, COL.liqTop, 0.4, 0));
      st.scene.add(levelRing);
      // Schmale Buehne (z. B. Gym-Spalte): Boden-Ring kleiner, damit der Koerper die Hoehe nutzen kann
      st.onResize = function (w, h) {
        var halfW = clamp(1.02 * w / h, 0.36, 0.52);
        var rp = clamp((halfW - 0.035) / 1.06, 0.3, 0.46), k = rp / 0.46;
        st.fit = { cy: 0.93, halfH: 1.02, halfW: halfW, depth: 0.25 };
        platform.userData.setR(rp);
        levelRing.scale.set(k, 1, k);
        levelRing.material.uniforms.uR.value = 0.4 * k;
      };
      facing();
      var v0 = viewYaw(opts.view);
      S.yaw = S.face != null ? S.face : (v0 != null ? v0 : 0);   // gleich richtig ausgerichtet starten
      applyTargets(true);
    } catch (e) { st.destroy(); throw e; }

    /* Dreh-Modus: einmal in Richtung yaw drehen. Ein Versatz vom Ziehen wird vorher uebernommen,
       sonst stuende der Koerper am Ende um diesen Versatz falsch. */
    function turnTo(yaw) {
      S.yaw += st.yawUser;
      st.yawUser = 0;
      st.spin = 0;
      S.turnTo = yaw;
    }

    /* Ziel-Teile im Fokus und die Blickrichtung dazu (null = rundherum drehen) */
    function facing() {
      var before = S.parts.join(',');
      S.parts = opts.mode === 'focus' ? resolveParts(opts.focus) : [];
      S.face = S.parts.length ? faceFor(S.parts) : null;
      st.springBack = S.face != null;   // im Fokus: nach dem Ziehen zurueck zu den Ziel-Muskeln
      if (S.parts.join(',') !== before) S.hint = null;
      if (S.face != null) S.turnTo = null;
    }

    function applyTargets(instant) {
      var healthy = opts.mode === 'kcal' && S.fill <= 0.001;
      var t = bodyTargets(opts, healthy, S.parts);
      Object.keys(looks).forEach(function (g) {
        var L = looks[g], x = t[g] || t.neutral;
        L.target.color.copy(lookColor(x.color));
        L.target.fill = x.fill; L.target.rim = x.rim; L.target.wire = x.wire; L.target.lineA = x.lineA;
        L.pulse = !!x.pulse;
        if (instant) {
          L.u.uColor.value.copy(L.target.color);
          L.u.uFill.value = x.fill; L.u.uRim.value = x.rim; L.u.uWire.value = x.wire; L.u.uLineA.value = x.lineA;
        }
      });
      st.common.uKcal.value = opts.mode === 'kcal' ? 1 : 0;
      if (instant) {
        S.fillShow = S.fill;
        S.healthy = healthy ? 1 : 0;
      }
    }

    st.onFrame = function (dt, t) {
      var c = st.common;
      c.uTime.value = t;
      // leichtes Flackern
      if (!RM && S.dip <= 0 && Math.random() < dt * 0.25) { S.dip = rnd(0.04, 0.1); S.dipDepth = rnd(0.12, 0.3); }
      var fl = 0.985 + 0.015 * Math.sin(t * 43.0);
      if (S.dip > 0) { S.dip -= dt; fl *= 1 - S.dipDepth; }
      c.uFlick.value = fl;
      // Drehung: im Fokus zu den Ziel-Muskeln drehen und leicht pendeln, sonst langsam rundherum.
      // Solange gezogen wird (und kurz danach) steht die Automatik still.
      var auto = opts.autoRotate !== false, free = !st.dragging && st.time > st.idleAt;
      if (S.turnTo != null) {
        var d = wrapAngle(S.turnTo - S.yaw);
        S.yaw += d * (1 - Math.exp(-dt * 3.2));
        if (Math.abs(d) < 0.004) S.turnTo = null;
      } else if (S.face != null) {
        if (auto && free) S.ph += dt;
        // nach pulse(Muskel) zeigt der Koerper kurz diesen Muskel, danach wieder die ganze Gruppe
        var face = S.hint != null && st.time < S.hintUntil ? S.hint : S.face;
        var aim = face + (auto ? Math.sin(S.ph * 0.45) * SWAY : 0);
        S.yaw += wrapAngle(aim - S.yaw) * (1 - Math.exp(-dt * 2.6));
      } else if (auto && free) {
        S.yaw += SPIN * dt;
      }
      st.root.rotation.y = S.yaw + st.yawUser;
      var b = Math.sin(t * 1.6);
      M.scale.set(1 + b * 0.005, 1 + b * 0.002, 1 + b * 0.008);
      // Looks sanft zu den Zielwerten
      var k = 1 - Math.exp(-dt * 4);
      Object.keys(looks).forEach(function (g) {
        var L = looks[g], u = L.u, T = L.target;
        u.uColor.value.lerp(T.color, k);
        var pul = L.pulse ? (0.75 + 0.45 * (0.5 + 0.5 * Math.sin(t * 4.2))) : 1;
        u.uFill.value += (T.fill * pul - u.uFill.value) * (L.pulse ? 0.5 : k);
        u.uRim.value += (T.rim * (L.pulse ? 0.85 + 0.25 * pul : 1) - u.uRim.value) * (L.pulse ? 0.5 : k);
        u.uWire.value += (T.wire - u.uWire.value) * k;
        u.uLineA.value += (T.lineA - u.uLineA.value) * k;
        L.flash *= Math.exp(-dt * 5);
        u.uFlash.value = L.flash * 0.8;
      });
      // Kalorien-Pegel
      S.fillShow += (S.fill - S.fillShow) * (1 - Math.exp(-dt * 2.2));
      if (Math.abs(S.fill - S.fillShow) < 0.0005) S.fillShow = S.fill;
      var level = S.fillShow * (BODY_TOP + 0.02);
      c.uLevel.value = level;
      var healthyNow = opts.mode === 'kcal' && S.fill <= 0.001 && S.fillShow < 0.003;
      S.healthy += ((healthyNow ? 1 : 0) - S.healthy) * k;
      c.uHealthy.value = S.healthy;
      var showRing = opts.mode === 'kcal' && S.fillShow > 0.003 && S.fillShow < 0.995;
      var ra = levelRing.material.uniforms.uAlpha;
      ra.value += ((showRing ? 1 : 0) - ra.value) * k;
      levelRing.visible = ra.value > 0.01;
      levelRing.position.y = level;
      levelRing.rotation.y = t * 0.3;
    };

    function showFallback(on) {
      if (on && !S.fb) { container.classList.add('holo--lost'); S.fb = fallbackBody(container, extend({}, opts), true); }
      if (!on && S.fb) { container.classList.remove('holo--lost'); S.fb.destroy(); S.fb = null; }
    }
    st.onLost = function () { showFallback(true); };
    st.onFail = function () { showFallback(true); };
    st.onRestore = function () { showFallback(false); };
    var handle;
    st.onOrphan = function () { handle.destroy(); };
    st.kick();

    handle = {
      fallback: false,
      el: container,
      update: function (p) {
        if (st.destroyed || !p) return;
        var modeBefore = opts.mode;
        var colors = p.colors ? extend({}, opts.colors, p.colors) : opts.colors;
        extend(opts, p);
        opts.colors = colors;
        if (p.fill != null) S.fill = clamp(num(p.fill, S.fill), 0, 1);
        facing();
        // Dreh-Modus: auf Wunsch einmal in eine Richtung drehen (danach weiter rundherum)
        var v = viewYaw(p.view);
        if (S.face == null && v != null) turnTo(v);
        applyTargets(false);
        if (modeBefore !== opts.mode && opts.mode === 'kcal') S.fillShow = 0;   // Pegel steigt sichtbar an
        if (S.fb) S.fb.update(p);
        st.kick();
      },
      /* Aufleuchten: ein Teil, eine Gruppe, eine Liste oder (ohne Angabe) alles.
         Der Koerper wendet dem Teil die richtige Seite zu (im Fokus fuer ein paar Sekunden). */
      pulse: function (id) {
        if (st.destroyed) return;
        var all = id == null || id === '';
        var list = all ? PARTS : resolveParts(id);
        if (all) looks.neutral.flash = 1;
        list.forEach(function (g) { looks[g].flash = 1; });
        if (!all && list.length) {
          if (S.face == null) turnTo(faceFor(list));
          else { S.hint = faceFor(list); S.hintUntil = st.time + 6; }
        }
        if (S.fb) S.fb.pulse(id);
        st.kick();
      },
      destroy: function () {
        showFallback(false);
        st.destroy();
      }
    };
    return handle;
  }

  /* ================= Gegner: Bausteine ================= */
  function makeUpper(M, y, hunch) {
    var g = new THREE.Group();
    g.position.set(0, y, 0);
    g.rotation.x = hunch || 0;
    M.add(g);
    return g;
  }

  /* Mensch-Grundform. Haende (p.hands.r/l) in Koordinaten des Oberkoerpers (upper). +x = rechte Hand. */
  function humanoid(M, L, p) {
    p = p || {};
    var s = p.s || 1, bw = p.bulk || 1, lw = p.limb || bw;
    var skin = p.skin || L.main, cloth = p.cloth || L.main;
    var waistY = 1.02 * s, hipY = 0.93 * s;
    var up = p.upper || makeUpper(M, waistY, p.hunch);
    var H = { upper: up, s: s };
    // Becken + Oberkoerper
    part(M, sphereGeo(1, 20, 12), p.pelvisLook || cloth, { pos: [0, hipY + 0.015 * s, 0], scale: [0.155 * bw, 0.105 * s, 0.115 * bw] });
    var tp = [[0, -0.09], [0.13, -0.08], [0.15, -0.02], [0.155, 0.08], [0.17, 0.18], [0.19, 0.28], [0.205, 0.36], [0.205, 0.43], [0.18, 0.49], [0.11, 0.53], [0, 0.545]];
    H.torso = part(up, latheGeo(tp.map(function (q) { return [q[0] * bw, q[1] * s]; }), 26), p.torsoLook || cloth, { scale: [1, 1, p.depth || 0.66] });
    // Hals + Kopf
    var head = new THREE.Group();
    head.position.set(0, (p.headY || 0.715) * s, p.headZ || 0.01);
    up.add(head);
    H.head = head;
    H.headR = p.headR || 0.105 * s;
    if (p.head !== false) {
      part(up, cylGeo(0.047 * bw, 0.058 * bw, 0.13 * s, 12), skin, { pos: [0, 0.575 * s, 0] });
      part(head, sphereGeo(H.headR, 22, 16), skin, { scale: p.headScale || [0.94, 1.12, 1.02] });
    }
    // Beine
    H.legs = [];
    if (p.legs !== false) {
      [1, -1].forEach(function (sd) {
        var hip = V(sd * 0.088 * bw, hipY, 0);
        var knee = V(sd * (0.098 * bw + (p.bow || 0)), 0.5 * s, 0.02 + (p.kneeZ || 0));
        var ank = V(sd * 0.1 * bw, 0.085 * s, -0.01);
        H.legs.push(chain(M, [hip, knee, ank], [mul([0.082, 0.088, 0.076, 0.058], lw), mul([0.052, 0.058, 0.046, 0.034], lw)], p.legLook || cloth));
        part(M, sphereGeo(1, 14, 10), p.footLook || L.dim, { pos: [sd * 0.1 * bw, 0.034 * s, 0.035 * s], scale: [0.048 * bw, 0.034 * s, 0.105 * s] });
      });
    }
    // Arme
    H.arms = {};
    [1, -1].forEach(function (sd) {
      var key = sd > 0 ? 'r' : 'l';
      var shL = V(sd * 0.205 * bw, 0.44 * s, 0);
      var handL = (p.hands && p.hands[key]) ? p.hands[key].clone() : V(sd * 0.29 * bw, -0.1 * s, 0.05);
      var al = (p.armLen || 1) * s;
      var hint = (p.hints && p.hints[key]) ? p.hints[key] : V(sd * 0.5, -0.2, -0.8);
      var elL = ik2(shL, handL, 0.3 * al, 0.28 * al, hint);
      var ch = chain(up, [W(up, shL), W(up, elL), W(up, handL)],
        [mul([0.052, 0.06, 0.054, 0.044], lw), mul([0.045, 0.047, 0.038, 0.031], lw)], p.armLook || skin);
      part(ch.end, sphereGeo(1, 12, 10), p.handLook || skin, { pos: [0, 0.03 * s, 0], scale: [0.036 * lw, 0.05 * s, 0.03 * lw] });
      part(up, sphereGeo(0.066 * bw, 16, 12), p.shoulderLook || cloth, { pos: [shL.x, shL.y, shL.z] });
      H.arms[key] = ch;
    });
    return H;
  }
  function humanIdle(H, t, amp) {
    breathe(H.upper, t, amp || 0.012, 1.7);
    H.head.rotation.y = (H.head.userData.ry || 0) + Math.sin(t * 0.5) * 0.2;
  }

  var ARCH = {};

  /* ---- Soldat: Sturmgewehr, Helm mit Nachtsicht, Weste ---- */
  ARCH.soldat = function (M, L) {
    var up = makeUpper(M, 1.02, 0.03);
    var rifle = new THREE.Group();
    rifle.position.set(-0.07, 0.21, 0.26);
    rifle.rotation.set(0.12, -0.95, 0.06, 'YXZ');
    up.add(rifle);
    part(rifle, boxGeo(0.052, 0.075, 0.36), L.metal, {});
    part(rifle, boxGeo(0.046, 0.056, 0.22), L.dim, { pos: [0, 0.004, 0.29] });
    part(rifle, cylGeo(0.012, 0.012, 0.2, 8), L.metal, { pos: [0, 0.01, 0.49], rot: [PI / 2, 0, 0] });
    part(rifle, cylGeo(0.019, 0.019, 0.05, 10), L.metal, { pos: [0, 0.01, 0.6], rot: [PI / 2, 0, 0] });
    part(rifle, boxGeo(0.034, 0.13, 0.055), L.dim, { pos: [0, -0.1, 0.07], rot: [0.28, 0, 0] });
    part(rifle, boxGeo(0.032, 0.09, 0.04), L.dim, { pos: [0, -0.075, -0.085], rot: [-0.35, 0, 0] });
    part(rifle, boxGeo(0.04, 0.085, 0.2), L.metal, { pos: [0, -0.02, -0.28] });
    part(rifle, boxGeo(0.026, 0.035, 0.08), L.metal, { pos: [0, 0.056, 0.02] });
    part(rifle, sphereGeo(0.009, 8, 6), L.glow, { pos: [0, 0.06, 0.065], edges: false });
    var H = humanoid(M, L, {
      upper: up, torsoLook: L.dim, legLook: L.dim,
      hands: { r: loc(up, rifle, V(0, -0.105, -0.095)), l: loc(up, rifle, V(0, -0.035, 0.3)) },
      hints: { r: V(1, -0.6, -0.4), l: V(-0.6, -1, 0.1) }
    });
    // Helm + Nachtsichtgeraet
    part(H.head, partSphere(0.123, 20, 10, 0, TAU, 0, PI * 0.56), L.metal, { pos: [0, 0.028, -0.006], double: true, scale: [1, 1, 1.05] });
    part(H.head, boxGeo(0.055, 0.04, 0.05), L.metal, { pos: [0, 0.1, 0.105], rot: [-0.3, 0, 0] });
    [1, -1].forEach(function (sd) {
      part(H.head, cylGeo(0.013, 0.013, 0.04, 10), L.glow, { pos: [sd * 0.016, 0.078, 0.13], rot: [PI / 2, 0, 0], edges: false });
    });
    // Weste + Taschen + Guertel
    part(up, boxGeo(0.34, 0.3, 0.27), L.main, { pos: [0, 0.27, 0] });
    for (var i = -1; i <= 1; i++) part(up, boxGeo(0.075, 0.085, 0.045), L.dim, { pos: [i * 0.085, 0.2, 0.15] });
    part(M, torusGeo(0.155, 0.018, 6, 28), L.dim, { pos: [0, 1.0, 0], rot: [PI / 2, 0, 0], scale: [1, 0.72, 1] });
    return {
      crown: { parent: H.head, pos: [0, 0.165, 0], s: 1.1 },
      anim: function (t) { humanIdle(H, t); up.rotation.x = 0.03 + Math.sin(t * 1.1) * 0.012; }
    };
  };

  /* ---- Scharfschuetze: langes Gewehr mit Zielfernrohr, Kapuze, Umhang ---- */
  ARCH.scharfschuetze = function (M, L) {
    var up = makeUpper(M, 1.02, 0.06);
    var rifle = new THREE.Group();
    rifle.position.set(-0.13, 0.41, 0.24);
    rifle.rotation.set(0.03, -1.02, 0, 'YXZ');
    up.add(rifle);
    part(rifle, boxGeo(0.045, 0.07, 0.42), L.metal, {});
    part(rifle, cylGeo(0.011, 0.014, 0.62, 8), L.metal, { pos: [0, 0.012, 0.52], rot: [PI / 2, 0, 0] });
    part(rifle, boxGeo(0.032, 0.032, 0.07), L.metal, { pos: [0, 0.012, 0.85] });
    part(rifle, cylGeo(0.026, 0.026, 0.28, 12), L.dim, { pos: [0, 0.078, 0.02], rot: [PI / 2, 0, 0] });
    part(rifle, cylGeo(0.034, 0.026, 0.05, 12), L.dim, { pos: [0, 0.078, 0.18], rot: [PI / 2, 0, 0] });
    part(rifle, cylGeo(0.03, 0.03, 0.006, 12), L.glow, { pos: [0, 0.078, 0.207], rot: [PI / 2, 0, 0], edges: false });
    part(rifle, boxGeo(0.02, 0.04, 0.02), L.metal, { pos: [0, 0.045, -0.06] });
    part(rifle, boxGeo(0.02, 0.04, 0.02), L.metal, { pos: [0, 0.045, 0.09] });
    part(rifle, boxGeo(0.04, 0.1, 0.28), L.metal, { pos: [0, -0.025, -0.35] });
    part(rifle, boxGeo(0.03, 0.09, 0.04), L.dim, { pos: [0, -0.08, -0.12], rot: [-0.35, 0, 0] });
    part(rifle, boxGeo(0.034, 0.08, 0.06), L.dim, { pos: [0, -0.07, 0.06] });
    [1, -1].forEach(function (sd) {
      part(rifle, cylGeo(0.006, 0.006, 0.22, 6), L.metal, { pos: [sd * 0.018, -0.025, 0.4], rot: [PI / 2, 0, 0], edges: false });
    });
    var H = humanoid(M, L, {
      upper: up, torsoLook: L.dim, legLook: L.dim,
      hands: { r: loc(up, rifle, V(0, -0.11, -0.13)), l: loc(up, rifle, V(0, -0.045, 0.32)) },
      hints: { r: V(1, -0.2, -0.3), l: V(-0.3, -1, 0.2) }
    });
    H.head.rotation.set(0.12, -0.7, 0.1);
    H.head.userData.ry = -0.7;
    // Kapuze (vorne offen) + Umhang (hinten)
    var gap = 1.5;
    part(H.head, partSphere(0.14, 20, 12, PI / 2 + gap / 2, TAU - gap, 0, PI * 0.62), L.dim, { pos: [0, 0.012, -0.012], double: true });
    part(up, latheGeo([[0.34, -0.55], [0.31, -0.3], [0.27, 0.0], [0.25, 0.3], [0.23, 0.46]], 24, PI * 0.6, PI * 0.8), L.dim, { double: true, scale: [1, 1, 0.75] });
    [1, -1].forEach(function (sd) {
      part(H.head, sphereGeo(0.014, 8, 6), L.glow, { pos: [sd * 0.035, 0.012, 0.095], edges: false });
    });
    return {
      crown: { parent: H.head, pos: [0, 0.18, -0.01], s: 1.2 },
      anim: function (t) { breathe(up, t, 0.008, 1.3); H.head.rotation.y = -0.7 + Math.sin(t * 0.4) * 0.05; }
    };
  };

  /* ---- Schwer: gepanzerter Riese mit Minigun ---- */
  ARCH.schwer = function (M, L) {
    var s = 1.06, bw = 1.42;
    var up = makeUpper(M, 1.02 * s, 0.07);
    var gun = new THREE.Group();
    gun.position.set(-0.04, 0.02, 0.42);
    gun.rotation.set(0.03, -0.85, 0, 'YXZ');
    up.add(gun);
    part(gun, cylGeo(0.09, 0.09, 0.3, 16), L.metal, { rot: [PI / 2, 0, 0] });
    part(gun, cylGeo(0.07, 0.09, 0.08, 16), L.dim, { pos: [0, 0, -0.19], rot: [PI / 2, 0, 0] });
    var barrels = new THREE.Group();
    barrels.position.z = 0.15;
    gun.add(barrels);
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * TAU;
      part(barrels, cylGeo(0.016, 0.016, 0.62, 8), L.metal, { pos: [Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0.31], rot: [PI / 2, 0, 0] });
    }
    part(barrels, torusGeo(0.062, 0.012, 6, 20), L.dim, { pos: [0, 0, 0.3] });
    part(barrels, torusGeo(0.062, 0.012, 6, 20), L.dim, { pos: [0, 0, 0.6] });
    part(gun, boxGeo(0.045, 0.13, 0.05), L.dim, { pos: [0, -0.12, -0.12], rot: [-0.25, 0, 0] });
    part(gun, boxGeo(0.04, 0.03, 0.2), L.dim, { pos: [0, 0.14, 0.02] });
    part(gun, boxGeo(0.03, 0.05, 0.03), L.dim, { pos: [0, 0.11, -0.06] });
    part(gun, boxGeo(0.03, 0.05, 0.03), L.dim, { pos: [0, 0.11, 0.1] });
    part(gun, boxGeo(0.14, 0.14, 0.16), L.dim, { pos: [0.14, -0.04, -0.06] });
    var H = humanoid(M, L, {
      s: s, bulk: bw, limb: 1.45, upper: up, torsoLook: L.dim, legLook: L.dim,
      hands: { r: loc(up, gun, V(0, -0.17, -0.13)), l: loc(up, gun, V(0, 0.15, 0.06)) },
      hints: { r: V(1, -0.5, -0.5), l: V(-1, -0.4, 0) }
    });
    // Helm mit Leucht-Visier
    part(H.head, sphereGeo(0.15, 20, 14), L.metal, { scale: [1, 1.02, 1.06] });
    part(H.head, boxGeo(0.2, 0.032, 0.05), L.glow, { pos: [0, 0.01, 0.14] });
    part(H.head, boxGeo(0.16, 0.07, 0.06), L.dim, { pos: [0, -0.08, 0.11] });
    [1, -1].forEach(function (sd) {
      part(up, partSphere(0.17, 18, 10, 0, TAU, 0, PI * 0.5), L.metal, { pos: [sd * 0.3, 0.46 * s, 0], rot: [0, 0, -sd * 0.35], scale: [1.05, 0.8, 1.05], double: true });
      part(M, boxGeo(0.11, 0.12, 0.06), L.metal, { pos: [sd * 0.14, 0.52 * s, 0.1] });
    });
    part(up, boxGeo(0.5, 0.34, 0.34), L.metal, { pos: [0, 0.3 * s, 0.005] });
    part(up, boxGeo(0.4, 0.09, 0.3), L.dim, { pos: [0, 0.09, 0] });
    part(up, boxGeo(0.38, 0.08, 0.29), L.dim, { pos: [0, -0.01, 0] });
    // Rucksack + Munitionsgurt zur Waffe
    part(up, boxGeo(0.42, 0.44, 0.2), L.dim, { pos: [0, 0.28, -0.27] });
    var b0 = V(0.18, 0.1, -0.2), b1 = loc(up, gun, V(0.14, -0.1, -0.06));
    for (var k = 0; k <= 7; k++) {
      var f = k / 7, bp = b0.clone().lerp(b1, f);
      bp.x += Math.sin(f * PI) * 0.12; bp.y -= Math.sin(f * PI) * 0.12;
      part(up, boxGeo(0.035, 0.05, 0.03), L.metal, { pos: [bp.x, bp.y, bp.z], edges: false });
    }
    return {
      crown: { parent: H.head, pos: [0, 0.2, 0], s: 1.45 },
      anim: function (t) { humanIdle(H, t, 0.01); barrels.rotation.z = t * 1.2; }
    };
  };

  /* ---- Forscher: Laborkittel, Brille, Injektor-Pistole, Kolben ---- */
  ARCH.forscher = function (M, L) {
    var up = makeUpper(M, 1.02, 0.02);
    var gun = new THREE.Group();
    gun.position.set(0.17, 0.14, 0.34);
    gun.rotation.set(0.1, -0.55, 0, 'YXZ');
    up.add(gun);
    part(gun, cylGeo(0.036, 0.036, 0.24, 14), L.metal, { rot: [PI / 2, 0, 0] });
    part(gun, cylGeo(0.024, 0.024, 0.18, 12), L.glow, { pos: [0, 0.05, 0], rot: [PI / 2, 0, 0], edges: false });
    part(gun, coneGeo(0.032, 0.08, 12), L.metal, { pos: [0, 0, 0.16], rot: [PI / 2, 0, 0] });
    part(gun, cylGeo(0.005, 0.005, 0.16, 6), L.metal, { pos: [0, 0, 0.27], rot: [PI / 2, 0, 0], edges: false });
    part(gun, boxGeo(0.03, 0.1, 0.04), L.dim, { pos: [0, -0.07, -0.05], rot: [-0.3, 0, 0] });
    part(gun, cylGeo(0.01, 0.01, 0.1, 6), L.metal, { pos: [0, 0, -0.17], rot: [PI / 2, 0, 0] });
    var flask = V(-0.3, -0.04, 0.2);
    var H = humanoid(M, L, {
      bulk: 0.86, upper: up, torsoLook: L.coat, legLook: L.dim,
      hands: { r: loc(up, gun, V(0, -0.12, -0.06)), l: flask.clone().add(V(0, 0.06, -0.02)) },
      hints: { r: V(1, -0.8, -0.3), l: V(-1, -0.6, -0.2) }
    });
    // Kittel (vorne offen) + Kragen
    part(M, latheGeo([[0.31, 0.46], [0.29, 0.62], [0.24, 0.9], [0.205, 1.1], [0.2, 1.3], [0.19, 1.46]], 26, 0.32, TAU - 0.64), L.coat, { double: true, scale: [1, 1, 0.78] });
    [1, -1].forEach(function (sd) {
      part(up, boxGeo(0.07, 0.12, 0.012), L.coat, { pos: [sd * 0.07, 0.44, 0.11], rot: [0.3, 0, -sd * 0.4] });
      part(H.head, cylGeo(0.028, 0.03, 0.03, 16), L.glow, { pos: [sd * 0.04, 0.018, 0.092], rot: [PI / 2, 0, 0], edges: false });
    });
    part(H.head, torusGeo(0.103, 0.008, 5, 28), L.dim, { pos: [0, 0.018, 0], rot: [PI / 2, 0, 0], scale: [0.95, 1.05, 1] });
    part(H.head, partSphere(0.112, 18, 10, 0, TAU, 0, PI * 0.42), L.dim, { pos: [0, 0.03, -0.012], double: true });
    part(up, boxGeo(0.05, 0.02, 0.01), L.glow, { pos: [-0.1, 0.33, 0.135] });
    // Kolben mit leuchtender Fluessigkeit
    part(up, sphereGeo(0.05, 14, 10), L.glow, { pos: [flask.x, flask.y, flask.z] });
    part(up, cylGeo(0.016, 0.016, 0.07, 10), L.metal, { pos: [flask.x, flask.y + 0.07, flask.z] });
    return {
      crown: { parent: H.head, pos: [0, 0.165, 0], s: 1.1 },
      anim: function (t) { humanIdle(H, t); gun.rotation.x = 0.1 + Math.sin(t * 1.3) * 0.03; }
    };
  };

  /* ---- Skelett: duenne Knochen, Rippen, Schaedel, rostiges Schwert ---- */
  ARCH.skelett = function (M, L) {
    var B = L.main;
    var up = makeUpper(M, 1.0, 0.08);
    var skull = new THREE.Group();
    skull.position.set(0, 0.7, 0.03);
    up.add(skull);
    part(skull, sphereGeo(0.1, 20, 14), B, { scale: [0.9, 1.0, 1.05] });
    part(skull, boxGeo(0.1, 0.045, 0.085), B, { pos: [0, -0.095, 0.03] });
    part(skull, boxGeo(0.07, 0.012, 0.012), L.dim, { pos: [0, -0.075, 0.08] });
    part(skull, coneGeo(0.012, 0.03, 3), L.dim, { pos: [0, -0.035, 0.1], rot: [PI, 0, 0] });
    [1, -1].forEach(function (sd) {
      part(skull, sphereGeo(0.02, 10, 8), L.glow, { pos: [sd * 0.036, 0.0, 0.088], edges: false });
    });
    // Wirbelsaeule
    for (var i = 0; i < 9; i++) part(up, cylGeo(0.022, 0.024, 0.045, 8), B, { pos: [0, -0.05 + i * 0.07, -0.1 - Math.sin(i / 8 * PI) * 0.015] });
    // Rippen + Brustbein + Schluesselbeine
    [[0.47, 0.12], [0.4, 0.14], [0.33, 0.15], [0.26, 0.145], [0.19, 0.13]].forEach(function (r) {
      part(up, ribGeo(r[1]), B, { pos: [0, r[0], -0.005], rot: [0.25, 0, 0], scale: [1, 1, 0.78] });
    });
    part(up, boxGeo(0.03, 0.22, 0.02), B, { pos: [0, 0.36, 0.115], rot: [0.12, 0, 0] });
    [1, -1].forEach(function (sd) {
      chain(up, [W(up, V(sd * 0.02, 0.555, 0.09)), W(up, V(sd * 0.18, 0.54, 0))], [[0.012, 0.012]], B, { edges: false });
    });
    // Becken
    part(M, torusGeo(0.1, 0.022, 6, 20), B, { pos: [0, 0.95, 0], rot: [PI / 2, 0, 0], scale: [1.1, 0.8, 1] });
    [1, -1].forEach(function (sd) {
      part(M, sphereGeo(1, 12, 8), B, { pos: [sd * 0.085, 0.99, -0.01], scale: [0.06, 0.065, 0.028], rot: [0, sd * 0.4, 0] });
    });
    // Beine
    [1, -1].forEach(function (sd) {
      chain(M, [V(sd * 0.085, 0.93, 0), V(sd * 0.095, 0.5, 0.03), V(sd * 0.095, 0.08, 0)],
        [[0.026, 0.018, 0.018, 0.026], [0.022, 0.016, 0.016, 0.02]], B, { joint: 0.032, edges: false });
      part(M, boxGeo(0.05, 0.025, 0.12), B, { pos: [sd * 0.095, 0.02, 0.04] });
    });
    // Schwert (rechte Hand)
    var handR = V(0.27, -0.02, 0.2);
    var sword = new THREE.Group();
    sword.position.copy(handR);
    sword.rotation.set(2.25, 0.25, 0);
    up.add(sword);
    part(sword, cylGeo(0.014, 0.014, 0.12, 8), L.dim, {});
    part(sword, boxGeo(0.14, 0.022, 0.03), L.metal, { pos: [0, 0.07, 0] });
    part(sword, boxGeo(0.045, 0.6, 0.01), L.metal, { pos: [0, 0.38, 0] });
    part(sword, coneGeo(0.032, 0.07, 4), L.metal, { pos: [0, 0.715, 0], scale: [1, 1, 0.25] });
    part(sword, sphereGeo(0.02, 8, 6), L.dim, { pos: [0, -0.07, 0] });
    // Arme
    var arms = {};
    [1, -1].forEach(function (sd) {
      var sh = V(sd * 0.18, 0.54, 0);
      var hd = sd > 0 ? handR : V(-0.27, -0.12, 0.05);
      var el = ik2(sh, hd, 0.3, 0.28, V(sd * 0.6, -0.2, -0.8));
      var ch = chain(up, [W(up, sh), W(up, el), W(up, hd)], [[0.024, 0.016, 0.016, 0.022], [0.02, 0.014, 0.014, 0.018]], B, { joint: 0.03, edges: false });
      part(up, sphereGeo(0.034, 10, 8), B, { pos: [sh.x, sh.y, sh.z], edges: false });
      part(ch.end, sphereGeo(0.03, 10, 8), B, { pos: [0, 0.03, 0], edges: false });
      arms[sd] = ch;
    });
    return {
      crown: { parent: skull, pos: [0, 0.1, 0], s: 1.05 },
      anim: function (t) {
        breathe(up, t, 0.006, 1.2);
        skull.rotation.y = Math.sin(t * 0.6) * 0.25;
        skull.rotation.z = Math.sin(t * 0.9) * 0.05;
        wiggle(arms[-1][0], AX_X, Math.sin(t * 1.1) * 0.06);
      }
    };
  };

  /* ---- Goblin: klein, grosser Kopf, lange Ohren, Dolch ---- */
  ARCH.goblin = function (M, L) {
    var s = 0.64;
    var up = makeUpper(M, 1.02 * s, 0.38);
    var dag = new THREE.Group();
    dag.position.set(0.19, 0.1, 0.2);
    dag.rotation.set(1.25, -0.2, 0);
    up.add(dag);
    part(dag, cylGeo(0.013, 0.013, 0.08, 8), L.dim, {});
    part(dag, boxGeo(0.07, 0.014, 0.022), L.metal, { pos: [0, 0.045, 0] });
    part(dag, coneGeo(0.026, 0.22, 4), L.metal, { pos: [0, 0.16, 0], scale: [1, 1, 0.35] });
    var H = humanoid(M, L, {
      s: s, bulk: 0.9, limb: 0.85, upper: up, headR: 0.15, headY: 0.8, headZ: 0.04, headScale: [1, 0.95, 0.95],
      armLen: 1.25, bow: 0.03, kneeZ: 0.06,
      hands: { r: dag.position.clone(), l: V(-0.22, 0.02, 0.2) }
    });
    H.head.rotation.x = -0.3;
    var ears = [];
    [1, -1].forEach(function (sd) {
      ears.push(part(H.head, coneGeo(0.05, 0.22, 8), L.main, { pos: [sd * 0.23, 0.07, -0.02], rot: [0, 0, -sd * 1.15], scale: [1, 1, 0.45] }));
      part(H.head, sphereGeo(0.024, 10, 8), L.glow, { pos: [sd * 0.052, 0.025, 0.125], edges: false });
    });
    part(H.head, coneGeo(0.03, 0.12, 8), L.main, { pos: [0, -0.02, 0.18], rot: [PI / 2 + 0.3, 0, 0] });
    part(H.head, boxGeo(0.09, 0.012, 0.01), L.glow, { pos: [0, -0.075, 0.12] });
    part(M, latheGeo([[0.12, 0.66], [0.15, 0.55], [0.13, 0.42]].reverse(), 18), L.dim, { double: true, scale: [1, 1, 0.8] });
    return {
      crown: { parent: H.head, pos: [0, 0.16, 0], s: 1.35 },
      anim: function (t) {
        M.position.y = Math.abs(Math.sin(t * 3)) * 0.015;
        up.rotation.x = 0.38 + Math.sin(t * 3) * 0.04;
        H.head.rotation.y = Math.sin(t * 0.8) * 0.3;
        ears[0].rotation.x = Math.sin(t * 7) * 0.08;
        ears[1].rotation.x = Math.sin(t * 7 + 1) * 0.08;
        dag.rotation.x = 1.25 + Math.sin(t * 2.4) * 0.08;
      }
    };
  };

  /* ---- Bestie: vierbeiniger Wolf ---- */
  ARCH.bestie = function (M, L) {
    var body = new THREE.Group();
    M.add(body);
    part(body, sphereGeo(1, 22, 16), L.main, { pos: [0, 0.66, -0.04], scale: [0.18, 0.19, 0.4] });
    var chest = part(body, sphereGeo(1, 22, 16), L.main, { pos: [0, 0.7, 0.24], scale: [0.2, 0.24, 0.22] });
    part(body, sphereGeo(1, 20, 14), L.main, { pos: [0, 0.66, -0.3], scale: [0.165, 0.18, 0.2] });
    for (var i = 0; i < 7; i++) {
      var tt = i / 6;
      part(body, coneGeo(0.045, 0.16 - tt * 0.06, 6), L.dim, { pos: [0, 0.9 - tt * 0.08, 0.34 - tt * 0.5], rot: [-0.9 - tt * 0.3, 0, 0] });
    }
    chain(body, [V(0, 0.76, 0.3), V(0, 0.9, 0.48)], [[0.13, 0.11, 0.09]], L.main);
    var head = new THREE.Group();
    head.position.set(0, 0.93, 0.5);
    body.add(head);
    part(head, sphereGeo(1, 20, 14), L.main, { scale: [0.115, 0.105, 0.13] });
    part(head, limbGeo(0.2, [0.07, 0.058, 0.04], 14), L.main, { pos: [0, -0.02, 0.04], rot: [PI / 2 - 0.12, 0, 0] });
    part(head, limbGeo(0.17, [0.045, 0.035, 0.022], 12), L.dim, { pos: [0, -0.07, 0.03], rot: [PI / 2 + 0.28, 0, 0] });
    part(head, sphereGeo(0.022, 10, 8), L.glow, { pos: [0, 0.005, 0.265], edges: false });
    var ears = [];
    [1, -1].forEach(function (sd) {
      ears.push(part(head, coneGeo(0.042, 0.13, 6), L.main, { pos: [sd * 0.065, 0.11, -0.02], rot: [-0.2, 0, -sd * 0.25] }));
      part(head, sphereGeo(0.019, 10, 8), L.glow, { pos: [sd * 0.052, 0.035, 0.1], edges: false });
      part(head, coneGeo(0.01, 0.04, 5), L.metal, { pos: [sd * 0.028, -0.07, 0.2], rot: [PI, 0, 0], edges: false });
    });
    // Beine (3 Glieder) + Pfoten
    [1, -1].forEach(function (sd) {
      chain(body, [V(sd * 0.12, 0.64, 0.28), V(sd * 0.13, 0.36, 0.32), V(sd * 0.12, 0.1, 0.33), V(sd * 0.12, 0.035, 0.37)],
        [[0.07, 0.075, 0.05], [0.045, 0.04, 0.035], [0.033, 0.03]], L.main);
      chain(body, [V(sd * 0.12, 0.66, -0.34), V(sd * 0.135, 0.4, -0.2), V(sd * 0.12, 0.17, -0.38), V(sd * 0.12, 0.035, -0.33)],
        [[0.085, 0.08, 0.055], [0.05, 0.042], [0.034, 0.03]], L.main);
      part(body, sphereGeo(1, 12, 8), L.dim, { pos: [sd * 0.12, 0.025, 0.4], scale: [0.042, 0.028, 0.06] });
      part(body, sphereGeo(1, 12, 8), L.dim, { pos: [sd * 0.12, 0.025, -0.3], scale: [0.042, 0.028, 0.06] });
    });
    var tail = chain(body, [V(0, 0.72, -0.46), V(0, 0.68, -0.66), V(0, 0.55, -0.8), V(0, 0.42, -0.86)],
      [[0.045, 0.06], [0.06, 0.065, 0.05], [0.05, 0.02]], L.dim);
    return {
      crown: { parent: head, pos: [0, 0.14, -0.02], s: 1.2 },
      yaw: -0.95,
      anim: function (t) {
        var b = Math.sin(t * 2.2);
        chest.scale.set(0.2 * (1 + b * 0.02), 0.24 * (1 + b * 0.025), 0.22);
        head.rotation.x = Math.sin(t * 0.9) * 0.08;
        head.rotation.y = Math.sin(t * 0.55) * 0.25;
        wiggle(tail[0], AX_Y, Math.sin(t * 5.5) * 0.3);
        ears[0].rotation.x = -0.2 + Math.max(0, Math.sin(t * 1.7)) * 0.2;
        ears[1].rotation.x = -0.2 + Math.max(0, Math.sin(t * 1.7 + 2)) * 0.2;
      }
    };
  };

  /* ---- Spinne: 8 Beine, viele Augen, Giftzaehne ---- */
  ARCH.spinne = function (M, L) {
    var body = new THREE.Group();
    M.add(body);
    var ceph = part(body, sphereGeo(1, 22, 16), L.main, { pos: [0, 0.42, 0.16], scale: [0.2, 0.13, 0.22] });
    part(body, sphereGeo(0.06, 12, 8), L.main, { pos: [0, 0.44, -0.08] });
    var abd = part(body, sphereGeo(1, 24, 18), L.main, { pos: [0, 0.56, -0.38], scale: [0.3, 0.26, 0.38], rot: [-0.3, 0, 0] });
    // Muster auf dem Hinterleib (Kinder der Kugel -> liegen auf ihrer Oberflaeche)
    [0.15, 0.5, 0.85].forEach(function (a, i) {
      part(abd, sphereGeo(1, 10, 8), L.glow, { pos: [0, Math.cos(a), -Math.sin(a) * 0.98], scale: [0.2 - i * 0.04, 0.05, 0.1], rot: [-a, 0, 0], edges: false });
    });
    // Augen vorne am Kopf
    [[0.16, 0.62, 0.77, 0.1], [0.34, 0.5, 0.79, 0.08], [0.1, 0.35, 0.93, 0.07], [0.3, 0.3, 0.9, 0.06]].forEach(function (e) {
      [1, -1].forEach(function (sd) {
        part(ceph, sphereGeo(1, 8, 6), L.glow, { pos: [sd * e[0], e[1], e[2]], scale: [e[3], e[3] * 1.4, e[3]], edges: false });
      });
    });
    [1, -1].forEach(function (sd) {
      part(body, coneGeo(0.022, 0.1, 6), L.metal, { pos: [sd * 0.05, 0.34, 0.36], rot: [PI - 0.4, 0, sd * 0.1] });
    });
    // Beine: 4 je Seite, 3 Glieder
    var legs = [];
    var zs = [0.27, 0.19, 0.11, 0.03], dz = [0.85, 0.35, -0.25, -0.8];
    [1, -1].forEach(function (sd) {
      for (var i = 0; i < 4; i++) {
        var o = V(sd * 0.14, 0.42, zs[i]);
        var dir = V(sd, 0, dz[i]).normalize();
        var p1 = o.clone().add(dir.clone().multiplyScalar(0.22)).add(V(0, 0.36, 0));
        var p2 = o.clone().add(dir.clone().multiplyScalar(0.47)).add(V(0, 0.24, 0));
        var p3 = o.clone().add(dir.clone().multiplyScalar(0.66));
        p3.y = 0.01;
        legs.push(chain(body, [o, p1, p2, p3], [[0.034, 0.038, 0.03], [0.028, 0.022], [0.02, 0.006]], L.main, { joint: 0.03 }));
      }
    });
    return {
      crown: { parent: body, pos: [0, 0.575, 0.17], s: 1.6 },
      anim: function (t) {
        body.position.y = Math.sin(t * 2) * 0.008;
        abd.scale.set(0.3 * (1 + Math.sin(t * 1.6) * 0.025), 0.26 * (1 + Math.sin(t * 1.6) * 0.03), 0.38);
        for (var j = 0; j < legs.length; j++) {
          var tw = Math.sin(t * 2.6 + j * 1.7) * 0.035 + (Math.sin(t * 9 + j) > 0.97 ? 0.08 : 0);
          wiggle(legs[j][0], AX_Y, tw);
          wiggle(legs[j][1], AX_X, Math.sin(t * 3.1 + j) * 0.03);
        }
      }
    };
  };

  /* ---- Geist: schwebender Kapuzen-Umhang mit zerfetztem Saum, keine Beine ---- */
  ARCH.geist = function (M, L) {
    var G = new THREE.Group();
    G.position.y = 0.3;
    M.add(G);
    // Umhang: oben offen (Kopf steckt in der Kapuze), unten weit und zerfetzt
    var prof = [[0.46, 0.0], [0.41, 0.2], [0.33, 0.48], [0.27, 0.78], [0.235, 1.0], [0.25, 1.2], [0.27, 1.32], [0.22, 1.42], [0.12, 1.48]];
    var seg = 30, robeGeo = latheGeo(prof, seg);
    var pa = robeGeo.attributes.position;
    for (var i = 0; i <= seg; i++) {
      var k = i % seg, jag = (k % 2 ? -0.03 : -0.2) - hash1(k) * 0.12;
      for (var j = 0; j < 3; j++) {
        var idx = i * prof.length + j;
        pa.setY(idx, pa.getY(idx) + jag * [1, 0.5, 0.2][j]);
      }
    }
    robeGeo.computeVertexNormals();
    var robe = part(G, robeGeo, L.main, { double: true });
    // spitze Kapuze, vorne offen; dahinter eine unsichtbare Maske -> dunkles Gesicht
    var gap = 1.7;
    var hood = new THREE.Group();
    hood.position.set(0, 1.43, 0.0);
    hood.rotation.x = 0.22;
    G.add(hood);
    part(hood, latheGeo([[0.21, -0.1], [0.215, 0.02], [0.2, 0.13], [0.16, 0.24], [0.09, 0.33], [0.0, 0.42]], 26, gap / 2, TAU - gap), L.dim, { double: true });
    occOnly(hood, sphereGeo(0.16, 14, 10), L.dim, { pos: [0, 0.1, 0.0] });
    [1, -1].forEach(function (sd) {
      part(hood, sphereGeo(1, 10, 8), L.glow, { pos: [sd * 0.055, 0.1, 0.165], scale: [0.03, 0.013, 0.012], rot: [0, 0, sd * 0.35], edges: false });
    });
    // lange Arme mit weiten Aermeln und Leucht-Krallen
    var arms = [];
    [1, -1].forEach(function (sd) {
      var ch = chain(G, [V(sd * 0.24, 1.3, 0.02), V(sd * 0.42, 1.1, 0.24), V(sd * 0.3, 1.0, 0.52)], [[0.07, 0.085], [0.07, 0.09, 0.105]], L.dim);
      for (var c = 0; c < 4; c++) {
        var cc = -1 + c * 2 / 3;
        part(ch.end, coneGeo(0.011, 0.17, 5), L.glow, { pos: [cc * 0.035, 0.08, 0], rot: [0.25, 0, cc * 0.35], edges: false });
      }
      arms.push(ch);
    });
    return {
      crown: { parent: hood, pos: [0, 0.36, 0], s: 1.2 },
      hover: true,
      anim: function (t) {
        G.position.y = 0.3 + Math.sin(t * 1.2) * 0.06;
        G.rotation.z = Math.sin(t * 0.8) * 0.04;
        robe.rotation.y = Math.sin(t * 0.7) * 0.12;
        wiggle(arms[0][0], AX_X, Math.sin(t * 1.4) * 0.12);
        wiggle(arms[1][0], AX_X, Math.sin(t * 1.4 + 1.5) * 0.12);
      },
      emit: function (dt, fx) {
        // Nebelfetzen fallen vom Saum
        if (Math.random() < dt * 14) {
          var a = Math.random() * TAU;
          fx.spark(G, V(Math.cos(a) * 0.4, rnd(-0.1, 0.1), Math.sin(a) * 0.4), V(rnd(-0.05, 0.05), rnd(-0.25, -0.1), rnd(-0.05, 0.05)), rnd(0.8, 1.4), 0.05, 'main');
        }
      }
    };
  };

  /* ---- Golem: kantiger Steinkoerper, leuchtender Kern, kreisende Steine ---- */
  ARCH.golem = function (M, L) {
    var up = makeUpper(M, 0.95, 0.12);
    part(up, dodecaGeo(0.36), L.main, { pos: [0, 0.3, 0], scale: [1.15, 1.0, 0.8], rot: [0.1, 0.3, 0.05] });
    part(M, dodecaGeo(0.25), L.dim, { pos: [0, 0.8, 0], scale: [1.15, 0.7, 0.85] });
    var head = new THREE.Group();
    head.position.set(0, 0.74, 0.12);
    up.add(head);
    part(head, icoGeo(0.13, 0), L.main, { scale: [1.1, 0.85, 1] });
    [1, -1].forEach(function (sd) { part(head, boxGeo(0.045, 0.016, 0.012), L.glow, { pos: [sd * 0.045, 0.01, 0.105], edges: false }); });
    var core = part(up, octaGeo(0.085), L.glow, { pos: [0, 0.32, 0.27] });
    part(up, boxGeo(0.16, 0.014, 0.012), L.glow, { pos: [0, 0.12, 0.262], rot: [0, 0, 0.2], edges: false });
    part(up, boxGeo(0.014, 0.14, 0.012), L.glow, { pos: [0.13, 0.3, 0.24], rot: [0, 0.4, 0], edges: false });
    part(up, boxGeo(0.014, 0.12, 0.012), L.glow, { pos: [-0.14, 0.28, 0.23], rot: [0, -0.4, 0.2], edges: false });
    var armsG = [];
    [1, -1].forEach(function (sd) {
      part(up, icoGeo(0.19, 0), L.main, { pos: [sd * 0.46, 0.5, 0] });
      var ag = new THREE.Group();
      ag.position.set(sd * 0.46, 0.5, 0);
      up.add(ag);
      part(ag, dodecaGeo(0.14), L.dim, { pos: [sd * 0.07, -0.26, 0.02], scale: [0.9, 1.5, 0.9] });
      part(ag, dodecaGeo(0.16), L.main, { pos: [sd * 0.12, -0.56, 0.08], scale: [1, 1.4, 1] });
      part(ag, icoGeo(0.16, 0), L.main, { pos: [sd * 0.13, -0.84, 0.1] });
      armsG.push(ag);
      part(M, dodecaGeo(0.16), L.dim, { pos: [sd * 0.21, 0.52, 0], scale: [1, 1.3, 1] });
      part(M, icoGeo(0.17, 0), L.main, { pos: [sd * 0.23, 0.14, 0.05], scale: [1.15, 0.8, 1.35] });
    });
    var orbit = new THREE.Group();
    M.add(orbit);
    [[0.75, 0.7, 0.06], [0.7, 1.35, 0.05], [0.8, 1.05, 0.07], [0.72, 1.6, 0.045]].forEach(function (o, i) {
      var a = i / 4 * TAU;
      part(orbit, icoGeo(o[2], 0), L.dim, { pos: [Math.cos(a) * o[0], o[1], Math.sin(a) * o[0]] });
    });
    return {
      crown: { parent: head, pos: [0, 0.14, 0], s: 1.4 },
      anim: function (t) {
        breathe(up, t, 0.01, 1.0);
        orbit.rotation.y = t * 0.5;
        core.scale.setScalar(1 + Math.sin(t * 3) * 0.12);
        core.rotation.y = t * 0.8;
        armsG[0].rotation.x = Math.sin(t * 0.9) * 0.05;
        armsG[1].rotation.x = Math.sin(t * 0.9 + 1) * 0.05;
      }
    };
  };

  /* ---- Troll: riesig, gebueckt, lange Arme, Keule ---- */
  ARCH.troll = function (M, L) {
    var up = makeUpper(M, 0.98, 0.42);
    part(M, sphereGeo(1, 22, 16), L.main, { pos: [0, 1.0, 0.1], scale: [0.37, 0.34, 0.33] });
    part(up, sphereGeo(1, 24, 18), L.main, { pos: [0, 0.42, 0], scale: [0.45, 0.4, 0.36] });
    part(up, sphereGeo(1, 20, 14), L.main, { pos: [0, 0.6, -0.16], scale: [0.32, 0.24, 0.26] });
    var head = new THREE.Group();
    head.position.set(0, 0.66, 0.3);
    head.rotation.x = -0.35;
    up.add(head);
    part(head, sphereGeo(1, 20, 14), L.main, { scale: [0.17, 0.155, 0.17] });
    part(head, boxGeo(0.27, 0.12, 0.19), L.main, { pos: [0, -0.1, 0.07] });
    part(head, boxGeo(0.26, 0.04, 0.07), L.dim, { pos: [0, 0.07, 0.13] });
    part(head, sphereGeo(0.045, 10, 8), L.main, { pos: [0, 0.0, 0.19] });
    [1, -1].forEach(function (sd) {
      part(head, coneGeo(0.03, 0.13, 6), L.metal, { pos: [sd * 0.085, 0.0, 0.16], rot: [-0.25, 0, sd * 0.2] });
      part(head, sphereGeo(0.022, 8, 6), L.glow, { pos: [sd * 0.06, 0.035, 0.16], edges: false });
      part(head, coneGeo(0.035, 0.12, 6), L.main, { pos: [sd * 0.19, 0.03, 0], rot: [0, 0, -sd * 1.3] });
    });
    // Arme bis fast zum Boden + Keule rechts
    var handR = V(0.56, 0.42, 0.3), arms = [];
    [1, -1].forEach(function (sd) {
      var shW = W(up, V(sd * 0.42, 0.5, 0.02));
      var hd = sd > 0 ? handR : V(-0.58, 0.4, 0.22);
      var el = ik2(shW, hd, 0.52, 0.52, V(sd, -0.2, -0.6));
      var ch = chain(up, [shW, el, hd], [[0.12, 0.13, 0.1, 0.09], [0.095, 0.11, 0.12, 0.1]], L.main);
      part(ch.end, sphereGeo(0.13, 14, 10), L.main, { pos: [0, 0.06, 0] });
      arms.push(ch);
    });
    // Keule: vom Griff in der rechten Faust schraeg nach vorne unten
    var club = new THREE.Group();
    club.position.copy(handR).add(V(0, 0.02, 0.04));
    club.quaternion.setFromUnitVectors(UPV, V(0.2, -0.42, 0.88).normalize());
    M.add(club);
    part(club, latheGeo([[0, -0.12], [0.04, -0.1], [0.045, 0.25], [0.09, 0.5], [0.15, 0.74], [0.13, 0.9], [0, 0.95]], 18), L.dim, {});
    for (var i = 0; i < 8; i++) {
      var a = i / 8 * TAU, yy = 0.62 + (i % 2) * 0.16, rr = i % 2 ? 0.14 : 0.13;
      var sp = part(club, coneGeo(0.025, 0.1, 5), L.metal, { pos: [Math.cos(a) * rr, yy, Math.sin(a) * rr] });
      sp.quaternion.setFromUnitVectors(UPV, V(Math.cos(a), 0.25, Math.sin(a)).normalize());
    }
    [1, -1].forEach(function (sd) {
      chain(M, [V(sd * 0.2, 0.84, 0), V(sd * 0.26, 0.46, 0.1), V(sd * 0.25, 0.1, 0)], [[0.14, 0.15, 0.12], [0.11, 0.12, 0.09]], L.main);
      part(M, sphereGeo(1, 14, 10), L.dim, { pos: [sd * 0.25, 0.05, 0.06], scale: [0.1, 0.06, 0.16] });
    });
    part(M, latheGeo([[0.32, 0.62], [0.34, 0.76], [0.33, 0.9]], 22), L.dim, { double: true, scale: [1, 1, 0.85] });
    return {
      crown: { parent: head, pos: [0, 0.15, 0], s: 1.35 },
      anim: function (t) {
        breathe(up, t, 0.02, 1.4);
        head.rotation.y = Math.sin(t * 0.5) * 0.25;
        wiggle(arms[1][0], AX_X, Math.sin(t * 1.1) * 0.05);
      }
    };
  };

  /* ---- Drache: Koerper, langer Hals, Hoerner, Fluegel (schlagen), Schwanz ---- */
  ARCH.drache = function (M, L) {
    part(M, sphereGeo(1, 24, 18), L.main, { pos: [0, 0.88, -0.05], scale: [0.36, 0.34, 0.62], rot: [-0.12, 0, 0] });
    part(M, sphereGeo(1, 22, 16), L.main, { pos: [0, 0.99, 0.35], scale: [0.33, 0.36, 0.32] });
    part(M, sphereGeo(1, 20, 14), L.dim, { pos: [0, 0.75, 0.12], scale: [0.26, 0.16, 0.5] });
    for (var i = 0; i < 6; i++) {
      var f = i / 5;
      part(M, coneGeo(0.045, 0.14 - f * 0.05, 5), L.dim, { pos: [0, 1.3 - f * 0.08, 0.3 - f * 0.8], rot: [-0.5, 0, 0] });
    }
    // Hals + Kopf
    var neckG = new THREE.Group();
    neckG.position.set(0, 1.1, 0.45);
    M.add(neckG);
    chain(neckG, [V(0, 1.08, 0.48), V(0, 1.34, 0.66), V(0, 1.54, 0.74), V(0, 1.66, 0.9)], [[0.21, 0.17], [0.17, 0.14], [0.14, 0.12]], L.main);
    var head = new THREE.Group();
    neckG.updateWorldMatrix(true, false);
    head.position.copy(neckG.worldToLocal(V(0, 1.72, 0.98)));
    neckG.add(head);
    part(head, sphereGeo(1, 20, 14), L.main, { scale: [0.16, 0.135, 0.18] });
    part(head, boxGeo(0.18, 0.1, 0.3), L.main, { pos: [0, -0.04, 0.21] });
    part(head, boxGeo(0.16, 0.045, 0.26), L.dim, { pos: [0, -0.13, 0.19], rot: [0.2, 0, 0] });
    part(head, boxGeo(0.12, 0.035, 0.18), L.glow, { pos: [0, -0.095, 0.2], edges: false });
    [1, -1].forEach(function (sd) {
      part(head, sphereGeo(0.024, 8, 6), L.glow, { pos: [sd * 0.09, 0.045, 0.1], edges: false });
      part(head, sphereGeo(0.014, 6, 5), L.glow, { pos: [sd * 0.04, 0.0, 0.36], edges: false });
      chain(head, [W(head, V(sd * 0.08, 0.1, -0.04)), W(head, V(sd * 0.12, 0.22, -0.2)), W(head, V(sd * 0.14, 0.25, -0.38))], [[0.036, 0.025], [0.025, 0.005]], L.metal);
    });
    // Schwanz
    var tail = chain(M, [V(0, 0.92, -0.62), V(0, 0.8, -0.95), V(0.08, 0.62, -1.22), V(0.22, 0.42, -1.4), V(0.4, 0.3, -1.46), V(0.58, 0.25, -1.4)],
      [[0.2, 0.16], [0.16, 0.12], [0.12, 0.08], [0.08, 0.05], [0.05, 0.02]], L.main);
    part(tail.end, octaGeo(0.08), L.dim, { pos: [0, 0.04, 0], scale: [1, 1.2, 0.3] });
    // Beine + Krallen
    [1, -1].forEach(function (sd) {
      [[V(sd * 0.25, 0.84, 0.35), V(sd * 0.32, 0.47, 0.5), V(sd * 0.29, 0.08, 0.52)],
        [V(sd * 0.27, 0.84, -0.3), V(sd * 0.37, 0.52, -0.08), V(sd * 0.34, 0.24, -0.34), V(sd * 0.31, 0.06, -0.26)]].forEach(function (pts) {
        chain(M, pts, [[0.16, 0.15, 0.11], [0.105, 0.09], [0.075, 0.06]], L.main);
        var e = pts[pts.length - 1];
        for (var c = -1; c <= 1; c++) part(M, coneGeo(0.018, 0.08, 5), L.metal, { pos: [e.x + c * 0.04, 0.03, e.z + 0.07], rot: [PI / 2, 0, 0], edges: false });
      });
    });
    // Fluegel: Knochen + Flughaut
    var wings = [];
    [1, -1].forEach(function (sd) {
      var wg = new THREE.Group();
      wg.position.set(sd * 0.2, 1.28, 0.15);
      M.add(wg);
      var O = V(0, 0, 0), E = V(sd * 0.45, 0.5, -0.1), Wr = V(sd * 0.8, 0.95, -0.3);
      var F = [V(sd * 1.22, 1.1, -0.45), V(sd * 1.3, 0.55, -0.6), V(sd * 1.1, 0.1, -0.65), V(sd * 0.7, -0.15, -0.55)];
      var Bp = V(sd * 0.1, -0.3, -0.5);
      wg.updateWorldMatrix(true, false);
      var toW = function (p) { return wg.localToWorld(p.clone()); };
      chain(wg, [toW(O), toW(E), toW(Wr)], [[0.05, 0.045], [0.04, 0.03]], L.main);
      F.forEach(function (fp) { chain(wg, [toW(Wr), toW(fp)], [[0.026, 0.008]], L.main, { edges: false }); });
      // Flughaut mit bogenfoermiger Hinterkante
      var tri = [], tips = F.concat([Bp]);
      function push3(a, b, c) { tri.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); }
      for (var k = 0; k < tips.length - 1; k++) {
        var hub = k < F.length - 1 ? Wr : E;
        var mid = tips[k].clone().lerp(tips[k + 1], 0.5).lerp(hub, 0.2);
        push3(hub, tips[k], mid);
        push3(hub, mid, tips[k + 1]);
      }
      push3(Wr, F[F.length - 1], E);
      push3(O, E, Bp);
      var mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
      var uvs = [];
      for (var q = 0; q < tri.length; q += 3) uvs.push(tri[q] * 3.2, tri[q + 1] * 3.2);
      mg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      mg.computeVertexNormals();
      part(wg, mg, L.wing, { double: true, edges: false });
      wings.push({ g: wg, sd: sd });
    });
    return {
      crown: { parent: head, pos: [0, 0.14, 0.0], s: 1.5 },
      yaw: -0.35,
      anim: function (t) {
        var fl = Math.sin(t * 1.6);
        wings.forEach(function (w) { w.g.rotation.z = w.sd * (fl * 0.28 + 0.05); w.g.rotation.y = -w.sd * fl * 0.08; });
        neckG.rotation.x = Math.sin(t * 0.9) * 0.05;
        head.rotation.y = Math.sin(t * 0.6) * 0.2;
        wiggle(tail[0], AX_Y, Math.sin(t * 1.2) * 0.12);
        wiggle(tail[2], AX_Y, Math.sin(t * 1.2 - 1) * 0.12);
      }
    };
  };

  /* ---- Drohne: vier Rotoren, Sensor-Auge, Scan-Kegel ---- */
  ARCH.drohne = function (M, L, stage) {
    var D = new THREE.Group();
    D.position.y = 1.0;
    M.add(D);
    part(D, sphereGeo(1, 22, 14), L.metal, { scale: [0.2, 0.1, 0.24] });
    part(D, partSphere(0.12, 18, 8, 0, TAU, 0, PI / 2), L.main, { pos: [0, 0.05, -0.02], double: true });
    var rotors = [];
    for (var k = 0; k < 4; k++) {
      var a = PI / 4 + k * PI / 2, cx = Math.cos(a), cz = Math.sin(a);
      part(D, boxGeo(0.42, 0.035, 0.05), L.dim, { pos: [cx * 0.3, 0.01, cz * 0.3], rot: [0, -a, 0] });
      part(D, cylGeo(0.035, 0.035, 0.06, 12), L.metal, { pos: [cx * 0.5, 0.03, cz * 0.5] });
      part(D, torusGeo(0.16, 0.01, 5, 36), L.main, { pos: [cx * 0.5, 0.04, cz * 0.5], rot: [PI / 2, 0, 0], edges: false });
      var rg = new THREE.Group();
      rg.position.set(cx * 0.5, 0.07, cz * 0.5);
      D.add(rg);
      part(rg, boxGeo(0.3, 0.005, 0.035), L.glow, { edges: false });
      part(rg, boxGeo(0.035, 0.005, 0.3), L.glow, { edges: false });
      rotors.push(rg);
    }
    var eye = new THREE.Group();
    eye.position.set(0, -0.02, 0.2);
    D.add(eye);
    part(eye, torusGeo(0.07, 0.012, 6, 24), L.metal, { pos: [0, 0, 0.025] });
    part(eye, sphereGeo(0.048, 16, 12), L.glow, { pos: [0, 0, 0.02] });
    part(D, cylGeo(0.015, 0.015, 0.22, 8), L.metal, { pos: [0, -0.1, 0.12], rot: [PI / 2, 0, 0] });
    part(D, boxGeo(0.07, 0.05, 0.12), L.dim, { pos: [0, -0.09, 0.0] });
    part(D, cylGeo(0.006, 0.006, 0.16, 6), L.metal, { pos: [0.07, 0.14, -0.1], edges: false });
    part(D, sphereGeo(0.014, 8, 6), L.glow, { pos: [0.07, 0.23, -0.1], edges: false });
    [1, -1].forEach(function (sd) {
      part(D, boxGeo(0.02, 0.02, 0.36), L.dim, { pos: [sd * 0.13, -0.16, 0] });
      part(D, cylGeo(0.008, 0.008, 0.07, 6), L.dim, { pos: [sd * 0.13, -0.12, 0.1], edges: false });
      part(D, cylGeo(0.008, 0.008, 0.07, 6), L.dim, { pos: [sd * 0.13, -0.12, -0.1], edges: false });
    });
    // Scan-Kegel vom Auge zum Boden
    var beam = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.86, 32, 1, true), flatMat(stage, 4, L.glow.base, 1, 0.8));
    beam.position.set(0, -0.45, 0.2);
    D.add(beam);
    return {
      crown: { parent: D, pos: [0, 0.2, -0.02], s: 1.2 },
      hover: true,
      anim: function (t) {
        D.position.y = 1.0 + Math.sin(t * 1.7) * 0.04;
        D.rotation.z = Math.sin(t * 1.1) * 0.05;
        D.rotation.x = Math.sin(t * 0.9) * 0.04;
        for (var r = 0; r < rotors.length; r++) rotors[r].rotation.y = t * (r % 2 ? 23 : -23);
        eye.rotation.y = Math.sin(t * 0.8) * 0.4;
        beam.rotation.z = Math.sin(t * 0.8) * 0.15;
      }
    };
  };

  /* ---- Magier: Robe, Spitzhut, Bart, Stab mit leuchtender Kugel ---- */
  ARCH.magier = function (M, L) {
    var robe = part(M, latheGeo([[0, 0.02], [0.37, 0.02], [0.36, 0.12], [0.32, 0.4], [0.27, 0.7], [0.22, 1.0], [0.2, 1.2], [0.2, 1.38], [0.16, 1.5], [0.06, 1.56], [0, 1.57]], 28), L.main, { scale: [1, 1, 0.85] });
    part(M, torusGeo(0.215, 0.022, 6, 30), L.dim, { pos: [0, 1.02, 0], rot: [PI / 2, 0, 0], scale: [1, 0.85, 1] });
    part(M, boxGeo(0.05, 0.05, 0.02), L.glow, { pos: [0, 1.02, 0.19] });
    part(M, latheGeo([[0.3, 1.2], [0.24, 1.38], [0.16, 1.5]], 24), L.dim, { double: true, scale: [1, 1, 0.85] });
    var head = new THREE.Group();
    head.position.set(0, 1.66, 0.02);
    M.add(head);
    part(head, sphereGeo(0.1, 20, 14), L.main, { scale: [0.95, 1.08, 1] });
    part(head, coneGeo(0.085, 0.32, 10), L.dim, { pos: [0, -0.2, 0.06], rot: [PI - 0.15, 0, 0] });
    [1, -1].forEach(function (sd) { part(head, sphereGeo(0.013, 8, 6), L.glow, { pos: [sd * 0.035, 0.01, 0.092], edges: false }); });
    var hat = new THREE.Group();
    hat.position.set(0, 0.08, 0);
    head.add(hat);
    part(hat, cylGeo(0.24, 0.24, 0.015, 30), L.dim, {});
    part(hat, coneGeo(0.13, 0.36, 18), L.main, { pos: [0, 0.18, -0.01] });
    part(hat, torusGeo(0.122, 0.012, 6, 26), L.glow, { pos: [0, 0.03, 0], rot: [PI / 2, 0, 0], edges: false });
    var tip = part(hat, coneGeo(0.05, 0.16, 10), L.main, { pos: [0, 0.39, -0.05], rot: [-0.6, 0, 0] });
    part(hat, octaGeo(0.025), L.glow, { pos: [0, 0.12, 0.11] });
    // Arme mit weiten Aermeln
    var staffHand = V(-0.34, 1.12, 0.14), spellHand = V(0.34, 1.35, 0.22);
    [1, -1].forEach(function (sd) {
      var sh = V(sd * 0.2, 1.44, 0), hd = sd > 0 ? spellHand : staffHand;
      var el = ik2(sh, hd, 0.3, 0.28, V(sd, -0.6, -0.4));
      var ch = chain(M, [sh, el, hd], [[0.06, 0.07, 0.07], [0.07, 0.09, 0.11]], L.main);
      part(ch.end, sphereGeo(0.035, 10, 8), L.main, { pos: [0, 0.04, 0] });
    });
    // Stab + Kugel
    chain(M, [V(-0.35, 0.02, 0.15), V(-0.37, 1.9, 0.14)], [[0.02, 0.018, 0.022]], L.metal);
    for (var c = 0; c < 3; c++) {
      var a = c / 3 * TAU;
      part(M, coneGeo(0.012, 0.12, 5), L.metal, { pos: [-0.37 + Math.cos(a) * 0.05, 1.96, 0.14 + Math.sin(a) * 0.05], rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5] });
    }
    var orb = part(M, icoGeo(0.075, 1), L.glow, { pos: [-0.37, 2.0, 0.14] });
    var spell = part(M, octaGeo(0.045), L.glow, { pos: [0.36, 1.46, 0.26] });
    return {
      crown: { parent: head, pos: [0, 0.12, 0], s: 1.25 },
      anim: function (t) {
        robe.scale.set(1 + Math.sin(t * 1.5) * 0.008, 1, 0.85);
        orb.position.y = 2.0 + Math.sin(t * 1.8) * 0.02;
        orb.rotation.y = t * 0.9;
        spell.rotation.set(t * 1.3, t * 1.7, 0);
        spell.scale.setScalar(1 + Math.sin(t * 4) * 0.2);
        tip.rotation.x = -0.6 + Math.sin(t * 1.3) * 0.08;
        head.rotation.y = Math.sin(t * 0.5) * 0.18;
      },
      emit: function (dt, fx) {
        if (Math.random() < dt * 18) {
          var a = Math.random() * TAU;
          fx.spark(orb, V(Math.cos(a) * 0.1, rnd(-0.05, 0.05), Math.sin(a) * 0.1), V(rnd(-0.1, 0.1), rnd(0.1, 0.3), rnd(-0.1, 0.1)), rnd(0.6, 1.1), 0.04, 'glow');
        }
        if (Math.random() < dt * 8) fx.spark(spell, V(0, 0, 0), V(rnd(-0.15, 0.15), rnd(0.05, 0.3), rnd(-0.15, 0.15)), rnd(0.4, 0.8), 0.035, 'glow');
      }
    };
  };

  /* ================= Gegner-Hologramm ================= */
  var BASE_YAW = -0.3;   // Gegner leicht schraeg (Waffen zeigen dann zur Seite, gut sichtbar)
  var SWAY = 0.42;       // langsames Hin- und Herschwenken (rad)
  var AURA_R = 1.18;     // Aura-Ring ab Tier 4: Radius x Boden-Radius (Ring reicht bis AURA_R * 1.2)

  function enemyLooks(hex) {
    var c = glowColor(hex, 0.55), white = new THREE.Color(1, 1, 1);
    return {
      main: { color: c, fill: 0.15, rim: 1.0, wire: 0.07, lineA: 0.45 },
      dim: { color: c.clone().multiplyScalar(0.72), fill: 0.11, rim: 0.8, wire: 0.05, lineA: 0.38 },
      metal: { color: c.clone().lerp(new THREE.Color(COL.steel), 0.5), fill: 0.13, rim: 0.9, wire: 0.03, lineA: 0.6 },
      glow: { color: c.clone().lerp(white, 0.55), fill: 0.95, rim: 0.5, wire: 0, lineA: 0.9 },
      gold: { color: new THREE.Color(COL.gold), fill: 0.35, rim: 1.2, wire: 0, lineA: 0.8 },
      coat: { color: c.clone().lerp(white, 0.45), fill: 0.1, rim: 0.85, wire: 0.05, lineA: 0.4 },
      wing: { color: c.clone(), fill: 0.07, rim: 0.55, wire: 0.12, lineA: 0.3 }
    };
  }

  function glEnemy(container, opts) {
    var RM = reducedMotion();
    var st = createStage(container, { interactive: opts.interactive !== false, spinSpeed: 0, springBack: true, elev: 0.1 });
    var S = {
      hp: clamp(num(opts.hpPct, 1), 0, 1), flash: 0, flashCol: null, shake: 0, shakeAmp: 0, glitch: 0, dip: 0, dipDepth: 0,
      defeated: false, dT: 0, k: 1, ph: 0, emberAcc: 0, fb: null
    };
    S.hpShow = S.hp;
    var looks = {}, info = {}, model = null, plat = null, auras = [], flats = [], samples = [], ptc = null;
    var tier = 1, R = 0.5, H = 2, RED = null, GREY = null, EMBER = null, tmpC = null;

    function setColor(hex) {
      var p = enemyLooks(hex);
      Object.keys(p).forEach(function (n) {
        var L = looks[n], x = p[n];
        L.base.copy(x.color);
        L.u.uColor.value.copy(x.color);
        L.u.uFill.value = x.fill; L.u.uRim.value = x.rim; L.u.uWire.value = x.wire; L.u.uLineA.value = x.lineA;
      });
      auras.forEach(function (m) { m.material.uniforms.uColor.value.copy(looks.main.base); });
      flats.forEach(function (m) { m.uniforms.uColor.value.copy(looks.glow.base); });
    }

    function clearModel() {
      if (model) { st.root.remove(model); disposeTree(model, true); model = null; }
      if (plat) { st.scene.remove(plat); disposeTree(plat); plat = null; }
      auras.forEach(function (m) { st.scene.remove(m); disposeTree(m); });
      auras = [];
      flats = [];
    }

    function build() {
      clearModel();
      var arch = ARCHETYPES.indexOf(opts.archetype) >= 0 ? opts.archetype : 'soldat';
      tier = clamp(Math.round(num(opts.tier, 1)), 1, 5);
      st.root.rotation.set(0, 0, 0);
      st.root.position.set(0, 0, 0);
      model = new THREE.Group();
      st.root.add(model);
      info = ARCH[arch](model, looks, st) || {};
      if (tier >= 5 && info.crown && info.crown.parent) addCrown(info.crown.parent, info.crown.pos, info.crown.s, looks.gold, looks.glow);
      var ts = 0.92 + 0.045 * tier;
      model.scale.setScalar(ts);
      if (info.anim) info.anim(0, 0, 1);
      var m = measure(model);
      R = clamp(Math.max(m.footR * 1.1, 0.36), 0.36, 1.15);
      H = Math.max(0.5, m.maxY);
      // flache Wesen (Spinne) von schraeg oben zeigen
      var el = H < 1.0 ? 0.42 : 0.12;
      // Kamera: ganze Bewegung (alle Posen, Schwenk +-SWAY) und Boden-Ring bzw. Aura-Ring (Tier 4-5) passen ins Bild.
      // Rand je Tier: Tier 5 fuellt die Buehne fast ganz, Tier 1 wirkt kleiner.
      var by = BASE_YAW + (info.yaw || 0), yaws = [];
      for (var a = -3; a <= 3; a++) yaws.push(by + a / 3 * SWAY);
      var ringR = tier >= 4 ? R * AURA_R * 1.2 : R * 1.06;
      st.setFit({ pts: framePoints(model, info.anim, yaws, ringR), cy: (m.maxY + Math.min(0, m.minY)) / 2,
        elev: el, pad: 1.03 + 0.035 * (5 - tier) });
      if (info.anim) info.anim(0, 0, 1);
      plat = makePlatform(st, R, COL.cyan, H);
      st.scene.add(plat);
      if (tier >= 4) {
        var uR = R * AURA_R;
        var ring = new THREE.Mesh(new THREE.RingGeometry(uR * 0.78, uR * 1.2, 96, 1).rotateX(-PI / 2), flatMat(st, 3, looks.main.base, uR, 1));
        ring.position.y = 0.006;
        st.scene.add(ring);
        auras.push(ring);
      }
      if (tier >= 5) {
        var ph = H * 0.75;
        var pillar = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.05, R * 1.15, ph, 48, 1, true).translate(0, ph / 2, 0), flatMat(st, 2, looks.main.base, R, 0.9));
        st.scene.add(pillar);
        auras.push(pillar);
      }
      model.traverse(function (o) {
        if (o.material && o.material.uniforms && o.material.uniforms.uKind) {
          o.material.userData.a0 = o.material.uniforms.uAlpha.value;
          flats.push(o.material);
        }
      });
      samples = samplePoints(model, 260);
      st.kick();
    }

    function revive() {
      S.defeated = false; S.dT = 0; S.k = 1;
      st.common.uDissolve.value = 0;
      setColor(opts.color);
    }

    /* Partikel-Wolke von der Oberflaeche */
    function burst(n, speed, big) {
      st.root.updateMatrixWorld(true);
      var cen = V(0, H * 0.5, 0);
      var colA = new THREE.Color(1, 1, 1), colB = RED, colC = looks.main.u.uColor.value;
      for (var i = 0; i < n; i++) {
        var p = samples[Math.floor(Math.random() * samples.length)];
        var w = st.root.localToWorld(p.clone());
        var d = p.clone().sub(cen);
        d.y *= 0.4;
        d.normalize().multiplyScalar(rnd(0.3, 1) * speed).add(V(0, rnd(0.1, big ? 0.9 : 0.5), 0));
        var c = i % 3 === 0 ? colA : (i % 3 === 1 ? colB : colC);
        ptc.spawn(w, d, rnd(0.35, 0.8) * (big ? 2.2 : 1), rnd(0.045, 0.085) * (big ? 1.1 : 1), c, { grav: big ? 0.15 : -1.2, drag: big ? 1.1 : 1.8 });
      }
    }
    var fx = {
      spark: function (obj, lp, vel, life, size, lookName) {
        obj.updateWorldMatrix(true, false);
        var L = looks[lookName] || looks.glow;
        ptc.spawn(obj.localToWorld(lp.clone()), vel, life, size, L.u.uColor.value, { drag: 0.6, alpha: 0.9 });
      }
    };

    try {
      RED = new THREE.Color(COL.red); GREY = new THREE.Color(COL.grey); EMBER = new THREE.Color('#ffb347'); tmpC = new THREE.Color();
      S.flashCol = new THREE.Color(1, 1, 1);
      ptc = makeParticles(st, 320);
      ['main', 'dim', 'metal', 'glow', 'gold', 'coat', 'wing'].forEach(function (n) {
        looks[n] = makeLook(st, n, { color: COL.cyan, fill: 0.1, rim: 0.8, wire: 0.05, lineA: 0.4 });
      });
      setColor(opts.color);
      build();
    } catch (e) { st.destroy(); throw e; }

    st.onFrame = function (dt, t) {
      var c = st.common;
      c.uTime.value = t;
      S.hpShow += (S.hp - S.hpShow) * Math.min(1, dt * 5);
      var dmg = S.defeated ? 0 : 1 - S.hpShow;
      // Flackern + Stoerung: je weniger HP, desto mehr
      if (!RM && !S.defeated && S.dip <= 0 && Math.random() < dt * (0.25 + dmg * 6)) {
        S.dip = rnd(0.04, 0.12);
        S.dipDepth = rnd(0.18, 0.3 + dmg * 0.45);
      }
      var fl = 0.975 + 0.025 * Math.sin(t * 47.0);
      if (S.dip > 0) { S.dip -= dt; fl *= 1 - S.dipDepth; }
      c.uFlick.value = fl;
      S.glitch = Math.max(0, S.glitch - dt * 2.2);
      c.uGlitch.value = RM ? 0 : Math.max(S.glitch, (S.dip > 0 && dmg > 0.35) ? dmg * 0.8 : 0);
      S.flash *= Math.exp(-dt * 6);
      if (S.defeated) {
        S.dT += dt;
        c.uDissolve.value = Math.min(1, S.dT / 1.4);
        S.k = Math.max(0, 1 - S.dT / 1.2);
      }
      var kk = 1 - Math.exp(-dt * 3);
      Object.keys(looks).forEach(function (n) {
        var L = looks[n], u = L.u, bright = n === 'glow' || n === 'gold';
        if (S.defeated) {
          u.uColor.value.lerp(GREY, kk * 0.7);
          if (S.dT > 0.9) {
            u.uWire.value += ((bright ? 0 : 0.3) - u.uWire.value) * kk;
            u.uLineA.value += ((bright ? 0.05 : 0.14) - u.uLineA.value) * kk;
          }
        } else {
          tmpC.copy(L.base);
          if (!bright) tmpC.lerp(RED, dmg * 0.6);
          u.uColor.value.copy(tmpC);
        }
        u.uFlash.value = S.flash;
        u.uFlashCol.value.copy(S.flashCol);
      });
      // Wackeln nach Treffer
      if (S.shake > 0) {
        S.shake = Math.max(0, S.shake - dt);
        var s = S.shakeAmp * (S.shake / 0.35);
        st.root.position.set(rnd(-s, s), rnd(-s, s) * 0.4, rnd(-s, s) * 0.4);
      } else st.root.position.set(0, 0, 0);
      S.ph += dt * S.k;
      st.root.rotation.y = BASE_YAW + (info.yaw || 0) + Math.sin(S.ph * 0.35) * SWAY + st.yawUser;
      if (info.anim) info.anim(S.ph, dt * S.k, S.k);
      var fade = S.defeated ? Math.max(0, 1 - S.dT) : 1;
      auras.forEach(function (m) { m.material.uniforms.uAlpha.value = (m.userData.a0 || (m.userData.a0 = m.material.uniforms.uAlpha.value)) * fade; });
      flats.forEach(function (m) { m.uniforms.uAlpha.value = m.userData.a0 * fade; });
      if (!S.defeated) {
        if (tier >= 5) {
          S.emberAcc += dt * 16;
          while (S.emberAcc >= 1) {
            S.emberAcc -= 1;
            var a = rnd(0, TAU), r = R * rnd(0.2, 0.95);
            tmpC.copy(EMBER).lerp(looks.main.base, Math.random() * 0.5);
            ptc.spawn(V(Math.cos(a) * r, rnd(0, H * 0.25), Math.sin(a) * r), V(rnd(-0.05, 0.05), rnd(0.25, 0.55), rnd(-0.05, 0.05)),
              rnd(1.4, 2.6), rnd(0.03, 0.05), tmpC, { drag: 0.3, alpha: 0.9 });
          }
        }
        if (info.emit) info.emit(dt, fx);
      }
      ptc.update(dt);
    };

    function showFallback(on) {
      if (on && !S.fb) {
        container.classList.add('holo--lost');
        S.fb = fallbackEnemy(container, extend({}, opts, { hpPct: S.hp }), true);
        if (S.defeated) S.fb.defeat();
      }
      if (!on && S.fb) { container.classList.remove('holo--lost'); S.fb.destroy(); S.fb = null; }
    }
    st.onLost = function () { showFallback(true); };
    st.onFail = function () { showFallback(true); };
    st.onRestore = function () { showFallback(false); };
    var handle;
    st.onOrphan = function () { handle.destroy(); };
    st.kick();

    handle = {
      fallback: false,
      el: container,
      update: function (p) {
        if (st.destroyed || !p) return;
        var newTier = p.tier != null ? clamp(Math.round(num(p.tier, 1)), 1, 5) : tier;
        var rebuild = (p.archetype && p.archetype !== opts.archetype) || newTier !== tier;
        var recolor = p.color && p.color !== opts.color;
        extend(opts, p);
        if (p.hpPct != null) S.hp = clamp(num(p.hpPct, S.hp), 0, 1);
        if (rebuild) {
          try { build(); } catch (e) { console.error('[holo]', e); }
          if (S.defeated) revive();
        }
        if (recolor) setColor(opts.color);
        if (S.fb) S.fb.update(p);
        st.kick();
      },
      hit: function (strength) {
        if (st.destroyed || S.defeated) return;
        var s = clamp(num(strength, 0.5), 0, 1);
        S.flash = 0.55 + 0.45 * s;
        S.flashCol.setRGB(1, 1, 1).lerp(RED, 0.45);
        S.shake = 0.35;
        S.shakeAmp = 0.02 + 0.06 * s;
        S.glitch = Math.max(S.glitch, 0.3 + 0.7 * s);
        if (!RM || s > 0.5) burst(Math.round(14 + 60 * s), 1.0 + s, false);
        if (S.fb) S.fb.hit(s);
        st.kick();
      },
      defeat: function () {
        if (st.destroyed || S.defeated) return;
        S.defeated = true;
        S.dT = 0;
        S.flash = 1;
        S.flashCol.setRGB(1, 1, 1);
        S.glitch = 1;
        burst(170, 1.4, true);
        if (S.fb) S.fb.defeat();
        st.kick();
      },
      destroy: function () {
        showFallback(false);
        st.destroy();
      }
    };
    return handle;
  }

  /* ================= 2D-Ersatz (SVG) ohne WebGL ================= */
  function mixHex(a, b, t) {
    function p(h) {
      h = h.replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    var x = p(a), y = p(b), o = '#';
    for (var i = 0; i < 3; i++) {
      var v = Math.round(x[i] + (y[i] - x[i]) * t);
      o += (v < 16 ? '0' : '') + v.toString(16);
    }
    return o;
  }
  function attrs(o) {
    var s = '';
    for (var k in o) s += ' ' + k + '="' + o[k] + '"';
    return s;
  }
  /* Koerper als 2D-Figur, Vorder- und Rueckansicht (je 200 x 416 Einheiten).
     Eintrag: [Teil, Element, Attribute, spiegeln]. Reihenfolge = Zeichen-Reihenfolge (spaeter liegt oben). */
  var FB_ARM = { cx: 53, cy: 129, rx: 11, ry: 27, transform: 'rotate(8 53 129)' };
  var FB_COMMON_TOP = [
    ['neutral', 'path', { d: 'M66 78 L134 78 C141 100 133 140 124 172 L76 172 C67 140 59 100 66 78 Z' }, 0],
    ['neutral', 'path', { d: 'M76 170 L124 170 L129 204 L112 214 L100 207 L88 214 L71 204 Z' }, 0],
    ['neutral', 'rect', { x: 92, y: 52, width: 16, height: 16, rx: 5 }, 0],
    ['neutral', 'ellipse', { cx: 100, cy: 35, rx: 17, ry: 21 }, 0]
  ];
  var FB_LIMBS = [
    ['neutral', 'ellipse', { cx: 46, cy: 186, rx: 9, ry: 28, transform: 'rotate(5 46 186)' }, 1],
    ['neutral', 'ellipse', { cx: 43, cy: 224, rx: 7, ry: 10 }, 1],
    ['beine', 'ellipse', { cx: 86, cy: 254, rx: 14, ry: 42, transform: 'rotate(-3 86 254)' }, 1],
    ['beine', 'ellipse', { cx: 86, cy: 332, rx: 11, ry: 36, transform: 'rotate(-1 86 332)' }, 1],
    ['neutral', 'ellipse', { cx: 86, cy: 376, rx: 12, ry: 6 }, 1]
  ];
  var FB_FRONT = [
    // Ruecken von vorne: Latissimus schaut seitlich hinter dem Rumpf hervor, Trapez zwischen Hals und Schultern
    ['ruecken', 'path', { d: 'M67 84 C57 102 56 128 68 155 L76 150 C68 128 67 104 71 88 Z' }, 1],
    ['ruecken', 'path', { d: 'M87 63 Q100 59 113 63 L137 80 L63 80 Z' }, 0]
  ].concat(FB_COMMON_TOP, [
    ['brust', 'path', { d: 'M70 86 Q85 80 98 86 L98 112 Q84 118 72 110 Q66 98 70 86 Z' }, 1],
    ['bauch', 'rect', { x: 85, y: 121, width: 13, height: 15, rx: 4 }, 1],
    ['bauch', 'rect', { x: 85, y: 139, width: 13, height: 15, rx: 4 }, 1],
    ['bauch', 'rect', { x: 85, y: 157, width: 13, height: 14, rx: 4 }, 1],
    // Oberarm: Grundform, Trizeps als Rand aussen, Bizeps vorne
    ['neutral', 'ellipse', FB_ARM, 1],
    ['trizeps', 'path', { d: 'M50 104 C41 112 38 132 43 153 C46.5 146 47.6 136 47.3 126 C47 117 48.2 110 50 104 Z' }, 1],
    ['bizeps', 'ellipse', { cx: 55.6, cy: 133, rx: 6.9, ry: 20, transform: 'rotate(8 55.6 133)' }, 1],
    ['schultern', 'path', { d: 'M46 84 C50 76 62 75 70 81 C73 91 68 103 60 110 C53 110 45 102 44 94 C44 90 45 87 46 84 Z' }, 1]
  ], FB_LIMBS);
  var FB_BACK = FB_COMMON_TOP.concat([
    // Ruecken: Latissimus (Fluegel), unterer Ruecken, Trapez (Drachen vom Nacken bis zur Brustwirbelsaeule)
    ['ruecken', 'path', { d: 'M66 92 C61 118 69 146 86 166 L98.5 158 L98.5 128 C92 110 80 99 66 92 Z' }, 1],
    ['ruecken', 'rect', { x: 89, y: 142, width: 9, height: 30, rx: 4.5 }, 1],
    ['ruecken', 'path', { d: 'M100 58 C106 58 110 62 113 66 L137 80 C124 86 113 94 107 108 L100 142 L93 108 C87 94 76 86 63 80 L87 66 C90 62 94 58 100 58 Z' }, 0],
    // Po (gehoert zu den Beinen)
    ['beine', 'path', { d: 'M99 174 C99.5 190 99.5 203 96.5 210 C88 218 76 216 72 204 C68 192 71 180 78 173 C85 169 93 170 99 174 Z' }, 1],
    // Oberarm hinten: Trizeps mit zwei Koepfen (Hufeisen)
    ['neutral', 'ellipse', FB_ARM, 1],
    ['trizeps', 'ellipse', { cx: 48.8, cy: 122, rx: 5.9, ry: 18, transform: 'rotate(8 48.8 122)' }, 1],
    ['trizeps', 'ellipse', { cx: 57, cy: 124, rx: 5.7, ry: 20, transform: 'rotate(8 57 124)' }, 1],
    ['schultern', 'path', { d: 'M46 84 C50 76 62 75 70 81 C73 91 68 103 60 110 C53 110 45 102 44 94 C44 90 45 87 46 84 Z' }, 1]
  ], FB_LIMBS);
  var FB_TOP = 12, FB_BOTTOM = 384, FB_W = 200, FB_H = 416, FB_GAP = 20;
  var fbUid = 0;

  function fbFigure(list, cls, dx, label, extra) {
    var out = ['<g class="hfb-fig ' + cls + '"' + (dx ? ' transform="translate(' + dx + ' 0)"' : '') + '>',
      '<ellipse class="hfb-base" cx="100" cy="386" rx="74" ry="9"/><ellipse class="hfb-base hfb-base--in" cx="100" cy="386" rx="56" ry="6"/>'];
    list.forEach(function (s) {
      var el = '<' + s[1] + attrs(s[2]) + '/>';
      out.push('<g class="hfb-g" data-g="' + s[0] + '">' + el + (s[3] ? '<g transform="matrix(-1 0 0 1 200 0)">' + el + '</g>' : '') + '</g>');
    });
    out.push(extra || '', '<text class="hfb-label" x="100" y="410" text-anchor="middle">' + label + '</text></g>');
    return out.join('');
  }

  /* Ersatz-Koerper. Breiter Platz: Vorder- und Rueckansicht nebeneinander (alle 7 Teile sichtbar).
     Schmaler Platz: eine Ansicht (im Fokus die Seite mit den Ziel-Muskeln). Kalorien: immer von vorne. */
  function fallbackBody(container, opts, overlay) {
    var id = 'hfb' + (++fbUid);
    var wrap = document.createElement('div');
    wrap.className = 'holo-fb holo-fb--body' + (overlay ? ' holo-fb--overlay' : '');
    wrap.innerHTML = ['<svg class="holo-fb__svg" viewBox="0 0 ' + FB_W + ' ' + FB_H + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">',
      '<defs><linearGradient id="' + id + '-k" gradientUnits="userSpaceOnUse" x1="0" y1="' + FB_TOP + '" x2="0" y2="' + FB_BOTTOM + '">',
      '<stop offset="0"/><stop offset="0.5"/><stop offset="0.5"/><stop offset="1"/></linearGradient></defs>',
      fbFigure(FB_FRONT, 'hfb-fig--front', 0, 'VORNE', '<line class="hfb-level" x1="28" x2="172" y1="200" y2="200"/>'),
      fbFigure(FB_BACK, 'hfb-fig--back', FB_W + FB_GAP, 'HINTEN'),
      '</svg>'].join('');
    if (!overlay) container.classList.add('holo', 'holo--fallback');
    container.appendChild(wrap);
    var svg = wrap.querySelector('svg');
    var figFront = wrap.querySelector('.hfb-fig--front'), figBack = wrap.querySelector('.hfb-fig--back');
    var gs = Array.prototype.slice.call(wrap.querySelectorAll('.hfb-g'));
    var stops = wrap.querySelectorAll('stop'), level = wrap.querySelector('.hfb-level');
    var alive = true, shown = '', hintBack = null, hintT = 0;

    /* Eine oder zwei Ansichten, je nach Platz */
    function layout() {
      if (!alive) return;
      var mode = opts.mode, w = container.clientWidth, h = container.clientHeight, two = false, back = false;
      if (mode !== 'kcal') {
        if (w > 0 && h > 0) {
          var one = Math.min(h, w * FB_H / FB_W), both = Math.min(h, w * FB_H / (2 * FB_W + FB_GAP));
          two = both >= one * 0.66;
        }
        if (!two && hintBack != null) back = hintBack;   // nach pulse(): kurz die Seite mit dem Muskel
        else if (!two) {
          var fparts = mode === 'focus' ? resolveParts(opts.focus) : [];
          var v = viewYaw(opts.view);
          back = Math.cos(fparts.length ? faceFor(fparts) : (v != null ? v : 0)) < -0.2;
        }
      }
      var key = two ? 'two' : (back ? 'back' : 'front');
      if (key === shown) return;
      shown = key;
      svg.setAttribute('viewBox', two ? '0 0 ' + (2 * FB_W + FB_GAP) + ' ' + FB_H
        : (back ? (FB_W + FB_GAP) + ' 0 ' : '0 0 ') + FB_W + ' ' + FB_H);
      figFront.style.display = back && !two ? 'none' : '';
      figBack.style.display = two || back ? '' : 'none';
      wrap.classList.toggle('is-two', two);
    }

    function apply() {
      if (!alive) return;
      var mode = opts.mode, cols = partColors(opts.colors);
      var ranks = mode !== 'focus' && mode !== 'kcal';
      var fill = clamp(num(opts.fill, 1), 0, 1);
      var healthy = mode === 'kcal' && fill <= 0.001;
      var fparts = mode === 'focus' ? resolveParts(opts.focus) : [];
      var hasFocus = fparts.length > 0;
      var fc = isHex(opts.focusColor) ? opts.focusColor.trim() : COL.cyanHi;
      gs.forEach(function (g) {
        var gid = g.getAttribute('data-g'), c = COL.cyan, on = fparts.indexOf(gid) >= 0;
        if (ranks) c = gid === 'neutral' ? COL.neutral : (cols[gid] || COL.cyan);
        else if (hasFocus) c = on ? fc : COL.cyanDim;
        else if (healthy) c = COL.healthy;
        g.style.setProperty('--c', c);
        g.classList.toggle('is-focus', hasFocus && on);
        g.classList.toggle('is-dim', hasFocus && !on);
        g.classList.toggle('is-neutral', gid === 'neutral' && mode !== 'kcal');
        g.style.fill = (mode === 'kcal' && !healthy) ? 'url(#' + id + '-k)' : '';
      });
      var kcal = mode === 'kcal' && !healthy;
      wrap.classList.toggle('is-kcal', kcal);
      wrap.classList.toggle('is-ranks', ranks);
      wrap.classList.toggle('is-healthy', healthy);
      var y = FB_BOTTOM - fill * (FB_BOTTOM - FB_TOP), off = (y - FB_TOP) / (FB_BOTTOM - FB_TOP);
      var sc = [['#43d9e8', 0.07, 0], ['#43d9e8', 0.07, off], [COL.liqTop, 0.8, off], [COL.liqLow, 0.8, 1]];
      for (var i = 0; i < stops.length; i++) {
        stops[i].setAttribute('offset', String(sc[i][2]));
        stops[i].setAttribute('stop-color', sc[i][0]);
        stops[i].setAttribute('stop-opacity', String(sc[i][1]));
      }
      level.setAttribute('y1', y.toFixed(1));
      level.setAttribute('y2', y.toFixed(1));
      level.style.display = kcal && fill > 0.003 && fill < 0.997 ? '' : 'none';
      layout();
    }
    apply();

    // Groesse aendert sich (Drehen des Handys, anderes Layout): Ansicht neu waehlen
    var ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(layout); ro.observe(container); }
    else window.addEventListener('resize', layout);

    return {
      fallback: true,
      el: container,
      update: function (p) {
        if (!p) return;
        var colors = p.colors ? extend({}, opts.colors, p.colors) : opts.colors;
        extend(opts, p);
        opts.colors = colors;
        apply();
      },
      pulse: function (gid) {
        if (!alive) return;
        var all = gid == null || gid === '', list = all ? [] : resolveParts(gid);
        if (list.length && opts.mode !== 'kcal') {
          hintBack = Math.cos(faceFor(list)) < -0.2;
          clearTimeout(hintT);
          hintT = setTimeout(function () { hintBack = null; layout(); }, 6000);
          layout();
        }
        gs.forEach(function (g) {
          if (!all && list.indexOf(g.getAttribute('data-g')) < 0) return;
          g.classList.remove('is-pulse');
          void g.getBoundingClientRect();
          g.classList.add('is-pulse');
        });
      },
      destroy: function () {
        if (!alive) return;
        alive = false;
        clearTimeout(hintT);
        if (ro) ro.disconnect();
        window.removeEventListener('resize', layout);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        if (!overlay) container.classList.remove('holo', 'holo--fallback');
      }
    };
  }

  var FB_ICON = {
    soldat: 'gun', scharfschuetze: 'target', schwer: 'shield', forscher: 'flask', skelett: 'skull', goblin: 'sword',
    bestie: 'wolf', spinne: 'spider', geist: 'ghost', golem: 'mountain', troll: 'troll', drache: 'dragon', drohne: 'drone', magier: 'bolt'
  };
  function fallbackEnemy(container, opts, overlay) {
    var wrap = document.createElement('div');
    wrap.className = 'holo-fb holo-fb--enemy' + (overlay ? ' holo-fb--overlay' : '');
    wrap.innerHTML = '<svg class="holo-fb__base" viewBox="0 0 200 40" preserveAspectRatio="xMidYMax meet" aria-hidden="true">' +
      '<ellipse cx="100" cy="22" rx="84" ry="14"/><ellipse cx="100" cy="22" rx="62" ry="9"/></svg>' +
      '<div class="holo-fb__icon"></div><div class="holo-fb__tier"></div>';
    if (!overlay) container.classList.add('holo', 'holo--fallback');
    container.appendChild(wrap);
    var iconEl = wrap.querySelector('.holo-fb__icon'), tierEl = wrap.querySelector('.holo-fb__tier');
    var alive = true, hitT = 0;
    function apply() {
      if (!alive) return;
      var name = FB_ICON[opts.archetype] || 'skull';
      iconEl.innerHTML = (OP.ui && OP.ui.icon) ? OP.ui.icon(name) :
        '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/></svg>';
      var tier = clamp(Math.round(num(opts.tier, 1)), 1, 5), pips = '';
      for (var i = 0; i < 5; i++) pips += '<span class="' + (i < tier ? 'is-on' : '') + '"></span>';
      tierEl.innerHTML = pips;
      var hp = clamp(num(opts.hpPct, 1), 0, 1), base = hexOr(opts.color, COL.cyan);
      wrap.style.setProperty('--c', mixHex(base, COL.red, (1 - hp) * 0.6));
      wrap.classList.toggle('is-low', hp < 0.3);
      wrap.classList.toggle('is-t4', tier >= 4);
      wrap.classList.toggle('is-t5', tier >= 5);
    }
    apply();
    return {
      fallback: true,
      el: container,
      update: function (p) { if (p) { extend(opts, p); apply(); } },
      hit: function () {
        if (!alive || wrap.classList.contains('is-down')) return;
        wrap.classList.remove('is-hit');
        void wrap.offsetWidth;
        wrap.classList.add('is-hit');
        clearTimeout(hitT);
        hitT = setTimeout(function () { wrap.classList.remove('is-hit'); }, 450);
      },
      defeat: function () { if (alive) wrap.classList.add('is-down'); },
      destroy: function () {
        if (!alive) return;
        alive = false;
        clearTimeout(hitT);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        if (!overlay) container.classList.remove('holo', 'holo--fallback');
      }
    };
  }

  /* ================= Oeffentliche API ================= */
  function noop() {}
  var DEAD = { fallback: true, update: noop, pulse: noop, hit: noop, defeat: noop, destroy: noop };

  function body(container, opts) {
    if (!container || !container.appendChild) return DEAD;
    opts = extend({ mode: 'ranks', colors: {}, focus: null, fill: 1, autoRotate: true, interactive: true }, opts || {});
    opts.colors = extend({}, opts.colors);
    if (supported()) {
      try { return glBody(container, opts); } catch (e) { console.warn('[holo] 3D geht nicht, zeige 2D', e); }
    }
    return fallbackBody(container, opts, false);
  }
  function enemy(container, opts) {
    if (!container || !container.appendChild) return DEAD;
    opts = extend({ archetype: 'soldat', color: COL.red, tier: 1, hpPct: 1, interactive: true }, opts || {});
    if (supported()) {
      try { return glEnemy(container, opts); } catch (e) { console.warn('[holo] 3D geht nicht, zeige 2D', e); }
    }
    return fallbackEnemy(container, opts, false);
  }

  OP.holo = {
    supported: supported,
    body: body,
    enemy: enemy,
    /* die 7 Koerper-Teile (Profil-Reihenfolge) */
    GROUPS: PARTS.slice(),
    /* Hilfe: 'push' -> ['brust', 'trizeps', 'schultern'], 'arme' -> ['bizeps', 'trizeps'], Listen gehen auch */
    partsOf: function (idOrGroup) { return resolveParts(idOrGroup); },
    ARCHETYPES: ARCHETYPES.slice(),
    /* Helfer fuer andere 3D-Teile: Kapsel ohne CapsuleGeometry */
    capsuleGeometry: function (r, len, seg) { return capsuleGeo(r, len, seg); },
    limbGeometry: function (len, radii, seg) { return limbGeo(len, radii, seg); }
  };
})();
