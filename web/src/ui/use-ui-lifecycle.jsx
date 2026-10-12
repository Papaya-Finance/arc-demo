import { useEffect, useRef, useState } from "react";

/** Only open popovers subscribe; one cleanup path handles click-away and Escape. */
export function useDismiss(open, root, dismiss) {
  const latest = useRef(dismiss);
  latest.current = dismiss;
  useEffect(() => {
    if (!open) return;
    const pointer = (event) => {
      if (!root.current?.contains(event.target)) latest.current();
    };
    const key = (event) => {
      if (event.key === "Escape") latest.current();
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [open, root]);
}
export function useCopyFeedback() {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null),
    mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const copy = async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (!mounted.current) return;
      clearTimeout(timer.current);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard may be blocked */
    }
  };
  return { copied, copy };
}

/** Preserve the two-step transition while cancelling every timer/frame on teardown. */
export function useStepTransition(review) {
  const [shownReview, setShownReview] = useState(review);
  const shown = useRef(review);
  const stageRef = useRef(null),
    innerRef = useRef(null);
  const [stepFade, setStepFade] = useState("in");
  const [stageH, setStageH] = useState(null);
  useEffect(() => {
    if (shown.current === review) {
      // A quick Back click may cancel the fade before the content swap.
      setStepFade("in");
      setStageH(null);
      return;
    }
    let frame1, frame2, fallback;
    setStepFade("out");
    const from = Math.ceil(innerRef.current?.scrollHeight || 0);
    if (from > 0) setStageH(from);
    const swap = setTimeout(() => {
      shown.current = review;
      setShownReview(review);
      setStepFade("in");
      frame1 = requestAnimationFrame(() => {
        frame2 = requestAnimationFrame(() => {
          const next = Math.ceil(innerRef.current?.scrollHeight || 0);
          setStageH(next || null);
          fallback = setTimeout(() => setStageH(null), 520);
        });
      });
    }, 220);
    return () => {
      clearTimeout(swap);
      clearTimeout(fallback);
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
    };
  }, [review]);
  const onTransitionEnd = (event) => {
    if (event.target === stageRef.current && event.propertyName === "height") setStageH(null);
  };
  return { shownReview, stageRef, innerRef, stepFade, stageH, onTransitionEnd };
}
