const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const revealTargets = document.querySelectorAll([
  ".hero-copy-block",
  ".proof-visual",
  ".section-heading",
  ".metrics",
  ".proof-card",
  ".wallet-bar",
  ".signature-preview",
  ".launch-card",
  ".configuration-grid",
  ".boundary-card",
].join(","));

for (const [index, target] of [...revealTargets].entries()) {
  target.classList.add("reveal-target");
  target.style.transitionDelay = `${Math.min(index % 5, 3) * 70}ms`;
}

if (reducedMotion.matches || !("IntersectionObserver" in window)) {
  revealTargets.forEach((target) => target.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -6%" },
  );
  revealTargets.forEach((target) => observer.observe(target));
}

const proofVisual = document.querySelector(".proof-visual");
if (proofVisual && !reducedMotion.matches) {
  let animationFrame = 0;
  proofVisual.addEventListener("pointermove", (event) => {
    const bounds = proofVisual.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(() => {
      proofVisual.style.transform = `perspective(1000px) rotateX(${y * -2.2}deg) rotateY(${x * 2.8}deg)`;
    });
  });
  proofVisual.addEventListener("pointerleave", () => {
    cancelAnimationFrame(animationFrame);
    proofVisual.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg)";
  });
}
