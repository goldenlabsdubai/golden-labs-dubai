import { useEffect, useRef, useState } from "react";

const PARTICLE_COUNT = 140;
const PARTICLE_COUNT_MOBILE = 45;
const MOBILE_BREAKPOINT = 600;
const CONNECT_DISTANCE = 140;
const PARTICLE_RADIUS = 2;
const LINE_OPACITY = 0.35;
const PARTICLE_OPACITY = 0.8;
const COLOR = "212, 175, 55"; // gold
const SPEED = 0.3;

function supportsReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function bindMediaQuery(mq, handler) {
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }
  if (typeof mq.addListener === "function") {
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }
  return () => {};
}

function ParticleNetwork() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
    } catch {
      return window.innerWidth <= MOBILE_BREAKPOINT;
    }
  });
  const [skipCanvas] = useState(() => supportsReducedMotion());

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let mq;
    try {
      mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    } catch {
      return undefined;
    }
    const handleChange = (e) => setIsMobile(e.matches);
    handleChange(mq);
    return bindMediaQuery(mq, handleChange);
  }, []);

  useEffect(() => {
    if (skipCanvas) return undefined;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return undefined;

    let ctx;
    try {
      ctx = canvas.getContext("2d", { alpha: true });
    } catch {
      return undefined;
    }
    if (!ctx) return undefined;

    let particles = [];
    let animationId = 0;
    let w = 0;
    let h = 0;
    let cancelled = false;
    let drawReportedError = false;

    const count = isMobile ? PARTICLE_COUNT_MOBILE : PARTICLE_COUNT;

    function initParticles() {
      particles = [];
      if (w <= 0 || h <= 0) return;
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * SPEED,
          vy: (Math.random() - 0.5) * SPEED,
        });
      }
    }

    function setSize() {
      const cw = Math.max(1, wrap.clientWidth || window.innerWidth || 320);
      const ch = Math.max(1, wrap.clientHeight || window.innerHeight || 400);
      w = cw;
      h = ch;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initParticles();
    }

    function draw() {
      if (cancelled) return;
      if (w <= 0 || h <= 0 || particles.length === 0) {
        animationId = window.requestAnimationFrame(draw);
        return;
      }
      try {
        ctx.clearRect(0, 0, w, h);

        for (let i = 0; i < particles.length; i++) {
          const a = particles[i];
          a.x += a.vx;
          a.y += a.vy;
          if (a.x < 0 || a.x > w) a.vx *= -1;
          if (a.y < 0 || a.y > h) a.vy *= -1;
        }

        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x;
            const dy = particles[i].y - particles[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < CONNECT_DISTANCE) {
              const opacity = (1 - dist / CONNECT_DISTANCE) * LINE_OPACITY;
              ctx.beginPath();
              ctx.moveTo(particles[i].x, particles[i].y);
              ctx.lineTo(particles[j].x, particles[j].y);
              ctx.strokeStyle = `rgba(${COLOR}, ${opacity})`;
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }
        }

        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          ctx.beginPath();
          ctx.arc(p.x, p.y, PARTICLE_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${COLOR}, ${PARTICLE_OPACITY})`;
          ctx.fill();
        }
      } catch {
        if (!drawReportedError) {
          drawReportedError = true;
          console.warn("[Golden Labs] Particle canvas disabled (WebView canvas error).");
        }
        return;
      }
      animationId = window.requestAnimationFrame(draw);
    }

    try {
      setSize();
    } catch {
      return undefined;
    }
    draw();

    let ro;
    let onResize;
    if (typeof ResizeObserver !== "undefined") {
      try {
        ro = new ResizeObserver(() => {
          try {
            setSize();
          } catch {
            /* ignore */
          }
        });
        ro.observe(wrap);
      } catch {
        ro = null;
      }
    }
    if (!ro) {
      onResize = () => {
        try {
          setSize();
        } catch {
          /* ignore */
        }
      };
      window.addEventListener("resize", onResize);
      window.addEventListener("orientationchange", onResize);
    }

    return () => {
      cancelled = true;
      if (animationId) window.cancelAnimationFrame(animationId);
      if (ro) ro.disconnect();
      if (onResize) {
        window.removeEventListener("resize", onResize);
        window.removeEventListener("orientationchange", onResize);
      }
    };
  }, [isMobile, skipCanvas]);

  if (skipCanvas) {
    return <div ref={wrapRef} className="particle-network-wrap" aria-hidden="true" />;
  }

  return (
    <div ref={wrapRef} className="particle-network-wrap" aria-hidden="true">
      <canvas ref={canvasRef} className="particle-network" />
    </div>
  );
}

export default ParticleNetwork;
