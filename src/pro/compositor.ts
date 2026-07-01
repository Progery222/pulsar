import { mediaUrl } from '../utils/media';
import { DEFAULT_CROP, DEFAULT_TRANSFORM, type ClipCrop, type ClipTransform, type ProClip, type ProDocument } from './proTypes';

// WebGL-компоновщик слоёв Viewer (§7 ТЗ, real-time preview) + пул видео.

// Пул скрытых <video> по исходникам — переиспользуем элементы между кадрами.
export class VideoPool {
  private map = new Map<string, HTMLVideoElement>();

  // key разделяет элементы (напр. одновременный кадр одного источника при crossfade);
  // src — реальный путь для загрузки (по умолчанию = key).
  get(key: string, src?: string): HTMLVideoElement {
    let v = this.map.get(key);
    if (!v) {
      v = document.createElement('video');
      v.src = mediaUrl(src ?? key);
      v.muted = true;
      v.preload = 'auto';
      v.playsInline = true;
      this.map.set(key, v);
    }
    return v;
  }

  // Пауза для источников, не участвующих в текущем кадре.
  pauseExcept(active: Set<string>) {
    for (const [src, v] of this.map) if (!active.has(src) && !v.paused) v.pause();
  }

  dispose() {
    for (const v of this.map.values()) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    this.map.clear();
  }
}

// Углы кадра клипа в координатах проекта (px). useCrop=false — полный кадр (для Transform-рамки).
export function frameCorners(doc: ProDocument, clip: ProClip, useCrop: boolean): { pos: number[][]; uv: number[][] } {
  const W = doc.width;
  const H = doc.height;
  const cr: ClipCrop = useCrop ? { ...DEFAULT_CROP, ...clip.crop } : DEFAULT_CROP;
  const rx0 = W * cr.left;
  const rx1 = W * (1 - cr.right);
  const ry0 = H * cr.top;
  const ry1 = H * (1 - cr.bottom);
  let corners = [
    [rx0, ry0],
    [rx1, ry0],
    [rx1, ry1],
    [rx0, ry1],
  ];
  const uv = [
    [cr.left, cr.top],
    [1 - cr.right, cr.top],
    [1 - cr.right, 1 - cr.bottom],
    [cr.left, 1 - cr.bottom],
  ];
  const t: ClipTransform = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const cx = W / 2;
  const cy = H / 2;
  const rad = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  corners = corners.map(([x, y]) => {
    const dx = (x - cx) * t.scale;
    const dy = (y - cy) * t.scale;
    return [cx + (dx * cos - dy * sin) + t.x, cy + (dx * sin + dy * cos) + t.y];
  });
  return { pos: corners, uv };
}

