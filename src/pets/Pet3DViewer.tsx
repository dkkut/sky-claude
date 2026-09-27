/**
 * 3D-окно питомца.
 *
 * three.js — уже зависимость проекта, но нигде раньше не подключался
 * реальной сценой. Здесь — минимальная, но настоящая сцена: модель
 * скина (glTF/glb), если она есть у сервера, иначе — стилизованный
 * плейсхолдер того же вида питомца, чтобы экран никогда не был пустым
 * до того, как в каталоге появятся настоящие 3D-модели.
 *
 * Lazy loading: сам three и загрузчик глТФ приходят динамическим
 * import()'ом только когда этот экран реально открыт — ничего 3D не
 * тянется в общий бандл. Загруженная модель кэшируется в памяти по
 * ссылке, чтобы повторное открытие того же скина не перекачивало и не
 * перепарсивало файл заново.
 */
import { useEffect, useRef } from 'react';

const modelCache = new Map<string, Promise<unknown>>();

const PET_COLOR: Record<string, number> = {
  dragon: 0xef4444, cat: 0xf59e0b, robot: 0x64748b, phoenix: 0xf97316,
};

export const Pet3DViewer = ({ petType, modelUrl }: { petType: string; modelUrl?: string }) => {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let renderer: import('three').WebGLRenderer | null = null;
    let frame = 0;
    let cleanupDrag: (() => void) | null = null;

    void (async () => {
      const THREE = await import('three');
      const host = hostRef.current;
      if (!host || disposed) return;

      const scene = new THREE.Scene();
      const width = host.clientWidth || 320;
      const height = host.clientHeight || 320;

      const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
      camera.position.set(0, 0.6, 4.2);

      // Мобильные экраны — тот же принцип, что и везде в Sky: полное
      // качество не грузим туда, где для него нет ни толку, ни FPS.
      const isSmall = width < 420;
      renderer = new THREE.WebGLRenderer({ antialias: !isSmall, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, isSmall ? 1.5 : 2));
      renderer.setSize(width, height);
      host.appendChild(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const key = new THREE.DirectionalLight(0xffffff, 1.1);
      key.position.set(2, 3, 4);
      scene.add(key);
      const rim = new THREE.PointLight(0xa855f7, 1.4, 12);
      rim.position.set(-2, 1, -2);
      scene.add(rim);

      const group = new THREE.Group();
      scene.add(group);

      let usedModel = false;
      if (modelUrl) {
        try {
          if (!modelCache.has(modelUrl)) {
            const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
            const loader = new GLTFLoader();
            modelCache.set(modelUrl, loader.loadAsync(modelUrl));
          }
          const gltf = await modelCache.get(modelUrl);
          if (disposed) return;
          const root = (gltf as { scene: import('three').Object3D }).scene.clone(true);
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3());
          const scale = 2.2 / Math.max(size.x, size.y, size.z, 0.001);
          root.scale.setScalar(scale);
          const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
          root.position.sub(center);
          group.add(root);
          usedModel = true;
        } catch {
          usedModel = false;
        }
      }

      if (!usedModel) {
        // Плейсхолдер: не пустая заглушка, а узнаваемая форма — икосаэдр
        // цвета вида питомца, с мягким свечением.
        const color = PET_COLOR[petType] ?? 0x8b5cf6;
        const body = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1, 1),
          new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.15, emissive: color, emissiveIntensity: 0.12 }),
        );
        group.add(body);
        const eyeGeo = new THREE.SphereGeometry(0.12, 16, 16);
        const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0b0b12 });
        const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.32, 0.18, 0.85);
        const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.32, 0.18, 0.85);
        group.add(eyeL, eyeR);
      }

      // Лёгкое вращение перетаскиванием — рассматривать питомца/скин со
      // всех сторон, без внешних библиотек-контролов.
      let dragging = false;
      let lastX = 0;
      let rotY = 0;
      const rotX = -0.1;
      const onDown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; host.setPointerCapture(e.pointerId); };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        rotY += (e.clientX - lastX) * 0.008;
        lastX = e.clientX;
      };
      const onUp = (e: PointerEvent) => { dragging = false; host.releasePointerCapture(e.pointerId); };
      host.addEventListener('pointerdown', onDown);
      host.addEventListener('pointermove', onMove);
      host.addEventListener('pointerup', onUp);
      host.addEventListener('pointercancel', onUp);
      cleanupDrag = () => {
        host.removeEventListener('pointerdown', onDown);
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerup', onUp);
        host.removeEventListener('pointercancel', onUp);
      };

      const clock = new THREE.Clock();
      const tick = () => {
        if (disposed || !renderer) return;
        const t = clock.getElapsedTime();
        group.rotation.y = rotY + t * 0.15;
        group.rotation.x = rotX;
        group.position.y = Math.sin(t * 1.4) * 0.06; // idle-покачивание
        renderer.render(scene, camera);
        frame = requestAnimationFrame(tick);
      };
      tick();
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cleanupDrag?.();
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
    };
  }, [petType, modelUrl]);

  return <div ref={hostRef} style={{ width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' }}/>;
};
