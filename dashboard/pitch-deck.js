const slides = [...document.querySelectorAll(".slide")];
const number = document.getElementById("slide-number");
const dots = document.getElementById("slide-dots");

function goToSlide(index) {
  slides[Math.max(0, Math.min(index, slides.length - 1))].scrollIntoView({ behavior: "smooth" });
}

slides.forEach((slide, index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", `Open slide ${index + 1}: ${slide.dataset.title}`);
  button.addEventListener("click", () => goToSlide(index));
  dots.append(button);
});

const observer = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  const index = slides.indexOf(visible.target);
  number.textContent = String(index + 1).padStart(2, "0");
  [...dots.children].forEach((dot, dotIndex) => dot.setAttribute("aria-current", String(dotIndex === index)));
}, { threshold: [0.45, 0.7] });

slides.forEach((slide) => observer.observe(slide));

document.getElementById("previous-slide").addEventListener("click", () => goToSlide(Number(number.textContent) - 2));
document.getElementById("next-slide").addEventListener("click", () => goToSlide(Number(number.textContent)));

document.addEventListener("keydown", (event) => {
  if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) {
    event.preventDefault();
    goToSlide(Number(number.textContent));
  }
  if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
    event.preventDefault();
    goToSlide(Number(number.textContent) - 2);
  }
});
