import confetti from "canvas-confetti";
import {
  motion,
  stagger,
  useAnimate,
  useReducedMotion,
  type Variants,
} from "motion/react";
import { useEffect, useRef } from "react";

export interface FiguePhoto {
  src: string;
  width: number;
  height: number;
}

// Club palette: coral, yellow, lilac, mint, ink.
const colors = ["#ff6f61", "#ffd45c", "#c9b8ff", "#9fe3c8", "#3c2a63"];
const spring = { type: "spring", stiffness: 260, damping: 16 } as const;

function celebrate(origin = { x: 0.5, y: 0.45 }) {
  const paw = confetti.shapeFromText({ text: "🐾", scalar: 2 });
  const base = { colors, disableForReducedMotion: true, zIndex: 40 };
  void confetti({
    ...base,
    particleCount: 60,
    ticks: 140,
    spread: 100,
    startVelocity: 42,
    origin,
  });
  void confetti({
    ...base,
    shapes: [paw],
    scalar: 2,
    particleCount: 14,
    spread: 120,
    flat: true,
    origin,
  });
}

function welcome() {
  const base = { colors, disableForReducedMotion: true, zIndex: 40 };
  const end = Date.now() + 450;
  let frame = 0;
  (function burst() {
    void confetti({
      ...base,
      particleCount: 3,
      ticks: 140,
      angle: 60,
      spread: 60,
      origin: { x: 0, y: 0.75 },
    });
    void confetti({
      ...base,
      particleCount: 3,
      ticks: 140,
      angle: 120,
      spread: 60,
      origin: { x: 1, y: 0.75 },
    });
    if (Date.now() < end) frame = requestAnimationFrame(burst);
  })();
  const timer = setTimeout(() => celebrate(), 700);
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    confetti.reset();
  };
}

const letter: Variants = {
  hidden: { opacity: 0, y: 60, rotate: -20, scale: 0.4 },
  shown: { opacity: 1, y: 0, rotate: 0, scale: 1, transition: spring },
};

export function FigueReveal({
  cover,
  guff,
  sieste,
}: {
  cover: FiguePhoto;
  guff: FiguePhoto;
  sieste: FiguePhoto;
}) {
  const reduce = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLElement>();
  const toy = useRef<HTMLButtonElement>(null);
  const initial = reduce ? false : "hidden";

  useEffect(() => (reduce ? undefined : welcome()), [reduce]);

  function play() {
    const box = toy.current?.getBoundingClientRect();
    celebrate(
      box
        ? {
            x: (box.left + box.width / 2) / window.innerWidth,
            y: (box.top + box.height / 2) / window.innerHeight,
          }
        : undefined,
    );
    if (reduce) return;
    void animate(
      ".figue-cover",
      { y: [0, -36, 0, -12, 0], rotate: [-3, 4, -6, 2, -3] },
      { duration: 0.9, ease: "easeOut" },
    );
    void animate(
      ".figue-title span",
      { y: [0, -18, 0] },
      { duration: 0.5, delay: stagger(0.06) },
    );
  }

  return (
    <article ref={scope} className="figue-page">
      <section className="figue-intro">
        <motion.figure
          className="polaroid tape figue-cover"
          initial={
            reduce ? false : { opacity: 0, y: -160, rotate: -28, scale: 0.6 }
          }
          animate={{ opacity: 1, y: 0, rotate: -3, scale: 1 }}
          transition={{ ...spring, delay: 0.1 }}
          whileHover={reduce ? undefined : { rotate: 0, scale: 1.03 }}
        >
          <img
            src={cover.src}
            width={cover.width}
            height={cover.height}
            alt="Figue, chat noir, endormi sur une couverture"
          />
          <figcaption className="hand">Entre deux aventures.</figcaption>
        </motion.figure>
        <div className="figue-copy">
          <motion.span
            className="badge yellow"
            initial={reduce ? false : { opacity: 0, scale: 0 }}
            animate={{
              opacity: 1,
              scale: 1,
              rotate: reduce ? 0 : [0, -8, 6, 0],
            }}
            transition={{ ...spring, delay: 0.5 }}
          >
            Membre d’honneur
          </motion.span>
          <h1 aria-label="Figue, le chat figue.">
            <motion.span
              className="figue-title"
              aria-hidden="true"
              initial={initial}
              animate="shown"
              transition={{ delayChildren: 0.35, staggerChildren: 0.08 }}
            >
              {[..."Figue"].map((c, i) => (
                <motion.span key={i} variants={letter}>
                  {c}
                </motion.span>
              ))}
            </motion.span>
            <motion.span
              className="figue-subtitle"
              aria-hidden="true"
              initial={reduce ? false : { opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.9, duration: 0.4 }}
            >
              le chat figue.
            </motion.span>
          </h1>
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.05, duration: 0.4 }}
          >
            Un petit chat noir très intelligent, avec plein d’idées. Lance-lui
            son jouet : il aime te le rapporter.
          </motion.p>
          <motion.button
            ref={toy}
            type="button"
            className="button figue-toy"
            onClick={play}
            initial={reduce ? false : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...spring, delay: 1.2 }}
            whileHover={reduce ? undefined : { scale: 1.06, rotate: -2 }}
            whileTap={reduce ? undefined : { scale: 0.92 }}
          >
            Lancer son jouet
          </motion.button>
        </div>
      </section>
      <motion.section
        className="figue-notes"
        aria-label="Les petites choses sur Figue"
        initial={initial}
        whileInView="shown"
        viewport={{ once: true, amount: 0.3 }}
        transition={{ staggerChildren: 0.12 }}
      >
        {[
          ["yellow", "Ses surnoms", "Figue le chat figue, Figolu et Guff."],
          ["", "Son talent spécial", "Rapporter son jouet. Encore. Et encore."],
          ["lilac", "Son endroit préféré", "Son hamac."],
        ].map(([tone, title, text], i) => (
          <motion.div
            key={title}
            className={`note ${tone}`}
            variants={{
              hidden: { opacity: 0, y: 50, rotate: i % 2 ? 6 : -6 },
              shown: {
                opacity: 1,
                y: 0,
                rotate: [-1.5, 1, -1][i],
                transition: spring,
              },
            }}
            whileHover={reduce ? undefined : { rotate: 0, scale: 1.04 }}
          >
            <h2 className="hand">{title}</h2>
            <p>{text}</p>
          </motion.div>
        ))}
      </motion.section>
      <section className="section">
        <h2>Dans le carnet de Figue</h2>
        <div className="figue-gallery">
          {[
            [
              guff,
              "Gros plan de Figue, avec de grands yeux, regardant l’objectif",
              "Guff inspecte l’objectif.",
            ] as const,
            [
              sieste,
              "Figue endormi sur le dos, les pattes repliées",
              "Figolu en recharge.",
            ] as const,
          ].map(([photo, alt, caption], i) => (
            <motion.figure
              key={caption}
              className="polaroid"
              initial={
                reduce
                  ? false
                  : { opacity: 0, x: i ? 80 : -80, rotate: i ? 14 : -14 }
              }
              whileInView={{ opacity: 1, x: 0, rotate: i ? -3 : 3 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={spring}
              whileHover={reduce ? undefined : { rotate: 0, scale: 1.04 }}
            >
              <img
                src={photo.src}
                width={photo.width}
                height={photo.height}
                alt={alt}
                loading="lazy"
              />
              <figcaption className="hand">{caption}</figcaption>
            </motion.figure>
          ))}
        </div>
      </section>
    </article>
  );
}
