import { mediaUrl } from '../utils/media';
import { DEFAULT_CROP, DEFAULT_TRANSFORM, type ClipCrop, type ClipTransform, type ProClip, type ProDocument } from './proTypes';

// WebGL-компоновщик слоёв Viewer (§7 ТЗ, real-time preview) + пул видео.

// Пул скрытых <video> по исходникам — переиспользуем элементы между кадрами.
export class VideoPool {
  private map = new Map<string, HTMLVideoElement>();

  get(src: string): HTMLVideoElement {
    let v = this.map.get(src);
    if (!v) {
      v = document.createElement('video');
      v.src = mediaUrl(src);
      v.muted = true;
      v.preload = 'auto';
      v.playsInline = true;
      this.map.set(src, v);
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
void main(){ gl_FragColor = texture2D(uTex, vUv); }
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
  private posBuf: WebGLBuffer;
  private uvBuf: WebGLBuffer;
  private texCache = new WeakMap<HTMLVideoElement, WebGLTexture>();

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true })!;
    this.gl = gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;
    this.aPos = gl.getAttribLocation(prog, 'aPos');
    this.aUv = gl.getAttribLocation(prog, 'aUv');
    this.posBuf = gl.createBuffer()!;
    this.uvBuf = gl.createBuffer()!;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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

  // drawList — снизу вверх (нижние дорожки первыми).
  render(doc: ProDocument, drawList: { clip: ProClip; video: HTMLVideoElement }[]) {
    const gl = this.gl;
    if (gl.canvas.width !== doc.width || gl.canvas.height !== doc.height) {
      (gl.canvas as HTMLCanvasElement).width = doc.width;
      (gl.canvas as HTMLCanvasElement).height = doc.height;
    }
    gl.viewport(0, 0, doc.width, doc.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);

    for (const { clip, video } of drawList) {
      if (video.readyState < 2 || !video.videoWidth) continue;
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
