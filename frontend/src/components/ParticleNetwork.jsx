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

function ParticleNetwork() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const handleChange = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const count = isMobile ? PARTICLE_COUNT_MOBILE : PARTICLE_COUNT;
    const ctx = canvas.getContext("2d");
    let particles = [];
    let animationId;
    let w = 0;
    let h = 0;

    function setSize() {
      const cw = wrap.clientWidth || window.innerWidth;
      const ch = wrap.clientHeight || window.innerHeight;
      if (cw <= 0 || ch <= 0) return;
      w = cw;
      h = ch;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initParticles();
    }

    function initParticles() {
      particles = [];
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * SPEED,
          vy: (Math.random() - 0.5) * SPEED,
        });
      }
    }

    function draw() {
      if (w <= 0 || h <= 0) {
        animationId = requestAnimationFrame(draw);
        return;
      }
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

      animationId = requestAnimationFrame(draw);
    }

    setSize();
    draw();
    const ro = new ResizeObserver(() => setSize());
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(animationId);
    };
  }, [isMobile]);

  return (
    <div ref={wrapRef} className="particle-network-wrap" aria-hidden="true">
      <canvas ref={canvasRef} className="particle-network" />
    </div>
  );
}

export default ParticleNetwork;
