/**
 * Сфера Sky Music.
 *
 * Один прямоугольник и один фрагментный шейдер: сфера считается прямо в
 * пикселях (пересечение луча со сферой), поэтому ни геометрии, ни
 * библиотеки 3D не нужно. three.js в зависимостях лежит, но нигде не
 * используется — тянуть в бандл шестьсот килобайт ради одного объекта
 * было бы дорого, а собственный шейдер весит несколько килобайт и даёт
 * ровно тот вид, который нужен.
 *
 * Плеер сфера не трогает вовсе: она только читает уровни звука из
 * общего анализатора (см. audioLevels.ts) и рисует.
 */
import { useEffect, useRef } from 'react';
import { subscribeAudioLevels, resumeAudioLevels, type Levels } from './audioLevels';

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;

uniform vec2  uRes;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uBeat;
uniform vec3  uC1;
uniform vec3  uC2;
uniform float uDetail;   // 1.0 — полное качество, 0.0 — облегчённое
uniform float uOffset;   // сдвиг центра сферы по горизонтали

/* ── Шум ──────────────────────────────────────────────────────────
   Обычный value-noise: дёшево и на слабых телефонах, и на десктопе. */
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p *= 2.02;
    a *= 0.5;
    if (i == 1 && uDetail < 0.5) break;   // на слабых устройствах — два слоя
  }
  return s;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / min(uRes.x, uRes.y);
  // Сфера смещена вправо и вверх: внизу слева на карточке живёт текст,
  // а справа внизу — кнопка запуска, и по центру шар спорил бы с обоими.
  uv -= vec2(uOffset, 0.17);

  float t = uTime;

  /* Радиус: медленное дыхание плюс отклик на бас. Ограничиваем, чтобы
     сфера не выпрыгивала из карточки на громком месте. */
  float breathe = 0.012 * sin(t * 0.55);
  float R = 0.54 + breathe + uBass * 0.070 + uBeat * 0.028;

  float r = length(uv);
  vec3 col = vec3(0.0);

  /* ── Атмосфера вокруг: два слоя, ближний плотнее, дальний шире ── */
  float d = max(0.0, r - R);
  float haloNear = exp(-d * 7.0);
  float haloFar  = exp(-d * 2.2);
  float pulse = 0.22 + uMid * 0.30 + uBeat * 0.22;
  col += mix(uC2, uC1, 0.35) * haloNear * pulse;
  col += uC1 * haloFar * pulse * 0.35;

  if (r < R) {
    /* Поверхность сферы: нормаль из уравнения сферы. */
    float z = sqrt(max(0.0, R * R - r * r));
    vec3 n = normalize(vec3(uv, z));

    /* Жидкая поверхность: доменное искажение поля шума. Верх спектра
       добавляет мелкую рябь, бас — крупные складки. */
    vec3 q = n * (1.9 + uHigh * 1.1) + vec3(0.0, 0.0, t * 0.10);
    float warp = fbm(q + vec3(t * 0.06, -t * 0.05, 0.0));
    float surf = fbm(q * 1.6 + warp * 1.4);

    /* Волна от удара: кольцо, расходящееся от центра к краю. */
    float wave = uBeat * exp(-pow((r / R - fract(t * 0.55)) * 6.0, 2.0)) * 0.35;

    float bump = (surf - 0.5) * (0.42 + uHigh * 0.40) + wave;
    n = normalize(n + vec3(bump * 0.7, bump * 0.7, 0.0));

    /* Свет медленно ходит по поверхности. */
    vec3 lightDir = normalize(vec3(cos(t * 0.22) * 0.7, 0.55 + sin(t * 0.17) * 0.2, 0.85));
    float diff = clamp(dot(n, lightDir), 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(-lightDir, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 26.0);

    /* Френель — свечение по краю, из-за него объект читается объёмным. */
    float fres = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.6);

    /* Внутренний свет: тёплое ядро, дышит вместе с басом. */
    float core = exp(-pow(r / R, 2.0) * 2.6) * (0.30 + uBass * 0.45);

    vec3 base = mix(uC1, uC2, clamp(surf * 0.85 + n.y * 0.3 + 0.25, 0.0, 1.0));

    col += base * (0.26 + diff * 0.95);
    col += mix(base, uC1, 0.5) * core * 1.3;
    // Ободок по краю — то, из-за чего шар читается как источник света.
    col += mix(uC1, vec3(1.0), 0.42) * fres * (0.55 + uMid * 0.40 + uBeat * 0.25);
    col += vec3(1.0) * spec * 0.30;

    /* Мягкое затемнение к краю, чтобы шар не выглядел плоским. */
    col *= 0.72 + 0.28 * z / R;
  }

  /* Небольшая зернистость: убирает полосы на градиентах. */
  float grain = (hash(vec3(gl_FragCoord.xy, floor(t * 24.0))) - 0.5) * 0.012;
  col += grain;

  /* Мягкий контраст без пережога: делитель побольше единицы, иначе
     тёмная палитра съедается и шар выглядит серым. */
  col = col / (col + vec3(1.15));
  col = pow(col, vec3(0.86));
  gl_FragColor = vec4(col, 1.0);
}
`;

const compile = (gl: WebGLRenderingContext, type: number, src: string) => {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
};

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.42, 0.24, 0.91];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/**
 * Палитра обложек рисовалась как фон карточек и оттого очень тёмная
 * (#1a0533 и подобные). Источником света такой цвет быть не может:
 * шар получился бы серым. Поэтому берём у цвета только тон, а яркость и
 * насыщенность задаём сами — приглушённо, но так, чтобы сфера светилась.
 */
const toLight = (hex: string, lightness: number): [number, number, number] => {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  if (max !== min) {
    const dd = max - min;
    h = max === r ? ((g - b) / dd + (g < b ? 6 : 0))
      : max === g ? (b - r) / dd + 2
      : (r - g) / dd + 4;
    h /= 6;
  }
  // Насыщенность держим средней: премиально, без кислоты.
  const sat = 0.52;
  const li = lightness;
  const c = (1 - Math.abs(2 * li - 1)) * sat;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m2 = li - c / 2;
  const seg = Math.floor(h * 6) % 6;
  const rgb: [number, number, number] =
    seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x]
    : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x];
  // Совсем серый цвет (обложки без выраженного тона) уводим в фирменный синий.
  if (max - min < 0.04) return [0.36, 0.42, 0.86].map(v => v * (0.6 + li * 0.7)) as [number, number, number];
  return [rgb[0] + m2, rgb[1] + m2, rgb[2] + m2];
};

export interface SkySphereProps {
  /** Две краски палитры — обычно берутся из обложки текущего трека. */
  color1: string;
  color2: string;
  /** Играет ли музыка: на паузе сфера уходит в спокойное состояние. */
  active?: boolean;
  className?: string;
}

export const SkySphere = ({ color1, color2, active = false, className }: SkySphereProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Цвета и активность читаем из ref: менять их не должно означать
  // пересборку шейдера и новый цикл отрисовки.
  const colors = useRef({ c1: color1, c2: color2, active });
  colors.current = { c1: color1, c2: color2, active };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = (canvas.getContext('webgl', { alpha: false, antialias: false, depth: false,
      powerPreference: 'low-power', preserveDrawingBuffer: false }) as WebGLRenderingContext | null);
    if (!gl) {
      // Без WebGL просто оставляем фон карточки — она и так красивая.
      canvas.style.display = 'none';
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) { canvas.style.display = 'none'; return; }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.style.display = 'none'; return; }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = {
      res: gl.getUniformLocation(prog, 'uRes'),
      time: gl.getUniformLocation(prog, 'uTime'),
      bass: gl.getUniformLocation(prog, 'uBass'),
      mid: gl.getUniformLocation(prog, 'uMid'),
      high: gl.getUniformLocation(prog, 'uHigh'),
      beat: gl.getUniformLocation(prog, 'uBeat'),
      c1: gl.getUniformLocation(prog, 'uC1'),
      c2: gl.getUniformLocation(prog, 'uC2'),
      detail: gl.getUniformLocation(prog, 'uDetail'),
      offset: gl.getUniformLocation(prog, 'uOffset'),
    };

    /* Качество по устройству: на телефоне и на слабом железе рисуем в
       меньшем буфере и с двумя слоями шума вместо четырёх. */
    const cores = (navigator as any).hardwareConcurrency ?? 4;
    const weak = cores <= 4 || Math.min(window.innerWidth, window.innerHeight) < 500;
    const dprCap = weak ? 1.6 : 2.0;
    const scale = weak ? 0.85 : 1.0;
    gl.uniform1f(u.detail, weak ? 0.0 : 1.0);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap) * scale;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(u.res, canvas.width, canvas.height);
      // Чем шире карточка, тем сильнее сдвигаем шар вправо: на узком
      // экране он должен остаться в кадре целиком.
      const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      gl.uniform1f(u.offset, Math.min(0.62, Math.max(0.0, (aspect - 1.1) * 0.42)));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    /* Уровни звука. Держим последнее значение и гасим его на паузе. */
    let levels: Levels = { bass: 0, mid: 0, high: 0, level: 0, beat: 0, live: false };
    const unsubscribe = subscribeAudioLevels((l) => { levels = l; });

    let raf = 0;
    let visible = true;
    const start = performance.now();

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;

      const t = (performance.now() - start) / 1000;
      const on = colors.current.active;
      // На паузе уровни плавно сходят к нулю, а не обрываются.
      const k = on ? 1 : 0;
      gl.uniform1f(u.time, t);
      gl.uniform1f(u.bass, levels.bass * k);
      gl.uniform1f(u.mid, levels.mid * k);
      gl.uniform1f(u.high, levels.high * k);
      gl.uniform1f(u.beat, levels.beat * k);
      const [r1, g1, b1] = toLight(colors.current.c1, 0.60);
      const [r2, g2, b2] = toLight(colors.current.c2, 0.42);
      gl.uniform3f(u.c1, r1, g1, b1);
      gl.uniform3f(u.c2, r2, g2, b2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);

    /* Вне экрана не рисуем вовсе — это главный источник экономии. */
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.01 });
    io.observe(canvas);
    const onVis = () => { if (!document.hidden) resumeAudioLevels(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      // Освобождаем всё, что заняли, и отпускаем сам контекст: без
      // этого браузер держит их до сборки мусора, а число живых
      // WebGL-контекстов ограничено.
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return (
    <canvas ref={canvasRef} aria-hidden="true"
      className={className}
      style={{ display: 'block', width: '100%', height: '100%' }}/>
  );
};
