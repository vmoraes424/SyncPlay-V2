import { useLayoutEffect, useRef, useState } from "react";

export type MarqueeTextProps = {
  text: string;
  className?: string;
};

/**
 * Texto em uma linha: trunca quando cabe; quando há overflow, anima marquee infinito.
 * Velocidade aprox. constante (px/s) para textos longos ou colunas estreitas.
 */
export function MarqueeText({ text, className = "" }: MarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const segmentRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [durationSec, setDurationSec] = useState(12);
  const [reduceMotion, setReduceMotion] = useState(false);

  useLayoutEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduceMotion(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const update = () => {
      setOverflow(measure.scrollWidth > container.clientWidth + 0.5);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [text, className]);

  useLayoutEffect(() => {
    if (!overflow || reduceMotion) return;
    const seg = segmentRef.current;
    if (!seg) return;
    const w = seg.getBoundingClientRect().width;
    const pxPerSec = 36;
    setDurationSec(Math.max(8, w / pxPerSec));
  }, [text, className, overflow, reduceMotion]);

  const useMarquee = overflow && !reduceMotion;

  return (
    <div ref={containerRef} className="relative min-w-0 overflow-hidden" title={text}>
      <span
        ref={measureRef}
        className={`pointer-events-none absolute left-0 top-0 -z-10 whitespace-nowrap opacity-0 ${className}`}
        aria-hidden
      >
        {text}
      </span>
      {useMarquee ? (
        <div
          className="marquee-infinite-track flex w-max"
          style={{ animationDuration: `${durationSec}s` }}
        >
          <span ref={segmentRef} className={`shrink-0 pr-10 ${className}`}>
            {text}
          </span>
          <span className={`shrink-0 pr-10 ${className}`} aria-hidden>
            {text}
          </span>
        </div>
      ) : (
        <span className={`block min-w-0 truncate ${className}`}>{text}</span>
      )}
    </div>
  );
}