const VERT = `
attribute vec2 aPos;
attribute vec2 aUv;
varying vec2 vUv;
void main(){ vUv = aUv; gl_Position = vec4(aPos, 0.0, 1.0); }
`;
const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
void main(){ vec4 c = texture2D(uTex, vUv); gl_FragColor = vec4(c.rgb, c.a * uAlpha); }
`;

// Постобработка корр. слоя (§5 ТЗ): фильтр применяется к готовой композиции.
const FILTER_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform int uFilter;
uniform float uIntensity;
void main(){
  vec4 c = texture2D(uTex, vUv);
  vec3 col = c.rgb;
  vec3 o = col;
  if (uFilter == 1) { float g = dot(col, vec3(0.299,0.587,0.114)); o = vec3(g); }
  else if (uFilter == 2) { o = col * vec3(1.15,1.02,0.85); }
  else if (uFilter == 3) { o = col * vec3(0.85,1.0,1.2); }
  else if (uFilter == 4) { float g = dot(col, vec3(0.299,0.587,0.114)); o = g + (col - g) * 1.6; }
  else if (uFilter == 5) { o = (col - 0.5) * 1.35 + 0.5; }
  o = clamp(o, 0.0, 1.0);
  gl_FragColor = vec4(mix(col, o, uIntensity), c.a);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

export class Compositor {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private aPos: number;
  private aUv: number;
  private uAlpha: WebGLUniformLocation | null;
  private fprog: WebGLProgram;
  private faPos: number;
  private faUv: number;
  private fFilter: WebGLUniformLocation | null;
  private fIntensity: WebGLUniformLocation | null;
  private fTex: WebGLUniformLocation | null;
  private posBuf: WebGLBuffer;
  private uvBuf: WebGLBuffer;
  private texCache = new WeakMap<HTMLVideoElement, WebGLTexture>();
  private fbo: (WebGLFramebuffer | null)[] = [null, null];
  private fboTex: (WebGLTexture | null)[] = [null, null];
  private fboW = 0;
  private fboH = 0;

  constructor(canvas: HTMLCanvasElement, opts?: { preserveDrawingBuffer?: boolean }) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true, preserveDrawingBuffer: opts?.preserveDrawingBuffer })!;
    this.gl = gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    this.prog = prog;
    this.aPos = gl.getAttribLocation(prog, 'aPos');
    this.aUv = gl.getAttribLocation(prog, 'aUv');
    this.uAlpha = gl.getUniformLocation(prog, 'uAlpha');
    const fprog = gl.createProgram()!;
    gl.attachShader(fprog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(fprog, compile(gl, gl.FRAGMENT_SHADER, FILTER_FRAG));
    gl.linkProgram(fprog);
    this.fprog = fprog;
    this.faPos = gl.getAttribLocation(fprog, 'aPos');
    this.faUv = gl.getAttribLocation(fprog, 'aUv');
    this.fFilter = gl.getUniformLocation(fprog, 'uFilter');
    this.fIntensity = gl.getUniformLocation(fprog, 'uIntensity');
    this.fTex = gl.getUniformLocation(fprog, 'uTex');
    this.posBuf = gl.createBuffer()!;
    this.uvBuf = gl.createBuffer()!;
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private ensureFbo(W: number, H: number) {
    if (this.fboW === W && this.fboH === H && this.fbo[0]) return;
    const gl = this.gl;
    for (let i = 0; i < 2; i++) {
      if (this.fbo[i]) gl.deleteFramebuffer(this.fbo[i]);
      if (this.fboTex[i]) gl.deleteTexture(this.fboTex[i]);
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.fbo[i] = fb;
      this.fboTex[i] = tex;
    }
    this.fboW = W;
    this.fboH = H;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private drawFullscreen() {
    const gl = this.gl;
    const pos = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const uv = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.faPos);
    gl.vertexAttribPointer(this.faPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.faUv);
    gl.vertexAttribPointer(this.faUv, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private texture(video: HTMLVideoElement): WebGLTexture {
    const gl = this.gl;
    let tex = this.texCache.get(video);
    if (!tex) {
      tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.texCache.set(video, tex);
    }
    return tex;
  }

  // drawList — снизу вверх. adjustments — фильтры корр. слоёв (постобработка).
  render(
    doc: ProDocument,
    drawList: { clip: ProClip; video: HTMLVideoElement; alpha?: number }[],
    adjustments: { filter: number; intensity: number }[] = []
  ) {
    const gl = this.gl;
    const W = doc.width;
    const H = doc.height;
    if (gl.canvas.width !== W || gl.canvas.height !== H) {
      (gl.canvas as HTMLCanvasElement).width = W;
      (gl.canvas as HTMLCanvasElement).height = H;
    }
    if (!adjustments.length) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      this.drawClips(doc, drawList);
      return;
    }
    // Композиция → FBO, затем последовательные фильтр-пассы (пинг-понг), финал на экран.
    this.ensureFbo(W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[0]);
    gl.viewport(0, 0, W, H);
    this.drawClips(doc, drawList);
    gl.disable(gl.BLEND);
    gl.useProgram(this.fprog);
    let src = 0;
    for (let i = 0; i < adjustments.length; i++) {
      const last = i === adjustments.length - 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, last ? null : this.fbo[1 - src]);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex[src]);
      gl.uniform1i(this.fTex, 0);
      gl.uniform1i(this.fFilter, adjustments[i].filter);
      gl.uniform1f(this.fIntensity, adjustments[i].intensity);
      this.drawFullscreen();
      src = 1 - src;
    }
    gl.enable(gl.BLEND);
  }

  private drawClips(doc: ProDocument, drawList: { clip: ProClip; video: HTMLVideoElement; alpha?: number }[]) {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.useProgram(this.prog);
    for (const { clip, video, alpha } of drawList) {
      if (video.readyState < 2 || !video.videoWidth) continue;
      gl.uniform1f(this.uAlpha, alpha ?? 1);
      const tex = this.texture(video);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      } catch {
        continue; // кадр ещё не готов
      }
      const { pos, uv } = frameCorners(doc, clip, true);
      const W = doc.width;
      const H = doc.height;
      // NDC (origin top-left → flip Y). 2 треугольника: 0,1,2 и 0,2,3.
      const order = [0, 1, 2, 0, 2, 3];
      const posArr: number[] = [];
      const uvArr: number[] = [];
      for (const i of order) {
        posArr.push((pos[i][0] / W) * 2 - 1, 1 - (pos[i][1] / H) * 2);
        uvArr.push(uv[i][0], uv[i][1]);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(posArr), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvArr), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.aUv);
      gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  dispose() {
    const lose = this.gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
  }
}
